import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const seeds = Number(process.argv[2] ?? 1000);
const before = process.argv.includes('--baseline');
if (!Number.isSafeInteger(seeds) || seeds < 1) throw new Error('種子數須為正整數');
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const { readFinancialConfig } = await server.ssrLoadModule('/src/config/financial-settings.ts');
  const { marketTone } = await server.ssrLoadModule('/src/core/trading-effects.ts');
  const { seededRandom, weighted } = await server.ssrLoadModule('/src/core/random.ts');
  const { buildMarketSchedule } = await server.ssrLoadModule('/src/core/market-events.ts');
  const config = readFinancialConfig();
  if (before) {
    const old = JSON.parse(execFileSync('git', ['show', '1c207d0:src/data/finance.json'], { encoding: 'utf8' }));
    config.events = old.events;
    config.effects = old.effects;
  }
  const baseSchedule = random => {
    const schedule = [];
    for (let index = 0; index < Math.floor(config.gameplay.turns / config.gameplay.eventEvery); index++) {
      const previous = schedule.at(-1);
      const normal = previous && marketTone(previous, config) === 'negative' ?
        config.events.filter(event => marketTone(event, config) !== 'negative') : config.events;
      schedule.push(weighted(normal.length ? normal : config.events, random));
    }
    return schedule;
  };
  const hash = [...'market schedule'].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261);
  const stats = { positive: 0, negative: 0, neutral: 0, major: 0, extreme: 0, repeatMatch: 0, extremeMatch: 0, categoryRepeat: 0 };
  const compound = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const random = seededRandom(seed ^ hash);
    const events = before ? baseSchedule(random) : [...buildMarketSchedule(config, random).values()];
    stats.repeatMatch += Number(new Set(events.map(event => event.id)).size !== events.length);
    stats.extremeMatch += Number(events.some(event => event.severity === 'extreme'));
    let value = 1;
    for (const [index, event] of events.entries()) {
      const effect = event.effectIds.map(id => config.effects[id]).find(item => item.type === 'price');
      const shock = effect ? (effect.floor + effect.ceiling) / 2 : 0;
      const reach = { all: 1, random_two: 0.5, random_one: 0.25, first_place: 0.25, last_place: 0.25 }[event.target];
      value *= 1 + shock * reach;
      stats[marketTone(event, config)]++;
      if (event.severity !== 'normal') stats[event.severity]++;
      if (event.category && events[index - 1]?.category === event.category) stats.categoryRepeat++;
    }
    compound.push(value - 1);
  }
  const mean = compound.reduce((sum, value) => sum + value, 0) / seeds;
  const stdev = Math.sqrt(compound.reduce((sum, value) => sum + (value - mean) ** 2, 0) / seeds);
  const leftTail = compound.sort((a, b) => a - b)[Math.floor((seeds - 1) * 0.05)];
  console.log(JSON.stringify({ seeds, events: config.events.length, mean, stdev, leftTail, ...stats }, null, 2));
} finally {
  await server.close();
}
