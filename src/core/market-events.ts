import type { FinancialConfig, TradingEvent } from '../config/financial-settings';
import { weighted, type Random } from './random';
import { marketTone } from './trading-effects';

export function eligibleMarketEvents(config: FinancialConfig, history: readonly TradingEvent[]) {
  const prior = history.at(-1);
  const second = history.at(-2);
  const extremeSeen = history.some(event => event.severity === 'extreme');
  const allowed = config.events.filter(event => !extremeSeen || event.severity !== 'extreme');
  const unseen = allowed.filter(event => !history.some(past => past.id === event.id));
  let candidates = unseen.length ? unseen : allowed;
  const prefer = (predicate: (event: TradingEvent) => boolean) => {
    const preferred = candidates.filter(predicate);
    if (preferred.length) candidates = preferred;
  };
  if (prior) {
    const direction = marketTone(prior, config);
    if (direction === 'negative' || (direction === 'positive' && second && marketTone(second, config) === direction)) {
      prefer(event => marketTone(event, config) !== direction);
    }
    if (prior.category === second?.category) prefer(event => event.category !== prior.category);
  }
  const seriousCount = history.filter(event => event.severity !== 'normal').length;
  return candidates.map(event => ({
    ...event,
    weight: event.weight * (event.category === prior?.category ? 0.55 : 1) *
      (seriousCount >= 3 && event.severity === 'major' ? 0.65 : 1)
  }));
}

export function buildMarketSchedule(config: FinancialConfig, random: Random) {
  const schedule = new Map<number, TradingEvent>();
  const history: TradingEvent[] = [];
  const { eventEvery, turns } = config.gameplay;
  for (let day = eventEvery; day <= turns; day += eventEvery) {
    const candidates = eligibleMarketEvents(config, history);
    if (!candidates.length) throw new Error('市場新聞池缺少可接續的事件');
    const pick = weighted(candidates, random);
    const event = config.events.find(item => item.id === pick.id)!;
    history.push(event);
    schedule.set(day, event);
  }
  return schedule;
}
