import { expect, it } from 'vitest';
import { financialInput, readFinancialConfig } from '../src/config/financial-settings';
import { buildMarketSchedule } from '../src/core/market-events';
import { seededRandom } from '../src/core/random';
import { eventMarketRate } from '../src/core/event-rules';
import { TradingRun } from '../src/core/trading-run';
import { netWorth } from '../src/core/economy';
import { marketTone, sumSteps } from '../src/core/settlement';
import { eligibleMarketEvents } from '../src/core/market-events';

it('市場新聞具備分類、副標、有效效果及虛構標記，無重複 ID', () => {
  const config = readFinancialConfig();
  expect(config.events).toHaveLength(124);
  const newEvents = config.events.filter(event => event.family);
  const families = ['market', 'cash', 'attack', 'defense', 'cards', 'shop', 'sacrifice', 'ranking'];
  for (const family of families) expect(newEvents.filter(event => event.family === family), family).toHaveLength(8);
  expect(newEvents.every(event => event.rarity)).toBe(true);
  expect(Object.fromEntries(['ai', 'taiwan', 'us', 'global', 'flows', 'memes'].map(category =>
    [category, config.events.filter(event => !event.family && event.category === category).length]))).toEqual({
    ai: 12, taiwan: 12, us: 10, global: 8, flows: 10, memes: 8
  });
  expect(new Set(config.events.map(item => item.id)).size).toBe(config.events.length);
  expect(config.events.every(event => event.subtitle.length > 0 && event.fictional)).toBe(true);
  expect(new Set(config.events.map(event => event.category)).size).toBe(6);
  const invalid = structuredClone(financialInput);
  invalid.events[0].effectIds = ['missing'];
  expect(() => readFinancialConfig(invalid)).toThrow(/missing/);
});

it('1,000 組市場種子均可重現，沒有重複事件、三連利多或第二次黑天鵝', () => {
  const config = readFinancialConfig();
  for (let seed = 1; seed <= 1000; seed++) {
    const schedule = buildMarketSchedule(config, seededRandom(seed));
    expect(schedule).toEqual(buildMarketSchedule(config, seededRandom(seed)));
    expect([...schedule.keys()]).toEqual([3, 6, 9, 12, 15]);
    const events = [...schedule.values()];
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    expect(events.filter(event => event.severity === 'extreme').length).toBeLessThanOrEqual(1);
    for (const [index, event] of events.entries()) {
      const previous = events[index - 1];
      const second = events[index - 2];
      if (previous && second) {
        expect([event, previous, second].every(item => item.category === event.category)).toBe(false);
      }
    }
  }
});

it('新聞分成利多、利空與特殊三類；前一則新聞只會降低權重，候選池永遠同時有利多和利空', () => {
  const config = readFinancialConfig();
  const tones = config.events.filter(event => !event.family).map(event => marketTone(event, config));
  expect(tones.filter(tone => tone === 'neutral')).toHaveLength(2);
  for (let seed = 1; seed <= 200; seed++) {
    const history = [...buildMarketSchedule(config, seededRandom(seed)).values()];
    for (let index = 0; index < history.length; index++) {
      const pool = eligibleMarketEvents(config, history.slice(0, index));
      const seen = new Set(pool.map(event => marketTone(event, config)));
      expect(seen.has('positive') && seen.has('negative')).toBe(true);
    }
  }
});

function eventRun(id: string) {
  const config = readFinancialConfig();
  const event = config.events.find(item => item.id === 'event_' + id)!;
  config.events = [event];
  config.gameplay.turns = 4;
  config.gameplay.stageDays = [];
  config.gameplay.dailyItemStart = null;
  config.gameplay.startItems = 0;
  config.effects.market_day = { type: 'price', floor: 0, ceiling: 0 };
  const run = new TradingRun(config, { playerId: config.characters[0].id, seed: 33, difficulty: 'normal' });
  run.chooseOffer(null);
  for (const player of run.investors) player.jokers = [];
  const hold = () => ({ allocation: 'cash' });
  for (let day = 1; day < 3; day++) expect(run.resolveControlled(hold)).toBe(true);
  expect(run.publicEvent?.id).toBe(event.id);
  return { run, config, event, hold };
}

