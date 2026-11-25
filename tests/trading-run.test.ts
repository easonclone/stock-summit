import { describe, expect, it } from 'vitest';
import { financialInput, readFinancialConfig, type FinancialConfig } from '../src/config/financial-settings';
import { netWorth } from '../src/core/economy';
import { chooseTrade, strategies, type Planner } from '../src/core/npc-strategy';
import { seededRandom } from '../src/core/random';
import { sumSteps } from '../src/core/settlement';
import { TradingRun, type Investor } from '../src/core/trading-run';

const start = (config = readFinancialConfig(), seed = 91, playerId = config.characters[0].id) =>
  new TradingRun(config, { playerId, seed, difficulty: 'normal' });

function settleOffers(run: TradingRun) {
  while (run.offer) expect(run.chooseOfferAutomatically()).toBe(true);
  if (run.shop) expect(run.shopAutomatically()).toBe(true);
  while (run.offer) expect(run.chooseOfferAutomatically()).toBe(true);
}

const hold = (allocation: string): Planner => () => ({ allocation, item: null });

function playDay(run: TradingRun, planner: Planner = chooseTrade) {
  settleOffers(run);
  expect(run.resolveControlled(planner)).toBe(true);
  if (run.pendingRecovery) expect(run.acceptRecovery()).toBe(true);
}

function playAll(run: TradingRun, planner: Planner = chooseTrade) {
  while (!run.closed) playDay(run, planner);
  return run;
}

/** No news moves and a fixed daily market move, so every rule can be checked by hand. */
function calmMarket(config: FinancialConfig, move = 0.02) {
  config.events = [{
    id: 'test', title: '測試事件', subtitle: '測試用', category: 'flows', description: '虛構', fictional: true, weight: 1, target: 'all', severity: 'normal', effectIds: ['none']
  }];
  config.effects.none = { type: 'price', floor: 0, ceiling: 0 };
  config.effects.market_day = { type: 'price', floor: move, ceiling: move };
  config.gameplay.startItems = 0;
  config.gameplay.dailyItemStart = null;
  config.gameplay.stageDays = [];
  return config;
}

const joker = (config: FinancialConfig, id: string) => config.jokers.find(card => card.id === id)!;
const item = (config: FinancialConfig, id: string) => config.items.find(card => card.id === id)!;

/** Opening offers declined, then the given cards dealt to one investor. */
function equip(run: TradingRun, investor: Investor, jokers: string[], items: string[] = []) {
  while (run.offer) run.chooseOffer(null);
  investor.jokers = jokers.map(id => joker(run.config, id));
  investor.items = items.map(id => item(run.config, id));
}

const outcomeOf = (run: TradingRun, investor: Investor, day = run.reports.length) =>
  run.reports[day - 1].outcomes.find(outcome => outcome.investor === investor)!;

describe('每日流程與種子', () => {
  it('同一種子及打法完整重現 15 日、王牌、道具與收盤', () => {
    const summary = () => {
      const run = playAll(start());
      return run.reports.map(report => [report.day, report.market?.id ?? null,
        report.outcomes.map(outcome => [outcome.investor.character.id, outcome.allocation, outcome.item?.id ?? null, outcome.close])]);
    };
    const first = summary();
    expect(first).toHaveLength(15);
    expect(summary()).toEqual(first);
  });

  it('開局先免費三選一王牌，選完才能交易', () => {
    const run = start();
    expect(run.offer).toMatchObject({ kind: 'joker', source: 'opening' });
    expect(run.offer!.cards).toHaveLength(3);
    expect(run.confirm({ allocation: 'all', item: null })).toBe(false);
    expect(run.chooseOffer(0)).toBe(true);
    expect(run.player.jokers).toHaveLength(1);
    for (const rival of run.investors.filter(investor => investor !== run.player)) expect(rival.jokers).toHaveLength(1);
    expect(run.confirm({ allocation: 'all', item: null })).toBe(true);
  });

  it('配置沿用前一天；不存在的配置或用不了的道具不會被接受', () => {
    const config = calmMarket(readFinancialConfig());
    const run = start(config);
    equip(run, run.player, [], ['trend']);
    expect(run.player.allocation).toBe('half');
    expect(run.confirm({ allocation: 'leverage', item: null })).toBe(false);
    expect(run.confirm({ allocation: 'cash', item: 0 })).toBe(false);
    expect(run.preview('cash', 0)!.itemBlock).toBe('no_stock');
    expect(run.day).toBe(1);
    expect(run.confirm({ allocation: 'all', item: null })).toBe(true);
    expect(run.confirm({ item: null })).toBe(true);
    expect(outcomeOf(run, run.player, 2).allocation).toBe('all');
  });

  it('預覽沒有副作用', () => {
    const run = start();
    settleOffers(run);
    const before = JSON.stringify([run.player.account, run.player.items, run.player.memory]);
    for (const option of run.config.allocation.options) for (const slot of [null, 0]) run.preview(option.id, slot);
    expect(JSON.stringify([run.player.account, run.player.items, run.player.memory])).toBe(before);
  });
});

