import { z } from 'zod';
import gameplayJson from './gameplay.json';
import cashJson from './cash.json';
import fallingTraderJson from './falling-traders.json';
import physicsJson from './physics.json';
import npcJson from './npc.json';
import themeJson from './ui-theme.json';
import charactersJson from '../data/characters.json';
import eventsJson from '../data/events.json';
import effectsJson from '../data/effects.json';
import cardsJson from '../data/cards.json';
import marketJson from '../data/market-states.json';
import obstaclesJson from '../data/obstacles.json';
import mountainJson from '../data/maps/mountain-01.json';
import trainingJson from '../data/maps/training.json';

const id = z.string().regex(/^[a-z][a-z\d_-]*$/);
const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const integer = z.number().int();
const positiveInt = integer.positive();
const color = z.string().regex(/^#[a-f\d]{6}$/i);
const label = z.string().min(1);
const point = z.object({ x: nonNegative, y: nonNegative });
const pixelIcon = z.enum(['shield', 'rocket', 'short', 'eye', 'bolt', 'trap', 'anchor', 'cash',
  'chart', 'bull', 'bear', 'bank', 'up', 'down', 'bills', 'halt']);
const marketState = z.object({ name: label, icon: pixelIcon, travelSpeed: positive, patrolSpeed: positive });
const obstacle = z.object({
  name: label, kind: z.literal('patrol'), speed: positive, width: positive, height: positive,
  effectIds: z.array(id).min(1), message: label
});
const interval = z.tuple([nonNegative, positive]).refine(([min, max]) => min <= max);
const edge = z.object({ to: id, type: z.enum(['walk', 'climb', 'jump', 'drop']), x: nonNegative });
const platform = z.object({
  id, layer: integer.nonnegative(), x: nonNegative, y: positive, width: positive,
  height: positive, safeLanding: point, edges: z.array(edge)
});
const bundle = z.object({ id, platformId: id, x: nonNegative, amount: positiveInt });
const ledge = z.object({ id, from: id, to: id, x: nonNegative, width: positive, rise: positive });
const mapSchema = z.object({
  id, width: positive, height: positive, spawnPoints: z.array(point).length(4), finishPlatformId: id,
  platforms: z.array(platform).min(2),
  ledges: z.array(ledge).default([]),
  ladders: z.array(z.object({ id, from: id, to: id, x: nonNegative })),
  cardSpawns: z.array(z.object({ id, platformId: id, x: nonNegative, kind: z.enum(['public', 'recovery']).default('public') })),
  obstacles: z.array(z.object({ id, platformId: id, type: id, fromX: nonNegative, toX: positive })).default([]),
  cash: z.object({ bundles: z.array(bundle), bonusCap: nonNegative }).default({ bundles: [], bonusCap: 0 }),
  zones: z.array(z.object({ name: label, startLayer: integer.nonnegative(), sky: color, accent: color })).min(1)
});
const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('displacement'), layers: integer.refine(value => value !== 0) }),
  z.object({ type: z.literal('speed_modifier'), multiplier: positive, durationMs: positiveInt }),
  z.object({ type: z.literal('freeze'), durationMs: positiveInt }),
  z.object({ type: z.literal('cash_loss_or_freeze'), amount: positiveInt, durationMs: positiveInt }),
  z.object({ type: z.literal('shield'), charges: positiveInt }),
  z.object({ type: z.literal('reveal_next_event') }),
  z.object({ type: z.literal('limit_loss'), layers: positiveInt }),
  z.object({ type: z.literal('clear_negative') })
]);
const event = z.object({
  id, title: label, description: label, fictional: z.literal(true), weight: positive,
  icon: pixelIcon, target: z.enum(['all', 'random_one', 'random_two', 'first_place', 'last_place']), effectIds: z.array(id).min(1)
});
const card = z.object({
  id, name: label, description: label, weight: positive, trigger: z.enum(['manual', 'on_pickup']),
  target: z.enum(['self', 'nearest_ahead']), effectIds: z.array(id).min(1),
  icon: pixelIcon, color, pool: z.enum(['public', 'recovery', 'both']).default('public')
});
const difficulty = z.enum(['easy', 'normal', 'hard']);
const configSchema = z.object({
  gameplay: z.object({
    eventIntervalMs: positiveInt, durationMs: positiveInt, cardRespawnMs: positiveInt,
    inventorySize: positiveInt, countdownMs: positiveInt, newsMs: positiveInt,
    summitCloseMs: positiveInt, recoveryGapLayers: positiveInt, recoveryRanks: positiveInt.max(3),
    cardNewsMs: positiveInt, effectAnimationMs: positiveInt
  }),
  cash: z.object({ layersPerHundred: positive, pickupRange: positive }),
  fallingTraders: z.object({
    name: label, message: label, intervalMs: interval, warningMs: positiveInt, speed: positive, spawnHeight: positive,
    landingMs: positiveInt, width: positive, height: positive, spread: nonNegative, doubleChance: nonNegative.max(1), laneSpacing: positive,
    effectIds: z.array(id).min(1)
  }),
  physics: z.object({
    moveSpeed: positive, climbSpeed: positive, jumpVelocity: positive, gravity: positive,
    hitbox: z.object({ width: positive, height: positive }), ladderGrab: positive
  }),
  npc: z.object({
    reactionMs: z.record(difficulty, interval),
    jumpChance: z.record(difficulty, z.number().min(0).max(1)),
    cardThinkMs: interval,
    cashDetour: nonNegative
  }),
  theme: z.object({ width: positiveInt, height: positiveInt, panel: color, gold: color, night: color, up: color, down: color }),
  characters: z.array(z.strictObject({
    id, name: label, description: label, color, spriteKey: id, portrait: id
  })).length(4),
  effects: z.record(id, effect),
  events: z.array(event).min(1),
  cards: z.array(card).min(1),
  market: z.object({ neutral: marketState, positive: marketState, negative: marketState }),
  obstacles: z.record(id, obstacle),
  maps: z.object({ mountain: mapSchema, training: mapSchema })
});

