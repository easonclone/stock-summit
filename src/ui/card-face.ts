import type { AllocationOption, FinanceEffect, FinancialConfig, TradingCard } from '../config/financial-settings';
import { money, percent } from './format';

/** Short headline number for the card face, derived from the card's first meaningful effect. */
function effectValue(effect: FinanceEffect): string | null {
  switch (effect.type) {
    case 'combo': return effect.mode === 'dividend' ? `股息 +${percent(effect.amount)}` : `漲幅 +${percent(effect.amount)}`;
    case 'hedge': return `擋 ${percent(effect.protection)}`;
    case 'intel': return `偷看 ${effect.count ?? 1} 則${effect.bonusDraw ? '＋抽牌' : ''}`;
    case 'cash_yield': return `+${percent(effect.rate)}`;
    case 'timed':
      if (effect.kind === 'cash') return `現金 +${percent(effect.amount)}/日`;
      if (effect.kind === 'stock') return `每日 +${percent(effect.amount)}`;
      if (effect.kind === 'rally') return `漲時 +${percent(effect.amount)}`;
      if (effect.kind === 'short') return '跌變賺';
      return `擋 ${percent(effect.amount)}`;
    case 'route_card': return effect.mode === 'cushion' ? `少賠 ${percent(effect.amount)}` : `盈虧 ×${1 + effect.amount}`;
    case 'cash_grant': return `+${money(effect.amount)}`;
    case 'card_draft': return '三選一';
    case 'attack': return `對手 −${percent(effect.amount)}`;
    default: return null;
  }
}

export interface CardFace {
  /** One plain sentence: the first sentence of the card description. */
  line: string;
  value: string;
  /** Stock ratios that trigger this card's combo. */
  pairs: AllocationOption[];
  /** Short duration label, omitted for "today"/"immediately" which every card already implies. */
  duration: string | null;
  targetsRival: boolean;
}

export function cardFace(config: FinancialConfig, card: TradingCard): CardFace {
  const effects = card.effectIds.map(id => config.effects[id]);
  const value = effects.map(effectValue).find(Boolean) ?? '';
  const tags = new Set([...effects.flatMap(effect => effect.type === 'combo' ? [effect.nodeTag] : []), ...(card.pairing?.tags ?? [])]);
  const pairs = config.allocation.options.filter(option => option.tags.some(tag => tags.has(tag)));
  const line = card.description.split('。')[0].trim() + '。';
  const duration = ['今天', '立即'].includes(card.duration) ? null : card.duration;
  return { line, value, pairs, duration, targetsRival: Boolean(card.opponent) };
}

/** Names of paired stock ratios, shortened to fit a card face. */
export function pairLabel(face: CardFace, limit = 2) {
  if (!face.pairs.length) return '';
  const names = face.pairs.slice(0, limit).map(kind => kind.name);
  return names.join('、') + (face.pairs.length > limit ? ' 等' : '');
}
