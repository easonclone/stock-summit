import type { Effect, Tone } from '../config/settings';
import type { Body, Track } from './movement';

/** Turn-based status. Every `…Until` value is an exclusive turn number. */
export interface EffectState {
  shield: number;
  lossLimit: number | null;
  freezeUntil: number;
  momentumUntil: number;
  momentum: number;
  exposure: number;
  revealsEvent: boolean;
}

export interface EffectTarget {
  body: Body;
  status: EffectState;
  cash: number;
}

export type EffectSource = 'market' | 'card' | 'node';

export function freshEffects(): EffectState {
  return { shield: 0, lossLimit: null, freezeUntil: 0, momentumUntil: 0, momentum: 0, exposure: 1, revealsEvent: false };
}

export function harmful(effect: Effect) {
  return effect.type === 'freeze' || effect.type === 'cash_loss_or_freeze' || (effect.type === 'displacement' && effect.layers < 0);
}

export function toneOf(effects: Effect[]): Tone {
  if (effects.some(harmful)) return 'negative';
  if (effects.some(effect => effect.type === 'displacement' || effect.type === 'momentum' || effect.type === 'cash_gain')) return 'positive';
  return 'neutral';
}

/** Applies effects at turn `turn`. Market losses use up a shield charge, then any leverage exposure doubles the drop. */
export function applyEffects(target: EffectTarget, effects: Effect[], track: Track, turn: number, source: EffectSource) {
  const status = target.status;
  const shielded = source === 'market' && status.shield > 0 && effects.some(harmful);
  const messages: string[] = [];
  let layersMoved = 0;
  let cashChange = 0;
  const freeze = (turns: number) => {
    status.freezeUntil = Math.max(status.freezeUntil, turn + turns);
    messages.push(`停牌 ${status.freezeUntil - turn} 回合`);
  };
  if (shielded) {
    status.shield -= 1;
    messages.push('避險抵銷利空');
  }

  for (const effect of effects) {
    if (shielded && harmful(effect)) continue;
    switch (effect.type) {
      case 'displacement': {
        let layers = effect.layers;
        if (layers < 0 && source === 'market' && status.exposure > 1) {
          layers = Math.round(layers * status.exposure);
          status.exposure = 1;
          messages.push('槓桿放大跌幅');
        }
        if (layers < 0 && status.lossLimit !== null) {
          layers = Math.max(layers, -status.lossLimit);
          status.lossLimit = null;
          messages.push('啟動停損');
        }
        const applied = track.displace(target.body, layers);
        layersMoved += applied;
        messages.push(applied > 0 ? `上升 ${applied} 層` :
          applied < 0 ? `下滑 ${-applied} 層` : '已達山頂或山腳，原地持平');
        break;
      }
      case 'momentum':
        status.momentum = effect.layers;
        status.momentumUntil = turn + effect.turns;
        messages.push(`接下來 ${effect.turns} 回合每次多爬 ${effect.layers} 層`);
        break;
      case 'cash_loss_or_freeze':
        if (target.cash >= effect.amount) {
          target.cash -= effect.amount;
          cashChange -= effect.amount;
          messages.push(`扣除 ${effect.amount} 元`);
        } else {
          freeze(effect.turns);
        }
        break;
      case 'cash_gain':
        target.cash += effect.amount;
        cashChange += effect.amount;
        messages.push(`入帳 ${effect.amount} 元`);
        break;
      case 'exposure':
        status.exposure = Math.max(status.exposure, effect.multiplier);
        messages.push(`槓桿曝險 ×${status.exposure}`);
        break;
      case 'freeze':
        freeze(effect.turns);
        break;
      case 'shield':
        status.shield += effect.charges;
        messages.push(`避險次數 +${effect.charges}（共 ${status.shield} 次）`);
        break;
      case 'reveal_next_event':
        status.revealsEvent = true;
        messages.push('取得下一次市場預告');
        break;
      case 'limit_loss':
        status.lossLimit = effect.layers;
        messages.push(`下次下滑最多 ${effect.layers} 層`);
        break;
      case 'clear_negative': {
        const cleared = status.freezeUntil > turn;
        status.freezeUntil = 0;
        messages.push(cleared ? '已解除停牌' : '目前沒有停牌');
        break;
      }
    }
  }
  return { shielded, layersMoved, cashChange, messages };
}
