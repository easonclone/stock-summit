import type { FinanceEffect, GameCard, TradingDifficulty } from '../config/financial-settings';
import { attackOf, estimateAttack, type AttackEffect } from './attacks';
import { itemTiming } from './item-timing';
import { netWorth } from './economy';
import type { Random } from './random';
import { attackTargets, forecastTrade, type ActionChoice, type DecisionView, type TradeChoice } from './trade-preview';
import { copyHolder, type Holder } from './settlement';
import { checkBuy, sellPrice, type Shop } from './shop';

/**
 * Play styles shared by the simulation and the computer opponents. Every style plays by the player's rules and
 * reads only its own DecisionView (public standings, its own cards and its own intel).
 */
export const strategies = ['random', 'cash', 'half', 'all', 'mixed'] as const;
export type Strategy = typeof strategies[number];
export type Planner = (view: DecisionView, random: Random) => TradeChoice;

const fixed: Partial<Record<Strategy, string>> = { cash: 'cash', half: 'half', all: 'all' };

/**
 * Rough dollars an effect adds over about twelve trading days (jokers) or in one use (items), taken from
 * simulation averages. Only ranks cards for offers and the shop; daily decisions use the real forecast.
 */
function effectValue(effect: FinanceEffect, holder: Holder | null): number {
  switch (effect.type) {
    case 'gain_add': return 450;
    case 'streak_add': return 150;
    case 'rebound_add': return 350;
    case 'joker_add': return 150 + 120 * (holder?.jokers.length ?? 0);
    case 'news_mult': return 350;
    case 'repeat_mult': return 800;
    case 'swing_mult': return 800;
    case 'loss_cut': return 350;
    case 'cash_yield': return 1200;
    case 'yield_boost': return 400;
    case 'stock_yield': return 650;
    case 'bear_bonus': return 500;
    case 'item_bonus': return 600;
    case 'attack_bonus': return 150;
    case 'news_item': return 700;
    case 'hold_bonus': return 400;
    case 'climb_bonus': return 300;
    case 'shop_discount': return 250;
    case 'cash_grant': return effect.amount;
    case 'today_add': return 250;
    case 'today_mult': return 400;
    case 'defense': return 250;
    case 'intel': return 200;
    case 'item_pack': return 300;
    case 'attack': return 250;
    case 'cash_raid': return 850;
    case 'random_cash': return (effect.min + effect.max) / 2;
    case 'generate': return effect.choose ? 450 : effect.count * 350;
    case 'voucher': return effect.amount * 0.65;
    case 'strike_boost': return 650;
    case 'area_attack': return 1400;
    case 'shield_break': return 160;
    case 'mirror': return 180;
    case 'stock_cash': return 350;
    case 'relief': return holder && netWorth(holder.account) < effect.below ? effect.amount : 100;
    default: return 100;
  }
}

/**
 * Play styles a computer drifts into from the jokers it already owns. All four characters start equal; the style
 * only changes which cards look attractive next, and the forecast (same engine as the player) does the rest.
 */
export const styles = ['cash', 'stock', 'defense', 'items'] as const;
export type Style = typeof styles[number];
const styleOf: Partial<Record<FinanceEffect['type'], Style>> = {
  cash_yield: 'cash', yield_boost: 'cash', bear_bonus: 'cash', shop_discount: 'cash',
  gain_add: 'stock', streak_add: 'stock', rebound_add: 'stock', joker_add: 'stock', news_mult: 'stock', repeat_mult: 'stock',
  swing_mult: 'stock', stock_yield: 'stock', hold_bonus: 'stock', today_add: 'stock', today_mult: 'stock', stock_cash: 'stock',
  loss_cut: 'defense', defense: 'defense', relief: 'defense', climb_bonus: 'defense',
  item_bonus: 'items', news_item: 'items', attack_bonus: 'items', item_pack: 'items', attack: 'items', cash_raid: 'items', shield_break: 'items', mirror: 'items', intel: 'items'
};

const cardStyles = (card: GameCard, config: DecisionView['config']) =>
  new Set(card.effectIds.map(id => styleOf[config.effects[id].type]).filter((style): style is Style => style !== undefined));

/** The style with the most owned jokers, or null before the investor leans anywhere. */
export function holderStyle(holder: Holder, config: DecisionView['config']): Style | null {
  const counts = new Map<Style, number>();
  for (const joker of holder.jokers) for (const style of cardStyles(joker, config)) counts.set(style, (counts.get(style) ?? 0) + 1);
  let best: Style | null = null;
  for (const style of styles) if ((counts.get(style) ?? 0) > (best ? counts.get(best)! : 0)) best = style;
  return best;
}

