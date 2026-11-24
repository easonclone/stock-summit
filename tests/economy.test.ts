import { describe, expect, it } from 'vitest';
import { financialInput, readFinancialConfig } from '../src/config/financial-settings';
import { canRecover, declareBankruptcy, recoverPortfolio } from '../src/core/bankruptcy';
import {
  chargeClosingCost, collectDeposits, depositBalance, invest, investmentOrder, lockDeposit,
  netWorth, openPortfolio, repay, revalue, sellInvestment
} from '../src/core/economy';
import { settleRisk } from '../src/core/financial-risk';

const rules = readFinancialConfig().financial;

describe('財務資料驗證', () => {
  it('指出無效的卡片與節點效果引用及沒有正淨值的重整設定', () => {
    const invalid = structuredClone(financialInput);
    invalid.nodes.kinds.steady.effectIds = ['missing'];
    expect(() => readFinancialConfig(invalid)).toThrow(/steady.*missing/);
    expect(() => readFinancialConfig({ ...financialInput, financial: { ...rules, recoveryCash: 1500 } })).toThrow(/正淨資產/);
  });
});

describe('資產守恆', () => {
  it('買進、賣出、存入與返還本金只轉移資產；利息各結算一次', () => {
    const account = openPortfolio(10000);
    invest(account, investmentOrder(account, 0.5, 0, 1, rules));
    sellInvestment(account, 0.5);
    expect(netWorth(account)).toBe(10000);
    expect(lockDeposit(account, 0.5, 1, rules)).toBe(3750);
    expect(netWorth(account)).toBe(10000);
    const dailyInterest = Math.round(3750 * rules.depositDailyRate);
    for (let day = 2; day <= 4; day++) expect(collectDeposits(account, day, rules)).toBe(dailyInterest);
    expect(collectDeposits(account, 5, rules)).toBe(0);
    expect(depositBalance(account)).toBe(0);
    expect(netWorth(account)).toBe(10000 + 3 * dailyInterest);
  });

  it('融資只在部位與負債成對入帳，自有資產還款不會增加淨資產', () => {
    const account = openPortfolio(10000);
    const order = investmentOrder(account, 0.8, 5, 1, rules);
    expect(order.borrowed).toBeGreaterThan(0);
    expect(order.borrowed).toBeLessThan(40000);
    invest(account, order);
    expect(account.investmentValue).toBe(order.stake + order.borrowed);
    expect(netWorth(account)).toBe(10000 - order.fee);
    const change = revalue(account, -0.2);
    expect(netWorth(account)).toBe(10000 - order.fee + change);
    repay(account, account.cash + 100000);
    expect(account.cash).toBe(0);
    expect(netWorth(account)).toBe(10000 - order.fee + change);
  });
});

describe('財務危機', () => {
  it('現金足夠時補繳至維持目標；不足則平倉，保留未償債務', () => {
    const cash = { ...openPortfolio(10000), cash: 3000, investmentValue: 5000, marginDebt: 4500 };
    const safe = settleRisk(cash, rules);
    expect(safe.call).toMatchObject({ required: 1300, paid: 1300, sold: 0, liquidated: false, before: 3500, after: 3500 });
    const debt = { ...openPortfolio(10000), cash: 0, investmentValue: 2000, marginDebt: 4000 };
    const liquidated = settleRisk(debt, rules);
    expect(liquidated.call).toMatchObject({ sold: 2000, paid: 1930, fee: 70, after: -2070, debtLeft: 2070 });
    expect(liquidated.insolvent).toBe(true);
    expect(debt.cash).toBe(0);
  });

  it('重整前先清償，記錄減免，正淨值重開，第二次及收盤日不重整', () => {
    const account = { ...openPortfolio(10000), cash: 50, investmentValue: 200, marginDebt: 1000, bailoutDebt: 400 };
    account.deposits.push({ balance: 100, maturity: 4 });
    expect(canRecover(account, 3, 15, rules)).toBe(true);
    expect(canRecover(account, 15, 15, rules)).toBe(false);
    declareBankruptcy(account);
    expect(recoverPortfolio(account, 3, rules)).toMatchObject({
      before: -1050, after: 500, proceeds: 300, marginPaid: 350, marginForgiven: 650, bailoutForgiven: 400, closingFee: 500
    });
    expect(account.stats.debtForgiven).toBe(1050);
    expect(account.leverageRestrictedUntil).toBe(5);
    expect(investmentOrder(account, 1, 1, 4, rules).borrowed).toBe(0);
    expect(canRecover(account, 4, 15, rules)).toBe(false);
    expect(chargeClosingCost(account)).toBe(500);
    expect(chargeClosingCost(account)).toBe(0);
    expect(netWorth(account)).toBe(0);
  });
});