describe('共同市場與資產守恆', () => {
  it('所有人承受相同的每日漲跌；股票越多賺越多，現金不受影響', () => {
    const run = start(calmMarket(readFinancialConfig()));
    for (const investor of run.investors) equip(run, investor, []);
    const plan: Record<string, string> = Object.fromEntries(run.investors.map((investor, index) =>
      [investor.character.id, ['cash', 'half', 'all', 'all'][index]]));
    playDay(run, view => ({ allocation: plan[view.characterId], item: null }));
    expect(run.reports[0].outcomes.map(outcome => [outcome.allocation, outcome.ledger.marketPnl, outcome.close]))
      .toEqual([['cash', 0, 10000], ['half', 100, 10100], ['all', 200, 10200], ['all', 200, 10200]]);
  });

  it('每天的結算明細加總正好等於總身家變化；沒有負現金、負股票或欠款', () => {
    for (const strategy of strategies) {
      const random = seededRandom(7);
      const run = playAll(start(readFinancialConfig(), 13), view => chooseTrade(view, random, strategy));
      for (const report of run.reports) for (const outcome of report.outcomes) {
        if (outcome.recovery) continue;
        expect(outcome.close - outcome.start, `${strategy} 第 ${report.day} 日`).toBe(sumSteps(outcome.ledger));
      }
      for (const investor of run.investors) {
        expect(investor.account.cash).toBeGreaterThanOrEqual(0);
        expect(investor.account.investmentValue).toBeGreaterThanOrEqual(0);
        expect(investor.jokers.length).toBeLessThanOrEqual(run.config.gameplay.jokerSlots);
        expect(investor.items.length).toBeLessThanOrEqual(run.config.gameplay.itemSlots);
        expect(Object.keys(investor.account)).not.toContain('debt');
      }
    }
  });
});

describe('王牌連鎖', () => {
  it('百分比加成先相加，特殊乘數再計算，固定現金最後結算', () => {
    const config = calmMarket(readFinancialConfig(), 0.1);
    const run = start(config);
    equip(run, run.player, ['diamond', 'gambler', 'dividend_king'], ['trend']);
    playDay(run, view => view.characterId === run.player.character.id ? { allocation: 'all', item: 0 } : { allocation: 'cash', item: null });
    const { ledger, close } = outcomeOf(run, run.player);
    expect(ledger.steps.map(step => [step.id, step.kind, step.amount])).toEqual([
      ['market', 'base', 1000], ['diamond', 'add', 500], ['trend', 'add', 1000], ['gambler', 'mult', 2500], ['dividend_king', 'cash', 450]
    ]);
    expect(close).toBe(10000 + 1000 + 500 + 1000 + 2500 + 450);
    expect(ledger.combos).toBe(3);
  });

  it('倍率有上限：賭神加瘋狂加碼最多只到基礎獲利的 5 倍', () => {
    const config = calmMarket(readFinancialConfig(), 0.05);
    const run = start(config);
    equip(run, run.player, ['gambler', 'diamond', 'god'], ['double']);
    playDay(run, view => view.characterId === run.player.character.id ? { allocation: 'all', item: 0 } : { allocation: 'cash', item: null });
    const { ledger } = outcomeOf(run, run.player);
    expect(ledger.stockFinal).toBe(500 * 5);
    expect(ledger.capped).toBe(true);
  });

  it('賭神也放大虧損；防彈衣與護盾一起最多少賠 80%，股票不會變負', () => {
    const config = calmMarket(readFinancialConfig(), -0.1);
    const run = start(config);
    equip(run, run.player, ['gambler', 'vest'], ['bell']);
    playDay(run, view => view.characterId === run.player.character.id ? { allocation: 'all', item: 0 } : { allocation: 'cash', item: null });
    const { ledger } = outcomeOf(run, run.player);
    expect(ledger.stockBase).toBe(-1000);
    expect(ledger.steps.map(step => [step.id, step.amount])).toEqual([['market', -1000], ['gambler', -1000], ['vest', 700], ['bell', 900]]);
    expect(ledger.stockFinal).toBe(-400);
    expect(run.player.defenses).toEqual([]);
    const crash = calmMarket(readFinancialConfig(), -0.6);
    const doomed = start(crash);
    equip(doomed, doomed.player, ['gambler']);
    playDay(doomed, view => view.characterId === doomed.player.character.id ? { allocation: 'all', item: null } : { allocation: 'cash', item: null });
    expect(outcomeOf(doomed, doomed.player).ledger.stockFinal).toBe(-10000);
    expect(doomed.player.account.investmentValue).toBe(0);
  });

  it('現金奶牛加銀行大戶：現金收益加倍；空軍司令在沒有股票的下跌日發動', () => {
    const config = calmMarket(readFinancialConfig(), -0.02);
    const run = start(config);
    equip(run, run.player, ['cash_cow', 'bank', 'bear']);
    playDay(run, view => view.characterId === run.player.character.id ? { allocation: 'cash', item: null } : { allocation: 'all', item: null });
    expect(outcomeOf(run, run.player).ledger.steps.map(step => [step.id, step.amount])).toEqual([['cash_cow', 200], ['bank', 200], ['bear', 800]]);
  });

  it('連勝王、複利怪獸與長期持有讀取前幾天的紀錄', () => {
    const config = calmMarket(readFinancialConfig(), 0.02);
    const run = start(config);
    equip(run, run.player, ['streak', 'compound', 'holder']);
    const all = hold('all');
    playDay(run, all);
    expect(outcomeOf(run, run.player).ledger.steps.map(step => step.id)).toEqual(['market']);
    playDay(run, all);
    expect(outcomeOf(run, run.player).ledger.steps.map(step => step.id)).toEqual(['market', 'streak', 'compound']);
    playDay(run, all);
    const third = outcomeOf(run, run.player).ledger.steps;
    expect(third.find(step => step.id === 'streak')!.value).toBeCloseTo(0.3);
    expect(third.find(step => step.id === 'holder')!.amount).toBe(1000);
    playDay(run, all);
    expect(outcomeOf(run, run.player).ledger.steps.some(step => step.id === 'holder')).toBe(false);
  });
});

