import type { AllocationOption, FinanceEffect, FinancialConfig, InvestmentKind, TradingCard, TradingEvent } from '../config/financial-settings';
import {
  copyPortfolio, netWorth, rebalance, revalue, type Portfolio, type Rebalance
} from './economy';
import { settleRisk } from './financial-risk';

export interface PreparedCard {
  id: string;
  kind: 'dividend' | 'cash' | 'stock' | 'rally' | 'short' | 'safe_shield';
  cap?: number;
  incomeTriggered?: boolean;
  amount: number;
  expires: number;
}

export interface TradingState {
  account: Portfolio;
  hedges: number[];
  intelDay: number | null;
  extraIntel: number[];
  usedRelief: boolean;
  prepared: PreparedCard[];
}

export interface EffectContext {
  config: FinancialConfig;
  day: number;
  eventDay: number | null;
  recentLoss: boolean;
  marketDraw: number;
  /** Independent per-investor draw for luck nodes; defaults to marketDraw in previews. */
  luckDraw?: number;
  allocation: AllocationOption;
  eligibleAid: boolean;
  opponentCount: number;
  followingEventDay?: number | null;
  marketToday?: boolean;
}

export type CardBlock = 'no_stock' | 'full_shield' | 'no_news' | 'known_news' | 'cash_high' |
  'low_cash' | 'no_opponent' | 'route' | 'need_downturn' | 'already_prepared' | 'no_days' | 'recovery_required' | 'already_used' | 'equity_high';

interface EffectLedger {
  rebalance: Rebalance | null;
  /** Gain or loss from the shared daily market move on stock held after rebalancing. */
  baseMarket: number;
  gamble: number;
  sold: number;
  fees: number;
  dividends: number;
  investmentPnl: number;
  cashYield: number;
  protected: number;
  marketRate: number | null;
  synergies: number;
  synergyGain: number;
  preparedTriggers: number;
  feeSaved: number;
  cardGain: number;
  baseGain: number;
  stockCardGain: number;
  activeComboGain: number;
  marketCardGain: number;
  bonusDraw: boolean;
  cardDraft: boolean;
}

function effectLedger(config: FinancialConfig): EffectLedger {
  return { rebalance: null, baseMarket: 0, gamble: 0, sold: 0, fees: 0, dividends: 0,
    investmentPnl: 0, cashYield: 0, protected: 0, marketRate: null, synergies: 0, synergyGain: 0, preparedTriggers: 0, feeSaved: 0, cardGain: 0, baseGain: 0, stockCardGain: 0, activeComboGain: 0,
    marketCardGain: 0, bonusDraw: false, cardDraft: false };
}

export function marketTone(event: TradingEvent, config: FinancialConfig) {
  const price = event.effectIds.map(id => config.effects[id]).find(effect => effect.type === 'price');
  return !price ? 'neutral' : price.floor + price.ceiling > 0 ? 'positive' : price.floor + price.ceiling < 0 ? 'negative' : 'neutral';
}

const ownStocks = (account: Portfolio) => Math.max(0, account.investmentValue);

export function hedgeLayers(state: TradingState) {
  return state.hedges.length + state.prepared.filter(item => item.kind === 'safe_shield').length;
}

export function openingCardIncome(state: TradingState) {
  const { account } = state;
  let cash = 0;
  let stock = 0;
  let triggers = 0;
  for (const effect of state.prepared) {
    if (effect.kind === 'cash' && netWorth(account) > 0) {
      const reward = Math.min(effect.cap ?? Infinity, Math.max(0, Math.round(account.cash * effect.amount)));
      cash += reward;
      if (reward && !effect.incomeTriggered) { effect.incomeTriggered = true; triggers++; }
    }
    if (effect.kind === 'stock') {
      const reward = Math.min(effect.cap ?? Infinity, Math.round(ownStocks(account) * effect.amount));
      stock += reward;
      if (reward && !effect.incomeTriggered) { effect.incomeTriggered = true; triggers++; }
    }
  }
  account.cash += cash + stock;
  account.stats.cashYield += cash + stock;
  return { cash, stock, triggers };
}

