import type { Card, Character, Config, Difficulty, Effect, GameMap, MarketEvent, PixelIcon, Tone } from '../config/settings';
import { CashPickups } from './cash';
import { applyEffects, freshEffects, harmful, toneOf, type EffectState } from './effects';
import { FallingTraders } from './falling-traders';
import { idle, Movement, Track, type Body, type MovementInput } from './movement';
import { seededRandom, weighted, type Random } from './random';
import { between, RivalController } from './rivals';
import { marketTargets } from './targets';
import { Terrain, type Patrol } from './terrain';

export interface Racer {
  character: Character;
  isPlayer: boolean;
  body: Body;
  status: EffectState;
  inventory: (Card | null)[];
  cash: number;
  highest: number;
  drawdown: number;
  picked: number;
  used: number;
  marketHits: number;
  heightAt: number;
  lastHeight: number;
  trough: number | null;
  rebound: number;
  shielded: number;
  wasBehind: boolean;
  comebackAt: number | null;
  closes: number[];
}

export interface Bulletin {
  kind: 'market' | 'card' | 'obstacle' | 'cash';
  icon: PixelIcon;
  title: string;
  description: string;
  tone: Tone;
  at: number;
}

export interface RaceOptions {
  playerId: string;
  seed: number;
  difficulty: Difficulty;
  map: GameMap;
}

export type CardFx = 'rise' | 'fall' | 'shield' | 'speed' | 'intel' | 'guard' | 'clear' | 'freeze' | 'flat';

const effectCue: Record<Effect['type'], { style: CardFx; label: string }> = {
  displacement: { style: 'flat', label: '持平' },
  speed_modifier: { style: 'speed', label: '動能' },
  freeze: { style: 'freeze', label: '凍結' },
  cash_loss_or_freeze: { style: 'freeze', label: '流動性危機' },
  shield: { style: 'shield', label: '避險 +1' },
  reveal_next_event: { style: 'intel', label: '取得預告' },
  limit_loss: { style: 'guard', label: '設定停損' },
  clear_negative: { style: 'clear', label: '狀態清除' }
};

export interface Impact {
  at: number;
  from: { x: number; y: number };
  layers: number;
  obstacle: boolean;
  style: CardFx;
  label: string;
}

interface Pickup {
  id: string;
  x: number;
  y: number;
  platformId: string;
  card: Card;
  kind: GameMap['cardSpawns'][number]['kind'];
  respawnAt: number | null;
}

export class Race {
  readonly track: Track;
  readonly player: Racer;
  readonly racers: Racer[];
  readonly pickups: Pickup[];
  readonly terrain: Terrain;
  readonly cashPickups: CashPickups;
  readonly fallingTraders: FallingTraders;
  fallingHitAt: number | null = null;
  readonly impacts = new Map<Racer, Impact>();
  cardCue: { style: CardFx; weight: number } | null = null;
  readonly log: Bulletin[] = [];
  time = 0;
  countdown: number;
  nextEventAt: number;
  tone: Tone = 'neutral';
  paused = false;
  result: 'summit' | 'timeout' | null = null;
  winner: Racer | null = null;
  firstToSummit: Racer | null = null;
  closesAt: number | null = null;
  marketCount = 0;
  news: Bulletin | null = null;
  private playerNotice: Bulletin | null = null;
  private latestNotice: Bulletin | null = null;
  private readonly obstacleContacts = new Map<Racer, Set<string>>();
  private readonly cardPools: Record<Pickup['kind'], Card[]>;
  private readonly recoveryRandom: Random;

  private lastHarmfulEvent = false;
  private nextEvent: MarketEvent;
  private readonly marketRandom: Random;
  private readonly targetRandom: Random;
  private readonly cardRandom: Random;
  private readonly movement: Movement;
  private readonly rivals = new Map<Racer, { controller: RivalController; random: Random; thinkAt: number }>();