it('二選一市場方向各半，反彈只在昨日大盤下跌時生效', () => {
  const config = readFinancialConfig();
  const choose = (id: string) => config.events.find(event => event.id === 'event_' + id)!;
  expect(eventMarketRate(config, choose('bull_bear_duel'), 0.499, 0)).toBe(-0.2);
  expect(eventMarketRate(config, choose('bull_bear_duel'), 0.5, 0)).toBe(0.2);
  expect(eventMarketRate(config, choose('speculative_bubble'), 0.01, 0)).toBe(-0.3);
  expect(eventMarketRate(config, choose('speculative_bubble'), 0.99, 0)).toBe(0.35);
  expect(eventMarketRate(config, choose('deep_rebound'), 0.99, 0)).toBe(0);
  expect(eventMarketRate(config, choose('deep_rebound'), 0.99, -0.01)).toBe(0.15);
});

it('收盤現金收益與並列獎金各自按結算前快照入帳', () => {
  for (const [id, amount] of [['bank_promo', 300], ['richest_deposit', 375]] as const) {
    const { run, hold } = eventRun(id);
    expect(run.resolveControlled(hold)).toBe(true);
    for (const outcome of run.reports[2].outcomes) {
      expect(outcome.close).toBe(10000 + amount);
      expect(sumSteps(outcome.ledger)).toBe(amount);
    }
  }
});

it('連續攻勢開放第三張行動卡，手牌擴充隔天還原', () => {
  const offense = eventRun('relentless_offense').run;
  const trend = offense.config.items.find(card => card.id === 'trend')!;
  offense.player.items = [trend, trend, trend];
  const choice = { allocation: 'all', actions: [{ slot: 0 }, { slot: 1 }, { slot: 2 }] };
  expect(offense.actionLimit).toBe(3);
  expect(offense.canLock(choice)).toBe(true);
  expect(offense.confirm(choice, () => ({ allocation: 'cash' }))).toBe(true);
  expect(offense.reports[2].outcomes[0].items).toHaveLength(3);

  const { run, config, hold } = eventRun('hand_expansion');
  expect(run.itemLimit).toBe(config.gameplay.itemSlots + 2);
  run.player.items = config.items.slice(0, run.itemLimit);
  expect(run.resolveControlled(hold)).toBe(true);
  expect(run.itemLimit).toBe(config.gameplay.itemSlots);
  expect(run.player.items).toEqual(config.items.slice(0, config.gameplay.itemSlots));
});

it('活動 VIP 首筆才返現且全額扣款，補貨限定當日', () => {
  const { run } = eventRun('vip_day');
  const before = netWorth(run.player.account);
  const first = run.buyDaily(0)!;
  const second = run.buyDaily(1)!;
  expect(first.rebate?.amount).toBe(Math.floor(first.price * .3));
  expect(second.rebate).toBeUndefined();
  expect(netWorth(run.player.account)).toBe(before - first.price - second.price + first.rebate!.amount);
  const merchant = eventRun('merchant_visit');
  expect(merchant.run.dailyShop?.slots).toHaveLength(4);
  expect(merchant.run.resolveControlled(merchant.hold)).toBe(true);
  expect(merchant.run.dailyShop?.slots).toHaveLength(2);
});

it('戰爭維持開盤傷害上限，代價加倍僅按實付成本放大一次', () => {
  const { run, config } = eventRun('total_war');
  const target = run.investors[1];
  run.player.items = ['strike_boost', 'rush'].map(id => config.items.find(card => card.id === id)!);
  expect(run.confirm({ allocation: 'all', actions: [{ slot: 0 }, { slot: 1, targetId: target.character.id }] }, () => ({ allocation: 'all' }))).toBe(true);
  expect(run.reports[2].attacks[0].amount).toBe(3500);
  const sacrifice = eventRun('double_price');
  sacrifice.run.player.items = [sacrifice.config.items.find(card => card.id === 'equal_exchange')!];
  expect(sacrifice.run.confirm({ allocation: 'cash', actions: [{ slot: 0, targetId: sacrifice.run.investors[1].character.id }] }, sacrifice.hold)).toBe(true);
  expect(sacrifice.run.reports[2].outcomes[0].close).toBe(9000);
  expect(sacrifice.run.reports[2].attacks[0].amount).toBe(2000);
});
