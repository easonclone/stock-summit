import type { Racer, Race } from '../core/race';
import { cardIcon, drawIcon } from './pixels';

export function element<T extends HTMLElement>(root: ParentNode, query: string) {
  const node = root.querySelector<T>(query);
  if (!node) throw new Error(`介面缺少必要元素 ${query}`);
  return node;
}

export function setText(node: Element, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function progressLabel(race: Race, racer: Racer) {
  return `${Math.floor(race.track.progress(racer.body.y))}%`;
}

export const raceMarkup = `
  <div class="race-grid">
    <div class="game-column">
      <section class="race-top" aria-label="賽況">
        <div><span>賽事時間</span><strong id="race-time">00:00</strong></div>
        <div><span>市場狀態</span><strong id="market-state">盤整</strong></div>
        <div><span>登山進度</span><strong id="race-progress">0%</strong></div>
        <div><span>目前排名</span><strong id="race-place">— / 4</strong></div>
        <button id="pause" class="button subtle small" type="button" aria-label="暫停">Ⅱ <span>暫停</span></button>
      </section>
      <div class="market-strip"><p id="market-detail"></p><p id="race-trend"></p></div>
      <div class="cash-strip" aria-label="鈔票與預估加成">
        <span>鈔票 <strong id="wallet"></strong></span>
        <span>預估加成 <strong id="cash-bonus"></strong></span>
      </div>
      <div id="closing-clock" class="closing-clock" role="status" hidden></div>
      <div class="course-frame" id="course-frame">
        <div id="course"></div>
        <div id="zone" class="zone"></div>
        <div class="course-notices">
          <section id="news" class="news" aria-live="polite" hidden>
            <canvas aria-hidden="true"></canvas><small>市場快訊 <b>虛構模擬</b></small><strong></strong><span></span>
          </section>
          <section class="trade-ticker" aria-label="即時交易回報" aria-live="polite" hidden>
            <canvas aria-hidden="true"></canvas><div><strong></strong><span></span></div>
          </section>
        </div>
        <div id="countdown" class="overlay count" aria-live="polite"></div>
        <div id="pause-layer" class="overlay" hidden>
          <div class="pause-box">
            <span class="eyebrow">交易暫停</span>
            <h2>賽事已暫停</h2>
            <button id="resume" class="button primary" type="button">繼續攀登</button>
            <button id="leave" class="button subtle" type="button">返回首頁</button>
          </div>
        </div>
      </div>
      <section class="inventory" aria-label="卡片與事件倒數">
        <div class="bag"><h2>持有卡片</h2><div id="slots" class="slots"></div></div>
        <div class="event-timer">
          <div><span>下次市場事件</span><strong id="event-seconds"></strong></div>
          <div class="bar"><i id="event-meter"></i></div>
          <p id="forecast">虛構模擬 · 每 15 秒開獎</p>
        </div>
      </section>
    </div>
    <aside class="race-side" aria-label="排名與山路">
      <section><h2><b class="square"></b> 即時排名</h2><ol id="ranking" class="ranking"></ol></section>
      <section class="minimap"><h2><b class="square"></b> 山峰全覽</h2><canvas id="map" width="184" height="139" aria-label="玩家與對手的高度"></canvas></section>
      <section class="log"><h2><b class="square"></b> 事件紀錄</h2><ul id="event-log"></ul></section>
    </aside>
  </div>
  <div class="game-controls" aria-label="遊戲觸控按鍵">
    <div><button data-key="ArrowLeft" aria-label="向左" type="button">←</button><button data-key="ArrowRight" aria-label="向右" type="button">→</button></div>
    <div><button data-key="ArrowUp" aria-label="攀上" type="button">↑</button><button data-key="ArrowDown" aria-label="下梯" type="button">↓</button><button data-key="Space" type="button">跳躍</button></div>
  </div>`;

export class Hud {
  private readonly time: HTMLElement;
  private readonly market: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly place: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly news: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly bonus: HTMLElement;
  private readonly closingClock: HTMLElement;
  private readonly bagTitle: HTMLElement;
  private readonly marketDetail: HTMLElement;
  private readonly trend: HTMLElement;
  private lastNotice: Race['notice'] | undefined;
  private lastNews: Race['news'] | undefined;
  private lastTone = '';
  private readonly newsTitle: HTMLElement;
  private readonly newsDescription: HTMLElement;
  private readonly count: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly seconds: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly forecast: HTMLElement;
  private readonly rankings: HTMLElement;
  private readonly eventLog: HTMLElement;
  private readonly map: CanvasRenderingContext2D;
  private readonly slots: HTMLButtonElement[] = [];
  private rankKey = '';
  private logKey = '';
  private slotKey = '';
  private wasCountdown = true;
  private openUntil = 0;

  constructor(root: HTMLElement, private readonly race: Race, useCard: (slot: number) => void) {
    this.time = element(root, '#race-time');
    this.market = element(root, '#market-state');
    this.progress = element(root, '#race-progress');
    this.place = element(root, '#race-place');
    this.zone = element(root, '#zone');
    this.news = element(root, '#news');
    this.ticker = element(root, '.trade-ticker');
    this.wallet = element(root, '#wallet');
    this.bonus = element(root, '#cash-bonus');
    this.closingClock = element(root, '#closing-clock');
    this.bagTitle = element(root, '.bag h2');
    this.marketDetail = element(root, '#market-detail');
    this.trend = element(root, '#race-trend');
    this.newsTitle = element(this.news, 'strong');
    this.newsDescription = element(this.news, 'span');
    this.count = element(root, '#countdown');
    this.pause = element(root, '#pause-layer');
    this.seconds = element(root, '#event-seconds');
    this.meter = element(root, '#event-meter');
    this.forecast = element(root, '#forecast');
    this.rankings = element(root, '#ranking');
    this.eventLog = element(root, '#event-log');
    this.map = element<HTMLCanvasElement>(root, '#map').getContext('2d')!;
    const slots = element(root, '#slots');
    for (const [index] of race.player.inventory.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.addEventListener('click', () => useCard(index));
      slots.append(button);
      this.slots.push(button);
    }
  }

  render() {
    const race = this.race;
    const ranking = race.ranking();
    setText(this.time, clock(race.time));
    if (this.lastTone !== race.tone) {
      const market = race.config.market[race.tone];
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      drawIcon(canvas, market.icon, '#f3d389');
      this.market.replaceChildren(canvas, document.createTextNode(market.name));
      this.market.dataset.tone = race.tone;
      const travel = Math.round((market.travelSpeed - 1) * 100);
      setText(this.marketDetail, `移動 ${travel >= 0 ? '+' : '−'}${Math.abs(travel)}% · 散戶速度 ${Math.round(market.patrolSpeed * 100)}%`);
      this.lastTone = race.tone;
    }
    setText(this.trend, race.trend);
    const notice = race.notice;
    if (notice !== this.lastNotice) {
      this.lastNotice = notice;
      this.ticker.hidden = !notice;
      this.ticker.getAnimations().forEach(animation => animation.cancel());
      if (notice) {
        this.ticker.dataset.tone = notice.tone;
        this.ticker.dataset.kind = notice.kind;
        drawIcon(element(this.ticker, 'canvas'), notice.icon, '#eacb8d');
        setText(element(this.ticker, 'strong'), notice.title);
        setText(element(this.ticker, 'span'), notice.description);
        if (notice.kind === 'card' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          this.ticker.animate([{ boxShadow: 'inset 0 0 0 2px var(--tone)', filter: 'brightness(1.42)' },
            { boxShadow: 'inset 0 0 0 0 transparent', filter: 'brightness(1)' }], { duration: 330 });
        }
      }
    }
    setText(this.progress, progressLabel(race, race.player));
    setText(this.place, `${ranking.indexOf(race.player) + 1} / ${ranking.length}`);
    setText(this.zone, race.track.zone(race.player.body.y).name);

    const activeNews = race.news && race.time - race.news.at < race.config.gameplay.newsMs ? race.news : null;
    this.news.hidden = !activeNews;
    if (activeNews && activeNews !== this.lastNews) {
      this.lastNews = activeNews;
      this.news.dataset.tone = activeNews.tone;
      drawIcon(element(this.news, 'canvas'), activeNews.icon, '#f5d18a');
      setText(this.newsTitle, activeNews.title);
      setText(this.newsDescription, activeNews.description);
    }
    if (!race.countdown && this.wasCountdown) this.openUntil = race.time + 620;
    this.wasCountdown = race.countdown > 0;
    this.count.hidden = !race.countdown && race.time >= this.openUntil;
    this.count.classList.toggle('opening', !race.countdown);
    setText(this.count, race.countdown ? String(Math.ceil(race.countdown / 1000)) : '開盤！');
    this.pause.hidden = !race.paused;
    const cards = race.player.inventory;
    const capacity = `${cards.filter(Boolean).length} / ${cards.length}`;
    const blocked = race.pickupHint;
    setText(this.bagTitle, `持有卡片 ${capacity}${blocked ? ` · ${blocked}` : ''}`);
    const left = Math.max(0, race.nextEventAt - race.time);
    setText(this.seconds, `${String(Math.ceil(left / 1000)).padStart(2, '0')} 秒`);
    this.meter.style.width = `${left / race.config.gameplay.eventIntervalMs * 100}%`;
    setText(this.forecast, race.forecast ? `預告｜${race.forecast.title}` :
      `虛構模擬 · 每 ${race.config.gameplay.eventIntervalMs / 1000} 秒觸發`);

    this.renderCash();
    this.renderRanks(ranking);
    this.renderSlots();
    this.renderLog();
    this.minimap();
  }

  private renderCash() {
    const { race } = this;
    const { player, cashPickups } = race;
    setText(this.wallet, `${player.cash} 元`);
    setText(this.bonus, `+${race.score(player).bonus.toFixed(2)} 層`);
    this.bonus.title = `每 100 元加 ${cashPickups.config.layersPerHundred} 層，上限 ${cashPickups.bonusCap} 層`;
    this.closingClock.hidden = race.closesAt === null;
    if (race.closesAt !== null) {
      const left = Math.max(0, Math.ceil((race.closesAt - race.time) / 1000));
      setText(this.closingClock, `${race.firstToSummit!.character.name}率先登頂 · 距離收盤 ${left} 秒`);
    }
  }

  private renderRanks(ranking: Racer[]) {
    const race = this.race;
    const key = ranking.map(item => item.character.id + progressLabel(race, item)).join('|');
    if (key === this.rankKey) return;
    this.rankKey = key;
    const rows = ranking.map((racer, index) => {
      const li = document.createElement('li');
      const shownProgress = progressLabel(race, racer);
      li.classList.toggle('is-player', racer.isPlayer);
      li.style.setProperty('--racer', racer.character.color);
      li.innerHTML = '<b class="rank-number"></b><i class="rank-dot"></i><div><strong></strong><div class="bar"><i></i></div></div><span></span>';
      setText(element(li, '.rank-number'), String(index + 1).padStart(2, '0'));
      setText(element(li, 'strong'), racer.character.name);
      setText(element(li, 'span'), shownProgress);
      element(li, '.bar i').style.width = shownProgress;
      return li;
    });
    this.rankings.replaceChildren(...rows);
  }

  private renderSlots() {
    const key = this.race.player.inventory.map(card => card?.id ?? '-').join(',');
    if (key === this.slotKey) return;
    this.slotKey = key;
    for (const [index, button] of this.slots.entries()) {
      const card = this.race.player.inventory[index];
      button.disabled = !card;
      button.style.setProperty('--card', card?.color ?? '#506177');
      button.title = card?.description ?? '空卡位';
      button.innerHTML = '<kbd></kbd><canvas aria-hidden="true"></canvas><span></span>';
      setText(element(button, 'kbd'), String(index + 1));
      setText(element(button, 'span'), card?.name ?? '空卡位');
      const canvas = element<HTMLCanvasElement>(button, 'canvas');
      canvas.hidden = !card;
      if (card) cardIcon(canvas, card);
    }
  }

  private renderLog() {
    const bullets = this.race.log;
    const key = bullets.map(item => item.at + item.title).join('|');
    if (key === this.logKey && this.eventLog.hasChildNodes()) return;
    this.logKey = key;
    const rows = bullets.map(item => {
      const entry = document.createElement('li');
      entry.dataset.tone = item.tone;
      entry.innerHTML = '<time></time><canvas aria-hidden="true"></canvas><span></span>';
      drawIcon(element(entry, 'canvas'), item.icon, '#e4c585');
      setText(element(entry, 'time'), clock(item.at));
      setText(element(entry, 'span'), item.title);
      entry.title = item.description;
      return entry;
    });
    if (!rows.length) {
      const empty = document.createElement('li');
      setText(empty, '等待開盤');
      rows.push(empty);
    }
    this.eventLog.replaceChildren(...rows);
  }

  private minimap() {
    const ctx = this.map;
    const { width, height } = ctx.canvas;
    const { race } = this;
    const y = (world: number) => Math.round(height - 12 - race.track.progress(world) / 100 * (height - 24));
    ctx.fillStyle = '#121d2b';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#263a4a';
    for (let row = 11; row < height; row += 12) ctx.fillRect(0, row, width, 1);
    const scaleX = (x: number) => 10 + x / race.track.map.width * (width - 20);
    for (const platform of race.track.map.platforms) {
      ctx.fillStyle = platform.id === race.track.finish.id ? '#e9c46e' : '#3c605d';
      ctx.fillRect(scaleX(platform.x), y(platform.y), Math.round(platform.width / race.track.map.width * (width - 20)), 2);
    }
    const center = y(race.player.body.y);
    ctx.strokeStyle = '#b9935d';
    ctx.setLineDash([4, 5]);
    ctx.strokeRect(1, Math.min(Math.max(center - 13, 2), height - 28), width - 2, 26);
    ctx.setLineDash([]);
    for (const racer of race.racers) {
      ctx.fillStyle = racer.character.color;
      ctx.fillRect(Math.round(scaleX(racer.body.x)) - 3, y(racer.body.y) - 3, 6, 6);
    }
  }
}
