import { z } from 'zod';
import financial from './financial.json';
import gameplay from './gameplay.json';
import npc from './npc.json';
import data from '../data/finance.json';
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
const icon = z.enum(['shield', 'rocket', 'short', 'eye', 'bolt', 'trap', 'anchor', 'cash', 'chart', 'bull', 'bear', 'bank', 'up', 'down', 'bills', 'halt']);
const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invest'), fraction: rate, borrow: z.number().min(0).max(5) }),
  z.object({ type: z.literal('price'), floor: z.number().min(-1).max(1), ceiling: z.number().min(-1).max(1) })
    .refine(value => value.floor <= value.ceiling, '價格波動下限不可大於上限'),
  z.object({ type: z.literal('sell'), fraction: rate, repay: z.boolean() }),
  z.object({ type: z.literal('deposit'), fraction: rate }),
  z.object({ type: z.literal('dividend'), rate }),
  z.object({ type: z.literal('hedge'), protection: rate }),
  z.object({ type: z.literal('intel') }),
  z.object({ type: z.literal('maintenance'), ltv: rate }),
  z.object({ type: z.literal('bailout'), amount: money.positive(), fee: money, cashThreshold: rate }),
  z.object({ type: z.literal('repay'), fraction: rate, feeRate: rate }),
  z.object({ type: z.literal('cash_yield'), rate, threshold: rate }),
  z.object({ type: z.literal('combo'), nodeTag: id, mode: z.enum(['price', 'dividend']), amount: rate, afterLoss: z.boolean().optional() })
]);
const display = z.object({ name: label, icon, color });
const references = z.array(id).refine(items => new Set(items).size === items.length, '效果引用不得重複');
const nodes = z.record(id, display.extend({
  detail: label, weight: positive, fromRow: z.number().int().nonnegative(),
  effectIds: references, tags: z.array(id).min(1), draft: z.enum(['open', 'catchup']).optional()
}));
const schema = z.object({
  financial: z.object({
    initialCapital: money.positive(), maxExposure: z.number().min(1).max(6), maxDebtToEquity: z.number().min(0).max(5),
    initialMarginLtv: rate, warningLtv: rate, callLtv: rate, restoredLtv: rate, liquidationFee: rate,
    originationFee: rate, marginDailyRate: rate, depositDailyRate: rate, depositDays: day,
    warningEquity: rate, warningCash: rate, recoveryCash: money.positive(), recoveryDebt: money.positive(),
    recoveryClosingFee: money, recoveryLockDays: day, maxRecoveries: z.number().int().min(0).max(1),
    maxHedges: z.number().int().min(1).max(6), recoveryGap: rate
  }),
  gameplay: z.object({ turns: day, eventEvery: day, initialHand: day, inventorySize: day.max(9) }),
  nodes: z.object({ lanes: z.literal(4), maxLinks: z.literal(2), attempts: day, kinds: nodes }),
  npc: z.object({
    easy: z.number().nonnegative(), normal: z.number().nonnegative(), hard: z.number().nonnegative(),
    lookahead: rate, liquidity: positive, bankruptcyPenalty: positive, warningPenalty: positive,
    cardReserve: positive, hedgeValue: positive, intelValue: positive, draftValue: positive
  }),
  characters: z.array(z.strictObject({ id, name: label, description: label, color, spriteKey: id, portrait: id })).length(4),
  theme: z.object({ panel: color, gold: color, night: color, up: color, down: color }),
  market: z.record(z.enum(['neutral', 'positive', 'negative']), z.object({ name: label, icon })),
  effects: z.record(id, effect),
  cards: z.array(display.extend({ id, description: label, condition: label, duration: label, weight: positive,
    opponent: z.literal('nearest_ahead').optional(),
    effectIds: references.refine(list => list.length > 0, '卡片至少需要一項效果') })).min(3),
  events: z.array(z.object({
    id, title: label, description: label, fictional: z.literal(true), weight: positive,
    target: z.enum(['all', 'random_one', 'random_two', 'first_place', 'last_place']),
    severity: z.enum(['normal', 'major', 'extreme']),
    effectIds: references.refine(list => list.length > 0, '市場事件至少需要一項效果')
  })).min(1)
});

