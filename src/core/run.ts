import type { Card, Character, Config, Difficulty, Effect, MarketEvent, PixelIcon, Tone } from '../config/settings';
import { applyEffects, freshEffects, harmful, toneOf, type EffectSource, type EffectState } from './effects';
import { Track, type Body } from './movement';
import { generateNodeMap, type NodeMap, type RouteNode } from './node-map';
import { seededRandom, weighted, type Random } from './random';
import { marketTargets } from './targets';

export interface Racer {
  character: Character;
  isPlayer: boolean;
  body: Body;
  status: EffectState;
  inventory: (Card | null)[];
  cash: number;
  /** Current node, or null before the first turn. */
  node: RouteNode | null;
  /** Nodes entered so far, one per resolved turn. */
  path: RouteNode[];
  /** Layer reached after each turn; index 0 is the start. */
  closes: number[];
  highest: number;
  drawdown: number;
  trough: number | null;
  rebound: number;
  used: number;
  marketHits: number;
  shielded: number;
}

export interface Bulletin {
  kind: 'market' | 'card' | 'node';
  icon: PixelIcon;
  title: string;
  description: string;
  tone: Tone;
  at: number;
}

export interface RunOptions {
  playerId: string;
  seed: number;
  difficulty: Difficulty;
}

export type CardFx = 'rise' | 'fall' | 'shield' | 'speed' | 'intel' | 'guard' | 'clear' | 'freeze' | 'flat';

export interface Impact {
  at: number;
  from: { x: number; y: number };
  layers: number;
  style: CardFx;
  label: string;
}

const effectCue: Record<Effect['type'], { style: CardFx; label: string }> = {
  displacement: { style: 'flat', label: '持平' },
  momentum: { style: 'speed', label: '動能' },
  freeze: { style: 'freeze', label: '停牌' },
  cash_loss_or_freeze: { style: 'freeze', label: '流動性危機' },
  cash_gain: { style: 'rise', label: '入帳' },
  exposure: { style: 'speed', label: '槓桿' },
  shield: { style: 'shield', label: '避險 +1' },
  reveal_next_event: { style: 'intel', label: '取得預告' },
  limit_loss: { style: 'guard', label: '設定停損' },
  clear_negative: { style: 'clear', label: '狀態清除' }
};

/**
 * A turn-based round. Each turn every racer picks one node in the next row of the shared route map; moves resolve
 * together, a fictional market event fires every `eventEvery` turns, and after `turns` turns the round closes.
 * The final score is the layer reached plus the weighted cash bonus.
 */
export class Run {
  readonly track: Track;
  readonly map: NodeMap;
  readonly racers: Racer[];
  readonly player: Racer;
  readonly log: Bulletin[] = [];
  readonly impacts = new Map<Racer, Impact>();
  /** Turns resolved so far; also the row the next choice is made in. */
  turn = 0;
  /** Animation clock in ms, advanced by the view. */
  time = 0;
  tone: Tone = 'neutral';
  news: Bulletin | null = null;
  cardCue: { style: CardFx; weight: number } | null = null;
  result: 'closed' | null = null;
  winner: Racer | null = null;
  marketCount = 0;
  /** The player's pending pick for this turn, as a lane in row `turn`. */
  selected: number | null = null;
  private notice: Bulletin | null = null;
  private nextEvent: MarketEvent;
  private lastHarmfulEvent = false;
  private readonly marketRandom: Random;
  private readonly targetRandom: Random;
  private readonly cardRandom: Random;
  private readonly rivals = new Map<Racer, Random>();

