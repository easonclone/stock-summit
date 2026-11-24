import type { GameMap, Platform } from '../config/settings';

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
