import type { FinancialConfig, InvestorCharacter, TradingCard, TradingDifficulty, TradingEvent } from '../config/financial-settings';
import { canRecover, declareBankruptcy, recoverPortfolio, type RecoveryAudit } from './bankruptcy';
import { chargeClosingCost, collectDeposits, netWorth, openPortfolio, recordWorth } from './economy';
import { generateNodeMap, type RouteNode } from './node-map';
import { cardRetention, chooseTrade, type Planner } from './npc-strategy';
import { seededRandom, weighted, type Random } from './random';
import { marketTargets } from './targets';
import { buildMarketSchedule, eligibleMarketEvents } from './market-events';
import { forecastTrade, type DecisionView, type TradeChoice } from './trade-preview';
import { applyMarket, applyTrade, copyTradingState, marketTone, settleTrade, type EffectContext, type TradingState } from './trading-effects';

export interface TradingOptions { playerId: string; seed: number; difficulty: TradingDifficulty }

export interface Investor extends TradingState {
  character: InvestorCharacter;
  hand: TradingCard[];
  path: RouteNode[];
  closes: number[];
  ranks: (number | null)[];
  used: number;
  synergies: number;
  hedgesUsed: number;
  recoveries: number;
  depositInterest: number;
}

type TradeLedger = ReturnType<typeof applyTrade>['ledger'];
export interface DayOutcome {
  investor: Investor;
  start: number;
  close: number;
  node: RouteNode | null;
  card: TradingCard | null;
  ledger: TradeLedger;
  marketPnl: number;
  openingInterest: number;
  risk: ReturnType<typeof settleTrade>;
  recovery: RecoveryAudit | null;
  clearedCards: number;
  clearedHedges: number;
  targetedRivals: string[];
  incomingCards: string[];
  marketApplied: boolean;
}

export interface DayReport {
  day: number;
  market: TradingEvent | null;
  outcomes: DayOutcome[];
}

export interface Standing { investor: Investor; rank: number | null }
interface Offer { cards: TradingCard[]; source: 'draw' | 'draft' }

function localSeed(seed: number, text: string) {
  const hash = [...text].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261);
  return seed ^ hash;
}

export class TradingRun {
  readonly map;
  readonly investors: Investor[];
  readonly player: Investor;
  readonly reports: DayReport[] = [];
  day = 1;
  closed = false;
  offer: Offer | null = null;
  pendingRecovery: DayReport | null = null;
  latestNews: { day: number; event: TradingEvent } | null = null;
  private readonly schedule: Map<number, TradingEvent>;
  private publicEventPool: TradingEvent[] = [];
  private readonly cardRandom = new Map<Investor, Random>();
  private readonly marketRoll: Random;
  private readonly drafts = new Map<Investor, TradingCard[]>();
  private readonly targetRandom: Random;

  constructor(readonly config: FinancialConfig, readonly options: TradingOptions) {
    this.map = generateNodeMap(config, options.seed);
    this.marketRoll = seededRandom(localSeed(options.seed, 'market roll'));
    this.targetRandom = seededRandom(localSeed(options.seed, 'market targeting'));
    const eventRandom = seededRandom(localSeed(options.seed, 'market schedule'));
    this.schedule = buildMarketSchedule(config, eventRandom);
    this.investors = config.characters.map(character => ({
      character, account: openPortfolio(config.financial.initialCapital), hand: [], hedges: [], intelDay: null,
      path: [], closes: [config.financial.initialCapital], ranks: [1], used: 0,
      synergies: 0, hedgesUsed: 0, recoveries: 0, depositInterest: 0
    }));
    const player = this.investors.find(investor => investor.character.id === options.playerId);
    if (!player) throw new Error('找不到選擇的投資人');
    this.player = player;
    for (const investor of this.investors) {
      this.cardRandom.set(investor, seededRandom(localSeed(options.seed, `${investor.character.id} cards`)));
      for (let count = 0; count < config.gameplay.initialHand; count++) investor.hand.push(this.draw(investor));
    }
    this.openDay();
  }

