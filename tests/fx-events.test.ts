import { describe, expect, it } from 'vitest';
import { readFinancialConfig, type FinancialConfig } from '../src/config/financial-settings';
import { readFeedbackConfig } from '../src/config/feedback-settings';
import { chooseTrade, strategies, type Planner } from '../src/core/npc-strategy';
import { seededRandom } from '../src/core/random';
import { TradingRun, type DayReport, type Investor } from '../src/core/trading-run';
import { buildFxPlan, hitTier, type FxEvent } from '../src/ui/fx-events';

const config = readFinancialConfig();
const feedback = readFeedbackConfig();

function play(seed: number, onDay?: (run: TradingRun, report: DayReport) => void) {
  const strategy = strategies[seed % strategies.length];
  const random = seededRandom(seed * 104729);
  const run = new TradingRun(config, { seed, playerId: config.characters[seed % 4].id, difficulty: 'normal' });
  while (!run.closed) {
    while (run.offer) run.chooseOfferAutomatically();
    if (run.shop) run.shopAutomatically();
    while (run.offer) run.chooseOfferAutomatically();
    if (!run.resolveControlled(view => chooseTrade(view, random, strategy))) break;
    if (run.pendingRecovery) run.acceptRecovery();
    onDay?.(run, run.reports.at(-1)!);
  }
  return run;
}

const of = <K extends FxEvent['kind']>(events: FxEvent[], kind: K) => events.filter((event): event is Extract<FxEvent, { kind: K }> => event.kind === kind);

describe('攻防演出事件只讀結算紀錄', () => {
  it('每位角色的財富條最後一格等於收盤；浮字金額與攻擊紀錄、結算明細完全一致', () => {
    let attacks = 0;
    let misses = 0;
    let checked = 0;
    for (let seed = 1; seed <= 80; seed++) {
      play(seed, (run, report) => {
        const plan = buildFxPlan(feedback, report, run.player.character.id);
        const events = plan.events;
        for (const outcome of report.outcomes) {
          const seat = plan.seats.find(item => item.id === outcome.investor.character.id)!;
          expect(seat.frames.at(-1)?.value ?? seat.start, `種子 ${seed} 第 ${report.day} 日`).toBe(outcome.close);
          expect(seat.frames.map(frame => frame.at)).toEqual([...seat.frames.map(frame => frame.at)].sort((a, b) => a - b));
          expect(seat.peak).toBeGreaterThanOrEqual(Math.max(...seat.frames.map(frame => frame.value), seat.start));
          if (outcome.recovery) continue;
          // Attack deltas shown on this seat equal the attack lines of its own settlement chain.
          const id = outcome.investor.character.id;
          const fromSteps = outcome.ledger.steps.filter(step => step.source === 'attack').reduce((sum, step) => sum + step.amount, 0);
          const shown = of(events, 'attack').filter(event => event.to === id).reduce((sum, event) => sum - event.amount, 0)
            + of(events, 'shatter').filter(event => event.to === id).reduce((sum, event) => sum - event.amount, 0)
            + of(events, 'raid').reduce((sum, event) => sum + (event.from === id ? event.amount : event.to === id ? -event.amount : 0), 0)
            + of(events, 'reflect').reduce((sum, event) => sum + (event.hit === id ? -event.amount : event.owner === id && event.cash ? event.amount : 0), 0);
          expect(shown, `種子 ${seed} 第 ${report.day} 日 ${id}`).toBe(fromSteps);
          const jokerSteps = outcome.ledger.steps.filter(step => (step.source === 'joker' || step.source === 'cap') && step.amount);
          const jokerShown = id === run.player.character.id
            ? of(events, 'joker').filter(event => event.id === id).reduce((sum, event) => sum + event.amount, 0)
            : of(events, 'jokers').filter(event => event.id === id).reduce((sum, event) => sum + event.amount, 0);
          expect(jokerShown).toBe(jokerSteps.reduce((sum, step) => sum + step.amount, 0));
          checked++;
        }
        const landed = events.filter(event => event.kind === 'attack' || event.kind === 'shatter' || event.kind === 'raid') as Extract<FxEvent, { kind: 'attack' | 'shatter' | 'raid' }>[];
        expect(landed).toHaveLength(report.attacks.length);
        for (const [index, record] of report.attacks.entries()) {
          expect(landed[index]).toMatchObject({ from: record.from, to: record.to, amount: record.amount, itemId: record.itemId });
        }
        expect(of(events, 'reflect').map(event => event.amount)).toEqual(report.attacks.filter(hit => hit.reflected > 0).map(hit => hit.reflected));
        expect(of(events, 'miss')).toHaveLength(report.misses.length);
        attacks += report.attacks.length;
        misses += report.misses.length;
      });
    }
    expect(checked).toBeGreaterThan(3000);
    expect(attacks).toBeGreaterThan(50);
    expect(misses).toBeGreaterThan(0);
  });

  it('建立演出不改變任何結果：同種子有沒有產生演出，收盤與攻擊紀錄完全相同', () => {
    const summary = (watch: boolean) => play(7, watch ? (run, report) => { buildFxPlan(feedback, report, run.player.character.id); } : undefined)
      .reports.map(report => [report.attacks, report.outcomes.map(outcome => outcome.close)]);
    expect(summary(true)).toEqual(summary(false));
    const run = play(11);
    const report = run.reports[4];
    const before = JSON.stringify(report.outcomes.map(outcome => outcome.ledger));
    buildFxPlan(feedback, report, run.player.character.id);
    expect(JSON.stringify(report.outcomes.map(outcome => outcome.ledger))).toBe(before);
  });

  it('命中分級只看傷害占開盤身家的比例；只影響演出', () => {
    expect(hitTier(299, 10000, feedback)).toBe('light');
    expect(hitTier(300, 10000, feedback)).toBe('normal');
    expect(hitTier(800, 10000, feedback)).toBe('strong');
    expect(hitTier(1500, 10000, feedback)).toBe('heavy');
    expect(() => readFeedbackConfig({ ...feedback, tiers: { normal: 0.1, strong: 0.05, heavy: 0.2 } })).toThrow('命中分級門檻須遞增');
  });
});

