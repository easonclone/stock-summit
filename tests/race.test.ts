import { describe, expect, it } from 'vitest';
import { inputConfig, readConfig, type Config } from '../src/config/settings';
import { applyEffects } from '../src/core/effects';
import { idle } from '../src/core/movement';
import { Race } from '../src/core/race';
import { seededRandom } from '../src/core/random';
import { marketTargets } from '../src/core/targets';

const config = readConfig(inputConfig);
const frame = 1000 / 60;
const start = (settings = config, map: 'training' | 'mountain' = 'training', playerId = 'pan') =>
  new Race(settings, { playerId, difficulty: 'normal', seed: 3708, map: settings.maps[map] });

function tick(race: Race, count: number, input = idle) {
  for (let i = 0; i < count; i++) race.step(frame, input);
}

function unplayedConfig(): Config {
  const settings = readConfig(inputConfig);
  settings.gameplay.eventIntervalMs = 600_000;
  settings.cards = settings.cards.filter(card => card.id === 'hedge');
  for (const map of Object.values(settings.maps)) map.cardSpawns = map.cardSpawns.filter(spawn => spawn.kind === 'public');
  return settings;
}

describe('啟動驗證', () => {
  it('清楚回報無效的跨檔引用、危險落點與無法抵達的終點', () => {
    const broken = structuredClone(inputConfig);
    broken.events[0].effectIds = ['missing'];
    expect(() => readConfig(broken)).toThrow(/ceo.*missing/);
    const unsafe = structuredClone(inputConfig);
    unsafe.maps.training.platforms[1].safeLanding.x = 9999;
    expect(() => readConfig(unsafe)).toThrow(/p1.*落點/);
    const disconnected = structuredClone(inputConfig);
    disconnected.maps.training.platforms[0].edges = [];
    expect(() => readConfig(disconnected)).toThrow(/p0.*上行路徑/);
  });
});

describe('移動、排名與結算', () => {
  it('兩張賽道的梯子分布在左、中、右側，巡邏散戶位在上下梯之間', () => {
    for (const map of Object.values(config.maps)) {
      const thirds = new Set(map.ladders.map(ladder => Math.floor(ladder.x / (map.width / 3))));
      expect([...thirds].sort()).toEqual([0, 1, 2]);
      expect(new Set(map.platforms.map(platform => platform.width)).size).toBeGreaterThan(5);
      for (const patrol of map.obstacles) {
        const incoming = map.ladders.find(ladder => ladder.to === patrol.platformId)!;
        const outgoing = map.ladders.find(ladder => ladder.from === patrol.platformId)!;
        expect(patrol.fromX).toBeGreaterThan(Math.min(incoming.x, outgoing.x));
        expect(patrol.toX).toBeLessThan(Math.max(incoming.x, outgoing.x));
      }
    }
  });

  it('四種選角都套用相同物理，並可爬梯、穿過單向平台再降落', () => {
    for (const { id } of config.characters) {
      const race = start(unplayedConfig(), 'training', id);
      tick(race, 180);
      tick(race, 29, { ...idle, horizontal: 1 });
      tick(race, 99, { ...idle, vertical: -1 });
      expect(race.player.character.id).toBe(id);
      expect(race.player.body.platformId).toBe('p1');
      tick(race, 86, { ...idle, horizontal: 1 });
      race.step(frame, { ...idle, jump: true });
      const startY = race.player.body.y;
      tick(race, 20);
      expect(race.player.body.y).toBeLessThan(startY - 75);
      tick(race, 50);
      expect(race.player.body.platformId).toBe('p2');
    }
  });

  it('跳出平台邊緣後會落在下層，且走不到地圖邊界之外', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    race.track.displace(race.player.body, 1);
    tick(race, 300, { ...idle, horizontal: 1 });
    expect(race.player.body.platformId).toBe('p0');
    expect(race.player.body.x).toBe(race.options.map.width - config.physics.hitbox.width / 2);
  });

  it('NPC 靠普通移動抵達第 40 層，每一步都在物理移動範圍內', () => {
    const race = start(unplayedConfig(), 'mountain');
    for (let i = 0; i < 60 * 350 && !race.result; i++) {
      const before = race.racers.map(racer => ({ ...racer.body }));
      race.step(frame);
      race.racers.forEach((racer, index) => {
        expect(Math.abs(racer.body.y - before[index].y)).toBeLessThan(13);
        expect(Math.abs(racer.body.x - before[index].x)).toBeLessThanOrEqual(config.physics.ladderGrab);
      });
    }
    expect(race.result).toBe('summit');
    expect(race.winner?.isPlayer).toBe(false);
    expect(race.firstToSummit?.body.platformId).toBe('p40');
    expect(race.time).toBeLessThan(360_000);
  });

  it('以進度結算逾時，重玩會重設全部賽事狀態', () => {
    const settings = unplayedConfig();
    settings.gameplay.durationMs = 500;
    const race = start(settings);
    tick(race, 220);
    expect(race.result).toBe('timeout');
    expect(race.time).toBe(500);
    expect(race.winner).toBe(race.ranking()[0]);
    const replay = start(settings);
    expect(replay.result).toBeNull();
    expect(replay.log).toEqual([]);
    expect(replay.time).toBe(0);
  });
});