  constructor(readonly config: Config, readonly options: RaceOptions) {
    this.track = new Track(options.map);
    this.movement = new Movement(this.track, config.physics);
    this.cashPickups = new CashPickups(this.track, config.cash);
    this.fallingTraders = new FallingTraders(this.track, config.fallingTraders, config.physics.hitbox, seededRandom(options.seed ^ 0x13461b27));
    this.terrain = new Terrain(this.track, config.physics, config.obstacles, seededRandom(options.seed ^ 0xcc9e2159));
    this.cardPools = {
      public: config.cards.filter(card => card.pool !== 'recovery'),
      recovery: config.cards.filter(card => card.pool !== 'public')
    };
    this.countdown = config.gameplay.countdownMs;
    this.nextEventAt = config.gameplay.eventIntervalMs;
    this.marketRandom = seededRandom(options.seed);
    this.targetRandom = seededRandom(options.seed ^ 0x77de6451);
    this.cardRandom = seededRandom(options.seed ^ 0xa3fe014d);
    this.recoveryRandom = seededRandom(options.seed ^ 0x6bc953b1);
    this.nextEvent = this.drawEvent();

    const characters = [...config.characters].sort((first, second) =>
      Number(second.id === options.playerId) - Number(first.id === options.playerId));
    if (characters[0].id !== options.playerId) throw new Error('找不到選擇的角色');
    this.racers = characters.map((character, index): Racer => {
      const spawn = options.map.spawnPoints[index];
      return {
        character, isPlayer: index === 0,
        body: { ...spawn, velocityY: 0, platformId: this.track.floor.id, ladderId: null, facing: 1, motion: 'idle' },
        status: freshEffects(), cash: 0, inventory: Array.from({ length: config.gameplay.inventorySize }, () => null),
        highest: 0, drawdown: 0, picked: 0, used: 0, marketHits: 0, heightAt: 0, lastHeight: Math.round(spawn.y),
        trough: null, rebound: 0, shielded: 0, wasBehind: false, comebackAt: null, closes: [0]
      };
    });
    this.player = this.racers[0];
    for (const [index, racer] of this.racers.entries()) {
      if (racer.isPlayer) continue;
      const random = seededRandom(options.seed ^ Math.imul(index, 0x9e3779b9));
      const controller = new RivalController(this.track, config.npc, options.difficulty, random, this.cashPickups);
      this.rivals.set(racer, { controller, random, thinkAt: between(config.npc.cardThinkMs, random) });
    }

    this.pickups = options.map.cardSpawns.map(spawn => ({
      id: spawn.id, x: spawn.x, y: this.track.platforms.get(spawn.platformId)!.y,
      platformId: spawn.platformId, kind: spawn.kind, card: this.drawCard(spawn.kind), respawnAt: null
    }));
  }

  ranking() {
    return [...this.racers].sort((a, b) => {
      const ranking = this.result
        ? this.score(b).total - this.score(a).total || this.track.layerPosition(b.body.y) - this.track.layerPosition(a.body.y) ||
          Number(b === this.firstToSummit) - Number(a === this.firstToSummit)
        : a.lastHeight - b.lastHeight;
      return ranking || a.heightAt - b.heightAt || a.character.id.localeCompare(b.character.id, 'en');
    });
  }

  score(racer: Racer) {
    const layers = Math.round(this.track.layerPosition(racer.body.y) * 100);
    const bonus = Math.round(this.cashPickups.bonus(racer.cash) * 100);
    return { layers: layers / 100, bonus: bonus / 100, total: (layers + bonus) / 100 };
  }

  get forecast() {
    return this.player.status.revealsEvent ? this.nextEvent : null;
  }

  get notice() {
    const recent = (item: Bulletin | null) => item && this.time - item.at < this.config.gameplay.cardNewsMs ? item : null;
    return recent(this.playerNotice) ?? recent(this.latestNotice);
  }

