import type { AllocationOption, FinancialConfig, GameCard } from '../config/financial-settings';
import { attackOf, estimateAttack, type AttackTarget } from './attacks';
import { netWorth } from './economy';
import {
  closeDay, copyHolder, itemBlock, newsOutlook, priceEffect, tradeDay, type DayContext, type DayLedger, type Holder, type ItemBlock, type Tone
} from './settlement';

/** Locked before any market result is known: today's stock ratio and at most one item (slot in the holder's items). */
export interface ActionChoice { slot: number; targetId?: string }
export interface TradeChoice { allocation?: string; actions?: ActionChoice[]; item?: number | null; targetId?: string }

/** Everything one investor may know when deciding: public standings, their own cards, and their own intel. */
export interface DecisionView {
  config: FinancialConfig;
  characterId: string;
  day: number;
  holder: Holder;
  /** Allocation kept from the previous day; the default for today. */
  allocation: string;
  rank: number;
  gap: number;
  /** 只包含對手已公開的資產、排名與護盾。 */
  rivals: AttackTarget[];
  actionsLeft: number;
  eventToday: boolean;
  nextNewsDay: number | null;
  /** Direction of today's news if this investor learned it earlier with an item. */
  knownTone: Tone | null;
  /** The stage shop opens after today's close; only cash can pay for it. */
  shopToday: boolean;
}

export function allocationOption(config: FinancialConfig, id: string | undefined): AllocationOption {
  return config.allocation.options.find(option => option.id === id)
    ?? config.allocation.options.find(option => option.id === config.allocation.initial)!;
}

export function viewContext(view: DecisionView, allocation: AllocationOption): DayContext {
  return { config: view.config, day: view.day, allocation, marketRate: 0, news: null, nextNewsDay: view.nextNewsDay, hasTarget: false };
}

export interface Scenario { marketRate: number; newsRate: number; tone: Tone | null; weight: number }

/** Market low / middle / high, crossed with the public news outlook (or the direction this investor knows). */
export function scenarios(view: DecisionView): Scenario[] {
  const market = priceEffect(view.config, { effectIds: [view.config.allocation.dailyMarket] })!;
  const moves = [
    { marketRate: market.floor, weight: 0.25 }, { marketRate: (market.floor + market.ceiling) / 2, weight: 0.5 }, { marketRate: market.ceiling, weight: 0.25 }
  ];
  const news = view.eventToday ? newsOutlook(view.config, view.knownTone) : [{ tone: null, rate: 0, weight: 1 }];
  return moves.flatMap(move => news.map(item => ({ marketRate: move.marketRate, newsRate: item.rate, tone: item.tone, weight: move.weight * item.weight })));
}

function simulate(view: DecisionView, allocation: AllocationOption, items: GameCard[], scenario: Scenario) {
  const holder = copyHolder(view.holder);
  const before = netWorth(holder.account);
  const context = viewContext(view, allocation);
  context.marketRate = scenario.marketRate;
  // Only the rate matters to a forecast; the event's topic (and so 護國神山) is unknown until the news airs.
  const placeholder = { ...view.config.events[0], category: 'flows' as const };
  context.news = view.eventToday && scenario.newsRate ? { event: placeholder, rate: scenario.newsRate, applies: true } : null;
  const ledger = tradeDay(holder, items, context);
  closeDay(holder, context, ledger);
  return { holder, ledger, delta: netWorth(holder.account) - before };
}

export interface Forecast {
  allocation: AllocationOption;
  cash: number;
  stock: number;
  low: number;
  high: number;
  expected: number;
  item: GameCard | null;
  itemBlock: ItemBlock | null;
  /** Cash the item pays right away, if any. */
  itemCash: number;
  /** Expected extra gain from jokers and items over the plain stock move. */
  boost: number;
  shielded: number;
  targets: AttackTarget[];
  attack: { target: AttackTarget; amount: number; kind: 'attack' | 'cash_raid' | 'shield_break' | 'area_attack' } | null;
  ledger: DayLedger;
}

/** The same settlement the run uses, applied to copies under a few market scenarios. Never changes the real state. */
export function attackTargets(view: DecisionView, item: GameCard | null) {
  const effect = attackOf(view.config, item);
  return effect && effect.type !== 'area_attack' ? view.rivals.filter(rival => effect.type !== 'shield_break' || rival.shields > 0) : [];
}

export function forecastTrade(view: DecisionView, allocationId: string | undefined, slot: number | null, targetId?: string, actions?: ActionChoice[]): Forecast {
  const allocation = allocationOption(view.config, allocationId ?? view.allocation);
  const item = slot === null ? null : view.holder.items[slot] ?? null;
  const targets = attackTargets(view, item);
  const target = targets.find(rival => rival.id === targetId);
  const block = item ? itemBlock(view.holder, item, { ...viewContext(view, allocation), hasTarget: targets.length > 0 }) : null;
  const used = block ? null : item;
  const selected = actions ? actions.map(choice => view.holder.items[choice.slot]).filter(Boolean) : used ? [used] : [];
  const runs = scenarios(view).map(scenario => ({ scenario, result: simulate(view, allocation, selected, scenario) }));
  const deltas = runs.map(run => run.result.delta);
  const expected = runs.reduce((sum, run) => sum + run.result.delta * run.scenario.weight, 0);
  const middle = runs.reduce((best, run) => run.scenario.weight > best.scenario.weight ? run : best, runs[0]).result;
  const boost = runs.reduce((sum, run) => sum + (run.result.ledger.stockFinal - run.result.ledger.stockBase) * run.scenario.weight, 0);
  const shielded = Math.max(...runs.map(run => run.result.ledger.shielded));
  const worth = Math.max(0, netWorth(view.holder.account));
  const stock = Math.floor(worth * allocation.ratio);
  const itemCash = used ? middle.ledger.steps.filter(step => step.source === 'item' && step.kind === 'cash').reduce((sum, step) => sum + step.amount, 0) : 0;
  const effect = attackOf(view.config, used);
  const attack = target && effect ? { target, amount: estimateAttack(effect, target), kind: effect.type } : null;
  return {
    allocation, cash: worth - stock, stock, low: Math.min(...deltas), high: Math.max(...deltas), expected,
    item, itemBlock: block, itemCash, boost, shielded, targets, attack, ledger: middle.ledger
  };
}