describe('道具', () => {
  it('每天最多一張；護盾留到下次賠錢才發動，最多同時放兩個', () => {
    const config = calmMarket(readFinancialConfig(), 0.02);
    const run = start(config);
    equip(run, run.player, [], ['guard', 'escape', 'bell']);
    const me = (slot: number | null) => (view: { characterId: string }) => view.characterId === run.player.character.id
      ? { allocation: 'all', item: slot } : { allocation: 'cash', item: null };
    playDay(run, me(0));
    playDay(run, me(0));
    expect(run.player.defenses.map(item => item.itemId)).toEqual(['guard', 'escape']);
    expect(run.preview('all', 0)!.itemBlock).toBe('full_defense');
    run.config.effects.market_day = { type: 'price', floor: -0.1, ceiling: -0.1 };
    playDay(run, me(null));
    const { ledger } = outcomeOf(run, run.player);
    expect(ledger.defenseUsed?.itemId).toBe('guard');
    expect(ledger.shielded).toBe(Math.round(-ledger.stockBase * 0.5));
    expect(run.player.defenses.map(item => item.itemId)).toEqual(['escape']);
  });

  it('小道消息只告訴自己下一則新聞的方向，電腦看不到別人的情報', () => {
    const config = readFinancialConfig();
    const run = start(config);
    equip(run, run.player, [], ['tip']);
    playDay(run, view => view.characterId === run.player.character.id ? { allocation: 'half', item: 0 } : { allocation: 'half', item: null });
    const intel = run.intelFor(run.player)!;
    expect(intel.day).toBe(3);
    expect(['positive', 'negative', 'neutral']).toContain(intel.tone);
    expect(Object.keys(intel).sort()).toEqual(['day', 'tone']);
    playDay(run, hold('half'));
    expect(run.decisionView(run.player).knownTone).toBe(intel.tone);
    for (const rival of run.investors.filter(investor => investor !== run.player)) {
      if (!rival.items.some(card => card.id === 'tip')) expect(run.decisionView(rival).knownTone).toBeNull();
    }
  });

  it('主力狙擊使用明確鎖定的目標，命中可觸發華爾街之狼', () => {
    const config = calmMarket(readFinancialConfig(), 0);
    const run = start(config, 5);
    const [first, second, third, fourth] = run.investors;
    for (const investor of run.investors) equip(run, investor, ['wolf'], ['snipe']);
    first.account.cash = 12000;
    second.account.cash = 11000;
    third.account.cash = 10500;
    fourth.account.cash = 10400;
    playDay(run, view => {
      const index = run.investors.findIndex(investor => investor.character.id === view.characterId);
      return index === 0 ? { allocation: 'all', item: null } : { allocation: 'all', item: 0, targetId: run.investors[index - 1].character.id };
    });
    const outcomes = run.reports[0].outcomes;
    const hit = (investor: Investor) => outcomes.find(outcome => outcome.investor === investor)!;
    expect(hit(first).attackedBy).toEqual([second.character.name]);
    expect(hit(second).attackedBy).toEqual([third.character.name]);
    expect(hit(third).attackedBy).toEqual([fourth.character.name]);
    expect(hit(second).ledger.steps.find(step => step.id === 'wolf')!.amount).toBe(360);
    expect(hit(first).ledger.attackLoss).toBe(Math.round(12000 * 0.1));
  });

  it('單日直接攻擊傷害不超過開盤身家四分之一，失敗不耗牌', () => {
    const simulate = () => {
      const run = start(calmMarket(readFinancialConfig(), 0), 9);
      const [target, ...rivals] = run.investors;
      for (const rival of rivals) equip(run, rival, ['printer'], ['rush']);
      const targetId = target.character.id;
      expect(run.confirm({ allocation: 'all', item: null }, () => ({ allocation: 'all', item: 0 }))).toBe(false);
      expect(run.reports).toHaveLength(0);
      playDay(run, view => view.characterId === targetId ? { allocation: 'all', item: null } : { allocation: 'all', item: 0, targetId });
      const report = run.reports[0];
      expect(report.attacks).toHaveLength(2);
      expect(report.attacks.map(attack => attack.to)).toEqual([targetId, targetId]);
      expect(report.attacks.reduce((sum, attack) => sum + attack.amount, 0)).toBe(2500);
      const failed = report.outcomes.filter(outcome => outcome.attackBlocked);
      expect(failed).toHaveLength(1);
      for (const outcome of failed) {
        expect(outcome.item).toBeNull();
        expect(outcome.investor.items.map(card => card.id)).toEqual(['rush']);
        expect(outcome.ledger.steps.some(step => step.id === 'printer')).toBe(false);
      }
      return report.attacks;
    };
    expect(simulate()).toEqual(simulate());
  });

  it('掠奪最多取走目標現金，反擊鏡歸還一半，總現金守恆', () => {
    const run = start(calmMarket(readFinancialConfig(), 0));
    const [thief, victim] = run.investors;
    equip(run, thief, [], ['raid']);
    equip(run, victim, [], ['mirror']);
    victim.account.cash = 210;
    const forecast = run.preview('cash', 0, victim.character.id);
    expect(forecast?.attack?.amount).toBe(21);
    playDay(run, view => view.characterId === thief.character.id ? { allocation: 'cash', item: 0, targetId: victim.character.id }
      : { allocation: 'cash', item: view.characterId === victim.character.id ? 0 : null });
    expect(thief.account.cash).toBe(10010);
    expect(victim.account.cash).toBe(200);
    expect(thief.account.cash + victim.account.cash).toBe(10210);
    expect(victim.memory.mirror).toBeNull();
    expect(run.reports[0].attacks[0]).toMatchObject({ kind: 'cash_raid', amount: 21, reflected: 11 });
    expect(sumSteps(outcomeOf(run, thief).ledger)).toBe(10);
  });

  it('鎖單後沒有股票就打不中；股票反擊不會再引發反擊', () => {
    const run = start(calmMarket(readFinancialConfig(), 0));
    const [attacker, target] = run.investors;
    equip(run, attacker, [], ['snipe']);
    attacker.memory.mirror = 0.5;
    target.memory.mirror = 0.5;
    const strike: Planner = view => view.characterId === attacker.character.id
      ? { allocation: 'all', item: 0, targetId: target.character.id } : { allocation: 'cash', item: null };
    playDay(run, strike);
    expect(run.reports[0].attacks).toEqual([]);
    expect(attacker.items[0].id).toBe('snipe');
    expect(target.memory.mirror).toBe(0.5);
    playDay(run, view => view.characterId === target.character.id ? { allocation: 'all', item: null } : strike(view, seededRandom(1)));
    expect(run.reports[0].misses).toEqual([{ from: attacker.character.id, to: target.character.id, kind: 'attack', slot: 0, itemId: 'snipe', reason: 'no_stock' }]);
    expect(run.reports[1].attacks).toEqual([{ from: attacker.character.id, to: target.character.id, kind: 'attack', amount: 1000, reflected: 500, slot: 0, itemId: 'snipe', factor: 1 }]);
    expect(run.reports[1].misses).toEqual([]);
    expect(attacker.account.investmentValue).toBe(9500);
    expect(target.account.investmentValue).toBe(9000);
    expect(attacker.memory.mirror).toBe(0.5);
  });

  it('破盾在股價結算後，護盾已擋掉市場損失時不耗牌', () => {
    for (const market of [0, -0.1]) {
      const run = start(calmMarket(readFinancialConfig(), market));
      const [breaker, defender] = run.investors;
      equip(run, breaker, [], ['shatter']);
      defender.defenses.push({ itemId: 'guard', name: '防跌護盾', mode: 'cut', amount: 0.5 });
      playDay(run, view => view.characterId === breaker.character.id
        ? { allocation: 'all', item: 0, targetId: defender.character.id } : { allocation: 'all', item: null });
      expect(defender.defenses).toHaveLength(0);
      expect(breaker.items.some(card => card.id === 'shatter')).toBe(market < 0);
      expect(outcomeOf(run, defender).ledger.shielded).toBe(market < 0 ? 500 : 0);
      expect(run.reports[0].attacks).toHaveLength(market < 0 ? 0 : 1);
    }
  });

  it('神秘卡包讓玩家三選一道具；東山再起要身家低於 $5,000', () => {
    const config = calmMarket(readFinancialConfig(), 0);
    const run = start(config);
    equip(run, run.player, [], ['pack', 'comeback']);
    expect(run.preview('half', 1)!.itemBlock).toBe('not_low');
    expect(run.useOpeningItem(0)).not.toBeNull();
    expect(run.offer).toMatchObject({ kind: 'item', source: 'pack' });
    expect(run.offer!.cards).toHaveLength(3);
    expect(run.offer!.cards.some(card => card.id === 'pack')).toBe(false);
    expect(run.chooseOffer(1)).toBe(true);
    expect(run.player.items).toHaveLength(2);
  });
});