export type Config = z.infer<typeof configSchema>;
export type Platform = z.infer<typeof platform>;
export type GameMap = z.infer<typeof mapSchema>;
export type PixelIcon = z.infer<typeof pixelIcon>;
export type Effect = z.infer<typeof effect>;
export type Card = z.infer<typeof card>;
export type MarketEvent = z.infer<typeof event>;
export type Character = Config['characters'][number];
export type Difficulty = z.infer<typeof difficulty>;
export type Tone = keyof Config['market'];

export const inputConfig = {
  gameplay: gameplayJson, cash: cashJson, fallingTraders: fallingTraderJson, physics: physicsJson, npc: npcJson, theme: themeJson, characters: charactersJson,
  events: eventsJson, effects: effectsJson, cards: cardsJson, market: marketJson, obstacles: obstaclesJson,
  maps: { mountain: mountainJson, training: trainingJson }
};

function assert(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`遊戲設定錯誤：${reason}`);
}

function unique(items: { id: string }[], section: string) {
  assert(new Set(items.map(item => item.id)).size === items.length, `${section} 含重複 ID`);
}

function inside(x: number, item: Platform, margin = 0) {
  return x >= item.x + margin && x <= item.x + item.width - margin;
}

function validateMap(map: GameMap, { physics, obstacles }: Config) {
  const detail = (reason: string) => `地圖 ${map.id}，${reason}`;
  const halfWidth = physics.hitbox.width / 2;
  const platforms = new Map(map.platforms.map(item => [item.id, item]));
  unique(map.platforms, detail('平台'));
  unique(map.ladders, detail('梯子'));
  unique([...map.platforms, ...map.ledges], detail('平台'));
  const jumpHeight = physics.jumpVelocity ** 2 / (2 * physics.gravity);
  const landings = new Map(platforms);
  for (const surface of map.ledges) {
    const from = platforms.get(surface.from);
    const to = platforms.get(surface.to);
    const x = surface.x + surface.width / 2;
    assert(from && to && to.layer === from.layer + 1 && surface.width >= physics.hitbox.width &&
      surface.x + surface.width <= map.width && surface.rise < jumpHeight && from.y - surface.rise > to.y &&
      from.y - surface.rise - to.y < jumpHeight && inside(x, from, halfWidth) && inside(x, to, halfWidth),
      detail(`懸空方塊 ${surface.id} 無法以兩段跳連通`));
    landings.set(surface.id, { ...surface, y: from.y - surface.rise, height: 12, layer: from.layer,
      safeLanding: { x, y: from.y - surface.rise }, edges: [] });
  }
  unique(map.cardSpawns, detail('卡箱'));

  unique(map.obstacles, detail('障礙物'));
  unique(map.cash.bundles, detail('鈔票'));
  for (const note of map.cash.bundles) {
    const platform = platforms.get(note.platformId);
    assert(platform && inside(note.x, platform, halfWidth), detail(`鈔票 ${note.id} 缺少可到達的平台`));
  }
  for (const item of map.obstacles) {
    const type = obstacles[item.type];
    const platform = platforms.get(item.platformId);
    const margin = (type?.width ?? 0) / 2;
    assert(type && platform && item.fromX < item.toX &&
      inside(item.fromX, platform, margin) && inside(item.toX, platform, margin),
      detail(`障礙物 ${item.id} 的路徑或類型無效`));
  }

  const floor = map.platforms[0];
  const finish = platforms.get(map.finishPlatformId);
  assert(floor.layer === 0 && floor.x === 0 && floor.width === map.width, detail('底層必須覆蓋地圖寬度'));
  assert(finish && finish.layer === map.platforms.length - 1, detail('終點必須位於頂層'));
  assert(map.zones[0].startLayer === 0 && map.zones.every((zone, i) =>
    zone.startLayer <= finish.layer && (!i || zone.startLayer > map.zones[i - 1].startLayer)), detail('區域起始層無效'));

  for (const [layer, item] of map.platforms.entries()) {
    assert(item.layer === layer && (!layer || item.y < map.platforms[layer - 1].y), detail(`${item.id} 層級不連續`));
    assert(item.x + item.width <= map.width && item.y + item.height <= map.height, detail(`${item.id} 超出地圖`));
    assert(item.y === item.safeLanding.y && inside(item.safeLanding.x, item, halfWidth), detail(`${item.id} 落點無效`));
    for (const link of item.edges) {
      const target = platforms.get(link.to);
      assert(target && target !== item, detail(`${item.id} 指向無效路徑 ${link.to}`));
      if (link.type === 'climb') {
        assert(map.ladders.some(ladder => ladder.x === link.x &&
          ((ladder.from === item.id && ladder.to === target.id) || (ladder.to === item.id && ladder.from === target.id))),
        detail(`${item.id} 缺少對應實體梯子`));
      } else if (link.type === 'jump') {
        assert(inside(link.x, item, halfWidth) && inside(link.x, target, halfWidth) && item.y > target.y &&
          item.y - target.y < jumpHeight, detail(`${item.id} 的跳躍路徑超出可達範圍`));
      } else if (link.type === 'drop') {
        assert(item.y < target.y && !inside(link.x, item) && inside(link.x, target, halfWidth),
          detail(`${item.id} 的落下路徑無效`));
      } else {
        assert(item.y === target.y && inside(link.x, item) && inside(link.x, target), detail(`${item.id} 無法步行相接`));
      }
    }
  }

  for (const ladder of map.ladders) {
    const from = platforms.get(ladder.from);
    const to = platforms.get(ladder.to);
    assert(from && to && from.layer + 1 === to.layer && inside(ladder.x, from, halfWidth) &&
      inside(ladder.x, to, halfWidth), detail(`${ladder.id} 無法連接指定平台`));
  }
  for (const spawn of map.spawnPoints) {
    assert(spawn.y === floor.y && inside(spawn.x, floor, halfWidth), detail('出發點無效'));
  }
  for (const spawn of map.cardSpawns) {
    const item = landings.get(spawn.platformId);
    assert(item && inside(spawn.x, item, halfWidth), detail(`卡箱 ${spawn.id} 缺少有效平台`));
  }

  const canFinish = new Set([finish.id]);
  for (const item of [...map.platforms].reverse()) {
    const jumpViaLedge = map.ledges.some(ledge => ledge.from === item.id && canFinish.has(ledge.to));
    if (jumpViaLedge || item.edges.some(link => link.type !== 'drop' && canFinish.has(link.to))) {
      canFinish.add(item.id);
    }
    assert(canFinish.has(item.id), detail(`${item.id} 找不到可達終點的上行路徑`));
  }
}

