import { z } from 'zod';
import financial from './financial.json';
import allocation from './allocation.json';
import gameplay from './gameplay.json';
import settlement from './settlement.json';
import npc from './npc.json';
import shop from './shop.json';
import data from '../data/finance.json';
import cards from '../data/cards.json';
import events from '../data/market-events.json';
import characters from '../data/characters.json';
import market from '../data/market-states.json';
import theme from './ui-theme.json';

const id = z.string().regex(/^[a-z][a-z\d_-]*$/);
const label = z.string().min(1);
const color = z.string().regex(/^#[\da-f]{6}$/i);
const rate = z.number().min(0).max(1);
const money = z.number().int().min(0).max(10000000);
const positive = z.number().positive();
const day = z.number().int().min(1).max(60);
const factor = z.number().min(1).max(5);
const categories = ['ai', 'taiwan', 'us', 'global', 'flows', 'memes'] as const;
export const icons = ['shield', 'rocket', 'short', 'eye', 'bolt', 'anchor', 'cash', 'chart', 'bull', 'bear', 'bank', 'up', 'down', 'bills', 'halt',
  'gem', 'crown', 'dice', 'fire', 'gift'] as const;

/**
 * Every rule a market event, joker or item can apply. Cards and events only reference these by id,
 * so one settlement engine (src/core/settlement.ts) resolves them all.
 */
const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('price'), floor: z.number().min(-1).max(1), ceiling: z.number().min(-1).max(1) })
    .refine(value => value.floor <= value.ceiling, '價格波動下限不可大於上限'),
  z.object({ type: z.literal('cash_grant'), amount: money.positive() }),
  z.object({ type: z.literal('item_grant'), count: z.number().int().min(1).max(3) }),
  // Jokers: automatic, in settlement order.
  z.object({ type: z.literal('gain_add'), amount: rate }),
  z.object({ type: z.literal('streak_add'), step: rate, cap: rate }),
  z.object({ type: z.literal('rebound_add'), amount: rate }),
  z.object({ type: z.literal('joker_add'), amount: rate }),
  z.object({ type: z.literal('news_mult'), factor, categories: z.array(z.enum(categories)).min(1) }),
  z.object({ type: z.literal('repeat_mult'), factor }),
  z.object({ type: z.literal('swing_mult'), factor }),
  z.object({ type: z.literal('loss_cut'), amount: rate }),
  z.object({ type: z.literal('cash_yield'), rate, cap: money.positive() }),
  z.object({ type: z.literal('yield_boost'), factor }),
  z.object({ type: z.literal('stock_yield'), rate, cap: money.positive() }),
  z.object({ type: z.literal('bear_bonus'), amount: money.positive() }),
  z.object({ type: z.literal('item_bonus'), amount: money.positive() }),
  z.object({ type: z.literal('attack_bonus'), amount: money.positive() }),
  z.object({ type: z.literal('news_item'), count: z.number().int().min(1).max(2) }),
  z.object({ type: z.literal('hold_bonus'), days: day, amount: money.positive() }),
  z.object({ type: z.literal('climb_bonus'), amount: money.positive() }),
  z.object({ type: z.literal('shop_discount'), rate }),
  // Items: one-shot, at most one per day.
  z.object({ type: z.literal('today_add'), amount: rate }),
  z.object({ type: z.literal('today_mult'), factor }),
  z.object({ type: z.literal('defense'), mode: z.enum(['cut', 'absorb', 'reverse']), amount: z.number().positive().max(10000) }),
  z.object({ type: z.literal('intel') }),
  z.object({ type: z.literal('item_pack'), count: z.number().int().min(2).max(4) }),
  z.object({ type: z.literal('attack'), amount: rate }),
  z.object({ type: z.literal('stock_cash'), rate }),
  z.object({ type: z.literal('relief'), amount: money.positive(), below: money.positive() })
]);

