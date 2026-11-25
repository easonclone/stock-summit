import type { AllocationOption, FinancialConfig, GameCard, TradingEvent } from '../config/financial-settings';
import { attackOf, estimateAttack, isAreaAttack, type AttackEffect, type AttackTarget } from './attacks';
import { sacrificeCost, sacrificeDamage, sacrificeRefund } from './sacrifice';
import { eventAttackFactor, eventGuardFactor, eventPrice, rulesFor } from './event-rules';
import { netWorth } from './economy';
import {
  closeDay, copyHolder, jokerEffect, mirrorItem, itemBlock, newsOutlook, priceEffect, tradeDay, type DayContext, type DayLedger, type Holder, type ItemBlock, type Tone
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
  openingItems?: number;
  eventToday: boolean;
  nextNewsDay: number | null;
  /** Direction of today's news if this investor learned it earlier with an item. */
  knownTone: Tone | null;
  openingLast?: boolean;
  openingBottom?: boolean;
  publicEvent?: TradingEvent | null;
  previousMarket?: number;
  /** The stage shop opens after today's close; only cash can pay for it. */
  shopToday: boolean;
}

export function allocationOption(config: FinancialConfig, id: string | undefined): AllocationOption {
  return config.allocation.options.find(option => option.id === id)
    ?? config.allocation.options.find(option => option.id === config.allocation.initial)!;
}

export function viewContext(view: DecisionView, allocation: AllocationOption): DayContext {
  return { config: view.config, day: view.day, allocation, marketRate: 0, news: null, nextNewsDay: view.nextNewsDay, hasTarget: false, openingLast: view.openingLast, openingBottom: view.openingBottom };
}

export interface Scenario { marketRate: number; newsRate: number; tone: Tone | null; weight: number }

/** Market low / middle / high, crossed with the public news outlook (or the direction this investor knows). */
export function scenarios(view: DecisionView): Scenario[] {
  const market = priceEffect(view.config, { effectIds: [view.config.allocation.dailyMarket] })!;
  const moves = [
    { marketRate: market.floor, weight: 0.25 }, { marketRate: (market.floor + market.ceiling) / 2, weight: 0.5 }, { marketRate: market.ceiling, weight: 0.25 }
  ];
  const price = view.publicEvent ? eventPrice(view.config, view.publicEvent, view.previousMarket ?? 0) : null;
  const samples = price ? (price.binary ? [price.floor, price.ceiling] : [price.floor, (price.floor + price.ceiling) / 2, price.ceiling]) : [0];
  const advertised = samples.map(rate => ({ rate, tone: rate > 0 ? 'positive' as const : rate < 0 ? 'negative' as const : 'neutral' as const }));
  const visible = advertised.filter(item => view.knownTone === null || item.tone === view.knownTone);
  const publicOutcomes = visible.length ? visible : advertised;
  const news = view.publicEvent ? publicOutcomes.map(item => ({ ...item, weight: 1 / publicOutcomes.length }))
    : view.eventToday ? newsOutlook(view.config, view.knownTone) : [{ tone: null, rate: 0, weight: 1 }];
  return moves.flatMap(move => news.map(item => ({ marketRate: move.marketRate, newsRate: item.rate, tone: item.tone, weight: move.weight * item.weight })));
}

function simulate(view: DecisionView, allocation: AllocationOption, items: GameCard[], scenario: Scenario) {
  const holder = copyHolder(view.holder);
  const before = netWorth(holder.account);
  const context = viewContext(view, allocation);
  context.marketRate = scenario.marketRate;
  // Only the rate matters to a forecast; the event's topic (and so 護國神山) is unknown until the news airs.
  const placeholder = { ...view.config.events[0], category: 'flows' as const };
  context.news = view.publicEvent || (view.eventToday && scenario.newsRate) ? { event: view.publicEvent ?? placeholder, rate: scenario.newsRate, applies: true } : null;
  const ledger = tradeDay(holder, items, context);
  ledger.itemCount += view.openingItems ?? 0;
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
  attack: { target: AttackTarget; amount: number; kind: AttackEffect['type'] } | null;
  sacrifice: SacrificePreview | null;
  ledger: DayLedger;
}

/** The same settlement the run uses, applied to copies under a few market scenarios. Never changes the real state. */
export function attackTargets(view: DecisionView, item: GameCard | null, allocation = allocationOption(view.config, view.allocation)) {
  const effect = attackOf(view.config, item);
  if (!effect || isAreaAttack(effect)) return [];
  const rivals = view.rivals.filter(rival => effect.type !== 'shield_break' || rival.shields > 0);
  const self = effect.type === 'attack' && jokerEffect(view.holder, view.config, 'sacrifice_contract');
  const stock = Math.floor(netWorth(view.holder.account) * allocation.ratio);
  if (self && view.rivals.length && sacrificeCost(view.holder, view.day, effect, stock, rulesFor(view.config, view.publicEvent))) return [...rivals, {
    id: view.characterId, name: '自己', rank: view.rank, cash: netWorth(view.holder.account) - stock, stock, shields: view.holder.defenses.length
  }];
  return rivals;
}

interface SacrificePreview { cost: number; refund: number; damage: { target: AttackTarget; amount: number }[] }

