import type { FinanceEffect, FinancialConfig, InvestmentKind, TradingCard, TradingEvent } from '../config/financial-settings';
import {
  chargeClosingCost, chargeMarginInterest, copyPortfolio, debtBalance, invest, investmentOrder,
  lockDeposit, netWorth, repay, revalue, sellInvestment, type Portfolio
} from './economy';
import { settleRisk } from './financial-risk';

export interface PreparedCard {
  id: string;
  kind: 'dividend' | 'fee' | 'deposit' | 'stock' | 'rally' | 'short' | 'safe_shield';
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
  eligibleAid: boolean;
  opponentCount: number;
  followingEventDay?: number | null;
  marketToday?: boolean;
  creditBlocked?: boolean;
}

export type CardBlock = 'no_stock' | 'full_shield' | 'no_news' | 'known_news' | 'cash_high' |
  'cannot_borrow' | 'no_debt' | 'low_cash' | 'no_opponent' | 'route' | 'need_downturn' | 'already_prepared' | 'no_days' | 'no_deposit' | 'recovery_required' | 'already_used' | 'equity_high';

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
  marketCardGain: number;
  bonusDraw: boolean;
  cardDraft: boolean;
  interestMultiplier: number;
}

function effectLedger(config: FinancialConfig): EffectLedger {
  return { invested: 0, borrowed: 0, sold: 0, repaid: 0, deposited: 0, fees: 0, dividends: 0,
    investmentPnl: 0, cashYield: 0, protected: 0, marketRate: null, synergies: 0, synergyGain: 0, interestWaived: false, preparedTriggers: 0, feeSaved: 0, cardGain: 0, baseGain: 0, stockCardGain: 0, activeComboGain: 0,
    marketCardGain: 0, bonusDraw: false, cardDraft: false, interestMultiplier: 1,
    maintenance: config.financial.callLtv };
}

export function marketTone(event: TradingEvent, config: FinancialConfig) {
  const price = event.effectIds.map(id => config.effects[id]).find(effect => effect.type === 'price');
  return !price ? 'neutral' : price.floor + price.ceiling > 0 ? 'positive' : price.floor + price.ceiling < 0 ? 'negative' : 'neutral';
}

const ownStocks = (account: Portfolio) => Math.max(0, account.investmentValue - account.marginDebt);

export function hedgeLayers(state: TradingState) {
  return state.hedges.length + state.prepared.filter(item => item.kind === 'safe_shield').length;
}

export function openingCardIncome(state: TradingState, rules: FinancialConfig['financial']) {
  const { account } = state;
  let deposit = 0;
  let stock = 0;
  let triggers = 0;
  for (const effect of state.prepared) {
    if (effect.kind === 'deposit') {
      const reward = account.deposits.reduce((total, item) =>
        total + Math.round(Math.round(item.balance * rules.depositDailyRate) * effect.amount), 0);
      deposit += reward;
      if (reward && !effect.incomeTriggered) { effect.incomeTriggered = true; triggers++; }
    }
    if (effect.kind === 'stock') {
      const reward = Math.min(effect.cap ?? Infinity, Math.round(ownStocks(account) * effect.amount));
      stock += reward;
      if (reward && !effect.incomeTriggered) { effect.incomeTriggered = true; triggers++; }
    }
  }
  account.cash += deposit + stock;
  account.stats.depositYield += deposit;
  account.stats.cashYield += stock;
  return { deposit, stock, triggers };
}

