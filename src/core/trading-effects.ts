import type { FinanceEffect, FinancialConfig, InvestmentKind, TradingCard, TradingEvent } from '../config/financial-settings';
import {
  chargeClosingCost, chargeMarginInterest, copyPortfolio, debtBalance, invest, investmentOrder,
  lockDeposit, netWorth, repay, revalue, sellInvestment, type Portfolio
} from './economy';
import { settleRisk } from './financial-risk';

export interface TradingState {
  account: Portfolio;
  hedges: number[];
  intelDay: number | null;
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
  synergies: number;
  synergyGain: number;
  interestWaived: boolean;
  maintenance: number;
}

function effectLedger(config: FinancialConfig): EffectLedger {
  return { invested: 0, borrowed: 0, sold: 0, repaid: 0, deposited: 0, fees: 0, dividends: 0,
    investmentPnl: 0, cashYield: 0, protected: 0, synergies: 0, synergyGain: 0, interestWaived: false,
    maintenance: config.financial.callLtv };
}

export function marketTone(event: TradingEvent, config: FinancialConfig) {
  const price = event.effectIds.map(id => config.effects[id]).find(effect => effect.type === 'price');
  return !price ? 'neutral' : price.floor + price.ceiling > 0 ? 'positive' : price.floor + price.ceiling < 0 ? 'negative' : 'neutral';
}

function applyEffect(state: TradingState, effect: FinanceEffect, context: EffectContext, ledger: EffectLedger, extra = 0, market = false): boolean {
  const account = state.account;
  const rules = context.config.financial;
  switch (effect.type) {
    case 'invest': {
      const order = investmentOrder(account, effect.fraction, effect.borrow, context.day, rules);
      invest(account, order);
      ledger.invested += order.stake;
      ledger.borrowed += order.borrowed;
      ledger.fees += order.fee;
      return order.stake > 0;
    }
    case 'price': {
      const rate = effect.floor + (effect.ceiling - effect.floor) * context.marketDraw;
      const scenario = rate + extra;
      let protectedValue = 0;
      if (market && scenario < 0 && account.investmentValue && state.hedges.length) {
        protectedValue = scenario * state.hedges.shift()!;
        ledger.protected += Math.round(-protectedValue * account.investmentValue);
      }
      const before = account.investmentValue;
      const profit = revalue(account, scenario - protectedValue);
      ledger.investmentPnl += profit;
      if (extra) ledger.synergyGain += profit - Math.round(before * rate);
      return profit !== 0;
    }
    case 'sell': {
      const sale = sellInvestment(account, effect.fraction);
      ledger.sold += sale;
      const paid = effect.repay ? repay(account, sale) : { margin: 0, bailout: 0 };
      ledger.repaid += paid.margin + paid.bailout;
      return sale > 0;
    }
    case 'deposit': {
      const deposited = lockDeposit(account, effect.fraction, context.day, rules);
      ledger.deposited += deposited;
      return deposited > 0;
    }
    case 'dividend': {
      const dividend = Math.round(account.investmentValue * effect.rate * (1 + extra));
      account.cash += dividend;
      account.stats.dividends += dividend;
      ledger.dividends += dividend;
      if (extra) ledger.synergyGain += dividend - Math.round(account.investmentValue * effect.rate);
      return dividend > 0;
    }
    case 'hedge': {
      if (state.hedges.length >= rules.maxHedges) return false;
      state.hedges.push(effect.protection);
      return true;
    }
    case 'intel': {
      if (context.eventDay === null || state.intelDay === context.eventDay) return false;
      state.intelDay = context.eventDay;
      return true;
    }
    case 'maintenance':
      ledger.maintenance = Math.min(ledger.maintenance, effect.ltv);
      return true;
    case 'bailout': {
      const worth = netWorth(account);
      const borrowing = effect.amount + effect.fee;
      if (account.cash >= account.initialCapital * effect.cashThreshold || worth <= effect.fee ||
        debtBalance(account) + borrowing > (worth - effect.fee) * rules.maxDebtToEquity || account.closingPayable) return false;
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
      return repaid > 0;
    }
    case 'cash_yield': {
      if (account.cash < netWorth(account) * effect.threshold || netWorth(account) <= 0) return false;
      const income = Math.round(account.cash * effect.rate);
      account.cash += income;
      account.stats.cashYield += income;
      ledger.cashYield += income;
      return income > 0;
    }
    case 'combo': return false;
  }
}

export function applyTrade(state: TradingState, kind: InvestmentKind, card: TradingCard | null, context: EffectContext) {
  const { config } = context;
  const ledger = effectLedger(config);
  const effects = card && !card.opponent ? card.effectIds.map(id => config.effects[id]) : [];
  let cardUsed = Boolean(card?.opponent && context.opponentCount);
  for (const effect of effects) {
    if (effect.type !== 'combo' && applyEffect(state, effect, context, ledger)) cardUsed = true;
  }
  const eligible = kind.draft !== 'catchup' || context.eligibleAid;
  const combos = effects.filter(effect => effect.type === 'combo')
    .filter(effect => kind.tags.includes(effect.nodeTag) && (!effect.afterLoss || context.recentLoss));
  let funded = true;
  for (const id of eligible ? kind.effectIds : []) {
    const effect = config.effects[id];
    if (effect.type === 'invest') {
      funded = applyEffect(state, effect, context, ledger) || effect.borrow === 0;
      continue;
    }
    if (!funded) continue;
    const matching = state.account.investmentValue ? combos.filter(combo => combo.mode === effect.type) : [];
    const bonus = matching.reduce((sum, combo) => sum + combo.amount, 0);
    applyEffect(state, effect, context, ledger, bonus);
    ledger.synergies += matching.length;
    cardUsed ||= matching.length > 0;
  }
  return { ledger, cardUsed, funded, draft: eligible && Boolean(kind.draft) };
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
  return { account: copyPortfolio(state.account), hedges: [...state.hedges], intelDay: state.intelDay };
}
