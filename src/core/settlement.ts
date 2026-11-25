import type { AllocationOption, FinanceEffect, FinancialConfig, GameCard, TradingEvent } from '../config/financial-settings';
import { eventPrice, rulesFor } from './event-rules';
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
  heldStockDays: number;
  attackSupplyHits: number;
  rebateDay: number;
  charge: number;
  attackRestDays: number;
  mirrorItemDay: number;
  copyDay: number;
  stockCurseDay: number;
  stockCurseRate: number;
  stockCurseCard: GameCard | null;
  cashCurseDay: number;
  cashCurseCard: GameCard | null;
  cashCurseRate: number;
  cashCurseCap: number;
  miraclePaid: boolean;
  sacrificeDay: number;
  sacrificePaymentRoom: number;
  rebirthDay: number;
  eventRebirthDay?: number;
  eventRebirthRate?: number;
  eventGenerateDay?: number;
  eventRecycleDay?: number;
  recycleDay: number;
  generationDay: number;
  holdPaid: boolean;
  climbPaid: boolean;
  reliefUsed: boolean;
  voucher: number;
  mirror: number | null;
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

export type StepSource = 'shop' | 'market' | 'news' | 'joker' | 'item' | 'defense' | 'attack' | 'sacrifice' | 'event' | 'cap';
export type StepKind = 'base' | 'add' | 'mult' | 'cut' | 'cash' | 'cap';

/**
 * One line of the settlement chain. The amounts of all steps of a day add up exactly to the change in total worth
 * (before any restart after hitting zero), so the presentation can replay the chain without recalculating.
 */
export interface ChainStep { source: StepSource; id: string; name: string; kind: StepKind; value?: number; amount: number }

export type ItemBlock = 'no_stock' | 'full_defense' | 'no_news' | 'known_news' | 'no_target' | 'mirror_ready' | 'not_low' | 'used' | 'last_day' | 'play_limit' | 'defense_today' | 'voucher_ready' | 'sacrifice_used' | 'sacrifice_funds';

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
  /** 道具可指定的有效對手是否存在。 */
  hasTarget: boolean;
  openingLast?: boolean;
  openingBottom?: boolean;
  gamblerRoll?: number;
}

export interface DayLedger {
  day?: number;
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
  itemCount: number;
  defenseUsed: Defense | null;
  requests: { intel: boolean; pack: number; items: number };
  attackLoss: number;
}

interface Mod { source: StepSource; id: string; name: string; value: number }

const effectsOf = (config: FinancialConfig, card: { effectIds: readonly string[] }) => card.effectIds.map(id => config.effects[id]);

export function jokerEffect<T extends FinanceEffect['type']>(holder: Holder, config: FinancialConfig, type: T) {
  const entry = jokerEffects(holder, config).find(({ effect }) => effect.type === type);
  return entry as { joker: GameCard; effect: Extract<FinanceEffect, {type: T}> } | undefined;
}

type JokerEffectEntry = { joker: GameCard; effect: FinanceEffect };

function jokerEffects(holder: Holder, config: FinancialConfig): JokerEffectEntry[] {
  return holder.jokers.flatMap((joker, index) => effectsOf(config, joker).flatMap<JokerEffectEntry>(effect => {
    if (effect.type !== 'phantom') return [{ joker, effect }];
    const left = holder.jokers[index - 1];
    if (!left) return [];
    return effectsOf(config, left).flatMap<JokerEffectEntry>(template => {
      switch (template.type) {
        case 'gain_add': case 'loss_cut':
          return [{ joker, effect: { ...template, amount: template.amount * effect.rate } }];
        case 'patient_gain':
          return [{ joker, effect: { ...template, rate: template.rate * effect.rate } }];
        case 'cash_yield': case 'stock_yield':
          return [{ joker, effect: { ...template, rate: template.rate * effect.rate, cap: Math.floor(template.cap * effect.rate) } }];
        default: return [];
      }
    });
  }));
}

export function newMemory(): Memory {
  return { lastRate: null, lastStockPnl: 0, winStreak: 0, holdDays: 0, heldStockDays: 0, attackSupplyHits: 0, rebateDay: 0, charge: 0, attackRestDays: 0, mirrorItemDay: 0, copyDay: 0, stockCurseDay: 0, stockCurseRate: 0, stockCurseCard: null, cashCurseDay: 0, cashCurseCard: null, cashCurseRate: 0, cashCurseCap: 0, miraclePaid: false, sacrificeDay: 0, sacrificePaymentRoom: 0, rebirthDay: 0, recycleDay: 0, generationDay: 0, holdPaid: false, climbPaid: false, reliefUsed: false, voucher: 0, mirror: null };
}

