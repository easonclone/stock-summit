import './style.css';
import { readFinancialConfig, type FinancialConfig, type TradingDifficulty } from './config/financial-settings';
import { TradingRun, type DayOutcome, type DayReport } from './core/trading-run';
import { marketTone } from './core/trading-effects';
import { CardAudio } from './ui/audio';
import { crisisMarkup } from './ui/crisis-dialog';
import { escapeHtml } from './ui/format';
import { drawIcon, portrait } from './ui/pixels';
import { routeMapMarkup } from './ui/route-map';
import { settlementMarkup, shareText } from './ui/settlement';
import { offerMarkup, openingMarkup, tradingMarkup, type TerminalSelection } from './ui/trading-terminal';

type DialogKind = 'map' | 'crisis' | 'recovery' | 'offer' | 'settings' | 'share';
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

class TerminalApp {
  private run: TradingRun | null = null;
  private readonly screen: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly audio = new CardAudio();
  private readonly selection: TerminalSelection = { lane: null, slot: null, prepare: false, financeOpen: false, cardOpen: false, animate: false };
  private selectedCharacter: string;
  private difficulty: TradingDifficulty = 'normal';
  private seed: number;
  private reduced: boolean;
  private international = false;
  private personal = false;
  private offered: number | null = null;
  private replace: number | null = null;
  private dialogKind: DialogKind | null = null;
  private dialogTrigger: HTMLElement | null = null;
  private closingDialog = false;
  private locked = false;
  private transitionTimer: number | undefined;
  private disposeEffect: (() => void) | undefined;
  private lastCrisis: { report: DayReport; outcome: DayOutcome } | null = null;