function applyEffect(state: TradingState, effect: FinanceEffect, context: EffectContext, ledger: EffectLedger, extra = 0, market = false): true | CardBlock {
  const account = state.account;
  const rules = context.config.financial;
  switch (effect.type) {
    case 'price': {
      const rate = effect.floor + (effect.ceiling - effect.floor) * context.marketDraw;
      const scenario = rate + extra;
      const before = account.investmentValue;
      const raw = Math.round(before * Math.max(-1, scenario));
      const boost = market && before ? state.prepared.find(item => item.kind === (scenario < 0 ? 'short' : 'rally') && ownStocks(account) > 0) : undefined;
      let protection = 0;
      let payout = 0;
      if (boost && scenario !== 0) {
        const ownMove = Math.round(ownStocks(account) * Math.abs(scenario));
        payout = Math.min(boost.cap ?? Infinity, Math.round(ownMove * boost.amount));
        if (boost.kind === 'short') payout += ownMove;
        if (payout) {
          state.prepared = state.prepared.filter(item => item !== boost);
          ledger.preparedTriggers++;
        }
      } else if (market && raw < 0 && state.hedges.length) {
        protection = Math.min(-raw, -raw - Math.abs(Math.round(before * scenario * (1 - state.hedges.shift()!))));
      } else if (market && raw < 0) {
        const shield = state.prepared.find(item => item.kind === 'safe_shield');
        if (shield) {
          protection = Math.round(ownStocks(account) * Math.abs(scenario) * shield.amount);
          if (protection) {
            state.prepared = state.prepared.filter(item => item !== shield);
            ledger.preparedTriggers++;
          }
        }
      }
      const profit = before ? revalue(account, (raw + protection + payout) / before) : 0;
      if (market) {
        ledger.marketRate = scenario;
        ledger.protected += protection;
        ledger.marketCardGain += payout;
        ledger.cardGain += payout;
        ledger.stockCardGain += payout;
      }
      ledger.investmentPnl += profit;
      if (extra) ledger.synergyGain += profit - Math.round(before * rate);
      return profit !== 0 || 'no_stock';
    }
    case 'dividend': {
      const dividend = Math.round(account.investmentValue * effect.rate * (1 + extra));
      account.cash += dividend;
      account.stats.dividends += dividend;
      ledger.dividends += dividend;
      if (extra) ledger.synergyGain += dividend - Math.round(account.investmentValue * effect.rate);
      return dividend > 0 || 'no_stock';
    }
    case 'hedge': {
      if (hedgeLayers(state) >= rules.maxHedges) return 'full_shield';
      state.hedges.push(effect.protection);
      return true;
    }
    case 'intel': {
      if (context.eventDay === null) return 'no_news';
      const days = [context.eventDay, ...(effect.count === 2 && context.followingEventDay ? [context.followingEventDay] : [])];
      const known = [state.intelDay, ...state.extraIntel].filter((day): day is number => day !== null);
      if (!days.some(day => !known.includes(day))) return 'known_news';
      const revealed = [...new Set([...known, ...days])].sort((a,b) => a-b);
      state.intelDay = revealed[0];
      state.extraIntel = revealed.slice(1);
      ledger.bonusDraw ||= effect.bonusDraw === true;
      return true;
    }
    case 'cash_yield': {
      if (account.cash < netWorth(account) * effect.threshold || netWorth(account) <= 0) return 'low_cash';
      const income = Math.round(account.cash * effect.rate);
      account.cash += income;
      account.stats.cashYield += income;
      ledger.cashYield += income;
      return income > 0 || 'low_cash';
    }
    case 'cash_grant':
      if (effect.recovered && !account.bankruptcyCount) return 'recovery_required';
      if (effect.recovered && state.usedRelief) return 'already_used';
      state.usedRelief ||= effect.recovered === true;
      account.cash += effect.amount;
      account.stats.cashYield += effect.amount;
      ledger.cashYield += effect.amount;
      return true;
    case 'gamble': {
      const draw = context.luckDraw ?? context.marketDraw;
      const amount = Math.max(-account.cash, Math.round(effect.floor + (effect.ceiling - effect.floor) * draw));
      account.cash += amount;
      account.stats.cashYield += amount;
      ledger.gamble += amount;
      return true;
    }
    case 'card_draft':
      if (context.day >= configLastDay(context)) return 'no_days';
      ledger.cardDraft = true;
      return true;
    case 'combo':
    case 'timed':
    case 'route_card':
    case 'attack': return 'route';
  }
}

const configLastDay = (context: EffectContext) => context.config.gameplay.turns;

function pairedEffect(effect: FinanceEffect, bonus: number): FinanceEffect {
  switch (effect.type) {
    case 'hedge': return { ...effect, protection: Math.min(1, effect.protection + bonus) };
    case 'cash_yield': return { ...effect, rate: Math.min(1, effect.rate + bonus) };
    case 'cash_grant': return { ...effect, amount: Math.round(effect.amount * (1 + bonus)) };
    default: return effect;
  }
}

export function allocationTags(kind: InvestmentKind, allocation: AllocationOption) {
  return [...new Set([...kind.tags, ...allocation.tags])];
}

