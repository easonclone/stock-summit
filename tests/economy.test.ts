import { describe, expect, it } from 'vitest';
import { financialInput, readFinancialConfig } from '../src/config/financial-settings';
import { canRecover, declareBankruptcy, recoverPortfolio } from '../src/core/bankruptcy';
import { netWorth, openPortfolio, rebalance, revalue, sellInvestment } from '../src/core/economy';
import { settleRisk } from '../src/core/financial-risk';

const config = readFinancialConfig();
const rules = config.financial;

describe('財務資料驗證', () => {
  it('指出無效的效果引用、會直接改股價的節點與不存在的起始配置', () => {
    const invalid = structuredClone(financialInput);
    invalid.nodes.kinds.steady.effectIds = ['missing'];
    expect(() => readFinancialConfig(invalid)).toThrow(/steady.*missing/);
    const priced = structuredClone(financialInput);
    priced.nodes.kinds.steady.effectIds = ['market_day'];
    expect(() => readFinancialConfig(priced)).toThrow(/不得直接改變股價/);
    expect(() => readFinancialConfig({ ...financialInput, allocation: { ...financialInput.allocation, initial: 'nope' } })).toThrow(/起始資產配置/);
  });

  it('預設遊戲只有三種配置，沒有借款或費用設定', () => {
    expect(config.allocation.options.map(option => option.ratio)).toEqual([0, 0.5, 1]);
    expect(Object.keys(rules).sort()).toEqual(['initialCapital', 'maxHedges', 'maxRecoveries', 'recoveryCash', 'recoveryGap']);
    expect(Object.values(config.effects).some(effect => ['bailout', 'repay', 'maintenance', 'fee_coupon'].includes(effect.type as string))).toBe(false);
  });
});

describe('資產守恆', () => {
  it('配置只是現金與股票互換，總身家不變、沒有手續費', () => {
    const account = openPortfolio(10000);
    for (const ratio of [0.5, 1, 0, 1, 0.5]) {
      rebalance(account, ratio);
      expect(netWorth(account)).toBe(10000);
      expect(account.cash).toBeGreaterThanOrEqual(0);
    }
    expect(account.investmentValue).toBe(5000);
    expect(rebalance(account, 3).ratio).toBe(1);
    expect(account).toMatchObject({ cash: 0, investmentValue: 10000 });
  });

  it('股票最多跌到零，不會產生負股票或欠款', () => {
    const account = openPortfolio(10000);
    rebalance(account, 1);
    expect(revalue(account, -1.8)).toBe(-10000);
    expect(account.investmentValue).toBe(0);
    expect(netWorth(account)).toBe(0);
    expect(sellInvestment(account, 1)).toBe(0);
  });
});

describe('歸零與翻身', () => {
  it('總身家歸零才算破產；第一次拿不用還的翻身資金，第二次及最後一日不能翻身', () => {
    const account = { ...openPortfolio(10000), cash: 0, investmentValue: 0 };
    expect(settleRisk(account).insolvent).toBe(true);
    expect(canRecover(account, 3, 15, rules)).toBe(true);
    expect(canRecover(account, 15, 15, rules)).toBe(false);
    declareBankruptcy(account);
    expect(recoverPortfolio(account, rules)).toMatchObject({ before: 0, after: rules.recoveryCash, recoveryCash: rules.recoveryCash });
    expect(netWorth(account)).toBe(rules.recoveryCash);
    expect(canRecover(account, 4, 15, rules)).toBe(false);
    expect(settleRisk(account).insolvent).toBe(false);
  });
});
