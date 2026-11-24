import type { FinancialRules } from '../config/financial-settings';
import { marginLtv, netWorth, repay, sellInvestment, warningReasons, type Portfolio } from './economy';

export interface MarginCall {
  before: number;
  after: number;
  ratio: number;
  threshold: number;
  required: number;
  sold: number;
  paid: number;
  fee: number;
  liquidated: boolean;
  debtLeft: number;
}

export function settleRisk(account: Portfolio, rules: FinancialRules, threshold = rules.callLtv) {
  let call: MarginCall | null = null;
  const ratio = marginLtv(account);
  if (account.marginDebt > 0 && ratio >= threshold) {
    const before = netWorth(account);
    const required = Math.ceil(Math.max(0, account.marginDebt - account.investmentValue * rules.restoredLtv));
    const cashRepayment = repay(account, required, true).margin;
    const liquidated = cashRepayment < required && account.investmentValue > 0;
    const sold = liquidated ? sellInvestment(account, 1) : 0;
    const fee = Math.round(sold * rules.liquidationFee);
    account.cash -= fee;
    account.stats.fees += fee;
    const paid = cashRepayment + (liquidated ? repay(account, sold - fee, true).margin : 0);
    call = { before, after: netWorth(account), ratio, threshold, required, sold, paid,
      fee, liquidated, debtLeft: account.marginDebt };
    account.stats.marginCalls += 1;
    account.stats.liquidations += Number(liquidated);
  }

  const warnings = warningReasons(account, rules);
  account.stats.warnings += Number(warnings.length > 0);
  account.financialStatus = netWorth(account) <= 0 ? 'bankruptcy' : call ? 'margin_call' : warnings.length ? 'warning' : 'normal';
  return { call, warnings, insolvent: account.financialStatus === 'bankruptcy' };
}
