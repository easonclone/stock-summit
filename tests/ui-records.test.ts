import { describe, expect, it } from 'vitest';
import { readFinancialConfig } from '../src/config/financial-settings';
import { chooseTrade, strategies } from '../src/core/npc-strategy';
import { seededRandom } from '../src/core/random';
import { TradingRun } from '../src/core/trading-run';
import { dayBreakdown } from '../src/ui/breakdown';
import { cardFace } from '../src/ui/card-face';

const config = readFinancialConfig();

describe('畫面取自實際結算紀錄', () => {
  it('每日收支分項加總等於實際身家變化，且不重複計算卡片與護盾', () => {
    let checked = 0;
    let withCards = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const strategy = strategies[seed % strategies.length];
      const run = new TradingRun(config, { seed, playerId: config.characters[seed % 4].id, difficulty: 'normal' });
      const random = seededRandom(seed * 7919);
      while (!run.closed) {
        while (run.offer) run.chooseOffer(null);
        if (!run.resolveControlled(view => chooseTrade(view, random, strategy))) break;
        if (run.pendingRecovery) run.acceptRecovery();
      }
      for (const report of run.reports) for (const outcome of report.outcomes) {
        const view = dayBreakdown(outcome);
        const sum = view.lines.reduce((total, line) => total + line.amount, 0);
        expect(Math.abs(sum - (outcome.close - outcome.start))).toBeLessThan(1e-6);
        expect(view.lines.every(line => line.amount !== 0)).toBe(true);
        expect(new Set(view.lines.map(line => line.key)).size).toBe(view.lines.length);
        if (view.cardShare) withCards++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(withCards).toBeGreaterThan(0);
  });

  it('每張卡都有牌面數值與一句說明', () => {
    for (const card of config.cards) {
      const face = cardFace(config, card);
      expect(face.value, card.id).not.toBe('');
      expect(face.line.length, card.id).toBeGreaterThan(2);
      expect(face.line.length, card.id).toBeLessThanOrEqual(40);
    }
  });
});
