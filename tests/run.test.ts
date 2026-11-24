import { describe, expect, it } from 'vitest';
import { inputConfig, readConfig, type Config } from '../src/config/settings';
import { applyEffects } from '../src/core/effects';
import { generateNodeMap, nodeMapProblems } from '../src/core/node-map';
import { seededRandom } from '../src/core/random';
import { Run } from '../src/core/run';
import { marketTargets } from '../src/core/targets';

const config = readConfig(inputConfig);

/** A fresh config; `events` narrows the market deck, `quiet` disables market events entirely. */
function setup({ events, cards, quiet = false }: { events?: string[]; cards?: string[]; quiet?: boolean } = {}): Config {
  const settings = readConfig(inputConfig);
  if (events) settings.events = settings.events.filter(event => events.includes(event.id));
  if (cards) settings.cards = settings.cards.filter(card => cards.includes(card.id));
  if (quiet) settings.gameplay.eventEvery = 1000;
  return settings;
}

const start = (settings = config, seed = 3708, difficulty: 'easy' | 'normal' | 'hard' = 'normal') =>
  new Run(settings, { playerId: 'pan', seed, difficulty });

/** Makes every node in `row` the given kind so the outcome no longer depends on the lane picked. */
function force(run: Run, row: number, kind: string) {
  for (const node of run.map.rows[row]) node.kind = kind;
}

/** Picks the first reachable lane and resolves one turn. */
function step(run: Run) {
  expect(run.select(run.reachable(run.player)[0])).toBe(true);
  expect(run.resolve()).toBe(true);
}

describe('啟動驗證', () => {
  it('清楚回報事件、卡片與節點引用不存在的效果', () => {
    const event = structuredClone(inputConfig);
    event.events[0].effectIds = ['missing'];
    expect(() => readConfig(event)).toThrow(/ceo.*missing/);
    const node = structuredClone(inputConfig);
    node.nodes.kinds.steady.effectIds = ['ghost'];
    expect(() => readConfig(node)).toThrow(/節點 steady.*ghost/);
  });

  it('第一回合沒有可用節點類型時拒絕啟動', () => {
    const late = structuredClone(inputConfig);
    for (const kind of Object.values(late.nodes.kinds)) kind.fromRow = 2;
    expect(() => readConfig(late)).toThrow(/第一回合/);
  });
});

describe('路線圖', () => {
  it('多個種子都符合回合數、相鄰連線、不交叉、無死路與節點出現回合', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = generateNodeMap(config, seed);
      expect(nodeMapProblems(map, config)).toEqual([]);
      expect(map.rows).toHaveLength(config.gameplay.turns);
      for (const row of map.rows) {
        for (const node of row) expect(config.nodes.kinds[node.kind].fromRow).toBeLessThanOrEqual(node.row);
      }
    }
  });

  it('同一種子重現相同路線，不同種子產生不同路線', () => {
    expect(generateNodeMap(config, 42)).toEqual(generateNodeMap(config, 42));
    expect(generateNodeMap(config, 42)).not.toEqual(generateNodeMap(config, 43));
  });

  it('檢查器能指出死路、跳路與交叉', () => {
    const map = structuredClone(generateNodeMap(config, 9));
    map.rows[0][0].next = [];
    map.rows[1][0].next = [3];
    expect(nodeMapProblems(map, config).join()).toMatch(/死路.*不相鄰|不相鄰.*死路/);
    const crossed = structuredClone(generateNodeMap(config, 9));
    crossed.rows[2][1].next = [1, 2];
    crossed.rows[2][2].next = [1, 2];
    expect(nodeMapProblems(crossed, config).join()).toMatch(/交叉/);
  });
});

