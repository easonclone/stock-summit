import type { FinanceEffect, FinancialConfig, GameCard } from '../config/financial-settings';
import { money, percent } from './format';

/** Short headline number for a card face, read from the card's first effect. */
function effectBadge(effect: FinanceEffect): string {
  switch (effect.type) {
    case 'gain_add': case 'rebound_add': case 'today_add': return `+${percent(effect.amount)}`;
    case 'streak_add': return `最多 +${percent(effect.cap)}`;
    case 'joker_add': return `每張 +${percent(effect.amount)}`;
    case 'news_mult': case 'repeat_mult': case 'swing_mult': case 'today_mult': return `×${effect.factor}`;
    case 'yield_boost': return `收益 ×${effect.factor}`;
    case 'loss_cut': return `少賠 ${percent(effect.amount)}`;
    case 'cash_yield': case 'stock_yield': return `每天 ${percent(effect.rate)}`;
    case 'stock_cash': return `領 ${percent(effect.rate)}`;
    case 'defense': return effect.mode === 'cut' ? `少賠 ${percent(effect.amount)}` : effect.mode === 'absorb' ? `擋 ${money(effect.amount)}` : '跌變賺';
    case 'cash_grant': case 'bear_bonus': case 'item_bonus': case 'attack_bonus': case 'hold_bonus': case 'climb_bonus': case 'relief':
      return `+${money(effect.amount)}`;
    case 'news_item': case 'item_grant': return '+道具';
    case 'shop_discount': return `${Math.round((1 - effect.rate) * 10)} 折`;
    case 'intel': return '偷看';
    case 'item_pack': return `${effect.count} 選 1`;
    case 'attack': return `對手 −${percent(effect.amount)}`;
    case 'price': return '';
  }
}

export function cardBadge(config: FinancialConfig, card: GameCard) {
  return card.effectIds.map(id => effectBadge(config.effects[id])).find(Boolean) ?? '';
}

export const rarityLabel: Record<GameCard['rarity'], string> = { common: '普通', rare: '稀有', legendary: '傳說' };
