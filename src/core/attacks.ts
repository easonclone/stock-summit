import type { FinanceEffect, FinancialConfig, GameCard } from '../config/financial-settings';
import type { DayLedger, Holder } from './settlement';

export type AttackEffect = Extract<FinanceEffect, { type: 'attack' | 'cash_raid' | 'shield_break' }>;

export interface AttackTarget {
  id: string;
  name: string;
  rank: number;
  cash: number;
  stock: number;
  shields: number;
}

export interface AttackRecord {
  from: string;
  to: string;
  kind: AttackEffect['type'];
  amount: number;
  reflected: number;
}

export function attackOf(config: FinancialConfig, card: GameCard | null) {
  return card?.effectIds.map(id => config.effects[id]).find((effect): effect is AttackEffect =>
    effect.type === 'attack' || effect.type === 'cash_raid' || effect.type === 'shield_break') ?? null;
}

export function estimateAttack(effect: AttackEffect, target: AttackTarget) {
  switch (effect.type) {
    case 'attack': return Math.round(target.stock * effect.amount);
    case 'cash_raid': return Math.min(target.cash, effect.amount);
    case 'shield_break': return Number(target.shields > 0);
  }
}

interface Combatant { holder: Holder; ledger: DayLedger; id: string; name: string }
interface Strike { from: Combatant; to: Combatant; effect: AttackEffect }

function transferCash(from: Combatant, to: Combatant, amount: number, reflection = false) {
  from.holder.account.cash -= amount;
  to.holder.account.cash += amount;
  from.ledger.steps.push({ source: 'attack', kind: 'base', id: to.id, name: reflection ? '反擊鏡' : to.name + '掠奪現金', amount: -amount });
  to.ledger.steps.push({ source: 'attack', kind: 'cash', id: from.id, name: reflection ? '反擊鏡' : '掠奪現金', amount });
}

function loseStock(target: Combatant, amount: number, id: string, name: string) {
  target.holder.account.investmentValue -= amount;
  target.holder.account.stats.investmentPnl -= amount;
  target.ledger.attackLoss += amount;
  target.ledger.steps.push({ source: 'attack', kind: 'base', id, name, amount: -amount });
}

/** 先依鎖定後的資產挑出有效攻擊，再套用反擊。反擊不進入直接攻擊佇列。 */
export function resolveAttacks(strikes: Strike[], limit: number): AttackRecord[] {
  const hits = new Map<string, number>();
  const landed = strikes.flatMap(({ from, to, effect }) => {
    const count = hits.get(to.id) ?? 0;
    if (count >= limit) return [];
    const account = to.holder.account;
    const amount = estimateAttack(effect, { id: to.id, name: to.name, rank: 0, cash: account.cash,
      stock: account.investmentValue, shields: to.holder.defenses.length });
    if (!amount) return [];
    hits.set(to.id, count + 1);
    const mirror = effect.type === 'shield_break' ? null : to.holder.memory.mirror;
    if (mirror !== null) to.holder.memory.mirror = null;
    if (effect.type === 'shield_break') {
      to.holder.defenses.shift();
      to.ledger.steps.push({ source: 'attack', kind: 'base', id: from.id, name: from.name + '打破一個護盾', amount: 0 });
    } else if (effect.type === 'cash_raid') {
      to.ledger.attackLoss += amount;
      to.holder.account.cash -= amount;
      // 暫扣現金直到直接攻擊全部鎖定，避免同一筆錢被連環轉走。
    } else loseStock(to, amount, from.id, from.name + '打擊股票');
    return [{ from, to, effect, amount, mirror }];
  });

  for (const { from, to, effect, amount } of landed) {
    if (effect.type !== 'cash_raid') continue;
    to.holder.account.cash += amount;
    transferCash(to, from, amount);
  }

  return landed.map(({ from, to, effect, amount, mirror }) => {
    const proposed = mirror === null ? 0 : Math.round(amount * mirror);
    const reflected = effect.type === 'attack' ? Math.min(proposed, from.holder.account.investmentValue) : proposed;
    if (reflected > 0) {
      if (effect.type === 'cash_raid') {
        transferCash(from, to, reflected, true);
        to.ledger.attackLoss -= reflected;
      } else loseStock(from, reflected, to.id, '反擊鏡');
    }
    return { from: from.id, to: to.id, kind: effect.type, amount, reflected };
  });
}