describe('開盤操作與自由出牌', () => {
  it('立即卡扣牌、每天只部署一次，兩張行動牌都在收盤同一份帳本', () => {
    const run = start(calmMarket(readFinancialConfig(), 0.05));
    const player = run.player;
    equip(run, player, ['printer'], ['gift', 'guard', 'bell', 'trend', 'dividend']);
    expect(run.useOpeningItem(0)?.amount).toBe(800);
    expect(player.account.cash).toBe(10800);
    expect(run.useOpeningItem(0)?.card.id).toBe('guard');
    expect(run.openingBlock(0)).toBe('defense_today');
    expect(run.useOpeningItem(0)).toBeNull();
    const actions = [{ slot: 1 }, { slot: 2 }];
    expect(run.canLock({ allocation: 'all', actions })).toBe(true);
    expect(run.canLock({ allocation: 'all', actions: [...actions, actions[0]] })).toBe(false);
    expect(run.confirm({ allocation: 'all', actions }, hold('cash'))).toBe(true);
    const result = outcomeOf(run, player);
    expect(result.items.map(card => card.id)).toEqual(['gift', 'guard', 'trend', 'dividend']);
    expect(result.ledger.steps.find(step => step.id === 'printer')?.amount).toBe(600);
    expect(result.ledger.stockFinal).toBe(1080);
    expect(result.close - result.start).toBe(sumSteps(result.ledger));
  });

  it('兩張攻擊可選不同目標；同一對手的第二張與空打的雙重打擊都保留', () => {
    const run = start(calmMarket(readFinancialConfig(), 0));
    const [player, rival, other] = run.investors;
    const targetId = rival.character.id;
    equip(run, player, [], ['strike_boost', 'rush', 'snipe']);
    expect(run.confirm({ allocation: 'all', actions: [{ slot: 0 }] }, hold('all'))).toBe(false);
    expect(run.confirm({ allocation: 'all', actions: [{ slot: 0 }, { slot: 1, targetId }] }, hold('cash'))).toBe(true);
    expect(player.items.map(card => card.id)).toEqual(['strike_boost', 'rush', 'snipe']);
    expect(run.confirm({ allocation: 'all', actions: [{ slot: 0 }, { slot: 1, targetId }] }, hold('all'))).toBe(true);
    expect(run.reports[1].attacks).toMatchObject([{ to: targetId, amount: 2500 }]);
    expect(player.items.map(card => card.id)).toEqual(['snipe']);
    player.items.push(item(run.config, 'rush'), item(run.config, 'rush'));
    expect(run.confirm({ allocation: 'all', actions: [{ slot: 0, targetId }, { slot: 1, targetId }] }, hold('all'))).toBe(true);
    expect(run.reports[2].attacks).toHaveLength(1);
    expect(run.confirm({ allocation: 'all', actions: [{ slot: 0, targetId }, { slot: 1, targetId: other.character.id }] }, hold('all'))).toBe(true);
    expect(run.reports[3].attacks).toHaveLength(2);
  });

  it('開盤店只收現金，折價券只折一次，回合結算不重複扣款', () => {
    const run = start(calmMarket(readFinancialConfig(), 0));
    const player = run.player;
    equip(run, player, [], ['ticket']);
    const base = run.dailyShopCheck(0).price;
    expect(run.dailyShop?.slots).toHaveLength(2);
    expect(run.useOpeningItem(0)).not.toBeNull();
    expect(player.memory.voucher).toBe(800);
    const purchase = run.buyDaily(0)!;
    expect(purchase.price).toBe(Math.max(1, base - 800));
    expect(player.memory.voucher).toBe(0);
    expect(run.buyDaily(0)).toBeNull();
    const cash = player.account.cash;
    player.account.cash = 0;
    expect(run.buyDaily(1)).toBeNull();
    player.account.cash = cash;
    expect(run.confirm({ allocation: 'all', actions: [] }, hold('cash'))).toBe(true);
    const result = outcomeOf(run, player);
    expect(result.close - result.start).toBe(-purchase.price);
    expect(result.ledger.steps.find(step => step.source === 'shop')?.amount).toBe(-purchase.price);
  });
});

