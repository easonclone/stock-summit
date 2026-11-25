import type { EventRules, FinancialConfig, TradingEvent } from '../config/financial-settings';

const noRules: EventRules = {};

export function rulesFor(config: FinancialConfig, event: Pick<TradingEvent, 'effectIds'> | null | undefined): EventRules {
  for (const id of event?.effectIds ?? []) {
    const effect = config.effects[id];
    if (effect.type === 'event_rules') return effect.rules;
  }
  return noRules;
}

export function eventPrice(config: FinancialConfig, event: Pick<TradingEvent, 'effectIds'> | null, previousMarket: number) {
  const rules = rulesFor(config, event);
  if (rules.coinMove) return { floor: rules.coinMove[1], ceiling: rules.coinMove[0], binary: true };
  if (rules.rebound !== undefined) {
    const move = previousMarket < 0 ? rules.rebound : 0;
    return { floor: move, ceiling: move, binary: false };
  }
  for (const id of event?.effectIds ?? []) {
    const effect = config.effects[id];
    if (effect.type === 'price') return { floor: effect.floor, ceiling: effect.ceiling, binary: false };
  }
  return null;
}

export function eventMarketRate(config: FinancialConfig, event: TradingEvent | null, draw: number, previousMarket: number) {
  const price = eventPrice(config, event, previousMarket);
  if (!price) return 0;
  if (price.binary) return draw < 0.5 ? price.floor : price.ceiling;
  return price.floor + (price.ceiling - price.floor) * draw;
}

export function eventAttackFactor(rules: EventRules, area: boolean, last: boolean, bottom: boolean) {
  return (1 + (rules.attackBoost ?? 0)) * (1 + (area ? rules.areaBoost ?? 0 : 0)) *
    (1 + (last ? rules.lastAttack ?? 0 : 0)) * (1 + (bottom ? rules.bottomAttack ?? 0 : 0));
}

export function eventGuardFactor(rules: EventRules, guard: number, firstRank: boolean, firstHit: boolean) {
  return (1 - guard * (1 - (rules.guardWeakness ?? 0))) * (1 - (rules.attackCut ?? 0)) *
    (1 - (firstRank ? rules.leaderGuard ?? 0 : 0)) * (1 - (firstHit ? rules.firstHitCut ?? 0 : 0));
}
