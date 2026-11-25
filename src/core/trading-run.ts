import type { FinancialConfig, GameCard, InvestorCharacter, TradingDifficulty, TradingEvent } from '../config/financial-settings';
import { canRecover, declareBankruptcy, recoverPortfolio, type RecoveryAudit } from './bankruptcy';
import { netWorth, openPortfolio, recordWorth } from './economy';
import { settleRisk } from './financial-risk';
import { buildMarketSchedule } from './market-events';
import { generatesItems, itemTiming, soldInShop } from './item-timing';
import { chooseCard, chooseTrade, planShop, type Planner } from './npc-strategy';
import { seededRandom, weighted, type Random } from './random';
import {
  playOpeningItem, climbBonus, closeDay, copyHolder, itemBlock, marketTone, newMemory, priceEffect, rateFrom, tradeDay,
  type ChainStep, type DayContext, type DayLedger, type Holder, type Tone
} from './settlement';
import { buy, checkBuy, listPrice, type Purchase, type Shop } from './shop';
import { marketTargets } from './targets';
import { attackOf, resolveAttacks, type AttackRecord } from './attacks';
import { allocationOption, attackTargets, forecastTrade, type ActionChoice, type DecisionView, type TradeChoice } from './trade-preview';

export interface TradingOptions { playerId: string; seed: number; difficulty: TradingDifficulty }

export interface InvestorStats {
  itemsUsed: number;
  combos: number;
  shields: number;
  /** Total each joker added to (or saved from) this investor's worth over the run. */
  jokerGain: Record<string, number>;
  bestDay: { day: number; amount: number } | null;
  /** The day with the most boost steps, for the end-of-run highlight. */
  bestCombo: { day: number; steps: number; amount: number } | null;
  /** Cash paid in shops, net of refunds for replaced jokers. */
  spent: number;
}

export interface Investor extends Holder {
  character: InvestorCharacter;
  /** Allocation kept between days; changed only through a locked TradeChoice. */
  allocation: string;
  closes: number[];
  ranks: (number | null)[];
  recoveries: number;
  stats: InvestorStats;
  /** Public record of every shop purchase. */
  purchases: Purchase[];
}

export type OfferSource = 'opening' | 'stage' | 'pack' | 'daily' | 'news' | 'event';
/** Cards waiting for the player: pick one of `cards` (jokers or items), replacing one when full, or skip. */
export interface Offer { kind: 'joker' | 'item'; source: OfferSource; cards: GameCard[] }

export interface DayOutcome {
  investor: Investor;
  start: number;
  close: number;
  allocation: string;
  /** Allocation held going into the day, before today's locked choice. */
  allocationBefore: string;
  item: GameCard | null;
  items: GameCard[];
  ledger: DayLedger;
  /** News impact on this investor's stock before jokers (0 when the news missed them). */
  marketPnl: number;
  marketApplied: boolean;
  risk: { insolvent: boolean };
  recovery: RecoveryAudit | null;
  clearedItems: number;
  /** Rivals whose 主力狙擊 hit this investor today. */
  attackedBy: string[];
  /** Rival this investor's 主力狙擊 hit, or null. */
  attacked: string | null;
  /** 攻擊未生效，道具已保留。 */
  attackBlocked: boolean;
  /** Cards that arrived automatically after the close (events and 消息靈通). */
  received: GameCard[];
  /** Holdings just before the market moved. Record only; lets the presentation explain who was exposed. */
  exposure: { stock: number; cash: number };
}

export interface DayReport { day: number; market: TradingEvent | null; outcomes: DayOutcome[]; attacks: AttackRecord[] }
export interface Standing { investor: Investor; rank: number | null }

function localSeed(seed: number, text: string) {
  const hash = [...text].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261);
  return seed ^ hash;
}

export class TradingRun {
  readonly investors: Investor[];
  readonly player: Investor;
  readonly reports: DayReport[] = [];
  day = 1;
  playerOpeningItem: GameCard | null = null;
  closed = false;
  pendingRecovery: DayReport | null = null;
  latestNews: { day: number; event: TradingEvent } | null = null;
  private readonly offers: Offer[] = [];
  private readonly schedule: Map<number, TradingEvent>;
  private readonly marketRoll: Random;
  private readonly targetRandom: Random;
  private readonly jokerRandom = new Map<Investor, Random>();
  private readonly itemRandom = new Map<Investor, Random>();
  private readonly jokerPool: GameCard[];
  private readonly shopRandom = new Map<Investor, Random>();
  /** The player's open stage shop; trading waits until the player leaves it. */
  shop: Shop | null = null;
  private readonly dailyShops = new Map<Investor, Shop>();
  private readonly opening = new Map<Investor, { worth: number; cards: GameCard[]; steps: ChainStep[] }>();

