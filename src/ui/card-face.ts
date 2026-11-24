import type { FinanceEffect, FinancialConfig, InvestmentKind, TradingCard } from '../config/financial-settings';
import { money, percent } from './format';

/** Short headline number for the card face, derived from the card's first meaningful effect. */
function effectValue(effect: FinanceEffect): string | null {
  switch (effect.type) {
    case 'combo': return effect.mode === 'dividend' ? `股息 +${percent(effect.amount)}` : `漲幅 +${percent(effect.amount)}`;
    case 'hedge': return `擋 ${percent(effect.protection)}`;
    case 'sell': return `賣 ${percent(effect.fraction)}`;
    case 'intel': return `偷看 ${effect.count ?? 1} 則${effect.bonusDraw ? '＋抽牌' : ''}`;
    case 'maintenance': return '對手追繳';
    case 'bailout': return `+${money(effect.amount)}`;
    case 'repay': return `還 ${percent(effect.fraction)}`;
    case 'cash_yield': return `+${percent(effect.rate)}`;
    case 'fee_coupon': return '免開辦費';
    case 'timed':
      if (effect.kind === 'deposit') return `利息 +${percent(effect.amount)}`;
      if (effect.kind === 'stock') return `每日 +${percent(effect.amount)}`;
      if (effect.kind === 'rally') return `漲時 +${percent(effect.amount)}`;
      if (effect.kind === 'short') return '跌變賺';
      return `擋 ${percent(effect.amount)}`;
    case 'route_card': return effect.mode === 'cushion' ? `少賠 ${percent(effect.amount)}` : `盈虧 ×${1 + effect.amount}`;
    case 'cash_grant': return `+${money(effect.amount)}`;
    case 'redeem': return '領回定存';
    case 'card_draft': return '三選一';
    case 'attack': return effect.mode === 'price' ? `對手 −${percent(effect.amount)}` : effect.mode === 'credit' ? '對手禁借' : '對手利息 ×2';
    default: return null;
  }
}

export interface CardFace {
  /** One plain sentence: the first sentence of the card description. */
  line: string;
  value: string;
  /** Investment routes that strengthen this card. */
  pairs: InvestmentKind[];
  /** Short duration label, omitted for "today"/"immediately" which every card already implies. */
  duration: string | null;
  targetsRival: boolean;
}

export function cardFace(config: FinancialConfig, card: TradingCard): CardFace {
  const effects = card.effectIds.map(id => config.effects[id]);
  const value = effects.map(effectValue).find(Boolean) ?? '';
  const tags = new Set([...effects.flatMap(effect => effect.type === 'combo' ? [effect.nodeTag] : []), ...(card.pairing?.tags ?? [])]);
  const pairs = Object.values(config.nodes.kinds).filter(kind => kind.tags.some(tag => tags.has(tag)));
  const line = card.description.split('。')[0].trim() + '。';
  const duration = ['今天', '立即'].includes(card.duration) ? null : card.duration;
  return { line, value, pairs, duration, targetsRival: Boolean(card.opponent) };
}

/** Names of paired routes, shortened to fit a card face. */
export function pairLabel(face: CardFace, limit = 2) {
  if (!face.pairs.length) return '';
  const names = face.pairs.slice(0, limit).map(kind => kind.name);
  return names.join('、') + (face.pairs.length > limit ? ' 等' : '');
}
