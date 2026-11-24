import type { DayOutcome } from '../core/trading-run';

export interface BreakdownLine {
  key: 'stock' | 'news' | 'income' | 'other';
  label: string;
  amount: number;
}

export interface DayBreakdown {
  net: number;
  /** Additive lines; their amounts always sum to `net`. Zero lines are omitted. */
  lines: BreakdownLine[];
  /** Part of the lines above that came from cards. Informational only, never added again. */
  cardShare: number;
  /** Loss the shield absorbed. Informational only: the news line already reflects it. */
  shielded: number;
  combos: number;
}

/**
 * Splits one day's actual total-worth change using the settlement ledger: the shared daily stock move, the news,
 * cash income, and the remainder (card boosts, rival attacks, restarting after hitting zero). The parts always
 * add up to the real change.
 */
export function dayBreakdown(outcome: DayOutcome): DayBreakdown {
  const { ledger } = outcome;
  const net = outcome.close - outcome.start;
  const income = outcome.openingInterest + outcome.openingStockIncome + ledger.dividends + ledger.cashYield;
  const stock = ledger.baseMarket;
  const news = outcome.marketPnl;
  const other = net - income - stock - news;
  const lines: BreakdownLine[] = [
    { key: 'stock', label: '今日股市', amount: stock },
    { key: 'news', label: '市場新聞', amount: news },
    { key: 'income', label: '現金收入', amount: income },
    { key: 'other', label: outcome.recovery ? '歸零翻身' : '卡片與對手', amount: other }
  ];
  return {
    net, lines: lines.filter(line => line.amount !== 0),
    cardShare: ledger.cardGain, shielded: ledger.protected, combos: ledger.synergies
  };
}