function applyEffect(state: TradingState, effect: FinanceEffect, context: EffectContext, ledger: EffectLedger, extra = 0, market = false): true | CardBlock {
  const account = state.account;
  const rules = context.config.financial;
  switch (effect.type) {
    case 'invest': {
      if (effect.borrow > 0 && context.creditBlocked) return 'cannot_borrow';
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
    case 'cash_grant':
      if (effect.recovered && !account.bankruptcyCount) return 'recovery_required';
      if (effect.recovered && state.usedRelief) return 'already_used';
      state.usedRelief ||= effect.recovered === true;
      account.cash += effect.amount;
      account.stats.cashYield += effect.amount;
      ledger.cashYield += effect.amount;
      return true;
    case 'redeem': {
      if (!account.deposits.length) return 'no_deposit';
      account.cash += account.deposits.reduce((sum, item) => sum + item.balance, 0);
      account.deposits = [];
      return true;
    }
    case 'card_draft':
      if (context.day >= configLastDay(context)) return 'no_days';
      ledger.cardDraft = true;
      return true;
    case 'combo':
    case 'timed':
    case 'route_card':
    case 'attack':
    case 'fee_coupon': return 'route';
  }
}

const configLastDay = (context: EffectContext) => context.config.gameplay.turns;

function pairedEffect(effect: FinanceEffect, bonus: number): FinanceEffect {
  switch (effect.type) {
    case 'hedge': return { ...effect, protection: Math.min(1, effect.protection + bonus) };
    case 'cash_yield': return { ...effect, rate: Math.min(1, effect.rate + bonus) };
    case 'sell': return { ...effect, fraction: Math.min(1, effect.fraction + bonus) };
    case 'repay': return { ...effect, feeRate: Math.max(0, effect.feeRate - bonus) };
    case 'cash_grant': return { ...effect, amount: Math.round(effect.amount * (1 + bonus)) };
    case 'bailout': return { ...effect, fee: Math.max(0, effect.fee - Math.round(effect.amount * bonus)) };
    default: return effect;
  }
}

export function applyTrade(state: TradingState, kind: InvestmentKind, card: TradingCard | null, context: EffectContext, prepare = false) {
  const { config } = context;
  const ledger = effectLedger(config);
  const effects = card && !card.opponent ? card.effectIds.map(id => config.effects[id]) : [];
  let cardUsed = Boolean(card?.opponent && context.opponentCount);
  let cardBlock: CardBlock = card?.opponent ? 'no_opponent' : 'route';
  const coupon = effects.find(effect => effect.type === 'fee_coupon');
  const pairing = config.cardRules.expanded && card?.pairing && kind.tags.some(tag => card.pairing!.tags.includes(tag)) ? card.pairing.amount : 0;
  const timed = effects.find(effect => effect.type === 'timed');
  const routeCard = effects.find(effect => effect.type === 'route_card');
  const hasPrice = kind.effectIds.some(id => config.effects[id].type === 'price');
  const routeBonus = routeCard && (routeCard.mode === 'cushion' || netWorth(state.account) < state.account.initialCapital * routeCard.equity!);
  if (routeCard?.mode === 'desperate' && !routeBonus) cardBlock = 'equity_high';
  let routeApplied = false;
  let placed: PreparedCard | null = null;
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
    if (effect.type === 'combo' || effect.type === 'fee_coupon' || effect.type === 'timed' || effect.type === 'route_card') continue;
    const result = applyEffect(state, pairing ? pairedEffect(effect, pairing) : effect, context, ledger);
    if (result === true) { cardUsed = true; if (pairing) ledger.synergies++; }
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
    let extra = bonus;
    if (routeCard && routeBonus && effect.type === 'price' && ownStocks(state.account) > 0) {
      const roll = effect.floor + (effect.ceiling - effect.floor) * context.marketDraw;
      const equityShare = Math.min(1, ownStocks(state.account) / state.account.investmentValue);
      if (routeCard.mode === 'desperate' || roll < 0) {
        extra += roll * equityShare * routeCard.amount * (routeCard.mode === 'cushion' ? -1 : 1);
        routeApplied = true;
      }
    }
    applyEffect(state, effect, context, ledger, extra);
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
    if (routeCard.mode === 'cushion' && hasPrice && ledger.synergyGain > 0) ledger.synergies++;
  }
  if (timed && card) {
    const hasMarket = context.eventDay !== null || context.marketToday;
    const isYield = timed.kind === 'deposit' || timed.kind === 'stock';
    if (state.prepared.some(item => item.id === card.id)) cardBlock = 'already_prepared';
    else if (isYield && context.day >= configLastDay(context)) cardBlock = 'no_days';
    else if (!isYield && !hasMarket) cardBlock = 'no_news';
    else if (timed.kind === 'deposit' && !state.account.deposits.length) cardBlock = 'no_deposit';
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
  return { ledger, cardUsed, funded, cardImpact, cardBlock: card && !cardUsed ? cardBlock : null,
    draft: eligible && Boolean(kind.draft), preparation: placed };
}

export function applyMarket(state: TradingState, event: Pick<TradingEvent, 'effectIds'>, context: EffectContext, ledger: EffectLedger) {
  for (const id of event.effectIds) applyEffect(state, context.config.effects[id], context, ledger, 0, true);
}

export function applyCompetition(state: TradingState, effects: FinanceEffect[], ledger: EffectLedger, context: EffectContext) {
  for (const effect of effects) {
    if (effect.type === 'maintenance') applyEffect(state, effect, context, ledger);
    if (effect.type !== 'attack') continue;
    if (effect.mode === 'price') ledger.investmentPnl += revalue(state.account, -effect.amount);
    if (effect.mode === 'interest') ledger.interestMultiplier = Math.max(ledger.interestMultiplier, 1 + effect.amount);
  }
}

export function settleTrade(state: TradingState, ledger: EffectLedger, config: FinancialConfig, finalDay: boolean) {
  if (!ledger.interestWaived) ledger.fees += chargeMarginInterest(state.account,
    ledger.interestMultiplier > 1 ? { ...config.financial, marginDailyRate: config.financial.marginDailyRate * ledger.interestMultiplier } : config.financial);
  if (finalDay) ledger.fees += chargeClosingCost(state.account);
  const result = settleRisk(state.account, config.financial, ledger.maintenance);
  ledger.fees += result.call?.fee ?? 0;
  return result;
}

export function copyTradingState(state: TradingState): TradingState {
  return { account: copyPortfolio(state.account), hedges: [...state.hedges], intelDay: state.intelDay, extraIntel: [...state.extraIntel], usedRelief: state.usedRelief, prepared: [...state.prepared] };
}
