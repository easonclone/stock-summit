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
    id: 'test', title: '測試事件', subtitle: '測試用', category: 'flows', description: '虛構', fictional: true, weight: 1, target: 'all', severity: 'normal', effectIds: ['none']
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
    config.cardRules.expanded = false;
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

  it('卡片預覽提供引擎判斷的即時原因、金額及護盾效果', () => {
    const config = removeVolatility(readFinancialConfig());
    config.cardRules.expanded = false;
    const run = start(config);
    const lane = run.reachable(run.player)[0].lane;
    const choose = (id: string) => { run.player.hand[0] = config.cards.find(card => card.id === id)!; };
    choose('exit');
    expect(run.preview(lane, 0)?.cardBlock).toBe('no_stock');
    choose('restructure');
    expect(run.preview(lane, 0)?.cardBlock).toBe('no_debt');
    choose('hedge');
    run.player.hedges = [0.6, 0.8];
    expect(run.preview(lane, 0)?.cardBlock).toBe('full_shield');
    run.player.hedges = [];
    choose('cash');
    expect(run.preview(lane, 0)?.cardImpact?.cash).toBe(240);
    expect(run.player.account.cash).toBe(10000);

    config.effects.none = { type: 'price', floor: -0.5, ceiling: -0.5 };
    run.player.account.investmentValue = 5000;
    playDay(run);
    playDay(run);
    choose('hedge');
    expect(run.preview(run.reachable(run.player)[0].lane, 0, true)?.extraProtection).toBe(1500);
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


describe('卡牌自由度', () => {
  it('基本效果與搭配加成互斥，借款失敗仍可使用有股票的基本效果', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    run.player.account.investmentValue = 10000;
    run.player.hand[0] = config.cards.find(card => card.id === 'trend')!;
    const [node] = run.reachable(run.player);
    const kind = config.nodes.kinds[node.kind];
    kind.tags = ['wait'];
    expect(run.preview(node.lane, 0)).toMatchObject({ enabledCard: true, baseGain: 200, activeComboGain: 0 });
    config.effects.flat = { type: 'price', floor: 0, ceiling: 0 };
    kind.tags = ['steady'];
    kind.effectIds = ['flat'];
    expect(run.preview(node.lane, 0)).toMatchObject({ enabledCard: true, baseGain: 0, activeComboGain: 470 });
    run.player.hand[0] = config.cards.find(card => card.id === 'margin')!;
    kind.tags = ['margin'];
    kind.effectIds = ['margin_buy', 'flat'];
    run.player.account.leverageRestrictedUntil = 1;
    expect(run.preview(node.lane, 0)).toMatchObject({ enabledCard: true, available: false, baseGain: 200 });
  });

  it('股息布局限時觸發一次，同名牌不重複加成', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const dividend = config.cards.find(card => card.id === 'dividend')!;
    run.player.account.investmentValue = 10000;
    run.player.hand[0] = dividend;
    const lane = run.reachable(run.player)[0].lane;
    expect(run.confirm({ lane, card: 0, prepare: true }, first)).toBe(true);
    expect(run.reports[0].outcomes[0].ledger.dividends).toBe(0);
    expect(run.player.prepared).toEqual([{ id: dividend.id, kind: 'dividend', expires: 4, amount: 0.9 }]);
    declineOffers(run);
    run.player.hand[0] = dividend;
    const [target] = run.reachable(run.player);
    const kind = config.nodes.kinds[target.kind];
    expect(run.preview(target.lane, 0, false, true)?.cardBlock).toBe('already_prepared');
    kind.tags = ['income'];
    kind.effectIds = ['dividend'];
    expect(run.preview(target.lane, 0)?.enabledCard).toBe(false);
    expect(run.confirm({ lane: target.lane, card: null }, first)).toBe(true);
    expect(run.reports[1].outcomes[0].ledger).toMatchObject({ dividends: 1026, preparedTriggers: 1 });
    expect(run.player.prepared).toEqual([]);
  });

  it('優惠券只在成功借款時免一次開辦費，逾期或重整便清除', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const use = () => {
      run.player.hand[0] = config.cards.find(card => card.id === 'margin_coupon')!;
      expect(run.confirm({ lane: run.reachable(run.player)[0].lane, card: 0 }, first)).toBe(true);
    };
    use();
    declineOffers(run);
    const [node] = run.reachable(run.player);
    const kind = config.nodes.kinds[node.kind];
    kind.effectIds = ['margin_buy'];
    expect(run.preview(node.lane, null)?.feeSaved).toBeGreaterThan(0);
    playDay(run);
    expect(run.reports[1].outcomes[0].ledger.preparedTriggers).toBe(1);
    expect(run.player.prepared).toEqual([]);

    const expiring = start(removeVolatility(readFinancialConfig()));
    expiring.player.hand[0] = expiring.config.cards.find(card => card.id === 'margin_coupon')!;
    expect(expiring.confirm({ lane: expiring.reachable(expiring.player)[0].lane, card: 0 }, first)).toBe(true);
    for (let i = 0; i < 3; i++) playDay(expiring);
    expect(expiring.player.prepared).toEqual([]);

    run.player.prepared = [{ id: 'margin_coupon', kind: 'fee', amount: 0, expires: run.day + 2 }];
    insolvent(run);
    playDay(run);
    expect(run.player.recoveries).toBe(1);
    expect(run.player.prepared).toEqual([]);
  });

  it('起手保證自由牌、換牌種子可重現且一局最多三次', () => {
    const runs = [start(), start()];
    for (const run of runs) {
      expect(run.investors.every(investor => investor.hand.slice(0, 2).some(card => card.freedom === 'free'))).toBe(true);
      for (let index = 0; index < 3; index++) {
        const before = run.player.hand[0].id;
        expect(run.exchangePlayerCard(0)).toBe(true);
        expect(run.player.hand[0].id).not.toBe(before);
      }
      expect(run.exchangePlayerCard(0)).toBe(false);
      expect(run.player.hand).toHaveLength(3);
    }
    expect(runs[0].player.hand).toEqual(runs[1].player.hand);
  });
});


