import type { FinancialConfig } from '../config/financial-settings';
import type { AnimationId, SceneId, Situation, TheaterConfig, TheaterSound } from '../config/theater-settings';
import type { DayOutcome, DayReport, TradingRun } from '../core/trading-run';
import { marketTone } from '../core/trading-effects';
import { money } from './format';
import type { SpriteMood } from './pixels';

export type Tone = 'positive' | 'negative' | 'neutral';
export type TheaterMode = 'full' | 'quick' | 'off';

export interface Cue { situation: Situation; score: number; amount: number; rank: number | null }
export interface ResultRow {
  id: string; name: string; color: string; applied: boolean; market: number; net: number; shielded: number;
  rankBefore: number | null; rankAfter: number | null; combos: number; isPlayer: boolean; empty: boolean
}
export type Step =
  | { kind: 'scene'; sceneId: SceneId; kicker: string; title: string; subtitle: string; severity: 'normal' | 'major' | 'extreme'; tone: Tone; sound: TheaterSound; animationId: AnimationId }
  | { kind: 'line'; speakerKind: 'anchor'; speakerId: string; text: string }
  | { kind: 'line'; speakerKind: 'investor'; speakerId: string; text: string; mood: SpriteMood; situation: Situation }
  | { kind: 'effect'; animationId: AnimationId; tone: Tone; rows: ResultRow[] }
  | { kind: 'results'; rows: ResultRow[]; final: boolean };

const base: Record<Situation, number> = {
  champion: 100, bankrupt: 95, recovery: 90, allin_down: 75, allin_up: 72, shield: 70, attacked: 65, combo: 60,
  sold_rally: 58, rank_drop: 55, overtake: 50, half_safe: 45, cash_dodge: 44, cash_rally: 40, market_loss: 30, market_gain: 30
};
export const situationMood: Record<Situation, SpriteMood> = {
  champion: 'win', bankrupt: 'broke', recovery: 'recover', allin_down: 'loss', allin_up: 'gain', shield: 'shield',
  attacked: 'hit', combo: 'gain', sold_rally: 'loss', rank_drop: 'loss', overtake: 'gain', half_safe: 'idle', cash_dodge: 'idle',
  cash_rally: 'think', market_loss: 'loss', market_gain: 'gain'
};
/** Whether the situation is good news for the speaker; used to pick contrasting pairs. */
const upbeat = (situation: Situation) => ['champion', 'recovery', 'allin_up', 'shield', 'combo', 'overtake', 'half_safe', 'cash_dodge', 'market_gain'].includes(situation);

/**
 * Every situation an investor's actual record supports for this day, strongest first.
 * Nothing here is random: each cue is a direct reading of the settlement ledger, holdings snapshot and ranks.
 */
export function cuesFor(outcome: DayOutcome, tone: Tone, rankBefore: number | null, rankAfter: number | null, champion: boolean, config: FinancialConfig): Cue[] {
  const cues: Cue[] = [];
  const net = outcome.close - outcome.start;
  const hit = outcome.marketApplied;
  const empty = outcome.exposure.stock <= 0;
  const all = outcome.allocation === 'all';
  const previous = outcome.allocationBefore;
  const add = (situation: Situation, amount = 0, when = true) => {
    if (!when) return;
    const weight = Math.min(15, Math.abs(amount) / config.financial.initialCapital * 20);
    cues.push({ situation, amount: Math.abs(amount), rank: rankAfter, score: base[situation] + weight });
  };
  add('champion', 0, champion);
  add('bankrupt', 0, outcome.risk.insolvent && !outcome.recovery);
  add('recovery', 0, Boolean(outcome.recovery));
  add('shield', outcome.ledger.protected, outcome.ledger.protected > 0);
  add('allin_up', outcome.marketPnl, hit && all && outcome.marketPnl > 0);
  add('allin_down', outcome.marketPnl, hit && all && outcome.marketPnl < 0 && !outcome.ledger.protected);
  add('attacked', net, outcome.incomingCards.length > 0 && net < 0);
  add('combo', net, outcome.ledger.synergies > 0 && net > 0);
  add('sold_rally', 0, hit && tone === 'positive' && empty && previous !== 'cash');
  add('cash_rally', 0, hit && tone === 'positive' && empty && previous === 'cash');
  const heavy = -outcome.marketPnl >= outcome.start * 0.08;
  add('half_safe', outcome.marketPnl, hit && tone === 'negative' && outcome.allocation === 'half' && outcome.marketPnl < 0 && !heavy);
  add('cash_dodge', 0, hit && tone === 'negative' && empty);
  add('overtake', 0, rankBefore !== null && rankAfter !== null && rankAfter < rankBefore);
  add('rank_drop', 0, rankBefore !== null && rankAfter !== null && rankAfter - rankBefore >= 2);
  add('market_gain', outcome.marketPnl, hit && outcome.marketPnl > 0 && !all);
  add('market_loss', outcome.marketPnl, hit && outcome.marketPnl < 0 && !all && (outcome.allocation !== 'half' || heavy) && !outcome.ledger.protected);
  return cues.sort((a, b) => b.score - a.score);
}