describe('事件與卡片', () => {
  it('支援全體、隨機一人與兩人、首名和末名的目標快照', () => {
    const random = seededRandom(3708);
    expect(marketTargets('all', [1, 2, 3, 4], random)).toEqual([1, 2, 3, 4]);
    expect(marketTargets('first_place', [1, 2, 3, 4], random)).toEqual([1]);
    expect(marketTargets('last_place', [1, 2, 3, 4], random)).toEqual([4]);
    expect(marketTargets('random_one', [1, 2, 3, 4], random)).toHaveLength(1);
    expect(new Set(marketTargets('random_two', [1, 2, 3, 4], random)).size).toBe(2);
  });

  it('護盾僅消耗一層並遮擋同場負面效果，停損限制下一次下滑', () => {
    const race = start();
    const player = race.player;
    race.track.displace(player.body, 6);
    applyEffects(player, [config.effects.shield], race.track, 0, 'card');
    const effects = [config.effects.down_3, config.effects.freeze, config.effects.down_2];
    expect(applyEffects(player, effects, race.track, 0, 'market').shielded).toBe(true);
    expect(player.body.platformId).toBe('p6');
    expect(player.status.shield).toBe(0);
    expect(player.status.freezeUntil).toBe(0);
    applyEffects(player, [config.effects.limit, config.effects.down_4], race.track, 0, 'card');
    expect(player.body.platformId).toBe('p5');
    expect(player.status.lossLimit).toBeNull();
    applyEffects(player, [config.effects.down_4, config.effects.down_4], race.track, 0, 'card');
    expect(player.body.platformId).toBe('p0');
  });

  it('同類速度刷新期限，凍結優先，暫停保留效果期限與事件倒數', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    const player = race.player;
    applyEffects(player, [config.effects.boost, config.effects.freeze], race.track, 0, 'card');
    const before = player.body.x;
    tick(race, 60, { ...idle, horizontal: 1 });
    expect(player.body.x).toBe(before);
    applyEffects(player, [config.effects.boost], race.track, race.time, 'card');
    expect(player.status.speed).toBe(1.2);
    expect(player.status.boostUntil).toBeCloseTo(9000);
    race.togglePause();
    tick(race, 500, { ...idle, horizontal: 1 });
    expect(race.time).toBeCloseTo(1000);
    expect(race.nextEventAt).toBe(600_000);
    race.togglePause();
    tick(race, 130, { ...idle, horizontal: 1 });
    expect(player.body.x).toBeGreaterThan(before);
  });

  it('同一種子重現事件，市場情報預告本次抽取結果', () => {
    const a = start();
    const b = start();
    for (const race of [a, b]) {
      tick(race, 180);
      applyEffects(race.player, [config.effects.reveal], race.track, 0, 'card');
    }
    const forecast = a.forecast?.title;
    tick(a, 1000);
    tick(b, 1000);
    expect(a.marketCount).toBe(1);
    expect(a.news).toEqual(b.news);
    expect(a.news?.title).toBe(forecast);
    expect(a.forecast).toBeNull();
  });

  it('可以拾卡、依槽位使用；沒有前方對手時保留卡片', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    tick(race, 35, { ...idle, horizontal: 1 });
    expect(race.player.picked).toBe(1);
    expect(race.player.inventory[0]?.id).toBe('hedge');
    race.usePlayerCard(0);
    expect(race.player.status.shield).toBe(1);
    expect(race.player.inventory[0]).toBeNull();
    race.player.inventory[1] = config.cards.find(card => card.id === 'short')!;
    race.usePlayerCard(1);
    expect(race.player.inventory[1]?.id).toBe('short');
  });
});

