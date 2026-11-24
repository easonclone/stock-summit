import type { FinanceEffect, FinancialConfig, InvestmentKind, TradingCard, TradingEvent } from '../config/financial-settings';
import {
  chargeClosingCost, chargeMarginInterest, copyPortfolio, debtBalance, invest, investmentOrder,
  lockDeposit, netWorth, repay, revalue, sellInvestment, type Portfolio
} from './economy';
import { settleRisk } from './financial-risk';

export interface PreparedCard {
  id: string;
  kind: 'dividend' | 'fee';
  amount: number;
  expires: number;
}

export interface TradingState {
  account: Portfolio;
  hedges: number[];
  intelDay: number | null;
  prepared: PreparedCard[];
}

export interface EffectContext {
  config: FinancialConfig;
  day: number;
  eventDay: number | null;
  recentLoss: boolean;
  marketDraw: number;
  eligibleAid: boolean;
  opponentCount: number;
}

export type CardBlock = 'no_stock' | 'full_shield' | 'no_news' | 'known_news' | 'cash_high' |
  'cannot_borrow' | 'no_debt' | 'low_cash' | 'no_opponent' | 'route' | 'need_downturn' | 'already_prepared' | 'no_days';

interface EffectLedger {
  invested: number;
  borrowed: number;
  sold: number;
  repaid: number;
  deposited: number;
  fees: number;
  dividends: number;
  investmentPnl: number;
  cashYield: number;
  protected: number;
  marketRate: number | null;
  synergies: number;
  synergyGain: number;
  interestWaived: boolean;
  preparedTriggers: number;
  feeSaved: number;
  cardGain: number;
  baseGain: number;
  stockCardGain: number;
  activeComboGain: number;
  maintenance: number;
}

function effectLedger(config: FinancialConfig): EffectLedger {
  return { invested: 0, borrowed: 0, sold: 0, repaid: 0, deposited: 0, fees: 0, dividends: 0,
    investmentPnl: 0, cashYield: 0, protected: 0, marketRate: null, synergies: 0, synergyGain: 0, interestWaived: false, preparedTriggers: 0, feeSaved: 0, cardGain: 0, baseGain: 0, stockCardGain: 0, activeComboGain: 0,
    maintenance: config.financial.callLtv };
}

export function marketTone(event: TradingEvent, config: FinancialConfig) {
  const price = event.effectIds.map(id => config.effects[id]).find(effect => effect.type === 'price');
  return !price ? 'neutral' : price.floor + price.ceiling > 0 ? 'positive' : price.floor + price.ceiling < 0 ? 'negative' : 'neutral';
}

function applyEffect(state: TradingState, effect: FinanceEffect, context: EffectContext, ledger: EffectLedger, extra = 0, market = false): true | CardBlock {
  const account = state.account;
  const rules = context.config.financial;
  switch (effect.type) {
    case 'invest': {
      const order = investmentOrder(account, effect.fraction, effect.borrow, context.day, rules);
      const coupon = order.borrowed > 0 ? state.prepared.find(item => item.kind === 'fee' && item.expires >= context.day) : undefined;
      if (coupon) {
        ledger.feeSaved += order.fee;
        ledger.preparedTriggers++;
        state.prepared = state.prepared.filter(item => item !== coupon);
        order.fee = 0;
      }
      invest(account, order);
      ledger.invested += order.stake;
      ledger.borrowed += order.borrowed;
      ledger.fees += order.fee;
      return order.stake > 0 || 'cannot_borrow';
    }
    case 'price': {
      const rate = effect.floor + (effect.ceiling - effect.floor) * context.marketDraw;
      const scenario = rate + extra;
      let protectedValue = 0;
      if (market && scenario < 0 && account.investmentValue && state.hedges.length) {
        protectedValue = scenario * state.hedges.shift()!;
      }
      const before = account.investmentValue;
      const profit = revalue(account, scenario - protectedValue);
      if (market) {
        ledger.marketRate = scenario;
        ledger.protected += profit - Math.round(before * Math.max(-1, scenario));
      }
      ledger.investmentPnl += profit;
      if (extra) ledger.synergyGain += profit - Math.round(before * rate);
      return profit !== 0 || 'no_stock';
    }
    case 'sell': {
      const sale = sellInvestment(account, effect.fraction);
      ledger.sold += sale;
      const paid = effect.repay ? repay(account, sale) : { margin: 0, bailout: 0 };
      ledger.repaid += paid.margin + paid.bailout;
      return sale > 0 || 'no_stock';
    }
    case 'deposit': {
      const deposited = lockDeposit(account, effect.fraction, context.day, rules);
      ledger.deposited += deposited;
      return deposited > 0 || 'low_cash';
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
      if (state.hedges.length >= rules.maxHedges) return 'full_shield';
      state.hedges.push(effect.protection);
      return true;
    }
    case 'intel': {
      if (context.eventDay === null) return 'no_news';
      if (state.intelDay === context.eventDay) return 'known_news';
      state.intelDay = context.eventDay;
      return true;
    }
    case 'maintenance':
      ledger.maintenance = Math.min(ledger.maintenance, effect.ltv);
      return true;
    case 'bailout': {
      const worth = netWorth(account);
      const borrowing = effect.amount + effect.fee;
      if (account.cash >= account.initialCapital * effect.cashThreshold) return 'cash_high';
      if (worth <= effect.fee || debtBalance(account) + borrowing > (worth - effect.fee) * rules.maxDebtToEquity || account.closingPayable) return 'cannot_borrow';
      account.cash += effect.amount;
      account.bailoutDebt += borrowing;
      account.stats.fees += effect.fee;
      ledger.fees += effect.fee;
      return true;
    }
    case 'repay': {
      const budget = Math.floor(account.cash * effect.fraction);
      const paid = repay(account, Math.min(debtBalance(account), Math.floor(budget / (1 + effect.feeRate))));
      const repaid = paid.margin + paid.bailout;
      const fee = Math.round(repaid * effect.feeRate);
      account.cash -= fee;
      account.stats.fees += fee;
      ledger.fees += fee;
      ledger.repaid += repaid;
      ledger.interestWaived ||= repaid > 0;
      return repaid > 0 || (debtBalance(account) ? 'low_cash' : 'no_debt');
    }
    case 'cash_yield': {
      if (account.cash < netWorth(account) * effect.threshold || netWorth(account) <= 0) return 'low_cash';
      const income = Math.round(account.cash * effect.rate);
      account.cash += income;
      account.stats.cashYield += income;
      ledger.cashYield += income;
      return income > 0 || 'low_cash';
    }
    case 'combo':
    case 'fee_coupon': return 'route';
  }
}

