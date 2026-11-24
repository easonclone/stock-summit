import type { DayOutcome } from '../core/trading-run';

export interface BreakdownLine {
  key: 'investment' | 'income' | 'market' | 'fees';
  label: string;
  amount: number;
}

export interface DayBreakdown {
  net: number;
  /** Additive lines; their amounts always sum to `net`. Zero lines are omitted. */
  lines: BreakdownLine[];
  /** Part of the lines above that came from cards. Informational only, never added again. */
  cardShare: number;
  /** Loss the shield absorbed. Informational only: the market line already reflects it. */
  shielded: number;
  combos: number;
}

/**
 * Splits one day's actual net-worth change into readable parts using the settlement ledger.
 * Income, market and fees come straight from the record; the investment line is the remainder, so liquidation,
 * restructuring and rival attacks stay inside it and the total can never drift from the real close.
 */
export function dayBreakdown(outcome: DayOutcome): DayBreakdown {
  const { ledger } = outcome;
  const net = outcome.close - outcome.start;
  const income = outcome.openingInterest + outcome.openingStockIncome + ledger.dividends + ledger.cashYield;
  const market = outcome.marketPnl;
  const fees = -ledger.fees;
  const investment = net - income - market - fees;
  const restructured = Boolean(outcome.recovery || outcome.risk.call?.liquidated || outcome.risk.insolvent);
  const lines: BreakdownLine[] = [
    { key: 'investment', label: restructured ? '投資、平倉與重整' : '投資損益', amount: investment },
    { key: 'income', label: '股息與利息', amount: income },
    { key: 'market', label: '市場新聞', amount: market },
    { key: 'fees', label: '費用', amount: fees }
  ];
  return {
    net, lines: lines.filter(line => line.amount !== 0),
    cardShare: ledger.cardGain, shielded: ledger.protected, combos: ledger.synergies
  };
}