  standings(): Standing[] {
    const ordered = [...this.investors].sort((first, second) =>
      Number(first.account.eliminated) - Number(second.account.eliminated) || netWorth(second.account) - netWorth(first.account));
    const eligible = ordered.filter(item => !item.account.eliminated);
    return ordered.map(investor => ({
      investor, rank: investor.account.eliminated ? null :
        eligible.findIndex(candidate => netWorth(candidate.account) === netWorth(investor.account)) + 1
    }));
  }

  reachable(investor: Investor): RouteNode[] {
    if (this.closed || investor.account.eliminated) return [];
    const row = this.map.rows[this.day - 1];
    const lanes = investor.path.at(-1)?.next ?? row.map(node => node.lane);
    return lanes.map(lane => row[lane]);
  }

  get nextEventDay() {
    return this.eventAtOrAfter(this.day);
  }

  intelFor(investor: Investor) {
    return investor.intelDay !== null && investor.intelDay >= this.day ? this.schedule.get(investor.intelDay) ?? null : null;
  }

  decisionView(investor: Investor, standings = this.standings()): DecisionView {
    const leader = standings.find(item => item.rank === 1)?.investor;
    const gap = leader ? netWorth(leader.account) - netWorth(investor.account) : 0;
    const rank = standings.find(item => item.investor === investor)?.rank ?? 4;
    const ahead = standings.filter(item => item.rank !== null && item.rank < rank && item.investor.account.marginDebt > 0);
    const nearestRank = ahead.at(-1)?.rank;
    return {
      config: this.config, characterId: investor.character.id, day: this.day, state: copyTradingState(investor),
      hand: [...investor.hand], routes: this.reachable(investor),
      nextRow: this.map.rows[this.day] ?? [], knownEvent: this.intelFor(investor),
      intelDay: investor.intelDay, eventToday: this.schedule.has(this.day), publicEvents: this.publicEventPool,
      nextEventDay: this.eventAtOrAfter(this.day + 1), recentLoss: this.latestNews !== null && marketTone(this.latestNews.event, this.config) === 'negative',
      eligibleAid: rank >= 3 && gap >= investor.account.initialCapital * this.config.financial.recoveryGap, rank, gap,
      opponents: ahead.filter(item => item.rank === nearestRank).map(({ investor: target }) => ({
        id: target.character.id, name: target.character.name
      }))
    };
  }

  preview(lane: number, slot: number | null, showCardImpact = false) {
    const view = this.decisionView(this.player);
    const route = view.routes.find(node => node.lane === lane);
    if (!route || (slot !== null && !view.hand[slot])) return null;
    return forecastTrade(view, route, slot === null ? null : view.hand[slot], showCardImpact);
  }

  chooseOffer(cardIndex: number | null, replace: number | null = null) {
    const offer = this.offer;
    if (!offer || (cardIndex !== null && !offer.cards[cardIndex])) return false;
    if (cardIndex !== null && !this.storeCard(this.player, offer.cards[cardIndex], replace)) return false;
    this.offer = null;
    this.showDraft();
    return true;
  }

  chooseOfferAutomatically() {
    if (!this.offer) return false;
    const { card, replace } = this.automaticCardChoice(this.player, this.offer.cards);
    return this.chooseOffer(card, replace);
  }

  confirm(choice: TradeChoice | null, chooseRival?: Planner) {
    return this.resolve(investor => {
      if (investor === this.player) return choice;
      return undefined;
    }, chooseRival);
  }

  /** 共用交易入口，策略函式只取得該投資人在開盤時可見的資料。 */
  resolveControlled(planner: Planner) {
    return this.resolve(() => undefined, planner);
  }

  acceptRecovery() {
    const report = this.pendingRecovery;
    if (!report) return false;
    this.pendingRecovery = null;
    this.finishDay(report);
    return true;
  }

