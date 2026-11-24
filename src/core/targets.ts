import type { MarketEvent } from '../config/settings';
import type { Random } from './random';

export function marketTargets<T>(style: MarketEvent['target'], ranked: T[], random: Random): T[] {
  switch (style) {
    case 'all': return [...ranked];
    case 'first_place': return ranked.slice(0, 1);
    case 'last_place': return ranked.slice(-1);
    case 'random_one':
    case 'random_two': {
      const pool = [...ranked];
      const result: T[] = [];
      const count = style === 'random_one' ? 1 : 2;
      for (let n = 0; n < count && pool.length; n += 1) {
        result.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
      }
      return result;
    }
  }
}