export function copyHolder(holder: Holder): Holder {
  return {
    account: copyPortfolio(holder.account), jokers: [...holder.jokers], items: [...holder.items],
    defenses: holder.defenses.map(item => ({ ...item })), intel: holder.intel ? { ...holder.intel } : null, memory: { ...holder.memory }
  };
}

export function priceEffect(config: FinancialConfig, event: Pick<TradingEvent, 'effectIds'>) {
  return eventPrice(config, event, -1);
}

/** 利多、利空，或沒有股價變動的特殊事件。 */
export function marketTone(event: Pick<TradingEvent, 'effectIds'>, config: FinancialConfig): Tone {
  const price = priceEffect(config, event);
  if (!price || price.binary) return 'neutral';
  const middle = price.floor + price.ceiling;
  return middle > 0 ? 'positive' : middle < 0 ? 'negative' : 'neutral';
}

export function rateFrom(effect: { floor: number; ceiling: number }, draw: number) {
  return effect.floor + (effect.ceiling - effect.floor) * draw;
}

export function newLedger(day?: number): DayLedger {
  return {
    day, rebalance: null, steps: [], exposure: { stock: 0, cash: 0 }, rate: 0, marketPnl: 0, newsPnl: 0, stockBase: 0, stockFinal: 0,
    shielded: 0, combos: 0, capped: false, itemCount: 0, defenseUsed: null,
    requests: { intel: false, pack: 0, items: 0 }, attackLoss: 0
  };
}

export function addCash(holder: Holder, ledger: DayLedger, step: Omit<ChainStep, 'amount' | 'kind'> & { kind?: StepKind }, amount: number) {
  if (!amount) return;
  holder.account.cash += amount;
  holder.account.stats.cashYield += amount;
  ledger.steps.push({ kind: 'cash', ...step, amount });
  if (step.source !== 'joker' || ledger.day === undefined) return;
  const curse = applyCashCurse(holder, ledger.day, amount);
  if (curse) ledger.steps.push({ source: 'event', id: curse.card.id, name: curse.card.name, kind: 'cut', amount: -curse.amount });
}

export function applyCashCurse(holder: Holder, day: number, income: number, trackYield = true) {
  const { memory, account } = holder;
  if (income <= 0 || memory.cashCurseDay !== day || !memory.cashCurseCard) return null;
  const card = memory.cashCurseCard;
  memory.cashCurseCard = null;
  const amount = Math.min(memory.cashCurseCap, Math.round(income * memory.cashCurseRate));
  account.cash -= amount;
  if (trackYield) account.stats.cashYield -= amount;
  return amount ? { card, amount } : null;
}

/** Why an item cannot be used today with the chosen stock ratio, or null when it can. */
export function itemBlock(holder: Holder, item: GameCard, context: DayContext): ItemBlock | null {
  const worth = Math.max(0, netWorth(holder.account));
  const plannedStock = Math.floor(worth * context.allocation.ratio);
  for (const effect of effectsOf(context.config, item)) {
    switch (effect.type) {
      case 'sacrifice_attack': case 'sacrifice_draw':
        if (holder.memory.sacrificeDay === context.day) return 'sacrifice_used';
        if (worth < 2 || !Math.round(worth * effect.rate)) return 'sacrifice_funds';
        if (effect.type === 'sacrifice_attack' && !context.hasTarget) return 'no_target';
        break;
      case 'today_add':
      case 'today_mult':
      case 'stock_cash':
        if (plannedStock <= 0) return 'no_stock';
        break;
      case 'defense':
        if (holder.defenses.length + Number(holder.memory.mirror !== null) >= context.config.financial.maxDefenses) return 'full_defense';
        break;
      case 'intel':
        if (context.nextNewsDay === null) return 'no_news';
        if (holder.intel?.day === context.nextNewsDay) return 'known_news';
        break;
      case 'attack': case 'cash_raid': case 'shield_break':
        if (!context.hasTarget) return 'no_target';
        break;
      case 'mirror':
        if (holder.memory.mirror !== null) return 'mirror_ready';
        if (holder.defenses.length >= context.config.financial.maxDefenses) return 'full_defense';
        break;
      case 'relief':
        if (holder.memory.reliefUsed) return 'used';
        if (worth >= effect.below) return 'not_low';
        break;
      case 'voucher':
        if (holder.memory.voucher) return 'voucher_ready';
        break;
      default:
        break;
    }
  }
  return null;
}

