import type { Config, GameMap } from '../config/settings';
import type { Body, Track } from './movement';
import type { Random } from './random';

type Hazard = GameMap['obstacles'][number] & { y: number };
export type Patrol = Hazard & {
  typeData: Config['obstacles'][string];
  distance: number;
  x: number;
  facing: -1 | 1;
};

export class Terrain {
  readonly patrols: Patrol[] = [];

  constructor(track: Track, readonly physics: Config['physics'], types: Config['obstacles'], random: Random) {
    for (const item of track.map.obstacles) {
      const y = track.platforms.get(item.platformId)!.y;
      const typeData = types[item.type];
      const patrol: Patrol = { ...item, y, typeData, distance: random() * (item.toX - item.fromX) * 2, x: 0, facing: 1 };
      this.position(patrol);
      this.patrols.push(patrol);
    }
  }

  private position(patrol: Patrol) {
    const span = patrol.toX - patrol.fromX;
    patrol.facing = patrol.distance < span ? 1 : -1;
    patrol.x = patrol.fromX + Math.min(patrol.distance, span * 2 - patrol.distance);
  }

  step(seconds: number, multiplier: number) {
    for (const patrol of this.patrols) {
      const period = (patrol.toX - patrol.fromX) * 2;
      patrol.distance = (patrol.distance + seconds * patrol.typeData.speed * multiplier) % period;
      this.position(patrol);
    }
  }

  contacts(body: Body) {
    const hitbox = this.physics.hitbox;
    return this.patrols.filter(patrol =>
      body.y <= patrol.y + 2 && body.y > patrol.y - patrol.typeData.height &&
      Math.abs(body.x - patrol.x) < (hitbox.width + patrol.typeData.width) / 2);
  }
}