describe('完整卡池', () => {
  it('卡牌規劃的 30 張均接上資料，抽牌及換牌保持可重現', () => {
    const config = readFinancialConfig();
    expect(config.cards).toHaveLength(30);
    expect(new Set(config.cards.map(card => card.id)).size).toBe(30);
    for (const [freedom, expected] of [['free',18],['pair',9],['special',3]] as const) {
      expect(config.cards.filter(card => card.freedom === freedom)).toHaveLength(expected);
    }
    expect(start(config).investors.map(item => item.hand)).toEqual(start(config).investors.map(item => item.hand));
    expect(start(config).investors.every(item => new Set(item.hand.map(card => card.id)).size === item.hand.length)).toBe(true);
  });

  it('新資料的基本效果不用綁死路線，實際加成可從帳本辨識', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const [node] = run.reachable(run.player);
    const kind = config.nodes.kinds[node.kind];
    run.player.hand[0] = config.cards.find(card => card.id === 'gift')!;
    kind.tags = ['speculative'];
    expect(run.preview(node.lane, 0)?.cardImpact?.cash).toBe(300);
    expect(run.preview(node.lane, 0)?.synergies).toBe(0);
    kind.tags = ['steady'];
    expect(run.preview(node.lane, 0)?.cardImpact?.cash).toBe(360);
    expect(run.preview(node.lane, 0)?.synergies).toBe(1);
  });

  it('定存加息只收一次，解約取回本金而不增加總身家', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    run.player.account.cash = 9000;
    run.player.account.deposits.push({ balance: 1000, maturity: 4 });
    run.player.hand[0] = config.cards.find(card => card.id === 'compound')!;
    expect(run.confirm({lane: run.reachable(run.player)[0].lane, card: 0}, first)).toBe(true);
    expect(run.player.account.stats.depositYield).toBeGreaterThan(22);
    const cash = run.player.account.cash;
    run.player.hand[0] = config.cards.find(card => card.id === 'redeem')!;
    expect(run.preview(run.reachable(run.player)[0].lane, 0)?.cardImpact?.cash).toBe(1000);
    expect(run.player.account.cash).toBe(cash);
  });

  it('獨家消息只揭露給用牌者；重新洗牌不會抽回同一效果', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    run.player.hand[0] = config.cards.find(card => card.id === 'exclusive')!;
    expect(run.confirm({ lane: run.reachable(run.player)[0].lane, card: 0 }, first)).toBe(true);
    expect(run.intelligenceFor(run.player).map(item => item.day)).toEqual([3, 6]);
    expect(run.intelligenceFor(run.investors[1])).toEqual([]);
    declineOffers(run);
    run.player.hand[0] = config.cards.find(card => card.id === 'reshuffle')!;
    expect(run.confirm({ lane: run.reachable(run.player)[0].lane, card: 0 }, first)).toBe(true);
    while (run.offer?.source === 'draw') expect(run.chooseOffer(null)).toBe(true);
    expect(run.offer?.source).toBe('draft');
    expect(new Set(run.offer?.cards.map(card => card.id)).size).toBe(3);
    expect(run.offer?.cards.some(card => card.id === 'reshuffle')).toBe(false);
  });

  it('融資管制鎖定開盤領先者，完成交易後不會新增其融資', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const player = run.player;
    const rival = run.investors[1];
    rival.account.cash = 20000;
    run.player.hand[0] = config.cards.find(card => card.id === 'credit')!;
    for (const kind of Object.values(config.nodes.kinds)) kind.effectIds = ['margin_buy'];
    expect(run.confirm({ lane: run.reachable(player)[0].lane, card: 0 }, first)).toBe(true);
    expect(rival.account.marginDebt).toBe(0);
    expect(run.reports[0].outcomes.find(item => item.investor === rival)?.incomingCards).toEqual(['信用管制']);
  });
});


