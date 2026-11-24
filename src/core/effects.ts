import type { Effect, Tone } from '../config/settings';
import type { Body, Track } from './movement';

export interface EffectState {
  shield: number;
  lossLimit: number | null;
  freezeUntil: number;
  boostUntil: number;
  speed: number;
  revealsEvent: boolean;
}

export interface EffectTarget {
  body: Body;
  status: EffectState;
  cash: number;
}

export function freshEffects(): EffectState {
  return { shield: 0, lossLimit: null, freezeUntil: 0, boostUntil: 0, speed: 1, revealsEvent: false };
}

export function harmful(effect: Effect) {
  return effect.type === 'freeze' || effect.type === 'cash_loss_or_freeze' || (effect.type === 'displacement' && effect.layers < 0) ||
    (effect.type === 'speed_modifier' && effect.multiplier < 1);
}

export function toneOf(effects: Effect[]): Tone {
  if (effects.some(harmful)) return 'negative';
  if (effects.some(effect => effect.type === 'displacement' || effect.type === 'speed_modifier')) return 'positive';
  return 'neutral';
}

export function applyEffects(
  target: EffectTarget, effects: Effect[], track: Track, now: number, source: 'market' | 'card' | 'obstacle'
) {
  const status = target.status;
  const shielded = source === 'market' && status.shield > 0 && effects.some(harmful);
  const messages: string[] = [];
  let layersMoved = 0;
  const freeze = (durationMs: number) => {
    status.freezeUntil = Math.max(status.freezeUntil, now + durationMs);
    messages.push(`暫停移動 ${Math.round((status.freezeUntil - now) / 100) / 10} 秒`);
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
        if (layers < 0 && status.lossLimit !== null) {
          layers = Math.max(layers, -status.lossLimit);
          status.lossLimit = null;
          messages.push('啟動停損');
        }
        const applied = track.displace(target.body, layers);
        layersMoved += applied;
        messages.push(applied > 0 ? `上升 ${applied} 層` :
          applied < 0 ? `下滑 ${-applied} 層` : '已達賽道邊界，原地持平');
        break;
      }
      case 'speed_modifier':
        status.speed = effect.multiplier;
        status.boostUntil = now + effect.durationMs;
        const changePercent = Math.round((effect.multiplier - 1) * 100);
        messages.push(`移動速度 ${changePercent >= 0 ? '+' : ''}${changePercent}%，維持 ${effect.durationMs / 1000} 秒`);
        break;
      case 'cash_loss_or_freeze':
        if (target.cash >= effect.amount) {
          target.cash -= effect.amount;
          messages.push(`扣除 ${effect.amount} 元`);
        } else {
          freeze(effect.durationMs);
        }
        break;
      case 'freeze':
        freeze(effect.durationMs);
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
      case 'clear_negative':
        const cleared = status.freezeUntil > now || (status.speed < 1 && status.boostUntil > now);
        status.freezeUntil = 0;
        if (status.speed < 1) status.boostUntil = 0;
        messages.push(cleared ? '已解除負面狀態' : '目前無負面狀態');
        break;
    }
  }
  return { shielded, layersMoved, messages };
}
