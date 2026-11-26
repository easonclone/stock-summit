import { describe, expect, it } from 'vitest';
import { readFinancialConfig } from '../src/config/financial-settings';
import { chooseTrade, strategies } from '../src/core/npc-strategy';
import { seededRandom } from '../src/core/random';
import { TradingRun } from '../src/core/trading-run';
import { dayBreakdown } from '../src/ui/breakdown';
import { cardDescription } from '../src/ui/card-copy';
import { timelineDetail, timelineMarkup } from '../src/ui/timeline';

const config = readFinancialConfig();

describe('畫面取自實際結算紀錄', () => {
  it('每日收支分項加總等於實際身家變化，且不重複計算王牌與護盾', () => {
    let checked = 0;
    let withCards = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const strategy = strategies[seed % strategies.length];
      const run = new TradingRun(config, { seed, playerId: config.characters[seed % 4].id, difficulty: 'normal' });
      const random = seededRandom(seed * 7919);
      while (!run.closed) {
        while (run.offer) run.chooseOfferAutomatically();
        run.shopAutomatically();
        if (!run.resolveControlled(view => chooseTrade(view, random, strategy))) break;
        if (run.pendingRecovery) run.acceptRecovery();
      }
      for (const report of run.reports) for (const outcome of report.outcomes) {
        const view = dayBreakdown(outcome);
        const sum = view.lines.reduce((total, line) => total + line.amount, 0);
        expect(Math.abs(sum - (outcome.close - outcome.start))).toBeLessThan(1e-6);
        expect(view.lines.every(line => line.amount !== 0)).toBe(true);
        expect(new Set(view.lines.map(line => line.key)).size).toBe(view.lines.length);
        if (view.lines.some(line => line.key === 'joker')) withCards++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(withCards).toBeGreaterThan(0);
  });

  it('時間軸取用實際日程，未公開新聞僅顯示預定公布時間', () => {
    const run = new TradingRun(config, { seed: 13, playerId: config.characters[0].id, difficulty: 'normal' });
    expect(timelineMarkup(run).match(/class="track-day/g)).toHaveLength(config.gameplay.turns);
    expect(timelineMarkup(run).match(/data-news/g)).toHaveLength(5);
    expect(timelineMarkup(run).match(/data-shop/g)).toHaveLength(4);
    expect(timelineDetail(run, 15)).toContain('最終決戰');
    expect(timelineDetail(run, 3)).not.toContain('虛構新聞');
    for (let day = 1; day <= 3; day++) {
      while (run.offer) run.chooseOffer(null);
      expect(run.resolveControlled(() => ({ allocation: 'cash', actions: [] }))).toBe(true);
    }
    expect(timelineDetail(run, 3)).toContain(run.latestNews?.event.title);
    expect(timelineDetail(run, 6)).not.toContain('虛構新聞');
  });

  it('順風車的加成及反擊鏡上限從共用設定輸出', () => {
    const card = (id: string) => config.items.find(item => item.id === id)!;
    expect(cardDescription(config, card('trend')).line).toContain('+100%');
    const settings = structuredClone(config);
    settings.settlement.reflectionCap = 1234;
    expect(cardDescription(settings, card('mirror')).line).toContain('$1,234');
  });

  it('每張王牌與道具都有牌面數值與一句短說明', () => {
    for (const card of [...config.jokers, ...config.items]) {
      const { line } = cardDescription(config, card);
      expect(line.length, card.id).toBeGreaterThan(4);
      expect(line.length, card.id).toBeLessThanOrEqual(34);
      expect(line, card.id).not.toBe(card.name);
    }
  });
});
