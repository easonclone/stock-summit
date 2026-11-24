import type { FinancialConfig } from '../config/financial-settings';
import type { TheaterConfig } from '../config/theater-settings';
import type { CardAudio } from './audio';
import { escapeHtml, money, signedMoney } from './format';
import { portrait, sprite, type SpriteMood } from './pixels';
import { drawScene, speakerPortrait } from './theater-art';
import type { ResultRow, Step, TheaterMode } from './theater-script';

interface Options {
  root: HTMLElement; config: FinancialConfig; theater: TheaterConfig; audio: CardAudio; mode: TheaterMode; reduced: boolean;
  colors: { up: string; down: string }; seed: number;
  /** Optional Phaser burst over the stage; purely decorative and skippable. */
  effect?: (host: HTMLElement, tone: string, intense: boolean) => Promise<(() => void) | undefined>;
}

/**
 * RPG-style market event theater. Plays a script built from an already-settled report;
 * nothing here can change the game, so skipping at any point leaves results untouched.
 */
export class MarketTheater {
  private readonly el: HTMLElement;
  private readonly scene: HTMLCanvasElement;
  private readonly text: HTMLElement;
  private readonly box: HTMLElement;
  private index = -1;
  private typing: { full: string; shown: number; timer: number } | null = null;
  private auto = 0;
  private frame = 0;
  private started = performance.now();
  private sceneStep: Extract<Step, { kind: 'scene' }> | null = null;
  private strength = .4;
  private disposeEffect: (() => void) | undefined;
  private finished = false;
  private resolve!: () => void;
  readonly done: Promise<void>;

