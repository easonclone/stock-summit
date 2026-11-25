import type { FinanceEffect, FinancialConfig, GameCard } from '../config/financial-settings';
import { netWorth } from './economy';
import { addCash, jokerEffect, type DayLedger, type Holder } from './settlement';

export type SacrificeAttack = Extract<FinanceEffect, { type: 'sacrifice_attack' }>;
type SacrificeEffect = SacrificeAttack | Extract<FinanceEffect, { type: 'sacrifice_draw' | 'attack' }>;

export function sacrificeCost(holder: Holder, day: number, effect: SacrificeEffect, stock = holder.account.investmentValue) {
  if (holder.memory.sacrificeDay === day) return 0;
  const worth = netWorth(holder.account);
  const fromStock = effect.type === 'attack';
  const basis = fromStock ? stock : worth;
  const cost = Math.round(basis * (effect.type === 'attack' ? effect.amount : effect.rate));
  return Math.max(0, Math.min(worth - 1, basis, cost));
}

export function sacrificeDamage(config: FinancialConfig, holder: Holder, cost: number, factor: number, highest: boolean, area: boolean) {
  const boost = area ? jokerEffect(holder, config, 'sacrifice_amplify')?.effect.rate ?? 0 : 0;
  const leader = highest ? jokerEffect(holder, config, 'sacrifice_leader')?.effect.rate ?? 0 : 0;
  return Math.round(cost * factor * (1 + boost) * (1 + leader));
}

export function sacrificeRefund(config: FinancialConfig, holder: Holder, cost: number) {
  const rate = jokerEffect(holder, config, 'sacrifice_refund')?.effect.rate ?? 0;
  return Math.max(0, Math.min(cost - 1, Math.round(cost * rate)));
}

export function paySacrifice(holder: Holder, config: FinancialConfig, day: number, ledger: DayLedger, card: GameCard, effect: SacrificeEffect) {
  const cost = sacrificeCost(holder, day, effect);
  if (!cost) return 0;
  const { account, memory } = holder;
  const cash = effect.type === 'attack' ? 0 : Math.min(account.cash, cost);
  const stock = cost - cash;
  account.cash -= cash;
  account.investmentValue -= stock;
  account.stats.investmentPnl -= stock;
  memory.sacrificeDay = day;
  if (jokerEffect(holder, config, 'sacrifice_rebirth') && day < config.gameplay.turns) memory.rebirthDay = day + 1;
  ledger.steps.push({ source: 'sacrifice', id: card.id, name: card.name, kind: 'base', amount: -cost });
  const refundAmount = sacrificeRefund(config, holder, cost);
  memory.sacrificePaymentRoom = cost - 1 - refundAmount;
  const refund = jokerEffect(holder, config, 'sacrifice_refund');
  if (refund) addCash(holder, ledger, { source: 'joker', id: refund.joker.id, name: refund.joker.name }, refundAmount);
  return cost;
}