/** Stable text pick that never touches the game's random streams. */
function pick<T>(items: T[], ...keys: (string | number)[]) {
  let hash = 2166136261;
  for (const char of keys.join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return items[(hash >>> 0) % items.length];
}

export function lineFor(theater: TheaterConfig, situation: Situation, characterId: string, cue: Cue, keys: (string | number)[]) {
  const entry = theater.lines[situation];
  const own = (entry as Record<string, unknown>)[characterId];
  const pool = typeof own === 'string' ? [...entry.lines, own] : entry.lines;
  const usable = cue.rank === null ? pool.filter(text => !text.includes('{rank}')) : pool;
  const text = pick(usable.length ? usable : entry.lines, ...keys, characterId, situation);
  return text.replaceAll('{amount}', money(cue.amount)).replaceAll('{rank}', String(cue.rank ?? ''));
}

const rankAt = (ranks: (number | null)[], index: number) => index >= 0 && index < ranks.length ? ranks[index] : null;

/** Builds the theater for one settled day. Reads only the finished report and public ranks; returns no steps when there is nothing to show. */
export function buildTheater(run: TradingRun, report: DayReport, theater: TheaterConfig, mode: TheaterMode): Step[] {
  if (mode === 'off') return [];
  const config = run.config;
  const final = run.closed && report === run.reports.at(-1);
  if (!report.market && !final) return [];
  const index = run.reports.indexOf(report);
  const tone: Tone = report.market ? marketTone(report.market, config) : 'positive';
  const severity = report.market?.severity ?? 'major';
  const show = report.market ? theater.events[report.market.id] : null;
  const standings = run.standings();
  const winner = final ? standings.find(item => item.rank === 1)?.investor : undefined;
  const rows: ResultRow[] = report.outcomes.map(outcome => {
    const ranks = outcome.investor.ranks as (number | null)[];
    return {
      id: outcome.investor.character.id, name: outcome.investor.character.name, color: outcome.investor.character.color,
      applied: outcome.marketApplied, market: outcome.marketPnl, net: outcome.close - outcome.start, shielded: outcome.ledger.protected,
      rankBefore: rankAt(ranks, index), rankAfter: rankAt(ranks, index + 1), combos: outcome.ledger.synergies,
      isPlayer: outcome.investor === run.player, empty: outcome.exposure.stock <= 0
    };
  });
  const steps: Step[] = [];
  const scene = show ?? theater.closing;
  steps.push({
    kind: 'scene', sceneId: scene.sceneId, severity, tone,
    kicker: report.market ? `${severity === 'extreme' ? '緊急插播' : severity === 'major' ? '重大快訊' : '市場快訊'} · 第 ${report.day} 日` : `收盤 · 第 ${report.day} 日`,
    title: report.market?.title ?? '十五日交易結束', subtitle: report.market?.subtitle ?? '',
    sound: show?.soundId ?? 'fanfare', animationId: show?.animationId ?? 'rally'
  });
  const quick = mode === 'quick';
  const anchorLines = quick || severity === 'normal' ? scene.dialogue.slice(0, 1) : scene.dialogue;
  for (const text of anchorLines) steps.push({ kind: 'line', speakerKind: 'anchor', speakerId: scene.speakerId, text });
  if (show && final) for (const text of theater.closing.dialogue.slice(0, 1)) steps.push({ kind: 'line', speakerKind: 'anchor', speakerId: theater.closing.speakerId, text });

  const castSize = final ? 2 : quick ? (severity === 'normal' ? 0 : 1) : severity === 'normal' ? 1 : 2;
  const candidates = report.outcomes.flatMap((outcome, slot) => {
    if (outcome.investor.account.eliminated && !outcome.risk.insolvent) return [];
    const row = rows[slot];
    const cue = cuesFor(outcome, tone, row.rankBefore, row.rankAfter, outcome.investor === winner, config)
      .filter(item => report.market || ['champion', 'overtake', 'rank_drop', 'bankrupt', 'recovery', 'combo', 'shield'].includes(item.situation))[0];
    return cue ? [{ outcome, cue: { ...cue, score: cue.score + (outcome.investor === run.player ? 8 : 0) } }] : [];
  }).sort((a, b) => b.cue.score - a.cue.score);
  const cast: typeof candidates = [];
  if (winner) {
    const champion = candidates.find(item => item.outcome.investor === winner);
    if (champion) cast.push(champion);
  }
  for (const item of candidates) {
    if (cast.length >= castSize) break;
    if (cast.includes(item)) continue;
    if (cast.length && cast.some(other => other.cue.situation === item.cue.situation)) continue;
    cast.push(item);
  }
  // Prefer a contrasting second voice when one exists.
  if (cast.length === 2 && upbeat(cast[0].cue.situation) === upbeat(cast[1].cue.situation)) {
    const contrast = candidates.find(item => !cast.includes(item) && upbeat(item.cue.situation) !== upbeat(cast[0].cue.situation) && item.cue.score >= 40);
    if (contrast && !winner) cast[1] = contrast;
  }
  const lines = cast.map(({ outcome, cue }) => ({
    kind: 'line' as const, speakerKind: 'investor' as const, speakerId: outcome.investor.character.id, situation: cue.situation,
    mood: situationMood[cue.situation], text: lineFor(theater, cue.situation, outcome.investor.character.id, cue, [run.options.seed, report.day])
  }));
  // Market reactions come first, the champion's words close the show.
  steps.push(...(winner ? lines.slice(1) : lines));
  if (!quick && severity !== 'normal' && report.market) steps.push({ kind: 'effect', animationId: scene === show ? show.animationId : 'rally', tone, rows });
  if (winner && lines[0]) steps.push(lines[0]);
  steps.push({ kind: 'results', rows, final });
  return steps;
}
