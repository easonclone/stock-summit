import type { FinancialRules } from '../config/financial-settings';
import { debtBalance, depositBalance, netWorth, repay, sellInvestment, type Portfolio } from './economy';

export interface RecoveryAudit {
  before: number;
  after: number;
  proceeds: number;
  marginPaid: number;
  bailoutPaid: number;
  marginForgiven: number;
  bailoutForgiven: number;
  recoveryCash: number;
  recoveryDebt: number;
  closingFee: number;
  restrictionDays: number;
}

export function canRecover(account: Portfolio, day: number, lastDay: number, rules: FinancialRules) {
  return day < lastDay && account.bankruptcyCount < rules.maxRecoveries;
}

export function declareBankruptcy(account: Portfolio) {
  account.bankruptcyCount += 1;
  account.financialStatus = 'bankruptcy';
}

export function recoverPortfolio(account: Portfolio, day: number, rules: FinancialRules): RecoveryAudit {
  const before = netWorth(account);
  const proceeds = sellInvestment(account, 1) + depositBalance(account);
  account.cash += depositBalance(account);
  account.deposits = [];
  const paid = repay(account, account.cash);
  const marginForgiven = account.marginDebt;
  const bailoutForgiven = account.bailoutDebt;
  account.stats.debtForgiven += debtBalance(account);
  account.cash = rules.recoveryCash;
  account.marginDebt = 0;
  account.bailoutDebt = rules.recoveryDebt;
  account.closingPayable = rules.recoveryClosingFee;
  account.leverageRestrictedUntil = day + rules.recoveryLockDays;
  account.financialStatus = 'warning';
  return { before, after: netWorth(account), proceeds, marginPaid: paid.margin, bailoutPaid: paid.bailout,
    marginForgiven, bailoutForgiven, recoveryCash: account.cash, recoveryDebt: account.bailoutDebt,
    closingFee: account.closingPayable, restrictionDays: rules.recoveryLockDays };
}