export function readConfig(raw: unknown): Config {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`遊戲設定錯誤：${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  }
  const config = parsed.data;
  unique(config.characters, '角色');
  unique(config.events, '事件');
  unique(config.cards, '卡片');

  for (const item of [...config.events, ...config.cards]) {
    for (const reference of item.effectIds) {
      assert(Object.hasOwn(config.effects, reference), `${item.id} 引用了不存在的效果 ${reference}`);
    }
  }
  for (const item of config.cards) {
    assert(item.trigger !== 'on_pickup' || item.target === 'self', `${item.id} 即時卡片的目標必須為自己`);
  }
  for (const [key, obstacle] of Object.entries(config.obstacles)) {
    for (const effect of obstacle.effectIds) {
      assert(Object.hasOwn(config.effects, effect) && config.effects[effect].type !== 'displacement',
        `障礙物 ${key} 的效果引用無效 ${effect}`);
    }
  }
  assert(config.fallingTraders.laneSpacing > config.fallingTraders.width + config.physics.hitbox.width,
    '墜落障礙的落點間距須留出閃避空間');
  for (const effect of config.fallingTraders.effectIds) {
    assert(Object.hasOwn(config.effects, effect) && config.effects[effect].type === 'freeze',
      `墜落障礙的效果引用無效 ${effect}`);
  }
  assert(config.cards.some(card => card.pool !== 'recovery'), '缺少一般卡箱可抽取的卡片');
  assert(config.cards.some(card => card.pool !== 'public'), '缺少落後補給可抽取的卡片');
  assert(config.cards.every(card => card.pool === 'public' || card.trigger === 'manual'), '落後補給僅可包含主動卡');
  assert(config.gameplay.inventorySize <= 9, '卡片欄最多支援九個數字快捷鍵');
  for (const map of Object.values(config.maps)) {
    assert(map.width === config.theme.width && map.height >= config.theme.height, `地圖 ${map.id} 尺寸與遊戲視窗不一致`);
    validateMap(map, config);
  }
  return config;
}
