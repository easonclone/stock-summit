import type { Config, Difficulty, Platform } from '../config/settings';
import type { CashPickups } from './cash';
import { direction, idle, type Body, type MovementInput, type Track } from './movement';
import type { Random } from './random';
import type { Terrain } from './terrain';

export function between([min, max]: [number, number], random: Random) {
  return min + (max - min) * random();
}

export class RivalController {
  private platformId: string | null = null;
  private route: Platform['edges'][number] | undefined;
  private readyAt = 0;
  /** Per patrol on the current platform: whether this rival will try to jump over it. */
  private readonly dodges = new Map<string, boolean>();
  /** Destination x while airborne from a dodge jump; the rival steers there and stops. */
  private dodgeTarget: number | null = null;

  constructor(
    private readonly track: Track,
    private readonly npc: Config['npc'],
    private readonly difficulty: Difficulty,
    private readonly random: Random,
    private readonly cashPickups: CashPickups,
    private readonly terrain?: Terrain
  ) {}

  input(body: Body, time: number, racerId: string, cash: number): MovementInput {
    if (body.ladderId) return { ...idle, vertical: -1 };
    if (!body.platformId) {
      return this.dodgeTarget === null ? idle : { ...idle, horizontal: direction(this.dodgeTarget - body.x, 2) };
    }
    this.dodgeTarget = null;

    if (this.platformId !== body.platformId) {
      const platform = this.track.platforms.get(body.platformId)!;
      const ascending = platform.edges.filter(edge => this.track.platforms.get(edge.to)!.y < platform.y);
      const jump = ascending.find(edge => edge.type === 'jump');
      const ladder = ascending.find(edge => edge.type === 'climb');
      this.route = jump && this.random() < this.npc.jumpChance[this.difficulty] ? jump : ladder ?? jump;
      this.platformId = body.platformId;
      this.readyAt = time + between(this.npc.reactionMs[this.difficulty], this.random);
      this.dodges.clear();
    }

    const route = this.route;
    if (!route || time < this.readyAt) return idle;

    let goal = route.x;
    let deadZone = route.type === 'jump' ? 3 : 7;
    if (this.cashPickups.bonus(cash) < this.cashPickups.bonusCap) {
      const bundle = this.cashPickups.bundles.find(item => item.platformId === body.platformId && !item.claimed.has(racerId) &&
        Math.abs(body.x - item.x) + Math.abs(route.x - item.x) - Math.abs(body.x - route.x) <= this.npc.cashDetour);
      if (bundle) {
        goal = bundle.x;
        deadZone = this.cashPickups.config.pickupRange - 1;
      }
    }

    const horizontal = direction(goal - body.x, deadZone);
    if (!horizontal) {
      if (goal !== route.x) return idle;
      return { ...idle, jump: route.type === 'jump', vertical: route.type === 'climb' ? -1 : 0 };
    }
    if (this.shouldDodge(body, horizontal, goal)) {
      this.dodgeTarget = goal;
      return { ...idle, horizontal, jump: true };
    }
    return { ...idle, horizontal };
  }

  /** True when a patrol lies just ahead on the way to `goal` and this rival decided to jump over it. */
  private shouldDodge(body: Body, heading: -1 | 1, goal: number) {
    if (!this.terrain) return false;
    const patrol = this.terrain.patrols
      .filter(item => item.platformId === body.platformId && (item.x - body.x) * heading > 0 && (goal - item.x) * heading > 0)
      .sort((a, b) => Math.abs(a.x - body.x) - Math.abs(b.x - body.x))[0];
    if (!patrol || Math.abs(patrol.x - body.x) > this.npc.patrolJumpDistance) return false;
    if (!this.dodges.has(patrol.id)) this.dodges.set(patrol.id, this.random() < this.npc.patrolJumpChance[this.difficulty]);
    return this.dodges.get(patrol.id)!;
  }
}
