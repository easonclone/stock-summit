import type { FinancialConfig } from '../config/financial-settings';
import type { CardAudio, GameSound } from './audio';
import { escapeHtml, money, signedMoney } from './format';
import { missCopy, type FxEvent, type FxPlan, type HitTier } from './fx-events';

/**
 * Plays one settled day's FxPlan on the rendered arena: floats, hit flashes, wealth bars with a lagging damage bar,
 * and short sounds. It only reads the plan; it never touches the run. Everything it adds is removed on dispose, so a
 * re-render can never replay the same damage. Pointer events stay off so the trade button is always usable.
 */
export class ArenaFx {
  private timers: number[] = [];
  private nodes: HTMLElement[] = [];
  private cleanups: (() => void)[] = [];
  playedDay = 0;

  constructor(private readonly config: FinancialConfig, private readonly audio: CardAudio) {}

  dispose() {
    for (const timer of this.timers) window.clearTimeout(timer);
    for (const node of this.nodes) node.remove();
    for (const cleanup of this.cleanups) cleanup();
    this.timers = [];
    this.nodes = [];
    this.cleanups = [];
  }

  /** Plays a plan once per day. With reduced motion, numbers appear at once without movement or particles. */
  play(screen: HTMLElement, plan: FxPlan, playerId: string, reduced: boolean) {
    if (this.playedDay === plan.day) return;
    this.playedDay = plan.day;
    this.dispose();
    const stage = screen.querySelector<HTMLElement>('.arena .stage');
    if (!stage) return;
    const scale = Number(stage.dataset.scale) || 1;
    const view = new View(this, screen, stage, scale, playerId, this.config, reduced);
    if (reduced) {
      view.still(plan);
      return;
    }
    // Mood bubbles wait until the show is over, so 「被打中了！」 never appears before the hit itself.
    stage.classList.add('fx-running');
    this.undo(() => stage.classList.remove('fx-running'));
    this.later(plan.span, () => stage.classList.remove('fx-running'));
    for (const seat of plan.seats) for (const frame of seat.frames) this.later(frame.at, () => view.bar(seat.id, frame.value));
    for (const event of plan.events) this.later(event.at, () => view.event(event));
  }

  later(at: number, action: () => void) {
    this.timers.push(window.setTimeout(action, at));
  }

  keep(node: HTMLElement) {
    this.nodes.push(node);
    return node;
  }

  undo(cleanup: () => void) {
    this.cleanups.push(cleanup);
  }

  sound(style: GameSound, pitch = 1) {
    this.audio.play(style, pitch);
  }
}

const hitLabel: Record<HitTier, string> = { light: '', normal: '', strong: '強力一擊', heavy: '重擊' };
const hitSound: Record<HitTier, GameSound> = { light: 'hit', normal: 'hit', strong: 'hit_strong', heavy: 'hit_heavy' };

class View {
  private rows = new Map<string, number>();
  private values = new Map<string, number>();

  constructor(private readonly fx: ArenaFx, private readonly screen: HTMLElement, private readonly stage: HTMLElement,
    private readonly scale: number, private readonly playerId: string, private readonly config: FinancialConfig, private readonly reduced: boolean) {}

  private fighter(id: string) {
    return this.stage.querySelector<HTMLElement>(`[data-fighter="${id}"]`);
  }

  private layer(id: string) {
    const fighter = this.fighter(id);
    if (!fighter) return null;
    let layer = fighter.querySelector<HTMLElement>(':scope > .fx-layer');
    if (!layer) {
      layer = this.fx.keep(document.createElement('div'));
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      fighter.append(layer);
    }
    return layer;
  }

  private itemName(id: string) {
    return this.config.items.find(card => card.id === id)?.name ?? '';
  }

  /** A float near a fighter. Rows rotate so simultaneous numbers on one fighter never sit on top of each other. */
  private float(id: string, text: string, tone: string, extra = '') {
    const layer = this.layer(id);
    if (!layer) return;
    // The cast label has its own fixed slot above the head, so it never pushes a number up into itself.
    const row = tone === 'cast' ? 0 : this.rows.get(id) ?? 0;
    if (tone !== 'cast') this.rows.set(id, row + 1);
    const node = document.createElement('span');
    node.className = `fx-float ${tone} ${extra} ${this.reduced ? 'fx-still' : ''}`;
    node.style.setProperty('--row', String(this.reduced ? row : row % 3));
    node.style.setProperty('--side', String(row % 2 ? 1 : -1));
    node.innerHTML = text;
    layer.append(node);
    if (!this.reduced) node.addEventListener('animationend', () => node.remove(), { once: true });
  }

