import type { AllocationOption, FinanceEffect, FinancialConfig, GameCard, TradingEvent } from '../config/financial-settings';
import { copyPortfolio, netWorth, rebalance, type Portfolio, type Rebalance } from './economy';

export type Tone = 'positive' | 'negative' | 'neutral';

/** A defensive item waiting for the next day the holder's stock loses money. */
export interface Defense { itemId: string; name: string; mode: 'cut' | 'absorb' | 'reverse'; amount: number }

/** Per-investor history the jokers read. Updated only at the close. */
export interface Memory {
  /** The holder's own stock move rate yesterday (market plus any news that hit them); null before day 1. */
  lastRate: number | null;
  lastStockPnl: number;
  /** Consecutive days, up to yesterday, on which the holder's stock made money. */
  winStreak: number;
  /** Consecutive closes with stock held, including today once closed. */
  holdDays: number;
  holdPaid: boolean;
  climbPaid: boolean;
  reliefUsed: boolean;
}

export interface Holder {
  account: Portfolio;
  jokers: GameCard[];
  items: GameCard[];
  defenses: Defense[];
  /** Direction of an upcoming news day learned from a 小道消息 item. Never the exact rate. */
  intel: { day: number; tone: Tone } | null;
  memory: Memory;
}

export type StepSource = 'market' | 'news' | 'joker' | 'item' | 'defense' | 'attack' | 'event' | 'cap';
export type StepKind = 'base' | 'add' | 'mult' | 'cut' | 'cash' | 'cap';

/**
 * One line of the settlement chain. The amounts of all steps of a day add up exactly to the change in total worth
 * (before any restart after hitting zero), so the presentation can replay the chain without recalculating.
 */
export interface ChainStep { source: StepSource; id: string; name: string; kind: StepKind; value?: number; amount: number }

export type ItemBlock = 'no_stock' | 'full_defense' | 'no_news' | 'known_news' | 'no_target' | 'not_low' | 'used' | 'last_day';

export interface DayContext {
  config: FinancialConfig;
  day: number;
  allocation: AllocationOption;
  /** The shared daily stock move every investor gets. */
  marketRate: number;
  /** Today's news, its realised rate, and whether it reaches this investor. */
  news: { event: TradingEvent; rate: number; applies: boolean } | null;
  /** Next news day after today: the one 小道消息 would reveal. Null when no news is left. */
  nextNewsDay: number | null;
  /** Whether a rival ranks ahead at the open, i.e. 主力狙擊 has a target. */
  hasTarget: boolean;
}

export interface DayLedger {
  rebalance: Rebalance | null;
  steps: ChainStep[];
  /** Stock held when the market opened, after rebalancing and instant items. */
  exposure: { stock: number; cash: number };
  /** The holder's own stock move rate today (shared market plus news that reached them). */
  rate: number;
  marketPnl: number;
  newsPnl: number;
  /** Stock result before jokers, items and defenses. */
  stockBase: number;
  /** Stock result after jokers, items and defenses; excludes rival attacks. */
  stockFinal: number;
  /** Loss avoided by loss cuts and defenses. */
  shielded: number;
  /** Joker and item boosts that fired today, for combo feedback. */
  combos: number;
  capped: boolean;
  itemUsed: boolean;
  defenseUsed: Defense | null;
  requests: { intel: boolean; pack: number; attack: number; items: number };
  attackLoss: number;
}

interface Mod { source: StepSource; id: string; name: string; value: number }

const effectsOf = (config: FinancialConfig, card: { effectIds: readonly string[] }) => card.effectIds.map(id => config.effects[id]);

function jokerEffects(holder: Holder, config: FinancialConfig) {
  return holder.jokers.flatMap(joker => effectsOf(config, joker).map(effect => ({ joker, effect })));
}

export function newMemory(): Memory {
  return { lastRate: null, lastStockPnl: 0, winStreak: 0, holdDays: 0, holdPaid: false, climbPaid: false, reliefUsed: false };
}

export function copyHolder(holder: Holder): Holder {
  return {
    account: copyPortfolio(holder.account), jokers: [...holder.jokers], items: [...holder.items],
    defenses: holder.defenses.map(item => ({ ...item })), intel: holder.intel ? { ...holder.intel } : null, memory: { ...holder.memory }
  };
}

export function priceEffect(config: FinancialConfig, event: Pick<TradingEvent, 'effectIds'>) {
  const effect = event.effectIds.map(id => config.effects[id]).find(item => item.type === 'price');
  return effect?.type === 'price' ? effect : null;
}

/** 利多、利空，或沒有股價變動的特殊事件。 */
export function marketTone(event: Pick<TradingEvent, 'effectIds'>, config: FinancialConfig): Tone {
  const price = priceEffect(config, event);
  if (!price) return 'neutral';
  const middle = price.floor + price.ceiling;
  return middle > 0 ? 'positive' : middle < 0 ? 'negative' : 'neutral';
}

