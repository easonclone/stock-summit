import { describe, expect, it } from 'vitest';
import { readFinancialConfig, type FinancialConfig } from '../src/config/financial-settings';
import { netWorth } from '../src/core/economy';
import { generateNodeMap, nodeMapProblems } from '../src/core/node-map';
import { chooseTrade } from '../src/core/npc-strategy';
import type { Planner } from '../src/core/npc-strategy';
import { TradingRun } from '../src/core/trading-run';

const start = (config = readFinancialConfig(), seed = 91, playerId = config.characters[0].id) =>
  new TradingRun(config, { playerId, seed, difficulty: 'normal' });

function declineOffers(run: TradingRun) {
  while (run.offer) expect(run.chooseOffer(null)).toBe(true);
}

const first: Planner = view => ({ lane: view.routes[0].lane, card: null });

function playDay(run: TradingRun, planner = first) {
  declineOffers(run);
  expect(run.resolveControlled(planner)).toBe(true);
  if (run.pendingRecovery) expect(run.acceptRecovery()).toBe(true);
}

function removeVolatility(config: FinancialConfig) {
  config.events = [{
    id: 'test', title: '測試事件', description: '虛構', fictional: true, weight: 1, target: 'all', severity: 'normal', effectIds: ['none']
  }];
  config.effects.none = { type: 'price', floor: 0, ceiling: 0 };
  for (const kind of Object.values(config.nodes.kinds)) kind.effectIds = [];
  return config;
}

function insolvent(run: TradingRun, all = false) {
  for (const investor of all ? run.investors : [run.player]) {
    Object.assign(investor.account, { cash: 0, investmentValue: 0, marginDebt: 1500 });
    investor.account.deposits = [];
  }
}

