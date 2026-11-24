import type { FinancialRules } from '../config/financial-settings';
import { netWorth, sellInvestment, type Portfolio } from './economy';

export interface RecoveryAudit {
  before: number;
  after: number;
  proceeds: number;
  recoveryCash: number;
}

export function canRecover(account: Portfolio, day: number, lastDay: number, rules: FinancialRules) {
  return day < lastDay && account.bankruptcyCount < rules.maxRecoveries;
}

export function declareBankruptcy(account: Portfolio) {
  account.bankruptcyCount += 1;
  account.financialStatus = 'bankruptcy';
}

/** 第一次歸零：拿一筆不用還的翻身資金重新開始；第二次歸零就出局。 */
export function recoverPortfolio(account: Portfolio, rules: FinancialRules): RecoveryAudit {
  const before = netWorth(account);
  const proceeds = sellInvestment(account, 1);
  account.cash = rules.recoveryCash;
  account.investmentValue = 0;
  account.financialStatus = 'normal';
  return { before, after: netWorth(account), proceeds, recoveryCash: rules.recoveryCash };
}