  canClaimRecovery(racer: Racer, ranked = this.ranking()) {
    return ranked.indexOf(racer) >= ranked.length - this.config.gameplay.recoveryRanks &&
      this.track.layerAt(ranked[0].body.y) - this.track.layerAt(racer.body.y) >= this.config.gameplay.recoveryGapLayers;
  }

  closingChange(racer: Racer) {
    const seconds = Math.max(0, Math.floor((this.time - this.config.gameplay.eventIntervalMs) / 1000));
    return this.track.progress(racer.body.y) - (racer.closes[seconds] ?? 0);
  }

  get trend() {
    const ranked = this.ranking();
    const player = this.player;
    const threshold = this.config.gameplay.recoveryGapLayers;
    const layer = this.track.layerAt(player.body.y);
    if (player.comebackAt !== null && this.time - player.comebackAt < this.config.gameplay.newsMs) return '絕地反彈，空頭回補！';
    if (this.track.layerAt(ranked[0].body.y) - layer >= threshold) return '跌跌不休，套牢中！';
    if (player === ranked[0] && layer - this.track.layerAt(ranked[1].body.y) >= threshold) return '一路漲停，勢不可擋！';
    return '';
  }

  togglePause() {
    if (!this.result) this.paused = !this.paused;
  }

  usePlayerCard(slot: number) {
    if (!this.paused && !this.countdown && !this.result) {
      this.useCard(this.player, slot);
      this.updateProgress();
      this.startClosing();
    }
  }

  step(ms: number, controls: MovementInput = idle) {
    if (this.paused || this.result) return;
    if (this.countdown > 0) {
      this.countdown = this.countdown <= ms + 1e-6 ? 0 : this.countdown - ms;
      return;
    }

    const elapsed = Math.min(ms, (this.closesAt ?? this.config.gameplay.durationMs) - this.time);
    this.time += elapsed;
    const market = this.config.market[this.tone];
    this.terrain.step(elapsed / 1000, market.patrolSpeed);
    for (const racer of this.racers) {
      const rival = this.rivals.get(racer);
      const input = rival ? rival.controller.input(racer.body, this.time, racer.character.id, racer.cash) : controls;
      const status = racer.status;
      if (status.freezeUntil <= this.time) {
        const timedSpeed = status.boostUntil > this.time ? status.speed : 1;
        this.movement.step(racer.body, input, elapsed / 1000, market.travelSpeed * timedSpeed);
      }
      this.collectCash(racer);
      this.checkPatrol(racer);
    }
    this.checkFallingTraders();
    this.updateProgress();
    this.startClosing();

    this.collect();
    this.updateProgress();
    this.startClosing();

    for (const [racer, rival] of this.rivals) {
      if (this.time < rival.thinkAt) continue;
      rival.thinkAt = this.time + between(this.config.npc.cardThinkMs, rival.random);
      const slot = racer.inventory.findIndex(card => card && this.rivalShouldUse(card, racer));
      if (slot < 0) continue;
      this.useCard(racer, slot);
      this.updateProgress();
      this.startClosing();
    }

    if (this.time >= this.nextEventAt) {
      this.triggerMarket();
      this.updateProgress();
      this.startClosing();
    }

    if (this.time + 1e-6 >= (this.closesAt ?? this.config.gameplay.durationMs)) {
      this.result = this.closesAt === null ? 'timeout' : 'summit';
      this.winner = this.ranking()[0];
    }
  }

  private collectCash(racer: Racer) {
    const amount = this.cashPickups.collect(racer.character.id, racer.body);
    racer.cash += amount;
    if (!amount || !racer.isPlayer) return;
    this.record({
      kind: 'cash', title: `拾取鈔票 +${amount} 元`,
      description: `手持鈔票 ${racer.cash} 元`, icon: 'bills', tone: 'positive', at: this.time
    }, true, true);
  }

  private drawCard(kind: Pickup['kind']) {
    const pool = this.cardPools[kind];
    return weighted(pool, kind === 'recovery' ? this.recoveryRandom : this.cardRandom);
  }

