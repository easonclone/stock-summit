import { describe, expect, it } from 'vitest';
import { readFinancialConfig } from '../src/config/financial-settings';
import { netWorth } from '../src/core/economy';
import { TradingRun } from '../src/core/trading-run';
import { money } from '../src/ui/format';
import { newsArt, newsCategories, newsImpact } from '../src/ui/theater';

const config = readFinancialConfig();

function play(seed: number, onDay?: (run: TradingRun) => void) {
  const run = new TradingRun(config, { seed, playerId: config.characters[0].id, difficulty: 'normal' });
  while (!run.closed) {
    while (run.offer) run.chooseOfferAutomatically();
    if (run.shop) { run.shopAutomatically(); continue; }
    expect(run.resolveControlled(() => ({ allocation: 'all' }), false)).toBe(true);
    if (run.pendingRecovery) run.acceptRecovery();
    onDay?.(run);
  }
  return run;
}

describe('市場快報', () => {
  it('原有六類 HD 場景與新增事件的插畫皆可讀取', () => {
    expect(config.events).toHaveLength(124);
    const categories = new Set(config.events.map(event => event.category));
    expect(categories.size).toBe(6);
    expect(new Set([...categories].map(category => newsArt(category))).size).toBe(6);
    for (const category of categories) expect(newsCategories[category]).toBeTruthy();
    const artwork = config.events.filter(event => event.family).map(event => newsArt(event.category, event.family));
    expect(new Set(artwork).size).toBe(8);
    expect(artwork.every(markup => markup.includes('400% 200%'))).toBe(true);
  });

  it('顯示玩家實際的新聞股票損益，讀取快報不改變市場及財務', () => {
    const silent = play(13);
    let seen = 0;
    const watched = play(13, run => {
      const report = run.reports.at(-1)!;
      const text = newsImpact(report, run.player, config);
      if (!report.market) {
        expect(text).toBe('');
        return;
      }
      const outcome = report.outcomes.find(entry => entry.investor === run.player);
      if (outcome?.marketApplied && outcome.marketPnl) {
        expect(text).toContain(money(Math.abs(outcome.marketPnl)));
        seen++;
      }
    });
    expect(seen).toBeGreaterThan(0);
    expect(watched.reports.map(report => [report.market?.id, report.newsRate])).toEqual(silent.reports.map(report => [report.market?.id, report.newsRate]));
    expect(watched.investors.map(item => netWorth(item.account))).toEqual(silent.investors.map(item => netWorth(item.account)));
  });
});