export function rateFrom(effect: { floor: number; ceiling: number }, draw: number) {
  return effect.floor + (effect.ceiling - effect.floor) * draw;
}

function newLedger(): DayLedger {
  return {
    rebalance: null, steps: [], exposure: { stock: 0, cash: 0 }, rate: 0, marketPnl: 0, newsPnl: 0, stockBase: 0, stockFinal: 0,
    shielded: 0, combos: 0, capped: false, itemUsed: false, defenseUsed: null,
    requests: { intel: false, pack: 0, attack: 0, items: 0 }, attackLoss: 0
  };
}

function addCash(holder: Holder, ledger: DayLedger, step: Omit<ChainStep, 'amount' | 'kind'> & { kind?: StepKind }, amount: number) {
  if (!amount) return;
  holder.account.cash += amount;
  holder.account.stats.cashYield += amount;
  ledger.steps.push({ kind: 'cash', ...step, amount });
}

/** Why an item cannot be used today with the chosen stock ratio, or null when it can. */
export function itemBlock(holder: Holder, item: GameCard, context: DayContext): ItemBlock | null {
  const worth = Math.max(0, netWorth(holder.account));
  const plannedStock = Math.floor(worth * context.allocation.ratio);
  for (const effect of effectsOf(context.config, item)) {
    switch (effect.type) {
      case 'today_add':
      case 'today_mult':
      case 'stock_cash':
        if (plannedStock <= 0) return 'no_stock';
        break;
      case 'defense':
        if (holder.defenses.length >= context.config.financial.maxDefenses) return 'full_defense';
        break;
      case 'intel':
        if (context.nextNewsDay === null) return 'no_news';
        if (holder.intel?.day === context.nextNewsDay) return 'known_news';
        break;
      case 'attack':
        if (!context.hasTarget) return 'no_target';
        break;
      case 'relief':
        if (holder.memory.reliefUsed) return 'used';
        if (worth >= effect.below) return 'not_low';
        break;
      case 'item_pack':
        if (context.day >= context.config.gameplay.turns) return 'last_day';
        break;
      default:
        break;
    }
  }
  return null;
}

function applyItem(holder: Holder, item: GameCard, effect: FinanceEffect, ledger: DayLedger, boosts: { add: Mod[]; mult: Mod[] }) {
  const source = { source: 'item' as const, id: item.id, name: item.name };
  switch (effect.type) {
    case 'cash_grant': addCash(holder, ledger, source, effect.amount); break;
    case 'stock_cash': addCash(holder, ledger, source, Math.round(holder.account.investmentValue * effect.rate)); break;
    case 'relief':
      holder.memory.reliefUsed = true;
      addCash(holder, ledger, source, effect.amount);
      break;
    case 'today_add': boosts.add.push({ ...source, value: effect.amount }); break;
    case 'today_mult': boosts.mult.push({ ...source, value: effect.factor }); break;
    case 'defense': holder.defenses.push({ itemId: item.id, name: item.name, mode: effect.mode, amount: effect.amount }); break;
    case 'intel': ledger.requests.intel = true; break;
    case 'item_pack': ledger.requests.pack = effect.count; break;
    case 'attack': ledger.requests.attack = effect.amount; break;
    default: break;
  }
}

/**
 * Today's locked action for one investor, in rule order:
 * rebalance → instant item → shared market and news → joker/item boosts on the stock result → defenses.
 * Rival attacks and flat cash income follow in {@link applyAttack} and {@link closeDay}.
 */