function addDividend(holder: Holder, config: FinancialConfig, ledger: DayLedger, source: { source: 'joker' | 'item'; id: string; name: string }, amount: number) {
  addCash(holder, ledger, source, amount);
  const bonus = jokerEffect(holder, config, 'dividend_bonus');
  if (bonus) addCash(holder, ledger, { source: 'joker', id: bonus.joker.id, name: bonus.joker.name }, Math.round(amount * bonus.effect.rate));
}

export function repeatableItem(config: FinancialConfig, card: GameCard) {
  return card.rarity === 'common' && effectsOf(config, card).every(effect =>
    effect.type === 'cash_grant' || effect.type === 'stock_cash' || effect.type === 'today_add' ||
    effect.type === 'random_cash' || effect.type === 'attack' || effect.type === 'cash_raid' ||
    (effect.type === 'defense' && effect.mode === 'cut'));
}

export function mirrorItem(holder: Holder, config: FinancialConfig, card: GameCard, day: number | undefined) {
  if (day === undefined || holder.memory.mirrorItemDay === day || !repeatableItem(config, card)) return undefined;
  return jokerEffect(holder, config, 'universal_mirror');
}

function applyItem(holder: Holder, item: GameCard, effect: FinanceEffect, ledger: DayLedger, boosts: { add: Mod[]; mult: Mod[] }, config: FinancialConfig) {
  const source = { source: 'item' as const, id: item.id, name: item.name };
  const mirror = ['cash_grant', 'stock_cash', 'today_add', 'defense'].includes(effect.type) ? mirrorItem(holder, config, item, ledger.day) : undefined;
  if (mirror) holder.memory.mirrorItemDay = ledger.day!;
  const mirrorSource = mirror && { source: 'joker' as const, id: mirror.joker.id, name: mirror.joker.name };
  switch (effect.type) {
    case 'cash_grant':
      addCash(holder, ledger, source, effect.amount);
      if (mirrorSource) addCash(holder, ledger, mirrorSource, Math.round(effect.amount * mirror.effect.rate));
      break;
    case 'stock_cash': {
      const amount = Math.round(holder.account.investmentValue * effect.rate);
      addDividend(holder, config, ledger, source, amount);
      if (mirrorSource) addCash(holder, ledger, mirrorSource, Math.round(amount * mirror.effect.rate));
      break;
    }
    case 'relief':
      holder.memory.reliefUsed = true;
      addCash(holder, ledger, source, effect.amount);
      break;
    case 'today_add':
      boosts.add.push({ ...source, value: effect.amount });
      if (mirrorSource) boosts.add.push({ ...mirrorSource, value: effect.amount * mirror.effect.rate });
      break;
    case 'today_mult': boosts.mult.push({ ...source, value: effect.factor }); break;
    case 'defense': holder.defenses.push({ itemId: item.id, name: item.name, mode: effect.mode, amount: effect.amount * (1 + (mirror?.effect.rate ?? 0)) }); break;
    case 'intel': ledger.requests.intel = true; break;
    case 'item_pack': ledger.requests.pack = effect.count; break;
    case 'mirror': holder.memory.mirror = effect.amount; break;
    case 'voucher': holder.memory.voucher = effect.amount; break;
    default: break;
  }
}

/**
 * Today's locked action for one investor, in rule order:
 * rebalance → instant item → shared market and news → joker/item boosts on the stock result → defenses.
 * 角色攻擊與固定現金收益在股價結算後處理。
 */
export function playOpeningItem(holder: Holder, item: GameCard, config: FinancialConfig, random: () => number, day?: number) {
  const ledger = newLedger(day);
  for (const effect of effectsOf(config, item)) {
    if (effect.type === 'random_cash') {
      const rolls = jokerEffect(holder, config, 'lucky_star')?.effect.rolls ?? 1;
      const draw = Math.max(...Array.from({ length: rolls }, random));
      const amount = effect.min + Math.floor(draw * (effect.max - effect.min + 1));
      addCash(holder, ledger, { source: 'item', id: item.id, name: item.name }, amount);
      const mirror = mirrorItem(holder, config, item, day);
      if (mirror) {
        holder.memory.mirrorItemDay = day!;
        addCash(holder, ledger, { source: 'joker', id: mirror.joker.id, name: mirror.joker.name }, Math.round(amount * mirror.effect.rate));
      }
    } else applyItem(holder, item, effect, ledger, { add: [], mult: [] }, config);
  }
  return ledger;
}

