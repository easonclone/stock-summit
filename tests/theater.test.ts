import { describe, expect, it } from 'vitest';
import { readFinancialConfig } from '../src/config/financial-settings';
import { readTheaterConfig, situations } from '../src/config/theater-settings';
import { netWorth } from '../src/core/economy';
import { chooseTrade, strategies } from '../src/core/npc-strategy';
import { seededRandom } from '../src/core/random';
import { TradingRun } from '../src/core/trading-run';
import { buildTheater, type Step } from '../src/ui/theater-script';

const config = readFinancialConfig();
const theater = readTheaterConfig(config);

function play(seed: number, onDay?: (run: TradingRun) => void) {
  const strategy = strategies[seed % strategies.length];
  const random = seededRandom(seed * 31 + 7);
  const run = new TradingRun(config, { seed, playerId: config.characters[seed % 4].id, difficulty: 'normal' });
  while (!run.closed) {
    while (run.offer) run.chooseOffer(null);
    if (!run.resolveControlled(view => chooseTrade(view, random, strategy))) break;
    if (run.pendingRecovery) run.acceptRecovery();
    onDay?.(run);
  }
  return run;
}

describe('市場事件劇場', () => {
  it('六十則新聞都有場景、主播與對話，十二種場景皆被使用', () => {
    expect(config.events).toHaveLength(60);
    for (const event of config.events) expect(theater.events[event.id], event.id).toBeDefined();
    expect(new Set(Object.values(theater.events).map(item => item.sceneId)).size).toBe(12);
    for (const situation of situations) expect(theater.lines[situation].lines.length).toBeGreaterThanOrEqual(3);
  });

  it('演出資料不重複維護金融數值', () => {
    const text = JSON.stringify(theater);
    expect(text).not.toMatch(/effectIds|floor|ceiling|\d+(\.\d+)?%/);
  });

  it('角色台詞只在實際結算支持的情境出現，且金額與名次取自紀錄', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      play(seed, run => {
        const report = run.reports.at(-1)!;
        const steps = buildTheater(run, report, theater, 'full');
        if (!report.market && !run.closed) expect(steps).toHaveLength(0);
        for (const step of steps) {
          if (step.kind !== 'line' || step.speakerKind !== 'investor') continue;
          const outcome = report.outcomes.find(item => item.investor.character.id === step.speakerId)!;
          const index = run.reports.indexOf(report);
          const before = outcome.investor.ranks[index];
          const after = outcome.investor.ranks[index + 1];
          const kind = outcome.node?.kind;
          seen.add(step.situation);
          const expectations: Record<string, boolean> = {
            lev_up: kind === 'margin' && outcome.marketPnl > 0, lev_down: kind === 'margin' && outcome.marketPnl < 0,
            shield: outcome.ledger.protected > 0, combo: outcome.ledger.synergies > 0 && outcome.close > outcome.start,
            margin_call: Boolean(outcome.risk.call), bankrupt: outcome.risk.insolvent && !outcome.recovery, recovery: Boolean(outcome.recovery),
            attacked: outcome.incomingCards.length > 0 && outcome.close < outcome.start,
            cash_rally: outcome.exposure.stock <= 0 && outcome.marketApplied, sold_rally: outcome.exposure.stock <= 0 && kind === 'cash',
            cash_dodge: outcome.exposure.stock <= 0 && outcome.marketApplied, deposit_safe: outcome.exposure.stock <= 0 && outcome.exposure.deposits > 0,
            overtake: before !== null && after !== null && after < before, rank_drop: before !== null && after !== null && after - before >= 2,
            market_gain: outcome.marketPnl > 0, market_loss: outcome.marketPnl < 0,
            champion: run.closed && run.standings().find(item => item.investor === outcome.investor)?.rank === 1
          };
          expect(expectations[step.situation], `${seed} 第 ${report.day} 日 ${step.speakerId} ${step.situation}`).toBe(true);
          const amounts = [...step.text.matchAll(/\$([\d,]+)/g)].map(match => Number(match[1].replaceAll(',', '')));
          const real = [outcome.marketPnl, outcome.ledger.protected, outcome.close - outcome.start].map(value => Math.round(Math.abs(value)));
          for (const amount of amounts) expect(real.some(value => Math.abs(value - amount) <= 1), step.text).toBe(true);
          expect(step.text).not.toMatch(/\{|\}/);
        }
        const results = steps.find((step): step is Extract<Step, { kind: 'results' }> => step.kind === 'results');
        if (results) for (const row of results.rows) {
          const outcome = report.outcomes.find(item => item.investor.character.id === row.id)!;
          expect(row.net).toBe(outcome.close - outcome.start);
          expect(row.market).toBe(outcome.marketPnl);
        }
      });
    }
    for (const situation of ['shield', 'market_gain', 'market_loss', 'champion', 'overtake']) expect(seen, situation).toContain(situation);
  });

  it('建立演出不影響結算、亂數與新聞順序，且同種子台詞固定', () => {
    const silent = play(17);
    const scripts: string[] = [];
    const watched = play(17, run => scripts.push(JSON.stringify(buildTheater(run, run.reports.at(-1)!, theater, 'full'))));
    expect(watched.reports.map(item => item.market?.id)).toEqual(silent.reports.map(item => item.market?.id));
    expect(watched.investors.map(item => netWorth(item.account))).toEqual(silent.investors.map(item => netWorth(item.account)));
    const again: string[] = [];
    play(17, run => again.push(JSON.stringify(buildTheater(run, run.reports.at(-1)!, theater, 'full'))));
    expect(again).toEqual(scripts);
  });

  it('演出長度依嚴重度與模式縮放，略過模式不演出', () => {
    const run = play(13);
    for (const report of run.reports.filter(item => item.market)) {
      const full = buildTheater(run, report, theater, 'full');
      const quick = buildTheater(run, report, theater, 'quick');
      expect(buildTheater(run, report, theater, 'off')).toHaveLength(0);
      expect(quick.length).toBeLessThanOrEqual(full.length);
      expect(full.at(-1)!.kind).toBe('results');
      if (report.market!.severity === 'normal') expect(full.filter(step => step.kind === 'line').length).toBeLessThanOrEqual(2);
    }
  });
});