  constructor(readonly config: Config, readonly options: RunOptions) {
    this.track = new Track(config.map);
    this.map = generateNodeMap(config, options.seed);
    this.marketRandom = seededRandom(options.seed);
    this.targetRandom = seededRandom(options.seed ^ 0x77de6451);
    this.cardRandom = seededRandom(options.seed ^ 0xa3fe014d);
    this.nextEvent = this.drawEvent();

    const characters = [...config.characters].sort((first, second) =>
      Number(second.id === options.playerId) - Number(first.id === options.playerId));
    if (characters[0].id !== options.playerId) throw new Error('找不到選擇的角色');
    this.racers = characters.map((character, index): Racer => ({
      character, isPlayer: index === 0,
      body: { ...config.map.spawnPoints[index], velocityY: 0, platformId: this.track.floor.id, ladderId: null, facing: 1, motion: 'idle' },
      status: freshEffects(), cash: 0, node: null, path: [],
      inventory: Array.from({ length: config.gameplay.inventorySize }, () => null),
      closes: [0], highest: 0, drawdown: 0, trough: null, rebound: 0, used: 0, marketHits: 0, shielded: 0
    }));
    this.player = this.racers[0];
    for (const [index, racer] of this.racers.entries()) {
      if (!racer.isPlayer) this.rivals.set(racer, seededRandom(options.seed ^ Math.imul(index, 0x9e3779b9)));
    }
  }

  get turns() { return this.config.gameplay.turns; }

  layer(racer: Racer) { return this.track.layerAt(racer.body.y); }

  /** Lanes of row `turn` the racer can enter. */
  reachable(racer: Racer) {
    if (this.result) return [];
    return racer.node ? racer.node.next : this.map.rows[0].map(node => node.lane);
  }

  select(lane: number) {
    if (this.result || !this.reachable(this.player).includes(lane)) return false;
    this.selected = lane;
    return true;
  }

  score(racer: Racer) {
    const layers = this.layer(racer);
    const { layersPerHundred, bonusCap } = this.config.cash;
    const bonus = Math.round(Math.min(bonusCap, racer.cash * layersPerHundred / 100) * 100) / 100;
    return { layers, bonus, total: Math.round((layers + bonus) * 100) / 100 };
  }

  ranking() {
    return [...this.racers].sort((a, b) => this.score(b).total - this.score(a).total || this.layer(b) - this.layer(a) ||
      a.character.id.localeCompare(b.character.id, 'en'));
  }

  get forecast() {
    return this.player.status.revealsEvent ? this.nextEvent : null;
  }

  get eventIn() {
    const every = this.config.gameplay.eventEvery;
    return every - (this.turn % every);
  }

  get latestNotice() {
    return this.notice && this.time - this.notice.at < this.config.gameplay.cardNewsMs ? this.notice : null;
  }

  canClaimRecovery(racer: Racer, ranked = this.ranking()) {
    return ranked.indexOf(racer) >= ranked.length - this.config.gameplay.recoveryRanks &&
      this.layer(ranked[0]) - this.layer(racer) >= this.config.gameplay.recoveryGapLayers;
  }

  isFrozen(racer: Racer) {
    return racer.status.freezeUntil > this.turn;
  }

  tick(ms: number) {
    this.time += ms;
  }

  usePlayerCard(slot: number) {
    if (this.result) return false;
    return this.useCard(this.player, slot);
  }

  /** Resolves one turn with the player's selected lane. Returns false when no valid lane is selected. */
  resolve() {
    if (this.result || this.selected === null || !this.reachable(this.player).includes(this.selected)) return false;
    for (const [racer, random] of this.rivals) {
      if (random() < this.config.npc.cardUseChance[this.options.difficulty]) {
        const slot = racer.inventory.findIndex(card => card && this.rivalShouldUse(card, racer));
        if (slot >= 0) this.useCard(racer, slot);
      }
    }
    const picks = new Map<Racer, number>(this.racers.map(racer =>
      [racer, racer.isPlayer ? this.selected! : this.rivalPick(racer, this.rivals.get(racer)!)]));
    const ranked = this.ranking();
    for (const racer of this.racers) this.enter(racer, this.map.rows[this.turn][picks.get(racer)!], ranked);
    this.turn += 1;
    this.selected = null;
    if (this.turn % this.config.gameplay.eventEvery === 0) this.triggerMarket();
    this.updateProgress();
    if (this.turn >= this.turns) {
      this.result = 'closed';
      this.winner = this.ranking()[0];
    }
    return true;
  }