  private resolve(override: (investor: Investor) => TradeChoice | null | undefined, planner?: Planner) {
    if (this.closed || this.offer || this.pendingRecovery) return false;
    const standings = this.standings();
    const active = this.investors.filter(investor => !investor.account.eliminated);
    const choices = active.map(investor => {
      const view = this.decisionView(investor, standings);
      const random = seededRandom(localSeed(this.options.seed, `${investor.character.id} decision ${this.day}`));
      const choice = override(investor);
      const pick = choice === undefined ? (planner ? planner(view, random) : chooseTrade(view, random, 'mixed', this.options.difficulty)) : choice;
      const route = view.routes.find(node => node.lane === pick?.lane);
      const card = pick?.card != null ? view.hand[pick.card] : null;
      if (!pick || !route || (pick.card !== null && (!card || !forecastTrade(view, route, card).enabledCard))) return null;
      return { investor, route, card, slot: pick.card, view };
    });
    if (choices.some(choice => !choice)) return false;

    const market = this.schedule.get(this.day) ?? null;
    const marketRandom = this.marketRoll();
    const roll = this.marketRoll();
    const ranked = standings.filter(item => item.rank !== null).map(item => ({ ...item, tie: this.targetRandom() }))
      .sort((first, second) => first.rank! - second.rank! || first.tie - second.tie)
      .map(item => item.investor);
    const targets = market ? new Set(marketTargets(market.target, ranked, this.targetRandom)) : new Set<Investor>();
    const interference = new Map<string, TradingCard[]>();
    for (const choice of choices) {
      if (!choice?.card?.opponent) continue;
      for (const target of choice.view.opponents) {
        const pending = interference.get(target.id) ?? [];
        pending.push(choice.card);
        interference.set(target.id, pending);
      }
    }
    const outcomes = choices.map(choice => {
      const { investor, route, card, slot, view } = choice!;
      const start = investor.closes.at(-1)!;
      const kind = this.config.nodes.kinds[route.kind];
      const context: EffectContext = { config: this.config, day: this.day, eventDay: view.nextEventDay,
        recentLoss: view.recentLoss, marketDraw: roll, eligibleAid: view.eligibleAid, opponentCount: view.opponents.length };
      const action = applyTrade(investor, kind, card ?? null, context);
      if (slot !== null && action.cardUsed) {
        investor.hand.splice(slot, 1);
        investor.used += 1;
        investor.synergies += action.ledger.synergies;
      }
      investor.path.push(route);
      return { investor, route, card: action.cardUsed ? card ?? null : null, start, context, action,
        targetedRivals: card?.opponent ? view.opponents.map(target => target.name) : [] };
    });
    const report: DayReport = {
      day: this.day, market, outcomes: outcomes.map(({ investor, route, card, start, context, action, targetedRivals }) => {
        const worthBeforeMarket = netWorth(investor.account);
        const incoming = interference.get(investor.character.id) ?? [];
        for (const source of incoming) applyMarket(investor, source, context, action.ledger);
        const marketApplied = market !== null && targets.has(investor);
        if (market && marketApplied) applyMarket(investor, market, { ...context, marketDraw: marketRandom }, action.ledger);
        const marketPnl = netWorth(investor.account) - worthBeforeMarket;
        if (investor.intelDay === this.day) investor.intelDay = null;
        if (action.ledger.protected) investor.hedgesUsed += 1;
        const risk = settleTrade(investor, action.ledger, this.config, this.day === this.config.gameplay.turns);
        if (action.draft && !risk.insolvent) this.awardDraft(investor);
        return {
          investor, node: route, card, start, close: netWorth(investor.account), ledger: action.ledger, marketPnl,
          openingInterest: investor.depositInterest, risk, recovery: null, clearedCards: 0, clearedHedges: 0,
          targetedRivals, incomingCards: incoming.map(item => item.name), marketApplied
        };
      })
    };
    if (market) this.latestNews = { day: this.day, event: market };
    if (report.outcomes.some(outcome => outcome.investor === this.player && this.eligibleForRecovery(outcome))) {
      this.pendingRecovery = report;
    } else {
      this.finishDay(report);
    }
    return true;
  }

  private eligibleForRecovery(outcome: DayOutcome) {
    return outcome.risk.insolvent && canRecover(outcome.investor.account, this.day, this.config.gameplay.turns, this.config.financial);
  }

