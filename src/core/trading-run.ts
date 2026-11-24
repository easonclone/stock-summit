import type { FinancialConfig, InvestorCharacter, TradingCard, TradingDifficulty, TradingEvent } from '../config/financial-settings';
import { canRecover, declareBankruptcy, recoverPortfolio, type RecoveryAudit } from './bankruptcy';
import { canBorrow, chargeClosingCost, collectDeposits, netWorth, openPortfolio, recordWorth } from './economy';
import { generateNodeMap, type RouteNode } from './node-map';
import { cardRetention, chooseTrade, type Planner } from './npc-strategy';
import { seededRandom, weighted, type Random } from './random';
import { marketTargets } from './targets';
import { buildMarketSchedule, eligibleMarketEvents } from './market-events';
import { forecastTrade, handAvailability, inspectCard, targetsFor, type DecisionView, type TradeChoice } from './trade-preview';
import { applyCompetition, applyMarket, applyTrade, openingCardIncome, copyTradingState, marketTone, settleTrade, type EffectContext, type TradingState } from './trading-effects';

export interface TradingOptions { playerId: string; seed: number; difficulty: TradingDifficulty }

export interface Investor extends TradingState {
  character: InvestorCharacter;
  hand: TradingCard[];
  handSince: number[];
  exchangeLeft: number;
  cardStats: { age: number; removed: number; offers: number; declined: number; replacements: number; exchanged: number };
  path: RouteNode[];
  closes: number[];
  ranks: (number | null)[];
  used: number;
  synergies: number;
  hedgesUsed: number;
  recoveries: number;
  depositInterest: number;
  openingCardGain: number;
  openingStockIncome: number;
  openingCardTriggers: number;
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
  openingStockIncome: number;
  risk: ReturnType<typeof settleTrade>;
  recovery: RecoveryAudit | null;
  clearedCards: number;
  clearedHedges: number;
  targetedRivals: string[];
  incomingCards: string[];
  marketApplied: boolean;
  preparationPlaced: boolean;
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
  private readonly cardPool: TradingCard[];
  private readonly exchangeRandom = new Map<Investor, Random>();
  private readonly cardRandom = new Map<Investor, Random>();
  private readonly marketRoll: Random;
  private readonly bonusOffers = new Map<Investor, TradingCard>();
  private readonly drafts = new Map<Investor, TradingCard[]>();
  private readonly targetRandom: Random;

