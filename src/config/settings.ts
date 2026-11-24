import { z } from 'zod';
import gameplayJson from './gameplay.json';
import cashJson from './cash.json';
import physicsJson from './physics.json';
import npcJson from './npc.json';
import nodesJson from './nodes.json';
import themeJson from './ui-theme.json';
import charactersJson from '../data/characters.json';
import eventsJson from '../data/events.json';
import effectsJson from '../data/effects.json';
import cardsJson from '../data/cards.json';
import marketJson from '../data/market-states.json';
import mountainJson from '../data/maps/mountain-01.json';

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
const marketState = z.object({ name: label, icon: pixelIcon });
const edge = z.object({ to: id, type: z.enum(['walk', 'climb', 'jump', 'drop']), x: nonNegative });
const platform = z.object({
  id, layer: integer.nonnegative(), x: nonNegative, y: positive, width: positive,
  height: positive, safeLanding: point, edges: z.array(edge)
});
const ledge = z.object({ id, from: id, to: id, x: nonNegative, width: positive, rise: positive });
const mapSchema = z.object({
  id, width: positive, height: positive, spawnPoints: z.array(point).length(4), finishPlatformId: id,
  platforms: z.array(platform).min(2),
  ledges: z.array(ledge).default([]),
  ladders: z.array(z.object({ id, from: id, to: id, x: nonNegative })),
  zones: z.array(z.object({ name: label, startLayer: integer.nonnegative(), sky: color, accent: color })).min(1)
});
const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('displacement'), layers: integer.refine(value => value !== 0) }),
  z.object({ type: z.literal('momentum'), layers: positiveInt, turns: positiveInt }),
  z.object({ type: z.literal('freeze'), turns: positiveInt }),
  z.object({ type: z.literal('cash_loss_or_freeze'), amount: positiveInt, turns: positiveInt }),
  z.object({ type: z.literal('cash_gain'), amount: positiveInt }),
  z.object({ type: z.literal('exposure'), multiplier: z.number().min(1) }),
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
const nodeKind = z.object({
  name: label, detail: label, icon: pixelIcon, color, effectIds: z.array(id).min(1),
  draw: z.enum(['public', 'recovery']).optional(), weight: positive, fromRow: integer.nonnegative()
});
const configSchema = z.object({
  gameplay: z.object({
    turns: positiveInt, eventEvery: positiveInt, inventorySize: positiveInt.max(9),
    recoveryGapLayers: positiveInt, recoveryRanks: positiveInt.max(3),
    newsMs: positiveInt, cardNewsMs: positiveInt, effectAnimationMs: positiveInt
  }),
  cash: z.object({ layersPerHundred: positive, bonusCap: nonNegative }),
  physics: z.object({
    moveSpeed: positive, climbSpeed: positive, jumpVelocity: positive, gravity: positive,
    hitbox: z.object({ width: positive, height: positive }), ladderGrab: positive
  }),
  npc: z.object({
    choiceNoise: z.record(difficulty, nonNegative),
    lookahead: nonNegative, cardValue: nonNegative, intelValue: nonNegative, shieldValue: nonNegative,
    exposurePenalty: nonNegative,
    cardUseChance: z.record(difficulty, z.number().min(0).max(1))
  }),
  nodes: z.object({
    lanes: integer.min(2).max(6), maxLinks: integer.min(1).max(3), attempts: positiveInt,
    kinds: z.record(id, nodeKind)
  }),
  theme: z.object({ width: positiveInt, height: positiveInt, panel: color, gold: color, night: color, up: color, down: color }),
  characters: z.array(z.strictObject({
    id, name: label, description: label, color, spriteKey: id, portrait: id
  })).length(4),
  effects: z.record(id, effect),
  events: z.array(event).min(1),
  cards: z.array(card).min(1),
  market: z.object({ neutral: marketState, positive: marketState, negative: marketState }),
  map: mapSchema
});

export type Config = z.infer<typeof configSchema>;
export type Platform = z.infer<typeof platform>;
export type GameMap = z.infer<typeof mapSchema>;
export type PixelIcon = z.infer<typeof pixelIcon>;
export type Effect = z.infer<typeof effect>;
export type Card = z.infer<typeof card>;
export type MarketEvent = z.infer<typeof event>;
export type NodeKind = z.infer<typeof nodeKind>;
export type Character = Config['characters'][number];
export type Difficulty = z.infer<typeof difficulty>;
export type Tone = keyof Config['market'];

export const inputConfig = {
  gameplay: gameplayJson, cash: cashJson, physics: physicsJson, npc: npcJson, nodes: nodesJson, theme: themeJson,
  characters: charactersJson, events: eventsJson, effects: effectsJson, cards: cardsJson, market: marketJson,
  map: mountainJson
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

/** Checks that the mountain drawn behind the race is consistent: layers, ladders, floating blocks and a path to the top. */
export function validateMap(map: GameMap, { physics }: Pick<Config, 'physics'>) {
  const detail = (reason: string) => `地圖 ${map.id}，${reason}`;
  const halfWidth = physics.hitbox.width / 2;
  const platforms = new Map(map.platforms.map(item => [item.id, item]));
  unique(map.platforms, detail('平台'));
  unique(map.ladders, detail('梯子'));
  unique([...map.platforms, ...map.ledges], detail('平台'));
  const jumpHeight = physics.jumpVelocity ** 2 / (2 * physics.gravity);
  for (const surface of map.ledges) {
    const from = platforms.get(surface.from);
    const to = platforms.get(surface.to);
    const x = surface.x + surface.width / 2;
    assert(from && to && to.layer === from.layer + 1 && surface.width >= physics.hitbox.width &&
      surface.x + surface.width <= map.width && surface.rise < jumpHeight && from.y - surface.rise > to.y &&
      from.y - surface.rise - to.y < jumpHeight && inside(x, from, halfWidth) && inside(x, to, halfWidth),
      detail(`懸空方塊 ${surface.id} 無法以兩段跳連通`));
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

  const references = [
    ...config.events.map(item => ({ owner: item.id, effectIds: item.effectIds })),
    ...config.cards.map(item => ({ owner: item.id, effectIds: item.effectIds })),
    ...Object.entries(config.nodes.kinds).map(([owner, item]) => ({ owner: `節點 ${owner}`, effectIds: item.effectIds }))
  ];
  for (const item of references) {
    for (const reference of item.effectIds) {
      assert(Object.hasOwn(config.effects, reference), `${item.owner} 引用了不存在的效果 ${reference}`);
    }
  }
  for (const item of config.cards) {
    assert(item.trigger !== 'on_pickup' || item.target === 'self', `${item.id} 即時卡片的目標必須為自己`);
  }
  assert(config.cards.some(card => card.pool !== 'recovery'), '缺少一般卡箱可抽取的卡片');
  assert(config.cards.some(card => card.pool !== 'public'), '缺少落後補給可抽取的卡片');
  assert(config.cards.every(card => card.pool === 'public' || card.trigger === 'manual'), '落後補給僅可包含主動卡');
  assert(Object.values(config.nodes.kinds).some(kind => kind.fromRow === 0), '第一回合沒有可出現的節點類型');
  assert(Object.keys(config.nodes.kinds).length >= 2, '節點類型至少需要兩種');
  assert(config.map.width === config.theme.width && config.map.height >= config.theme.height, `地圖 ${config.map.id} 尺寸與遊戲視窗不一致`);
  validateMap(config.map, config);
  return config;
}
