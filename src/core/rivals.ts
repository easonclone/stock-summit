import type { Config, Difficulty, Platform } from '../config/settings';
import type { CashPickups } from './cash';
import { direction, idle, type Body, type MovementInput, type Track } from './movement';
import type { Random } from './random';

export function between([min, max]: [number, number], random: Random) {
  return min + (max - min) * random();
}

export class RivalController {
  private platformId: string | null = null;
  private route: Platform['edges'][number] | undefined;
  private readyAt = 0;

  constructor(
    private readonly track: Track,
    private readonly npc: Config['npc'],
    private readonly difficulty: Difficulty,
    private readonly random: Random,
    private readonly cashPickups: CashPickups
  ) {}

  input(body: Body, time: number, racerId: string, cash: number): MovementInput {
    if (body.ladderId) return { ...idle, vertical: -1 };
    if (!body.platformId) return idle;

    if (this.platformId !== body.platformId) {
      const platform = this.track.platforms.get(body.platformId)!;
      const ascending = platform.edges.filter(edge => this.track.platforms.get(edge.to)!.y < platform.y);
      const jump = ascending.find(edge => edge.type === 'jump');
      const ladder = ascending.find(edge => edge.type === 'climb');
      this.route = jump && this.random() < this.npc.jumpChance[this.difficulty] ? jump : ladder ?? jump;
      this.platformId = body.platformId;
      this.readyAt = time + between(this.npc.reactionMs[this.difficulty], this.random);
    }

    const route = this.route;
    if (!route || time < this.readyAt) return idle;

    if (this.cashPickups.bonus(cash) < this.cashPickups.bonusCap) {
      const bundle = this.cashPickups.bundles.find(item => item.platformId === body.platformId && !item.claimed.has(racerId) &&
        Math.abs(body.x - item.x) + Math.abs(route.x - item.x) - Math.abs(body.x - route.x) <= this.npc.cashDetour);
      if (bundle) return { ...idle, horizontal: direction(bundle.x - body.x, this.cashPickups.config.pickupRange - 1) };
    }

    const horizontal = direction(route.x - body.x, route.type === 'jump' ? 3 : 7);
    return horizontal
      ? { ...idle, horizontal }
      : { ...idle, jump: route.type === 'jump', vertical: route.type === 'climb' ? -1 : 0 };
  }
}
