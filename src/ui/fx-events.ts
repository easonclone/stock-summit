import type { FeedbackConfig } from '../config/feedback-settings';
import type { AttackMiss, MissReason } from '../core/attacks';
import type { ChainStep } from '../core/settlement';
import type { DayOutcome, DayReport } from '../core/trading-run';

/**
 * Presentation events for one settled day. Built only from the DayReport (attack records, misses and each
 * investor's settlement chain); nothing here re-runs a card or changes a number. Every amount shown comes from
 * a record, and each investor's wealth frames end exactly at the recorded close.
 */
export type HitTier = 'light' | 'normal' | 'strong' | 'heavy';

export type FxEvent =
  | { kind: 'market'; at: number; id: string; amount: number; big: boolean; news: boolean }
  | { kind: 'own'; at: number; id: string; source: 'item' | 'event' | 'shop'; name: string; amount: number }
  | { kind: 'defense'; at: number; id: string; name: string; amount: number }
  | { kind: 'joker'; at: number; id: string; jokerId: string; name: string; amount: number; index: number; total: number; count: number; cap: boolean }
  | { kind: 'jokers'; at: number; id: string; amount: number; count: number }
  | { kind: 'attack'; at: number; from: string; to: string; itemId: string; amount: number; tier: HitTier; factor: number; area: boolean }
  | { kind: 'shatter'; at: number; from: string; to: string; itemId: string; amount: number; tier: HitTier }
  | { kind: 'raid'; at: number; from: string; to: string; itemId: string; amount: number; tier: HitTier }
  | { kind: 'reflect'; at: number; owner: string; hit: string; amount: number; cash: boolean }
  | { kind: 'miss'; at: number; from: string; to: string; itemId: string; reason: MissReason }
  | { kind: 'rank'; at: number; id: string; before: number; after: number };

export interface WealthFrame { at: number; value: number }
export interface FxSeat { id: string; start: number; close: number; frames: WealthFrame[]; peak: number; low: number }
export interface FxPlan { day: number; events: FxEvent[]; seats: FxSeat[]; span: number }

export const missCopy: Record<MissReason, string> = {
  limit: '對手今天已被打過', no_stock: '對手沒有股票', no_cash: '對手沒有現金', no_shield: '對手沒有護盾', capped: '對手今天的損失已到上限'
};

export function hitTier(amount: number, start: number, feedback: FeedbackConfig): HitTier {
  const share = start > 0 ? amount / start : 1;
  return share >= feedback.tiers.heavy ? 'heavy' : share >= feedback.tiers.strong ? 'strong' : share >= feedback.tiers.normal ? 'normal' : 'light';
}

const seatOf = (outcome: DayOutcome) => outcome.investor.character.id;
const base = new Set<ChainStep['source']>(['market', 'news']);

/** Running worth through the day's chain in resolution order; used to size the bars so nothing overflows mid-show. */
export function worthRange(outcome: DayOutcome) {
  let value = outcome.start;
  let peak = Math.max(outcome.start, outcome.close);
  let low = Math.min(outcome.start, outcome.close);
  for (const step of outcome.ledger.steps) {
    value += step.amount;
    peak = Math.max(peak, value);
    low = Math.min(low, value);
  }
  return { peak, low };
}

