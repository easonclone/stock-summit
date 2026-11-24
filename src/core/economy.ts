export type FinancialStatus = 'normal' | 'bankruptcy';
/** V3.1：只有現金與股票兩種錢，沒有借款、利息或其他隱藏費用。 */
export interface Portfolio {
  initialCapital: number;
  cash: number;
  investmentValue: number;
  peakNetWorth: number;
  maxDrawdown: number;
  financialStatus: FinancialStatus;
  bankruptcyCount: number;
  eliminated: boolean;
  stats: { cashYield: number; dividends: number; investmentPnl: number };
}

export function openPortfolio(initialCapital: number): Portfolio {
  return {
    initialCapital, cash: initialCapital, investmentValue: 0,
    peakNetWorth: initialCapital, maxDrawdown: 0,
    financialStatus: 'normal', bankruptcyCount: 0, eliminated: false,
    stats: { cashYield: 0, dividends: 0, investmentPnl: 0 }
  };
}

export function copyPortfolio(account: Portfolio): Portfolio {
  return { ...account, stats: { ...account.stats } };
}

/** 總身家 = 現金 + 股票。 */
export const netWorth = (account: Portfolio) => account.cash + account.investmentValue;
export const returnRate = (account: Portfolio) => netWorth(account) / account.initialCapital - 1;
export const stockRatio = (account: Portfolio) => {
  const worth = netWorth(account);
  return worth > 0 ? account.investmentValue / worth : 0;
};

export function recordWorth(account: Portfolio, value = netWorth(account)) {
  account.peakNetWorth = Math.max(account.peakNetWorth, value);
  account.maxDrawdown = Math.max(account.maxDrawdown, (account.peakNetWorth - value) / account.peakNetWorth);
}

export interface Rebalance { ratio: number; bought: number; sold: number }

/** 把總身家的 ratio（0～1）放進股票。只是現金與股票互換，總身家不變、沒有手續費。 */
export function rebalance(account: Portfolio, ratio: number): Rebalance {
  const applied = Math.max(0, Math.min(1, ratio));
  const result: Rebalance = { ratio: applied, bought: 0, sold: 0 };
  const worth = netWorth(account);
  if (worth <= 0) return result;
  const change = Math.floor(worth * applied) - account.investmentValue;
  if (change > 0) result.bought = Math.min(change, account.cash);
  else result.sold = -change;
  account.cash += result.sold - result.bought;
  account.investmentValue += result.bought - result.sold;
  return result;
}

export function sellInvestment(account: Portfolio, fraction: number) {
  const sale = Math.floor(account.investmentValue * fraction);
  account.investmentValue -= sale;
  account.cash += sale;
  return sale;
}

/** 股票最多跌到零，不會變成負值或欠款。 */
export function revalue(account: Portfolio, rate: number) {
  const profit = Math.max(-account.investmentValue, Math.round(account.investmentValue * rate));
  account.investmentValue += profit;
  account.stats.investmentPnl += profit;
  return profit;
}