  private checkFallingTraders() {
    const hits = this.fallingTraders.step(this.time, this.racers.map(racer => racer.body));
    if (!hits.length) return;
    const { effectIds, name } = this.config.fallingTraders;
    const effects = effectIds.map(id => this.config.effects[id]);
    for (const racer of this.racers) {
      if (!hits.includes(racer.body)) continue;
      const outcome = this.affect(racer, effects, 'obstacle');
      if (racer.isPlayer) this.fallingHitAt = this.time;
      this.record({
        kind: 'obstacle', title: `${racer.character.name}被${name}擊中`,
        description: outcome.messages.join('、'), tone: 'negative', icon: 'halt', at: this.time
      }, racer.isPlayer);
    }
  }

  private checkPatrol(racer: Racer) {
    const contacts = this.terrain.contacts(racer.body);
    const previous = this.obstacleContacts.get(racer);
    if (!contacts.length) {
      if (previous) this.obstacleContacts.delete(racer);
      return;
    }
    this.obstacleContacts.set(racer, new Set(contacts.map(patrol => patrol.id)));
    const impact = contacts.find(patrol => !previous?.has(patrol.id));
    if (impact && racer.status.freezeUntil <= this.time) this.hitPatrol(racer, impact);
  }

  private hitPatrol(racer: Racer, patrol: Patrol) {
    const effects = patrol.typeData.effectIds.map(id => this.config.effects[id]);
    const outcome = this.affect(racer, effects, 'obstacle');
    this.record({
      kind: 'obstacle', title: `${racer.character.name}撞上${patrol.typeData.name}`,
      description: `${patrol.typeData.message}｜${outcome.messages.join('、')}`,
      tone: 'negative', icon: 'halt', at: this.time
    }, racer.isPlayer);
  }

  private affect(racer: Racer, effects: Parameters<typeof applyEffects>[1], source: Parameters<typeof applyEffects>[4]) {
    const { x, y } = racer.body;
    const previousCash = racer.cash;
    const outcome = applyEffects(racer, effects, this.track, this.time, source);
    const liquidity = !outcome.shielded && effects.some(effect => effect.type === 'cash_loss_or_freeze');
    if (outcome.shielded) racer.shielded += 1;
    if (outcome.layersMoved || source === 'obstacle' || source === 'card' || liquidity) {
      const layers = outcome.layersMoved;
      const effect = effects[0];
      let { style, label } = effectCue[effect.type];
      if (effect.type === 'shield') label = `避險 +${effect.charges}`;
      if (effect.type === 'speed_modifier') label = `移速 ${effect.multiplier >= 1 ? '+' : '−'}${Math.round(Math.abs(effect.multiplier - 1) * 100)}%`;
      if (effect.type === 'limit_loss') label = `下滑 ≤ ${effect.layers} 層`;
      if (effect.type === 'clear_negative') label = outcome.messages[0];
      if (liquidity) {
        const lost = previousCash - racer.cash;
        style = lost ? 'fall' : 'freeze';
        label = lost ? `−${lost} 元` : outcome.messages[0];
      }
      if (layers) {
        style = layers > 0 ? 'rise' : 'fall';
        label = `${layers > 0 ? '▲ +' : '▼ −'}${Math.abs(layers)} 層`;
      }
      this.impacts.set(racer, { at: this.time, layers, from: { x, y }, obstacle: source === 'obstacle',
        style, label: source === 'obstacle' ? '碰！' : label });
    }
    return outcome;
  }

  private drawEvent() {
    const candidates = this.lastHarmfulEvent
      ? this.config.events.filter(event => !event.effectIds.some(id => harmful(this.config.effects[id])))
      : this.config.events;
    return weighted(candidates.length ? candidates : this.config.events, this.marketRandom);
  }