  constructor(readonly config: FinancialConfig, readonly options: TradingOptions) {
    this.jokerPool = config.jokers.filter(joker => !joker.shopOnly);
    this.marketRoll = seededRandom(localSeed(options.seed, 'market roll'));
    this.targetRandom = seededRandom(localSeed(options.seed, 'market targeting'));
    this.schedule = buildMarketSchedule(config, seededRandom(localSeed(options.seed, 'market schedule')));
    this.investors = config.characters.map(character => ({
      character, account: openPortfolio(config.financial.initialCapital), jokers: [], items: [], defenses: [], intel: null,
      memory: newMemory(), allocation: config.allocation.initial, closes: [config.financial.initialCapital], ranks: [1], recoveries: 0,
      stats: { itemsUsed: 0, combos: 0, shields: 0, jokerGain: {}, bestDay: null, bestCombo: null, spent: 0 }, purchases: []
    }));
    const player = this.investors.find(investor => investor.character.id === options.playerId);
    if (!player) throw new Error('找不到選擇的投資人');
    this.player = player;
    for (const investor of this.investors) {
      this.jokerRandom.set(investor, seededRandom(localSeed(options.seed, `${investor.character.id} jokers`)));
      this.itemRandom.set(investor, seededRandom(localSeed(options.seed, `${investor.character.id} items`)));
      this.shopRandom.set(investor, seededRandom(localSeed(options.seed, `${investor.character.id} shop`)));
      this.dealOpeningItems(investor);
      this.offerJokers(investor, 'opening');
      this.openDailyShop(investor);
    }
  }

