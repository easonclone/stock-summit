import type { FinancialConfig, TradingCard, TradingDifficulty } from '../config/financial-settings';
import { debtBalance, netWorth } from './economy';
import type { RouteNode } from './node-map';
import type { Random } from './random';
import { cardPreparationAvailable, forecastTrade, futureValue, type DecisionView, type TradeChoice } from './trade-preview';

export const strategies = ['random', 'steady', 'cash', 'leverage', 'combo', 'hedge', 'mixed', 'bankrupt'] as const;
export type Strategy = typeof strategies[number];
export type Planner = (view: DecisionView, random: Random) => TradeChoice;

const preferred: Record<Strategy, string[]> = {
  random: [], steady: ['steady', 'income'], cash: ['cash', 'income'], leverage: ['margin', 'income'],
  combo: ['buy', 'income', 'utility'], hedge: ['defense', 'steady'], mixed: ['buy', 'income', 'defense'], bankrupt: ['margin', 'speculative']
};
const riskWeight: Record<Strategy, number> = {
  random: 0, steady: 0.53, cash: 0.27, leverage: 0.08, combo: 0.22, hedge: 0.29, mixed: 0.18, bankrupt: -0.32
};

export function cardRetention(card: TradingCard, config: FinancialConfig, view?: DecisionView) {
  const types = card.effectIds.map(id => config.effects[id]);
  const equity = view ? netWorth(view.state.account) : config.financial.initialCapital;
  const position = view?.state.account.investmentValue ?? 0;
  return Math.max(...types.map(effect => {
    switch (effect.type) {
      case 'combo': return 120 + effect.amount * 280 + (view?.routes.some(node => config.nodes.kinds[node.kind].tags.includes(effect.nodeTag)) ? 125 : 0);
      case 'hedge': return 160 + effect.protection * 220 + (view?.eventToday && position > 0 ? 220 : 0);
      case 'intel': return view && view.nextEventDay === null ? 0 : view?.intelDay ? 60 : 185;
      case 'sell': return position ? 150 + Math.min(350, position * 0.04) : 120;
      case 'bailout': return equity < config.financial.initialCapital * 0.3 ? 60 : 160;
      case 'repay': return view && debtBalance(view.state.account) > 0 ? 260 : 80;
      case 'cash_yield': return view && view.state.account.cash > equity * 0.55 ? 340 : 175;
      case 'maintenance': return view?.opponents.length ? 285 : 120;
      default: return 100;
    }
  }));
}

