import { describe, expect, it } from 'vitest';
import { inputConfig, readConfig, validateMap, type Config, type GameMap } from '../src/config/settings';
import { generateMap } from '../src/core/map-generator';
import { Race } from '../src/core/race';

const config = readConfig(inputConfig);
const template = config.maps.mountain;
const frame = 1000 / 60;
const halfWidth = config.physics.hitbox.width / 2;
const jumpHeight = config.physics.jumpVelocity ** 2 / (2 * config.physics.gravity);

function quietConfig(): Config {
  const settings = readConfig(inputConfig);
  settings.gameplay.eventIntervalMs = 600_000;
  settings.cards = settings.cards.filter(card => card.id === 'hedge');
  return settings;
}

/** Generated map without recovery boxes, so displacement cards cannot move racers during movement checks. */
function quietMap(settings: Config, seed: number) {
  const map = generateMap(template, settings, seed);
  return { ...map, cardSpawns: map.cardSpawns.filter(spawn => spawn.kind === 'public') };
}

function surfaces(map: GameMap) {
  return new Map([
    ...map.platforms.map(item => [item.id, { x: item.x, width: item.width }] as const),
    ...map.ledges.map(item => [item.id, { x: item.x, width: item.width }] as const)
  ]);
}

describe('受限隨機主賽道', () => {
  it('同一種子產生相同地圖，不同種子產生不同配置，練習場與範本維持不變', () => {
    expect(generateMap(template, config, 3708)).toEqual(generateMap(template, config, 3708));
    const layouts = new Set([1, 2, 3, 4, 5].map(seed => JSON.stringify(generateMap(template, config, seed).ladders)));
    expect(layouts.size).toBe(5);
    expect(config.maps.mountain).toEqual(readConfig(inputConfig).maps.mountain);
  });

  it('300 個種子都通過啟動驗證，且梯子、巡邏、卡箱與鈔票符合放置限制', () => {
    const terrain = config.terrain;
    const retail = config.obstacles.retail;
    let fallbacks = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const map = generateMap(template, config, seed);
      expect(() => validateMap(map, config)).not.toThrow();
      if (JSON.stringify(map.ladders) === JSON.stringify(template.ladders)) fallbacks++;
      expect(map.platforms.map(item => item.y)).toEqual(template.platforms.map(item => item.y));
      expect(map.zones).toEqual(template.zones);

      const thirds = new Set(map.ladders.map(ladder => Math.floor(ladder.x / (map.width / 3))));
      expect(thirds.size).toBe(3);
      for (const platform of map.platforms.slice(0, -1)) {
        expect(map.ladders.filter(ladder => ladder.from === platform.id)).toHaveLength(1);
      }
      for (const platform of map.platforms.slice(1, -1)) {
        const incoming = map.ladders.find(ladder => ladder.to === platform.id)!;
        const outgoing = map.ladders.find(ladder => ladder.from === platform.id)!;
        expect(Math.abs(incoming.x - outgoing.x)).toBeGreaterThanOrEqual(terrain.ladderSpacing);
      }

      for (const patrol of map.obstacles) {
        const platform = map.platforms.find(item => item.id === patrol.platformId)!;
        const incoming = map.ladders.find(ladder => ladder.to === patrol.platformId)!;
        const outgoing = map.ladders.find(ladder => ladder.from === patrol.platformId)!;
        const clearance = terrain.patrolClearance + retail.width / 2 + halfWidth;
        expect(patrol.fromX).toBeGreaterThanOrEqual(Math.min(incoming.x, outgoing.x) + clearance);
        expect(patrol.toX).toBeLessThanOrEqual(Math.max(incoming.x, outgoing.x) - clearance);
        for (const jump of platform.edges.filter(edge => edge.type === 'jump')) {
          expect(jump.x < patrol.fromX - halfWidth || jump.x > patrol.toX + halfWidth).toBe(true);
        }
        expect(platform.safeLanding.x < patrol.fromX - halfWidth || platform.safeLanding.x > patrol.toX + halfWidth).toBe(true);
      }

      for (const ledge of map.ledges) {
        const from = map.platforms.find(item => item.id === ledge.from)!;
        const ladder = map.ladders.find(item => item.from === ledge.from)!;
        expect(ledge.rise).toBeLessThan(jumpHeight);
        expect(from.y - ledge.rise - map.platforms[from.layer + 1].y).toBeLessThan(jumpHeight);
        expect(ladder.x < ledge.x - terrain.ledgeLadderGap || ladder.x > ledge.x + ledge.width + terrain.ledgeLadderGap).toBe(true);
      }

      const surface = surfaces(map);
      const items = [...map.cardSpawns, ...map.cash.bundles];
      for (const item of items) {
        const where = surface.get(item.platformId)!;
        expect(item.x).toBeGreaterThanOrEqual(where.x + halfWidth);
        expect(item.x).toBeLessThanOrEqual(where.x + where.width - halfWidth);
        if (!map.platforms.some(platform => platform.id === item.platformId)) continue;
        for (const ladder of map.ladders.filter(entry => entry.from === item.platformId || entry.to === item.platformId)) {
          expect(Math.abs(ladder.x - item.x)).toBeGreaterThan(terrain.itemSpacing);
        }
        for (const other of items) {
          if (other !== item && other.platformId === item.platformId) {
            expect(Math.abs(other.x - item.x)).toBeGreaterThan(terrain.itemSpacing);
          }
        }
        for (const patrol of map.obstacles.filter(entry => entry.platformId === item.platformId)) {
          expect(item.x < patrol.fromX || item.x > patrol.toX).toBe(true);
        }
      }
      expect(map.cardSpawns.filter(spawn => spawn.kind === 'public').length).toBeGreaterThanOrEqual(10);
      expect(map.cardSpawns.some(spawn => spawn.kind === 'recovery')).toBe(true);
      expect(map.cash.bundles.length).toBeGreaterThanOrEqual(12);
    }
    expect(fallbacks).toBe(0);
  });

  it('三位 NPC 在不同隨機賽道都能以正常移動登頂，不會卡住或瞬移', () => {
    const settings = quietConfig();
    settings.gameplay.summitCloseMs = settings.gameplay.durationMs;
    for (const seed of [11, 202, 3708, 40404, 77777, 123456, 987654, 2024, 31337, 8]) {
      const race = new Race(settings, { playerId: 'pan', difficulty: 'normal', seed, map: quietMap(settings, seed) });
      const rivals = race.racers.filter(racer => !racer.isPlayer);
      const summited = new Set<string>();
      for (let i = 0; i < settings.gameplay.durationMs / frame && !race.result && summited.size < rivals.length; i++) {
        const before = rivals.map(racer => ({ ...racer.body }));
        race.step(frame);
        rivals.forEach((racer, index) => {
          expect(Math.abs(racer.body.y - before[index].y)).toBeLessThan(13);
          expect(Math.abs(racer.body.x - before[index].x)).toBeLessThanOrEqual(config.physics.ladderGrab);
          if (racer.body.platformId === race.track.finish.id) summited.add(racer.character.id);
        });
      }
      expect([seed, summited.size]).toEqual([seed, rivals.length]);
    }
  });

  it('NPC 依難度機率起跳越過巡邏散戶，願意閃避時撞擊次數明顯較少', () => {
    const hits = (chance: number) => {
      const settings = quietConfig();
      settings.npc.patrolJumpChance = { easy: chance, normal: chance, hard: chance };
      settings.npc.jumpChance = { easy: 0, normal: 0, hard: 0 };
      let count = 0;
      for (const seed of [5, 66, 777, 8888]) {
        const race = new Race(settings, { playerId: 'pan', difficulty: 'hard', seed, map: quietMap(settings, seed) });
        let latest = race.log[0];
        for (let i = 0; i < 60 * 120 && !race.result; i++) {
          race.step(frame);
          if (race.log[0] !== latest) {
            latest = race.log[0];
            if (latest.title.includes(config.obstacles.retail.name) && !latest.title.startsWith(race.player.character.name)) count++;
          }
        }
      }
      return count;
    };
    const careless = hits(0);
    const careful = hits(1);
    expect(careless).toBeGreaterThan(10);
    expect(careful).toBeLessThan(careless / 3);
  });
});