  /** The player's next card decision; trading waits until every offer is settled. */
  get offer(): Offer | null {
    return this.offers[0] ?? null;
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

  get nextEventDay() {
    return this.eventAtOrAfter(this.day);
  }

  eventToday() {
    return this.schedule.has(this.day);
  }

  /** Direction of upcoming news this investor learned with an item; the exact event stays hidden. */
  intelFor(investor: Investor) {
    return investor.intel && investor.intel.day >= this.day ? investor.intel : null;
  }

  decisionView(investor: Investor, standings = this.standings()): DecisionView {
    const leader = standings.find(item => item.rank === 1)?.investor;
    const rank = standings.find(item => item.investor === investor)?.rank ?? this.investors.length;
    const rivals = standings.flatMap(({ investor: rival, rank: position }) => rival !== investor && position !== null ? [{
      id: rival.character.id, name: rival.character.name, rank: position,
      cash: rival.account.cash, stock: rival.account.investmentValue, shields: rival.defenses.length
    }] : []);
    const intel = this.intelFor(investor);
    return {
      config: this.config, characterId: investor.character.id, day: this.day, holder: copyHolder(investor), allocation: investor.allocation,
      rank, gap: leader ? netWorth(leader.account) - netWorth(investor.account) : 0,
      rivals,
      actionsLeft: Math.max(0, Math.min(this.config.gameplay.actionLimit, this.config.gameplay.itemPlayLimit - (this.opening.get(investor)?.cards.length ?? 0))),
      eventToday: this.eventToday(), nextNewsDay: this.eventAtOrAfter(this.day + 1),
      knownTone: intel && intel.day === this.day ? intel.tone : null,
      shopToday: this.shopOpensAfter(this.day)
    };
  }

  preview(allocation = this.player.allocation, item: number | null = null, targetId?: string, actions?: ActionChoice[]) {
    if (this.player.account.eliminated) return null;
    return forecastTrade(this.decisionView(this.player), allocation, item, targetId, actions);
  }

  chooseOffer(index: number | null, replace: number | null = null) {
    const offer = this.offers[0];
    if (!offer || (index !== null && !offer.cards[index])) return false;
    if (index !== null && !this.store(this.player, offer.kind, offer.cards[index], replace)) return false;
    this.offers.shift();
    this.openNextDay();
    return true;
  }

  chooseOfferAutomatically() {
    const offer = this.offers[0];
    if (!offer) return false;
    const owned = offer.kind === 'joker' ? this.player.jokers : this.player.items;
    const pick = chooseCard(offer.cards, owned, this.capacity(offer.kind), { config: this.config, holder: this.player });
    return this.chooseOffer(pick.card, pick.replace);
  }

  /** Price, shortfall and whether a replacement is needed for one shelf of the player's shop. */
  shopCheck(index: number, replace: number | null = null) {
    return checkBuy(this.config, this.player, this.shop?.slots[index], replace);
  }

  buy(index: number, replace: number | null = null) {
    if (!this.shop || this.offers.length) return null;
    const purchase = buy(this.config, this.player, this.shop, index, replace);
    if (purchase) this.record(this.player, purchase);
    return purchase;
  }

  leaveShop() {
    if (!this.shop) return false;
    this.shop = null;
    this.openNextDay();
    return true;
  }

  /** Lets the computer's shop plan buy for the player (simulation and auto-play). */
  shopAutomatically() {
    if (!this.shop) return false;
    for (const pick of planShop(this.shop, this.player, this.config, this.shop.day)) if (!this.buy(pick.index, pick.replace)) break;
    return this.leaveShop();
  }

  get nextShopDay() {
    return this.config.gameplay.stageDays.find(day => day >= this.day && this.shopOpensAfter(day)) ?? null;
  }

  shopOpensAfter(day: number) {
    return this.config.shop.enabled && this.config.gameplay.stageDays.includes(day) && day < this.config.gameplay.turns;
  }

  get dailyShop() { return this.dailyShops.get(this.player) ?? null; }

  private canPrepare(investor: Investor) {
    return !this.closed && !this.shop && !this.offer && !this.pendingRecovery && !investor.account.eliminated;
  }

  dailyShopCheck(index: number, replace: number | null = null) {
    return checkBuy(this.config, this.player, this.dailyShop?.slots[index], replace);
  }

  buyDaily(index: number, replace: number | null = null) {
    return this.buyDailyFor(this.player, index, replace);
  }

  private openingFor(investor: Investor) {
    let opening = this.opening.get(investor);
    if (!opening) {
      opening = { worth: netWorth(investor.account), cards: [], steps: [] };
      this.opening.set(investor, opening);
    }
    return opening;
  }

  private buyDailyFor(investor: Investor, index: number, replace: number | null) {
    const shop = this.dailyShops.get(investor);
    if (!shop || !this.canPrepare(investor) || checkBuy(this.config, investor, shop.slots[index], replace).block) return null;
    const opening = this.openingFor(investor);
    const purchase = buy(this.config, investor, shop, index, replace)!;
    this.record(investor, purchase);
    opening.steps.push({ source: 'shop', id: purchase.card.id, name: '買了 ' + purchase.card.name, kind: 'cash', amount: -purchase.price });
    return purchase;
  }

  openingBlock(slot: number, investor = this.player) {
    const card = investor.items[slot];
    if (!card) return 'used' as const;
    const timing = itemTiming(this.config, card);
    const used = this.opening.get(investor)?.cards ?? [];
    if (used.length >= this.config.gameplay.itemPlayLimit) return 'play_limit' as const;
    if (timing === 'defense' && used.some(item => itemTiming(this.config, item) === 'defense')) return 'defense_today' as const;
    return itemBlock(investor, card, { config: this.config, day: this.day, allocation: allocationOption(this.config, investor.allocation),
      marketRate: 0, news: null, nextNewsDay: this.eventAtOrAfter(this.day + 1), hasTarget: false });
  }

  get openingCardsLeft() {
    return this.config.gameplay.itemPlayLimit - (this.opening.get(this.player)?.cards.length ?? 0);
  }

  useOpeningItem(slot: number, investor = this.player) {
    const card = investor.items[slot];
    if (!this.canPrepare(investor) || !card || itemTiming(this.config, card) === 'action' || this.openingBlock(slot, investor)) return null;
    const opening = this.openingFor(investor);
    const before = netWorth(investor.account);
    const random = seededRandom(localSeed(this.options.seed, investor.character.id + ' item cash ' + this.day + ' ' + opening.cards.length));
    const ledger = playOpeningItem(investor, card, this.config, random);
    investor.items.splice(slot, 1);
    investor.stats.itemsUsed++;
    opening.cards.push(card);
    opening.steps.push(...(ledger.steps.length ? ledger.steps : [{ source: 'item', id: card.id, name: card.name, kind: 'base', amount: 0 } as const]));
    if (ledger.requests.intel) this.revealIntel(investor, this.eventAtOrAfter(this.day + 1));
    if (ledger.requests.pack) this.offerItems(investor, 'pack', ledger.requests.pack);
    for (const id of card.effectIds) {
      const effect = this.config.effects[id];
      if (effect.type !== 'generate') continue;
      const filter = (item: GameCard) => effect.pool === 'all' ||
        (effect.pool === 'attack' ? attackOf(this.config, item) !== null : itemTiming(this.config, item) === 'defense');
      if (effect.choose) this.offerItems(investor, 'pack', effect.count, filter);
      else for (const item of this.generatedItems(investor, effect.count, filter)) this.giveItem(investor, 'pack', item);
    }
    return { card, amount: netWorth(investor.account) - before };
  }

  private prepareInvestor(investor: Investor, shopping: boolean) {
    const play = () => {
      for (;;) {
        const usable = investor.items.map((card, slot) => ({ card, slot, timing: itemTiming(this.config, card) }))
          .filter(({ timing, slot }) => timing !== 'action' && !this.openingBlock(slot, investor));
        const pick = usable.find(card => card.timing === 'instant' && (card.card.id !== 'ticket' || shopping)) ??
          usable.find(card => card.timing === 'defense' && (investor.allocation !== 'cash' || card.card.id === 'mirror'));
        if (!pick || !this.useOpeningItem(pick.slot, investor)) return;
        if (investor === this.player) while (this.offer) this.chooseOfferAutomatically();
      }
    };
    play();
    const shop = this.dailyShops.get(investor);
    if (shop && shopping) for (const pick of planShop(shop, investor, this.config, this.day)) this.buyDailyFor(investor, pick.index, pick.replace);
    play();
  }

  canLock(choice: TradeChoice) {
    const actions = choice.actions ?? (choice.item == null ? [] : [{ slot: choice.item, targetId: choice.targetId }]);
    return this.canPrepare(this.player) && Boolean(this.lockChoice(this.player, { ...choice, actions }, this.decisionView(this.player)));
  }

  confirm(choice: TradeChoice | null, chooseRival?: Planner) {
    if (!this.canPrepare(this.player) && !this.player.account.eliminated) return false;
    if (!this.player.account.eliminated && (!choice || !this.canLock(choice))) return false;
    return this.resolve(investor => investor === this.player ? choice : undefined, chooseRival, !chooseRival);
  }

  /** Shared entry point: each planner only receives that investor's DecisionView. */
  resolveControlled(planner: Planner, prepare: boolean | undefined = undefined) {
    return this.resolve(() => undefined, planner, prepare, true);
  }

  acceptRecovery() {
    const report = this.pendingRecovery;
    if (!report) return false;
    this.pendingRecovery = null;
    this.finishDay(report);
    return true;
  }

  private capacity(kind: Offer['kind']) {
    return kind === 'joker' ? this.config.gameplay.jokerSlots : this.config.gameplay.itemSlots;
  }

  private lockChoice(investor: Investor, pick: TradeChoice, view: DecisionView) {
    const allocation = allocationOption(this.config, pick.allocation ?? investor.allocation);
    if (pick.allocation !== undefined && allocation.id !== pick.allocation) return null;
    const actions: ActionChoice[] = pick.actions ?? (pick.item == null ? [] : [{ slot: pick.item, targetId: pick.targetId }]);
    if (actions.length > this.config.gameplay.actionLimit || new Set(actions.map(action => action.slot)).size !== actions.length ||
        actions.length + (this.opening.get(investor)?.cards.length ?? 0) > this.config.gameplay.itemPlayLimit) return null;
    const context: DayContext = { config: this.config, day: this.day, allocation, marketRate: 0, news: null,
      nextNewsDay: view.nextNewsDay, hasTarget: false };
    let boost = 1;
    let booster: number | null = null;
    const cards = [];
    for (const action of actions) {
      const card = investor.items[action.slot];
      if (!card || (pick.actions && itemTiming(this.config, card) !== 'action')) return null;
      const effect = attackOf(this.config, card);
      const targets = effect?.type === 'area_attack' ? view.rivals.map(rival => rival.id)
        : attackTargets(view, card).filter(rival => rival.id === action.targetId).map(rival => rival.id);
      if (itemBlock(investor, card, { ...context, hasTarget: targets.length > 0 }) || (effect && !targets.length)) return null;
      const modifier = card.effectIds.map(id => this.config.effects[id]).find(effect => effect.type === 'strike_boost');
      if (modifier) {
        if (booster !== null) return null;
        booster = action.slot;
        boost = modifier.factor;
      }
      cards.push({ card, effect, slot: action.slot, targets, factor: effect ? boost : 1, booster: effect ? booster : null, modifier: Boolean(modifier) });
      if (effect) { booster = null; boost = 1; }
    }
    if (booster !== null) return null;
    return { investor, allocation, context, cards };
  }

  private resolve(override: (investor: Investor) => TradeChoice | null | undefined, planner?: Planner, prepare?: boolean, simulatePlayer = false) {
    if (this.closed || this.offers.length || this.shop || this.pendingRecovery) return false;
    const active = this.investors.filter(investor => !investor.account.eliminated);
    if (prepare !== undefined) for (const investor of active) {
      if (investor !== this.player || simulatePlayer) this.prepareInvestor(investor, prepare);
    }
    const standings = this.standings();
    const market = this.schedule.get(this.day) ?? null;
    const choices = active.map(investor => {
      const view = this.decisionView(investor, standings);
      const random = seededRandom(localSeed(this.options.seed, `${investor.character.id} decision ${this.day}`));
      const given = override(investor);
      const pick = given === undefined ? (planner ? planner(view, random) : chooseTrade(view, random, 'mixed', this.options.difficulty)) : given;
      if (!pick) return null;
      return this.lockChoice(investor, pick, view);
    });
    if (choices.some(choice => !choice)) return false;

    // Every decision is locked; only now are the shared market move and the news target drawn.
    const daily = priceEffect(this.config, { effectIds: [this.config.allocation.dailyMarket] })!;
    const marketRate = rateFrom(daily, this.marketRoll());
    const newsDraw = this.marketRoll();
    const ranked = standings.filter(item => item.rank !== null).map(item => ({ ...item, tie: this.targetRandom() }))
      .sort((first, second) => first.rank! - second.rank! || first.tie - second.tie).map(item => item.investor);
    const targets = market ? new Set(marketTargets(market.target, ranked, this.targetRandom)) : new Set<Investor>();
    const newsPrice = market ? priceEffect(this.config, market) : null;
    const newsRate = newsPrice ? rateFrom(newsPrice, newsDraw) : 0;

    const trades = choices.map(choice => {
      const { investor, allocation, cards, context } = choice!;
      const allocationBefore = investor.allocation;
      investor.allocation = allocation.id;
      const start = this.opening.get(investor)?.worth ?? netWorth(investor.account);
      context.marketRate = marketRate;
      context.news = market ? { event: market, rate: newsRate, applies: targets.has(investor) } : null;
      const ledger = tradeDay(investor, cards.map(card => card.card), context);
      ledger.steps.unshift(...(this.opening.get(investor)?.steps ?? []));
      return { ...choice!, allocationBefore, start, ledger, attackedBy: [] as string[], attacked: null as string | null, attackBlocked: false };
    });

    // 同一目標的競爭依獨立種子排列，先後不受席位或玩家身分影響。
    const priority = seededRandom(localSeed(this.options.seed, `attack order ${this.day}`));
    const combatants = trades.map(trade => ({ holder: trade.investor, ledger: trade.ledger,
      id: trade.investor.character.id, name: trade.investor.character.name, start: trade.start }));
    const strikes = trades.map((trade, index) => ({ trade, index, order: priority() })).sort((a, b) => a.order - b.order)
      .flatMap(({ trade, index }) => trade.cards.flatMap(card => {
        const effect = card.effect;
        return effect ? combatants.filter(target => card.targets.includes(target.id)).map(to => ({
          from: combatants[index], to, effect, slot: card.slot, factor: card.factor
        })) : [];
      }));
    const attacks = resolveAttacks(strikes, this.config.settlement);
    for (const trade of trades) {
      const id = trade.investor.character.id;
      const sent = attacks.find(attack => attack.from === id);
      trade.attackBlocked = trade.cards.some(card => card.effect && !attacks.some(hit => hit.from === id && hit.slot === card.slot));
      if (sent && sent.kind !== 'shield_break') trade.attacked = combatants.find(other => other.id === sent.to)!.name;
      trade.attackedBy = attacks.filter(attack => attack.to === id).map(attack => combatants.find(other => other.id === attack.from)!.name);
    }

    const outcomes: DayOutcome[] = trades.map(trade => {
      const { investor, ledger, cards, context } = trade;
      const sent = attacks.filter(hit => hit.from === investor.character.id);
      const used = cards.filter(card => card.effect ? sent.some(hit => hit.slot === card.slot)
        : !card.modifier || cards.some(attack => attack.booster === card.slot && sent.some(hit => hit.slot === attack.slot)));
      const played = [...(this.opening.get(investor)?.cards ?? []), ...used.map(card => card.card)];
      ledger.itemCount = played.length;
      closeDay(investor, context, ledger, sent.reduce((sum, hit) => sum + hit.amount - (hit.kind === 'cash_raid' ? hit.reflected : 0), 0));
      for (const slot of used.map(card => card.slot).sort((a, b) => b - a)) investor.items.splice(slot, 1);
      investor.stats.itemsUsed += used.length;
      const received: GameCard[] = [];
      if (ledger.requests.intel) this.revealIntel(investor, context.nextNewsDay);
      if (investor.intel && investor.intel.day <= this.day) investor.intel = null;
      const marketApplied = market !== null && targets.has(investor);
      const lastDay = this.day >= this.config.gameplay.turns;
      if (!lastDay) {
        if (ledger.requests.pack) this.offerItems(investor, 'pack', ledger.requests.pack);
        for (let count = 0; count < ledger.requests.items; count++) received.push(...this.giveItem(investor, 'event'));
        if (market) for (const joker of investor.jokers) for (const id of joker.effectIds) {
          const effect = this.config.effects[id];
          if (effect.type === 'news_item') this.offerItems(investor, 'news', effect.count);
        }
      }
      return {
        investor, start: trade.start, close: netWorth(investor.account), allocation: investor.allocation, allocationBefore: trade.allocationBefore,
        item: played[0] ?? null, items: played, ledger, marketPnl: ledger.newsPnl, marketApplied, risk: settleRisk(investor.account), recovery: null,
        clearedItems: 0, attackedBy: trade.attackedBy, attacked: trade.attacked, attackBlocked: trade.attackBlocked, received, exposure: ledger.exposure
      };
    });
    const report: DayReport = { day: this.day, market, outcomes, attacks };
    if (market) this.latestNews = { day: this.day, event: market };
    if (outcomes.some(outcome => outcome.investor === this.player && this.eligibleForRecovery(outcome))) this.pendingRecovery = report;
    else this.finishDay(report);
    return true;
  }

  private eligibleForRecovery(outcome: DayOutcome) {
    return outcome.risk.insolvent && canRecover(outcome.investor.account, this.day, this.config.gameplay.turns, this.config.financial);
  }

  private finishDay(report: DayReport) {
    for (const outcome of report.outcomes) {
      const investor = outcome.investor;
      if (!outcome.risk.insolvent) continue;
      const eligible = this.eligibleForRecovery(outcome);
      declareBankruptcy(investor.account);
      investor.defenses = [];
      investor.memory.mirror = null;
      investor.intel = null;
      if (eligible) {
        // Jokers stay so a restart is still a real game; items and defenses are lost so zeroing out never pays.
        outcome.clearedItems = investor.items.length;
        outcome.recovery = recoverPortfolio(investor.account, this.config.financial);
        investor.items = [];
        investor.memory = { ...newMemory(), holdPaid: investor.memory.holdPaid, climbPaid: investor.memory.climbPaid, reliefUsed: investor.memory.reliefUsed };
        investor.recoveries += 1;
        this.offers.splice(0, this.offers.length, ...this.offers.filter(offer => investor !== this.player || offer.kind === 'joker'));
      } else {
        investor.account.eliminated = true;
        if (investor === this.player) { this.offers.length = 0; this.shop = null; }
      }
    }
    // 逆風飛翔 reads who left last place at this close, then everyone is ranked again with the bonus included.
    const before = new Map(this.investors.map(investor => [investor, investor.ranks.at(-1) ?? null]));
    const lastPlace = this.investors.filter(investor => !investor.account.eliminated).length;
    for (const { investor, rank } of this.standings()) {
      const outcome = report.outcomes.find(item => item.investor === investor);
      if (outcome && !outcome.recovery && before.get(investor) === lastPlace && rank !== null && rank < lastPlace) {
        climbBonus(investor, this.config, outcome.ledger, true);
      }
    }
    for (const outcome of report.outcomes) {
      outcome.close = netWorth(outcome.investor.account);
      recordWorth(outcome.investor.account, outcome.close);
      this.recordStats(outcome, report.day);
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
      this.offers.length = 0;
      return;
    }
    if (this.config.gameplay.stageDays.includes(this.day)) {
      for (const investor of this.investors.filter(item => !item.account.eliminated)) {
        if (this.shopOpensAfter(this.day)) this.openShop(investor);
        else this.offerJokers(investor, 'stage');
      }
    }
    this.openNextDay();
  }

  /** 收盤獎勵與商店都處理完，才開盤並發今天的免費道具。 */
  private openNextDay() {
    if (this.closed || this.shop || this.offers.length || this.reports.at(-1)?.day !== this.day) return;
    this.day += 1;
    this.opening.clear();
    for (const investor of this.investors) this.openDailyShop(investor);
    this.playerOpeningItem = null;
    const start = this.config.gameplay.dailyItemStart;
    if (start === null || this.day < start) return;
    for (const investor of this.investors) {
      if (investor.account.eliminated) continue;
      const card = this.drawItem(investor);
      if (investor === this.player) this.playerOpeningItem = card;
      this.giveItem(investor, 'daily', card);
    }
  }

  /** Stocks one investor's shelves; the player browses theirs, a computer buys at once with the same prices. */
  private openDailyShop(investor: Investor) {
    if (!this.config.shop.enabled || !this.config.shop.dailyItems || investor.account.eliminated) {
      this.dailyShops.delete(investor);
      return;
    }
    const random = seededRandom(localSeed(this.options.seed, investor.character.id + ' daily shop ' + this.day));
    this.dailyShops.set(investor, { day: this.day, slots: this.distinct(this.config.items.filter(card => soldInShop(this.config, card)),
      this.config.shop.dailyItems, random).map(card => ({ kind: 'item', card, base: listPrice(this.config, 'item', card), sold: false })) });
  }

  private openShop(investor: Investor) {
    const random = this.shopRandom.get(investor)!;
    const jokers = this.distinct(this.config.jokers.filter(joker => !investor.jokers.some(owned => owned.id === joker.id)), this.config.shop.jokers, random);
    const items = this.distinct(this.config.items.filter(card => soldInShop(this.config, card)), this.config.shop.items, random);
    const shop: Shop = { day: this.day, slots: [
      ...jokers.map(card => ({ kind: 'joker' as const, card, base: listPrice(this.config, 'joker', card), sold: false })),
      ...items.map(card => ({ kind: 'item' as const, card, base: listPrice(this.config, 'item', card), sold: false }))
    ] };
    if (investor === this.player) {
      this.shop = shop;
      return;
    }
    for (const pick of planShop(shop, investor, this.config, this.day)) {
      const purchase = buy(this.config, investor, shop, pick.index, pick.replace);
      if (!purchase) break;
      this.record(investor, purchase);
    }
  }

  private record(investor: Investor, purchase: Purchase) {
    investor.purchases.push(purchase);
    investor.stats.spent += purchase.price - purchase.refund;
  }

  private recordStats(outcome: DayOutcome, day: number) {
    const { stats } = outcome.investor;
    const boosts = outcome.ledger.steps.filter(step => step.source === 'joker' || step.source === 'defense' || (step.source === 'item' && step.kind !== 'cash'));
    for (const step of outcome.ledger.steps.filter(item => item.source === 'joker')) stats.jokerGain[step.id] = (stats.jokerGain[step.id] ?? 0) + step.amount;
    stats.combos += outcome.ledger.combos;
    stats.shields += Number(outcome.ledger.shielded > 0);
    const net = outcome.close - outcome.start;
    if (!outcome.recovery && (!stats.bestDay || net > stats.bestDay.amount)) stats.bestDay = { day, amount: net };
    const gain = boosts.reduce((sum, step) => sum + step.amount, 0);
    if (boosts.length >= 2 && (!stats.bestCombo || boosts.length > stats.bestCombo.steps || (boosts.length === stats.bestCombo.steps && gain > stats.bestCombo.amount))) {
      stats.bestCombo = { day, steps: boosts.length, amount: gain };
    }
  }

  private eventAtOrAfter(day: number) {
    const spacing = this.config.gameplay.eventEvery;
    const next = Math.ceil(day / spacing) * spacing;
    return next <= this.config.gameplay.turns ? next : null;
  }

  private pick(pool: GameCard[], random: Random) {
    const rarities = [...new Set(pool.map(card => card.rarity))].map(rarity => ({ rarity, weight: this.config.gameplay.rarity[rarity] }));
    const chosen = weighted(rarities, random).rarity;
    return weighted(pool.filter(card => card.rarity === chosen), random);
  }

  private dealOpeningItems(investor: Investor) {
    const { startItems, openingItems } = this.config.gameplay;
    const random = this.itemRandom.get(investor)!;
    const pools = [openingItems.income, openingItems.defense, Object.values(openingItems).flat()];
    for (const ids of pools.slice(0, startItems)) {
      const eligible = this.config.items.filter(card => ids.includes(card.id) && !investor.items.includes(card));
      investor.items.push(this.pick(eligible, random));
    }
  }

  private drawItem(investor: Investor) {
    return this.pick(this.config.items, this.itemRandom.get(investor)!);
  }

  private distinct(pool: GameCard[], count: number, random: Random) {
    const left = [...pool];
    const cards: GameCard[] = [];
    while (cards.length < count && left.length) {
      const card = this.pick(left, random);
      left.splice(left.indexOf(card), 1);
      cards.push(card);
    }
    return cards;
  }

  private offerJokers(investor: Investor, source: OfferSource) {
    const pool = this.jokerPool.filter(joker => !investor.jokers.some(owned => owned.id === joker.id));
    const cards = this.distinct(pool, this.config.gameplay.jokerChoices, this.jokerRandom.get(investor)!);
    if (cards.length) this.present(investor, { kind: 'joker', source, cards });
  }

  private revealIntel(investor: Investor, day: number | null) {
    if (day !== null) investor.intel = { day, tone: marketTone(this.schedule.get(day)!, this.config) };
  }

  private generatedItems(investor: Investor, count: number, filter: (card: GameCard) => boolean = () => true) {
    const pool = this.config.items.filter(card => !generatesItems(this.config, card) && filter(card));
    return this.distinct(pool, count, this.itemRandom.get(investor)!);
  }

  private offerItems(investor: Investor, source: OfferSource, count: number, filter?: (card: GameCard) => boolean) {
    const cards = this.generatedItems(investor, count, filter);
    if (cards.length) this.present(investor, { kind: 'item', source, cards });
  }

  /** A free item: stored at once when there is room, otherwise the holder decides what to drop. */
  private giveItem(investor: Investor, source: OfferSource, card = this.drawItem(investor)) {
    if (investor.items.length < this.config.gameplay.itemSlots) {
      investor.items.push(card);
      return [card];
    }
    this.present(investor, { kind: 'item', source, cards: [card] });
    return [];
  }

  private present(investor: Investor, offer: Offer) {
    if (investor === this.player) {
      this.offers.push(offer);
      return;
    }
    const owned = offer.kind === 'joker' ? investor.jokers : investor.items;
    const pick = chooseCard(offer.cards, owned, this.capacity(offer.kind), { config: this.config, holder: investor });
    if (pick.card !== null) this.store(investor, offer.kind, offer.cards[pick.card], pick.replace);
  }

  private store(investor: Investor, kind: Offer['kind'], card: GameCard, replace: number | null) {
    const owned = kind === 'joker' ? investor.jokers : investor.items;
    if (kind === 'joker' && owned.some(item => item.id === card.id)) return false;
    if (owned.length < this.capacity(kind)) owned.push(card);
    else if (replace !== null && owned[replace]) owned[replace] = card;
    else return false;
    return true;
  }
}

export type { Tone };