export function tradeDay(holder: Holder, item: GameCard | null, context: DayContext): DayLedger {
  const { config } = context;
  const { account } = holder;
  const ledger = newLedger();
  ledger.rebalance = rebalance(account, context.allocation.ratio);
  const boosts = { add: [] as Mod[], mult: [] as Mod[] };
  if (item) {
    ledger.itemUsed = true;
    for (const effect of effectsOf(config, item)) applyItem(holder, item, effect, ledger, boosts);
  }
  if (context.news?.applies) {
    const event = context.news.event;
    for (const effect of effectsOf(config, event)) {
      if (effect.type === 'cash_grant') addCash(holder, ledger, { source: 'event', id: event.id, name: event.title }, effect.amount);
      if (effect.type === 'item_grant') ledger.requests.items += effect.count;
    }
  }
  const stock = account.investmentValue;
  ledger.exposure = { stock, cash: account.cash };
  const newsRate = context.news?.applies ? context.news.rate : 0;
  ledger.rate = context.marketRate + newsRate;
  const marketPnl = Math.max(-stock, Math.round(stock * context.marketRate));
  const base = Math.max(-stock, marketPnl + Math.round(stock * newsRate));
  ledger.marketPnl = marketPnl;
  ledger.newsPnl = base - marketPnl;
  ledger.stockBase = base;
  if (marketPnl) ledger.steps.push({ source: 'market', id: 'market', name: '今日股市', kind: 'base', value: context.marketRate, amount: marketPnl });
  if (base - marketPnl && context.news) {
    ledger.steps.push({ source: 'news', id: context.news.event.id, name: context.news.event.title, kind: 'base', value: newsRate, amount: base - marketPnl });
  }
  const jokers = jokerEffects(holder, config);
  const memory = holder.memory;
  const record = (mod: Mod, kind: StepKind, amount: number) => {
    if (!amount) return;
    ledger.steps.push({ source: mod.source, id: mod.id, name: mod.name, kind, value: mod.value, amount });
    ledger.combos += 1;
  };
  let value = base;
  if (base > 0) {
    const adds: Mod[] = [];
    for (const { joker, effect } of jokers) {
      const mod = { source: 'joker' as const, id: joker.id, name: joker.name };
      if (effect.type === 'gain_add') adds.push({ ...mod, value: effect.amount });
      if (effect.type === 'streak_add' && memory.winStreak > 0) adds.push({ ...mod, value: Math.min(effect.cap, effect.step * memory.winStreak) });
      if (effect.type === 'rebound_add' && memory.lastRate !== null && memory.lastRate < 0) adds.push({ ...mod, value: effect.amount });
      if (effect.type === 'joker_add' && holder.jokers.length > 1) adds.push({ ...mod, value: effect.amount * (holder.jokers.length - 1) });
    }
    // Percentage bonuses are added together first, all on the base result.
    for (const mod of [...adds, ...boosts.add]) {
      const amount = Math.round(base * mod.value);
      value += amount;
      record(mod, 'add', amount);
    }
    const mults: Mod[] = [];
    for (const { joker, effect } of jokers) {
      const mod = { source: 'joker' as const, id: joker.id, name: joker.name };
      if (effect.type === 'news_mult' && context.news?.applies && newsRate > 0 && effect.categories.includes(context.news.event.category)) {
        mults.push({ ...mod, value: effect.factor });
      }
      if (effect.type === 'repeat_mult' && memory.lastStockPnl > 0) mults.push({ ...mod, value: effect.factor });
      if (effect.type === 'swing_mult') mults.push({ ...mod, value: effect.factor });
    }
    // Then the special multipliers, one after another.
    for (const mod of [...mults, ...boosts.mult]) {
      const next = Math.round(value * mod.value);
      record(mod, 'mult', next - value);
      value = next;
    }
    const cap = Math.round(base * config.settlement.maxGainMultiplier);
    if (value > cap) {
      ledger.steps.push({ source: 'cap', id: 'cap', name: '倍率上限', kind: 'cap', value: config.settlement.maxGainMultiplier, amount: cap - value });
      ledger.capped = true;
      value = cap;
    }
  } else if (base < 0) {
    const amplifiers: Mod[] = [];
    for (const { joker, effect } of jokers) {
      if (effect.type === 'swing_mult') amplifiers.push({ source: 'joker', id: joker.id, name: joker.name, value: effect.factor });
    }
    for (const mod of [...amplifiers, ...boosts.mult]) {
      const next = Math.max(-stock, Math.round(value * mod.value));
      record(mod, 'mult', next - value);
      value = next;
    }
    const loss = -value;
    let room = config.settlement.maxLossCut;
    const cuts: Mod[] = jokers.flatMap(({ joker, effect }) => effect.type === 'loss_cut'
      ? [{ source: 'joker' as const, id: joker.id, name: joker.name, value: effect.amount }] : []);
    const defense = holder.defenses.shift() ?? null;
    if (defense?.mode === 'cut') cuts.push({ source: 'defense', id: defense.itemId, name: defense.name, value: defense.amount });
    for (const mod of cuts) {
      const share = Math.min(room, mod.value);
      room -= share;
      const saved = Math.round(loss * share);
      value += saved;
      ledger.shielded += saved;
      record(mod, 'cut', saved);
    }
    if (defense?.mode === 'absorb') {
      const saved = Math.min(-value, defense.amount);
      value += saved;
      ledger.shielded += saved;
      record({ source: 'defense', id: defense.itemId, name: defense.name, value: defense.amount }, 'cut', saved);
    }
    if (defense?.mode === 'reverse') {
      const flipped = Math.min(-value, defense.amount);
      const saved = flipped - value;
      ledger.shielded += -value;
      value = flipped;
      record({ source: 'defense', id: defense.itemId, name: defense.name, value: defense.amount }, 'cut', saved);
    }
    ledger.defenseUsed = defense;
  }
  account.investmentValue += value;
  account.stats.investmentPnl += value;
  ledger.stockFinal = value;
  return ledger;
}

