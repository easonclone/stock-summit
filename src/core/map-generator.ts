import { validateMap, type Config, type GameMap, type Platform } from '../config/settings';
import { seededRandom, type Random } from './random';

type Terrain = Config['terrain'];
type Span = [number, number];
type Ledge = GameMap['ledges'][number];
type Obstacle = GameMap['obstacles'][number];
type CardSpawn = GameMap['cardSpawns'][number];
type Bundle = GameMap['cash']['bundles'][number];

const between = ([min, max]: Span, random: Random) => min + (max - min) * random();
const integer = ([min, max]: Span, random: Random) => min + Math.floor(random() * (max - min + 1));
const round = (value: number) => Math.round(value);

/** Picks a random x in `range` that keeps `gap` distance from every point in `taken`. */
function freeX(range: Span, taken: Span[], random: Random, tries = 12) {
  if (range[0] > range[1]) return null;
  for (let i = 0; i < tries; i++) {
    const x = round(between(range, random));
    if (taken.every(([from, to]) => x < from || x > to)) return x;
  }
  return null;
}

interface Layer {
  platform: Platform;
  /** Ladder arriving from below, or the spawn area for the floor. */
  arrival: number;
  /** Ladder leaving upward. */
  departure?: number;
  jump?: number;
  ledge?: Ledge;
  patrol?: Obstacle;
  /** Horizontal intervals reserved on this platform's walking surface. */
  taken: Span[];
}

class Builder {
  private readonly halfWidth: number;
  private readonly jumpHeight: number;
  private readonly layers: Layer[] = [];

  constructor(private readonly template: GameMap, private readonly config: Pick<Config, 'physics' | 'obstacles' | 'terrain'>,
    private readonly random: Random) {
    this.halfWidth = config.physics.hitbox.width / 2;
    this.jumpHeight = config.physics.jumpVelocity ** 2 / (2 * config.physics.gravity);
  }

  private get terrain(): Terrain { return this.config.terrain; }

  build(): GameMap | null {
    const { template } = this;
    const floor = template.platforms[0];
    const spawnX = template.spawnPoints.reduce((sum, point) => sum + point.x, 0) / template.spawnPoints.length;
    this.layers.push({ platform: { ...floor, edges: [] }, arrival: round(spawnX), taken: [] });
    for (let layer = 1; layer < template.platforms.length; layer++) {
      if (!this.addLayer(layer)) return null;
    }
    for (const [index, layer] of this.layers.entries()) {
      if (index > 0 && index < this.layers.length - 1) this.addPatrol(layer);
    }
    for (const [index, layer] of this.layers.entries()) {
      const next = this.layers[index + 1];
      if (next) this.addShortcut(layer, next);
      this.setSafeLanding(layer);
    }
    return this.assemble();
  }

  /** Places platform `layer` and the ladder joining it to the platform below. */
  private addLayer(index: number) {
    const terrain = this.terrain;
    const below = this.layers[index - 1];
    const source = this.template.platforms[index];
    const width = this.template.width;
    const margin = this.halfWidth + terrain.ladderClearance;
    for (let attempt = 0; attempt < terrain.attempts; attempt++) {
      const platformWidth = round(between(terrain.platformWidth, this.random));
      const x = round(between([terrain.edgeMargin, width - terrain.edgeMargin - platformWidth], this.random));
      const low = below.platform;
      const overlap: Span = [Math.max(low.x, x) + margin, Math.min(low.x + low.width, x + platformWidth) - margin];
      if (overlap[1] - overlap[0] < terrain.minOverlap - margin * 2) continue;
      const spacing = terrain.ladderSpacing;
      const ladder = freeX(overlap, [[below.arrival - spacing, below.arrival + spacing]], this.random);
      if (ladder === null) continue;
      below.departure = ladder;
      below.taken.push([ladder - terrain.itemSpacing, ladder + terrain.itemSpacing]);
      const platform: Platform = { id: source.id, layer: index, x, y: source.y, width: platformWidth,
        height: source.height, safeLanding: { x: 0, y: source.y }, edges: [] };
      this.layers.push({ platform, arrival: ladder, taken: [[ladder - terrain.itemSpacing, ladder + terrain.itemSpacing]] });
      return true;
    }
    return false;
  }

  /** Puts a patrolling retail trader strictly between the arrival and departure ladders. */
  private addPatrol(layer: Layer) {
    const terrain = this.terrain;
    const type = Object.keys(this.config.obstacles)[0];
    if (layer.departure === undefined || !type || this.random() >= terrain.patrolChance) return;
    const typeWidth = this.config.obstacles[type].width;
    const clearance = terrain.patrolClearance + typeWidth / 2 + this.halfWidth;
    const left = Math.ceil(Math.min(layer.arrival, layer.departure) + clearance);
    const right = Math.floor(Math.max(layer.arrival, layer.departure) - clearance);
    const span = Math.min(round(between(terrain.patrolSpan, this.random)), right - left);
    if (span < terrain.patrolSpan[0]) return;
    const fromX = round(between([left, right - span], this.random));
    layer.patrol = { id: `retail${layer.platform.layer}`, platformId: layer.platform.id, type, fromX, toX: fromX + span };
    layer.taken.push([fromX - clearance, fromX + span + clearance]);
  }