  private enter(racer: Racer, node: RouteNode, ranked: Racer[]) {
    racer.node = node;
    racer.path.push(node);
    const kind = this.config.nodes.kinds[node.kind];
    if (this.isFrozen(racer)) {
      this.record({ kind: 'node', title: `${racer.character.name}停牌中`, description: `${kind.name}本回合無效`,
        tone: 'negative', icon: 'halt', at: this.time }, racer.isPlayer);
      return;
    }
    const effects = kind.effectIds.map(id => this.config.effects[id]);
    if (racer.status.momentumUntil > this.turn && effects.some(effect => effect.type === 'displacement' && effect.layers > 0)) {
      effects.push({ type: 'displacement', layers: racer.status.momentum });
    }
    const outcome = this.affect(racer, effects, 'node');
    const messages = [...outcome.messages];
    if (kind.draw === 'public' || (kind.draw === 'recovery' && this.canClaimRecovery(racer, ranked))) {
      messages.push(this.draw(racer, kind.draw));
    }
    if (racer.isPlayer) {
      this.record({ kind: 'node', title: `${racer.character.name}走${kind.name}`, description: messages.join('、'),
        tone: toneOf(effects), icon: kind.icon, at: this.time }, true);
    }
  }

  private draw(racer: Racer, pool: 'public' | 'recovery') {
    const cards = this.config.cards.filter(card => card.pool === 'both' || card.pool === pool);
    const card = weighted(cards, this.cardRandom);
    if (card.trigger === 'on_pickup') {
      this.applyCard(racer, racer, card);
      return `抽到${card.name}`;
    }
    const slot = racer.inventory.indexOf(null);
    if (slot < 0) return `抽到${card.name}，但卡槽已滿`;
    racer.inventory[slot] = card;
    return `取得${card.name}`;
  }

  private affect(racer: Racer, effects: Effect[], source: EffectSource) {
    const { x, y } = racer.body;
    const outcome = applyEffects(racer, effects, this.track, this.turn, source);
    if (outcome.shielded) racer.shielded += 1;
    const effect = effects[0];
    let { style, label } = effectCue[effect.type];
    if (effect.type === 'shield') label = `避險 +${effect.charges}`;
    if (effect.type === 'limit_loss') label = `下滑 ≤ ${effect.layers} 層`;
    if (effect.type === 'clear_negative') label = outcome.messages[0];
    if (outcome.cashChange) {
      style = outcome.cashChange > 0 ? 'rise' : 'fall';
      label = `${outcome.cashChange > 0 ? '+' : '−'}${Math.abs(outcome.cashChange)} 元`;
    }
    if (outcome.layersMoved) {
      style = outcome.layersMoved > 0 ? 'rise' : 'fall';
      label = `${outcome.layersMoved > 0 ? '▲ +' : '▼ −'}${Math.abs(outcome.layersMoved)} 層`;
    }
    if (outcome.shielded) {
      style = 'shield';
      label = '避險成功';
    }
    this.impacts.set(racer, { at: this.time, layers: outcome.layersMoved, from: { x, y }, style, label });
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
    const outcomes = targets.map(racer => {
      racer.marketHits += 1;
      return `${racer.character.name}：${this.affect(racer, effects, 'market').messages.join('、')}`;
    });
    for (const racer of this.racers) racer.status.revealsEvent = false;
    this.lastHarmfulEvent = effects.some(harmful);
    this.tone = toneOf(effects);
    const bulletin: Bulletin = { kind: 'market', title: event.title, description: outcomes.join('｜'), tone: this.tone,
      icon: event.icon, at: this.time };
    this.news = bulletin;
    this.record(bulletin, targets.includes(this.player));
    this.marketCount += 1;
    this.nextEvent = this.drawEvent();
  }

  private useCard(racer: Racer, slot: number) {
    const card = racer.inventory[slot];
    if (!card) return false;
    const target = card.target === 'self' ? racer : this.nearestAhead(racer);
    if (!target) {
      if (racer.isPlayer) {
        this.record({ kind: 'card', title: '前方沒有可用目標', description: `${card.name}保留在卡片欄。`, tone: 'neutral',
          icon: card.icon, at: this.time }, true);
      }
      return false;
    }
    racer.inventory[slot] = null;
    this.applyCard(racer, target, card);
    return true;
  }

  private nearestAhead(racer: Racer) {
    return this.ranking().reverse().find(other => this.layer(other) > this.layer(racer));
  }

