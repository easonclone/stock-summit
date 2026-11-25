import type { EventRules, FinancialConfig, GameCard, TradingEvent } from '../config/financial-settings';
import { applyCashCurse, jokerEffect, type Holder } from './settlement';

export type CardKind = 'joker' | 'item';

/** One shelf in the stage shop. `base` is the list price before any discount from the buyer's jokers. */
export interface ShopSlot { kind: CardKind; card: GameCard; base: number; sold: boolean }
export interface Shop { day: number; slots: ShopSlot[]; rules?: EventRules; event?: TradingEvent }

/** A completed purchase, kept on the buyer as a public record (the cash it moved is real). */
export interface Purchase { day: number; kind: CardKind; card: GameCard; price: number; replaced: GameCard | null; refund: number; rebate?: { amount: number; card: Pick<GameCard, 'id' | 'name'>; event?: boolean } }

export type BuyBlock = 'sold' | 'owned' | 'cash' | 'full';
export interface BuyCheck { price: number; shortfall: number; needsReplace: boolean; block: BuyBlock | null }

export const listPrice = (config: FinancialConfig, kind: CardKind, card: GameCard) => config.shop.price[kind][card.rarity];

/** Sum of the holder's 精打細算-type discounts, capped so nothing is ever free. */
export function shopDiscount(config: FinancialConfig, holder: Holder) {
  const total = holder.jokers.reduce((sum, joker) => sum + joker.effectIds
    .reduce((rate, id) => { const effect = config.effects[id]; return rate + (effect.type === 'shop_discount' ? effect.rate : 0); }, 0), 0);
  return Math.min(0.9, total);
}

export function shopPrice(config: FinancialConfig, holder: Holder, slot: ShopSlot, day?: number, rules: EventRules = {}) {
  const rebate = day !== undefined && holder.memory.rebateDay !== day
    ? Math.max(jokerEffect(holder, config, 'purchase_rebate')?.effect.rate ?? 0, rules.shopRebate ?? 0) : 0;
  const floor = slot.kind === 'joker' ? Math.floor(sellPrice(config, slot.card, rules) / (1 - rebate)) + 1 : 1;
  return Math.max(floor, Math.round(slot.base * (1 - shopDiscount(config, holder)) * (1 - (rules.shopDiscount ?? 0))) - holder.memory.voucher);
}

/** Cash returned for a joker given up to make room. Always below the cheapest discounted price (checked at startup). */
export const sellPrice = (config: FinancialConfig, card: GameCard, rules: EventRules = {}) => Math.floor(listPrice(config, 'joker', card) * (rules.shopSell ?? config.shop.sellRate));

export function capacity(config: FinancialConfig, kind: CardKind, rules: EventRules = {}) {
  return kind === 'joker' ? config.gameplay.jokerSlots : config.gameplay.itemSlots + (rules.handSlots ?? 0);
}

export function checkBuy(config: FinancialConfig, holder: Holder, slot: ShopSlot | undefined, replace: number | null = null, day?: number, rules: EventRules = {}): BuyCheck {
  if (!slot) return { price: 0, shortfall: 0, needsReplace: false, block: 'sold' };
  const price = shopPrice(config, holder, slot, day, rules);
  const owned = slot.kind === 'joker' ? holder.jokers : holder.items;
  const needsReplace = owned.length >= capacity(config, slot.kind, rules);
  // A refund for a replaced joker only arrives with the purchase, so it cannot cover the price.
  const shortfall = Math.max(0, price - holder.account.cash);
  let block: BuyBlock | null = null;
  if (slot.sold) block = 'sold';
  else if (slot.kind === 'joker' && holder.jokers.some(card => card.id === slot.card.id)) block = 'owned';
  else if (shortfall > 0) block = 'cash';
  else if (needsReplace && (replace === null || !owned[replace])) block = 'full';
  return { price, shortfall, needsReplace, block };
}

/** Moves cash and the card. Returns null (and changes nothing) when the purchase is not allowed. */
export function buy(config: FinancialConfig, holder: Holder, shop: Shop, index: number, replace: number | null): Purchase | null {
  const slot = shop.slots[index];
  const check = checkBuy(config, holder, slot, replace, shop.day, shop.rules);
  if (check.block) return null;
  const owned = slot.kind === 'joker' ? holder.jokers : holder.items;
  let replaced: GameCard | null = null;
  let refund = 0;
  const vip = holder.memory.rebateDay !== shop.day ? jokerEffect(holder, config, 'purchase_rebate') : undefined;
  const eventRebate = holder.memory.rebateDay !== shop.day ? shop.rules?.shopRebate ?? 0 : 0;
  const rebate = eventRebate > (vip?.effect.rate ?? 0) && shop.event ? {
    amount: Math.floor(check.price * eventRebate), card: { id: shop.event.id, name: shop.event.title }, event: true
  } : vip ? { amount: Math.floor(check.price * vip.effect.rate), card: vip.joker, event: false } : undefined;
  holder.memory.rebateDay = shop.day;
  holder.account.cash -= check.price;
  if (check.needsReplace) {
    replaced = owned[replace!];
    refund = slot.kind === 'joker' ? sellPrice(config, replaced, shop.rules) : 0;
    owned[replace!] = slot.card;
    holder.account.cash += refund;
  } else owned.push(slot.card);
  slot.sold = true;
  holder.memory.voucher = 0;
  if (rebate) {
    holder.account.cash += rebate.amount;
    const curse = rebate.event ? null : applyCashCurse(holder, shop.day, rebate.amount, false);
    if (curse) rebate.amount -= curse.amount;
  }
  return { day: shop.day, kind: slot.kind, card: slot.card, price: check.price, replaced, refund, ...(rebate && { rebate }) };
}
