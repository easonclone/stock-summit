import { describe, expect, it } from 'vitest';
import { readFinancialConfig, type FinancialConfig } from '../src/config/financial-settings';
import { netWorth } from '../src/core/economy';
import { chooseTrade, strategies, type Planner } from '../src/core/npc-strategy';
import { seededRandom } from '../src/core/random';
import { TradingRun } from '../src/core/trading-run';

const start = (config = readFinancialConfig(), seed = 91, playerId = config.characters[0].id) =>
  new TradingRun(config, { playerId, seed, difficulty: 'normal' });

function declineOffers(run: TradingRun) {
  while (run.offer) expect(run.chooseOffer(null)).toBe(true);
}

const hold = (allocation: string): Planner => () => ({ lane: 0, card: null, allocation });

function playDay(run: TradingRun, planner: Planner = chooseTrade) {
  declineOffers(run);
  expect(run.resolveControlled(planner)).toBe(true);
  if (run.pendingRecovery) expect(run.acceptRecovery()).toBe(true);
}

function playAll(run: TradingRun, planner: Planner = chooseTrade) {
  while (!run.closed) playDay(run, planner);
  return run;
}

/** No news moves and a fixed daily market move, so every rule can be checked by hand. */
function calmMarket(config: FinancialConfig, move = 0.02) {
  config.events = [{
    id: 'test', title: '測試事件', subtitle: '測試用', category: 'flows', description: '虛構', fictional: true, weight: 1, target: 'all', severity: 'normal', effectIds: ['none']
  }];
  config.effects.none = { type: 'price', floor: 0, ceiling: 0 };
  config.effects.market_day = { type: 'price', floor: move, ceiling: move };
  return config;
}

describe('每日流程與種子', () => {
  it('同一種子及打法完整重現 15 日與每天的配置、新聞和收盤', () => {
    const summary = () => {
      const run = playAll(start());
      return run.reports.map(report => [report.day, report.market?.id ?? null,
        report.outcomes.map(outcome => [outcome.investor.character.id, outcome.allocation, outcome.close])]);
    };
    const first = summary();
    expect(first).toHaveLength(15);
    expect(summary()).toEqual(first);
  });

  it('不用選路線：每天只有固定的今日交易，地圖不影響結算', () => {
    const run = start();
    expect(run.reachable(run.player)).toEqual([{ row: 0, lane: 0, kind: 'trade', next: [0] }]);
    playDay(run);
    expect(run.player.path.map(node => node.kind)).toEqual(['trade']);
  });

  it('配置沿用前一天；不存在的配置不會被接受，也不消耗任何東西', () => {
    const run = start();
    declineOffers(run);
    expect(run.player.allocation).toBe('half');
    expect(run.confirm({ lane: 0, card: null, allocation: 'leverage' })).toBe(false);
    expect(run.day).toBe(1);
    expect(run.confirm({ lane: 0, card: null, allocation: 'all' })).toBe(true);
    if (run.pendingRecovery) run.acceptRecovery();
    declineOffers(run);
    expect(run.player.allocation).toBe('all');
    expect(run.confirm({ lane: 0, card: null })).toBe(true);
    expect(run.reports[1].outcomes.find(item => item.investor === run.player)!.allocation).toBe('all');
  });

  it('預覽沒有副作用，配置先鎖定才公布市場', () => {
    const run = start();
    declineOffers(run);
    const before = JSON.stringify(run.player.account);
    for (const option of run.config.allocation.options) run.preview(0, null, true, false, option.id);
    expect(JSON.stringify(run.player.account)).toBe(before);
    expect(run.player.allocation).toBe('half');
  });
});

describe('共同市場與資產守恆', () => {
  it('所有人承受相同的每日漲跌；股票越多賺越多，現金不受影響', () => {
    const config = calmMarket(readFinancialConfig());
    const run = start(config);
    const plan: Record<string, string> = Object.fromEntries(run.investors.map((investor, index) =>
      [investor.character.id, ['cash', 'half', 'all', 'all'][index]]));
    playDay(run, view => ({ lane: 0, card: null, allocation: plan[view.characterId] }));
    const moves = run.reports[0].outcomes.map(outcome => [outcome.allocation, outcome.ledger.baseMarket, outcome.close]);
    expect(moves).toEqual([['cash', 0, 10000], ['half', 100, 10100], ['all', 200, 10200], ['all', 200, 10200]]);
  });

  it('沒有卡片時，每日變化正好等於股市與新聞；任何時候都沒有負現金、負股票或欠款', () => {
    for (const strategy of strategies) {
      const random = seededRandom(7);
      const run = playAll(start(readFinancialConfig(), 13), view => chooseTrade(view, random, strategy));
      for (const report of run.reports) for (const outcome of report.outcomes) {
        if (!outcome.card && !outcome.incomingCards.length && !outcome.recovery && !outcome.openingInterest && !outcome.openingStockIncome
          && !outcome.ledger.cardGain) {
          expect(outcome.close - outcome.start, `${strategy} 第 ${report.day} 日`).toBe(outcome.ledger.baseMarket + outcome.marketPnl);
        }
      }
      for (const investor of run.investors) {
        expect(investor.account.cash).toBeGreaterThanOrEqual(0);
        expect(investor.account.investmentValue).toBeGreaterThanOrEqual(0);
        expect(netWorth(investor.account)).toBe(investor.account.cash + investor.account.investmentValue);
        expect(Object.keys(investor.account)).not.toContain('debt');
      }
    }
  });
});

