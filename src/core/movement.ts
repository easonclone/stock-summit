import type { Config, GameMap, Platform } from '../config/settings';

export interface MovementInput {
  horizontal: -1 | 0 | 1;
  vertical: -1 | 0 | 1;
  jump: boolean;
}

export const idle: MovementInput = { horizontal: 0, vertical: 0, jump: false };

export interface Body {
  x: number;
  y: number;
  velocityY: number;
  platformId: string | null;
  ladderId: string | null;
  facing: -1 | 1;
  motion: 'idle' | 'walk' | 'air' | 'climb';
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function direction(delta: number, deadZone = 0): -1 | 0 | 1 {
  return delta < -deadZone ? -1 : delta > deadZone ? 1 : 0;
}

export class Track {
  readonly platforms: ReadonlyMap<string, Platform>;
  readonly floor: Platform;
  readonly ledges: Platform[];
  readonly surfaces: Platform[];
  readonly finish: Platform;

  constructor(readonly map: GameMap) {
    const main = new Map(map.platforms.map(item => [item.id, { ...item, edges: [...item.edges] }]));
    this.ledges = map.ledges.map(item => {
      const lower = main.get(item.from)!;
      const x = item.x + item.width / 2;
      const y = lower.y - item.rise;
      lower.edges.push({ to: item.id, type: 'jump', x });
      return { id: item.id, x: item.x, y, width: item.width, height: 12, layer: lower.layer,
        safeLanding: { x, y }, edges: [{ to: item.to, type: 'jump', x }] };
    });
    this.platforms = new Map([...main, ...this.ledges.map(item => [item.id, item] as const)]);
    this.surfaces = [...this.platforms.values()].sort((a, b) => b.y - a.y);
    this.floor = map.platforms[0];
    this.finish = this.platforms.get(map.finishPlatformId)!;
  }

  layerAt(y: number) {
    const platforms = this.map.platforms;
    const firstHigher = platforms.findIndex(item => item.y < y - 0.001);
    return firstHigher === -1 ? this.finish.layer : Math.max(0, firstHigher - 1);
  }

  layerPosition(y: number) {
    const layer = this.layerAt(y);
    const current = this.map.platforms[layer];
    const next = this.map.platforms[layer + 1];
    return next ? layer + clamp((current.y - y) / (current.y - next.y), 0, 1) : layer;
  }

  progress(y: number) {
    return clamp((this.floor.y - y) / (this.floor.y - this.finish.y) * 100, 0, 100);
  }

  zone(y: number) {
    const layer = this.layerAt(y);
    return this.map.zones.findLast(zone => zone.startLayer <= layer) ?? this.map.zones[0];
  }

  displace(body: Body, layers: number) {
    const current = this.layerAt(body.y);
    const next = clamp(current + layers, 0, this.finish.layer);
    if (next === current) return 0;
    const landing = this.map.platforms[next];
    body.x = landing.safeLanding.x;
    body.y = landing.safeLanding.y;
    body.velocityY = 0;
    body.platformId = landing.id;
    body.ladderId = null;
    body.motion = 'idle';
    return next - current;
  }
}

export class Movement {
  private readonly ladders: ReadonlyMap<string, GameMap['ladders'][number]>;

  constructor(private readonly track: Track, private readonly physics: Config['physics']) {
    this.ladders = new Map(track.map.ladders.map(ladder => [ladder.id, ladder]));
  }

  step(body: Body, input: MovementInput, seconds: number, multiplier: number) {
    if (input.horizontal) body.facing = input.horizontal;
    const physics = this.physics;
    const halfWidth = physics.hitbox.width / 2;
    const canStand = (item: Platform) => body.x + halfWidth > item.x && body.x - halfWidth < item.x + item.width;
    let ladder = body.ladderId ? this.ladders.get(body.ladderId) : undefined;
    if (input.jump && ladder) {
      body.ladderId = null;
      body.velocityY = -physics.jumpVelocity;
      ladder = undefined;
    }
    if (!ladder && input.vertical && !input.jump) {
      ladder = this.track.map.ladders.find(item => {
        const from = this.track.platforms.get(item.from)!;
        const to = this.track.platforms.get(item.to)!;
        const endpoint = input.vertical < 0 ? from.id : to.id;
        return Math.abs(item.x - body.x) <= physics.ladderGrab &&
          (body.platformId === endpoint || (!body.platformId && body.y > to.y + 2 && body.y < from.y - 2));
      });
    }

    if (ladder) {
      const from = this.track.platforms.get(ladder.from)!;
      const to = this.track.platforms.get(ladder.to)!;
      body.ladderId = ladder.id;
      body.platformId = null;
      body.x = ladder.x;
      body.velocityY = 0;
      body.y = clamp(body.y + input.vertical * physics.climbSpeed * multiplier * seconds, to.y, from.y);
      body.motion = 'climb';
      const endpoint = body.y === to.y && input.vertical < 0 ? to : body.y === from.y && input.vertical > 0 ? from : null;
      if (endpoint) {
        body.platformId = endpoint.id;
        body.ladderId = null;
        body.motion = 'idle';
      }
      return;
    }

    body.x = clamp(body.x + input.horizontal * physics.moveSpeed * multiplier * seconds, halfWidth, this.track.map.width - halfWidth);
    const struckPlatform = body.platformId ? this.track.platforms.get(body.platformId) : undefined;
    if (input.jump && struckPlatform) {
      body.velocityY = -physics.jumpVelocity;
      body.platformId = null;
    } else if (struckPlatform && canStand(struckPlatform)) {
      body.motion = input.horizontal ? 'walk' : 'idle';
      return;
    } else {
      body.platformId = null;
    }

    const previousY = body.y;
    body.velocityY += physics.gravity * seconds;
    body.y = Math.max(physics.hitbox.height, body.y + body.velocityY * seconds);
    body.motion = 'air';
    if (body.velocityY < 0) return;

    const landing = this.track.surfaces.findLast(item => item.y >= previousY && item.y <= body.y && canStand(item));
    if (landing) {
      body.y = landing.y;
      body.velocityY = 0;
      body.platformId = landing.id;
      body.motion = 'idle';
    }
  }
}