  /** Adds a direct jump for short gaps, or a floating ledge for tall gaps. */
  private addShortcut(layer: Layer, next: Layer) {
    const terrain = this.terrain;
    const low = layer.platform;
    const high = next.platform;
    const rise = low.y - high.y;
    const margin = this.halfWidth + 2;
    const shared: Span = [Math.max(low.x, high.x) + margin, Math.min(low.x + low.width, high.x + high.width) - margin];
    const ladder = layer.departure!;
    if (rise < this.jumpHeight - 6) {
      if (this.random() >= terrain.jumpChance) return;
      const offset = round(between(terrain.jumpOffset, this.random)) * (this.random() < 0.5 ? -1 : 1);
      const x = ladder + offset;
      const blocked = layer.taken.filter(span => span !== layer.taken.find(([a, b]) => ladder >= a && ladder <= b));
      if (x < shared[0] || x > shared[1] || blocked.some(([a, b]) => x >= a && x <= b)) return;
      layer.jump = x;
      return;
    }
    if (this.random() >= terrain.ledgeChance) return;
    const ledgeRise = round(between(terrain.ledgeRise, this.random));
    if (ledgeRise >= this.jumpHeight || rise - ledgeRise >= this.jumpHeight) return;
    const ledgeWidth = round(between(terrain.ledgeWidth, this.random) / 2) * 2;
    const half = ledgeWidth / 2;
    const gap = terrain.ledgeLadderGap + half;
    const center = freeX([shared[0], shared[1]], [[ladder - gap, ladder + gap]], this.random);
    if (center === null || center - half < 0 || center + half > this.template.width) return;
    layer.ledge = { id: `ledge${low.layer}`, from: low.id, to: high.id, x: round(center - half), width: ledgeWidth, rise: ledgeRise };
  }

  private setSafeLanding(layer: Layer) {
    const platform = layer.platform;
    const range: Span = [platform.x + this.halfWidth, platform.x + platform.width - this.halfWidth];
    const patrol = layer.patrol;
    const avoid: Span[] = patrol ? [[patrol.fromX - this.terrain.patrolClearance - this.halfWidth,
      patrol.toX + this.terrain.patrolClearance + this.halfWidth]] : [];
    const x = freeX(range, avoid, this.random, 24) ?? layer.arrival;
    platform.safeLanding = { x, y: platform.y };
  }

  private assemble(): GameMap {
    const { template, terrain, random } = this;
    const layers = this.layers;
    const last = layers.length - 1;
    const ladders: GameMap['ladders'] = [];
    for (const [index, layer] of layers.entries()) {
      const platform = layer.platform;
      const below = layers[index - 1];
      const above = layers[index + 1];
      if (below) platform.edges.push({ to: below.platform.id, type: 'climb', x: layer.arrival });
      if (above && layer.departure !== undefined) {
        platform.edges.push({ to: above.platform.id, type: 'climb', x: layer.departure });
        ladders.push({ id: `l${index}`, from: platform.id, to: above.platform.id, x: layer.departure });
      }
      if (above && layer.jump !== undefined) platform.edges.push({ to: above.platform.id, type: 'jump', x: layer.jump });
    }

    const cardSpawns: CardSpawn[] = [];
    const place = (layer: Layer, spacing: number) => {
      const platform = layer.platform;
      const x = freeX([platform.x + this.halfWidth, platform.x + platform.width - this.halfWidth], layer.taken, random);
      if (x !== null) layer.taken.push([x - spacing, x + spacing]);
      return x;
    };
    for (let index = 0; index < last; index += integer(terrain.publicCardGap, random)) {
      const x = place(layers[index], terrain.itemSpacing);
      if (x !== null) cardSpawns.push({ id: `c${index}`, platformId: layers[index].platform.id, x, kind: 'public' });
    }
    for (let index = integer(terrain.recoveryCardGap, random) - 3; index < last - 2; index += integer(terrain.recoveryCardGap, random)) {
      if (index < 1) continue;
      const x = place(layers[index], terrain.itemSpacing);
      if (x !== null) cardSpawns.push({ id: `aid${index}`, platformId: layers[index].platform.id, x, kind: 'recovery' });
    }
    for (const layer of layers) {
      const ledge = layer.ledge;
      if (!ledge || random() >= terrain.airCardChance) continue;
      const x = round(between([ledge.x + this.halfWidth, ledge.x + ledge.width - this.halfWidth], random));
      cardSpawns.push({ id: `air${layer.platform.layer}`, platformId: ledge.id, x, kind: 'public' });
    }

    const bundles: Bundle[] = [];
    for (let index = 0, count = 0; index < last; index += integer(terrain.cashGap, random)) {
      const x = place(layers[index], terrain.itemSpacing);
      if (x === null) continue;
      const amount = terrain.cashAmounts[count % terrain.cashAmounts.length];
      bundles.push({ id: `cash${++count}`, platformId: layers[index].platform.id, x, amount });
    }

    return {
      ...template,
      platforms: layers.map(layer => layer.platform),
      ledges: layers.flatMap(layer => layer.ledge ? [layer.ledge] : []),
      ladders,
      cardSpawns,
      obstacles: layers.flatMap(layer => layer.patrol ? [layer.patrol] : []),
      cash: { ...template.cash, bundles }
    };
  }
}

/**
 * Builds a reproducible variant of `template` for `seed`. Keeps the template's layer heights, zones and spawn points,
 * randomizes platforms, ladders, shortcuts, patrols and pickups, and checks the result with the same validation as
 * start-up. Falls back to the template if no valid layout is found within `terrain.attempts` tries.
 */
export function generateMap(template: GameMap, config: Pick<Config, 'physics' | 'obstacles' | 'terrain'>, seed: number): GameMap {
  for (let attempt = 0; attempt < config.terrain.attempts; attempt++) {
    const map = new Builder(template, config, seededRandom((seed ^ Math.imul(attempt + 1, 0x2c1b3c6d)) >>> 0)).build();
    if (!map) continue;
    try {
      validateMap(map, config);
      return map;
    } catch {
      continue;
    }
  }
  return structuredClone(template);
}
