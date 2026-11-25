import { expect, it } from 'vitest';
import { financialInput, readFinancialConfig } from '../src/config/financial-settings';
import { buildMarketSchedule } from '../src/core/market-events';
import { seededRandom } from '../src/core/random';
import { marketTone } from '../src/core/settlement';
import { eligibleMarketEvents } from '../src/core/market-events';

it('市場新聞具備分類、副標、有效效果及虛構標記，無重複 ID', () => {
  const config = readFinancialConfig();
  expect(config.events).toHaveLength(60);
  expect(Object.fromEntries(['ai', 'taiwan', 'us', 'global', 'flows', 'memes'].map(category =>
    [category, config.events.filter(event => event.category === category).length]))).toEqual({
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
  const tones = config.events.map(event => marketTone(event, config));
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
