import './style.css';
import { readFinancialConfig, type FinancialConfig, type TradingDifficulty } from './config/financial-settings';
import { TradingRun, type DayOutcome, type DayReport } from './core/trading-run';
import { marketTone } from './core/trading-effects';
import { CardAudio } from './ui/audio';
import { crisisMarkup } from './ui/crisis-dialog';
import { escapeHtml, money, signedMoney } from './ui/format';
import { drawIcon, portrait, sprite, type SpriteMood } from './ui/pixels';
import { settlementMarkup, shareText } from './ui/settlement';
import { cardRulesMarkup, chartDialogMarkup, newsMarkup, offerMarkup, openingMarkup, tradingMarkup, type TerminalSelection } from './ui/trading-terminal';
import { Coach, type TipId } from './ui/coach';
import { readTheaterConfig, type TheaterConfig } from './config/theater-settings';
import { MarketTheater } from './ui/theater';
import { buildTheater, type Step, type TheaterMode } from './ui/theater-script';

type DialogKind = 'crisis' | 'recovery' | 'offer' | 'settings' | 'share' | 'chart' | 'news' | 'card-rules';
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

class TerminalApp {
  private run: TradingRun | null = null;
  private readonly screen: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly audio = new CardAudio();
  private readonly selection: TerminalSelection = { allocation: null, slot: null, prepare: false, animate: false };
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
  private readonly coach = new Coach();
  private readonly theater: TheaterConfig;
  private theaterMode: TheaterMode = 'full';
  private theaterDay = 0;
  private stage: MarketTheater | null = null;
  private rulesSlot = 0;

