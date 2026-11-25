import type { FinanceEffect, FinancialConfig, GameCard } from '../config/financial-settings';
import { jokerEffect, type DayLedger, type Holder } from './settlement';

export type AttackEffect = Extract<FinanceEffect, { type: 'attack' | 'cash_raid' | 'shield_break' | 'area_attack' | 'sacrifice_attack' }>;

export interface AttackTarget {
  id: string;
  name: string;
  rank: number;
  cash: number;
  stock: number;
  shields: number;
  guard?: number;
}

export interface AttackRecord {
  from: string;
  to: string;
  kind: AttackEffect['type'];
  amount: number;
  reflected: number;
  counterName?: string;
  slot: number;
  /** The item that made the attack and the 雙重打擊 multiplier applied. Record only, for the presentation. */
  itemId: string;
  factor: number;
  sacrifice?: boolean;
}

/** Why a locked attack did not land. Record only: written while resolving, never read back by the rules. */
export type MissReason = 'limit' | 'no_stock' | 'no_cash' | 'no_shield' | 'capped';
export interface AttackMiss { from: string; to: string; kind: AttackEffect['type']; slot: number; itemId: string; reason: MissReason }

export function attackOf(config: FinancialConfig, card: GameCard | null) {
  return card?.effectIds.map(id => config.effects[id]).find((effect): effect is AttackEffect =>
    effect.type === 'attack' || effect.type === 'cash_raid' || effect.type === 'shield_break' || effect.type === 'area_attack' || effect.type === 'sacrifice_attack') ?? null;
}

export function isAreaAttack(effect: AttackEffect | null) {
  return effect?.type === 'area_attack' || (effect?.type === 'sacrifice_attack' && effect.area);
}

export function estimateAttack(effect: AttackEffect, target: AttackTarget) {
  switch (effect.type) {
    case 'area_attack': case 'attack': return Math.round(target.stock * effect.amount);
    case 'sacrifice_attack': return 0;
    case 'cash_raid': return Math.min(Math.round(target.cash * effect.rate), effect.amount);
    case 'shield_break': return target.shields ? Math.min(target.stock, effect.amount) : 0;
  }
}

interface Combatant { holder: Holder; ledger: DayLedger; id: string; name: string; start: number }
interface Strike { from: Combatant; to: Combatant; effect: AttackEffect; slot: number; factor: number; itemId: string; sacrificeDamage?: number }

function transferCash(from: Combatant, to: Combatant, amount: number, counterName?: string) {
  from.holder.account.cash -= amount;
  to.holder.account.cash += amount;
  from.ledger.steps.push({ source: 'attack', kind: 'base', id: to.id, name: counterName ?? to.name + '掠奪現金', amount: -amount });
  to.ledger.steps.push({ source: 'attack', kind: 'cash', id: from.id, name: counterName ?? '掠奪現金', amount });
}

function loseStock(target: Combatant, amount: number, id: string, name: string) {
  target.holder.account.investmentValue -= amount;
  target.holder.account.stats.investmentPnl -= amount;
  target.ledger.attackLoss += amount;
  target.ledger.steps.push({ source: 'attack', kind: 'base', id, name, amount: -amount });
}