  constructor(private readonly steps: Step[], private readonly options: Options) {
    this.done = new Promise(resolve => { this.resolve = resolve; });
    const first = steps[0];
    const severity = first?.kind === 'scene' ? first.severity : 'normal';
    const tone = first?.kind === 'scene' ? first.tone : 'neutral';
    this.el = document.createElement('div');
    this.el.className = `theater sev-${severity} tone-${tone} mode-${options.mode}`;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', '市場事件劇場');
    const cast = options.config.characters.map(character =>
      `<canvas class="actor" data-actor="${character.id}" width="28" height="34" style="--ink:${character.color}" aria-hidden="true"></canvas>`).join('');
    this.el.innerHTML = `<div class="theater-frame">
      <div class="theater-stage" data-th="advance"><canvas class="scene" aria-hidden="true"></canvas><div class="theater-fx" aria-hidden="true"></div>
        <div class="scene-banner"><small></small><strong></strong><span></span></div><div class="theater-cast">${cast}</div><div class="theater-pops" aria-hidden="true"></div></div>
      <div class="rpg-box" data-th="advance" tabindex="0" aria-label="市場事件對話，按 Enter 或點擊繼續"><canvas class="rpg-face" width="32" height="32" aria-hidden="true"></canvas>
        <div class="rpg-body"><b class="rpg-name"></b><p class="rpg-text" aria-live="polite"></p></div><span class="rpg-next" aria-hidden="true">▼</span></div>
      <div class="theater-controls"><span class="theater-hint">點對話框或按 Enter 繼續</span><button type="button" class="theater-skip" data-th="skip">略過演出 ≫</button></div>
    </div>`;
    this.scene = this.el.querySelector('.scene')!;
    this.text = this.el.querySelector('.rpg-text')!;
    this.box = this.el.querySelector('.rpg-box')!;
    this.el.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey, true);
    options.root.append(this.el);
    this.paintCast(null);
    this.next();
    this.box.focus({ preventScroll: true });
    if (!options.reduced) this.loop();
  }

  private readonly onClick = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-th]');
    if (!target) return;
    if (target.dataset.th === 'skip' || target.dataset.th === 'close') this.close();
    else this.advance();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (this.finished) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (['Enter', 'NumpadEnter', 'Space'].includes(event.code)) {
      if ((event.target as Element).closest?.('.theater-skip')) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.advance();
    }
  };

  /** First press completes the current line; the next press moves on. */
  private advance() {
    if (this.finished) return;
    if (this.typing) { this.completeLine(); return; }
    this.next();
  }

  private speed() {
    return this.options.reduced ? 0 : this.options.mode === 'quick' ? 14 : 30;
  }

  private hold(ms: number) {
    window.clearTimeout(this.auto);
    if (this.options.reduced && this.steps[this.index]?.kind !== 'results') return;
    this.auto = window.setTimeout(() => this.next(), this.options.mode === 'quick' ? ms * .55 : ms);
  }

  private next() {
    window.clearTimeout(this.auto);
    this.stopTyping();
    this.index += 1;
    const step = this.steps[this.index];
    if (!step) { this.close(); return; }
    this.el.dataset.step = step.kind;
    switch (step.kind) {
      case 'scene': return this.showScene(step);
      case 'line': return this.showLine(step);
      case 'effect': return this.showEffect(step);
      case 'results': return this.showResults(step.rows, step.final);
    }
  }

  private showScene(step: Extract<Step, { kind: 'scene' }>) {
    this.sceneStep = step;
    this.strength = step.severity === 'extreme' ? 1 : step.severity === 'major' ? .7 : .4;
    const banner = this.el.querySelector('.scene-banner')!;
    banner.querySelector('small')!.textContent = step.kicker;
    banner.querySelector('strong')!.textContent = step.title;
    banner.querySelector('span')!.textContent = step.subtitle;
    this.el.classList.remove('scene-in');
    void this.el.offsetWidth;
    this.el.classList.add('scene-in');
    this.options.audio.play(step.sound);
    this.drawStatic();
    this.setSpeaker(null, '');
    this.text.textContent = '';
    this.hold(step.severity === 'extreme' ? 1300 : step.severity === 'major' ? 900 : 650);
  }

  private showLine(step: Extract<Step, { kind: 'line' }>) {
    if (step.speakerKind === 'anchor') {
      const speaker = this.options.theater.speakers[step.speakerId];
      speakerPortrait(this.el.querySelector('.rpg-face')!, speaker, true);
      this.setSpeaker(speaker.color, `${escapeHtml(speaker.name)}<small>${escapeHtml(speaker.role)}</small>`);
      this.paintCast(null);
    } else {
      const character = this.options.config.characters.find(item => item.id === step.speakerId)!;
      portrait(this.el.querySelector('.rpg-face')!, character);
      this.setSpeaker(character.color, escapeHtml(character.name));
      this.paintCast({ id: step.speakerId, mood: step.mood });
    }
    this.options.audio.play('page');
    this.type(step.text);
  }

  private showEffect(step: Extract<Step, { kind: 'effect' }>) {
    this.strength = Math.min(1, this.strength + .3);
    this.setSpeaker(null, '');
    this.text.textContent = '';
    this.box.classList.add('quiet');
    this.el.classList.add('shake');
    window.setTimeout(() => this.el.classList.remove('shake'), 500);
    const pops = this.el.querySelector('.theater-pops')!;
    pops.innerHTML = step.rows.filter(row => row.applied || row.shielded).map((row, slot) => {
      const bits = [row.market ? `<b class="${row.market > 0 ? 'gain' : 'loss'}">${signedMoney(row.market)}</b>` : '<b class="flat">不受影響</b>',
        row.shielded ? `<i class="pop-shield">◆ 擋 ${money(row.shielded)}</i>` : '', row.combos ? `<i class="pop-combo">連招！</i>` : ''].join('');
      return `<span class="pop" style="--slot:${this.options.config.characters.findIndex(item => item.id === row.id)};--delay:${slot * 120}ms">${bits}</span>`;
    }).join('');
    this.paintCast(null, step.rows);
    this.options.audio.play(step.tone === 'negative' ? 'fall' : 'rise');
    if (step.rows.some(row => row.shielded)) window.setTimeout(() => this.options.audio.play('shield'), 380);
    if (!this.options.reduced && this.options.effect) {
      const host = this.el.querySelector<HTMLElement>('.theater-fx')!;
      void this.options.effect(host, step.tone, this.sceneStep?.severity === 'extreme').then(dispose => {
        if (this.finished) dispose?.(); else this.disposeEffect = dispose;
      });
    }
    this.hold(1500);
  }

  private showResults(rows: ResultRow[], final: boolean) {
    this.box.classList.remove('quiet');
    this.el.querySelector('.theater-pops')!.innerHTML = '';
    const ordered = [...rows].sort((a, b) => (a.rankAfter ?? 9) - (b.rankAfter ?? 9));
    this.box.dataset.th = '';
    this.box.classList.add('results');
    this.box.innerHTML = `<div class="theater-results"><p class="results-title">${final ? '最終排名' : '今日實際結算'}</p><ol>${ordered.map(row => {
      const move = row.rankBefore !== null && row.rankAfter !== null ? row.rankBefore - row.rankAfter : 0;
      return `<li class="${row.isPlayer ? 'me' : ''}" style="--ink:${row.color}"><span class="r-rank">${row.rankAfter ? `#${row.rankAfter}` : '出局'}${move ? `<small class="${move > 0 ? 'gain' : 'loss'}">${move > 0 ? '▲' : '▼'}${Math.abs(move)}</small>` : ''}</span>
        <span class="r-name">${escapeHtml(row.name)}${row.isPlayer ? '<em>你</em>' : ''}</span>
        <span class="r-news">${!row.applied ? '<b class="flat">新聞沒波及</b>' : row.market ? `新聞 <b class="${row.market > 0 ? 'gain' : 'loss'}">${signedMoney(row.market)}</b>` : row.empty ? '<b class="flat">空手沒受影響</b>' : '新聞 <b class="flat">$0</b>'}${row.shielded ? ` <i>◆ ${money(row.shielded)}</i>` : ''}</span>
        <span class="r-net">今日 <b class="${row.net > 0 ? 'gain' : row.net < 0 ? 'loss' : 'flat'}">${row.net ? signedMoney(row.net) : '$0'}</b></span></li>`;
    }).join('')}</ol><button type="button" class="gold-button" data-th="close">${final ? '看結算' : '回到交易'} <span aria-hidden="true">→</span></button></div>`;
    if (ordered.some(row => row.isPlayer && row.rankBefore !== null && row.rankAfter !== null && row.rankAfter < row.rankBefore)) this.options.audio.play('rank');
    this.box.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    this.hold(final ? 6000 : 4200);
  }

  private setSpeaker(color: string | null, html: string) {
    this.box.classList.toggle('narration', !color);
    this.box.style.setProperty('--ink', color ?? 'var(--outline)');
    this.el.querySelector('.rpg-name')!.innerHTML = html;
  }

  private type(full: string) {
    this.box.classList.remove('quiet');
    this.box.classList.add('typing');
    const delay = this.speed();
    if (!delay) { this.text.textContent = full; this.finishLine(full); return; }
    this.typing = { full, shown: 0, timer: 0 };
    const tick = () => {
      if (!this.typing) return;
      this.typing.shown += 1;
      this.text.textContent = full.slice(0, this.typing.shown);
      if (this.typing.shown % 3 === 1) this.options.audio.play('blip');
      if (this.typing.shown >= full.length) { this.completeLine(); return; }
      this.typing.timer = window.setTimeout(tick, delay);
    };
    tick();
  }

  private completeLine() {
    if (!this.typing) return;
    const { full } = this.typing;
    this.stopTyping();
    this.text.textContent = full;
    this.finishLine(full);
  }

  private finishLine(full: string) {
    this.box.classList.remove('typing');
    this.hold(1100 + full.length * 45);
  }

  private stopTyping() {
    if (this.typing) window.clearTimeout(this.typing.timer);
    this.typing = null;
  }

  private paintCast(focus: { id: string; mood: SpriteMood } | null, rows?: ResultRow[]) {
    for (const canvas of this.el.querySelectorAll<HTMLCanvasElement>('[data-actor]')) {
      const character = this.options.config.characters.find(item => item.id === canvas.dataset.actor)!;
      const row = rows?.find(item => item.id === character.id);
      const mood: SpriteMood = focus?.id === character.id ? focus.mood
        : row ? row.shielded ? 'shield' : row.market > 0 ? 'gain' : row.market < 0 ? 'loss' : 'idle' : 'idle';
      sprite(canvas, character, mood);
      canvas.dataset.mood = mood;
      canvas.classList.toggle('speaking', focus?.id === character.id);
      canvas.classList.toggle('dim', Boolean(focus) && focus!.id !== character.id);
    }
  }

  private drawStatic() {
    if (!this.sceneStep) return;
    drawScene(this.scene, this.options.theater, {
      sceneId: this.sceneStep.sceneId, animationId: this.options.reduced ? null : this.sceneStep.animationId, tone: this.sceneStep.tone,
      t: (performance.now() - this.started) / 1000, strength: this.strength, glitch: false
    }, this.options.colors);
  }

  private loop() {
    let last = 0;
    const draw = (now: number) => {
      if (this.finished) return;
      if (now - last > 83 && this.sceneStep) {
        last = now;
        drawScene(this.scene, this.options.theater, {
          sceneId: this.sceneStep.sceneId, animationId: this.sceneStep.animationId, tone: this.sceneStep.tone,
          t: (now - this.started) / 1000, strength: this.strength,
          glitch: this.sceneStep.animationId === 'glitch' && Math.floor(now / 160) % 3 === 0
        }, this.options.colors);
      }
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  close() {
    if (this.finished) return;
    this.finished = true;
    window.clearTimeout(this.auto);
    this.stopTyping();
    cancelAnimationFrame(this.frame);
    this.disposeEffect?.();
    document.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.resolve();
  }
}
