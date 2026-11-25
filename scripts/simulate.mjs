import { createServer } from 'vite';

const seeds = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(seeds) || seeds < 1) throw new Error('種子數須為正整數');
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });

try {
  const { readFinancialConfig } = await server.ssrLoadModule('/src/config/financial-settings.ts');
  const { TradingRun } = await server.ssrLoadModule('/src/core/trading-run.ts');
  const { chooseTrade, strategies, holderStyle } = await server.ssrLoadModule('/src/core/npc-strategy.ts');
  const { netWorth } = await server.ssrLoadModule('/src/core/economy.ts');
  const config = readFinancialConfig();

  const fraction = (total, count) => count ? total / count : 0;
  const round = number => Number(number.toFixed(4));
  const mean = values => fraction(values.reduce((sum, value) => sum + value, 0), values.length);
  const distribution = values => {
    const ordered = [...values].sort((a, b) => a - b);
    const percentile = q => ordered[Math.floor((ordered.length - 1) * q)];
    return [percentile(0.1), percentile(0.5), percentile(0.9)].map(round);
  };

  /** Player seat uses `strategy`; the three rivals always use the computer's default style. */
  function play(seed, strategy, settings = config, shopping = true) {
    const playerId = config.characters[(seed - 1) % 4].id;
    const run = new TradingRun(settings, { seed, playerId, difficulty: 'normal' });
    while (!run.closed) {
      if (run.pendingRecovery) run.acceptRecovery();
      while (run.offer) if (!run.chooseOfferAutomatically()) throw new Error(`無法處理卡片提案，種子 ${seed}`);
      if (run.shop) { if (shopping) run.shopAutomatically(); else run.leaveShop(); }
      if (run.closed) break;
      const accepted = run.resolveControlled((view, random) =>
        view.characterId === playerId ? chooseTrade(view, random, strategy, 'normal') : chooseTrade(view, random));
      if (!accepted) throw new Error(`無法結算第 ${run.day} 日，種子 ${seed}`);
    }
    return run;
  }

  const winShare = (run, investor) => {
    const leaders = run.standings().filter(item => item.rank === 1);
    return leaders.some(item => item.investor === investor) ? 1 / leaders.length : 0;
  };

  const leaderboard = [];
  for (const strategy of strategies) {
    const wealth = [];
    const drawdowns = [];
    const bestDays = [];
    let wins = 0;
    let bankruptcies = 0;
    let eliminated = 0;
    let days = 0;
    let items = 0;
    let combos = 0;
    let capped = 0;
    let comeback = 0;
    let spent = 0;
    let bought = 0;
    const allocations = {};
    for (let seed = 1; seed <= seeds; seed++) {
      const run = play(seed, strategy);
      const { player } = run;
      const win = winShare(run, player);
      wins += win;
      wealth.push(netWorth(player.account));
      drawdowns.push(player.account.maxDrawdown);
      bestDays.push(player.stats.bestDay?.amount ?? 0);
      bankruptcies += Number(player.account.bankruptcyCount > 0);
      eliminated += Number(player.account.eliminated);
      items += player.stats.itemsUsed;
      combos += player.stats.combos;
      spent += player.stats.spent;
      bought += player.purchases.length;
      for (const report of run.reports) {
        const outcome = report.outcomes.find(item => item.investor === player);
        if (!outcome) continue;
        days += 1;
        capped += Number(outcome.ledger.capped);
        allocations[outcome.allocation] = (allocations[outcome.allocation] ?? 0) + 1;
      }
      comeback += Number(win > 0 && player.ranks.slice(1, -1).some(rank => rank !== null && rank >= 3));
    }
    const entry = {
      strategy, winRate: round(wins / seeds), meanNetWorth: round(mean(wealth)), netWorthP10P50P90: distribution(wealth),
      drawdownP10P50P90: distribution(drawdowns), bestDayP10P50P90: distribution(bestDays),
      bankruptcyRate: round(bankruptcies / seeds), eliminationRate: round(eliminated / seeds),
      itemsPerGame: round(items / seeds), combosPerDay: round(fraction(combos, days)), cappedDayRate: round(fraction(capped, days)),
      comebackFromThirdRate: round(comeback / seeds), shopSpentPerGame: Math.round(spent / seeds), purchasesPerGame: round(bought / seeds),
      allocationRates: Object.fromEntries(Object.entries(allocations).sort().map(([id, total]) => [id, round(fraction(total, days))]))
    };
    leaderboard.push(entry);
    console.error(`${strategy}：勝率 ${entry.winRate}、平均 ${entry.meanNetWorth}、歸零 ${entry.bankruptcyRate}`);
  }

  // Four computer seats: fairness by character, and how each joker relates to winning when owned at the close.
  const characterWins = Object.fromEntries(config.characters.map(character => [character.id, 0]));
  const jokers = Object.fromEntries(config.jokers.map(joker => [joker.id, { held: 0, wins: 0, worth: 0, gain: 0 }]));
  const styleWins = { cashHeavy: [0, 0], stockHeavy: [0, 0] };
  const npcStyles = {};
  const shopBuys = Object.fromEntries([...config.jokers, ...config.items].map(card => [card.id, 0]));
  const rankSpend = [[], [], [], []];
  for (let seed = 1; seed <= seeds; seed++) {
    const run = play(seed, 'mixed');
    for (const investor of run.investors) {
      const win = winShare(run, investor);
      characterWins[investor.character.id] += win;
      for (const joker of investor.jokers) {
        const entry = jokers[joker.id];
        entry.held += 1;
        entry.wins += win;
        entry.worth += netWorth(investor.account);
        entry.gain += investor.stats.jokerGain[joker.id] ?? 0;
      }
      const cashDays = run.reports.filter(report => report.outcomes.find(item => item.investor === investor)?.allocation === 'cash').length;
      const style = cashDays >= 6 ? 'cashHeavy' : 'stockHeavy';
      styleWins[style][0] += 1;
      styleWins[style][1] += win;
      const lean = holderStyle(investor, config) ?? 'none';
      npcStyles[lean] = npcStyles[lean] ?? [0, 0];
      npcStyles[lean][0] += 1;
      npcStyles[lean][1] += win;
      for (const purchase of investor.purchases) shopBuys[purchase.card.id] += 1;
      // Does the richest seat at day 3 out-buy the rest? (A widening gap check.)
      const third = investor.closes[3];
      if (third !== undefined) rankSpend[[...run.investors].sort((a, b) => (b.closes[3] ?? 0) - (a.closes[3] ?? 0)).indexOf(investor)].push(investor.stats.spent);
    }
  }
  const jokerTable = Object.fromEntries(Object.entries(jokers).filter(([, entry]) => entry.held)
    .sort((a, b) => b[1].wins / b[1].held - a[1].wins / a[1].held)
    .map(([id, entry]) => [id, { holdRate: round(entry.held / (seeds * 4)), winRateWhenHeld: round(entry.wins / entry.held),
      meanWorth: Math.round(entry.worth / entry.held), meanGain: Math.round(entry.gain / entry.held) }]));

  const withoutRecovery = { ...config, financial: { ...config.financial, maxRecoveries: 0 } };
  const recoveryComparison = Object.fromEntries(['all', 'random'].map(strategy => {
    let wins = 0;
    for (let seed = 1; seed <= seeds; seed++) { const run = play(seed, strategy, withoutRecovery); wins += winShare(run, run.player); }
    const withRecovery = leaderboard.find(entry => entry.strategy === strategy).winRate;
    return [strategy, { withRecovery, withoutRecovery: round(wins / seeds) }];
  }));
  const shopComparison = Object.fromEntries(['mixed', 'all', 'cash'].map(strategy => {
    let wins = 0;
    for (let seed = 1; seed <= seeds; seed++) { const run = play(seed, strategy, config, false); wins += winShare(run, run.player); }
    return [strategy, { shopping: leaderboard.find(entry => entry.strategy === strategy).winRate, neverBuys: round(wins / seeds) }];
  }));
  const ranked = leaderboard.map(entry => entry.winRate).sort((a, b) => b - a);
  console.log(JSON.stringify({
    seeds, startingSeed: 1,
    characterWinRates: Object.fromEntries(Object.entries(characterWins).map(([id, wins]) => [id, round(wins / seeds)])),
    gapBetweenTopStrategies: round(ranked[0] - ranked[1]),
    styleWinRates: Object.fromEntries(Object.entries(styleWins).map(([style, [count, wins]]) => [style, { seats: count, winRate: round(fraction(wins, count)) }])),
    recoveryComparison, shopComparison,
    npcStyles: Object.fromEntries(Object.entries(npcStyles).map(([style, [count, wins]]) => [style, { share: round(count / (seeds * 4)), winRate: round(wins / count) }])),
    spentByDay3Rank: rankSpend.map(list => Math.round(mean(list))),
    shopBuysPerGame: Object.fromEntries(Object.entries(shopBuys).sort((a, b) => b[1] - a[1]).map(([id, count]) => [id, round(count / seeds)])),
    leaderboard, jokers: jokerTable
  }, null, 2));
} finally {
  await server.close();
}