const jokerTypes = ['gain_add', 'streak_add', 'rebound_add', 'joker_add', 'news_mult', 'repeat_mult', 'swing_mult', 'loss_cut', 'cash_yield',
  'yield_boost', 'stock_yield', 'bear_bonus', 'item_bonus', 'attack_bonus', 'news_item', 'hold_bonus', 'climb_bonus', 'shop_discount'];
const itemTypes = ['cash_grant', 'today_add', 'today_mult', 'defense', 'intel', 'item_pack', 'attack', 'stock_cash', 'relief'];
const eventTypes = ['price', 'cash_grant', 'item_grant'];

const references = z.array(id).min(1).refine(items => new Set(items).size === items.length, '效果引用不得重複');
const card = z.object({
  id, name: label, line: label.max(24), detail: label, icon: z.enum(icons), color,
  rarity: z.enum(['common', 'rare', 'legendary']), weight: positive, effectIds: references, shopOnly: z.literal(true).optional()
});
const rarityPrice = z.object({ common: money.positive(), rare: money.positive(), legendary: money.positive() });
const schema = z.object({
  financial: z.object({
    initialCapital: money.positive(), recoveryCash: money.positive(), maxRecoveries: z.number().int().min(0).max(1),
    maxDefenses: z.number().int().min(1).max(4)
  }),
  allocation: z.object({
    initial: id, dailyMarket: id,
    options: z.array(z.object({ id, name: label, short: label, detail: label, ratio: z.number().min(0).max(1) })).min(2)
  }),
  gameplay: z.object({
    turns: day, eventEvery: day, jokerSlots: z.number().int().min(1).max(8), itemSlots: z.number().int().min(1).max(5),
    startItems: z.number().int().min(0).max(3), jokerChoices: z.number().int().min(1).max(4), stageDays: z.array(day),
    openingItems: z.object({ income: z.array(z.string()).min(1), defense: z.array(z.string()).min(1), other: z.array(z.string()).min(1) }),
    dailyItemStart: day.min(2).nullable(),
    rarity: z.object({ common: positive, rare: positive, legendary: positive })
  }),
  shop: z.object({
    enabled: z.boolean(), jokers: z.number().int().min(0).max(5), items: z.number().int().min(0).max(5),
    price: z.object({ joker: rarityPrice, item: rarityPrice }), sellRate: rate
  }),
  settlement: z.object({ maxGainMultiplier: factor, maxLossCut: rate, attacksPerTarget: z.number().int().min(1).max(3) }),
  npc: z.object({
    noise: z.object({ easy: z.number().nonnegative(), normal: z.number().nonnegative(), hard: z.number().nonnegative() }),
    itemReserve: z.number().nonnegative(), riskAversion: rate, defenseValue: rate, intelValue: z.number().nonnegative(),
    packValue: z.number().nonnegative(), jokerShopScale: z.number().nonnegative(), itemShopScale: z.number().nonnegative(),
    shopCashValue: rate, shopBudget: money, shopMargin: money, styleSynergy: z.number().nonnegative()
  }),
  characters: z.array(z.strictObject({ id, name: label, description: label, color, spriteKey: id, portrait: id })).length(4),
  theme: z.object({ panel: color, gold: color, night: color, up: color, down: color }),
  market: z.record(z.enum(['neutral', 'positive', 'negative']), z.object({ name: label, icon: z.enum(icons) })),
  effects: z.record(id, effect),
  jokers: z.array(card).min(3),
  items: z.array(card).min(3),
  events: z.array(z.object({
    id, title: label, subtitle: label, description: label, fictional: z.literal(true), weight: positive,
    category: z.enum(categories),
    target: z.enum(['all', 'random_one', 'random_two', 'first_place', 'last_place']),
    severity: z.enum(['normal', 'major', 'extreme']),
    effectIds: references
  })).min(1)
});

