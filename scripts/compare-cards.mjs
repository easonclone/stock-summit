const variants = {
  A: { baseEffects: false, preparations: false, exchangeLimit: 0, freeStarter: false },
  B: { baseEffects: true, preparations: false, exchangeLimit: 0, freeStarter: false },
  C: { baseEffects: true, preparations: true, exchangeLimit: 0, freeStarter: false },
  D: { baseEffects: true, preparations: true, exchangeLimit: 3, freeStarter: true }
};

const ratio = (numerator, denominator) => denominator ? Number((numerator / denominator).toFixed(5)) : 0;

export function compareCards({ seeds, config, TradingRun, chooseTrade, strategies, handAvailability, netWorth }) {
  const report = {};
  for (const [variant, cardRules] of Object.entries(process.argv.includes('--expanded') ? { E: config.cardRules } : variants)) {
    const settings = { ...config, cardRules: { ...config.cardRules, ...cardRules, expanded: variant === 'E' } };
    report[variant] = strategies.map(strategy => {
      const totals = { hands: 0, cards: 0, usable: 0, dead: 0, routeBlocked: 0, age: 0, removed: 0, offers: 0,
        declined: 0, replacements: 0, exchanged: 0, used: 0, synergies: 0, prepared: 0, triggered: 0,
        cardGain: 0, grossGain: 0, wins: 0, bankruptcy: 0, netWorth: 0 };
      for (let seed = 1; seed <= seeds; seed++) {
        const playerId = settings.characters[(seed - 1) % settings.characters.length].id;
        const run = new TradingRun(settings, { seed, playerId, difficulty: 'normal' });
        while (!run.closed) {
          if (run.pendingRecovery) run.acceptRecovery();
          while (run.offer) if (!run.chooseOfferAutomatically()) throw new Error(`無法處理抽牌，種子 ${seed}`);
          if (run.closed) break;
          if (!run.player.account.eliminated) {
            run.exchangePlayerCardAutomatically();
            const availability = handAvailability(run.decisionView(run.player));
            const playable = availability.filter(card => card.usable).length;
            if (availability.length) totals.hands++;
            if (availability.length && !playable) totals.dead++;
            totals.cards += availability.length;
            totals.usable += playable;
            totals.routeBlocked += availability.filter(card => card.routeBlocked).length;
          }
          if (!run.resolveControlled((view, random) => chooseTrade(view, random, view.characterId === playerId ? strategy : 'mixed'))) {
            throw new Error(`無法結算，種子 ${seed}／第 ${run.day} 日`);
          }
        }
        const player = run.player;
        const leaders = run.standings().filter(standing => standing.rank === 1);
        if (leaders.some(standing => standing.investor === player)) totals.wins += 1 / leaders.length;
        totals.bankruptcy += Number(player.account.bankruptcyCount > 0);
        totals.netWorth += netWorth(player.account);
        totals.age += player.cardStats.age;
        totals.removed += player.cardStats.removed;
        totals.offers += player.cardStats.offers;
        totals.declined += player.cardStats.declined;
        totals.replacements += player.cardStats.replacements;
        totals.exchanged += player.cardStats.exchanged;
        totals.used += player.used;
        totals.synergies += player.synergies;
        for (const day of run.reports) {
          const outcome = day.outcomes.find(entry => entry.investor === player);
          if (!outcome) continue;
          const ledger = outcome.ledger;
          totals.prepared += Number(outcome.preparationPlaced);
          totals.triggered += ledger.preparedTriggers;
          totals.cardGain += ledger.cardGain;
          totals.grossGain += Math.max(0, ledger.investmentPnl - ledger.stockCardGain) + ledger.stockCardGain +
            ledger.dividends + ledger.cashYield + outcome.openingInterest + outcome.openingStockIncome + ledger.feeSaved;
        }
      }
      const result = {
        strategy, playablePerHand: ratio(totals.usable, totals.hands), deadHandRate: ratio(totals.dead, totals.hands),
        routeBlockedRate: ratio(totals.routeBlocked, totals.cards), retainedDays: ratio(totals.age, totals.removed),
        discardRate: ratio(totals.declined, totals.offers), replaceRate: ratio(totals.replacements, totals.offers),
        exchangesPerGame: ratio(totals.exchanged, seeds), cardUseRate: ratio(totals.used, totals.hands),
        pairingRate: ratio(totals.synergies, totals.used), preparationTriggerRate: ratio(totals.triggered, totals.prepared),
        cardGainShare: ratio(totals.cardGain, totals.grossGain),
        winRate: ratio(totals.wins, seeds), bankruptcyRate: ratio(totals.bankruptcy, seeds),
        meanNetWorth: ratio(totals.netWorth, seeds)
      };
      console.error(`${variant} ${strategy}：${result.playablePerHand} 張可用、${result.deadHandRate} 卡手率`);
      return result;
    });
  }
  return { seeds, variants: report };
}