export type FinancialConfig = z.infer<typeof schema>;
export type FinancialRules = FinancialConfig['financial'];
export type FinanceEffect = z.infer<typeof effect>;
export type TradingCard = FinancialConfig['cards'][number];
export type TradingEvent = FinancialConfig['events'][number];
export type InvestmentKind = FinancialConfig['nodes']['kinds'][string];
export type InvestorCharacter = FinancialConfig['characters'][number];
export type TradingDifficulty = 'easy' | 'normal' | 'hard';
export type MarketTone = keyof FinancialConfig['market'];

export const financialInput = {
  financial, characters, market, theme, effects: data.effects, cards: data.cards, events: data.events,
  gameplay,
  nodes: { lanes: 4, maxLinks: 2, attempts: 24, kinds: data.nodes },
  npc
};

export function readFinancialConfig(raw: unknown = financialInput): FinancialConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`財務設定錯誤：${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  }
  const config = parsed.data;
  const assert = (condition: boolean, detail: string) => {
    if (!condition) throw new Error(`財務設定錯誤：${detail}`);
  };
  const { financial: rules, gameplay, nodes: routes } = config;
  for (const items of [config.cards, config.events, config.characters]) {
    assert(new Set(items.map(item => item.id)).size === items.length, '資料含重複 ID');
  }
  for (const [owner, item] of [
    ...config.cards.map(card => [card.id, card] as const),
    ...config.events.map(event => [event.id, event] as const),
    ...Object.entries(routes.kinds)
  ]) {
    assert(item.effectIds.every(key => Object.hasOwn(config.effects, key)), `${owner} 引用了不存在的效果：${item.effectIds.filter(key => !Object.hasOwn(config.effects, key)).join('、')}`);
  }
  for (const event of config.events) {
    assert(event.effectIds.every(key => ['price', 'maintenance'].includes(config.effects[key].type)), `${event.id} 含非市場效果`);
    assert(event.effectIds.filter(key => config.effects[key].type === 'price').length <= 1, `${event.id} 的市場價格變動只能定義一次`);
    assert(event.effectIds.every(key => {
      const item = config.effects[key];
      return item.type !== 'maintenance' || item.ltv > rules.restoredLtv;
    }), `${event.id} 的追繳門檻須高於還款目標`);
  }
  for (const card of config.cards) {
    const supported = card.opponent ? ['maintenance'] : ['combo', 'hedge', 'sell', 'intel', 'bailout', 'repay', 'cash_yield'];
    assert(card.effectIds.every(key => supported.includes(config.effects[key].type)), `${card.id} 含不支援的手牌效果`);
    assert(card.effectIds.every(key => {
      const item = config.effects[key];
      return item.type !== 'maintenance' || item.ltv > rules.restoredLtv;
    }), `${card.id} 的追繳門檻須高於還款目標`);
  }
  for (const value of Object.values(config.effects)) {
    if (value.type === 'combo') assert(Object.values(routes.kinds).some(kind => kind.tags.includes(value.nodeTag)), `卡片協同缺少節點標籤 ${value.nodeTag}`);
  }
  assert(Object.values(routes.kinds).filter(kind => kind.fromRow === 0).length >= routes.lanes, '首日可用節點少於路線數');
  assert(gameplay.initialHand < gameplay.inventorySize && gameplay.eventEvery <= gameplay.turns, '交易日或手牌容量無效');
  assert(rules.restoredLtv < rules.warningLtv && rules.warningLtv < rules.callLtv &&
    rules.initialMarginLtv < rules.callLtv, '融資維持門檻順序無效');
  assert(!rules.maxRecoveries || rules.recoveryCash > rules.recoveryDebt, '破產重整後需有正淨資產');
  return config;
}