  constructor(private readonly root: HTMLElement, private readonly config: FinancialConfig) {
    const fromUrl = new URLSearchParams(location.search).get('seed') ?? '';
    this.seed = /^\d{1,10}$/.test(fromUrl) && Number(fromUrl) <= 0xffffffff ? Number(fromUrl) : freshSeed();
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
      ${run ? complete ? settlementMarkup(run, this.personal) : tradingMarkup(run, this.selection, this.coach.markup(run, this.selection))
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
    parent.querySelectorAll<HTMLCanvasElement>('[data-sprite]').forEach(canvas => {
      const character = this.config.characters.find(item => item.id === canvas.dataset.sprite);
      if (character) sprite(canvas, character, (canvas.dataset.mood ?? 'idle') as SpriteMood);
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
    if (target.dataset.input === 'theater' && ['full', 'quick', 'off'].includes(target.value)) {
      this.theaterMode = target.value as TheaterMode;
      try { localStorage.setItem('stock-summit-theater', this.theaterMode); } catch { /* ignore */ }
    }
    if (target.dataset.input === 'tips') { this.coach.setEnabled(target.checked); if (this.run && !this.dialog.open) this.render(); }
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
      case 'chart': case 'news': this.dialogTrigger = button; this.openDialog(act); break;
      case 'card-rules': this.dialogTrigger = button; this.rulesSlot = value; this.openDialog('card-rules'); break;
      case 'tip-ok': this.coach.dismiss(button.dataset.value as TipId); this.render('[data-act="trade"]'); break;
      case 'coach-off': this.coach.setEnabled(false); this.render('[data-act="trade"]'); break;
      case 'crisis': this.dialogTrigger = button; this.openDialog('crisis'); break;
      case 'close-dialog': this.closeDialog(); break;
      case 'personal': this.personal = true; this.closeDialog(false); this.render('[data-act="spectate"]'); window.scrollTo(0, 0); break;
      case 'spectate': this.personal = false; this.render('[data-act="trade"]'); window.scrollTo(0, 0); break;
      case 'alloc': this.pickAllocation(button.dataset.value ?? ''); break;
      case 'card':
        this.selection.slot = value === this.selection.slot ? null : value;
        this.selection.prepare = false;
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
    this.theaterDay = 0;
    this.stage?.close();
    this.clearSelection();
    const url = new URL(location.href);
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
    this.audio.unlock();
    this.audio.play('rise');
    this.render('[data-act="alloc"][aria-pressed="true"]');
    window.scrollTo(0, 0);
    this.announce('開盤啦，先決定今天買多少股票。');
  }

  private clearSelection() {
    this.selection.allocation = null;
    this.selection.slot = null;
    this.selection.prepare = false;
  }

  private pickAllocation(id: string) {
    if (!this.run?.config.allocation.options.some(option => option.id === id)) return;
    this.selection.allocation = id;
    this.render(`[data-act="alloc"][data-value="${id}"]`);
  }

  private trade() {
    const run = this.run;
    if (!run || run.closed || this.dialog.open || this.locked) return;
    const action = run.player.account.eliminated ? null : { lane: 0, card: this.selection.slot, prepare: this.selection.prepare,
      allocation: this.selection.allocation ?? run.player.allocation };
    this.audio.unlock();
    if (!run.confirm(action)) return;
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
    this.transitionTimer = window.setTimeout(() => this.finishAnimation(), 320);
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
    const next = () => {
      if (run.pendingRecovery && this.lastCrisis) this.openDialog('recovery');
      else if (outcome && !outcome.recovery && outcome.risk.insolvent) this.openDialog('crisis');
      else this.showOffer();
    };
    if (settled && steps.length) {
      this.theaterDay = settled.day;
      void this.playTheater(steps, settled).then(next);
    } else next();
    this.announce(run.closed ? '本局正式收盤。' : `第 ${run.day} 個交易日。${outcome ? `你昨天 ${signedMoney(outcome.close - outcome.start)}。` : ''}`);
    if (run.closed) window.scrollTo(0, 0);
  }

  /** One sound per day, picked from the settlement record in order of importance. */
  private playSound(report: DayReport, outcome: DayOutcome) {
    const ranks = this.run!.player.ranks;
    const climbed = ranks.length > 1 && ranks.at(-1)! < ranks.at(-2)!;
    const sound = outcome.risk.insolvent ? 'alarm'
      : report.market?.severity === 'extreme' ? 'impact'
      : outcome.ledger.protected ? 'shield'
      : outcome.ledger.synergies ? 'combo'
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
    if (!this.run?.offer || this.dialog.open) return;
    this.offered = this.run.offer.cards.length === 1 ? 0 : null;
    this.replace = null;
    this.openDialog('offer');
  }

  private takeOffer(card: number | null, replace: number | null) {
    if (!this.run?.chooseOffer(card, replace)) return;
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
          <label><input type="checkbox" data-input="audio" ${this.audio.enabled ? 'checked' : ''}> 播放交易音效</label>
          <label><input type="checkbox" data-input="tips" ${this.coach.enabled ? 'checked' : ''}> 顯示新手提示</label>
          <label class="select-label">市場新聞演出<select data-input="theater">${([['full', '完整 RPG 演出'], ['quick', '快速演出'], ['off', '略過演出']] as const)
            .map(([value, label]) => `<option value="${value}" ${this.theaterMode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
        break;
      case 'chart':
        heading = '總身家走勢';
        content = chartDialogMarkup(run);
        break;
      case 'news':
        heading = '市場快訊';
        content = newsMarkup(run);
        break;
      case 'card-rules': {
        const card = run.player.hand[this.rulesSlot];
        if (!card) return;
        heading = '卡片規則';
        content = cardRulesMarkup(run, card);
        break;
      }
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
    if (this.run.player.account.eliminated) return;
    const ids = this.run.config.allocation.options.map(option => option.id);
    event.preventDefault();
    const index = ids.indexOf(this.selection.allocation ?? this.run.player.allocation);
    this.pickAllocation(ids[Math.max(0, Math.min(ids.length - 1, index + (event.code === 'ArrowLeft' ? -1 : 1)))]);
  };
}

const root = document.querySelector<HTMLElement>('#app')!;
try {
  new TerminalApp(root, readFinancialConfig());
} catch (error) {
  root.innerHTML = `<main class="initial-error"><h1>開盤卡住了</h1><p>${escapeHtml(error instanceof Error ? error.message : '遊戲資料讀取失敗')}</p></main>`;
  console.error(error);
}
