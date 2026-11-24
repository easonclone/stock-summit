import './style.css';
import { inputConfig, readConfig, type Config, type Difficulty } from './config/settings';
import { Run, type RunOptions } from './core/run';
import { CardAudio } from './ui/audio';
import { element, Hud, raceMarkup, setText } from './ui/hud';
import { cardIcon, drawIcon, portrait, titleArt } from './ui/pixels';

import { reportMarkup, renderReport } from './ui/report';

type Screen = 'home' | 'select' | 'guide' | 'codex' | 'settings' | 'race' | 'result';

class App {
  private screen: Screen = 'home';
  private race?: Run;
  private destroyCourse?: () => void;
  private hud?: Hud;
  private readonly audio = new CardAudio();
  private readonly content: HTMLElement;
  private readonly indicator: HTMLElement;
  private playerId: string;
  private difficulty: Difficulty = 'normal';
  private colorStyle = 'taiwan';
  private shake = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly requestedSeed: number | null;

  constructor(root: HTMLElement, private readonly config: Config) {
    this.playerId = config.characters[0].id;
    const seedParam = new URLSearchParams(location.search).get('seed');
    this.requestedSeed = seedParam && /^\d{1,10}$/.test(seedParam) && Number(seedParam) <= 0xffffffff ? Number(seedParam) : null;
    root.style.setProperty('--gold', config.theme.gold);
    root.style.setProperty('--night', config.theme.night);
    root.style.setProperty('--panel', config.theme.panel);
    this.updateColors();
    root.innerHTML = `
      <div class="cabinet">
        <header class="shell-top">
          <button class="brand" type="button" aria-label="股市攻頂戰首頁"><i aria-hidden="true"></i><span>STOCK SUMMIT</span></button>
          <div class="status"><i></i><span id="screen-status">待開盤</span></div>
        </header>
        <main id="screen"></main>
        <footer class="shell-foot">股市攻頂戰</footer>
      </div>`;
    this.content = element(root, '#screen');
    this.indicator = element(root, '#screen-status');
    element(root, '.brand').addEventListener('click', () => {
      if (this.screen !== 'race' || window.confirm('離開本局並返回首頁？')) this.home();
    });
    window.addEventListener('keydown', this.keyDown);
    this.home(false);
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    const race = this.race;
    if (this.screen !== 'race' || !race || race.result || event.altKey || event.ctrlKey || event.metaKey) return;
    const card = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    if (card && !event.repeat) {
      event.preventDefault();
      race.usePlayerCard(Number(card[1]) - 1);
      return;
    }
    const step = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[event.code];
    if (step) {
      event.preventDefault();
      this.cycle(step);
      return;
    }
    if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat && race.selected !== null) {
      // A focused button already activates on Enter/Space; confirming here as well would double-handle it.
      if (event.target instanceof Element && event.target.closest('button, select, input')) return;
      event.preventDefault();
      this.confirm();
    }
  };

  /** Moves the pending pick to the previous or next reachable lane. */
  private cycle(step: number) {
    const race = this.race!;
    const lanes = race.reachable(race.player);
    if (!lanes.length) return;
    const index = race.selected === null ? (step > 0 ? -1 : lanes.length) : lanes.indexOf(race.selected);
    race.select(lanes[(index + step + lanes.length) % lanes.length]);
    this.hud?.render();
  }

  private confirm() {
    const race = this.race;
    if (!race || !race.resolve()) return;
    if (race.result) {
      // Leave the closing news on screen briefly, then show the report.
      window.setTimeout(() => {
        if (this.race === race && this.screen === 'race') this.finish(race);
      }, this.config.gameplay.newsMs);
    }
    this.hud?.render();
  }

  private colors() {
    const { up, down } = this.config.theme;
    return this.colorStyle === 'taiwan' ? { up, down } : { up: down, down: up };
  }

  private updateColors() {
    const colors = this.colors();
    document.documentElement.style.setProperty('--up', colors.up);
    document.documentElement.style.setProperty('--down', colors.down);
  }

  private switchTo(screen: Screen, status: string, html: string) {
    this.destroyCourse?.();
    this.destroyCourse = undefined;
    this.hud = undefined;
    this.screen = screen;
    this.content.className = `screen-${screen}`;
    this.content.innerHTML = html;
    setText(this.indicator, status);
  }

  private bind(query: string, action: () => void) {
    element(this.content, query).addEventListener('click', action);
  }

  private home(focus = true) {
    this.race = undefined;
    this.switchTo('home', '待開盤', `
      <div class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><i class="square"></i> 財富攻頂賽</p>
          <h1>股市<br><em>攻頂戰</em></h1>
          <p class="hero-en" aria-hidden="true">STOCK SUMMIT</p>
          <p class="intro">四人同步規劃路線，每個交易日一起選下一步。15 天後收盤，層數加上鈔票加成最高者勝出。</p>
          <button id="begin" class="button primary" type="button">開始遊戲</button>
          <nav class="menu-links" aria-label="遊戲選單">
            <button type="button" id="guide" class="button subtle">玩法說明</button>
            <button type="button" id="codex" class="button subtle">圖鑑</button>
            <button type="button" id="settings" class="button subtle">設定</button>
          </nav>
        </div>
        <div class="hero-scene">
          <canvas aria-hidden="true"></canvas>
          <div class="scene-tag"><i class="square"></i><span>黃金財富之巔</span></div>
        </div>
      </div>
      <div class="keys"><span><kbd>←</kbd><kbd>→</kbd> 選擇節點</span><span><kbd>Enter</kbd> 確認進場</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 用卡</span></div>`);
    titleArt(element(this.content, '.hero canvas'), this.config.characters);
    this.bind('#begin', () => this.select());
    this.bind('#guide', () => this.guide());
    this.bind('#codex', () => this.codex());
    this.bind('#settings', () => this.settings());
    if (focus) element(this.content, '#begin').focus();
  }

  private select() {
    this.switchTo('select', '挑選選手', `
      <div class="pane">
        <div class="pane-top"><button class="button subtle small" id="back" type="button">返回首頁</button></div>
        <h1>選擇角色</h1>
        <p>四位選手能力相同。選一位出賽，其餘由電腦控制。</p>
        <div id="characters" class="characters" role="group" aria-label="參賽角色"></div>
        <div class="pane-actions"><button id="race-start" class="button primary" type="button">確認出賽</button></div>
      </div>`);
    const group = element(this.content, '#characters');
    const refresh = () => {
      for (const item of group.querySelectorAll<HTMLButtonElement>('button')) {
        const selected = item.value === this.playerId;
        item.setAttribute('aria-pressed', String(selected));
        setText(element(item, '.role'), selected ? '玩家' : '電腦');
      }
    };
    for (const character of this.config.characters) {
      const button = document.createElement('button');
      button.type = 'button';
      button.value = character.id;
      button.className = 'character';
      button.style.setProperty('--racer', character.color);
      button.innerHTML = '<span class="role"></span><canvas aria-hidden="true"></canvas><strong></strong><small></small>';
      portrait(element(button, 'canvas'), character);
      setText(element(button, 'strong'), character.name);
      setText(element(button, 'small'), character.description);
      button.addEventListener('click', () => { this.playerId = character.id; refresh(); });
      group.append(button);
    }
    refresh();
    this.bind('#back', () => this.home());
    this.bind('#race-start', () => void this.start());
    element(group, '[aria-pressed="true"]').focus();
  }

  private guide() {
    this.switchTo('guide', '玩法說明', `
      <div class="pane information">
        <div class="pane-top"><button class="button subtle small" id="back" type="button">返回首頁</button></div>
        <h1>玩法說明</h1>
        <dl>
          <dt>規劃路線</dt><dd>路線圖由下往上共 15 列，每列代表一個交易日。每天只能走進與目前節點相連的下一列節點，四位選手同時選擇、同時結算，沒有時間壓力。</dd>
          <dt>節點類型</dt><dd>穩健持有穩定上升；槓桿加碼爬得多，但下一次市場利空會放大跌幅；獲利了結不爬升而是收取鈔票；問號卡箱與研究報告提供卡片或下一次市場預告；抄底補給只有落後者能領到補給卡。</dd>
          <dt>市場事件</dt><dd>每 3 個交易日結算後會發生一次虛構市場事件，可能讓全體或特定名次上升、下滑或停牌。停牌期間進入的節點沒有效果。</dd>
          <dt>使用卡片</dt><dd>卡欄最多 3 張。在確認進場前按數字 1、2、3 或點卡片使用，部分卡片會鎖定前方最近的對手。</dd>
          <dt>收盤計分</dt><dd>第 15 個交易日結束後收盤。分數等於實際層數加上鈔票加成（每 100 元加 1.2 層，最多 3 層）。</dd>
        </dl>
      </div>`);
    this.bind('#back', () => this.home());
    element(this.content, '#back').focus();
  }

  private codex() {
    this.switchTo('codex', '遊戲圖鑑', `
      <div class="pane information">
        <div class="pane-top"><button class="button subtle small" id="back" type="button">返回首頁</button></div>
        <h1>遊戲圖鑑</h1>
        <h2>卡片</h2><ul class="card-gallery"></ul>
        <h2>虛構市場事件</h2><ul class="catalog-events"></ul>
      </div>`);
    const cards = element(this.content, '.card-gallery');
    for (const card of this.config.cards) {
      const item = document.createElement('li');
      item.style.setProperty('--card', card.color);
      item.innerHTML = '<div class="card-art"><canvas aria-hidden="true"></canvas></div><div><strong></strong><p></p></div>';
      cardIcon(element(item, 'canvas'), card);
      setText(element(item, 'strong'), card.name);
      setText(element(item, 'p'), card.description);
      cards.append(item);
    }
    const events = element(this.content, '.catalog-events');
    for (const news of this.config.events) {
      const item = document.createElement('li');
      item.innerHTML = '<canvas aria-hidden="true"></canvas><div><strong></strong><span></span></div>';
      drawIcon(element(item, 'canvas'), news.icon, '#f3cd7b');
      setText(element(item, 'strong'), news.title);
      setText(element(item, 'span'), news.description);
      events.append(item);
    }
    this.bind('#back', () => this.home());
    element(this.content, '#back').focus();
  }

  private settings() {
    this.switchTo('settings', '賽事設定', `
      <div class="pane information">
        <div class="pane-top"><button class="button subtle small" id="back" type="button">返回首頁</button></div>
        <h1>設定</h1>
        <div class="settings-list">
          <label>電腦難度 <select id="difficulty"><option value="easy">簡單</option><option value="normal">普通</option><option value="hard">困難</option></select></label>
          <label>漲跌配色 <select id="color"><option value="taiwan">台股 · 紅漲綠跌</option><option value="international">國際 · 綠漲紅跌</option></select></label>
          <label>事件與用卡震動 <input id="shake" type="checkbox"></label>
          <label>卡片音效 <input id="card-sound" type="checkbox"></label>
        </div>
      </div>`);
    const difficulty = element<HTMLSelectElement>(this.content, '#difficulty');
    const color = element<HTMLSelectElement>(this.content, '#color');
    const shake = element<HTMLInputElement>(this.content, '#shake');
    difficulty.value = this.difficulty;
    color.value = this.colorStyle;
    const sound = element<HTMLInputElement>(this.content, '#card-sound');
    sound.checked = this.audio.enabled;
    sound.addEventListener('change', () => {
      this.audio.enabled = sound.checked;
      if (sound.checked) this.audio.unlock();
    });
    shake.checked = this.shake;
    difficulty.addEventListener('change', () => { this.difficulty = difficulty.value as Difficulty; });
    color.addEventListener('change', () => { this.colorStyle = color.value; this.updateColors(); });
    shake.addEventListener('change', () => { this.shake = shake.checked; });
    this.bind('#back', () => this.home());
    element(this.content, '#back').focus();
  }

  private async start(replay?: RunOptions, freshSeed = false) {
    this.audio.unlock();
    const requested = freshSeed ? null : this.requestedSeed;
    const options = replay ?? {
      playerId: this.playerId,
      seed: requested ?? crypto.getRandomValues(new Uint32Array(1))[0],
      difficulty: this.difficulty
    };
    this.switchTo('race', '交易進行中', raceMarkup);
    const race = new Run(this.config, options);
    this.race = race;
    this.hud = new Hud(this.content, race, {
      useCard: slot => { race.usePlayerCard(slot); this.hud?.render(); },
      select: lane => { race.select(lane); this.hud?.render(); },
      confirm: () => this.confirm()
    });
    this.hud.render();
    const course = element(this.content, '#course');
    course.style.aspectRatio = `${this.config.theme.width} / ${this.config.theme.height}`;
    element(this.content, '#node-map').focus({ preventScroll: true });
    try {
      const { mountCourse } = await import('./scenes/course');
      if (this.race !== race || this.screen !== 'race') return;
      this.destroyCourse = mountCourse(course, {
        race,
        onUpdate: () => {
          if (this.race !== race || this.screen !== 'race') return;
          this.hud?.render();
        },
        shake: () => this.shake,
        playSound: style => this.audio.play(style),
        marketColors: () => this.colors()
      });
    } catch (error) {
      if (this.race !== race || this.screen !== 'race') return;
      console.error(error);
      this.switchTo('home', '無法開盤', '<div class="pane"><h1>遊戲載入失敗</h1><p>請重新整理頁面後再試一次。</p><button id="back" class="button subtle" type="button">返回首頁</button></div>');
      this.bind('#back', () => this.home());
    }
  }

  private finish(race: Run) {
    this.switchTo('result', '市場已收盤', reportMarkup);
    renderReport(this.content, race);
    this.bind('#replay', () => void this.start(race.options));
    this.bind('#new-course', () => void this.start(undefined, true));
    this.bind('#back', () => this.home());
    element(this.content, '#replay').focus();
  }
}

const root = element(document, '#app');
try {
  new App(root, readConfig(inputConfig));
} catch (error) {
  const message = error instanceof Error ? error.message : '遊戲啟動失敗';
  root.innerHTML = '<main class="pane"><h1>初始化失敗</h1><p></p></main>';
  setText(element(root, 'p'), message);
  console.error(error);
}