  private triggerMarket() {
    const event = this.nextEvent;
    const effects = event.effectIds.map(id => this.config.effects[id]);
    const targets = marketTargets(event.target, this.ranking(), this.targetRandom);
    const showOutcome = effects.some(effect => effect.type === 'cash_loss_or_freeze');
    const outcomes = new Map<string, string[]>();
    const affected = targets.map(racer => {
      racer.marketHits += 1;
      const outcome = this.affect(racer, effects, 'market');
      if (showOutcome) {
        const description = outcome.messages.join('、');
        const names = outcomes.get(description) ?? [];
        names.push(racer.character.name);
        outcomes.set(description, names);
      }
      return outcome.shielded ? `${racer.character.name}（已避險）` : racer.character.name;
    });
    const description = showOutcome
      ? [...outcomes].map(([outcome, names]) => `${names.join('、')}：${outcome}`).join('｜')
      : `${event.description}｜${affected.join('、')}`;
    for (const racer of this.racers) racer.status.revealsEvent = false;

    this.lastHarmfulEvent = effects.some(harmful);
    this.tone = toneOf(effects);
    this.record({ kind: 'market', title: event.title, description, tone: this.tone, icon: event.icon, at: this.time });
    this.marketCount += 1;
    this.nextEventAt += this.config.gameplay.eventIntervalMs;
    this.nextEvent = this.drawEvent();
  }

  private touchesPickup(racer: Racer, pickup: Pickup) {
    const { x, y } = racer.body;
    return Math.abs(x - pickup.x) <= this.config.physics.hitbox.width &&
      y <= pickup.y + 3 && y > pickup.y - 27;
  }

  private pickupBlock(racer: Racer, pickup: Pickup, isRecoveryEligible: boolean) {
    if (pickup.kind === 'recovery' && !isRecoveryEligible) {
      const { recoveryRanks, recoveryGapLayers } = this.config.gameplay;
      return `補給限後 ${recoveryRanks} 名且落後至少 ${recoveryGapLayers} 層`;
    }
    if (pickup.card.trigger === 'on_pickup') return '';
    if (!racer.inventory.includes(null)) return '卡槽已滿';
    return '';
  }

  get pickupHint() {
    const racer = this.player;
    const box = this.pickups.find(item => item.respawnAt === null && this.touchesPickup(racer, item));
    return box ? this.pickupBlock(racer, box, this.canClaimRecovery(racer)) : '';
  }

  private collect() {
    const ranked = this.ranking();
    const recovery = new Set(ranked.filter(racer => this.canClaimRecovery(racer, ranked)));
    for (const pickup of this.pickups) {
      if (pickup.respawnAt !== null) {
        if (this.time < pickup.respawnAt) continue;
        pickup.card = this.drawCard(pickup.kind);
        pickup.respawnAt = null;
      }
      const card = pickup.card;
      const claimants = this.racers
        .filter(racer => this.touchesPickup(racer, pickup) && !this.pickupBlock(racer, pickup, recovery.has(racer)))
        .sort((a, b) => (card.trigger === 'manual' ? Number(recovery.has(b)) - Number(recovery.has(a)) : 0) ||
          Math.abs(a.body.x - pickup.x) - Math.abs(b.body.x - pickup.x) ||
          a.character.id.localeCompare(b.character.id, 'en'));
      const racer = claimants[0];
      if (!racer) continue;

      racer.picked += 1;
      pickup.respawnAt = this.time + this.config.gameplay.cardRespawnMs;
      if (card.trigger === 'manual') {
        racer.inventory[racer.inventory.indexOf(null)] = card;
        this.record({ kind: 'card', title: `${racer.character.name} 取得${card.name}`, description: card.description,
          tone: 'neutral', icon: card.icon, at: this.time });
      } else {
        this.applyCard(racer, racer, card);
      }
    }
  }

