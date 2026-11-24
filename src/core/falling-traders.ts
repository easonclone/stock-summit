import type { Config } from '../config/settings';
import { clamp, type Body, type Track } from './movement';
import type { Random } from './random';

interface Trader {
  x: number;
  top: number;
  ground: number;
  startsAt: number;
  endsAt: number;
  y: number;
}

export class FallingTraders {
  active: Trader[] = [];
  private readonly hitThisWave = new Set<Body>();
  private nextAt: number;

  constructor(
    private readonly track: Track,
    readonly config: Config['fallingTraders'],
    private readonly hitbox: Config['physics']['hitbox'],
    private readonly random: Random
  ) {
    this.nextAt = this.interval();
  }

  private interval() {
    const [min, max] = this.config.intervalMs;
    return min + (max - min) * this.random();
  }

  private schedule(time: number, bodies: Body[]) {
    const target = bodies[Math.floor(this.random() * bodies.length)];
    const platform = this.track.platforms.get(target.platformId ?? '') ?? this.track.map.platforms[this.track.layerAt(target.y)];
    const { width, spread, spawnHeight, warningMs, speed } = this.config;
    const halfWidth = Math.min(width, platform.width) / 2;
    const x = clamp(target.x + (this.random() - .5) * spread, platform.x + halfWidth, platform.x + platform.width - halfWidth);
    const ground = platform.y;
    const top = Math.max(0, ground - spawnHeight);
    const startsAt = time + warningMs;
    const endsAt = startsAt + (ground - top) / speed * 1000;
    const { doubleChance, laneSpacing } = this.config;
    const lanes = [x];
    if (this.random() < doubleChance) {
      const alternatives = [x - laneSpacing, x + laneSpacing].filter(candidate =>
        candidate >= platform.x + halfWidth && candidate <= platform.x + platform.width - halfWidth);
      if (alternatives.length) lanes.push(alternatives[Math.floor(this.random() * alternatives.length)]);
    }
    this.hitThisWave.clear();
    this.active = lanes.map(lane => ({ x: lane, top, ground, startsAt, endsAt, y: top }));
  }

  step(time: number, bodies: Body[]) {
    if (!this.active.length && time >= this.nextAt && bodies.length) this.schedule(time, bodies);
    const hits: Body[] = [];
    for (const trader of this.active) {
      if (time < trader.startsAt || trader.y >= trader.ground) continue;

      const previous = trader.y;
      trader.y = Math.min(trader.ground, trader.top + (time - trader.startsAt) * this.config.speed / 1000);
      for (const body of bodies) {
        if (!this.hitThisWave.has(body) &&
          Math.abs(trader.x - body.x) < (this.config.width + this.hitbox.width) / 2 &&
          previous - this.config.height < body.y && trader.y > body.y - this.hitbox.height) {
          hits.push(body);
          this.hitThisWave.add(body);
        }
      }
    }
    const first = this.active[0];
    if (first && time >= first.endsAt + this.config.landingMs) {
      this.active = [];
      this.nextAt = time + this.interval();
    }
    return hits;
  }
}