/** Fixed market, no news, and no free cards, so a scripted day shows exactly the scripted hits. */
function calm(move = 0): FinancialConfig {
  const calmConfig = readFinancialConfig();
  calmConfig.events = [{ id: 'test', title: '測試', subtitle: '測試', category: 'flows', description: '虛構', fictional: true, weight: 1, target: 'all', severity: 'normal', effectIds: ['none'] }];
  calmConfig.effects.none = { type: 'price', floor: 0, ceiling: 0 };
  calmConfig.effects.market_day = { type: 'price', floor: move, ceiling: move };
  calmConfig.gameplay.startItems = 0;
  calmConfig.gameplay.dailyItemStart = null;
  calmConfig.gameplay.stageDays = [];
  return calmConfig;
}

function scripted(cards: Record<number, string[]>, planner: (view: { characterId: string }, ids: string[]) => ReturnType<Planner>, move = 0, setup?: (seats: Investor[]) => void) {
  const run = new TradingRun(calm(move), { seed: 5, playerId: 'pan', difficulty: 'normal' });
  while (run.offer) run.chooseOffer(null);
  const ids = run.investors.map(investor => investor.character.id);
  run.investors.forEach((investor, index) => {
    investor.jokers = [];
    investor.items = (cards[index] ?? []).map(id => run.config.items.find(card => card.id === id)!);
  });
  setup?.(run.investors);
  expect(run.resolveControlled(view => planner(view, ids))).toBe(true);
  return { run, plan: buildFxPlan(feedback, run.reports[0], run.player.character.id), ids };
}