export function chooseTrade(view: DecisionView, random: Random, strategy: Strategy = 'mixed', difficulty: TradingDifficulty = 'normal'): TradeChoice {
  const options = view.routes.flatMap(node => {
    const plain = forecastTrade(view, node, null);
    const cards = view.hand.flatMap((card, slot) => {
      const forecast = forecastTrade(view, node, card);
      const preparation = cardPreparationAvailable(view.config, card) ? forecastTrade(view, node, card, false, true) : null;
      return [
        ...(forecast.available && forecast.enabledCard ? [{ node, slot, forecast, card, prepare: false }] : []),
        ...(preparation?.available && preparation.enabledCard ? [{ node, slot, forecast: preparation, card, prepare: true }] : [])
      ];
    });
    return [...(plain.available ? [{ node, slot: null, forecast: plain, card: null, prepare: false }] : []), ...cards];
  });
  if (!options.length) return { lane: view.routes[0].lane, card: null };
  if (strategy === 'random') {
    const option = options[Math.floor(random() * options.length)];
    return { lane: option.node.lane, card: option.slot, prepare: option.prepare };
  }
  const { config, state, day } = view;
  const { npc } = config;
  const equity = Math.max(1, netWorth(state.account));
  const remaining = config.gameplay.turns - day;
  const behind = Math.max(0, view.gap) / (equity + Math.max(0, view.gap));
  const classWeight = (node: RouteNode) => {
    const kind = config.nodes.kinds[node.kind];
    if (strategy === 'steady') return kind.tags.includes('steady') ? 480 : kind.tags.includes('income') ? 275 : 0;
    if (strategy === 'cash') return kind.effectIds.some(id => config.effects[id].type === 'deposit') ? 520 : kind.tags.includes('cash') ? 120 : 0;
    if (strategy === 'hedge') {
      if (kind.effectIds.some(id => config.effects[id].type === 'hedge') && state.hedges.length === 0) return 250;
      return kind.tags.includes('steady') && state.hedges.length ? 325 : 0;
    }
    if (strategy === 'combo') return kind.tags.includes('utility') && remaining > 0 ? 90 : 0;
    if (strategy === 'leverage' || strategy === 'bankrupt') return kind.tags.includes('margin') ? 5200 : 0;
    if (strategy === 'mixed') return kind.tags.includes('margin') && !view.eventToday ? 390 : 0;
    return 0;
  };
  let selected = options[0];
  let best = -Infinity;
  const available = strategy === 'steady' && options.some(option => !option.forecast.orderDebt)
    ? options.filter(option => !option.forecast.orderDebt) : options;
  for (const option of available) {
    const { forecast, card, node } = option;
    const possibleLoss = forecast.riskOfLoss * (riskWeight[strategy] * (1 - behind * 0.5));
    const insolvency = forecast.insolvencyRisk * npc.bankruptcyPenalty * (0.55 + (remaining === 0 ? 0.75 : 0))
      * (strategy === 'bankrupt' ? -1 : strategy === 'leverage' ? 0.14 : 1);
    const liquidity = Math.max(0, equity * (strategy === 'cash' ? 0.35 : 0.18) - forecast.cash) * npc.liquidity;
    const debt = Math.max(0, forecast.debt - equity * 0.35) * (strategy === 'leverage' || strategy === 'bankrupt' ? 0 : 0.035);
    const ltvPressure = Math.min(1, forecast.ltv) * (strategy === 'leverage' || strategy === 'bankrupt' ? 0 : 160);
    const warnings = (Number(forecast.warnings.length > 0) + Number(forecast.exposureRisk)) * npc.warningPenalty;
    const hedge = forecast.gainedHedge && (remaining > 0 || view.eventToday) && (forecast.investment > 0 || remaining > 2)
      ? npc.hedgeValue * (strategy === 'hedge' ? 2 : 1) : 0;
    const intel = forecast.intelDay && forecast.intelDay !== state.intelDay && remaining > 0 ? npc.intelValue : 0;
    const competition = forecast.opponents.length * npc.warningPenalty * (0.4 + behind);
    const reserve = card && remaining > 0 ? (npc.cardReserve + cardRetention(card, config, view) * 0.13) *
      (view.hand.length < 3 ? 1.5 : 0.6) : 0;
    const prep = forecast.preparation;
    const nextKinds = node.next.map(lane => config.nodes.kinds[view.nextRow[lane].kind]);
    const preparedValue = prep?.kind === 'dividend' ? forecast.investment *
      Math.max(0, ...nextKinds.flatMap(kind => kind.effectIds.map(id => config.effects[id])
        .filter(effect => effect.type === 'dividend').map(effect => effect.rate))) * prep.amount * 0.65 :
      prep?.kind === 'fee' && (strategy === 'leverage' || strategy === 'bankrupt' || strategy === 'mixed')
        ? forecast.cash * config.financial.originationFee * (nextKinds.some(kind => kind.tags.includes('margin')) ? 1 : 0.25) : 0;
    const synergy = forecast.synergies && strategy === 'combo' ? 450 : 0;
    const draft = forecast.draft && remaining > 0 ? npc.draftValue * (strategy === 'combo' ? 1.6 : 1) : 0;
    const future = remaining > 0 ? npc.lookahead * (difficulty === 'easy' ? 0.5 : 1) * 260 *
      futureValue(node, view.nextRow, config.nodes.kinds, preferred[strategy]) : 0;
    const expected = forecast.expected + (strategy === 'cash' && remaining > 0 ? forecast.deposited * 0.022 : 0);
    const pressure = view.rank === 1 ? Math.max(0, -forecast.low) * 0.04 : 0;
    const score = expected - possibleLoss - insolvency - liquidity - ltvPressure - debt - warnings - reserve - pressure +
      hedge + intel + draft + synergy + future + preparedValue + competition + classWeight(node) + random() * npc[difficulty];
    if (score > best) { best = score; selected = option; }
  }
  return { lane: selected.node.lane, card: selected.slot, prepare: selected.prepare };
}