describe('交易入口及種子', () => {
  it('生成 1,000 組可達、不交叉的路線，每日類型不重複，單線最多連續兩日', () => {
    const config = readFinancialConfig();
    for (let seed = 1; seed <= 1000; seed++) {
      const map = generateNodeMap(config, seed);
      expect(nodeMapProblems(map, config)).toEqual([]);
      for (const [row, nodes] of map.rows.entries()) {
        expect(new Set(nodes.map(node => node.kind)).size).toBe(4);
        if (row > 11) continue;
        for (const node of nodes) {
          expect([0, 1, 2].some(delta => map.rows[row + delta][node.lane].next.length > 1)).toBe(true);
        }
      }
    }
  });

  it('同一種子及選擇完整重現 15 日、五次事件與財務結算', () => {
    const play = () => {
      const run = start();
      for (let day = 0; day < 15 && !run.closed; day++) playDay(run, chooseTrade);
      expect(run.closed).toBe(true);
      expect(run.reports).toHaveLength(15);
      expect(run.reports.filter(report => report.market)).toHaveLength(5);
      for (const investor of run.investors) {
        expect(investor.closes).toHaveLength(investor.path.length + 1);
        investor.path.slice(1).forEach((node, index) => expect(investor.path[index].next).toContain(node.lane));
      }
      return { reports: run.reports, investors: run.investors, standings: run.standings() };
    };
    expect(play()).toEqual(play());
  });

  it('決策與第三方事件依開盤狀態鎖定，所有角色使用同一策略得到同樣帳務規則', () => {
    const config = removeVolatility(readFinancialConfig());
    config.events[0].target = 'first_place';
    config.effects.none = { type: 'price', floor: -0.25, ceiling: -0.25 };
    config.gameplay.eventEvery = 1;
    for (const kind of Object.values(config.nodes.kinds)) kind.effectIds = ['invest'];
    const run = start(config);
    run.investors[1].account.cash = 10001;
    const snapshots: number[] = [];
    expect(run.resolveControlled(view => {
      snapshots.push(view.state.account.investmentValue);
      return first(view, Math.random);
    })).toBe(true);
    expect(snapshots).toEqual([0, 0, 0, 0]);
    const [a, b, c, d] = run.investors;
    expect([a, c, d].map(item => netWorth(item.account))).toEqual([10000, 10000, 10000]);
    expect(netWorth(b.account)).toBe(9251);
  });

  it('預覽無副作用，無效的選擇不消耗卡片或影響電腦決策', () => {
    const a = start();
    const b = start();
    const lane = a.reachable(a.player)[0].lane;
    const cards = [...a.player.hand];
    a.preview(lane, 0);
    expect(a.player.hand).toEqual(cards);
    expect(a.confirm({ lane: 99, card: null })).toBe(false);
    expect(a.confirm({ lane, card: 99 })).toBe(false);
    expect(a.confirm({ lane, card: null })).toBe(true);
    expect(b.confirm({ lane, card: null })).toBe(true);
    expect(a.reports).toEqual(b.reports);
  });

  it('各角色抽卡序列相互獨立，切換玩家席不改變其他角色的起手牌', () => {
    const a = start();
    const b = start(readFinancialConfig(), 91, 'ting');
    expect(a.investors.map(item => item.hand)).toEqual(b.investors.map(item => item.hand));
    expect(new Set(a.investors.map(item => item.hand.map(card => card.id).join(','))).size).toBeGreaterThan(1);
  });

  it('滿手自選替換，三選一卡的選項互異，事件預告只交給取得的角色', () => {
    const config = removeVolatility(readFinancialConfig());
    config.gameplay.initialHand = 4;
    const run = start(config);
    const node = run.reachable(run.player)[0];
    Object.assign(config.nodes.kinds[node.kind], { draft: 'open', effectIds: ['reveal'] });
    const firstCard = run.player.hand[0];
    const other = run.investors[1];
    other.path.push({ row: -1, lane: 1, kind: 'wait', next: [1] });
    expect(run.confirm({ lane: node.lane, card: null }, first)).toBe(true);
    expect(run.intelFor(run.player)?.id).toBe('test');
    expect(run.intelFor(other)).toBeNull();
    expect(run.offer?.source).toBe('draw');
    expect(run.chooseOffer(0)).toBe(false);
    expect(run.chooseOffer(0, 0)).toBe(true);
    expect(run.player.hand[0]).not.toEqual(undefined);
    expect(run.offer?.source).toBe('draft');
    expect(new Set(run.offer?.cards.map(card => card.id)).size).toBe(3);
    const chosen = run.offer!.cards[0];
    expect(run.chooseOffer(0, 0)).toBe(true);
    expect(run.player.hand[0]).toEqual(chosen);
    expect(firstCard).toBeDefined();
  });

  it('先用避險再結算市場，已知未來事件不計入今日收益', () => {
    const config = removeVolatility(readFinancialConfig());
    config.effects.none = { type: 'price', floor: -0.5, ceiling: -0.5 };
    const run = start(config);
    run.player.hand[0] = config.cards.find(card => card.id === 'hedge')!;
    run.player.account.investmentValue = 5000;
    run.player.intelDay = 3;
    expect(run.intelFor(run.player)?.id).toBe('test');
    expect(run.preview(0, null)?.low).toBe(0);
    playDay(run);
    playDay(run);
    expect(run.preview(run.reachable(run.player)[0].lane, null)?.low).toBe(-2500);
    expect(run.confirm({ lane: run.reachable(run.player)[0].lane, card: 0 }, first)).toBe(true);
    const outcome = run.reports[2].outcomes.find(item => item.investor === run.player);
    expect(outcome?.marketPnl).toBe(-1000);
    expect(outcome?.ledger.protected).toBe(1500);
    expect(run.player.hedgesUsed).toBe(1);
  });

  it('需要對應節點才會消耗協同卡，預覽與實際收益可對帳', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const lane = run.reachable(run.player)[0].lane;
    const kind = config.nodes.kinds[run.reachable(run.player)[0].kind];
    kind.effectIds = ['invest', 'flat'];
    kind.tags = ['steady'];
    config.effects.flat = { type: 'price', floor: 0, ceiling: 0 };
    run.player.hand[0] = config.cards.find(card => card.id === 'trend')!;
    expect(run.preview(lane, 0)?.synergyGain).toBe(141);
    expect(run.confirm({ lane, card: 0 }, first)).toBe(true);
    expect(run.reports[0].outcomes[0].ledger.synergyGain).toBe(141);
    expect(netWorth(run.player.account)).toBe(10141);
  });

  it('競爭型卡片僅針對同一開盤快照的融資領先者，並列者受相同追繳門檻', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const audit = config.cards.find(card => card.id === 'audit')!;
    const lane = run.reachable(run.player)[0].lane;
    run.player.hand[0] = audit;
    expect(run.preview(lane, 0)?.enabledCard).toBe(false);
    expect(run.confirm({ lane, card: 0 }, first)).toBe(false);
    for (const rival of run.investors.slice(1, 3)) {
      Object.assign(rival.account, { cash: 10000, investmentValue: 20000, marginDebt: 15800 });
    }
    expect(run.preview(lane, 0)?.opponents).toEqual(['尤尤', '老伯']);
    expect(run.confirm({ lane, card: 0 }, first)).toBe(true);
    const [player, ...rivals] = run.reports[0].outcomes;
    expect(player.targetedRivals).toEqual(['尤尤', '老伯']);
    expect(rivals.map(item => item.risk.call?.threshold ?? null)).toEqual([0.79, 0.79, null]);
    expect(run.player.used).toBe(1);
  });
});