describe('各種攻防的專屬演出', () => {
  it('對手沒有股票時只顯示未命中，不顯示傷害，道具保留', () => {
    const { run, plan, ids } = scripted({ 0: ['snipe'] }, (view, seats) => view.characterId === seats[0]
      ? { allocation: 'all', item: 0, targetId: seats[1] } : { allocation: 'cash', item: null });
    expect(of(plan.events, 'attack')).toEqual([]);
    expect(of(plan.events, 'miss')).toMatchObject([{ from: ids[0], to: ids[1], reason: 'no_stock' }]);
    expect(plan.seats.find(seat => seat.id === ids[1])!.frames).toEqual([]);
    expect(run.player.items.map(card => card.id)).toEqual(['snipe']);
  });

  it('雙重打擊加空頭突襲：浮字顯示實際傷害、×2 與重擊分級', () => {
    const { run, plan, ids } = scripted({ 0: ['strike_boost', 'rush'] }, (view, seats) => view.characterId === seats[0]
      ? { allocation: 'all', actions: [{ slot: 0 }, { slot: 1, targetId: seats[1] }] } : { allocation: 'all', item: null });
    const [hit] = of(plan.events, 'attack');
    expect(hit).toMatchObject({ from: ids[0], to: ids[1], factor: 2, tier: 'heavy', amount: run.reports[0].attacks[0].amount });
    expect(hit.amount).toBe(2500);
  });

  it('股市大混戰同時打三人；掠奪顯示雙方金額；反擊方向與紀錄一致', () => {
    const brawl = scripted({ 0: ['brawl'] }, (view, seats) => view.characterId === seats[0]
      ? { allocation: 'all', item: 0 } : { allocation: 'all', item: null });
    expect(of(brawl.plan.events, 'attack').map(event => event.to)).toEqual(expect.arrayContaining(brawl.ids.slice(1)));
    expect(of(brawl.plan.events, 'attack').every(event => event.area)).toBe(true);
    expect(new Set(of(brawl.plan.events, 'attack').map(event => event.at)).size).toBe(1);

    const raid = scripted({ 0: ['raid'], 1: ['mirror'] }, (view, seats) => view.characterId === seats[0]
      ? { allocation: 'cash', item: 0, targetId: seats[1] } : { allocation: 'cash', item: view.characterId === seats[1] ? 0 : null });
    const [record] = raid.run.reports[0].attacks;
    expect(of(raid.plan.events, 'raid')).toMatchObject([{ from: raid.ids[0], to: raid.ids[1], amount: record.amount }]);
    expect(of(raid.plan.events, 'reflect')).toMatchObject([{ owner: raid.ids[1], hit: raid.ids[0], amount: record.reflected, cash: true }]);
  });

  it('護盾格擋顯示實際少賠金額；破盾顯示破盾', () => {
    const block = scripted({}, () => ({ allocation: 'all', item: null }), -0.04, seats => {
      seats[0].defenses.push({ itemId: 'guard', name: '防跌護盾', mode: 'cut', amount: 0.5 });
    });
    const defense = of(block.plan.events, 'defense');
    expect(defense).toMatchObject([{ id: block.ids[0], amount: block.run.reports[0].outcomes[0].ledger.shielded }]);
    expect(defense[0].amount).toBeGreaterThan(0);
    expect(of(block.plan.events, 'attack')).toEqual([]);

    const shatter = scripted({ 0: ['shatter'] }, (view, seats) => view.characterId === seats[0]
      ? { allocation: 'all', item: 0, targetId: seats[1] } : { allocation: 'all', item: null }, 0, seats => {
      seats[1].defenses.push({ itemId: 'guard', name: '防跌護盾', mode: 'cut', amount: 0.5 });
    });
    expect(of(shatter.plan.events, 'shatter')).toMatchObject([{ from: shatter.ids[0], to: shatter.ids[1] }]);
  });

  it('市場漲跌只產生市場浮字，不產生命中', () => {
    for (const move of [0.05, -0.04]) {
      const { plan } = scripted({}, () => ({ allocation: 'all', item: null }), move);
      const market = of(plan.events, 'market');
      expect(market).toHaveLength(4);
      expect(market.every(event => Math.sign(event.amount) === Math.sign(move) && event.big)).toBe(true);
      expect(plan.events.some(event => ['attack', 'raid', 'shatter', 'reflect', 'miss'].includes(event.kind))).toBe(false);
    }
  });

  it('王牌連鎖依序發動，累計金額與次數取自結算明細', () => {
    const { run, plan } = scripted({}, () => ({ allocation: 'all', item: null }), 0.05, seats => {
      seats[0].jokers = ['diamond', 'gambler', 'cash_cow'].map(id => readFinancialConfig().jokers.find(card => card.id === id)!);
    });
    const chain = of(plan.events, 'joker');
    const steps = run.reports[0].outcomes[0].ledger.steps.filter(step => (step.source === 'joker' || step.source === 'cap') && step.amount);
    expect(chain.map(event => event.amount)).toEqual(steps.map(step => step.amount));
    expect(chain.map(event => event.count)).toEqual(steps.map((_, index) => index + 1));
    expect(chain.at(-1)!.total).toBe(steps.reduce((sum, step) => sum + step.amount, 0));
    expect(chain.map(event => event.at)).toEqual([...chain.map(event => event.at)].sort((a, b) => a - b));
  });
});