  private applyCard(racer: Racer, target: Racer, card: Card) {
    const effects = card.effectIds.map(id => this.config.effects[id]);
    const outcome = this.affect(target, effects, 'card');
    if (racer.isPlayer || target.isPlayer) {
      const impact = this.impacts.get(target)!;
      this.cardCue = { style: impact.style, weight: Math.abs(impact.layers) };
    }
    racer.used += 1;
    this.record({
      kind: 'card', title: `${racer.character.name} 使用${card.name}`,
      description: `${target === racer ? '自身' : target.character.name}｜${outcome.messages.join('、')}${
        target !== racer && outcome.layersMoved < 0 ? ' · 慘遭主力狙擊！' : ''}`,
      tone: toneOf(effects), icon: card.icon, at: this.time
    }, racer.isPlayer || target.isPlayer);
  }

  private rivalShouldUse(card: Card, racer: Racer) {
    if (card.target === 'nearest_ahead' && !this.nearestAhead(racer)) return false;
    return card.effectIds.some(id => {
      const effect = this.config.effects[id];
      if (effect.type === 'shield') return racer.status.shield === 0;
      if (effect.type === 'limit_loss') return racer.status.lossLimit === null;
      if (effect.type === 'reveal_next_event') return !racer.status.revealsEvent && this.eventIn === 1;
      if (effect.type === 'clear_negative') return this.isFrozen(racer);
      if (effect.type === 'momentum') return racer.status.momentumUntil <= this.turn;
      return true;
    });
  }

  /** Score estimate of entering a node: layers, weighted cash, card and intel value, minus leverage risk. */
  nodeValue(racer: Racer, node: RouteNode) {
    const npc = this.config.npc;
    const kind = this.config.nodes.kinds[node.kind];
    let value = 0;
    for (const id of kind.effectIds) {
      const effect = this.config.effects[id];
      if (effect.type === 'displacement') value += effect.layers + (effect.layers > 0 && racer.status.momentumUntil > this.turn ? racer.status.momentum : 0);
      if (effect.type === 'cash_gain' && this.score(racer).bonus < this.config.cash.bonusCap) value += effect.amount * this.config.cash.layersPerHundred / 100;
      if (effect.type === 'reveal_next_event') value += npc.intelValue;
      if (effect.type === 'shield') value += npc.shieldValue;
      if (effect.type === 'exposure' && racer.status.shield === 0) value -= npc.exposurePenalty;
    }
    const hasRoom = racer.inventory.includes(null);
    if (kind.draw === 'public' && hasRoom) value += npc.cardValue;
    if (kind.draw === 'recovery' && hasRoom && this.canClaimRecovery(racer)) value += npc.cardValue * 1.5;
    return value;
  }

  private rivalPick(racer: Racer, random: Random) {
    const npc = this.config.npc;
    const noise = npc.choiceNoise[this.options.difficulty];
    const row = this.map.rows[this.turn];
    let best = this.reachable(racer)[0];
    let bestScore = -Infinity;
    for (const lane of this.reachable(racer)) {
      const node = row[lane];
      const ahead = node.next.map(next => this.nodeValue(racer, this.map.rows[this.turn + 1][next]));
      const score = this.nodeValue(racer, node) + npc.lookahead * Math.max(0, ...ahead) + random() * noise;
      if (score > bestScore) {
        best = lane;
        bestScore = score;
      }
    }
    return best;
  }

  private updateProgress() {
    for (const racer of this.racers) {
      const layer = this.layer(racer);
      racer.closes[this.turn] = layer;
      if (layer < racer.highest) racer.trough = Math.min(layer, racer.trough ?? racer.highest);
      if (racer.trough !== null) {
        racer.rebound = Math.max(racer.rebound, layer - racer.trough);
        if (layer >= racer.highest) racer.trough = null;
      }
      racer.highest = Math.max(racer.highest, layer);
      racer.drawdown = Math.max(racer.drawdown, racer.highest - layer);
    }
  }

  private record(bulletin: Bulletin, playerRelated = false) {
    this.log.unshift(bulletin);
    this.log.length = Math.min(4, this.log.length);
    if (playerRelated || bulletin.kind === 'market') this.notice = bulletin;
  }
}
