import type { FinancialConfig, GameCard } from '../config/financial-settings';

export function itemTiming(config: FinancialConfig, card: GameCard): 'instant' | 'action' | 'defense' {
  const types = card.effectIds.map(id => config.effects[id].type);
  if (types.some(type => type === 'mirror' || type === 'defense')) return 'defense';
  if (types.some(type => ['cash_grant', 'relief', 'intel', 'item_pack', 'generate', 'random_cash', 'voucher'].includes(type))) return 'instant';
  return 'action';
}

export function generatesItems(config: FinancialConfig, card: GameCard) {
  return card.effectIds.some(id => ['item_pack', 'generate'].includes(config.effects[id].type));
}

export function soldInShop(config: FinancialConfig, card: GameCard) {
  return !card.effectIds.some(id => ['cash_grant', 'random_cash', 'voucher'].includes(config.effects[id].type));
}