export function tradeDay(holder: Holder, items: GameCard[], context: DayContext): DayLedger {
  const { config } = context;
  const { account } = holder;
  const ledger = newLedger(context.day);
  ledger.rebalance = rebalance(account, context.allocation.ratio);
  const boosts = { add: [] as Mod[], mult: [] as Mod[] };
  ledger.itemCount = items.length;
  for (const item of items) {
    for (const effect of effectsOf(config, item)) applyItem(holder, item, effect, ledger, boosts, config);
  }
  if (context.news?.applies) {
    const event = context.news.event;
    for (const effect of effectsOf(config, event)) {
      if (effect.type === 'cash_grant') addCash(holder, ledger, { source: 'event', id: event.id, name: event.title }, effect.amount);
      if (effect.type === 'item_grant') ledger.requests.items += effect.count;
    }
  }
  const event = context.news?.applies ? context.news.event : null;
  const rules = rulesFor(config, event);
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
    const eventGain = (rules.gain ?? 0) + (context.openingBottom ? rules.bottomGain ?? 0 : 0);
    if (event && eventGain) adds.push({ source: 'event', id: event.id, name: event.title, value: eventGain });
    if (memory.eventRebirthDay === context.day && memory.eventRebirthRate) {
      adds.push({ source: 'event', id: 'event_rebirth_night', name: '浴火之夜', value: memory.eventRebirthRate });
    }
    for (const { joker, effect } of jokers) {
      const mod = { source: 'joker' as const, id: joker.id, name: joker.name };
      if (effect.type === 'patient_gain' && ledger.exposure.stock > 0 && memory.heldStockDays + 1 >= effect.days) adds.push({ ...mod, value: effect.rate });
      if (effect.type === 'sacrifice_rebirth' && memory.rebirthDay === context.day) adds.push({ ...mod, value: effect.rate });
      if (effect.type === 'last_fury' && context.openingLast) adds.push({ ...mod, value: effect.rate });
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
    if (event && rules.loss) amplifiers.push({ source: 'event', id: event.id, name: event.title, value: 1 + rules.loss });
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
    const shield = holder.defenses.shift();
    const defense = shield ? { ...shield, amount: shield.amount * (1 + (rules.shieldBoost ?? 0)) } : null;
    if (event && rules.marketCut) cuts.push({ source: 'event', id: event.id, name: event.title, value: rules.marketCut });
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
      const saved = Math.min(-value, Math.round(defense.amount));
      value += saved;
      ledger.shielded += saved;
      record({ source: 'defense', id: defense.itemId, name: defense.name, value: defense.amount }, 'cut', saved);
    }
    if (defense?.mode === 'reverse') {
      const flipped = Math.min(-value, Math.round(defense.amount));
      const saved = flipped - value;
      ledger.shielded += -value;
      value = flipped;
      record({ source: 'defense', id: defense.itemId, name: defense.name, value: defense.amount }, 'cut', saved);
    }
    ledger.defenseUsed = defense;
  }
  if (value > 0 && memory.stockCurseDay === context.day && memory.stockCurseCard) {
    const lost = Math.round(value * memory.stockCurseRate);
    if (lost) ledger.steps.push({ source: 'event', id: memory.stockCurseCard.id, name: memory.stockCurseCard.name, kind: 'cut', amount: -lost });
    value -= lost;
  }
  account.investmentValue += value;
  account.stats.investmentPnl += value;
  ledger.stockFinal = value;
  return ledger;
}

/** Flat cash from jokers, settled last and never multiplied; then the holder's memory moves to tomorrow. */
export function spendSacrificePaymentRoom(holder: Holder, amount: number) {
  const payable = Math.min(holder.memory.sacrificePaymentRoom, amount);
  holder.memory.sacrificePaymentRoom -= payable;
  return payable;
}