/** How much an investor wants a joker or item; used for offers, the shop, replacements and the opening pick. */
export function cardValue(card: GameCard, view: Pick<DecisionView, 'config'> & { holder: Holder | null }) {
  const own = view.holder;
  const effects = card.effectIds.map(id => view.config.effects[id]);
  const base = effects.reduce((sum, effect) => sum + effectValue(effect, own), 0);
  const synergy = own && effects.some(effect => effect.type === 'yield_boost') &&
    own.jokers.some(joker => joker.effectIds.some(id => view.config.effects[id].type === 'cash_yield')) ? 900 : 0;
  if (!own) return base + synergy;
  const mine = cardStyles(card, view.config);
  const matches = own.jokers.filter(joker => joker !== card && [...cardStyles(joker, view.config)].some(style => mine.has(style))).length;
  return base + synergy + view.config.npc.styleSynergy * Math.min(3, matches);
}

/**
 * Shop shopping list: repeatedly buy the shelf with the best value over its price while cash allows. Jokers are
 * worth more early (more days left to fire); items are one-shot. Uses only the buyer's own holder and public prices.
 */
export function planShop(real: Shop, own: Holder, config: DecisionView['config'], day: number) {
  // Plan on scratch copies so later picks see the cash and slots the earlier ones used; replay with the same order.
  const holder = copyHolder(own);
  const shop: Shop = { ...real, slots: real.slots.map(slot => ({ ...slot })) };
  const { npc, gameplay } = config;
  const first = gameplay.stageDays[0] ?? 1;
  const left = Math.max(0, gameplay.turns - day) / Math.max(1, gameplay.turns - first);
  const picks: { index: number; replace: number | null }[] = [];
  const view = { config, holder };
  const worth = (card: GameCard, kind: 'joker' | 'item') =>
    cardValue(card, view) * (kind === 'joker' ? npc.jokerShopScale * left : npc.itemShopScale);
  for (;;) {
    let top: { index: number; replace: number | null; net: number } | null = null;
    shop.slots.forEach((slot, index) => {
      const owned = slot.kind === 'joker' ? holder.jokers : holder.items;
      const full = checkBuy(config, holder, slot).needsReplace;
      const replace = full ? owned.reduce((pick, card, at) => worth(card, slot.kind) < worth(owned[pick], slot.kind) ? at : pick, 0) : null;
      const check = checkBuy(config, holder, slot, replace);
      if (check.block) return;
      const lost = replace === null ? 0 : worth(owned[replace], slot.kind) - (slot.kind === 'joker' ? sellPrice(config, owned[replace]) : 0);
      const net = worth(slot.card, slot.kind) - check.price - lost;
      if (net > npc.shopMargin && (!top || net > top.net)) top = { index, replace, net };
    });
    if (!top) break;
    const { index, replace } = top as { index: number; replace: number | null };
    picks.push({ index, replace });
    const slot = shop.slots[index];
    const owned = slot.kind === 'joker' ? holder.jokers : holder.items;
    holder.account.cash -= checkBuy(config, holder, slot, replace).price;
    holder.memory.voucher = 0;
    if (replace !== null) { holder.account.cash += slot.kind === 'joker' ? sellPrice(config, owned[replace]) : 0; owned[replace] = slot.card; }
    else owned.push(slot.card);
    slot.sold = true;
  }
  return picks;
}

/** Picks one offered card (or none) and the slot it replaces when the holder is full. */
export function chooseCard(cards: readonly GameCard[], owned: readonly GameCard[], capacity: number, view: Pick<DecisionView, 'config'> & { holder: Holder | null }) {
  const value = (card: GameCard) => cardValue(card, view);
  const best = cards.reduce((pick, card, index) => value(card) > value(cards[pick]) ? index : pick, 0);
  if (owned.length < capacity) return { card: best as number | null, replace: null as number | null };
  const worst = owned.reduce((pick, card, index) => value(card) < value(owned[pick]) ? index : pick, 0);
  return value(cards[best]) > value(owned[worst]) ? { card: best, replace: worst } : { card: null, replace: null };
}

/** Worth of an item used today beyond its immediate effect on today's total worth. */
function delayedValue(view: DecisionView, item: GameCard, stock: number) {
  const { npc } = view.config;
  return item.effectIds.reduce((sum, id) => {
    const effect = view.config.effects[id];
    if (effect.type === 'defense') return sum + npc.defenseValue * Math.min(effect.mode === 'cut' ? stock * effect.amount : effect.amount, stock) * 0.25;
    if (effect.type === 'mirror') return sum + npc.defenseValue * 1.5;
    if (effect.type === 'intel') return sum + (view.nextNewsDay !== null && view.nextNewsDay - view.day <= 2 ? npc.intelValue : npc.intelValue * 0.4);
    if (effect.type === 'item_pack') return sum + npc.packValue;
    return sum;
  }, 0);
}