/** 先依鎖定後的資產挑出有效攻擊，再套用反擊。反擊不進入直接攻擊佇列。 */
export function resolveAttacks(strikes: Strike[], rules: FinancialConfig['settlement'], misses: AttackMiss[] = [], config?: FinancialConfig): AttackRecord[] {
  const hits = new Map<string, number>();
  const losses = new Map<string, number>();
  const pairs = new Set<string>();
  const retaliated = new Set<string>();
  const landed = strikes.flatMap(({ from, to, effect, slot, factor, itemId, sacrificeDamage }) => {
    const count = hits.get(to.id) ?? 0;
    const pair = from.id + ':' + to.id;
    const miss = (reason: MissReason) => { misses.push({ from: from.id, to: to.id, kind: effect.type, slot, itemId, reason }); return []; };
    if (count >= rules.attacksPerTarget || pairs.has(pair)) return miss('limit');
    const account = to.holder.account;
    const estimate = estimateAttack(effect, { id: to.id, name: to.name, rank: 0, cash: account.cash,
      stock: account.investmentValue, shields: to.holder.defenses.length });
    const ceiling = Math.max(0, Math.floor(to.start * rules.attackLossLimit) - (losses.get(to.id) ?? 0));
    const boost = config && effect.type === 'attack' ? jokerEffect(from.holder, config, 'stock_strike')?.effect.rate ?? 0 : 0;
    const guard = config ? jokerEffect(to.holder, config, 'attack_guard')?.effect.rate ?? 0 : 0;
    const sacrifice = sacrificeDamage !== undefined;
    const proposed = sacrificeDamage ?? estimate * factor * (1 + boost);
    const assets = sacrifice ? account.cash + account.investmentValue : effect.type === 'cash_raid' ? account.cash : account.investmentValue;
    const amount = Math.min(ceiling, Math.round(proposed * (1 - guard)), assets);
    if (effect.type === 'shield_break' && !to.holder.defenses.length) return miss('no_shield');
    if (effect.type !== 'shield_break' && !amount) {
      const empty = !sacrifice && (effect.type === 'cash_raid' ? account.cash <= 0 : account.investmentValue <= 0);
      return miss(empty ? (effect.type === 'cash_raid' ? 'no_cash' : 'no_stock') : 'capped');
    }
    pairs.add(pair);
    losses.set(to.id, (losses.get(to.id) ?? 0) + amount);
    hits.set(to.id, count + 1);
    const mirror = sacrifice || effect.type === 'shield_break' || effect.type === 'area_attack' ? null : to.holder.memory.mirror;
    const singleHit = !sacrifice && amount > 0 && (effect.type === 'attack' || effect.type === 'cash_raid');
    const revenge = config && singleHit && mirror === null && !retaliated.has(to.id)
      ? jokerEffect(to.holder, config, 'retaliate') : undefined;
    if (mirror !== null) to.holder.memory.mirror = null;
    if (singleHit) retaliated.add(to.id);
    if (sacrifice) {
      const stock = Math.min(amount, account.investmentValue);
      if (stock) loseStock(to, stock, from.id, from.name + '獻祭衝擊');
      const cash = amount - stock;
      if (cash) {
        account.cash -= cash;
        to.ledger.attackLoss += cash;
        to.ledger.steps.push({ source: 'attack', kind: 'base', id: from.id, name: from.name + '獻祭衝擊', amount: -cash });
      }
    } else if (effect.type === 'shield_break') {
      to.holder.defenses.shift();
      if (amount) loseStock(to, amount, from.id, '破盾一擊');
      to.ledger.steps.push({ source: 'attack', kind: 'base', id: from.id, name: from.name + '打破一個護盾', amount: 0 });
    } else if (effect.type === 'cash_raid') {
      to.ledger.attackLoss += amount;
      to.holder.account.cash -= amount;
      // 暫扣現金直到直接攻擊全部鎖定，避免同一筆錢被連環轉走。
    } else loseStock(to, amount, from.id, from.name + '打擊股票');
    return [{ from, to, effect, amount, mirror, revenge, slot, factor, itemId, sacrifice }];
  });

  for (const { from, to, effect, amount } of landed) {
    if (effect.type !== 'cash_raid') continue;
    to.holder.account.cash += amount;
    transferCash(to, from, amount);
  }

  return landed.map(({ from, to, effect, amount, mirror, revenge, slot, factor, itemId, sacrifice }) => {
    const rate = mirror ?? revenge?.effect.rate ?? 0;
    const proposed = Math.min(rules.reflectionCap, revenge?.effect.cap ?? Infinity, Math.round(amount * rate));
    const reflected = effect.type === 'attack' ? Math.min(proposed, from.holder.account.investmentValue) : proposed;
    const counterName = revenge?.joker.name ?? '反擊鏡';
    if (reflected > 0) {
      if (effect.type === 'cash_raid') {
        transferCash(from, to, reflected, counterName);
        to.ledger.attackLoss -= reflected;
      } else loseStock(from, reflected, to.id, counterName);
    }
    return { from: from.id, to: to.id, kind: effect.type, amount, reflected, slot, itemId, factor, ...(sacrifice && { sacrifice }), ...(revenge && reflected > 0 && { counterName }) };
  });
}