  private useCard(racer: Racer, slot: number) {
    const card = racer.inventory[slot];
    if (!card) return;
    const target = card.target === 'self' ? racer : this.nearestAhead(racer);
    if (!target) {
      if (racer.isPlayer) {
        this.record({ kind: 'card', title: '前方沒有可用目標', description: `${card.name}保留在卡片欄。`, tone: 'neutral', icon: card.icon, at: this.time }, true, true);
      }
      return;
    }
    racer.inventory[slot] = null;
    this.applyCard(racer, target, card);
  }

  private nearestAhead(racer: Racer) {
    return this.ranking().reverse().find(other => other.body.y < racer.body.y - 0.01);
  }

  private applyCard(racer: Racer, target: Racer, card: Card) {
    const effects = card.effectIds.map(id => this.config.effects[id]);
    const outcome = this.affect(target, effects, 'card');
    if (racer.isPlayer || target.isPlayer) {
      const impact = this.impacts.get(target)!;
      this.cardCue = { style: impact.style, weight: Math.abs(impact.layers) };
    }
    racer.used += 1;
    const tone = toneOf(effects);
    this.record({
      kind: 'card', title: `${racer.character.name} 使用${card.name}`,
      description: `${target === racer ? '自身' : target.character.name}｜${outcome.messages.join('、')}${
        target !== racer && outcome.layersMoved < 0 ? ' · 慘遭主力狙擊！' : ''}`,
      tone, icon: card.icon, at: this.time
    }, racer.isPlayer || target.isPlayer, true);
  }

  private rivalShouldUse(card: Card, racer: Racer) {
    if (card.target === 'nearest_ahead' && !this.nearestAhead(racer)) return false;
    return card.effectIds.some(id => {
      const effect = this.config.effects[id];
      if (effect.type === 'shield') return racer.status.shield === 0;
      if (effect.type === 'limit_loss') return racer.status.lossLimit === null;
      if (effect.type === 'reveal_next_event') return !racer.status.revealsEvent;
      if (effect.type === 'clear_negative') return racer.status.freezeUntil > this.time ||
        (racer.status.speed < 1 && racer.status.boostUntil > this.time);
      if (effect.type === 'speed_modifier') return racer.status.boostUntil <= this.time;
      return true;
    });
  }

  private updateProgress() {
    const leadLayer = this.track.layerAt(Math.min(...this.racers.map(racer => racer.body.y)));
    for (const racer of this.racers) {
      const height = Math.round(racer.body.y);
      if (height !== racer.lastHeight) {
        racer.lastHeight = height;
        racer.heightAt = this.time;
      }
      const progress = this.track.progress(racer.body.y);
      racer.closes[Math.floor(this.time / 1000)] = progress;
      if (leadLayer - this.track.layerAt(racer.body.y) >= this.config.gameplay.recoveryGapLayers) racer.wasBehind = true;
      if (racer.wasBehind && this.racers.every(other => other === racer || racer.body.y < other.body.y)) {
        racer.comebackAt = this.time;
        racer.wasBehind = false;
      }
      if (progress < racer.highest) racer.trough = Math.min(progress, racer.trough ?? racer.highest);
      if (racer.trough !== null) {
        racer.rebound = Math.max(racer.rebound, progress - racer.trough);
        if (progress >= racer.highest) racer.trough = null;
      }
      racer.highest = Math.max(racer.highest, progress);
      racer.drawdown = Math.max(racer.drawdown, racer.highest - progress);
    }
  }

  private startClosing() {
    if (this.closesAt !== null) return;
    const summit = this.ranking().find(racer => racer.body.platformId === this.track.finish.id);
    if (!summit) return;
    this.firstToSummit = summit;
    this.closesAt = this.time + this.config.gameplay.summitCloseMs;
  }

  private record(bulletin: Bulletin, playerRelated = false, show = bulletin.kind === 'obstacle') {
    this.log.unshift(bulletin);
    this.log.length = Math.min(3, this.log.length);
    if (bulletin.kind === 'market') this.news = bulletin;
    if (show) {
      this.latestNotice = bulletin;
      if (playerRelated) this.playerNotice = bulletin;
    }
  }
}
