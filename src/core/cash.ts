import type { Config, GameMap } from '../config/settings';
import type { Body, Track } from './movement';

type Banknote = GameMap['cash']['bundles'][number] & { y: number; claimed: Set<string> };

export class CashPickups {
  readonly bundles: Banknote[];
  readonly bonusCap: number;

  constructor(track: Track, readonly config: Config['cash']) {
    this.bonusCap = track.map.cash.bonusCap;
    this.bundles = track.map.cash.bundles.map(bundle => ({
      ...bundle, y: track.platforms.get(bundle.platformId)!.y, claimed: new Set()
    }));
  }

  collect(racerId: string, body: Body) {
    let amount = 0;
    for (const bundle of this.bundles) {
      if (bundle.platformId !== body.platformId || Math.abs(bundle.x - body.x) > this.config.pickupRange ||
        bundle.claimed.has(racerId)) continue;
      bundle.claimed.add(racerId);
      amount += bundle.amount;
    }
    return amount;
  }

  bonus(amount: number) {
    return Math.min(this.bonusCap, amount * this.config.layersPerHundred / 100);
  }
}
