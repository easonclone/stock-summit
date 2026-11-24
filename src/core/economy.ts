import type { FinancialRules } from '../config/financial-settings';

export type FinancialStatus = 'normal' | 'warning' | 'margin_call' | 'bankruptcy';
export interface Deposit { balance: number; maturity: number }
export interface Portfolio {
  initialCapital: number;
  cash: number;
  investmentValue: number;
  deposits: Deposit[];
  marginDebt: number;
  bailoutDebt: number;
  closingPayable: number;
  peakNetWorth: number;
  maxDrawdown: number;
  financialStatus: FinancialStatus;
  bankruptcyCount: number;
  leverageRestrictedUntil: number;
  eliminated: boolean;
  stats: {
    depositYield: number; cashYield: number; dividends: number; investmentPnl: number;
    fees: number; debtForgiven: number; liquidations: number; warnings: number; marginCalls: number;
  };
}

export function openPortfolio(initialCapital: number): Portfolio {
  return {
    initialCapital, cash: initialCapital, investmentValue: 0, deposits: [], marginDebt: 0,
    bailoutDebt: 0, closingPayable: 0, peakNetWorth: initialCapital, maxDrawdown: 0,
    financialStatus: 'normal', bankruptcyCount: 0, leverageRestrictedUntil: 0, eliminated: false,
    stats: { depositYield: 0, cashYield: 0, dividends: 0, investmentPnl: 0, fees: 0,
      debtForgiven: 0, liquidations: 0, warnings: 0, marginCalls: 0 }
  };
}

export function copyPortfolio(account: Portfolio): Portfolio {
  return { ...account, deposits: account.deposits.map(deposit => ({ ...deposit })), stats: { ...account.stats } };
}

export const depositBalance = (account: Portfolio) => account.deposits.reduce((sum, item) => sum + item.balance, 0);
export const debtBalance = (account: Portfolio) => account.marginDebt + account.bailoutDebt;
export const netWorth = (account: Portfolio) =>
  account.cash + account.investmentValue + depositBalance(account) - debtBalance(account);
export const returnRate = (account: Portfolio) => netWorth(account) / account.initialCapital - 1;
export const leverageExposure = (account: Portfolio) => account.investmentValue / Math.max(1, netWorth(account));
export const marginLtv = (account: Portfolio) => account.marginDebt ? account.marginDebt / account.investmentValue : 0;
export const outstandingWorth = (account: Portfolio) => netWorth(account) - account.closingPayable;

export function recordWorth(account: Portfolio, value = netWorth(account)) {
  account.peakNetWorth = Math.max(account.peakNetWorth, value);
  account.maxDrawdown = Math.max(account.maxDrawdown, (account.peakNetWorth - value) / account.peakNetWorth);
}

export function warningReasons(account: Portfolio, rules: FinancialRules) {
  const reasons: string[] = [];
  if (netWorth(account) <= account.initialCapital * rules.warningEquity) reasons.push('總身家低於安全門檻');
  if (account.marginDebt > 0 && marginLtv(account) >= rules.warningLtv) reasons.push('借款快追上股票市值了，再跌下去可能得補錢');
  if (account.marginDebt > 0 && account.cash < account.initialCapital * rules.warningCash) reasons.push('手上現金不多，遇到追繳可能不夠還');
  return reasons;
}

export function canBorrow(account: Portfolio, day: number, rules: FinancialRules) {
  return !account.eliminated && day > account.leverageRestrictedUntil && !warningReasons(account, rules).length;
}

export function investmentOrder(account: Portfolio, fraction: number, multiplier: number, day: number, rules: FinancialRules) {
  const stake = Math.floor(account.cash * fraction);
  if (!multiplier) return { stake, borrowed: 0, fee: 0 };
  if (!stake || !canBorrow(account, day, rules)) return { stake: 0, borrowed: 0, fee: 0 };
  const buyingPower = netWorth(account);
  const headroom = [
    stake * multiplier,
    (account.cash - stake) / Math.max(rules.originationFee, Number.EPSILON),
    (buyingPower * rules.maxDebtToEquity - debtBalance(account)) / (1 + rules.maxDebtToEquity * rules.originationFee),
    (buyingPower * rules.maxExposure - account.investmentValue - stake) / (1 + rules.maxExposure * rules.originationFee),
    (rules.initialMarginLtv * (account.investmentValue + stake) - account.marginDebt) / (1 - rules.initialMarginLtv)
  ];
  const borrowed = Math.max(0, Math.floor(Math.min(...headroom)));
  if (!borrowed) return { stake: 0, borrowed: 0, fee: 0 };
  const fee = Math.ceil(borrowed * rules.originationFee);
  return { stake, borrowed, fee };
}

export function invest(account: Portfolio, order: ReturnType<typeof investmentOrder>) {
  account.cash -= order.stake + order.fee;
  account.investmentValue += order.stake + order.borrowed;
  account.marginDebt += order.borrowed;
  account.stats.fees += order.fee;
}

export function lockDeposit(account: Portfolio, fraction: number, day: number, rules: FinancialRules) {
  const amount = Math.floor(account.cash * fraction);
  if (!amount) return 0;
  account.cash -= amount;
  account.deposits.push({ balance: amount, maturity: day + rules.depositDays });
  return amount;
}

export function collectDeposits(account: Portfolio, day: number, rules: FinancialRules) {
  let total = 0;
  for (const deposit of account.deposits) {
    const interest = Math.round(deposit.balance * rules.depositDailyRate);
    total += interest;
    account.cash += interest + (deposit.maturity <= day ? deposit.balance : 0);
  }
  account.deposits = account.deposits.filter(deposit => deposit.maturity > day);
  account.stats.depositYield += total;
  return total;
}

export function repay(account: Portfolio, budget: number, marginOnly = false) {
  const available = Math.min(account.cash, Math.max(0, budget));
  const margin = Math.min(available, account.marginDebt);
  const bailout = marginOnly ? 0 : Math.min(available - margin, account.bailoutDebt);
  account.marginDebt -= margin;
  account.bailoutDebt -= bailout;
  account.cash -= margin + bailout;
  return { margin, bailout };
}

export function sellInvestment(account: Portfolio, fraction: number) {
  const sale = Math.floor(account.investmentValue * fraction);
  account.investmentValue -= sale;
  account.cash += sale;
  return sale;
}

export function revalue(account: Portfolio, rate: number) {
  const profit = Math.round(account.investmentValue * Math.max(-1, rate));
  account.investmentValue += profit;
  account.stats.investmentPnl += profit;
  return profit;
}

export function chargeMarginInterest(account: Portfolio, rules: FinancialRules) {
  const interest = Math.ceil(account.marginDebt * rules.marginDailyRate);
  const paid = Math.min(account.cash, interest);
  account.cash -= paid;
  account.marginDebt += interest - paid;
  account.stats.fees += interest;
  return interest;
}

export function chargeClosingCost(account: Portfolio) {
  const fee = account.closingPayable;
  account.bailoutDebt += fee;
  account.stats.fees += fee;
  account.closingPayable = 0;
  return fee;
}