/** A rival's 主力狙擊: the target's stock falls by `rate`. Not amplified or shielded. Returns the loss. */
export function applyAttack(holder: Holder, rate: number, from: { id: string; name: string }, ledger: DayLedger) {
  const loss = Math.round(holder.account.investmentValue * rate);
  if (!loss) return 0;
  holder.account.investmentValue -= loss;
  holder.account.stats.investmentPnl -= loss;
  ledger.attackLoss += loss;
  ledger.steps.push({ source: 'attack', id: from.id, name: from.name, kind: 'base', value: rate, amount: -loss });
  return loss;
}

/** Flat cash from jokers, settled last and never multiplied; then the holder's memory moves to tomorrow. */
export function closeDay(holder: Holder, context: DayContext, ledger: DayLedger, attackLanded = false) {
  const { config } = context;
  const { account } = holder;
  const memory = holder.memory;
  memory.holdDays = account.investmentValue > 0 ? memory.holdDays + 1 : 0;
  const jokers = jokerEffects(holder, config);
  const boost = jokers.reduce((product, { effect }) => effect.type === 'yield_boost' ? product * effect.factor : product, 1);
  const booster = jokers.find(({ effect }) => effect.type === 'yield_boost')?.joker;
  for (const { joker, effect } of jokers) {
    const source = { source: 'joker' as const, id: joker.id, name: joker.name };
    switch (effect.type) {
      case 'cash_yield': {
        if (netWorth(account) <= 0) break;
        const income = Math.min(effect.cap, Math.round(account.cash * effect.rate));
        addCash(holder, ledger, { ...source, value: effect.rate }, income);
        if (booster && income) addCash(holder, ledger, { source: 'joker', id: booster.id, name: booster.name, kind: 'mult', value: boost }, Math.round(income * (boost - 1)));
        break;
      }
      case 'stock_yield':
        addCash(holder, ledger, { ...source, value: effect.rate }, Math.min(effect.cap, Math.round(account.investmentValue * effect.rate)));
        break;
      case 'bear_bonus':
        if (ledger.exposure.stock <= 0 && ledger.rate < 0) addCash(holder, ledger, source, effect.amount);
        break;
      case 'item_bonus':
        if (ledger.itemUsed) addCash(holder, ledger, source, effect.amount);
        break;
      case 'attack_bonus':
        if (attackLanded) addCash(holder, ledger, source, effect.amount);
        break;
      case 'hold_bonus':
        if (!memory.holdPaid && memory.holdDays >= effect.days) {
          memory.holdPaid = true;
          addCash(holder, ledger, source, effect.amount);
        }
        break;
      default: break;
    }
  }
  memory.lastRate = ledger.rate;
  memory.lastStockPnl = ledger.stockFinal;
  memory.winStreak = ledger.stockFinal > 0 ? memory.winStreak + 1 : 0;
}

/** 逆風飛翔: paid once, the first close the holder leaves last place. */
export function climbBonus(holder: Holder, config: FinancialConfig, ledger: DayLedger, leftLast: boolean) {
  if (!leftLast || holder.memory.climbPaid) return 0;
  const joker = jokerEffects(holder, config).find(({ effect }) => effect.type === 'climb_bonus');
  if (!joker || joker.effect.type !== 'climb_bonus') return 0;
  holder.memory.climbPaid = true;
  addCash(holder, ledger, { source: 'joker', id: joker.joker.id, name: joker.joker.name }, joker.effect.amount);
  return joker.effect.amount;
}

export function sumSteps(ledger: DayLedger) {
  return ledger.steps.reduce((sum, step) => sum + step.amount, 0);
}

/** News of each direction a player might face, with weights from the whole event list (never the private schedule). */
export function newsOutlook(config: FinancialConfig, known: Tone | null) {
  const groups = new Map<Tone, { weight: number; total: number }>();
  for (const event of config.events) {
    const tone = marketTone(event, config);
    const price = priceEffect(config, event);
    const entry = groups.get(tone) ?? { weight: 0, total: 0 };
    entry.weight += event.weight;
    entry.total += event.weight * (price ? (price.floor + price.ceiling) / 2 : 0);
    groups.set(tone, entry);
  }
  const scenarios = [...groups].filter(([tone]) => known === null || tone === known)
    .map(([tone, entry]) => ({ tone, rate: entry.total / entry.weight, weight: entry.weight }));
  const total = scenarios.reduce((sum, item) => sum + item.weight, 0);
  return scenarios.map(item => ({ ...item, weight: item.weight / total }));
}