describe('歸零與翻身', () => {
  it('四人同時歸零：玩家先決定翻身，翻身只有一次，第二次全部出局會立即收盤', () => {
    const run = start(calmMarket(readFinancialConfig(), 0));
    declineOffers(run);
    for (const investor of run.investors) Object.assign(investor.account, { cash: 0, investmentValue: 0 });
    expect(run.resolveControlled(hold('half'))).toBe(true);
    expect(run.pendingRecovery).not.toBeNull();
    expect(run.acceptRecovery()).toBe(true);
    for (const investor of run.investors) {
      expect(investor.recoveries).toBe(1);
      expect(netWorth(investor.account)).toBe(run.config.financial.recoveryCash);
      expect(investor.hedges).toEqual([]);
      expect(investor.hand.length).toBeLessThanOrEqual(1);
    }
    declineOffers(run);
    for (const investor of run.investors) Object.assign(investor.account, { cash: 0, investmentValue: 0 });
    expect(run.resolveControlled(hold('half'))).toBe(true);
    expect(run.pendingRecovery).toBeNull();
    expect(run.investors.every(investor => investor.account.eliminated)).toBe(true);
    expect(run.closed).toBe(true);
  });
});

describe('卡片', () => {
  it('卡池不再含借款、還款、利息或追繳相關卡片', () => {
    const config = readFinancialConfig();
    const ids = config.cards.map(card => card.id);
    for (const retired of ['bailout', 'restructure', 'repay', 'exit', 'audit', 'margin_coupon', 'redeem', 'credit', 'higher_interest']) {
      expect(ids).not.toContain(retired);
    }
    expect(ids).toHaveLength(21);
  });

  it('順風車在一半買股時觸發連招，全留現金時告知沒有股票', () => {
    const config = calmMarket(readFinancialConfig());
    const run = start(config);
    declineOffers(run);
    run.player.hand = [config.cards.find(card => card.id === 'trend')!];
    const half = run.preview(0, 0, true, false, 'half')!;
    expect(half.enabledCard).toBe(true);
    expect(half.synergies).toBe(1);
    const cash = run.preview(0, 0, true, false, 'cash')!;
    expect(cash.enabledCard).toBe(false);
    expect(cash.cardBlock).toBe('no_stock');
  });

  it('主力狙擊只影響開盤時排名最近、手上有股票的領先者', () => {
    const config = calmMarket(readFinancialConfig(), 0);
    const run = start(config, 5);
    declineOffers(run);
    run.player.account.cash = 9000;
    const [leader, ...others] = run.investors.filter(investor => investor !== run.player);
    Object.assign(leader.account, { cash: 10000, investmentValue: 2000 });
    for (const other of others) Object.assign(other.account, { cash: 8000, investmentValue: 0 });
    run.player.hand = [config.cards.find(card => card.id === 'snipe')!];
    expect(run.resolveControlled(view => view.characterId === run.player.character.id
      ? { lane: 0, card: 0, allocation: 'cash' } : { lane: 0, card: null, allocation: 'all' })).toBe(true);
    const outcomes = run.reports[0].outcomes;
    const hit = outcomes.filter(outcome => outcome.incomingCards.length);
    expect(hit.map(outcome => outcome.investor)).toEqual([leader]);
    expect(hit[0].close).toBe(Math.round(12000 * 0.95));
  });

  it('情報只交給取得的人；電腦看不到別人的預告', () => {
    const config = readFinancialConfig();
    const run = start(config);
    declineOffers(run);
    run.player.hand = [config.cards.find(card => card.id === 'intel')!];
    playDay(run, view => view.characterId === run.player.character.id ? { lane: 0, card: 0 } : { lane: 0, card: null });
    expect(run.intelligenceFor(run.player)).toHaveLength(1);
    for (const investor of run.investors.filter(item => item !== run.player)) {
      expect(run.decisionView(investor).knownEvent).toBeNull();
    }
  });
});
