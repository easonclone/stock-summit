import './style.css';
import './polish.css';
import { loadHDArt } from './ui/hd-art';
import { loadInvestorSprites } from './ui/investor-sprites';
import { readFinancialConfig, type FinancialConfig, type PixelIcon, type TradingDifficulty } from './config/financial-settings';
import { TradingRun, type DayOutcome, type DayReport } from './core/trading-run';
import { itemTiming } from './core/item-timing';
import { marketTone } from './core/settlement';
import { CardAudio } from './ui/audio';
import { DayTransition } from './ui/day-transition';
import { crisisMarkup } from './ui/crisis-dialog';
import { escapeHtml, money, signedMoney } from './ui/format';
import { drawCardArt, drawCity, drawIcon, iconMarkup, portrait, sprite, type SpriteMood, type SystemIcon } from './ui/pixels';
import { settlementMarkup, shareText } from './ui/settlement';
import { cardDetailMarkup, chartDialogMarkup, newsMarkup, offerHeading, offerMarkup, openingMarkup, shopMarkup, tradingMarkup, type TerminalSelection } from './ui/trading-terminal';
import { timelineDetail } from './ui/timeline';
import { playGuideMarkup } from './ui/coach';
import { readTheaterConfig, type TheaterConfig } from './config/theater-settings';
import { MarketTheater } from './ui/theater';
import { buildTheater, type Step, type TheaterMode } from './ui/theater-script';

type DialogKind = 'crisis' | 'recovery' | 'offer' | 'shop' | 'settings' | 'share' | 'chart' | 'news' | 'timeline' | 'card-detail' | 'help';
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

class TerminalApp {
  private run: TradingRun | null = null;
  private readonly screen: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly audio = new CardAudio();
  private readonly dayTransition: DayTransition;
  private presentedDay = 1;
  private readonly selection: TerminalSelection = { allocation: null, item: null, animate: false };
  private selectedCharacter: string;
  private difficulty: TradingDifficulty = 'normal';
  private readonly initialSeed: number;
  private reduced: boolean;
  private international = false;
  private personal = false;
  private offered: number | null = null;
  private replace: number | null = null;
  private shopPick: number | null = null;
  private shopReplace: number | null = null;
  private dialogKind: DialogKind | null = null;
  private dialogTrigger: HTMLElement | null = null;
  private closingDialog = false;
  private locked = false;
  private transitionTimer: number | undefined;
  private disposeEffect: (() => void) | undefined;
  private lastCrisis: { report: DayReport; outcome: DayOutcome } | null = null;
  private readonly theater: TheaterConfig;
  private theaterMode: TheaterMode = 'full';
  private theaterDay = 0;
  private stage: MarketTheater | null = null;
  private timelineDay = 1;
  private detail: { kind: 'joker' | 'item' | 'daily'; slot: number } = { kind: 'joker', slot: 0 };