function attackValue(kind: AttackEffect['type'], amount: number) {
  return kind === 'shield_break' ? 180 * amount : kind === 'cash_raid' ? amount * 1.4 : amount;
}

function chooseAttackTarget(view: DecisionView, card: GameCard | null) {
  const effect = attackOf(view.config, card);
  if (!effect || effect.type === 'area_attack') return undefined;
  const score = (target: DecisionView['rivals'][number]) => {
    const value = attackValue(effect.type, estimateAttack(effect, target));
    const rankWeight = (target.rank <= view.rank ? 1.15 : 0.75) / (1 + 0.12 * Math.abs(target.rank - view.rank));
    return value * rankWeight;
  };
  return attackTargets(view, card).sort((a, b) => score(b) - score(a))[0];
}

export function chooseTrade(view: DecisionView, random: Random, strategy: Strategy = 'mixed', difficulty: TradingDifficulty = 'normal'): TradeChoice {
  const { config } = view;
  const allocations = config.allocation.options.map(option => option.id);
  const actionSlots = view.holder.items.flatMap((card, slot) => itemTiming(config, card) === 'action' ? [slot] : []);
  if (strategy === 'random') {
    const allocation = allocations[Math.floor(random() * allocations.length)];
    const usable = actionSlots.filter(slot => !view.holder.items[slot].effectIds.some(id => config.effects[id].type === 'strike_boost') &&
      !forecastTrade(view, allocation, slot).itemBlock && (attackOf(config, view.holder.items[slot])?.type !== 'area_attack' || view.rivals.length));
    const item = usable.length && random() < 0.4 ? usable[Math.floor(random() * usable.length)] : null;
    const card = item === null ? null : view.holder.items[item];
    const target = chooseAttackTarget(view, card);
    return { allocation, actions: item === null || !view.actionsLeft ? [] : [{ slot: item, targetId: target?.id }] };
  }
  const choices = fixed[strategy] ? [fixed[strategy]!] : allocations;
  const { npc } = config;
  const worth = Math.max(1, netWorth(view.holder.account));
  const remaining = config.gameplay.turns - view.day;
  const behind = Math.max(0, view.gap) / (worth + Math.max(0, view.gap));
  const noise = npc.noise[difficulty] * worth * 0.01;
  let best: TradeChoice = { allocation: choices[0], actions: [] };
  let top = -Infinity;
  for (const allocation of choices) {
    const available = actionSlots.flatMap(slot => {
      const card = view.holder.items[slot];
      const effect = attackOf(config, card);
      const boost = card.effectIds.map(id => config.effects[id]).find(effect => effect.type === 'strike_boost');
      const target = chooseAttackTarget(view, card);
      const forecast = forecastTrade(view, allocation, slot, target?.id);
      if (forecast.itemBlock || (effect && effect.type !== 'area_attack' && !target) || (effect?.type === 'area_attack' && !view.rivals.length)) return [];
      const value = effect?.type === 'area_attack' ? view.rivals.reduce((sum, rival) => sum + estimateAttack(effect, rival), 0) * 0.65
        : forecast.attack ? attackValue(forecast.attack.kind, forecast.attack.amount) : 0;
      return [{ choice: { slot, targetId: target?.id }, effect, boost, value, forecast }];
    });
    const plans = [[], ...(view.actionsLeft ? available.filter(card => !card.boost).map(card => [card]) : [])];
    if (view.actionsLeft >= 2) for (const [i, first] of available.entries()) for (const second of available.slice(i + 1)) {
      const pair = first.boost ? [first, second] : second.boost ? [second, first] : [first, second];
      if (pair[1].boost || (pair[0].boost && !pair[1].effect)) continue;
      if (pair.every(card => card.effect) && (pair[0].choice.targetId === pair[1].choice.targetId ||
          pair.some(card => card.effect?.type === 'area_attack'))) continue;
      plans.push(pair);
    }
    for (const plan of plans) {
      const actions: ActionChoice[] = plan.map(card => card.choice);
      const forecast = plan.length === 1 ? plan[0].forecast : forecastTrade(view, allocation, null, undefined, actions);
      const risk = config.npc.riskAversion * Math.max(0, -forecast.low) * (1 - behind);
      const reserve = remaining > 0 ? npc.itemReserve * plan.length : 0;
      const extra = plan.reduce((sum, card) => sum + card.value, 0) * (plan[0]?.boost?.factor ?? 1) * (0.6 + behind);
      const shopping = view.shopToday ? npc.shopCashValue * Math.min(forecast.cash, npc.shopBudget) : 0;
      const score = forecast.expected - risk - reserve + extra + shopping + random() * noise;
      if (score > top) { top = score; best = { allocation, actions }; }
    }
  }
  return best;
}