describe('回合結算', () => {
  it('只能選相連節點；未選擇時不結算', () => {
    const run = start();
    expect(run.resolve()).toBe(false);
    step(run);
    const blocked = [0, 1, 2, 3].find(lane => !run.reachable(run.player).includes(lane));
    if (blocked !== undefined) expect(run.select(blocked)).toBe(false);
    expect(run.turn).toBe(1);
  });

  it('穩健持有讓四人同時上升，獲利了結不爬升但入帳', () => {
    const run = start(setup({ quiet: true }));
    force(run, 0, 'steady');
    force(run, 1, 'cash');
    step(run);
    expect(run.racers.map(racer => run.layer(racer))).toEqual([2, 2, 2, 2]);
    step(run);
    expect(run.racers.map(racer => run.layer(racer))).toEqual([2, 2, 2, 2]);
    expect(run.player.cash).toBe(150);
    expect(run.score(run.player)).toEqual({ layers: 2, bonus: 1.8, total: 3.8 });
  });

  it('每 3 回合發生市場事件；槓桿讓下一次利空加倍並在之後重設', () => {
    const run = start(setup({ events: ['panic'] }));
    force(run, 0, 'steady');
    force(run, 1, 'steady');
    force(run, 2, 'leverage');
    step(run);
    step(run);
    expect(run.marketCount).toBe(0);
    step(run);
    expect(run.marketCount).toBe(1);
    expect(run.layer(run.player)).toBe(2 + 2 + 4 - 2);
    expect(run.player.status.exposure).toBe(1);
    expect(run.news?.title).toBe(config.events.find(event => event.id === 'panic')!.title);
  });

  it('避險抵銷市場利空，停損限制下滑層數', () => {
    const run = start(setup({ events: ['swan'] }));
    for (const row of [0, 1, 2]) force(run, row, 'steady');
    run.player.inventory[0] = config.cards.find(card => card.id === 'hedge')!;
    run.player.inventory[1] = config.cards.find(card => card.id === 'stop')!;
    expect(run.usePlayerCard(0)).toBe(true);
    step(run);
    step(run);
    step(run);
    expect(run.layer(run.player)).toBe(6);
    expect(run.player.status.shield).toBe(0);
    expect(run.player.shielded).toBe(1);
    for (const row of [3, 4, 5]) force(run, row, 'wait');
    expect(run.usePlayerCard(1)).toBe(true);
    step(run);
    step(run);
    step(run);
    expect(run.layer(run.player)).toBe(6 + 3 - 1);
    expect(run.player.status.lossLimit).toBeNull();
  });

  it('問號卡箱發卡、卡槽滿時不覆蓋；即時陷阱抽到就生效', () => {
    const run = start(setup({ quiet: true, cards: ['hedge', 'momentum', 'stop', 'cash', 'rebound'] }));
    force(run, 0, 'card');
    step(run);
    expect(run.player.inventory.filter(Boolean)).toHaveLength(1);
    const hedge = config.cards.find(card => card.id === 'hedge')!;
    run.player.inventory.fill(hedge);
    force(run, 1, 'card');
    step(run);
    expect(run.player.inventory.every(card => card === hedge)).toBe(true);
    expect(run.log.some(item => item.description.includes('卡槽已滿'))).toBe(true);

    const trapped = start(setup({ quiet: true, cards: ['trap', 'rebound'] }));
    force(trapped, 0, 'card');
    step(trapped);
    expect(trapped.layer(trapped.player)).toBe(1 - 1);
    expect(trapped.player.inventory.some(Boolean)).toBe(false);
  });

  it('研究報告取得下一次市場預告，事件發生後預告失效', () => {
    const run = start(setup({ events: ['rate'] }));
    force(run, 0, 'intel');
    expect(run.forecast).toBeNull();
    step(run);
    expect(run.forecast?.id).toBe('rate');
    step(run);
    step(run);
    expect(run.marketCount).toBe(1);
    expect(run.forecast).toBeNull();
  });

  it('抄底補給只發給落後達門檻的後段選手', () => {
    const run = start(setup({ quiet: true }));
    for (const racer of run.racers.slice(1)) run.track.displace(racer.body, 5);
    force(run, 0, 'aid');
    expect(run.canClaimRecovery(run.player)).toBe(true);
    step(run);
    const card = run.player.inventory.find(Boolean);
    expect(card && card.pool !== 'public').toBe(true);
    const leaders = run.racers.slice(1).filter(racer => run.ranking().indexOf(racer) < 2);
    for (const leader of leaders) expect(leader.inventory.some(Boolean)).toBe(false);
  });

  it('停牌期間進入的節點無效，解除後恢復', () => {
    const run = start(setup({ quiet: true }));
    force(run, 0, 'steady');
    force(run, 1, 'steady');
    run.player.status.freezeUntil = 1;
    expect(run.isFrozen(run.player)).toBe(true);
    step(run);
    expect(run.layer(run.player)).toBe(0);
    expect(run.layer(run.racers[1])).toBe(2);
    step(run);
    expect(run.layer(run.player)).toBe(2);
  });

  it('動能卡讓接下來 2 回合的爬升各多 1 層', () => {
    const run = start(setup({ quiet: true }));
    for (const row of [0, 1, 2]) force(run, row, 'steady');
    run.player.inventory[0] = config.cards.find(card => card.id === 'momentum')!;
    expect(run.usePlayerCard(0)).toBe(true);
    step(run);
    step(run);
    step(run);
    expect(run.player.closes.slice(0, 4)).toEqual([0, 3, 6, 8]);
  });

  it('前方沒有對手時保留狙擊卡，有對手時命中最近的前方選手', () => {
    const run = start(setup({ quiet: true }));
    const short = config.cards.find(card => card.id === 'short')!;
    run.player.inventory[0] = short;
    expect(run.usePlayerCard(0)).toBe(false);
    expect(run.player.inventory[0]).toBe(short);
    const [, near, far] = run.racers;
    run.track.displace(near.body, 2);
    run.track.displace(far.body, 5);
    expect(run.usePlayerCard(0)).toBe(true);
    expect(run.layer(near)).toBe(1);
    expect(run.layer(far)).toBe(5);
  });

  it('流動性危機有 100 元時扣款，不足時停牌', () => {
    const run = start();
    const crisis = config.effects.liquidity_crisis;
    run.player.cash = 100;
    applyEffects(run.player, [crisis], run.track, 0, 'market');
    expect(run.player.cash).toBe(0);
    expect(run.player.status.freezeUntil).toBe(0);
    applyEffects(run.player, [crisis], run.track, 0, 'market');
    expect(run.player.status.freezeUntil).toBe(1);
  });

  it('市場目標支援全體、隨機一人與兩人、首名和末名', () => {
    const random = seededRandom(7);
    expect(marketTargets('all', [1, 2, 3, 4], random)).toEqual([1, 2, 3, 4]);
    expect(marketTargets('first_place', [1, 2, 3, 4], random)).toEqual([1]);
    expect(marketTargets('last_place', [1, 2, 3, 4], random)).toEqual([4]);
    expect(marketTargets('random_one', [1, 2, 3, 4], random)).toHaveLength(1);
    expect(new Set(marketTargets('random_two', [1, 2, 3, 4], random)).size).toBe(2);
  });
});