  private flash(id: string, kind: string, ms = 240) {
    if (this.reduced) return;
    const layer = this.layer(id);
    const fighter = this.fighter(id);
    if (!layer || !fighter) return;
    const node = document.createElement('span');
    node.className = `fx-flash ${kind}`;
    layer.append(node);
    node.addEventListener('animationend', () => node.remove(), { once: true });
    fighter.classList.add('fx-hit');
    this.fx.later(ms, () => fighter.classList.remove('fx-hit'));
  }

  private particles(id: string, kind: 'burst' | 'shard', count: number) {
    if (this.reduced) return;
    const layer = this.layer(id);
    if (!layer) return;
    for (let index = 0; index < count; index++) {
      const node = document.createElement('i');
      node.className = `fx-${kind}`;
      const angle = (index / count) * Math.PI * 2 + 0.4;
      const reach = kind === 'burst' ? 26 + (index % 3) * 6 : 20 + (index % 2) * 10;
      node.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
      node.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach)}px`);
      layer.append(node);
      node.addEventListener('animationend', () => node.remove(), { once: true });
    }
  }

  private casts = new Set<string>();

  /** The attacker's item lights up once per card, even when one 股市大混戰 hits three rivals. */
  private cast(id: string, itemId: string, at: number) {
    const name = this.itemName(itemId);
    const key = `${id}:${itemId}:${at}`;
    if (!name || this.casts.has(key)) return;
    this.casts.add(key);
    this.float(id, `◆ ${escapeHtml(name)}`, 'cast');
  }

  /** Coins fly from the robbed fighter to the robber; purely decorative, the amounts are in the floats. */
  private coins(from: string, to: string) {
    if (this.reduced) return;
    const source = this.fighter(from);
    const target = this.fighter(to);
    if (!source || !target) return;
    const box = this.stage.getBoundingClientRect();
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    for (let index = 0; index < 5; index++) {
      const coin = this.fx.keep(document.createElement('i'));
      coin.className = 'fx-coin';
      coin.setAttribute('aria-hidden', 'true');
      coin.style.left = `${a.left - box.left + a.width / 2}px`;
      coin.style.top = `${a.top - box.top + a.height * 0.35}px`;
      coin.style.setProperty('--x', `${Math.round(b.left - a.left)}px`);
      coin.style.setProperty('--y', `${Math.round(b.top - a.top)}px`);
      coin.style.animationDelay = `${index * 45}ms`;
      this.stage.append(coin);
      coin.addEventListener('animationend', () => coin.remove(), { once: true });
    }
  }

  /** Instant bar drops at once; the lagging damage bar follows after a short pause. Gains grow behind a light ghost. */
  bar(id: string, value: number) {
    const fighter = this.fighter(id);
    const track = fighter?.querySelector<HTMLElement>('.wealth-track');
    if (!fighter || !track) return;
    const width = `${(100 * Math.max(0, value)) / this.scale}%`;
    const previous = this.values.get(id) ?? Number(track.dataset.start);
    this.values.set(id, value);
    const worth = fighter.querySelector<HTMLElement>('.worth');
    if (worth) worth.textContent = money(value);
    track.classList.toggle('fx-loss', value < previous);
    track.classList.toggle('fx-gain', value > previous);
    if (value < previous) {
      track.style.setProperty('--now', width);
      this.fx.later(380, () => track.style.setProperty('--lag', width));
    } else {
      track.style.setProperty('--lag', width);
      this.fx.later(120, () => track.style.setProperty('--now', width));
    }
  }

  event(event: FxEvent) {
    switch (event.kind) {
      case 'market': {
        const loss = event.amount < 0;
        const label = event.news ? '新聞' : '股市';
        this.float(event.id, `${label} <b>${signedMoney(event.amount)}</b>`, loss ? 'market-loss' : 'market-gain', event.big ? 'big' : '');
        if (!loss && !this.reduced) this.fighter(event.id)?.classList.add('fx-glow');
        if (event.id === this.playerId) this.fx.sound(loss ? 'fall' : 'rise');
        break;
      }
      case 'own':
        this.float(event.id, `${escapeHtml(event.name)} <b>${signedMoney(event.amount)}</b>`, event.amount < 0 ? 'market-loss' : 'cash-gain');
        break;
      case 'defense':
        this.float(event.id, `◆ 格擋 <b>${money(event.amount)}</b>`, 'shield');
        this.flash(event.id, 'shield');
        this.fx.sound('block');
        break;
      case 'jokers':
        this.float(event.id, `★ 王牌 <b>${signedMoney(event.amount)}</b>`, event.amount < 0 ? 'market-loss' : 'joker');
        break;
      case 'joker':
        this.joker(event);
        break;
      case 'attack': {
        this.cast(event.from, event.itemId, event.at);
        const tag = [event.factor > 1 ? `雙重打擊 ×${event.factor}` : '', hitLabel[event.tier]].filter(Boolean).join(' · ');
        this.float(event.to, `${tag ? `<small>${tag}</small>` : ''}<b>${money(-event.amount)}</b>`, 'hit', `tier-${event.tier}`);
        this.flash(event.to, `tier-${event.tier}`);
        if (event.tier === 'strong' || event.tier === 'heavy') this.particles(event.to, 'burst', event.tier === 'heavy' ? 10 : 7);
        if (event.tier === 'heavy') this.quake();
        this.fx.sound(hitSound[event.tier]);
        break;
      }
      case 'shatter':
        this.cast(event.from, event.itemId, event.at);
        this.float(event.to, `<small>破盾</small>${event.amount ? `<b>${money(-event.amount)}</b>` : ''}`, 'hit', `tier-${event.tier} shatter`);
        this.flash(event.to, 'shatter');
        this.particles(event.to, 'shard', 8);
        this.fx.sound('shatter');
        break;
      case 'raid':
        this.cast(event.from, event.itemId, event.at);
        this.float(event.to, `<small>現金被搶</small><b>${money(-event.amount)}</b>`, 'hit', `tier-${event.tier}`);
        this.flash(event.to, `tier-${event.tier}`);
        this.coins(event.to, event.from);
        this.fx.later(this.reduced ? 0 : 260, () => this.float(event.from, `<small>搶到現金</small><b>+${money(event.amount)}</b>`, 'cash-gain'));
        this.fx.sound('coin');
        break;
      case 'reflect':
        this.flash(event.owner, 'mirror', 200);
        this.float(event.hit, `<small>反擊鏡</small><b>${money(-event.amount)}</b>`, 'reflect');
        this.flash(event.hit, 'tier-normal');
        if (event.cash) this.float(event.owner, `<small>拿回</small><b>+${money(event.amount)}</b>`, 'cash-gain');
        this.fx.sound('counter');
        break;
      case 'miss':
        this.float(event.to, `未命中 · ${missCopy[event.reason]}`, 'miss');
        if (event.from === this.playerId) this.fx.sound('blip');
        break;
      case 'rank': {
        const rank = this.fighter(event.id)?.querySelector<HTMLElement>('.plate .rank');
        if (rank && !this.reduced) {
          rank.classList.add('fx-rank');
          this.fx.later(400, () => rank.classList.remove('fx-rank'));
        }
        if (event.id === this.playerId) this.fx.sound('overtake');
        break;
      }
    }
  }

  private combo: HTMLElement | null = null;

  /** The player's jokers light up in order with their real payouts, a rising pitch and a running total. */
  private joker(event: Extract<FxEvent, { kind: 'joker' }>) {
    const card = this.screen.querySelector<HTMLElement>(`.joker-row [data-joker-id="${event.jokerId}"]`);
    if (card) {
      card.classList.add('fx-fire');
      card.querySelector('.joker-payout')?.classList.remove('fx-wait');
      this.fx.later(200, () => card.classList.remove('fx-fire'));
    }
    if (!this.combo) {
      const layer = this.layer(this.playerId);
      if (layer) {
        this.combo = document.createElement('span');
        this.combo.className = 'fx-combo';
        layer.append(this.combo);
      }
    }
    if (this.combo) {
      this.combo.innerHTML = `★ 王牌${event.count > 1 ? ` ×${event.count}` : ''} <b>${signedMoney(event.total)}</b>`;
      this.combo.classList.remove('bump');
      void this.combo.offsetWidth;
      this.combo.classList.add('bump');
    }
    this.fx.sound(event.count > 1 ? 'chain' : 'joker', 2 ** (Math.min(event.index, 7) / 6));
  }

  private quake() {
    this.stage.classList.add('fx-quake');
    this.fx.later(220, () => this.stage.classList.remove('fx-quake'));
  }

  /** Reduced motion: every number at once, no flashes, coins or shakes; bars are already at the close. */
  still(plan: FxPlan) {
    for (const event of plan.events) {
      if (event.kind === 'joker') {
        this.screen.querySelector(`.joker-row [data-joker-id="${event.jokerId}"] .joker-payout`)?.classList.remove('fx-wait');
        continue;
      }
      if (event.kind === 'market' || event.kind === 'own' || event.kind === 'jokers' || event.kind === 'rank') continue;
      this.event(event);
    }
  }
}