describe('破產調度與公平收盤', () => {
  it('四人同時破產，重整只執行一次，第二次全部出局會立即收盤', () => {
    const run = start(removeVolatility(readFinancialConfig()));
    insolvent(run, true);
    expect(run.resolveControlled(first)).toBe(true);
    expect(run.pendingRecovery?.outcomes).toHaveLength(4);
    expect(run.resolveControlled(first)).toBe(false);
    expect(run.acceptRecovery()).toBe(true);
    expect(run.acceptRecovery()).toBe(false);
    expect(run.investors.map(item => [netWorth(item.account), item.account.bankruptcyCount, item.hand.length])).toEqual(
      Array.from({ length: 4 }, () => [500, 1, 1])
    );
    insolvent(run, true);
    playDay(run);
    expect(run.closed).toBe(true);
    expect(run.standings().map(item => item.rank)).toEqual([null, null, null, null]);
    expect(run.investors.every(item => item.account.bankruptcyCount === 2)).toBe(true);
  });

  it('出局角色不再抽牌或出手，最高淨資產同分並列', () => {
    const config = removeVolatility(readFinancialConfig());
    config.financial.maxRecoveries = 0;
    const run = start(config);
    insolvent(run);
    playDay(run);
    const hand = [...run.player.hand];
    expect(run.confirm(null, first)).toBe(true);
    expect(run.player.path).toHaveLength(1);
    expect(run.player.hand).toEqual(hand);
    expect(run.standings().map(item => item.rank)).toEqual([1, 1, 1, null]);
  });

  it('最後一日先列重整費、後宣告破產，融資按時入帳且無最後一日免費重置', () => {
    const config = removeVolatility(readFinancialConfig());
    config.gameplay.turns = 2;
    config.gameplay.eventEvery = 2;
    const run = start(config);
    insolvent(run);
    playDay(run);
    expect(run.player.account.closingPayable).toBe(500);
    playDay(run);
    expect(run.pendingRecovery).toBeNull();
    expect(run.player.account.bailoutDebt).toBe(2000);
    expect(run.player.account.bankruptcyCount).toBe(2);
    expect(run.player.account.eliminated).toBe(true);

    const leveraged = start(removeVolatility(readFinancialConfig()));
    leveraged.config.gameplay.turns = 1;
    const lane = leveraged.reachable(leveraged.player)[0].lane;
    leveraged.config.nodes.kinds[leveraged.reachable(leveraged.player)[0].kind].effectIds = ['margin_buy'];
    expect(leveraged.confirm({ lane, card: null }, first)).toBe(true);
    expect(leveraged.player.account.marginDebt).toBeGreaterThan(0);
    expect(netWorth(leveraged.player.account)).toBeLessThan(10000);
  });
});