describe('卡箱與登頂邊界', () => {
  it('滿背包時仍會觸發即時陷阱，其他選手無法同時拾取，冷卻後重生', () => {
    const settings = unplayedConfig();
    settings.gameplay.cardRespawnMs = 333;
    settings.cards = config.cards.filter(card => card.trigger === 'on_pickup');
    const race = start(settings);
    tick(race, 180);
    const box = race.pickups.find(item => item.platformId === 'p1')!;
    const player = race.player;
    for (const racer of race.racers.slice(0, 2)) {
      race.track.displace(racer.body, 1);
      racer.body.x = box.x;
    }
    player.inventory.fill(config.cards[0]);
    race.racers[1].body.x += 5;
    tick(race, 1);
    expect(player.body.platformId).toBe('p0');
    expect(player.picked).toBe(1);
    expect(race.racers[1].picked).toBe(0);
    expect(player.inventory.map(card => card?.id)).toEqual(['hedge', 'hedge', 'hedge']);
    tick(race, 21);
    expect(race.racers[1].picked).toBe(1);
  });

  it('必須實際站上終點才會開始收盤倒數', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    const rival = race.racers[1];
    race.track.displace(race.player.body, race.track.finish.layer);
    rival.body.y = race.track.finish.y - 15;
    rival.body.platformId = null;
    tick(race, 1);
    expect(race.firstToSummit).toBe(race.player);
    expect(race.closesAt! - race.time).toBe(10000);
    expect(race.result).toBeNull();
  });
});