export function closeDay(holder: Holder, context: DayContext, ledger: DayLedger, attackDamage = 0) {
  const { config } = context;
  const { account } = holder;
  const memory = holder.memory;
  memory.holdDays = account.investmentValue > 0 ? memory.holdDays + 1 : 0;
  memory.heldStockDays = account.investmentValue > 0 ? memory.heldStockDays + 1 : 0;
  const event = context.news?.applies ? context.news.event : null;
  const rules = rulesFor(config, event);
  const jokers = jokerEffects(holder, config);
  const boost = jokers.reduce((product, { effect }) => effect.type === 'yield_boost' ? product * effect.factor : product, 1);
  const booster = jokers.find(entry => entry.effect.type === 'yield_boost');
  for (const { joker, effect } of jokers) {
    const source = { source: 'joker' as const, id: joker.id, name: joker.name };
    switch (effect.type) {
      case 'time_bank':
        if (!ledger.itemCount && netWorth(account) > 0) addCash(holder, ledger, source, effect.amount);
        break;
      case 'fate_gambler': {
        if (context.gamblerRoll === undefined || netWorth(account) <= 0) break;
        if (context.gamblerRoll < effect.chance) {
          addCash(holder, ledger, source, effect.gain);
        } else {
          const loss = Math.min(netWorth(account), effect.loss);
          const cash = Math.min(account.cash, loss);
          account.cash -= cash;
          account.investmentValue -= loss - cash;
          account.stats.investmentPnl -= loss - cash;
          ledger.steps.push({ ...source, kind: 'cash', amount: -loss });
        }
        break;
      }
      case 'cash_yield': {
        if (netWorth(account) <= 0) break;
        const income = Math.min(effect.cap, Math.round(account.cash * effect.rate));
        addCash(holder, ledger, { ...source, value: effect.rate }, Math.round(income * (rules.cashJokers ?? 1)));
        if (booster?.effect.type === 'yield_boost' && income && joker.effectIds.some(id => config.effects[id].type === 'cash_yield')) {
          const bonus = Math.max(0, Math.min(booster.effect.cap - income, Math.round(income * (boost - 1))));
          addCash(holder, ledger, { source: 'joker', id: booster.joker.id, name: booster.joker.name, kind: 'mult', value: boost }, Math.round(bonus * (rules.cashJokers ?? 1)));
        }
        break;
      }
      case 'stock_yield':
        addDividend(holder, config, ledger, source, Math.min(effect.cap, Math.round(account.investmentValue * effect.rate)));
        break;
      case 'bear_bonus':
        if (ledger.exposure.stock <= 0 && ledger.rate < 0) addCash(holder, ledger, source, effect.amount);
        break;
      case 'item_bonus': {
        const regularCount = ledger.itemCount - Number(memory.sacrificeDay === context.day);
        const regularPay = Math.min(effect.cap, Math.max(0, regularCount) * effect.amount);
        const sacrificePay = Math.min(effect.cap, ledger.itemCount * effect.amount) - regularPay;
        addCash(holder, ledger, source, regularPay + spendSacrificePaymentRoom(holder, sacrificePay));
        break;
      }
      case 'shield_income':
        addCash(holder, ledger, source, Math.min(effect.cap, Math.round(ledger.shielded * effect.rate)));
        break;
      case 'combo_income':
        if (ledger.itemCount >= effect.count) {
          const fromSacrifice = ledger.itemCount === effect.count && memory.sacrificeDay === context.day;
          addCash(holder, ledger, source, fromSacrifice ? spendSacrificePaymentRoom(holder, effect.amount) : effect.amount);
        }
        break;
      case 'attack_bonus':
        addCash(holder, ledger, source, Math.round(attackDamage * effect.rate));
        break;
      case 'hold_bonus':
        if (memory.holdDays >= effect.days) {
          memory.holdDays = 0;
          addCash(holder, ledger, source, effect.amount);
        }
        break;
      default: break;
    }
  }
  if (event && netWorth(account) > 0) {
    const source = { source: 'event' as const, id: event.id, name: event.title };
    const cash = account.cash;
    const qualifies = rules.cashMajority && cash >= netWorth(account) * rules.cashMajority[0];
    if (rules.cashYield) addCash(holder, ledger, source, Math.min(rules.cashYield[1], Math.round(cash * rules.cashYield[0])));
    if (qualifies) addCash(holder, ledger, source, rules.cashMajority![1]);
    if (rules.insurance) addCash(holder, ledger, source, Math.min(rules.insurance[1], Math.round(ledger.shielded * rules.insurance[0])));
    if (rules.comboIncome && ledger.itemCount >= rules.comboIncome[0]) {
      const fromSacrifice = ledger.itemCount === rules.comboIncome[0] && memory.sacrificeDay === context.day;
      const amount = fromSacrifice ? spendSacrificePaymentRoom(holder, rules.comboIncome[1]) : rules.comboIncome[1];
      addCash(holder, ledger, source, amount);
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
  for (const event of config.events.filter(event => !event.family)) {
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
  return total > 0 ? scenarios.map(item => ({ ...item, weight: item.weight / total })) : [{ tone: 'neutral' as const, rate: 0, weight: 1 }];
}