  constructor(private readonly root: HTMLElement, private readonly config: FinancialConfig) {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get('seed') ?? '';
    this.initialSeed = /^\d{1,10}$/.test(fromUrl) && Number(fromUrl) <= 0xffffffff ? Number(fromUrl) : freshSeed();
    if (url.searchParams.has('seed')) {
      url.searchParams.delete('seed');
      history.replaceState(history.state, '', url);
    }
    this.selectedCharacter = config.characters[0].id;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.theater = readTheaterConfig(config);
    try {
      const saved = localStorage.getItem('stock-summit-theater');
      if (saved === 'full' || saved === 'quick' || saved === 'off') this.theaterMode = saved;
    } catch { /* storage unavailable: keep the full show */ }
    root.innerHTML = '<div id="screen"></div><dialog id="terminal-dialog" aria-labelledby="dialog-heading"></dialog><div id="announce" class="sr-only" aria-live="polite"></div>';
    this.screen = root.querySelector('#screen')!;
    this.dialog = root.querySelector('dialog')!;
    this.dayTransition = new DayTransition(root);
    root.style.setProperty('--gold', config.theme.gold);
    root.style.setProperty('--bg', config.theme.night);
    root.style.setProperty('--panel', config.theme.panel);
    this.setPreferences();
    root.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-act]');
      if (button) this.activate(button);
    });
    root.addEventListener('change', event => this.change(event.target as HTMLInputElement));
    document.addEventListener('keydown', this.keyDown);
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (this.dialogKind !== 'recovery' && this.dialogKind !== 'offer' && this.dialogKind !== 'shop') this.closeDialog();
    });
    this.render();
  }

  private render(focus?: string) {
    this.disposeEffect?.();
    this.disposeEffect = undefined;
    const run = this.run;
    const complete = run?.closed || this.personal;
    const status = run ? `<div class="session-counter"><span>${run.closed ? '已結算' : '交易日'}</span>
      <strong>${String(run.closed ? run.reports.length : run.day).padStart(2, '0')} <small>／ ${run.config.gameplay.turns}</small></strong></div>` : '';
    this.screen.innerHTML = `<header class="masthead"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <div><b>STOCK SUMMIT</b><small>股市攻頂戰 · Market Showdown</small></div></div><div class="masthead-tools">${status}
      <button class="help-trigger" type="button" data-act="help" aria-label="玩法說明" aria-haspopup="dialog" title="玩法說明">${iconMarkup('help', '#a3cff3')}<span>玩法說明</span></button>
      <button class="gear" type="button" data-act="settings" aria-label="畫面與音效" title="畫面與音效">${iconMarkup('settings', '#b5c7e0')}</button></div></header>
      ${run ? complete ? settlementMarkup(run, this.personal) : tradingMarkup(run, this.selection)
        : `<main>${openingMarkup(this.config, this.selectedCharacter, this.difficulty)}</main>`}`;
    this.paint(this.screen);
    this.selection.animate = false;
    if (focus) this.screen.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private paint(parent: ParentNode) {
    parent.querySelectorAll<HTMLCanvasElement>('[data-portrait]').forEach(canvas => {
      const character = this.config.characters.find(item => item.id === canvas.dataset.portrait);
      if (!character) return;
      portrait(canvas, character);

    });
    parent.querySelectorAll<HTMLCanvasElement>('[data-sprite]').forEach(canvas => {
      const character = this.config.characters.find(item => item.id === canvas.dataset.sprite);
      if (character) sprite(canvas, character, (canvas.dataset.mood ?? 'idle') as SpriteMood);
    });
    parent.querySelectorAll<HTMLCanvasElement>('[data-city]').forEach(drawCity);
    parent.querySelectorAll<HTMLCanvasElement>('[data-card-art]').forEach(canvas => drawCardArt(canvas, canvas.dataset.cardArt as PixelIcon, canvas.dataset.color!, canvas.dataset.cardDesign));
    parent.querySelectorAll<HTMLCanvasElement>('[data-icon]').forEach(canvas => {
      drawIcon(canvas, canvas.dataset.icon as SystemIcon, canvas.dataset.color!);
    });
  }

  private change(target: HTMLInputElement) {
    if (target.dataset.input === 'difficulty') this.difficulty = target.value as TradingDifficulty;
    if (target.dataset.input === 'motion') this.reduced = target.checked;
    if (target.dataset.input === 'colors') this.international = target.checked;
    if (target.dataset.input === 'audio') this.audio.enabled = target.checked;
    if (target.dataset.input === 'theater' && ['full', 'quick', 'off'].includes(target.value)) {
      this.theaterMode = target.value as TheaterMode;
      try { localStorage.setItem('stock-summit-theater', this.theaterMode); } catch { /* ignore */ }
    }
    this.setPreferences();
  }

  private setPreferences() {
    const colors = this.config.theme;
    this.root.classList.toggle('reduced-motion', this.reduced);
    if (this.reduced) this.dayTransition.close();
    this.root.style.setProperty('--gain', this.international ? colors.down : colors.up);
    this.root.style.setProperty('--loss', this.international ? colors.up : colors.down);
  }

  private activate(button: HTMLButtonElement) {
    if (this.locked && button.dataset.act !== 'skip') return;
    const act = button.dataset.act;
    const value = Number(button.dataset.value);
    this.dayTransition.close();
    switch (act) {
      case 'character':
        this.selectedCharacter = button.dataset.value!;
        this.render(`[data-act="character"][data-value="${this.selectedCharacter}"]`);
        break;
      case 'start': this.start(this.initialSeed); break;
      case 'replay': this.start(this.run!.options.seed); break;
      case 'new': this.start(freshSeed()); break;
      case 'settings': this.dialogTrigger = button; this.openDialog('settings'); break;
      case 'help': case 'chart': case 'news': this.dialogTrigger = button; this.openDialog(act); break;
      case 'timeline':
        if (!this.run || value < 1 || value > this.run.config.gameplay.turns) break;
        this.timelineDay = value;
        this.dialogTrigger = button;
        this.openDialog('timeline');
        break;
      case 'daily-detail':
        this.detail = { kind: 'daily', slot: value };
        this.dialogTrigger = button;
        this.openDialog('card-detail');
        break;
      case 'card-detail':
        this.dialogTrigger = button;
        this.detail = { kind: button.dataset.kind === 'item' ? 'item' : 'joker', slot: value };
        this.openDialog('card-detail');
        break;
      case 'crisis': this.dialogTrigger = button; this.openDialog('crisis'); break;
      case 'close-dialog': this.closeDialog(); break;
      case 'personal': this.personal = true; this.closeDialog(false); this.render('[data-act="spectate"]'); window.scrollTo(0, 0); break;
      case 'spectate': this.personal = false; this.render('[data-act="trade"]'); window.scrollTo(0, 0); break;
      case 'alloc': this.pickAllocation(button.dataset.value ?? ''); break;
      case 'item': this.pickItem(value); break;
      case 'use-item': this.useItem(value, button.dataset.cardId); break;
      case 'focus-action': this.focusAction(value); break;
      case 'go-shop': {
        const shelf = this.screen.querySelector<HTMLElement>('.daily-shop');
        shelf?.scrollIntoView({ block: 'center' });
        shelf?.querySelector<HTMLElement>('[data-act="daily-detail"]')?.focus({ preventScroll: true });
        break;
      }
      case 'daily-buy': this.buyDaily(value); break;
      case 'daily-buy-replace': this.buyDaily(this.selection.dailyPick, value); break;
      case 'daily-buy-cancel': this.selection.dailyPick = undefined; this.render('[data-act="daily-buy"]'); break;
      case 'target': {
        const id = button.dataset.value!;
        const action = this.selection.actions?.find(choice => choice.slot === this.selection.item);
        if (!action) break;
        action.targetId = action.targetId === id ? undefined : id;
        this.selection.targetId = action.targetId;
        this.render(`[data-act="target"][data-value="${id}"]`);
        break;
      }
      case 'trade': this.trade(); break;
      case 'skip': this.finishAnimation(); break;
      case 'recover':
        if (this.run?.acceptRecovery()) this.afterTrade();
        break;
      case 'offer-card': this.offered = value; this.openDialog('offer', `[data-act="offer-card"][data-value="${value}"]`); break;
      case 'replace': this.replace = value; this.openDialog('offer', `[data-act="replace"][data-value="${value}"]`); break;
      case 'take': this.takeOffer(this.offered, this.replace); break;
      case 'decline': case 'daily-decline': this.takeOffer(null, null); break;
      case 'daily-replace': this.takeOffer(0, value); break;
      case 'shop-card':
        this.shopPick = value;
        this.shopReplace = null;
        this.openDialog('shop', `[data-act="shop-card"][data-value="${value}"]`);
        break;
      case 'shop-replace': this.shopReplace = value; this.openDialog('shop', `[data-act="shop-replace"][data-value="${value}"]`); break;
      case 'buy': this.buy(); break;
      case 'leave-shop': this.leaveShop(); break;
      case 'share': this.dialogTrigger = button; void this.share(); break;
    }
  }

  private start(seed: number) {
    this.closeDialog(false);
    this.run = new TradingRun(this.config, { playerId: this.selectedCharacter, seed, difficulty: this.difficulty });
    this.personal = false;
    this.presentedDay = 1;
    this.dayTransition.close();
    this.lastCrisis = null;
    this.theaterDay = 0;
    this.stage?.close();
    this.clearSelection();
    this.audio.unlock();
    this.audio.play('rise');
    this.render('[data-act="alloc"][aria-pressed="true"]');
    window.scrollTo(0, 0);
    this.announce('開盤啦，先選一張王牌。');
    this.showOffer();
  }

  private clearSelection() {
    this.selection.allocation = null;
    this.selection.item = null;
    this.selection.targetId = undefined;
    this.selection.actions = [];
    this.selection.dailyPick = undefined;
    this.selection.feedback = undefined;
    this.selection.inspectItem = undefined;
  }

  private focusAction(slot: number) {
    const action = this.selection.actions?.find(pick => pick.slot === slot);
    this.selection.item = action?.slot ?? null;
    this.selection.targetId = action?.targetId;
    this.render(action ? `[data-act="item"][data-value="${slot}"]` : undefined);
    const target = this.screen.querySelector<HTMLElement>('[data-act="target"]');
    if (!target) return;
    if (matchMedia('(max-width: 760px)').matches) this.screen.querySelector('.arena')?.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }

  private pickItem(slot: number) {
    const run = this.run;
    const card = run?.player.items[slot];
    if (!run || !card || run.offer) return;
    const actions = this.selection.actions ??= [];
    const timing = itemTiming(this.config, card);
    if (timing === 'action') {
      this.selection.inspectItem = undefined;
      const selected = actions.findIndex(choice => choice.slot === slot);
      if (selected >= 0) {
        actions.splice(selected, 1);
        this.focusAction(actions.at(-1)?.slot ?? -1);
      } else if (actions.length < this.config.gameplay.actionLimit && actions.length < run.openingCardsLeft) {
        actions.push({ slot });
        this.focusAction(slot);
      }
      return;
    }
    this.selection.inspectItem = this.selection.inspectItem === slot ? undefined : slot;
    this.render(this.selection.inspectItem === slot && !run.openingBlock(slot) ? '[data-act="use-item"]' : `[data-act="item"][data-value="${slot}"]`);
  }

  private useItem(slot: number, cardId?: string) {
    const run = this.run;
    const card = run?.player.items[slot];
    if (!run || !card || card.id !== cardId || slot !== this.selection.inspectItem || run.offer) return;
    const timing = itemTiming(this.config, card);
    const actions = this.selection.actions ??= [];
    const result = run.useOpeningItem(slot);
    if (!result) return;
    this.selection.inspectItem = undefined;
    for (const action of actions) if (action.slot > slot) action.slot--;
    if (actions.length > run.openingCardsLeft) actions.pop();
    this.selection.item = actions.at(-1)?.slot ?? null;
    this.selection.targetId = actions.at(-1)?.targetId;
    this.selection.feedback = (timing === 'defense' ? '已部署 ' : '已使用 ') + result.card.name + (result.amount ? ' ' + signedMoney(result.amount) : '');
    this.audio.play(timing === 'defense' ? 'shield' : 'page');
    this.render('[data-act="item"]');
    this.showOffer();
  }

  private buyDaily(index?: number, replace: number | null = null) {
    const run = this.run;
    if (!run || index === undefined || run.offer) return;
    if (replace === null && run.dailyShopCheck(index).block === 'full') {
      this.selection.dailyPick = index;
      this.render('[data-act="daily-buy-replace"]');
      return;
    }
    const purchase = run.buyDaily(index, replace);
    if (!purchase) return;
    this.selection.dailyPick = undefined;
    if (replace !== null) this.removeSelection(replace);
    this.selection.feedback = '買下 ' + purchase.card.name + ' ' + money(-purchase.price);
    this.audio.play('page');
    this.render('[data-act="daily-buy"]:not(:disabled)');
  }

  private removeSelection(slot: number) {
    if (this.selection.inspectItem === slot) this.selection.inspectItem = undefined;
    this.selection.actions = (this.selection.actions ?? []).filter(action => action.slot !== slot);
    this.selection.item = this.selection.actions.at(-1)?.slot ?? null;
    this.selection.targetId = this.selection.actions.at(-1)?.targetId;
  }

  private pickAllocation(id: string) {
    if (!this.run?.config.allocation.options.some(option => option.id === id)) return;
    this.selection.allocation = id;
    this.render(`[data-act="alloc"][data-value="${id}"]`);
  }

  private trade() {
    const run = this.run;
    if (!run || run.closed || this.dialog.open || this.locked) return;
    const action = run.player.account.eliminated ? null : { actions: this.selection.actions ?? [], allocation: this.selection.allocation ?? run.player.allocation };
    this.audio.unlock();
    if (!run.confirm(action)) return;
    this.dayTransition.close();
    this.clearSelection();
    if (this.reduced) this.afterTrade();
    else this.animateTrade();
  }

  /** Short "orders going in" beat; the result is already settled and the button skips it. */
  private animateTrade() {
    this.locked = true;
    this.screen.querySelector('.arena')?.classList.add('executing');
    this.announce('四位投資人正在下單。');
    const button = this.screen.querySelector<HTMLButtonElement>('[data-act="trade"]')!;
    button.dataset.act = 'skip';
    button.textContent = '下單中・點擊略過';
    this.transitionTimer = window.setTimeout(() => this.finishAnimation(), 220);
  }

  private finishAnimation() {
    if (!this.locked) return;
    window.clearTimeout(this.transitionTimer);
    this.locked = false;
    this.afterTrade();
  }

  private afterTrade() {
    const run = this.run!;
    const report = run.pendingRecovery ?? run.reports.at(-1);
    const outcome = report?.outcomes.find(item => item.investor === run.player);
    this.closeDialog(false);
    this.selection.animate = !this.reduced;
    this.render(run.closed ? '[data-act="replay"]' : '[data-act="trade"]');
    if (report && outcome && outcome.risk.insolvent) this.lastCrisis = { report, outcome };
    // The theater waits for a finished day: a pending recovery is decided first, then the show plays once.
    const settled = report && !run.pendingRecovery && this.theaterDay !== report.day ? report : null;
    const steps = settled ? buildTheater(run, settled, this.theater, this.theaterMode) : [];
    if (report && outcome && !steps.length) this.playSound(report, outcome);
    if (!steps.length && !this.reduced && report?.market && !run.closed) void this.playMarketEffect(report);
    this.announce(run.closed ? '本局正式收盤。' : `第 ${report?.day ?? run.day} 日收盤。${outcome ? `你今天 ${signedMoney(outcome.close - outcome.start)}。` : ''}`);
    const next = () => {
      if (run.pendingRecovery && this.lastCrisis) this.openDialog('recovery');
      else if (outcome && !outcome.recovery && outcome.risk.insolvent) this.openDialog('crisis');
      else this.showOffer();
    };
    if (settled && steps.length) {
      this.theaterDay = settled.day;
      void this.playTheater(steps, settled).then(next);
    } else next();
    if (run.closed) window.scrollTo(0, 0);
  }

  /** One sound per day, picked from the settlement record in order of importance. */
  private playSound(report: DayReport, outcome: DayOutcome) {
    const ranks = this.run!.player.ranks;
    const climbed = ranks.length > 1 && ranks.at(-1)! < ranks.at(-2)!;
    const sound = outcome.risk.insolvent ? 'alarm'
      : report.market?.severity === 'extreme' ? 'impact'
      : report.attacks.some(attack => attack.reflected > 0) || outcome.ledger.shielded ? 'shield'
      : report.attacks.length ? 'impact'
      : outcome.ledger.combos >= 2 ? 'combo'
      : outcome.ledger.steps.some(step => step.source === 'joker' && step.amount > 0) ? 'chime'
      : climbed ? 'rank'
      : report.market ? marketTone(report.market, this.config) === 'negative' ? 'fall' : 'rise'
      : outcome.close < outcome.start ? 'fall' : outcome.close > outcome.start ? 'rise' : 'flat';
    this.audio.play(sound);
  }

  private async playTheater(steps: Step[], report: DayReport) {
    const style = getComputedStyle(this.root);
    const colors = { up: style.getPropertyValue('--gain').trim() || '#ff8982', down: style.getPropertyValue('--loss').trim() || '#78dab2' };
    this.stage = new MarketTheater(steps, {
      root: this.root, config: this.config, theater: this.theater, audio: this.audio, mode: this.theaterMode, reduced: this.reduced, colors,
      seed: this.run!.options.seed,
      effect: async (host, tone, intense) => {
        try {
          const { mountMarketEffect } = await import('./ui/market-effects');
          const color = tone === 'negative' ? colors.down : colors.up;
          return mountMarketEffect(host, this.run!.options.seed ^ report.day, Number.parseInt(color.slice(1), 16), intense,
            Math.max(160, host.clientWidth), Math.max(90, host.clientHeight), tone !== 'negative');
        } catch (error) {
          console.warn('市場像素特效無法播放', error);
          return undefined;
        }
      }
    });
    await this.stage.done;
    this.stage = null;
    if (!this.dialog.open) this.screen.querySelector<HTMLElement>(this.run?.closed ? '[data-act="replay"]' : '[data-act="trade"]')?.focus({ preventScroll: true });
  }

  private async playMarketEffect(report: DayReport) {
    const arena = this.screen.querySelector<HTMLElement>('.arena');
    if (!arena || !report.market) return;
    try {
      const { mountMarketEffect } = await import('./ui/market-effects');
      if (!arena.isConnected || this.reduced || !this.run) return;
      const host = document.createElement('div');
      host.className = 'market-art';
      host.setAttribute('aria-hidden', 'true');
      arena.prepend(host);
      const tone = marketTone(report.market, this.config);
      const color = getComputedStyle(this.root).getPropertyValue(tone === 'negative' ? '--loss' : '--gain').trim();
      const width = Math.max(120, Math.round(arena.clientWidth / 2));
      const height = Math.max(60, Math.round(arena.clientHeight / 2));
      this.disposeEffect = mountMarketEffect(host, this.run.options.seed ^ report.day, Number.parseInt(color.slice(1), 16),
        report.market.severity !== 'normal', width, height, tone !== 'negative');
    } catch (error) {
      console.warn('市場像素特效無法播放', error);
    }
  }

  private showOffer() {
    if (this.run?.shop && !this.run.offer && !this.dialog.open) {
      this.shopPick = null;
      this.shopReplace = null;
      this.audio.play('rank');
      this.announce('商店開門了：三張王牌、兩張道具，只能用現金買。');
      this.openDialog('shop');
      return;
    }
    if (this.dialog.open) return;
    if (!this.run?.offer || this.run.offer.source === 'daily') {
      this.presentMorning();
      return;
    }
    this.offered = this.run.offer.cards.length === 1 ? 0 : null;
    this.replace = null;
    this.openDialog('offer');
  }

  private presentMorning() {
    const run = this.run;
    if (!run || run.closed || run.day === this.presentedDay) return;
    this.presentedDay = run.day;
    if (!this.reduced) this.dayTransition.play(run.day);
    const card = run.playerOpeningItem;
    if (card) {
      if (!this.reduced) this.screen.querySelector('[data-morning-item]')?.classList.add('morning-arrival');
      this.audio.play('page');
    }
    this.announce(`第 ${run.day} 個交易日開始。${card ? `今天抽到 ${card.name}。` : ''}`);
  }

  private takeOffer(card: number | null, replace: number | null) {
    if (!this.run?.chooseOffer(card, replace)) return;
    if (card !== null && replace !== null) this.removeSelection(replace);
    this.closeDialog(false);
    this.render('[data-act="trade"]');
    this.showOffer();
  }

  private buy() {
    const run = this.run;
    if (!run?.shop || this.shopPick === null) return;
    const purchase = run.buy(this.shopPick, this.shopReplace);
    if (!purchase) return;
    this.audio.play('combo');
    this.announce(`買下 ${purchase.card.name}，花了 ${money(purchase.price)}${purchase.refund ? `，${purchase.replaced?.name} 回收 ${money(purchase.refund)}` : ''}。`);
    this.shopPick = null;
    this.shopReplace = null;
    this.render();
    this.openDialog('shop', '[data-act="leave-shop"]');
  }

  private leaveShop() {
    if (!this.run?.leaveShop()) return;
    this.closeDialog(false);
    this.render('[data-act="trade"]');
    this.showOffer();
  }

  private openDialog(kind: DialogKind, focus?: string) {
    this.dialogKind = kind;
    const run = this.run!;
    let heading = '';
    let content = '';
    switch (kind) {
      case 'offer':
        heading = offerHeading(run);
        content = offerMarkup(run, this.offered, this.replace);
        break;
      case 'shop':
        if (!run.shop) return;
        heading = `第 ${run.shop.day} 日收盤・商店`;
        content = shopMarkup(run, this.shopPick, this.shopReplace);
        break;
      case 'crisis':
      case 'recovery':
        if (!this.lastCrisis) return;
        heading = kind === 'recovery' ? '翻身機會' : '這筆交易出狀況了';
        content = crisisMarkup(run, this.lastCrisis.report, this.lastCrisis.outcome, kind === 'recovery');
        break;
      case 'settings':
        heading = '畫面與音效';
        content = `<div class="settings-options"><label><input type="checkbox" data-input="colors" ${this.international ? 'checked' : ''}> 切換綠漲紅跌</label>
          <label><input type="checkbox" data-input="motion" ${this.reduced ? 'checked' : ''}> 減少動態，直接看結算</label>
          <label><input type="checkbox" data-input="audio" ${this.audio.enabled ? 'checked' : ''}> 播放交易音效</label>
          <label class="select-label">市場新聞演出<select data-input="theater">${([['full', '完整 RPG 演出'], ['quick', '快速演出'], ['off', '略過演出']] as const)
            .map(([value, label]) => `<option value="${value}" ${this.theaterMode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
        break;
      case 'help':
        heading = '玩法說明';
        content = playGuideMarkup(this.config);
        break;
      case 'chart':
        heading = '總身家走勢';
        content = chartDialogMarkup(run);
        break;
      case 'news':
        heading = '市場快訊';
        content = newsMarkup(run);
        break;
      case 'timeline':
        heading = `第 ${this.timelineDay} 日`;
        content = timelineDetail(run, this.timelineDay);
        break;
      case 'card-detail': {
        const kind = this.detail.kind === 'joker' ? 'joker' : 'item';
        const card = this.detail.kind === 'daily' ? run.dailyShop?.slots[this.detail.slot]?.card
          : (kind === 'joker' ? run.player.jokers : run.player.items)[this.detail.slot];
        if (!card) return;
        heading = card.name;
        content = cardDetailMarkup(run, card, kind);
        break;
      }
      case 'share':
        heading = '分享結算';
        content = `<p>可複製以下結算摘要。</p><textarea aria-label="結算摘要" readonly rows="8">${escapeHtml(shareText(run))}</textarea>`;
        break;
    }
    const dismissible = kind !== 'recovery' && kind !== 'offer' && kind !== 'shop';
    this.dialog.className = `terminal-dialog dialog-${kind}`;
    this.dialog.innerHTML = `<header><h2 id="dialog-heading" tabindex="-1">${heading}</h2>${dismissible ?
      '<button type="button" data-act="close-dialog" aria-label="關閉視窗">×</button>' : ''}</header><div class="dialog-body">${content}</div>`;
    this.paint(this.dialog);
    if (!this.dialog.open) {
      this.dialog.showModal();
      this.dialog.querySelector<HTMLElement>('#dialog-heading')?.focus({ preventScroll: true });
      this.dialog.scrollTop = 0;
    }
    if (focus) this.dialog.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private closeDialog(restore = true) {
    if (this.closingDialog) return;
    const previous = this.dialogKind;
    this.closingDialog = true;
    if (this.dialog.open) this.dialog.close();
    this.dialogKind = null;
    if (restore) this.dialogTrigger?.focus({ preventScroll: true });
    this.dialogTrigger = null;
    this.closingDialog = false;
    if (restore && previous === 'crisis') this.showOffer();
  }

  private async share() {
    try {
      await navigator.clipboard.writeText(shareText(this.run!));
      this.announce('已複製結算摘要。');
      const trigger = this.dialogTrigger;
      if (trigger) trigger.textContent = '已複製結算';
    } catch {
      this.openDialog('share');
    }
  }

  private announce(message: string) {
    this.root.querySelector('#announce')!.textContent = message;
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    if (this.stage) return;
    if (!this.run || this.run.closed || this.dialog.open || this.personal || this.locked || event.altKey || event.ctrlKey || event.metaKey ||
      (event.target as Element).closest('input, select, textarea')) return;
    if (event.code === 'Escape' && this.selection.targetId) {
      const action = this.selection.actions?.find(pick => pick.slot === this.selection.item);
      if (action) action.targetId = undefined;
      this.selection.targetId = undefined;
      this.render('[data-act="target"]');
      return;
    }
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-act="trade"]');
    if (target && !target.disabled && ['Enter', 'NumpadEnter', 'Space'].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) this.trade();
      return;
    }
    const slot = /^Digit([1-9])$/.exec(event.code);
    if (slot && this.run.player.items[Number(slot[1]) - 1] && !this.run.player.account.eliminated) {
      event.preventDefault();
      this.screen.querySelector<HTMLButtonElement>(`[data-act="item"][data-value="${Number(slot[1]) - 1}"]`)?.click();
    }
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    if (this.run.player.account.eliminated) return;
    const ids = this.run.config.allocation.options.map(option => option.id);
    event.preventDefault();
    const index = ids.indexOf(this.selection.allocation ?? this.run.player.allocation);
    this.pickAllocation(ids[Math.max(0, Math.min(ids.length - 1, index + (event.code === 'ArrowLeft' ? -1 : 1)))]);
  };
}

async function startApp() {
  const root = document.querySelector<HTMLElement>('#app')!;
  try {
    const config = readFinancialConfig();
    await Promise.all([loadInvestorSprites(), loadHDArt()]);
    new TerminalApp(root, config);
  } catch (error) {
    root.innerHTML = `<main class="initial-error"><h1>開盤卡住了</h1><p>${escapeHtml(error instanceof Error ? error.message : '遊戲資料讀取失敗')}</p></main>`;
    console.error(error);
  }
}

void startApp();