describe('盤勢、地面障礙與逆轉機制', () => {
  it('進入空頭會降低移速，巡邏速度提高且暫停時位置凍結', () => {
    const bull = start(config, 'mountain');
    const bear = start(config, 'mountain');
    bull.tone = 'positive';
    bear.tone = 'negative';
    const x = bull.player.body.x;
    for (const race of [bull, bear]) {
      tick(race, 180);
      tick(race, 4, { ...idle, horizontal: 1 });
    }
    expect(bull.player.body.x - x).toBeCloseTo(4 * frame / 1000 * config.physics.moveSpeed * 1.12);
    expect(bear.player.body.x - x).toBeCloseTo(4 * frame / 1000 * config.physics.moveSpeed * .92);
    expect(bull.terrain.patrols[0].distance).not.toBeCloseTo(bear.terrain.patrols[0].distance);
    const stopped = bear.terrain.patrols[0].x;
    bear.togglePause();
    tick(bear, 30);
    expect(bear.terrain.patrols[0].x).toBe(stopped);
  });

  it('地面巡邏散戶可跳過，碰到時凍結 1 秒且連續接觸只觸發一次', () => {
    const race = start(unplayedConfig());
    const patrol = race.terrain.patrols[0];
    const player = race.player;
    const layer = race.track.platforms.get(patrol.platformId)!.layer;
    expect(race.track.map.ladders.some(ladder => ladder.from === patrol.platformId)).toBe(true);
    tick(race, 180);
    race.track.displace(player.body, layer);
    player.body.x = patrol.x;
    tick(race, 1);
    expect(player.status.freezeUntil - race.time).toBe(1000);
    expect(race.notice?.description).toContain('暫停移動 1 秒');
    expect(race.impacts.get(player)?.obstacle).toBe(true);
    const freezeUntil = player.status.freezeUntil;
    const x = player.body.x;
    tick(race, 40, { ...idle, horizontal: 1 });
    expect(player.status.freezeUntil).toBe(freezeUntil);
    expect(player.body.x).toBe(x);

    const jumper = start(unplayedConfig());
    tick(jumper, 180);
    jumper.track.displace(jumper.player.body, layer);
    jumper.player.body.x = jumper.terrain.patrols[0].x;
    jumper.player.body.y -= patrol.typeData.height + 2;
    jumper.player.body.platformId = null;
    jumper.player.body.velocityY = -config.physics.jumpVelocity;
    tick(jumper, 10, { ...idle, horizontal: -1 });
    expect(jumper.player.status.freezeUntil).toBe(0);
  });

  it('補給箱僅允許達到落後門檻的選手取得', () => {
    const settings = readConfig(inputConfig);
    settings.cards = settings.cards.filter(card => card.id === 'rebound' || card.id === 'hedge');
    const race = start(settings, 'mountain');
    const recovery = race.pickups.find(item => item.kind === 'recovery')!;
    const layer = race.track.platforms.get(recovery.platformId)!.layer;
    const player = race.player;
    const [leader, second] = race.racers.filter(racer => !racer.isPlayer);
    tick(race, 180);
    race.track.displace(player.body, layer);
    player.body.x = recovery.x;
    tick(race, 1);
    expect(recovery.respawnAt).toBeNull();
    race.track.displace(leader.body, layer + 3);
    race.track.displace(second.body, layer + 2);
    tick(race, 1);
    expect(player.inventory[0]?.id).toBe('rebound');
    race.usePlayerCard(0);
    expect(race.notice?.description).toContain('上升 1 層');
    expect(race.impacts.get(player)?.layers).toBe(1);
  });

  it('邊界內實際下滑量優先於卡片標示，未下滑時不顯示受擊文案', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    const target = race.racers[1];
    target.body.y -= 12;
    race.player.inventory[0] = config.cards.find(card => card.id === 'short')!;
    race.usePlayerCard(0);
    expect(race.notice?.description).toContain('原地持平');
    expect(race.notice?.description).not.toContain('慘遭主力狙擊');
    race.track.displace(target.body, 1);
    race.player.inventory[0] = config.cards.find(card => card.id === 'short')!;
    race.usePlayerCard(0);
    expect(race.notice?.description).toContain('下滑 1 層 · 慘遭主力狙擊');
    expect(race.impacts.get(target)?.layers).toBe(-1);
  });
});