  constructor(private readonly root: HTMLElement, private readonly config: FinancialConfig) {
    const fromUrl = new URLSearchParams(location.search).get('seed') ?? '';
    this.seed = /^\d{1,10}$/.test(fromUrl) && Number(fromUrl) <= 0xffffffff ? Number(fromUrl) : freshSeed();
    this.selectedCharacter = config.characters[0].id;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.innerHTML = '<div id="screen"></div><dialog id="terminal-dialog" aria-labelledby="dialog-heading"></dialog><div id="announce" class="sr-only" aria-live="polite"></div>';
    this.screen = root.querySelector('#screen')!;
    this.dialog = root.querySelector('dialog')!;
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
      if (this.dialogKind !== 'recovery' && this.dialogKind !== 'offer') this.closeDialog();
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
      <button class="gear" type="button" data-act="settings" aria-label="畫面與音效" title="畫面與音效">⚙</button></div></header>
      ${run ? complete ? settlementMarkup(run, this.personal) : tradingMarkup(run, this.selection)
        : `<main>${openingMarkup(this.config, this.seed, this.selectedCharacter, this.difficulty)}</main>`}`;
    this.paint(this.screen);
    this.selection.animate = false;
    if (focus) this.screen.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private paint(parent: ParentNode) {
    parent.querySelectorAll<HTMLCanvasElement>('[data-portrait]').forEach(canvas => {
      const character = this.config.characters.find(item => item.id === canvas.dataset.portrait);
      if (!character) return;
      portrait(canvas, character);
      const context = canvas.getContext('2d')!;
      const response = canvas.dataset.reaction;
      if (!response || response === '持平' || response === '等開盤') return;
      context.fillStyle = '#151a26';
      if (response === '這筆有賺' || response === '收盤勝利' || response === '避險成功' || response === '重整完成') {
        context.fillRect(15, 14, 5, 1);
        context.fillRect(16, 15, 3, 1);
      } else if (response === '宣告破產' || response === '強制平倉' || response === '融資追繳') {
        context.fillRect(15, 13, 4, 4);
      } else {
        context.fillRect(15, 15, 4, 1);
      }
    });
    parent.querySelectorAll<HTMLCanvasElement>('[data-icon]').forEach(canvas => {
      drawIcon(canvas, canvas.dataset.icon as FinancialConfig['cards'][number]['icon'], canvas.dataset.color!);
    });
  }

  private change(target: HTMLInputElement) {
    if (target.dataset.input === 'difficulty') this.difficulty = target.value as TradingDifficulty;
    if (target.dataset.input === 'seed' && target.checkValidity() && Number.isSafeInteger(target.valueAsNumber)) this.seed = target.valueAsNumber;
    if (target.dataset.input === 'motion') this.reduced = target.checked;
    if (target.dataset.input === 'colors') this.international = target.checked;
    if (target.dataset.input === 'audio') this.audio.enabled = target.checked;
    this.setPreferences();
  }

  private setPreferences() {
    const colors = this.config.theme;
    this.root.classList.toggle('reduced-motion', this.reduced);
    this.root.style.setProperty('--gain', this.international ? colors.down : colors.up);
    this.root.style.setProperty('--loss', this.international ? colors.up : colors.down);
  }

  private activate(button: HTMLButtonElement) {
    if (this.locked && button.dataset.act !== 'skip') return;
    const act = button.dataset.act;
    const value = Number(button.dataset.value);
    switch (act) {
      case 'character':
        this.selectedCharacter = button.dataset.value!;
        this.render(`[data-act="character"][data-value="${this.selectedCharacter}"]`);
        break;
      case 'start': {
        const input = this.screen.querySelector<HTMLInputElement>('[data-input="seed"]')!;
        if (!input.reportValidity()) return;
        this.start(this.seed);
        break;
      }
      case 'replay': this.start(this.run!.options.seed); break;
      case 'new': this.start(freshSeed()); break;
      case 'settings': this.dialogTrigger = button; this.openDialog('settings'); break;
      case 'map': this.dialogTrigger = button; this.openDialog('map'); break;
      case 'crisis': this.dialogTrigger = button; this.openDialog('crisis'); break;
      case 'close-dialog': this.closeDialog(); break;
      case 'personal': this.personal = true; this.closeDialog(false); this.render('[data-act="spectate"]'); window.scrollTo(0, 0); break;
      case 'spectate': this.personal = false; this.render('[data-act="trade"]'); window.scrollTo(0, 0); break;
      case 'lane':
      case 'map-pick': this.pickLane(value, act === 'map-pick'); break;
      case 'card':
        this.rememberDetails();
        this.selection.slot = value === this.selection.slot ? null : value;
        this.selection.prepare = false;
        this.selection.cardOpen = false;
        this.render(`[data-act="card"][data-value="${value}"]`);
        break;
      case 'prepare':
        this.selection.prepare = !this.selection.prepare;
        this.render('[data-act="prepare"]');
        break;
      case 'exchange':
        if (this.selection.slot !== null && this.run?.exchangePlayerCard(this.selection.slot)) {
          this.selection.prepare = false;
          this.render('[data-card-status]');
        }
        break;
      case 'trade': this.trade(); break;
      case 'skip': this.finishAnimation(); break;
      case 'recover':
        if (this.run?.acceptRecovery()) this.afterTrade();
        break;
      case 'offer-card': this.offered = value; this.openDialog('offer', `[data-act="offer-card"][data-value="${value}"]`); break;
      case 'replace': this.replace = value; this.openDialog('offer', `[data-act="replace"][data-value="${value}"]`); break;
      case 'take': this.takeOffer(this.offered, this.replace); break;
      case 'decline': this.takeOffer(null, null); break;
      case 'share': this.dialogTrigger = button; void this.share(); break;
    }
  }

  private start(seed: number) {
    this.closeDialog(false);
    this.seed = seed;
    this.run = new TradingRun(this.config, { playerId: this.selectedCharacter, seed, difficulty: this.difficulty });
    this.personal = false;
    this.lastCrisis = null;
    this.clearSelection();
    const url = new URL(location.href);
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
    this.audio.unlock();
    this.audio.play('rise');
    this.render('[data-act="lane"]');
    window.scrollTo(0, 0);
    this.announce('開盤啦，選一條路下單。');
  }

  private rememberDetails() {
    this.selection.financeOpen = Boolean(this.screen.querySelector('[data-detail="financial"][open]'));
    this.selection.cardOpen = Boolean(this.screen.querySelector('[data-detail="card"][open]'));
  }

  private clearSelection() {
    this.selection.lane = null;
    this.selection.slot = null;
    this.selection.prepare = false;
    this.selection.cardOpen = false;
  }

  private pickLane(lane: number, fromMap = false) {
    if (!this.run?.reachable(this.run.player).some(node => node.lane === lane)) return;
    this.rememberDetails();
    this.selection.lane = lane;
    if (fromMap) this.closeDialog(false);
    this.render(`[data-act="lane"][data-value="${lane}"]`);
  }

  private trade() {
    const run = this.run;
    if (!run || run.closed || this.dialog.open || this.locked) return;
    const lane = this.selection.lane;
    const action = lane !== null ? { lane, card: this.selection.slot, prepare: this.selection.prepare } : null;
    if (!run.player.account.eliminated && !action) return;
    this.audio.unlock();
    if (!run.confirm(action)) return;
    this.rememberDetails();
    this.clearSelection();
    const report = run.pendingRecovery ?? run.reports.at(-1);
    if (report?.market) {
      const tone = marketTone(report.market, this.config);
      this.audio.play(report.market.severity === 'extreme' ? 'impact' : tone === 'negative' ? 'fall' : 'rise');
    } else {
      const outcome = report?.outcomes.find(item => item.investor === run.player);
      this.audio.play(outcome?.ledger.protected ? 'shield' : outcome ? outcome.close < outcome.start ? 'fall' : 'rise' : 'flat');
    }
    if (this.reduced) this.afterTrade();
    else this.animateTrade();
  }

  private animateTrade() {
    this.locked = true;
    this.screen.querySelectorAll('.seat').forEach(seat => seat.classList.add('executing'));
    this.announce('四位投資人正在結算交易。');
    const button = this.screen.querySelector<HTMLButtonElement>('[data-act="trade"]')!;
    button.dataset.act = 'skip';
    button.textContent = '交易結算中・點擊略過';
    this.transitionTimer = window.setTimeout(() => this.finishAnimation(), 240);
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
    this.selection.animate = true;
    this.render(run.closed ? '[data-act="replay"]' : '[data-act="lane"], [data-act="trade"]');
    if (!this.reduced && report?.market && report.market.severity !== 'normal') void this.playMarketEffect(report);
    if (report && outcome && (outcome.risk.call || outcome.risk.insolvent)) this.lastCrisis = { report, outcome };
    if (run.pendingRecovery && this.lastCrisis) this.openDialog('recovery');
    else if (outcome && !outcome.recovery && (outcome.risk.call || outcome.risk.insolvent)) this.openDialog('crisis');
    else this.showOffer();
    this.announce(run.closed ? '本局正式收盤。' : `第 ${run.day} 個交易日。`);
    if (run.closed) window.scrollTo(0, 0);
  }

  private async playMarketEffect(report: DayReport) {
    const strip = this.screen.querySelector('.market-strip');
    if (!strip || !report.market) return;
    try {
      const { mountMarketEffect } = await import('./ui/market-effects');
      if (!strip.isConnected || this.reduced || !this.run) return;
      const host = document.createElement('div');
      host.className = 'market-art';
      host.setAttribute('aria-hidden', 'true');
      strip.prepend(host);
      const tone = marketTone(report.market, this.config);
      const color = getComputedStyle(this.root).getPropertyValue(tone === 'negative' ? '--loss' : '--gain').trim();
      this.disposeEffect = mountMarketEffect(host, this.run.options.seed ^ report.day, Number.parseInt(color.slice(1), 16), report.market.severity === 'extreme');
    } catch (error) {
      console.warn('市場像素特效無法播放', error);
    }
  }

  private showOffer() {
    if (!this.run?.offer || this.dialog.open) return;
    this.offered = this.run.offer.cards.length === 1 ? 0 : null;
    this.replace = null;
    this.openDialog('offer');
  }

  private takeOffer(card: number | null, replace: number | null) {
    if (!this.run?.chooseOffer(card, replace)) return;
    this.closeDialog(false);
    this.render('[data-act="lane"]');
    this.showOffer();
  }

  private openDialog(kind: DialogKind, focus?: string) {
    this.dialogKind = kind;
    const run = this.run!;
    let heading = '';
    let content = '';
    switch (kind) {
      case 'map':
        heading = '市場路線圖';
        content = routeMapMarkup(run, this.selection.lane);
        break;
      case 'offer':
        heading = run.offer?.source === 'draft' ? '抽張好牌・三選一' : '開盤抽卡';
        content = offerMarkup(run, this.offered, this.replace);
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
          <label><input type="checkbox" data-input="audio" ${this.audio.enabled ? 'checked' : ''}> 播放交易音效</label></div>`;
        break;
      case 'share':
        heading = '分享結算';
        content = `<p>可複製以下結算摘要。</p><textarea aria-label="結算摘要" readonly rows="8">${escapeHtml(shareText(run))}</textarea>`;
        break;
    }
    const dismissible = kind !== 'recovery' && kind !== 'offer';
    this.dialog.className = `terminal-dialog dialog-${kind}`;
    this.dialog.innerHTML = `<header><h2 id="dialog-heading" tabindex="-1">${heading}</h2>${dismissible ?
      '<button type="button" data-act="close-dialog" aria-label="關閉視窗">×</button>' : ''}</header><div class="dialog-body">${content}</div>`;
    this.paint(this.dialog);
    if (!this.dialog.open) {
      this.dialog.showModal();
      this.dialog.querySelector<HTMLElement>('#dialog-heading')?.focus({ preventScroll: true });
      this.dialog.scrollTop = 0;
    }
    if (kind === 'map') this.dialog.querySelector('.current-row')?.scrollIntoView({ block: 'nearest' });
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
    if (!this.run || this.run.closed || this.dialog.open || this.personal || this.locked || event.altKey || event.ctrlKey || event.metaKey ||
      (event.target as Element).closest('input, select, textarea')) return;
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-act="trade"]');
    if (target && !target.disabled && ['Enter', 'NumpadEnter', 'Space'].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) this.trade();
      return;
    }
    const slot = /^Digit([1-9])$/.exec(event.code);
    if (slot && this.run.player.hand[Number(slot[1]) - 1] && !this.run.player.account.eliminated) {
      event.preventDefault();
      this.screen.querySelector<HTMLButtonElement>(`[data-act="card"][data-value="${Number(slot[1]) - 1}"]`)?.click();
    }
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    const lanes = this.run.reachable(this.run.player).map(node => node.lane);
    if (!lanes.length) return;
    event.preventDefault();
    const index = lanes.indexOf(this.selection.lane ?? -1);
    const next = index < 0 ? 0 : (index + lanes.length + (event.code === 'ArrowLeft' ? -1 : 1)) % lanes.length;
    this.pickLane(lanes[next]);
  };
}

const root = document.querySelector<HTMLElement>('#app')!;
try {
  new TerminalApp(root, readFinancialConfig());
} catch (error) {
  root.innerHTML = `<main class="initial-error"><h1>開盤卡住了</h1><p>${escapeHtml(error instanceof Error ? error.message : '遊戲資料讀取失敗')}</p></main>`;
  console.error(error);
}