export function buildFxPlan(feedback: FeedbackConfig, report: DayReport, playerId: string): FxPlan {
  const timing = feedback.timing;
  const events: FxEvent[] = [];
  const deltas = new Map<string, { at: number; amount: number }[]>();
  const add = (id: string, at: number, amount: number) => { if (amount) (deltas.get(id) ?? deltas.set(id, []).get(id)!).push({ at, amount }); };
  const starts = new Map(report.outcomes.map(outcome => [seatOf(outcome), outcome.start]));

  // 1. Market, news and the investor's own non-joker steps land together at the open of the show.
  let chainLength = 0;
  for (const outcome of report.outcomes) {
    const id = seatOf(outcome);
    const steps = outcome.ledger.steps;
    let at = 0;
    const next = () => { const value = at; at += timing.baseGap; return value; };
    const market = steps.filter(step => base.has(step.source)).reduce((sum, step) => sum + step.amount, 0);
    if (market) {
      const when = next();
      events.push({ kind: 'market', at: when, id, amount: market, big: Math.abs(outcome.ledger.rate) >= feedback.bigMarket,
        news: steps.some(step => step.source === 'news') });
      add(id, when, market);
    }
    for (const step of steps) {
      if (step.source === 'defense' && step.amount) {
        const when = next();
        events.push({ kind: 'defense', at: when, id, name: step.name, amount: step.amount });
        add(id, when, step.amount);
      } else if ((step.source === 'item' || step.source === 'event' || step.source === 'shop') && step.amount) {
        const when = next();
        events.push({ kind: 'own', at: when, id, source: step.source, name: step.name, amount: step.amount });
        add(id, when, step.amount);
      }
    }
    // 2. Jokers: the player's fire one by one; a rival's are summed into one number so the arena stays readable.
    const jokers = steps.filter(step => (step.source === 'joker' || step.source === 'cap') && step.amount);
    if (id === playerId) {
      let total = 0;
      jokers.forEach((step, index) => {
        const when = timing.chainStart + index * timing.chainGap;
        total += step.amount;
        events.push({ kind: 'joker', at: when, id, jokerId: step.id, name: step.name, amount: step.amount, index, total, count: index + 1, cap: step.source === 'cap' });
        add(id, when, step.amount);
      });
      chainLength = jokers.length;
    } else if (jokers.length) {
      const amount = jokers.reduce((sum, step) => sum + step.amount, 0);
      events.push({ kind: 'jokers', at: timing.chainStart, id, amount, count: jokers.length });
      add(id, timing.chainStart, amount);
    }
  }

  // 3. Attacks in the order they were resolved, after the chain. Amounts are the attack records themselves.
  let next = Math.max(timing.attackStart, timing.chainStart + chainLength * timing.chainGap);
  const hits = [...report.attacks.map(record => ({ record, miss: null as AttackMiss | null })),
    ...report.misses.map(miss => ({ record: null, miss }))];
  let volley = null as { key: string; at: number } | null;
  for (const { record, miss } of hits) {
    // One 股市大混戰 hits every target at the same moment; every other attack gets its own beat.
    const key = record?.kind === 'area_attack' ? `${record.from}:${record.slot}` : null;
    let at: number;
    if (key && volley?.key === key) at = volley.at;
    else {
      at = next;
      next += timing.attackGap;
    }
    volley = key ? { key, at } : null;
    if (miss) {
      events.push({ kind: 'miss', at, from: miss.from, to: miss.to, itemId: miss.itemId, reason: miss.reason });
      continue;
    }
    const attack = record!;
    const tier = hitTier(attack.amount, starts.get(attack.to) ?? 0, feedback);
    if (attack.kind === 'cash_raid') {
      events.push({ kind: 'raid', at, from: attack.from, to: attack.to, itemId: attack.itemId, amount: attack.amount, tier });
      add(attack.to, at, -attack.amount);
      add(attack.from, at, attack.amount);
    } else if (attack.kind === 'shield_break') {
      events.push({ kind: 'shatter', at, from: attack.from, to: attack.to, itemId: attack.itemId, amount: attack.amount, tier });
      add(attack.to, at, -attack.amount);
    } else {
      events.push({ kind: 'attack', at, from: attack.from, to: attack.to, itemId: attack.itemId, amount: attack.amount, tier,
        factor: attack.factor, area: attack.kind === 'area_attack' });
      add(attack.to, at, -attack.amount);
    }
    if (attack.reflected > 0) {
      const when = at + timing.reflectDelay;
      const cash = attack.kind === 'cash_raid';
      events.push({ kind: 'reflect', at: when, owner: attack.to, hit: attack.from, amount: attack.reflected, cash });
      add(attack.from, when, -attack.reflected);
      if (cash) add(attack.to, when, attack.reflected);
    }
  }

  // 4. Whatever the chain still holds (nothing, unless a rule adds steps the groups above do not name) settles last,
  //    and a restart after hitting zero snaps to the recorded close. The frames always end at the real close.
  const end = Math.min(timing.maxSpan, Math.max(next, timing.chainStart + chainLength * timing.chainGap));
  const seats: FxSeat[] = report.outcomes.map(outcome => {
    const id = seatOf(outcome);
    const list = (deltas.get(id) ?? []).sort((a, b) => a.at - b.at);
    const frames: WealthFrame[] = [];
    let value = outcome.start;
    for (const delta of list) {
      value += delta.amount;
      const last = frames.at(-1);
      if (last && last.at === delta.at) last.value = value;
      else frames.push({ at: delta.at, value });
    }
    if (value !== outcome.close) frames.push({ at: end, value: outcome.close });
    const { peak, low } = worthRange(outcome);
    return { id, start: outcome.start, close: outcome.close, frames, peak: Math.max(peak, ...frames.map(frame => frame.value)), low };
  });

  for (const outcome of report.outcomes) {
    const before = outcome.investor.ranks[report.day - 1];
    const after = outcome.investor.ranks[report.day];
    if (before && after && after < before) events.push({ kind: 'rank', at: end + timing.rankDelay, id: seatOf(outcome), before, after });
  }
  events.sort((a, b) => a.at - b.at);
  return { day: report.day, events, seats, span: end + timing.rankDelay };
}