export function forecastSacrifice(view: DecisionView, effect: AttackEffect | null, targetId: string | undefined, stock: number): SacrificePreview | null {
  const isSelf = effect?.type === 'attack' && targetId === view.characterId;
  const contract = isSelf && jokerEffect(view.holder, view.config, 'sacrifice_contract');
  if (!effect || (effect.type !== 'sacrifice_attack' && !contract)) return null;
  if (effect.type !== 'attack' && effect.type !== 'sacrifice_attack') return null;
  const rules = rulesFor(view.config, view.publicEvent);
  const cost = sacrificeCost(view.holder, view.day, effect, stock, rules);
  if (!cost) return null;
  const area = Boolean(contract) || isAreaAttack(effect);
  const victims = area ? view.rivals : view.rivals.filter(target => target.id === targetId);
  const best = Math.min(...view.rivals.map(target => target.rank));
  const factor = contract ? contract.effect.rate : effect.type === 'sacrifice_attack' ? effect.factor : 0;
  const damage = victims.map(target => {
    const amount = sacrificeDamage(view.config, view.holder, cost, factor, target.rank === best && target.id === view.rivals.find(rival => rival.rank === best)?.id, area, rules);
    return { target, amount: Math.min(Math.floor((target.cash + target.stock) * (rules.damageCap ?? view.config.settlement.attackLossLimit)),
      Math.round(amount * eventGuardFactor(rules, target.guard ?? 0, Boolean(target.openingFirst), true))) };
  });
  return { cost, refund: sacrificeRefund(view.config, view.holder, cost, rules), damage };
}

export function forecastTrade(view: DecisionView, allocationId: string | undefined, slot: number | null, targetId?: string, actions?: ActionChoice[]): Forecast {
  const allocation = allocationOption(view.config, allocationId ?? view.allocation);
  const item = slot === null ? null : view.holder.items[slot] ?? null;
  const targets = attackTargets(view, item, allocation);
  const target = targets.find(rival => rival.id === targetId);
  const block = item ? itemBlock(view.holder, item, { ...viewContext(view, allocation), hasTarget: targets.length > 0 || (isAreaAttack(attackOf(view.config, item)) && view.rivals.length > 0) }) : null;
  const used = block ? null : item;
  const selected = actions ? actions.map(choice => view.holder.items[choice.slot]).filter(Boolean) : used ? [used] : [];
  const runs = scenarios(view).map(scenario => ({ scenario, result: simulate(view, allocation, selected, scenario) }));
  const worth = Math.max(0, netWorth(view.holder.account));
  const stock = Math.floor(worth * allocation.ratio);
  const sacrifice = forecastSacrifice(view, attackOf(view.config, used), targetId, stock);
  const totalSacrifice = actions?.map(action => forecastSacrifice(view, attackOf(view.config, view.holder.items[action.slot] ?? null), action.targetId, stock))
    .find(result => result !== null) ?? sacrifice;
  const netCost = totalSacrifice ? totalSacrifice.cost - totalSacrifice.refund : 0;
  const deltas = runs.map(run => run.result.delta - netCost);
  const expected = runs.reduce((sum, run) => sum + run.result.delta * run.scenario.weight, 0) - netCost;
  const middle = runs.reduce((best, run) => run.scenario.weight > best.scenario.weight ? run : best, runs[0]).result;
  const boost = runs.reduce((sum, run) => sum + (run.result.ledger.stockFinal - run.result.ledger.stockBase) * run.scenario.weight, 0);
  const shielded = Math.max(...runs.map(run => run.result.ledger.shielded));
  const itemCash = used ? middle.ledger.steps.filter(step => step.source === 'item' && step.kind === 'cash').reduce((sum, step) => sum + step.amount, 0) : 0;
  const effect = attackOf(view.config, used);
  const bonus = effect?.type === 'attack' ? jokerEffect(view.holder, view.config, 'stock_strike')?.effect.rate ?? 0 : 0;
  const charge = jokerEffect(view.holder, view.config, 'stored_strike') ? view.holder.memory.charge : 0;
  const finisher = jokerEffect(view.holder, view.config, 'finisher');
  const ready = finisher && view.holder.memory.attackRestDays >= finisher.effect.days ? finisher.effect.factor : 1;
  const mirror = used && (effect?.type === 'attack' || effect?.type === 'cash_raid') ? mirrorItem(view.holder, view.config, used, view.day)?.effect.rate ?? 0 : 0;
  const rules = rulesFor(view.config, view.publicEvent);
  const boostFactor = (effect?.type === 'shield_break' ? 1 : (1 + charge) * ready * (1 + bonus + mirror)) *
    eventAttackFactor(rules, isAreaAttack(effect), Boolean(view.openingLast), Boolean(view.openingBottom));
  const attack = target && effect ? { target, amount: sacrifice ? sacrifice.damage.find(hit => hit.target.id === target.id)?.amount ?? 0 : Math.min(Math.round(estimateAttack(effect, target) * boostFactor * eventGuardFactor(rules, target.guard ?? 0, Boolean(target.openingFirst), true)), Math.floor((target.cash + target.stock) * (rules.damageCap ?? view.config.settlement.attackLossLimit))), kind: effect.type } : null;
  return {
    allocation, cash: worth - stock, stock, low: Math.min(...deltas), high: Math.max(...deltas), expected,
    item, itemBlock: block, itemCash, boost, shielded, targets, attack, sacrifice, ledger: middle.ledger
  };
}