describe('鈔票與收盤', () => {
  function place(race: Race, racer: Race['player'], platformId: string, x: number) {
    const platform = race.track.platforms.get(platformId)!;
    Object.assign(racer.body, { x, y: platform.y, platformId, ladderId: null, velocityY: 0, motion: 'idle' });
  }

  it('同一疊鈔票每位選手可各拾取一次', () => {
    const race = start(unplayedConfig());
    const [player, rival] = race.racers;
    tick(race, 180);
    const first = race.cashPickups.bundles[0];
    for (const racer of [player, rival]) place(race, racer, first.platformId, first.x);
    tick(race, 5);
    expect(player.cash).toBe(25);
    expect(rival.cash).toBe(25);
  });

  it('收集的 200 元於收盤自動換算，能以 41.40 分反超率先登頂的 40.00 分', () => {
    const race = start(unplayedConfig(), 'mountain');
    const player = race.player;
    for (const rival of race.racers.slice(1)) rival.status.freezeUntil = 60_000;
    tick(race, 180);
    for (const cash of race.cashPickups.bundles.slice(0, 5)) {
      place(race, player, cash.platformId, cash.x);
      tick(race, 1);
    }
    expect(player.cash).toBe(200);

    const first = race.racers[1];
    place(race, player, 'p39', race.track.platforms.get('p39')!.safeLanding.x);
    place(race, first, 'p40', race.track.finish.safeLanding.x);
    tick(race, 1);
    expect(race.firstToSummit).toBe(first);
    const closesAt = race.closesAt!;
    race.togglePause();
    tick(race, 650);
    expect(race.result).toBeNull();
    expect(closesAt - race.time).toBeCloseTo(10_000);
    race.togglePause();
    tick(race, 599);
    expect(race.result).toBeNull();
    tick(race, 1);
    expect(race.time).toBeCloseTo(closesAt);
    expect(race.winner).toBe(player);
    expect(race.score(player)).toEqual({ layers: 39, bonus: 2.4, total: 41.4 });
    expect(race.score(first).total).toBe(40);
  });

  it('主賽道加成上限 3 層，同分時實際層數較高者優先', () => {
    const race = start(unplayedConfig(), 'mountain');
    tick(race, 180);
    for (const rival of race.racers) rival.status.freezeUntil = 60_000;
    race.player.cash = 1000;
    place(race, race.player, 'p37', race.track.platforms.get('p37')!.safeLanding.x);
    const leader = race.racers[1];
    place(race, leader, 'p40', race.track.finish.safeLanding.x);
    tick(race, 601);
    expect(race.score(race.player)).toEqual({ layers: 37, bonus: 3, total: 40 });
    expect(race.winner).toBe(leader);
  });
});

describe('懸空平台與卡片碰撞', () => {
  it('可透過同一個跳躍判定登上方塊，再跳至上一層', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    const ledge = race.track.ledges[0];
    const x = ledge.safeLanding.x;
    race.track.displace(race.player.body, ledge.layer);
    race.player.body.x = x;
    tick(race, 1, { ...idle, jump: true });
    tick(race, 61);
    expect(race.player.body.platformId).toBe(ledge.id);
    tick(race, 1, { ...idle, jump: true });
    tick(race, 61);
    expect(race.player.body.platformId).toBe(ledge.edges[0].to);
  });

  it('尚未落地時也能撞到懸空卡箱並拾卡', () => {
    const race = start(unplayedConfig());
    tick(race, 180);
    const ledge = race.track.ledges[0];
    const card = race.pickups.find(item => item.platformId === ledge.id)!;
    const player = race.player;
    Object.assign(player.body, { x: card.x, y: card.y - 12, platformId: null, velocityY: 0 });
    tick(race, 4);
    expect(player.body.platformId).toBeNull();
    expect(player.inventory[0]?.id).toBe('hedge');
  });
});

describe('卡片欄容量', () => {
  it('三個新卡箱能連續填滿卡欄，用掉一張便能拾取第四箱', () => {
    const race = start(unplayedConfig());
    const player = race.player;
    const [first, second, third, fourth] = race.pickups;
    tick(race, 180);

    const touch = (box: typeof first) => {
      Object.assign(player.body, { x: box.x, y: box.y, platformId: box.platformId, ladderId: null });
      tick(race, 1);
    };

    touch(first);
    touch(first);
    expect(player.inventory.filter(Boolean)).toHaveLength(1);
    touch(second);
    expect(player.inventory.filter(Boolean)).toHaveLength(2);
    touch(third);
    expect(player.inventory.map(card => card?.id)).toEqual(['hedge', 'hedge', 'hedge']);
    touch(fourth);
    expect(race.pickupHint).toBe('卡槽已滿');
    expect(fourth.respawnAt).toBeNull();

    race.usePlayerCard(1);
    touch(fourth);
    expect(player.inventory.map(card => card?.id)).toEqual(['hedge', 'hedge', 'hedge']);
    expect(race.time).toBeLessThan(200);
  });
});