describe('新增卡片的財務邊界', () => {
  it.each([
    ['tailwind', 0.2, 2350],
    ['escape', -0.5, -1500],
    ['short_chief', -0.5, 500]
  ] as const)('%s 只放大或保護自有股票', (id, change, expected) => {
    const config = removeVolatility(readFinancialConfig());
    config.gameplay.eventEvery = 1;
    config.effects.none = { type: 'price', floor: change, ceiling: change };
    const run = start(config);
    Object.assign(run.player.account, { cash: 0, investmentValue: 10000, marginDebt: 3000 });
    run.player.hand[0] = config.cards.find(card => card.id === id)!;
    const [node] = run.reachable(run.player);
    config.nodes.kinds[node.kind].tags = ['speculative'];
    expect(run.confirm({ lane: node.lane, card: 0 }, first)).toBe(true);
    expect(run.reports[0].outcomes[0].marketPnl).toBe(expected);
  });

  it.each([
    ['airbag', 10000, 3000, -1300],
    ['all_in', 3000, 0, -900]
  ] as const)('%s 的路線效果不放大借款部位', (id, stocks, debt, expected) => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    Object.assign(run.player.account, { cash: 0, investmentValue: stocks, marginDebt: debt });
    const [node] = run.reachable(run.player);
    config.effects.drop = { type: 'price', floor: -0.2, ceiling: -0.2 };
    config.nodes.kinds[node.kind].effectIds = ['drop'];
    run.player.hand[0] = config.cards.find(card => card.id === id)!;
    expect(run.confirm({ lane: node.lane, card: 0 }, first)).toBe(true);
    expect(run.reports[0].outcomes[0].ledger.investmentPnl).toBe(expected);
  });

  it.each(['snipe','higher_interest'] as const)('%s 只在領先目標的帳本生效', id => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const rival = run.investors[1];
    Object.assign(rival.account, { cash: 10000, investmentValue: 5000, marginDebt: 1000 });
    run.player.hand[0] = config.cards.find(card => card.id === id)!;
    expect(run.confirm({ lane: run.reachable(run.player)[0].lane, card: 0 }, first)).toBe(true);
    expect(rival.account.investmentValue).toBe(id === 'snipe' ? 4750 : 5000);
    expect(rival.account.stats.fees).toBe(id === 'higher_interest' ? 22 : 11);
    expect(run.player.account.stats.fees).toBe(0);
  });

  it('長期持有在後續日入帳，東山再起仍為每局一次', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const player = run.player;
    Object.assign(player.account, { investmentValue: 10000, marginDebt: 3000, bankruptcyCount: 1 });
    player.hand[0] = config.cards.find(card => card.id === 'hold')!;
    const [node] = run.reachable(player);
    config.nodes.kinds[node.kind].tags = ['speculative'];
    expect(run.confirm({ lane: node.lane, card: 0 }, first)).toBe(true);
    expect(player.openingStockIncome).toBe(105);
    declineOffers(run);
    const comeback = config.cards.find(card => card.id === 'comeback')!;
    player.hand[0] = comeback;
    expect(run.confirm({ lane: run.reachable(player)[0].lane, card: 0 }, first)).toBe(true);
    declineOffers(run);
    player.hand[0] = comeback;
    expect(run.preview(run.reachable(player)[0].lane, 0)?.cardBlock).toBe('already_used');
  });

  it('情報交易只額外抽一張，並沿用開盤的手牌規則', () => {
    const config = removeVolatility(readFinancialConfig());
    const run = start(config);
    const [node] = run.reachable(run.player);
    delete config.nodes.kinds[node.kind].draft;
    run.player.hand[0] = config.cards.find(card => card.id === 'intel_trade')!;
    expect(run.confirm({ lane: node.lane, card: 0 }, first)).toBe(true);
    expect(run.player.hand).toHaveLength(4);
    expect(run.player.used).toBe(1);
    expect(run.intelligenceFor(run.player)).toHaveLength(1);
  });
});
