import type { FinancialConfig, TradingCard, TradingDifficulty } from '../config/financial-settings';
import { netWorth } from './economy';
import type { Random } from './random';
import { cardPreparationAvailable, forecastTrade, type DecisionView, type TradeChoice } from './trade-preview';
import { marketTone } from './trading-effects';

/** 模擬與 NPC 共用的打法；與角色無關，玩家和電腦用同一套規則。 */
export const strategies = ['random', 'cash', 'half', 'all', 'mixed', 'combo', 'hedge'] as const;
export type Strategy = typeof strategies[number];
export type Planner = (view: DecisionView, random: Random) => TradeChoice;

const ladder = ['cash', 'half', 'all'];
const baseAllocation: Record<Strategy, string> = {
  random: 'half', cash: 'cash', half: 'half', all: 'all', mixed: 'all', combo: 'half', hedge: 'half'
};
const riskWeight: Record<Strategy, number> = {
  random: 0, cash: 0.4, half: 0.25, all: 0.05, mixed: 0.18, combo: 0.15, hedge: 0.3
};

/** 只看公開新聞、自己的情報與自己的資產，決定今天買多少股票。 */
export function chooseAllocation(view: DecisionView, random: Random, strategy: Strategy): string {
  const { config, state, day } = view;
  const ids = config.allocation.options.map(option => option.id);
  if (strategy === 'random') return ids[Math.floor(random() * ids.length)];
  let id = baseAllocation[strategy];
  if (strategy === 'cash' || strategy === 'half' || strategy === 'all') return ids.includes(id) ? id : config.allocation.initial;
  const step = (value: string, by: number) => ladder[Math.max(0, Math.min(ladder.length - 1, ladder.indexOf(value) + by))];
  const known = view.eventToday && view.intelDay === day ? view.knownEvent : null;
  const tone = known ? marketTone(known, config) : null;
  const shielded = state.hedges.length > 0 || state.prepared.some(item => item.kind === 'safe_shield' || item.kind === 'short');
  if (tone === 'negative') id = shielded ? 'half' : 'cash';
  else if (tone === 'positive') id = 'all';
  else if (view.eventToday && !shielded) id = step(id, strategy === 'mixed' ? -1 : 0);
  const remaining = config.gameplay.turns - day;
  const equity = Math.max(1, netWorth(state.account));
  if (view.rank > 1 && remaining <= 4 && view.gap > equity * 0.08) id = 'all';
  return ids.includes(id) ? id : config.allocation.initial;
}

export function cardRetention(card: TradingCard, config: FinancialConfig, view?: DecisionView) {
  const types = card.effectIds.map(id => config.effects[id]);
  const position = view?.state.account.investmentValue ?? 0;
  return Math.max(...types.map(effect => {
    switch (effect.type) {
      case 'combo': return 160 + effect.amount * 280;
      case 'hedge': return 160 + effect.protection * 220 + (view?.eventToday && position > 0 ? 220 : 0);
      case 'intel': return view && view.nextEventDay === null ? 0 : view?.intelDay ? 60 : 185;
      case 'cash_yield': return view && view.state.account.cash > netWorth(view.state.account) * 0.45 ? 300 : 150;
      case 'attack': return view?.opponents.length ? 220 : 120;
      default: return 100;
    }
  }));
}

export function chooseTrade(view: DecisionView, random: Random, strategy: Strategy = 'mixed', difficulty: TradingDifficulty = 'normal'): TradeChoice {
  const allocation = chooseAllocation(view, random, strategy);
  const node = view.routes[0];
  if (!node) return { lane: 0, card: null, allocation };
  const plain = forecastTrade(view, node, null, false, false, allocation);
  const options = [{ slot: null as number | null, card: null as TradingCard | null, forecast: plain, prepare: false },
    ...view.hand.flatMap((card, slot) => {
      const forecast = forecastTrade(view, node, card, false, false, allocation);
      const preparation = cardPreparationAvailable(view.config, card) ? forecastTrade(view, node, card, false, true, allocation) : null;
      return [
        ...(forecast.enabledCard ? [{ slot, card, forecast, prepare: false }] : []),
        ...(preparation?.enabledCard ? [{ slot, card, forecast: preparation, prepare: true }] : [])
      ];
    })];
  if (strategy === 'random') {
    const option = options[Math.floor(random() * options.length)];
    return { lane: node.lane, card: option.slot, prepare: option.prepare, allocation };
  }
  const { config, state, day } = view;
  const { npc } = config;
  const remaining = config.gameplay.turns - day;
  const behind = Math.max(0, view.gap) / (Math.max(1, netWorth(state.account)) + Math.max(0, view.gap));
  let selected = options[0];
  let best = -Infinity;
  for (const option of options) {
    const { forecast, card } = option;
    const possibleLoss = forecast.riskOfLoss * riskWeight[strategy] * (1 - behind * 0.5);
    const insolvency = forecast.insolvencyRisk * npc.bankruptcyPenalty;
    const hedge = forecast.gainedHedge && (remaining > 0 || view.eventToday) ? npc.hedgeValue * (strategy === 'hedge' ? 2 : 1) : 0;
    const intel = forecast.intelDay && forecast.intelDay !== state.intelDay && remaining > 0 ? npc.intelValue : 0;
    const competition = forecast.opponents.length * 180 * (0.4 + behind);
    const reserve = card && remaining > 0 ? (npc.cardReserve + cardRetention(card, config, view) * 0.13) * (view.hand.length < 3 ? 1.5 : 0.6) : 0;
    const prep = forecast.preparation;
    const futureIncome = prep?.kind === 'cash' ? Math.min(prep.cap ?? Infinity, forecast.cash * prep.amount) * 1.7
      : prep?.kind === 'stock' ? Math.min(prep.cap ?? Infinity, forecast.investment * prep.amount) * 1.7
      : prep?.kind === 'dividend' ? forecast.investment * 0.01 * prep.amount
      : prep?.kind === 'rally' || prep?.kind === 'short' || prep?.kind === 'safe_shield' ? npc.hedgeValue * 0.55 : 0;
    const synergy = forecast.synergies ? (strategy === 'combo' ? 240 : 85) : 0;
    const draft = (forecast.draft || forecast.bonusDraw) && remaining > 0 ? npc.draftValue * (strategy === 'combo' ? 1.6 : 1) : 0;
    const score = forecast.expected - possibleLoss - insolvency - reserve + hedge + intel + competition + futureIncome + synergy + draft
      + random() * npc[difficulty];
    if (score > best) { best = score; selected = option; }
  }
  return { lane: node.lane, card: selected.slot, prepare: selected.prepare, allocation };
}
