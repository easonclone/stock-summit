import type { FinancialConfig, InvestmentKind, TradingCard, TradingEvent } from '../config/financial-settings';
import { debtBalance, depositBalance, marginLtv, netWorth, outstandingWorth } from './economy';
import type { RouteNode } from './node-map';
import { applyMarket, applyTrade, copyTradingState, marketTone, settleTrade, type EffectContext, type TradingState } from './trading-effects';

export interface TradeChoice { lane: number; card: number | null }

export interface DecisionView {
  config: FinancialConfig;
  characterId: string;
  day: number;
  state: TradingState;
  hand: readonly TradingCard[];
  routes: readonly RouteNode[];
  nextRow: readonly RouteNode[];
  knownEvent: TradingEvent | null;
  intelDay: number | null;
  eventToday: boolean;
  nextEventDay: number | null;
  recentLoss: boolean;
  eligibleAid: boolean;
  rank: number;
  gap: number;
}

export function forecastTrade(view: DecisionView, node: RouteNode, card: TradingCard | null) {
  const { config, day } = view;
  const kind = config.nodes.kinds[node.kind];
  const initial = netWorth(view.state.account);
  const draw = (marketDraw: number, market: TradingEvent | null, localDraw = marketDraw) => {
    const state = copyTradingState(view.state);
    const context: EffectContext = { config, day, eventDay: view.nextEventDay,
      recentLoss: view.recentLoss, marketDraw: localDraw, eligibleAid: view.eligibleAid };
    const action = applyTrade(state, kind, card, context);
    if (market) applyMarket(state, market, { ...context, marketDraw }, action.ledger);
    const risk = settleTrade(state, action.ledger, config, day === config.gameplay.turns);
    return { state, action, risk, delta: netWorth(state.account) - initial };
  };

  const knownToday = view.eventToday && view.intelDay === day ? view.knownEvent : null;
  const publicEvents = view.eventToday && !knownToday ? publicScenarios(config, view.recentLoss) : null;
  const guaranteed = knownToday?.target === 'all' ? knownToday : null;
  const base = draw(0.5, guaranteed);
  const downside = knownToday && !guaranteed && marketTone(knownToday, config) === 'negative'
    ? knownToday : guaranteed ?? publicEvents?.low ?? null;
  const upside = knownToday && !guaranteed && marketTone(knownToday, config) === 'positive'
    ? knownToday : guaranteed ?? publicEvents?.high ?? null;
  const bearish = draw(0, downside);
  const bullish = draw(1, upside);
  const average = publicEvents ? draw(0.5, publicEvents.typical) : base;
  const { account } = average.state;
  const { ledger } = base.action;
  const currentDebt = debtBalance(view.state.account);
  return {
    kind, available: base.action.funded, enabledCard: base.action.cardUsed, draft: base.action.draft,
    low: Math.min(bearish.delta, base.delta, bullish.delta),
    high: Math.max(bearish.delta, base.delta, bullish.delta),
    expected: (base.delta + average.delta + (bullish.delta + bearish.delta) * 0.5) / 3,
    riskOfLoss: Math.max(0, -bearish.delta), insolvencyRisk: Number(bearish.risk.insolvent) || Number(base.risk.insolvent),
    cash: account.cash, investment: account.investmentValue, deposits: depositBalance(account),
    debt: debtBalance(account), debtChange: debtBalance(account) - currentDebt, orderDebt: ledger.borrowed,
    invested: ledger.invested, sold: ledger.sold, repaid: ledger.repaid, deposited: ledger.deposited,
    fees: ledger.fees, hedgeCount: base.state.hedges.length, intelDay: base.state.intelDay,
    gainedHedge: base.state.hedges.some((hedge, index) => hedge > (view.state.hedges[index] ?? 0)),
    afterWorth: outstandingWorth(account), ltv: marginLtv(account), warnings: average.risk.warnings,
    exposureRisk: bearish.risk.call !== null, marginRequired: bearish.risk.call?.required ?? 0,
    synergyGain: ledger.synergyGain, synergies: ledger.synergies
  };
}

export function futureValue(node: RouteNode, next: readonly RouteNode[], kinds: Record<string, InvestmentKind>, tags: readonly string[]) {
  if (!node.next.length) return 0;
  const routes = node.next.map(lane => kinds[next[lane].kind]);
  return Math.max(...routes.map(kind => Number(kind.tags.some(tag => tags.includes(tag))))) + (routes.length - 1) * 0.25;
}

const cachedScenarios = new WeakMap<FinancialConfig, ReturnType<typeof calculateScenarios>[]>();
function calculateScenarios(config: FinancialConfig, recentLoss: boolean) {
  const pool = config.events.filter(event => !recentLoss || marketTone(event, config) !== 'negative');
  const candidates = pool.length ? pool : config.events;
  const impact = (event: TradingEvent) => {
    const effect = event.effectIds.map(id => config.effects[id]).find(effect => effect.type === 'price');
    return effect ? (effect.floor + effect.ceiling) / 2 : 0;
  };
  const ordered = [...candidates].sort((first, second) => impact(first) - impact(second));
  const average = candidates.reduce((sum, event) => sum + impact(event) * event.weight, 0) /
    candidates.reduce((sum, event) => sum + event.weight, 0);
  return { low: ordered[0], high: ordered.at(-1)!,
    typical: ordered.reduce((best, event) => Math.abs(impact(best) - average) < Math.abs(impact(event) - average) ? best : event) };
}

function publicScenarios(config: FinancialConfig, recentLoss: boolean) {
  let scenarios = cachedScenarios.get(config);
  if (!scenarios) {
    scenarios = [calculateScenarios(config, false), calculateScenarios(config, true)];
    cachedScenarios.set(config, scenarios);
  }
  return scenarios[Number(recentLoss)];
}