describe('流動性危機與墜落交易員', () => {
  it('流動性危機依鈔票分流，剛好 100 元會扣款，避險抵銷整次事件', () => {
    const settings = unplayedConfig();
    settings.events = settings.events.filter(event => event.id === 'liquidity');
    settings.gameplay.eventIntervalMs = 100;
    const race = start(settings);
    const [poor, exact, rich, hedged] = race.racers;
    poor.cash = 99;
    exact.cash = 100;
    rich.cash = 175;
    hedged.cash = 200;
    hedged.status.shield = 1;
    tick(race, 186);
    expect(poor.cash).toBe(99);
    expect(poor.status.freezeUntil - race.time).toBe(2000);
    expect(exact.cash).toBe(0);
    expect(exact.status.freezeUntil).toBe(0);
    expect(rich.cash).toBe(75);
    expect(race.score(rich).bonus).toBe(.9);
    expect(hedged.cash).toBe(200);
    expect(hedged.status.shield).toBe(0);
    expect(race.news?.description).toContain('扣除 100 元');
    expect(race.news?.description).toContain('暫停移動 2 秒');
  });

  it('墜落預警使用賽局時間，同種子相同落點，命中只停頓一次且可離開落點閃避', () => {
    const settings = unplayedConfig();
    Object.assign(settings.fallingTraders, { intervalMs: [100, 100], spread: 0, doubleChance: 0 });
    const setup = () => {
      const race = start(settings);
      tick(race, 186);
      const warning = race.fallingTraders.active[0]!;
      expect(warning.startsAt).toBeGreaterThan(race.time);
      return race;
    };

    const hit = setup();
    const evade = setup();
    const target = hit.fallingTraders.active[0]!;
    expect(evade.fallingTraders.active[0]?.x).toBe(target.x);
    expect(evade.fallingTraders.active[0]?.startsAt).toBe(target.startsAt);

    for (const race of [hit, evade]) {
      for (const racer of race.racers.slice(1)) racer.status.freezeUntil = 60_000;
    }
    hit.player.body.x = target.x;
    hit.player.body.y = target.ground;
    hit.player.body.ladderId = null;
    evade.player.body.x = target.x + 70;
    evade.player.body.y = target.ground;
    evade.player.body.ladderId = null;

    hit.togglePause();
    tick(hit, 120);
    expect(target.y).toBe(target.top);
    expect(hit.fallingHitAt).toBeNull();
    hit.togglePause();

    while (hit.time < target.endsAt && hit.fallingHitAt === null) tick(hit, 1);
    expect(hit.fallingHitAt).not.toBeNull();
    expect(hit.player.status.freezeUntil - hit.time).toBe(1000);
    expect(hit.impacts.get(hit.player)?.obstacle).toBe(true);
    expect(hit.notice?.title).toContain('墜落交易員');
    const deadline = hit.player.status.freezeUntil;
    tick(hit, 10);
    expect(hit.player.status.freezeUntil).toBe(deadline);

    while (evade.time < target.endsAt) tick(evade, 1);
    expect(evade.fallingHitAt).toBeNull();
    expect(evade.player.status.freezeUntil).toBe(0);
  });

  it('雙人波次同時預警，兩個碰撞範圍之間可以閃避', () => {
    const settings = unplayedConfig();
    Object.assign(settings.fallingTraders, { intervalMs: [100, 100], doubleChance: 1, spread: 0 });
    const race = start(settings);
    tick(race, 186);
    const [first, second] = race.fallingTraders.active;
    expect(second.startsAt).toBe(first.startsAt);
    expect(Math.abs(first.x - second.x)).toBe(settings.fallingTraders.laneSpacing);
    const [player, rival, center] = race.racers;
    Object.assign(player.body, { x: first.x, y: first.ground });
    Object.assign(rival.body, { x: second.x, y: second.ground });
    Object.assign(center.body, { x: (first.x + second.x) / 2, y: first.ground });

    // 使用賽局內實際碰撞資料驗證兩個落點及中間空隙。
    const hits = race.fallingTraders.step(first.endsAt, [player.body, rival.body, center.body]);
    expect(hits).toEqual([player.body, rival.body]);
    expect(race.fallingTraders.step(first.endsAt + 10, [player.body, rival.body, center.body])).toEqual([]);
  });

});