export function applyTrade(state: TradingState, kind: InvestmentKind, card: TradingCard | null, context: EffectContext, prepare = false) {
  const { config } = context;
  const ledger = effectLedger(config);
  const effects = card && !card.opponent ? card.effectIds.map(id => config.effects[id]) : [];
  let cardUsed = Boolean(card?.opponent && context.opponentCount);
  let cardBlock: CardBlock = card?.opponent ? 'no_opponent' : 'route';
  const coupon = effects.find(effect => effect.type === 'fee_coupon');
  const futureDividend = effects.find(effect => effect.type === 'combo' && effect.prepareDays !== undefined);
  const setUp = coupon && context.config.cardRules.preparations ? {
    kind: 'fee' as const, days: coupon.days, amount: 0
  } : prepare && context.config.cardRules.preparations && futureDividend?.type === 'combo' ? {
    kind: 'dividend' as const, days: futureDividend.prepareDays!, amount: futureDividend.amount
  } : null;
  if (prepare && !setUp) return { ledger, cardUsed: false, funded: false, cardImpact: null, cardBlock, draft: false, preparation: null };
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
  const openingDebt = debtBalance(state.account);
  for (const effect of effects) {
    if (effect.type === 'combo' || effect.type === 'fee_coupon') continue;
    const result = applyEffect(state, effect, context, ledger);
    if (result === true) cardUsed = true;
    else cardBlock = result;
  }
  const cardImpact = card ? {
    cash: state.account.cash - openingCash, debt: debtBalance(state.account) - openingDebt,
    sold: ledger.sold, repaid: ledger.repaid, fees: ledger.fees
  } : null;
  const eligible = kind.draft !== 'catchup' || context.eligibleAid;
  const combos = (setUp ? [] : effects).filter(effect => effect.type === 'combo')
    .filter(effect => kind.tags.includes(effect.nodeTag) && (!effect.afterLoss || context.recentLoss));
  if (effects.some(effect => effect.type === 'combo' && effect.afterLoss && !context.recentLoss)) cardBlock = 'need_downturn';
  const boosted = new Set<FinanceEffect>();
  let funded = true;
  for (const id of eligible ? kind.effectIds : []) {
    const effect = config.effects[id];
    if (effect.type === 'invest') {
      funded = applyEffect(state, effect, context, ledger) === true || effect.borrow === 0;
      if (!funded && combos.length) cardBlock = 'cannot_borrow';
      continue;
    }
    if (!funded) continue;
    if (!state.account.investmentValue && combos.some(combo => combo.mode === effect.type)) cardBlock = 'no_stock';
    const pendingDividend = effect.type === 'dividend' && Math.round(state.account.investmentValue * effect.rate) > 0
      ? state.prepared.find(item => item.kind === 'dividend' && item.expires >= context.day) : undefined;
    const matching = state.account.investmentValue ? combos.filter(combo => combo.mode === effect.type) : [];
    const activeBonus = matching.reduce((sum, combo) => sum + combo.amount, 0);
    const bonus = Math.max(activeBonus, pendingDividend?.amount ?? 0);
    const before = ledger.synergyGain;
    applyEffect(state, effect, context, ledger, bonus);
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
  if (preparation && cardUsed) state.prepared.push(preparation);
  ledger.cardGain += ledger.cashYield + ledger.feeSaved;
  return { ledger, cardUsed, funded, cardImpact, cardBlock: card && !cardUsed ? cardBlock : null,
    draft: eligible && Boolean(kind.draft), preparation: cardUsed ? preparation : null };
}

export function applyMarket(state: TradingState, event: Pick<TradingEvent, 'effectIds'>, context: EffectContext, ledger: EffectLedger) {
  for (const id of event.effectIds) applyEffect(state, context.config.effects[id], context, ledger, 0, true);
}

export function settleTrade(state: TradingState, ledger: EffectLedger, config: FinancialConfig, finalDay: boolean) {
  if (!ledger.interestWaived) ledger.fees += chargeMarginInterest(state.account, config.financial);
  if (finalDay) ledger.fees += chargeClosingCost(state.account);
  const result = settleRisk(state.account, config.financial, ledger.maintenance);
  ledger.fees += result.call?.fee ?? 0;
  return result;
}

export function copyTradingState(state: TradingState): TradingState {
  return { account: copyPortfolio(state.account), hedges: [...state.hedges], intelDay: state.intelDay, prepared: [...state.prepared] };
}
