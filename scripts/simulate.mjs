import { createServer } from 'vite';

const seeds = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(seeds) || seeds < 1) throw new Error('種子數須為正整數');
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });

try {
  const { readFinancialConfig } = await server.ssrLoadModule('/src/config/financial-settings.ts');
  const { TradingRun } = await server.ssrLoadModule('/src/core/trading-run.ts');
  const { chooseTrade, strategies } = await server.ssrLoadModule('/src/core/npc-strategy.ts');
  const { netWorth } = await server.ssrLoadModule('/src/core/economy.ts');
  const config = readFinancialConfig();

  const fraction = (total, count) => count ? total / count : 0;
  const round = number => Number(number.toFixed(4));
  const distribution = values => {
    const ordered = [...values].sort((a, b) => a - b);
    const percentile = q => ordered[Math.floor((ordered.length - 1) * q)];
    return [percentile(0.1), percentile(0.5), percentile(0.9)].map(round);
  };

  function play(seed, strategy) {
    const playerId = config.characters[(seed - 1) % 4].id;
    const run = new TradingRun(config, { seed, playerId, difficulty: 'normal' });
    while (!run.closed) {
      if (run.pendingRecovery) run.acceptRecovery();
      while (run.offer) {
        if (!run.chooseOfferAutomatically()) throw new Error(`無法解決手牌提案，種子 ${seed}`);
      }
      if (run.closed) break;
      const planner = (view, random) => chooseTrade(view, random, strategy === 'mirror' ? 'mixed' : strategy, 'normal');
      const accepted = run.resolveControlled((view, random) =>
        view.characterId === playerId ? planner(view, random) : chooseTrade(view, random));
      if (!accepted) throw new Error(`無法結算日 ${run.day}，種子 ${seed}`);
    }
    return run;
  }

  const leaderboard = [];
  for (const strategy of strategies) {
    const wealth = [];
    const drawdowns = [];
    const visits = {};
    let wins = 0;
    let warnings = 0;
    let liquidations = 0;
    let bankruptcies = 0;
    let repeatBankruptcies = 0;
    let recovered = 0;
    let recoveredAlive = 0;
    let recoveredWins = 0;
    let cards = 0;
    let synergies = 0;
    let turnCount = 0;
    let comeback = 0;
    let forgiven = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const run = play(seed, strategy);
      const player = run.player;
      const { account } = player;
      const leaders = run.standings().filter(item => item.rank === 1);
      const win = leaders.some(item => item.investor === player) ? 1 / leaders.length : 0;
      wins += win;
      wealth.push(netWorth(account));
      drawdowns.push(account.maxDrawdown);
      warnings += Number(account.stats.warnings > 0);
      liquidations += Number(account.stats.liquidations > 0);
      bankruptcies += Number(account.bankruptcyCount > 0);
      repeatBankruptcies += Number(account.bankruptcyCount > 1);
      recovered += Number(player.recoveries > 0);
      recoveredAlive += Number(player.recoveries > 0 && !account.eliminated);
      recoveredWins += player.recoveries > 0 ? win : 0;
      cards += player.used;
      synergies += player.synergies;
      turnCount += player.path.length;
      comeback += Number(win > 0 && player.ranks.slice(1, -1).some(rank => rank !== null && rank > 1));
      forgiven += account.stats.debtForgiven;
      for (const node of player.path) visits[node.kind] = (visits[node.kind] ?? 0) + 1;
    }
    const roi = wealth.map(value => value / config.financial.initialCapital - 1);
    const entry = {
      strategy, winRate: round(wins / seeds), meanNetWorth: round(wealth.reduce((sum, amount) => sum + amount, 0) / seeds),
      netWorthP10P50P90: distribution(wealth), returnP10P50P90: distribution(roi),
      drawdownP10P50P90: distribution(drawdowns), warningRate: round(warnings / seeds),
      liquidationRate: round(liquidations / seeds), firstBankruptcyRate: round(bankruptcies / seeds),
      secondBankruptcyRate: round(repeatBankruptcies / seeds), recoveryCount: recovered,
      recoverySurvivalRate: round(fraction(recoveredAlive, recovered)), recoveryWinRate: round(fraction(recoveredWins, recovered)),
      forgivenDebtPerRecovery: round(fraction(forgiven, recovered)), cardUsageRate: round(fraction(cards, turnCount)),
      synergyRate: round(fraction(synergies, turnCount)), comebackRate: round(comeback / seeds),
      nodeRates: Object.fromEntries(Object.entries(visits).sort().map(([kind, total]) => [kind, round(fraction(total, turnCount))]))
    };
    leaderboard.push(entry);
    console.error(`${strategy}：${entry.winRate} 勝率、${entry.firstBankruptcyRate} 首次破產率、平均 ${entry.meanNetWorth}`);
  }

  const characterWins = Object.fromEntries(config.characters.map(character => [character.id, 0]));
  for (let seed = 1; seed <= seeds; seed++) {
    const leaders = play(seed, 'mirror').standings().filter(item => item.rank === 1);
    for (const { investor } of leaders) characterWins[investor.character.id] += 1 / leaders.length;
  }
  const dominance = leaderboard.map(entry => entry.winRate).sort((a, b) => b - a);
  console.log(JSON.stringify({
    seeds, startingSeed: 1, characterWinRates: Object.fromEntries(Object.entries(characterWins).map(([id, wins]) => [id, round(wins / seeds)])),
    gapBetweenTopStrategies: round(dominance[0] - dominance[1]), leaderboard
  }, null, 2));
} finally {
  await server.close();
}
