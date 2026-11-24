import type { AllocationOption, FinancialConfig, InvestmentKind, TradingCard, TradingEvent } from '../config/financial-settings';
import { netWorth } from './economy';
import type { RouteNode } from './node-map';
import { applyMarket, applyTrade, copyTradingState, marketTone, settleTrade, type EffectContext, type TradingState } from './trading-effects';

/** Allocation id is locked with the route and card before any market result is known. */
export interface TradeChoice { lane: number; card: number | null; prepare?: boolean; allocation?: string }

export interface DecisionView {
  config: FinancialConfig;
  characterId: string;
  day: number;
  state: TradingState;
  /** Allocation kept from the previous day; the default for today's choice. */
  allocation: string;
  hand: readonly TradingCard[];
  routes: readonly RouteNode[];
  nextRow: readonly RouteNode[];
  knownEvent: TradingEvent | null;
  intelDay: number | null;
  eventToday: boolean;
  publicEvents: readonly TradingEvent[];
  nextEventDay: number | null;
  recentLoss: boolean;
  eligibleAid: boolean;
  rank: number;
  gap: number;
  opponents: readonly { id: string; name: string }[];
  attackTargets: Readonly<Record<NonNullable<TradingCard['opponent']>, readonly { id: string; name: string }[]>>;
  followingEventDay: number | null;
}

export function allocationOption(config: FinancialConfig, id: string | undefined): AllocationOption {
  return config.allocation.options.find(option => option.id === id)
    ?? config.allocation.options.find(option => option.id === config.allocation.initial)!;
}

export function targetsFor(view: DecisionView, card: TradingCard | null) {
  return card?.opponent ? view.attackTargets[card.opponent] : [];
}

export function forecastTrade(view: DecisionView, node: RouteNode, card: TradingCard | null, showCardImpact = false, prepare = false, allocationId = view.allocation) {
  const { config, day } = view;
  const allocation = allocationOption(config, allocationId);
  const kind = config.nodes.kinds[node.kind];
  const initial = netWorth(view.state.account);
  const draw = (marketDraw: number, market: TradingEvent | null, localDraw = marketDraw, selectedCard = card) => {
    const state = copyTradingState(view.state);
    const context: EffectContext = { config, day, eventDay: view.nextEventDay, allocation,
      recentLoss: view.recentLoss, marketDraw: localDraw, eligibleAid: view.eligibleAid, opponentCount: targetsFor(view, selectedCard).length, followingEventDay: view.followingEventDay, marketToday: view.eventToday };
    const action = applyTrade(state, kind, selectedCard, context, selectedCard === card && prepare);
    if (market) applyMarket(state, market, { ...context, marketDraw }, action.ledger);
    const risk = settleTrade(state);
    return { state, action, risk, delta: netWorth(state.account) - initial };
  };

  const knownToday = view.eventToday && view.intelDay === day ? view.knownEvent : null;
  const publicEvents = view.eventToday && !knownToday && view.publicEvents.length ? publicScenarios(config, view.publicEvents) : null;
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
  const extraProtection = showCardImpact && card && base.action.cardUsed && bearish.action.ledger.protected
    ? Math.max(0, bearish.action.ledger.protected - draw(0, downside, 0, null).action.ledger.protected) : 0;
  return {
    kind, available: base.action.funded, enabledCard: base.action.cardUsed, draft: base.action.draft || ledger.cardDraft,
    low: Math.min(bearish.delta, base.delta, bullish.delta),
    high: Math.max(bearish.delta, base.delta, bullish.delta),
    expected: (base.delta + average.delta + (bullish.delta + bearish.delta) * 0.5) / 3,
    riskOfLoss: Math.max(0, -bearish.delta), insolvencyRisk: Number(bearish.risk.insolvent) || Number(base.risk.insolvent),
    cash: account.cash, investment: account.investmentValue,
    rebalance: ledger.rebalance, sold: ledger.sold,
    marketLow: bearish.action.ledger.baseMarket, marketHigh: bullish.action.ledger.baseMarket,
    fees: ledger.fees, hedgeCount: base.state.hedges.length, intelDay: base.state.intelDay,
    gainedHedge: base.state.hedges.some((hedge, index) => hedge > (view.state.hedges[index] ?? 0)),
    afterWorth: netWorth(account),
    synergyGain: ledger.synergyGain, synergies: ledger.synergies, cardImpact: base.action.cardImpact, cardBlock: base.action.cardBlock, extraProtection,
    preparation: base.action.preparation, baseGain: ledger.baseGain, activeComboGain: ledger.activeComboGain, feeSaved: ledger.feeSaved,
    opponents: targetsFor(view, card).map(opponent => opponent.name), bonusDraw: ledger.bonusDraw, intelCount: [base.state.intelDay, ...base.state.extraIntel].filter(day => day !== null).length
  };
}

export function cardPreparationAvailable(config: FinancialConfig, card: TradingCard) {
  return config.cardRules.preparations && card.effectIds.some(id => {
    const effect = config.effects[id];
    return effect.type === 'combo' && effect.prepareDays !== undefined;
  });
}

export function inspectCard(view: DecisionView, node: RouteNode, card: TradingCard, prepare = false, allocationId = view.allocation) {
  return applyTrade(copyTradingState(view.state), view.config.nodes.kinds[node.kind], card, {
    config: view.config, allocation: allocationOption(view.config, allocationId), day: view.day, eventDay: view.nextEventDay, recentLoss: view.recentLoss,
    marketDraw: 0.5, eligibleAid: view.eligibleAid, opponentCount: targetsFor(view, card).length, followingEventDay: view.followingEventDay, marketToday: view.eventToday
  }, prepare);
}

export function handAvailability(view: DecisionView, allocationId = view.allocation) {
  return view.hand.map(card => {
    const results = view.routes.flatMap(node => [
      inspectCard(view, node, card, false, allocationId),
      ...(cardPreparationAvailable(view.config, card) ? [inspectCard(view, node, card, true, allocationId)] : [])
    ]);
    return { usable: results.some(result => result.cardUsed), routeBlocked: results.length > 0 &&
      results.every(result => result.cardBlock === 'route') };
  });
}

export function futureValue(node: RouteNode, next: readonly RouteNode[], kinds: Record<string, InvestmentKind>, tags: readonly string[]) {
  if (!node.next.length) return 0;
  const routes = node.next.map(lane => kinds[next[lane].kind]);
  return Math.max(...routes.map(kind => Number(kind.tags.some(tag => tags.includes(tag))))) + (routes.length - 1) * 0.25;
}

const cachedScenarios = new WeakMap<readonly TradingEvent[], ReturnType<typeof calculateScenarios>>();
function calculateScenarios(config: FinancialConfig, candidates: readonly TradingEvent[]) {
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

function publicScenarios(config: FinancialConfig, candidates: readonly TradingEvent[]) {
  let scenarios = cachedScenarios.get(candidates);
  if (!scenarios) {
    scenarios = calculateScenarios(config, candidates);
    cachedScenarios.set(candidates, scenarios);
  }
  return scenarios;
}
