import { netWorth, type Portfolio } from './economy';

/** V3.1 沒有借款與追繳：收盤只檢查總身家是否歸零。 */
export function settleRisk(account: Portfolio) {
  const insolvent = netWorth(account) <= 0;
  account.financialStatus = insolvent ? 'bankruptcy' : 'normal';
  return { insolvent };
}