describe('取得卡片', () => {
  it('四個席位的開局道具各不重複，保證收益及防禦，且相同種子重現', () => {
    const config = readFinancialConfig();
    const deal = (run: TradingRun) => run.investors.map(investor => investor.items.map(card => card.id));
    for (const seed of [1, 32, 91]) {
      const run = start(config, seed);
      const hands = deal(run);
      expect(hands).toEqual(deal(start(config, seed)));
      for (const hand of hands) {
        expect(new Set(hand).size).toBe(3);
        expect(config.gameplay.openingItems.income).toContain(hand[0]);
        expect(config.gameplay.openingItems.defense).toContain(hand[1]);
        expect(hand).not.toContain('comeback');
        expect(hand).not.toContain('snipe');
      }
      expect(run.playerOpeningItem).toBeNull();
    }
  });

  it('商店結束後才抽第 4 日道具，滿手可換一張或放棄，收盤不再抽牌', () => {
    const config = readFinancialConfig();
    const run = start(config);
    run.chooseOffer(null);
    expect(run.resolveControlled(hold('cash'))).toBe(true);
    expect(run.day).toBe(2);
    expect(run.offer).toBeNull();
    expect(run.investors.every(investor => investor.items.length === 4)).toBe(true);
    expect(run.player.items[3]).toBe(run.playerOpeningItem);
    run.player.items.push(item(config, 'gift'));
    const before = [...run.player.items];
    expect(run.resolveControlled(hold('cash'))).toBe(true);
    expect(run.offer?.source).toBe('daily');
    expect(run.resolveControlled(hold('cash'))).toBe(false);
    expect(run.chooseOffer(0)).toBe(false);
    expect(run.player.items).toEqual(before);
    expect(run.chooseOffer(0, 2)).toBe(true);
    expect(run.player.items[2]).toBe(run.playerOpeningItem);
    expect(run.resolveControlled(hold('cash'))).toBe(true);
    expect(run.shop?.day).toBe(3);
    expect(run.day).toBe(3);
    expect(run.reports.at(-1)?.outcomes.every(outcome => outcome.received.length === 0)).toBe(true);
    const hand = [...run.player.items];
    expect(run.leaveShop()).toBe(true);
    expect(run.day).toBe(4);
    expect(run.offer?.source).toBe('daily');
    expect(run.chooseOffer(null)).toBe(true);
    expect(run.player.items).toEqual(hand);
    while (run.day < config.gameplay.turns) playDay(run, hold('cash'));
    expect(run.playerOpeningItem).not.toBeNull();
    const finalItem = run.playerOpeningItem;
    playDay(run, hold('cash'));
    expect(run.closed).toBe(true);
    expect(run.day).toBe(15);
    expect(run.offer).toBeNull();
    expect(run.playerOpeningItem).toBe(finalItem);
  });
  it('開局三選一王牌；之後王牌要用現金在商店買，最多五張', () => {
    const run = start();
    expect(run.offer).toMatchObject({ kind: 'joker', source: 'opening' });
    playAll(run);
    expect(Math.max(...run.investors.map(investor => investor.jokers.length))).toBeLessThanOrEqual(5);
    for (const investor of run.investors) {
      const bought = investor.purchases.filter(purchase => purchase.kind === 'joker').length;
      expect(investor.jokers.length).toBeLessThanOrEqual(1 + bought);
    }
  });

  it('精打細算只在商店出現，不會出現在免費選牌', () => {
    let inShop = false;
    for (let seed = 1; seed < 40; seed++) {
      const other = start(readFinancialConfig(), seed);
      expect(other.offer!.cards.some(card => card.id === 'thrifty')).toBe(false);
      while (!other.closed && (other.day <= 3 || other.shop)) {
        while (other.offer) other.chooseOfferAutomatically();
        if (other.shop) { inShop ||= other.shop.slots.some(slot => slot.card.id === 'thrifty'); other.leaveShop(); }
        else expect(other.resolveControlled(chooseTrade)).toBe(true);
      }
    }
    expect(inShop).toBe(true);
    expect(readFinancialConfig().jokers).toHaveLength(18);
    expect(readFinancialConfig().items).toHaveLength(24);
  });
});

