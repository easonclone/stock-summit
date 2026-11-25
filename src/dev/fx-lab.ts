// 開發專用：用真實的 TradingRun 排出指定的攻防情境，結算一天後以 ArenaFx 播放，供截圖驗收。
// 不進正式建置（vite build 只打包 index.html）。情境只設定手牌、護盾與持股，所有數字都由結算引擎產生。
import '../style.css';
import '../polish.css';
import '../battle.css';
import { readFinancialConfig, type FinancialConfig } from '../config/financial-settings';
import { readFeedbackConfig } from '../config/feedback-settings';
import { TradingRun, type Investor } from '../core/trading-run';
import type { TradeChoice } from '../core/trade-preview';
import { ArenaFx } from '../ui/arena-fx';
import { CardAudio } from '../ui/audio';
import { buildFxPlan } from '../ui/fx-events';
import { loadHDArt } from '../ui/hd-art';
import { loadInvestorSprites } from '../ui/investor-sprites';
import { paintCanvases } from '../ui/paint';
import { tradingMarkup } from '../ui/trading-terminal';

type Plan = (id: string, seats: string[]) => TradeChoice;
interface Case { move: number; cards?: Record<number, string[]>; jokers?: Record<number, string[]>; setup?: (seats: Investor[]) => void; plan: Plan }

const hold = (allocation: string): Plan => () => ({ allocation, item: null });
const playerUses = (choice: (seats: string[]) => TradeChoice, others = 'all'): Plan => (id, seats) => id === seats[0] ? choice(seats) : { allocation: others, item: null };
const guard = { itemId: 'guard', name: '防跌護盾', mode: 'cut' as const, amount: 0.5 };

const cases: Record<string, Case> = {
  snipe: { move: 0, cards: { 0: ['snipe'] }, plan: playerUses(seats => ({ allocation: 'all', item: 0, targetId: seats[1] })) },
  rush: { move: 0, cards: { 0: ['rush'] }, plan: playerUses(seats => ({ allocation: 'all', item: 0, targetId: seats[2] })) },
  double: { move: 0, cards: { 0: ['strike_boost', 'rush'] }, plan: playerUses(seats => ({ allocation: 'all', actions: [{ slot: 0 }, { slot: 1, targetId: seats[1] }] })) },
  brawl: { move: 0, cards: { 0: ['brawl'] }, plan: playerUses(() => ({ allocation: 'all', item: 0 })) },
  shield: { move: -0.045, setup: seats => { seats[0].defenses.push({ ...guard }); }, plan: hold('all') },
  shatter: { move: 0, cards: { 0: ['shatter'] }, setup: seats => { seats[1].defenses.push({ ...guard }); },
    plan: playerUses(seats => ({ allocation: 'all', item: 0, targetId: seats[1] })) },
  mirror: { move: 0, cards: { 1: ['snipe'] }, setup: seats => { seats[0].memory.mirror = 0.5; },
    plan: (id, seats) => id === seats[1] ? { allocation: 'all', item: 0, targetId: seats[0] } : { allocation: 'all', item: null } },
  raid: { move: 0, cards: { 0: ['raid'] }, plan: (id, seats) => id === seats[0] ? { allocation: 'all', item: 0, targetId: seats[3] }
    : { allocation: id === seats[3] ? 'cash' : 'all', item: null } },
  jokers: { move: 0.05, jokers: { 0: ['diamond', 'god', 'gambler', 'cash_cow', 'dividend_king'] }, plan: hold('half') },
  market_up: { move: 0.055, plan: hold('all') },
  market_down: { move: -0.045, plan: hold('all') },
  miss: { move: 0, cards: { 0: ['snipe'] }, plan: (id, seats) => id === seats[0] ? { allocation: 'all', item: 0, targetId: seats[1] }
    : { allocation: id === seats[1] ? 'cash' : 'all', item: null } }
};

function calm(config: FinancialConfig, move: number) {
  config.events = [{ id: 'lab', title: '實驗室', subtitle: '虛構', category: 'flows', description: '虛構', fictional: true, weight: 1, target: 'all', severity: 'normal', effectIds: ['none'] }];
  config.effects.none = { type: 'price', floor: 0, ceiling: 0 };
  config.effects.market_day = { type: 'price', floor: move, ceiling: move };
  config.gameplay.startItems = 0;
  config.gameplay.dailyItemStart = null;
  config.gameplay.stageDays = [];
  return config;
}

async function main() {
  await Promise.all([loadInvestorSprites(), loadHDArt()]);
  const params = new URLSearchParams(location.search);
  const name = params.get('case') ?? 'snipe';
  const reduced = params.has('reduced');
  const scenario = cases[name];
  const config = calm(readFinancialConfig(), scenario.move);
  const run = new TradingRun(config, { seed: 5, playerId: 'pan', difficulty: 'normal' });
  while (run.offer) run.chooseOffer(null);
  const ids = run.investors.map(investor => investor.character.id);
  run.investors.forEach((investor, index) => {
    investor.jokers = (scenario.jokers?.[index] ?? []).map(id => config.jokers.find(card => card.id === id)!);
    investor.items = (scenario.cards?.[index] ?? []).map(id => config.items.find(card => card.id === id)!);
  });
  scenario.setup?.(run.investors);
  if (!run.resolveControlled(view => scenario.plan(view.characterId, ids))) throw new Error(`情境 ${name} 無法鎖單`);
  while (run.offer) run.chooseOffer(null);
  const screen = document.querySelector<HTMLElement>('#screen')!;
  document.querySelector('#app')!.classList.toggle('reduced-motion', reduced);
  screen.innerHTML = tradingMarkup(run, { allocation: null, item: null, animate: !reduced, fresh: true });
  paintCanvases(screen, config);
  const plan = buildFxPlan(readFeedbackConfig(), run.reports[0], run.player.character.id);
  const seen: string[] = [];
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLElement && node.classList.contains('fx-float')) seen.push(node.textContent ?? '');
    }
  }).observe(screen, { childList: true, subtree: true });
  const fx = new ArenaFx(config, new CardAudio());
  Object.assign(window, {
    __fx: { plan, seen, report: run.reports[0], start: () => fx.play(screen, plan, run.player.character.id, reduced) }
  });
  document.body.dataset.ready = 'true';
}

void main();
