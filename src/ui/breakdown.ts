import type { DayOutcome } from '../core/trading-run';
import type { ChainStep } from '../core/settlement';

export interface BreakdownLine {
  key: 'stock' | 'news' | 'joker' | 'item' | 'event' | 'attack' | 'sacrifice' | 'restart';
  label: string;
  amount: number;
}

export interface DayBreakdown {
  net: number;
  /** Additive lines; their amounts always sum to `net`. Zero lines are omitted. */
  lines: BreakdownLine[];
  /** The settlement chain itself, in the order it was resolved. */
  chain: ChainStep[];
  /** Loss avoided by loss cuts and defenses; already included in the lines above. */
  shielded: number;
  combos: number;
}

const group: Record<ChainStep['source'], BreakdownLine['key']> = {
  shop: 'event', market: 'stock', cap: 'joker', news: 'news', joker: 'joker', item: 'item', defense: 'item', attack: 'attack', sacrifice: 'sacrifice', event: 'event'
};
const labels: Record<BreakdownLine['key'], string> = {
  stock: '今日股市', news: '市場新聞', joker: '王牌', item: '道具', event: '特殊事件', attack: '對手狙擊', sacrifice: '主動獻祭', restart: '歸零翻身'
};

/** Groups the actual settlement chain of one day; the parts always add up to the real change in total worth. */
export function dayBreakdown(outcome: DayOutcome): DayBreakdown {
  const net = outcome.close - outcome.start;
  const totals = new Map<BreakdownLine['key'], number>();
  for (const step of outcome.ledger.steps) totals.set(group[step.source], (totals.get(group[step.source]) ?? 0) + step.amount);
  const counted = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (net !== counted) totals.set('restart', net - counted);
  const lines = (Object.keys(labels) as BreakdownLine['key'][])
    .map(key => ({ key, label: labels[key], amount: totals.get(key) ?? 0 })).filter(line => line.amount !== 0);
  return { net, lines, chain: outcome.ledger.steps, shielded: outcome.ledger.shielded, combos: outcome.ledger.combos };
}