/** Plays to the first shop with everyone holding `allocation`, then returns the run with the player's shop open. */
function toShop(config = readFinancialConfig(), allocation = 'cash', seed = 91) {
  const run = start(config, seed);
  while (!run.shop) {
    while (run.offer) run.chooseOffer(null);
    if (run.shop) break;
    expect(run.resolveControlled(hold(allocation))).toBe(true);
  }
  return run;
}

describe('商店', () => {
  it('第 3、6、9、12 日收盤後開店：三張王牌加兩張道具，依稀有度定價，離開前不能交易', () => {
    const config = readFinancialConfig();
    const run = start(config);
    const opened: number[] = [];
    while (!run.closed) {
      settleOffers(run);
      if (run.closed) break;
      expect(run.resolveControlled(hold('cash'))).toBe(true);
      while (run.offer) run.chooseOffer(null);
      if (run.shop) {
        opened.push(run.shop.day);
        const kinds = run.shop.slots.map(slot => slot.kind);
        expect(kinds).toEqual(['joker', 'joker', 'joker', 'item', 'item']);
        for (const slot of run.shop.slots) expect(slot.base).toBe(config.shop.price[slot.kind][slot.card.rarity]);
        const jokers = run.shop.slots.filter(slot => slot.kind === 'joker').map(slot => slot.card.id);
        expect(new Set(jokers).size).toBe(3);
        expect(jokers.some(id => run.player.jokers.some(card => card.id === id))).toBe(false);
        expect(run.resolveControlled(hold('cash'))).toBe(false);
        expect(run.leaveShop()).toBe(true);
      }
    }
    expect(opened).toEqual([3, 6, 9, 12]);
  });

  it('購買只花現金：扣款精確、總身家減少售價；現金不足時顯示差額且什麼都不變', () => {
    const run = toShop();
    const before = netWorth(run.player.account);
    const index = run.shop!.slots.findIndex(slot => slot.kind === 'item');
    const price = run.shopCheck(index).price;
    expect(run.shopCheck(index).needsReplace).toBe(true);
    run.player.items.pop();
    const items = run.player.items.length;
    const purchase = run.buy(index);
    expect(purchase).toMatchObject({ price, refund: 0, replaced: null });
    expect(netWorth(run.player.account)).toBe(before - price);
    expect(run.player.items).toHaveLength(Math.min(items + 1, run.config.gameplay.itemSlots));
    expect(run.buy(index)).toBeNull();
    expect(run.shopCheck(index).block).toBe('sold');

    const joker = run.shop!.slots.findIndex(slot => slot.kind === 'joker');
    Object.assign(run.player.account, { cash: 100, investmentValue: 20000 });
    const check = run.shopCheck(joker);
    expect(check).toMatchObject({ block: 'cash', shortfall: check.price - 100 });
    expect(run.buy(joker)).toBeNull();
    expect(run.player.account.cash).toBe(100);
    expect(run.player.stats.spent).toBe(price);
  });

  it('王牌滿五張要換掉一張，舊牌以兩成五低價回收；已持有的王牌不能重買', () => {
    const config = readFinancialConfig();
    const run = toShop(config);
    const shelf = run.shop!.slots.filter(slot => slot.kind === 'joker').map(slot => slot.card.id);
    const owned = config.jokers.filter(card => !shelf.includes(card.id) && card.id !== 'thrifty').slice(0, 5);
    run.player.jokers = [...owned];
    run.player.account.cash = 5000;
    const index = 0;
    expect(run.shopCheck(index)).toMatchObject({ needsReplace: true, block: 'full' });
    expect(run.buy(index)).toBeNull();
    const price = run.shopCheck(index, 2).price;
    const purchase = run.buy(index, 2)!;
    expect(purchase.replaced!.id).toBe(owned[2].id);
    expect(purchase.refund).toBe(Math.floor(config.shop.price.joker[owned[2].rarity] * config.shop.sellRate));
    expect(run.player.account.cash).toBe(5000 - price + purchase.refund);
    expect(run.player.jokers).toHaveLength(5);
    expect(run.player.jokers[2].id).toBe(shelf[0]);
    expect(run.player.stats.spent).toBe(price - purchase.refund);

    run.shop!.slots[1] = { ...run.shop!.slots[1], card: run.player.jokers[0], sold: false };
    expect(run.shopCheck(1, 0).block).toBe('owned');
  });

  it('精打細算打七折；回收價高於折扣價的設定在啟動時被拒絕，不能低買高賣', () => {
    const config = readFinancialConfig();
    const run = toShop(config);
    run.player.account.cash = 5000;
    const full = run.shopCheck(0).price;
    run.player.jokers = [joker(config, 'thrifty')];
    expect(run.shopCheck(0).price).toBe(Math.round(full * 0.7));
    for (const card of config.jokers) {
      expect(Math.floor(config.shop.price.joker[card.rarity] * config.shop.sellRate)).toBeLessThan(Math.round(config.shop.price.joker[card.rarity] * 0.7));
    }
    const raw = structuredClone(financialInput);
    raw.shop.sellRate = 0.85;
    expect(() => readFinancialConfig(raw)).toThrow('王牌回收價不得高於折扣後售價');
  });

  it('電腦用同樣價格買、只花自己的現金；逛不逛商店都不改變共同市場與新聞', () => {
    const summary = (shopping: boolean) => {
      const run = start(readFinancialConfig(), 17);
      while (!run.closed) {
        while (run.offer) run.chooseOfferAutomatically();
        if (run.shop) { if (shopping) run.shopAutomatically(); else run.leaveShop(); continue; }
        expect(run.resolveControlled(chooseTrade)).toBe(true);
        if (run.pendingRecovery) run.acceptRecovery();
      }
      return run;
    };
    const buying = summary(true);
    const leaving = summary(false);
    const market = (run: TradingRun) => run.reports.map(report => [report.market?.id ?? null, report.outcomes[0].ledger.rate]);
    expect(market(buying)).toEqual(market(leaving));
    let purchases = 0;
    for (const investor of buying.investors) {
      for (const purchase of investor.purchases) {
        // Same list price as the player; only a 精打細算 owned at the time can lower it.
        const base = buying.config.shop.price[purchase.kind][purchase.card.rarity];
        expect([base, Math.round(base * 0.8)]).toContain(purchase.price);
        purchases++;
      }
      expect(investor.account.cash).toBeGreaterThanOrEqual(0);
    }
    expect(purchases).toBeGreaterThan(0);
  });

  it('商店日電腦會多留現金，其他日子不受影響', () => {
    const run = start(calmMarket(readFinancialConfig()));
    equip(run, run.investors[1], []);
    const view = run.decisionView(run.investors[1]);
    expect(view.shopToday).toBe(false);
    const shopView = { ...view, shopToday: true, eventToday: false };
    const plain = { ...view, eventToday: false };
    const pick = (sample: typeof view) => chooseTrade(sample, seededRandom(1), 'mixed', 'hard').allocation;
    expect(pick(plain)).toBe('all');
    expect(pick(shopView)).not.toBe('all');
  });
});

describe('歸零與翻身', () => {
  it('四人同時歸零：玩家先決定翻身，翻身只有一次並保留王牌，第二次全部出局會立即收盤', () => {
    const run = start(calmMarket(readFinancialConfig(), 0));
    for (const investor of run.investors) equip(run, investor, ['diamond'], ['gift']);
    for (const investor of run.investors) Object.assign(investor.account, { cash: 0, investmentValue: 0 });
    expect(run.resolveControlled(hold('half'))).toBe(true);
    expect(run.pendingRecovery).not.toBeNull();
    expect(run.acceptRecovery()).toBe(true);
    for (const investor of run.investors) {
      expect(investor.recoveries).toBe(1);
      expect(netWorth(investor.account)).toBe(run.config.financial.recoveryCash);
      expect(investor.items).toEqual([]);
      expect(investor.jokers.map(card => card.id)).toEqual(['diamond']);
    }
    for (const investor of run.investors) Object.assign(investor.account, { cash: 0, investmentValue: 0 });
    expect(run.resolveControlled(hold('half'))).toBe(true);
    expect(run.pendingRecovery).toBeNull();
    expect(run.investors.every(investor => investor.account.eliminated)).toBe(true);
    expect(run.closed).toBe(true);
  });
});