/**
 * One investor's locked daily action, in rule order: rebalance to the chosen allocation, card and node effects,
 * then the shared daily market move. News (applyMarket), interest and risk follow in the caller.
 */
export function applyTrade(state: TradingState, kind: InvestmentKind, card: TradingCard | null, context: EffectContext, prepare = false) {
  const { config } = context;
  const ledger = effectLedger(config);
  const tags = allocationTags(kind, context.allocation);
  const effects = card && !card.opponent ? card.effectIds.map(id => config.effects[id]) : [];
  let cardUsed = Boolean(card?.opponent && context.opponentCount);
  let cardBlock: CardBlock = card?.opponent ? 'no_opponent' : 'route';
  const pairing = config.cardRules.expanded && card?.pairing && tags.some(tag => card.pairing!.tags.includes(tag)) ? card.pairing.amount : 0;
  const timed = effects.find(effect => effect.type === 'timed');
  const routeCard = effects.find(effect => effect.type === 'route_card');
  const routeBonus = routeCard && (routeCard.mode === 'cushion' || netWorth(state.account) < state.account.initialCapital * routeCard.equity!);
  if (routeCard?.mode === 'desperate' && !routeBonus) cardBlock = 'equity_high';
  let routeApplied = false;
  let placed: PreparedCard | null = null;
  const futureDividend = effects.find(effect => effect.type === 'combo' && effect.prepareDays !== undefined);
  const setUp = prepare && context.config.cardRules.preparations && futureDividend?.type === 'combo' ? {
    kind: 'dividend' as const, days: futureDividend.prepareDays!, amount: futureDividend.amount
  } : null;
  if (prepare && !setUp) return { ledger, cardUsed: false, funded: false, cardImpact: null, cardBlock, draft: false, preparation: null };
  ledger.rebalance = rebalance(state.account, context.allocation.ratio);
  const preparation = setUp && card ? {
    id: card.id, kind: setUp.kind, amount: setUp.amount,
    expires: Math.min(context.day + setUp.days, config.gameplay.turns)
  } : null;
  if (preparation) {
    if (state.prepared.some(item => item.id === preparation.id && item.expires >= context.day)) cardBlock = 'already_prepared';
    else if (preparation.expires <= context.day) cardBlock = 'no_days';
    else cardUsed = true;
  }
  const openingCash = state.account.cash;
  for (const effect of effects) {
    if (effect.type === 'combo' || effect.type === 'timed' || effect.type === 'route_card') continue;
    const result = applyEffect(state, pairing ? pairedEffect(effect, pairing) : effect, context, ledger);
    if (result === true) { cardUsed = true; if (pairing) ledger.synergies++; }
    else cardBlock = result;
  }
  const cardImpact = card ? {
    cash: state.account.cash - openingCash
  } : null;
  const eligible = kind.draft !== 'catchup' || context.eligibleAid;
  const combos = (setUp ? [] : effects).filter(effect => effect.type === 'combo')
    .filter(effect => tags.includes(effect.nodeTag) && (!effect.afterLoss || context.recentLoss));
  if (effects.some(effect => effect.type === 'combo' && effect.afterLoss && !context.recentLoss)) cardBlock = 'need_downturn';
  const boosted = new Set<FinanceEffect>();
  const dailyMarket = config.allocation.dailyMarket;
  for (const id of [...(eligible ? kind.effectIds : []), dailyMarket]) {
    const effect = config.effects[id];
    if (!state.account.investmentValue && combos.some(combo => combo.mode === effect.type)) cardBlock = 'no_stock';
    const pendingDividend = effect.type === 'dividend' && Math.round(state.account.investmentValue * effect.rate) > 0
      ? state.prepared.find(item => item.kind === 'dividend' && item.expires >= context.day) : undefined;
    const matching = state.account.investmentValue ? combos.filter(combo => combo.mode === effect.type) : [];
    const activeBonus = matching.reduce((sum, combo) => sum + combo.amount, 0);
    const bonus = Math.max(activeBonus, pendingDividend?.amount ?? 0);
    const before = ledger.synergyGain;
    let extra = bonus;
    if (routeCard && routeBonus && effect.type === 'price' && ownStocks(state.account) > 0) {
      const roll = effect.floor + (effect.ceiling - effect.floor) * context.marketDraw;
      const equityShare = Math.min(1, ownStocks(state.account) / state.account.investmentValue);
      if (routeCard.mode === 'desperate' || roll < 0) {
        extra += roll * equityShare * routeCard.amount * (routeCard.mode === 'cushion' ? -1 : 1);
        routeApplied = true;
      }
    }
    const pnlBefore = ledger.investmentPnl;
    applyEffect(state, effect, context, ledger, extra);
    if (id === dailyMarket) ledger.baseMarket += ledger.investmentPnl - pnlBefore - (ledger.synergyGain - before);
    if (pendingDividend && pendingDividend.amount >= activeBonus) {
      state.prepared = state.prepared.filter(item => item !== pendingDividend);
      ledger.preparedTriggers++;
      for (const combo of matching) boosted.add(combo);
      if (matching.length) cardBlock = 'already_prepared';
    } else {
      ledger.synergies += matching.length;
      ledger.activeComboGain += ledger.synergyGain - before;
      cardUsed ||= matching.length > 0;
      for (const combo of matching) boosted.add(combo);
    }
    ledger.cardGain += ledger.synergyGain - before;
    if (effect.type === 'price') ledger.stockCardGain += ledger.synergyGain - before;
  }
  if (config.cardRules.baseEffects && !setUp) {
    for (const effect of effects) {
      if (effect.type !== 'combo' || !effect.base || boosted.has(effect)) continue;
      if (!state.account.investmentValue) { cardBlock = 'no_stock'; continue; }
      const gain = Math.round(state.account.investmentValue * effect.base);
      if (!gain) { cardBlock = 'no_stock'; continue; }
      if (effect.mode === 'price') {
        ledger.investmentPnl += revalue(state.account, effect.base);
        ledger.stockCardGain += gain;
      }
      else {
        state.account.cash += gain;
        state.account.stats.dividends += gain;
        ledger.dividends += gain;
      }
      ledger.cardGain += gain;
      ledger.baseGain += gain;
      cardUsed = true;
    }
  }
  if (routeCard && routeBonus && routeCard.mode === 'cushion' && !routeApplied) {
    if (context.eventDay === null && !context.marketToday) cardBlock = 'no_news';
    else if (hedgeLayers(state) >= config.financial.maxHedges) cardBlock = 'full_shield';
    else if (state.prepared.some(item => item.id === card!.id)) cardBlock = 'already_prepared';
    else {
      placed = { id: card!.id, kind: 'safe_shield', amount: routeCard.amount, expires: configLastDay(context) };
      state.prepared.push(placed);
      routeApplied = true;
    }
  }
  if (routeCard && routeApplied) {
    cardUsed = true;
    if (routeCard.mode === 'cushion' && ledger.synergyGain > 0) ledger.synergies++;
  }
  if (timed && card) {
    const hasMarket = context.eventDay !== null || context.marketToday;
    const isYield = timed.kind === 'cash' || timed.kind === 'stock';
    if (state.prepared.some(item => item.id === card.id)) cardBlock = 'already_prepared';
    else if (isYield && context.day >= configLastDay(context)) cardBlock = 'no_days';
    else if (!isYield && !hasMarket) cardBlock = 'no_news';
    else if ((timed.kind === 'stock' || timed.kind === 'short') && !ownStocks(state.account)) cardBlock = 'no_stock';
    else if (timed.kind === 'safe_shield' && hedgeLayers(state) >= config.financial.maxHedges) cardBlock = 'full_shield';
    else {
      placed = { id: card.id, kind: timed.kind, amount: timed.amount * (1 + pairing),
        cap: timed.cap, expires: Math.min(configLastDay(context), context.day + timed.days) };
      state.prepared.push(placed);
      if (pairing) ledger.synergies++;
      cardUsed = true;
    }
  }
  if (preparation && cardUsed) { placed = preparation; state.prepared.push(placed); }
  ledger.cardGain += ledger.cashYield + ledger.feeSaved;
  return { ledger, cardUsed, funded: true, cardImpact, cardBlock: card && !cardUsed ? cardBlock : null,
    draft: eligible && Boolean(kind.draft), preparation: placed };
}

export function applyMarket(state: TradingState, event: Pick<TradingEvent, 'effectIds'>, context: EffectContext, ledger: EffectLedger) {
  for (const id of event.effectIds) applyEffect(state, context.config.effects[id], context, ledger, 0, true);
}

export function applyCompetition(state: TradingState, effects: FinanceEffect[], ledger: EffectLedger) {
  for (const effect of effects) {
    if (effect.type === 'attack') ledger.investmentPnl += revalue(state.account, -effect.amount);
  }
}

/** 收盤：沒有利息或費用，只檢查總身家是否歸零。 */
export function settleTrade(state: TradingState) {
  return settleRisk(state.account);
}

export function copyTradingState(state: TradingState): TradingState {
  return { account: copyPortfolio(state.account), hedges: [...state.hedges], intelDay: state.intelDay, extraIntel: [...state.extraIntel], usedRelief: state.usedRelief, prepared: state.prepared.map(item => ({ ...item })) };
}