export type FinancialConfig = z.infer<typeof schema>;
export type FinancialRules = FinancialConfig['financial'];
export type FinanceEffect = z.infer<typeof effect>;
export type EffectType = FinanceEffect['type'];
export type GameCard = FinancialConfig['jokers'][number];
export type TradingEvent = FinancialConfig['events'][number];
export type InvestorCharacter = FinancialConfig['characters'][number];
export type TradingDifficulty = 'easy' | 'normal' | 'hard';
export type AllocationOption = FinancialConfig['allocation']['options'][number];
export type MarketTone = keyof FinancialConfig['market'];
export type PixelIcon = typeof icons[number];

export const financialInput = {
  financial, allocation, characters, market, theme, effects: data.effects, jokers: cards.jokers, items: cards.items, events,
  gameplay, shop, settlement, npc
};

export function readFinancialConfig(raw: unknown = financialInput): FinancialConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`遊戲設定錯誤：${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  }
  const config = parsed.data;
  const assert = (condition: boolean, detail: string) => {
    if (!condition) throw new Error(`遊戲設定錯誤：${detail}`);
  };
  const { gameplay, allocation: plan } = config;
  for (const items of [[...config.jokers, ...config.items], config.events, config.characters]) {
    assert(new Set(items.map(item => item.id)).size === items.length, '資料含重複 ID');
  }
  const groups = [
    ['王牌', config.jokers, jokerTypes], ['道具', config.items, itemTypes], ['新聞', config.events, eventTypes]
  ] as const;
  for (const [kind, list, allowed] of groups) {
    for (const item of list) {
      const missing = item.effectIds.filter(key => !Object.hasOwn(config.effects, key));
      assert(!missing.length, `${item.id} 引用了不存在的效果：${missing.join('、')}`);
      const wrong = item.effectIds.filter(key => !(allowed as readonly string[]).includes(config.effects[key].type));
      assert(!wrong.length, `${kind} ${item.id} 含不支援的效果：${wrong.join('、')}`);
    }
  }
  for (const event of config.events) {
    assert(event.effectIds.filter(key => config.effects[key].type === 'price').length <= 1, `${event.id} 的市場價格變動只能定義一次`);
  }
  assert(new Set(plan.options.map(option => option.id)).size === plan.options.length, '資產配置含重複 ID');
  assert(plan.options.some(option => option.id === plan.initial), `起始資產配置 ${plan.initial} 不存在`);
  assert(config.effects[plan.dailyMarket]?.type === 'price', `共同市場效果 ${plan.dailyMarket} 須為價格效果`);
  assert(gameplay.eventEvery <= gameplay.turns, '新聞間隔大於交易日數');
  assert(gameplay.startItems <= gameplay.itemSlots, '起始道具超過道具上限');
  const openingItems = Object.values(gameplay.openingItems).flat();
  assert(new Set(openingItems).size === openingItems.length, '起始道具池含重複 ID');
  assert(openingItems.every(id => config.items.some(item => item.id === id)), '起始道具池含未知道具');
  assert(gameplay.stageDays.every(value => value < gameplay.turns), '階段獎勵日須早於最後一日');
  const pool = config.jokers.filter(joker => !joker.shopOnly);
  assert(pool.length >= gameplay.jokerChoices + gameplay.jokerSlots, '可抽王牌數量不足');
  // Selling back must never beat the cheapest possible purchase, or discount + sell + rebuy would print money.
  const discount = Math.min(0.9, config.jokers.reduce((sum, joker) => sum + joker.effectIds
    .reduce((total, key) => { const item = config.effects[key]; return total + (item.type === 'shop_discount' ? item.rate : 0); }, 0), 0));
  assert(config.shop.sellRate < 1 - discount, '王牌回收價不得高於折扣後售價');
  assert(config.jokers.length >= config.shop.jokers + gameplay.jokerSlots, '商店王牌數量不足');
  assert(config.items.length >= 3, '道具數量不足');
  return config;
}