  private finishDay(report: DayReport) {
    for (const outcome of report.outcomes) {
      const investor = outcome.investor;
      recordWorth(investor.account, outcome.close);
      if (!outcome.risk.insolvent) continue;
      const eligible = this.eligibleForRecovery(outcome);
      declareBankruptcy(investor.account);
      if (eligible) {
        outcome.clearedCards = investor.hand.length;
        outcome.clearedHedges = investor.hedges.length;
        outcome.recovery = recoverPortfolio(investor.account, this.day, this.config.financial);
        investor.hand = [];
        investor.hedges = [];
        investor.intelDay = null;
        investor.recoveries += 1;
      } else {
        outcome.ledger.fees += chargeClosingCost(investor.account);
        investor.account.eliminated = true;
      }
      outcome.close = netWorth(investor.account);
      recordWorth(investor.account, outcome.close);
    }
    for (const { investor, rank } of this.standings()) {
      if (investor.closes.length === this.day && report.outcomes.some(outcome => outcome.investor === investor)) {
        investor.closes.push(netWorth(investor.account));
        investor.ranks.push(rank);
      }
    }
    this.reports.push(report);
    if (this.day >= this.config.gameplay.turns || this.investors.every(investor => investor.account.eliminated)) {
      this.closed = true;
      this.drafts.clear();
      return;
    }
    this.day += 1;
    this.openDay();
  }

  private openDay() {
    this.publicEventPool = this.schedule.has(this.day) ? eligibleMarketEvents(this.config,
      this.reports.flatMap(report => report.market ? [report.market] : [])) : [];
    for (const investor of this.investors) {
      if (investor.account.eliminated) continue;
      investor.depositInterest = collectDeposits(investor.account, this.day, this.config.financial);
      const card = this.draw(investor);
      if (investor.hand.length < this.config.gameplay.inventorySize) this.storeCard(investor, card, null);
      else if (investor === this.player) this.offer = { cards: [card], source: 'draw' };
      else this.acceptBestCard(investor, [card]);
      const draft = this.drafts.get(investor);
      if (draft && investor !== this.player) {
        this.acceptBestCard(investor, draft);
        this.drafts.delete(investor);
      }
    }
    this.showDraft();
  }

  private draw(investor: Investor) {
    return weighted(this.config.cards, this.cardRandom.get(investor)!);
  }

  private eventAtOrAfter(day: number) {
    const spacing = this.config.gameplay.eventEvery;
    const next = Math.ceil(day / spacing) * spacing;
    return next <= this.config.gameplay.turns ? next : null;
  }

  private awardDraft(investor: Investor) {
    if (this.day === this.config.gameplay.turns) return;
    const pool = [...this.config.cards];
    const random = this.cardRandom.get(investor)!;
    const cards = Array.from({ length: 3 }, () => {
      const card = weighted(pool, random);
      pool.splice(pool.indexOf(card), 1);
      return card;
    });
    this.drafts.set(investor, cards);
  }

  private showDraft() {
    const draft = this.drafts.get(this.player);
    if (this.offer || !draft) return;
    this.offer = { cards: draft, source: 'draft' };
    this.drafts.delete(this.player);
  }

  private storeCard(investor: Investor, card: TradingCard, replace: number | null) {
    if (investor.hand.length < this.config.gameplay.inventorySize) investor.hand.push(card);
    else if (replace !== null && investor.hand[replace]) investor.hand[replace] = card;
    else return false;
    return true;
  }

  private acceptBestCard(investor: Investor, offered: TradingCard[]) {
    const { card, replace } = this.automaticCardChoice(investor, offered);
    if (card !== null) this.storeCard(investor, offered[card], replace);
  }

  private automaticCardChoice(investor: Investor, offered: TradingCard[]) {
    const value = (card: TradingCard) => cardRetention(card, this.config);
    const best = offered.reduce((slot, card, index) => value(card) > value(offered[slot]) ? index : slot, 0);
    const slot = investor.hand.reduce((worst, card, index) => value(card) < value(investor.hand[worst]) ? index : worst, 0);
    if (investor.hand.length < this.config.gameplay.inventorySize) return { card: best, replace: null };
    return value(offered[best]) > value(investor.hand[slot]) ? { card: best, replace: slot } : { card: null, replace: null };
  }
}
