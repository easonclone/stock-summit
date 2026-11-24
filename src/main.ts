import './style.css';
import { inputConfig, readConfig, type Config, type Difficulty } from './config/settings';
import { generateMap } from './core/map-generator';
import { Race, type RaceOptions } from './core/race';
import { CardAudio } from './ui/audio';
import { Controls } from './ui/controls';
import { element, Hud, raceMarkup, setText } from './ui/hud';
import { cardIcon, drawIcon, portrait, titleArt } from './ui/pixels';

import { reportMarkup, renderReport } from './ui/report';

type Screen = 'home' | 'select' | 'guide' | 'codex' | 'settings' | 'race' | 'result';

class App {
  private screen: Screen = 'home';
  private race?: Race;
  private destroyCourse?: () => void;
  private hud?: Hud;
  private readonly controls = new Controls();
  private readonly audio = new CardAudio();
  private readonly content: HTMLElement;
  private readonly indicator: HTMLElement;
  private playerId: string;
  private difficulty: Difficulty = 'normal';
  private map: 'mountain' | 'training' = 'mountain';
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
      if (this.screen === 'race') {
        if (!this.race?.paused) this.togglePause();
      } else {
        this.home();
      }
    });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', event => this.controls.release(event.code));
    window.addEventListener('blur', () => this.controls.clear());
    window.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'race' && !this.race?.paused) this.togglePause();
    });
    this.home(false);
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    if (this.screen !== 'race' || !this.race || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.togglePause();
      return;
    }
    if (this.race.paused) return;
    if (this.controls.hold(event.code)) {
      event.preventDefault();
      return;
    }
    const key = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    if (key && !event.repeat) {
      event.preventDefault();
      this.race.usePlayerCard(Number(key[1]) - 1);
    }
  };

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
    this.controls.clear();
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
          <p class="intro">四人同場競速，踏上鈔票與金磚鋪成的山路，在市場翻盤前搶先登頂。</p>
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
      <div class="keys"><span><kbd>←</kbd><kbd>→</kbd> 移動</span><span><kbd>↑</kbd><kbd>↓</kbd> 攀梯</span><span><kbd>Space</kbd> 跳躍</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 用卡</span></div>`);
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
          <dt>搶先登頂</dt><dd>沿梯子或懸空跳台登頂。碰到巡邏散戶會停頓 1 秒。看到粉色警戒線時，請離開落點陰影。</dd>
          <dt>掌握移動</dt><dd>用方向鍵或 WASD 移動及攀梯，空白鍵跳躍。走出平台邊緣會落到下方，仍可繼續攀登。</dd>
          <dt>使用卡片</dt><dd>金色問號箱提供一般卡片。排名後段且落後領先者達門檻時，可取得綠色落後補給。卡欄有空位就可連續拾取新卡箱，即時陷阱會在碰到時生效。按數字 1、2、3 或點卡片使用。</dd>
          <dt>收集鈔票</dt><dd>碰到綠色鈔票就會累計，收盤時自動換成額外層數。</dd>
          <dt>留意市場</dt><dd>多頭時移動較快、巡邏散戶走得較慢。空頭時角色移速降低，巡邏散戶走得較快。流動性危機會扣除鈔票，金額不足時會短暫停頓。首位登頂後進入收盤倒數，所有人仍可攀爬、用卡與收集鈔票。收盤分數等於實際層數加上鈔票加成。</dd>
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
          <label>賽道 <select id="course-setting"><option value="mountain">財富山 · 40 層</option><option value="training">練習場 · 10 層</option></select></label>
          <label>電腦難度 <select id="difficulty"><option value="easy">簡單</option><option value="normal">普通</option><option value="hard">困難</option></select></label>
          <label>漲跌配色 <select id="color"><option value="taiwan">台股 · 紅漲綠跌</option><option value="international">國際 · 綠漲紅跌</option></select></label>
          <label>事件與用卡震動 <input id="shake" type="checkbox"></label>
          <label>卡片與碰撞音效 <input id="card-sound" type="checkbox"></label>
        </div>
      </div>`);
    const course = element<HTMLSelectElement>(this.content, '#course-setting');
    const difficulty = element<HTMLSelectElement>(this.content, '#difficulty');
    const color = element<HTMLSelectElement>(this.content, '#color');
    const shake = element<HTMLInputElement>(this.content, '#shake');
    course.value = this.map;
    difficulty.value = this.difficulty;
    color.value = this.colorStyle;
    const sound = element<HTMLInputElement>(this.content, '#card-sound');
    sound.checked = this.audio.enabled;
    sound.addEventListener('change', () => {
      this.audio.enabled = sound.checked;
      if (sound.checked) this.audio.unlock();
    });
    shake.checked = this.shake;
    course.addEventListener('change', () => { this.map = course.value === 'training' ? 'training' : 'mountain'; });
    difficulty.addEventListener('change', () => { this.difficulty = difficulty.value as Difficulty; });
    color.addEventListener('change', () => { this.colorStyle = color.value; this.updateColors(); });
    shake.addEventListener('change', () => { this.shake = shake.checked; });
    this.bind('#back', () => this.home());
    element(this.content, '#back').focus();
  }

  private async start(replay?: RaceOptions, freshSeed = false) {
    this.audio.unlock();
    const requested = freshSeed ? null : this.requestedSeed;
    const seed = requested ?? crypto.getRandomValues(new Uint32Array(1))[0];
    const template = this.config.maps[this.map];
    const options = replay ?? {
      playerId: this.playerId,
      seed,
      difficulty: this.difficulty,
      map: this.map === 'mountain' ? generateMap(template, this.config, seed) : template
    };
    this.switchTo('race', '交易進行中', raceMarkup);
    const race = new Race(this.config, options);
    this.race = race;
    this.hud = new Hud(this.content, race, slot => race.usePlayerCard(slot));
    this.hud.render();
    this.bind('#pause', () => this.togglePause());
    this.bind('#resume', () => this.togglePause());
    this.bind('#leave', () => this.home());
    const course = element(this.content, '#course');
    const frame = element(this.content, '#course-frame');
    frame.tabIndex = -1;
    frame.setAttribute('aria-label', '山路遊戲畫面');
    course.style.aspectRatio = `${this.config.theme.width} / ${this.config.theme.height}`;
    frame.focus();
    this.touchControls();
    try {
      const { mountCourse } = await import('./scenes/course');
      if (this.race !== race || this.screen !== 'race') return;
      this.destroyCourse = mountCourse(course, {
        race,
        input: () => this.controls.read(),
        onUpdate: () => {
          if (this.race !== race || this.screen !== 'race') return;
          if (race.result) this.finish(race);
          else this.hud?.render();
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

  private touchControls() {
    for (const button of this.content.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
      const code = button.dataset.key!;
      button.addEventListener('pointerdown', event => {
        if (this.race?.paused) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.controls.hold(code);
      });
      button.addEventListener('lostpointercapture', () => this.controls.release(code));
      button.addEventListener('pointerup', () => this.controls.release(code));
      button.addEventListener('pointercancel', () => this.controls.release(code));
      button.addEventListener('click', event => {
        if (event.detail || this.race?.paused) return;
        this.controls.hold(code);
        this.controls.release(code);
      });
    }
  }

  private togglePause() {
    const race = this.race;
    if (this.screen !== 'race' || !race || race.result) return;
    this.controls.clear();
    race.togglePause();
    setText(this.indicator, race.paused ? '交易暫停' : '交易進行中');
    this.hud?.render();
    element(this.content, race.paused ? '#resume' : '#course-frame').focus();
  }

  private finish(race: Race) {
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
