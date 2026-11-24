import { z } from 'zod';
import type { FinancialConfig } from './financial-settings';
import theater from '../data/event-theater.json';
import lines from '../data/character-lines.json';

export const sceneIds = ['ai_lab', 'fab', 'exchange', 'central_bank', 'press', 'port', 'energy', 'vault', 'chatroom', 'broker', 'black_swan', 'party'] as const;
export const animationIds = ['rally', 'drift_up', 'rebound', 'dip', 'crash', 'rotate', 'swan', 'glitch'] as const;
export const soundIds = ['breaking', 'chime', 'alarm', 'fanfare', 'gavel', 'bell', 'phone', 'notify', 'siren'] as const;
export const situations = ['lev_up', 'lev_down', 'cash_rally', 'sold_rally', 'cash_dodge', 'deposit_safe', 'shield', 'combo', 'attacked',
  'margin_call', 'overtake', 'rank_drop', 'bankrupt', 'recovery', 'champion', 'market_gain', 'market_loss'] as const;
export type SceneId = typeof sceneIds[number];
export type AnimationId = typeof animationIds[number];
export type TheaterSound = typeof soundIds[number];
export type Situation = typeof situations[number];

const text = z.string().trim().min(2).max(40);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const line = text.refine(value => !/\{(?!amount\}|rank\})/.test(value), '台詞只能使用 {amount} 或 {rank}');

const schema = z.strictObject({
  scenes: z.record(z.enum(sceneIds), z.strictObject({ name: text, sky: color, accent: color })),
  speakers: z.record(z.string(), z.strictObject({ name: text, role: text, color, look: z.enum(['anchor', 'reporter', 'professor', 'uncle', 'broker']) })),
  events: z.record(z.string(), z.strictObject({
    sceneId: z.enum(sceneIds), speakerId: z.string(), animationId: z.enum(animationIds), soundId: z.enum(soundIds),
    dialogue: z.array(text).min(1).max(3)
  })),
  closing: z.strictObject({ sceneId: z.enum(sceneIds), speakerId: z.string(), dialogue: z.array(text).min(1).max(3) })
});
const lineSchema = z.record(z.enum(situations), z.object({ label: text, lines: z.array(line).min(3) }).catchall(line));

export type TheaterConfig = z.infer<typeof schema> & { lines: z.infer<typeof lineSchema> };

/** Presentation-only data for the market event theater; validated against the game's events and characters at startup. */
export function readTheaterConfig(config: FinancialConfig): TheaterConfig {
  const data = schema.parse(theater);
  const table = lineSchema.parse(lines);
  const problems: string[] = [];
  for (const id of sceneIds) if (!data.scenes[id]) problems.push(`缺少場景 ${id}`);
  for (const id of situations) if (!table[id]) problems.push(`缺少情境台詞 ${id}`);
  for (const event of config.events) {
    const show = data.events[event.id];
    if (!show) problems.push(`新聞 ${event.id} 沒有演出設定`);
    else if (!data.speakers[show.speakerId]) problems.push(`新聞 ${event.id} 的主播 ${show.speakerId} 不存在`);
  }
  if (!data.speakers[data.closing.speakerId]) problems.push('收盤演出的主播不存在');
  for (const id of Object.keys(data.events)) if (!config.events.some(event => event.id === id)) problems.push(`演出設定 ${id} 沒有對應新聞`);
  const characters = new Set(config.characters.map(item => item.id));
  for (const [situation, entry] of Object.entries(table)) {
    for (const key of Object.keys(entry)) if (key !== 'label' && key !== 'lines' && !characters.has(key)) problems.push(`情境 ${situation} 有未知角色 ${key}`);
  }
  if (problems.length) throw new Error('事件演出設定錯誤：' + problems.join('；'));
  return { ...data, lines: table };
}