  constructor(readonly config: FinancialConfig, readonly options: TradingOptions) {
    this.cardPool = config.cards.filter(card => (!card.preparationOnly || config.cardRules.preparations) && (!card.expandedOnly || config.cardRules.expanded));
    this.map = generateNodeMap(config, options.seed);
    this.marketRoll = seededRandom(localSeed(options.seed, 'market roll'));
    this.targetRandom = seededRandom(localSeed(options.seed, 'market targeting'));
    const eventRandom = seededRandom(localSeed(options.seed, 'market schedule'));
    this.schedule = buildMarketSchedule(config, eventRandom);
    this.investors = config.characters.map(character => ({
      character, account: openPortfolio(config.financial.initialCapital), hand: [], handSince: [], hedges: [], intelDay: null, extraIntel: [], usedRelief: false, prepared: [],
      exchangeLeft: config.cardRules.exchangeLimit, cardStats: { age: 0, removed: 0, offers: 0, declined: 0, replacements: 0, exchanged: 0 },
      path: [], closes: [config.financial.initialCapital], ranks: [1], used: 0,
      synergies: 0, hedgesUsed: 0, recoveries: 0, depositInterest: 0, openingCardGain: 0, openingStockIncome: 0, openingCardTriggers: 0
    }));
    const player = this.investors.find(investor => investor.character.id === options.playerId);
    if (!player) throw new Error('找不到選擇的投資人');
    this.player = player;
    for (const investor of this.investors) {
      this.cardRandom.set(investor, seededRandom(localSeed(options.seed, `${investor.character.id} cards`)));
      this.exchangeRandom.set(investor, seededRandom(localSeed(options.seed, `${investor.character.id} exchange`)));
      for (let count = 0; count < config.gameplay.initialHand; count++) this.storeCard(investor, this.draw(investor), null);
      if (config.cardRules.freeStarter && !investor.hand.some(card => card.freedom === 'free')) {
        investor.hand[0] = this.pickCard(this.cardPool.filter(card => card.freedom === 'free'), this.cardRandom.get(investor)!);
      }
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

  intelligenceFor(investor: Investor) {
    return [investor.intelDay, ...investor.extraIntel].flatMap(day => {
      const event = day !== null && day >= this.day ? this.schedule.get(day) : undefined;
      return event ? [{ day, event }] : [];
    });
  }

  decisionView(investor: Investor, standings = this.standings()): DecisionView {
    const leader = standings.find(item => item.rank === 1)?.investor;
    const gap = leader ? netWorth(leader.account) - netWorth(investor.account) : 0;
    const rank = standings.find(item => item.investor === investor)?.rank ?? 4;
    const ahead = standings.filter(item => item.rank !== null && item.rank < rank);
    const nearest = (matches: (target: Investor) => boolean) => {
      const candidates = ahead.filter(item => matches(item.investor));
      const nearestRank = candidates.at(-1)?.rank;
      return candidates.filter(item => item.rank === nearestRank).map(({ investor: target }) => ({
        id: target.character.id, name: target.character.name
      }));
    };
    const opponents = nearest(target => target.account.marginDebt > 0);
    const nextEventDay = this.eventAtOrAfter(this.day + 1);
    return {
      config: this.config, characterId: investor.character.id, day: this.day, state: copyTradingState(investor),
      hand: [...investor.hand], routes: this.reachable(investor),
      nextRow: this.map.rows[this.day] ?? [], knownEvent: this.intelFor(investor),
      intelDay: investor.intelDay, eventToday: this.schedule.has(this.day), publicEvents: this.publicEventPool,
      nextEventDay, followingEventDay: nextEventDay === null ? null : this.eventAtOrAfter(nextEventDay + 1), recentLoss: this.latestNews !== null && marketTone(this.latestNews.event, this.config) === 'negative',
      eligibleAid: rank >= 3 && gap >= investor.account.initialCapital * this.config.financial.recoveryGap, rank, gap,
      opponents, attackTargets: {
        nearest_ahead: opponents,
        stock_ahead: nearest(target => target.account.investmentValue > 0),
        borrow_ahead: nearest(target => canBorrow(target.account, this.day, this.config.financial) && target.account.cash > 0)
      }
    };
  }

  preview(lane: number, slot: number | null, showCardImpact = false, prepare = false) {
    const view = this.decisionView(this.player);
    const route = view.routes.find(node => node.lane === lane);
    if (!route || (slot !== null && !view.hand[slot])) return null;
    return forecastTrade(view, route, slot === null ? null : view.hand[slot], showCardImpact, prepare);
  }

  chooseOffer(cardIndex: number | null, replace: number | null = null) {
    const offer = this.offer;
    if (!offer || (cardIndex !== null && !offer.cards[cardIndex])) return false;
    if (cardIndex !== null && !this.storeCard(this.player, offer.cards[cardIndex], replace)) return false;
    this.player.cardStats.offers++;
    this.player.cardStats.declined += Number(cardIndex === null);
    this.offer = null;
    this.showDraft();
    return true;
  }

  chooseOfferAutomatically() {
    if (!this.offer) return false;
    const { card, replace } = this.automaticCardChoice(this.player, this.offer.cards);
    return this.chooseOffer(card, replace);
  }

  exchangePlayerCard(slot: number) {
    return this.exchangeCard(this.player, slot);
  }

  exchangePlayerCardAutomatically() {
    return this.maybeExchange(this.player);
  }

  private maybeExchange(investor: Investor) {
    if (!investor.exchangeLeft || !investor.hand.length || (!this.config.cardRules.expanded && (investor.hand.length < 2 || this.day === this.config.gameplay.turns))) return false;
    const availability = handAvailability(this.decisionView(investor));
    if (availability.filter(item => item.usable).length >= (this.config.cardRules.expanded ? 1 : 2)) return false;
    return this.exchangeCard(investor, availability.findIndex(item => !item.usable));
  }

  private exchangeCard(investor: Investor, slot: number) {
    if (this.closed || this.pendingRecovery || investor.account.eliminated || !investor.exchangeLeft ||
        !investor.hand[slot] || (investor === this.player && this.offer)) return false;
    const ids = new Set(investor.hand.map(card => card.id));
    const different = this.cardPool.filter(card => !ids.has(card.id));
    const pool = different.length ? different : this.cardPool.filter(card => card.id !== investor.hand[slot].id);
    if (!pool.length) return false;
    const view = this.config.cardRules.expanded ? this.decisionView(investor) : null;
    const usable = view ? pool.filter(card => view.routes.some(route => inspectCard(view, route, card).cardUsed)) : [];
    this.recordRemoval(investor, slot);
    investor.hand[slot] = this.pickCard(usable.length ? usable : pool, this.exchangeRandom.get(investor)!);
    investor.handSince[slot] = this.day;
    investor.exchangeLeft--;
    investor.cardStats.exchanged++;
    return true;
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
      if (!pick || !route || (pick.card !== null && (!card || !forecastTrade(view, route, card, false, pick.prepare).enabledCard))) return null;
      return { investor, route, card, slot: pick.card, prepare: pick.prepare, view };
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
      for (const target of targetsFor(choice.view, choice.card)) {
        const pending = interference.get(target.id) ?? [];
        pending.push(choice.card);
        interference.set(target.id, pending);
      }
    }
    const outcomes = choices.map(choice => {
      const { investor, route, card, slot, prepare, view } = choice!;
      const start = investor.closes.at(-1)!;
      const kind = this.config.nodes.kinds[route.kind];
      const incoming = interference.get(investor.character.id) ?? [];
      const incomingEffects = incoming.flatMap(source => source.effectIds.map(id => this.config.effects[id]));
      const context: EffectContext = { config: this.config, day: this.day, eventDay: view.nextEventDay,
        recentLoss: view.recentLoss, marketDraw: roll, eligibleAid: view.eligibleAid,
        opponentCount: targetsFor(view, card ?? null).length, followingEventDay: view.followingEventDay,
        marketToday: market !== null, creditBlocked: incomingEffects.some(effect => effect.type === 'attack' && effect.mode === 'credit') };
      const action = applyTrade(investor, kind, card ?? null, context, prepare);
      action.ledger.cardGain += investor.openingCardGain;
      action.ledger.preparedTriggers += investor.openingCardTriggers;
      applyCompetition(investor, incomingEffects, action.ledger, context);
      if (slot !== null && action.cardUsed) {
        this.recordRemoval(investor, slot);
        investor.hand.splice(slot, 1);
        investor.handSince.splice(slot, 1);
        investor.used += 1;
        investor.synergies += action.ledger.synergies;
      }
      investor.path.push(route);
      return { investor, route, card: action.cardUsed ? card ?? null : null, start, context, action,
        targetedRivals: targetsFor(view, card ?? null).map(target => target.name) };
    });
    const report: DayReport = {
      day: this.day, market, outcomes: outcomes.map(({ investor, route, card, start, context, action, targetedRivals }) => {
        const worthBeforeMarket = netWorth(investor.account);
        const incoming = interference.get(investor.character.id) ?? [];
        const marketApplied = market !== null && targets.has(investor);
        if (market && marketApplied) applyMarket(investor, market, { ...context, marketDraw: marketRandom }, action.ledger);
        const marketPnl = netWorth(investor.account) - worthBeforeMarket;
        if (investor.intelDay === this.day) investor.intelDay = investor.extraIntel.shift() ?? null;
        if (action.ledger.protected) investor.hedgesUsed += 1;
        const risk = settleTrade(investor, action.ledger, this.config, this.day === this.config.gameplay.turns);
        if (!risk.insolvent && this.day < this.config.gameplay.turns) {
          if (action.draft || action.ledger.cardDraft) this.awardDraft(investor, action.ledger.cardDraft);
          if (action.ledger.bonusDraw) this.bonusOffers.set(investor, this.draw(investor));
        }
        return {
          investor, node: route, card, start, close: netWorth(investor.account), ledger: action.ledger, marketPnl,
          openingInterest: investor.depositInterest, openingStockIncome: investor.openingStockIncome, risk, recovery: null, clearedCards: 0, clearedHedges: 0,
          targetedRivals, incomingCards: incoming.map(item => item.name), marketApplied, preparationPlaced: action.preparation !== null
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
      investor.prepared = [];
      if (eligible) {
        outcome.clearedCards = investor.hand.length;
        outcome.clearedHedges = investor.hedges.length;
        outcome.recovery = recoverPortfolio(investor.account, this.day, this.config.financial);
        for (const slot of investor.hand.keys()) this.recordRemoval(investor, slot);
        investor.hand = [];
        investor.handSince = [];
        investor.hedges = [];
        investor.intelDay = null;
        investor.extraIntel = [];
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
      this.bonusOffers.clear();
      for (const investor of this.investors) investor.prepared = [];
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
      investor.prepared = investor.prepared.filter(item => item.expires >= this.day);
      const extra = openingCardIncome(investor, this.config.financial);
      investor.openingCardGain = extra.deposit + extra.stock;
      investor.openingStockIncome = extra.stock;
      investor.openingCardTriggers = extra.triggers;
      investor.depositInterest = collectDeposits(investor.account, this.day, this.config.financial) + extra.deposit;
      const card = this.draw(investor);
      if (investor.hand.length < this.config.gameplay.inventorySize) this.storeCard(investor, card, null);
      else if (investor === this.player) this.offer = { cards: [card], source: 'draw' };
      else this.acceptBestCard(investor, [card]);
      const extraCard = this.bonusOffers.get(investor);
      if (extraCard && investor !== this.player) {
        this.acceptBestCard(investor, [extraCard]);
        this.bonusOffers.delete(investor);
      }
      const draft = this.drafts.get(investor);
      if (draft && investor !== this.player) {
        this.acceptBestCard(investor, draft);
        this.drafts.delete(investor);
      }
      if (investor !== this.player) this.maybeExchange(investor);
    }
    this.showDraft();
  }

  private draw(investor: Investor) {
    const distinct = this.config.cardRules.expanded ? this.cardPool.filter(card => !investor.hand.some(held => held.id === card.id)) : [];
    return this.pickCard(distinct.length ? distinct : this.cardPool, this.cardRandom.get(investor)!);
  }

  private pickCard(pool: TradingCard[], random: Random) {
    if (!this.config.cardRules.expanded) return weighted(pool, random);
    const rarities = [...new Set(pool.map(card => card.rarity))].map(rarity => ({ rarity, weight: this.config.cardRules.rarity[rarity] }));
    const chosen = weighted(rarities, random).rarity;
    return weighted(pool.filter(card => card.rarity === chosen), random);
  }

  private eventAtOrAfter(day: number) {
    const spacing = this.config.gameplay.eventEvery;
    const next = Math.ceil(day / spacing) * spacing;
    return next <= this.config.gameplay.turns ? next : null;
  }

  private awardDraft(investor: Investor, fromCard = false) {
    if (this.day === this.config.gameplay.turns) return;
    const pool = this.cardPool.filter(card => !fromCard || !card.effectIds.some(id => this.config.effects[id].type === 'card_draft'));
    const random = this.cardRandom.get(investor)!;
    const cards = Array.from({ length: 3 }, () => {
      const card = this.pickCard(pool, random);
      pool.splice(pool.indexOf(card), 1);
      return card;
    });
    this.drafts.set(investor, cards);
  }

  private showDraft() {
    if (this.offer) return;
    const bonus = this.bonusOffers.get(this.player);
    if (bonus) {
      this.bonusOffers.delete(this.player);
      if (!this.storeCard(this.player, bonus, null)) {
        this.offer = { cards: [bonus], source: 'draw' };
        return;
      }
    }
    const draft = this.drafts.get(this.player);
    if (this.offer || !draft) return;
    this.offer = { cards: draft, source: 'draft' };
    this.drafts.delete(this.player);
  }

  private storeCard(investor: Investor, card: TradingCard, replace: number | null) {
    if (investor.hand.length < this.config.gameplay.inventorySize) {
      investor.handSince[investor.hand.length] = this.day;
      investor.hand.push(card);
    } else if (replace !== null && investor.hand[replace]) {
      this.recordRemoval(investor, replace);
      investor.hand[replace] = card;
      investor.handSince[replace] = this.day;
      investor.cardStats.replacements++;
    } else return false;
    return true;
  }

  private recordRemoval(investor: Investor, slot: number) {
    investor.cardStats.age += this.day - (investor.handSince[slot] ?? this.day);
    investor.cardStats.removed++;
  }

  private acceptBestCard(investor: Investor, offered: TradingCard[]) {
    const { card, replace } = this.automaticCardChoice(investor, offered);
    investor.cardStats.offers++;
    investor.cardStats.declined += Number(card === null);
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