describe('完整賽局與計分', () => {
  const play = (seed: number, pick: (run: Run) => number, difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
    const run = start(config, seed, difficulty);
    while (!run.result) {
      run.select(pick(run));
      run.resolve();
    }
    return run;
  };
  const first = (run: Run) => run.reachable(run.player)[0];
  const greedy = (run: Run) => {
    const row = run.map.rows[run.turn];
    const value = (lane: number) => run.nodeValue(run.player, row[lane]) + (run.turn + 1 < run.turns
      ? .5 * Math.max(...row[lane].next.map(next => run.nodeValue(run.player, run.map.rows[run.turn + 1][next]))) : 0);
    return [...run.reachable(run.player)].sort((a, b) => value(b) - value(a))[0];
  };

  it('15 回合後收盤，5 次市場事件，每人路線都沿著相連節點前進', () => {
    const run = play(11, first);
    expect(run.result).toBe('closed');
    expect(run.turn).toBe(config.gameplay.turns);
    expect(run.marketCount).toBe(config.gameplay.turns / config.gameplay.eventEvery);
    expect(run.winner).toBe(run.ranking()[0]);
    expect(run.select(0)).toBe(false);
    for (const racer of run.racers) {
      expect(racer.closes).toHaveLength(config.gameplay.turns + 1);
      expect(racer.path).toHaveLength(config.gameplay.turns);
      for (let index = 1; index < racer.path.length; index++) {
        expect(racer.path[index - 1].next).toContain(racer.path[index].lane);
      }
    }
  });

  it('同一種子與相同選擇完全重現結果', () => {
    const summary = (run: Run) => run.racers.map(racer => [racer.closes, racer.cash, racer.path.map(node => node.lane)]);
    expect(summary(play(77, first))).toEqual(summary(play(77, first)));
  });

  it('鈔票加成上限 3 層，總分同分時實際層數較高者優先', () => {
    const run = start(setup({ quiet: true }));
    run.player.cash = 1000;
    expect(run.score(run.player).bonus).toBe(config.cash.bonusCap);
    const [, rival] = run.racers;
    run.player.cash = 0;
    run.track.displace(run.player.body, 3);
    rival.cash = 250;
    expect(run.score(rival).total).toBe(3);
    expect(run.ranking().indexOf(run.player)).toBeLessThan(run.ranking().indexOf(rival));
  });

  it('選擇有意義：依價值規劃的平均分數明顯高於固定走最左路', () => {
    let planned = 0;
    let fixed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const smart = play(seed, greedy);
      const naive = play(seed, first);
      planned += smart.score(smart.player).total;
      fixed += naive.score(naive.player).total;
    }
    expect(planned / 60).toBeGreaterThan(fixed / 60 + 2);
  });

  it('困難電腦的平均分數高於簡單電腦', () => {
    const average = (difficulty: 'easy' | 'hard') => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const run = play(seed, first, difficulty);
        total += run.racers.slice(1).reduce((sum, racer) => sum + run.score(racer).total, 0) / 3;
      }
      return total / 60;
    };
    expect(average('hard')).toBeGreaterThan(average('easy'));
  });
});
