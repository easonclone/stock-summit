import type { Bulletin, Racer, Run } from '../core/run';
import { cardIcon, drawIcon } from './pixels';

export function element<T extends HTMLElement>(root: ParentNode, query: string) {
  const node = root.querySelector<T>(query);
  if (!node) throw new Error(`介面缺少必要元素 ${query}`);
  return node;
}

export function setText(node: Element, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

/** Height of one turn row in the route map, in CSS pixels. */
const ROW = 62;
const SVG = 'http://www.w3.org/2000/svg';

export const raceMarkup = `
  <div class="run-grid">
    <section class="race-top" aria-label="賽況">
      <div><span>交易日</span><strong id="run-turn"></strong></div>
      <div><span>目前名次</span><strong id="run-place"></strong></div>
      <div><span>總分</span><strong id="run-score"></strong></div>
      <div><span>市場</span><strong id="market-state"></strong></div>
    </section>
    <div class="run-main">
      <div class="run-stage">
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
      </div>
      <section class="log" aria-label="事件紀錄"><ul id="event-log"></ul></section>
      </div>
      <section class="routes" aria-label="選擇下一步">
        <header class="routes-head"><h2 id="routes-title"></h2><p id="event-forecast"></p></header>
        <div class="node-map" id="node-map" tabindex="-1"><div class="node-track" id="node-track"></div></div>
        <div class="route-detail">
          <div id="route-info"><strong></strong><span></span></div>
          <button id="confirm" class="button primary" type="button" disabled>確認進場</button>
        </div>
      </section>
    </div>
    <section class="inventory" aria-label="卡片與資金">
      <div class="bag"><h2 id="bag-title">持有卡片</h2><div id="slots" class="slots"></div></div>
      <div class="wallet"><span>鈔票 <strong id="wallet"></strong></span><span>收盤加成 <strong id="cash-bonus"></strong></span></div>
    </section>
    <section class="standings" aria-label="即時排名"><ol id="ranking" class="ranking"></ol></section>
  </div>`;

export class Hud {
  private readonly turn: HTMLElement;
  private readonly place: HTMLElement;
  private readonly score: HTMLElement;
  private readonly market: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly news: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly forecast: HTMLElement;
  private readonly mapBox: HTMLElement;
  private readonly track: HTMLElement;
  private readonly info: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly bagTitle: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly bonus: HTMLElement;
  private readonly rankings: HTMLElement;
  private readonly eventLog: HTMLElement;
  private readonly slots: HTMLButtonElement[] = [];
  private readonly nodes: HTMLButtonElement[][] = [];
  private readonly markers: HTMLElement;
  private lastNews: Run['news'] | undefined;
  private lastNotice: Bulletin | null | undefined;
  private lastTone = '';
  private mapKey = '';
  private rankKey = '';
  private slotKey = '';
  private logKey = '';

  constructor(root: HTMLElement, private readonly run: Run, private readonly actions: {
    useCard: (slot: number) => void; select: (lane: number) => void; confirm: () => void;
  }) {
    this.turn = element(root, '#run-turn');
    this.place = element(root, '#run-place');
    this.score = element(root, '#run-score');
    this.market = element(root, '#market-state');
    this.zone = element(root, '#zone');
    this.news = element(root, '#news');
    this.ticker = element(root, '.trade-ticker');
    this.title = element(root, '#routes-title');
    this.forecast = element(root, '#event-forecast');
    this.mapBox = element(root, '#node-map');
    this.track = element(root, '#node-track');
    this.info = element(root, '#route-info');
    this.confirm = element<HTMLButtonElement>(root, '#confirm');
    this.bagTitle = element(root, '#bag-title');
    this.wallet = element(root, '#wallet');
    this.bonus = element(root, '#cash-bonus');
    this.rankings = element(root, '#ranking');
    this.eventLog = element(root, '#event-log');
    this.confirm.addEventListener('click', () => actions.confirm());
    for (const [index] of run.player.inventory.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.addEventListener('click', () => actions.useCard(index));
      element(root, '#slots').append(button);
      this.slots.push(button);
    }
    this.markers = document.createElement('div');
    this.markers.className = 'node-markers';
    this.buildMap();
  }

  /** Builds the route map once: rows from the bottom (turn 1) to the top (last turn), links drawn as SVG lines. */
  private buildMap() {
    const { map } = this.run;
    const rows = map.rows.length;
    const height = (rows + 1) * ROW;
    this.track.style.height = `${height}px`;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 100 ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const x = (lane: number) => (lane + .5) / map.lanes * 100;
    const y = (row: number) => height - (row + 1.5) * ROW;
    for (const node of map.rows[0]) svg.append(this.line(x(node.lane), height - ROW / 2, x(node.lane), y(0), `start${node.lane}`));
    for (const nodes of map.rows) {
      for (const node of nodes) {
        for (const next of node.next) svg.append(this.line(x(node.lane), y(node.row), x(next), y(node.row + 1), `r${node.row}l${node.lane}to${next}`));
      }
    }
    this.track.append(svg);
    const start = document.createElement('div');
    start.className = 'node-start';
    start.textContent = '開盤起點';
    this.track.append(start);
    for (const nodes of map.rows) {
      const buttons = nodes.map(node => {
        const kind = this.run.config.nodes.kinds[node.kind];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'route-node';
        button.style.left = `${x(node.lane)}%`;
        button.style.top = `${y(node.row)}px`;
        button.style.setProperty('--node', kind.color);
        button.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
        drawIcon(element(button, 'canvas'), kind.icon, kind.color);
        setText(element(button, 'span'), kind.name);
        button.setAttribute('aria-label', `第 ${node.row + 1} 交易日 ${kind.name}：${kind.detail}`);
        button.addEventListener('click', () => this.actions.select(node.lane));
        this.track.append(button);
        return button;
      });
      this.nodes.push(buttons);
    }
    this.track.append(this.markers);
  }

  private line(x1: number, y1: number, x2: number, y2: number, key: string) {
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.dataset.key = key;
    return line;
  }

  render() {
    const run = this.run;
    const ranking = run.ranking();
    const done = Math.min(run.turn + 1, run.turns);
    setText(this.turn, `${done} / ${run.turns}`);
    setText(this.place, `${ranking.indexOf(run.player) + 1} / ${ranking.length}`);
    setText(this.score, run.score(run.player).total.toFixed(2));
    if (this.lastTone !== run.tone) {
      const market = run.config.market[run.tone];
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      drawIcon(canvas, market.icon, '#f3d389');
      this.market.replaceChildren(canvas, document.createTextNode(market.name));
      this.market.dataset.tone = run.tone;
      this.lastTone = run.tone;
    }
    setText(this.zone, run.track.zone(run.player.body.y).name);
    this.renderNews();
    this.renderMap();
    this.renderWallet();
    this.renderRanks(ranking);
    this.renderSlots();
    this.renderLog();
  }

  private renderNews() {
    const run = this.run;
    const active = run.news && run.time - run.news.at < run.config.gameplay.newsMs ? run.news : null;
    this.news.hidden = !active;
    if (active && active !== this.lastNews) {
      this.lastNews = active;
      this.news.dataset.tone = active.tone;
      drawIcon(element(this.news, 'canvas'), active.icon, '#f5d18a');
      setText(element(this.news, 'strong'), active.title);
      setText(element(this.news, 'span'), active.description);
    }
    const notice = active ? null : run.latestNotice;
    if (notice !== this.lastNotice) {
      this.lastNotice = notice;
      this.ticker.hidden = !notice;
      if (notice) {
        this.ticker.dataset.tone = notice.tone;
        drawIcon(element(this.ticker, 'canvas'), notice.icon, '#eacb8d');
        setText(element(this.ticker, 'strong'), notice.title);
        setText(element(this.ticker, 'span'), notice.description);
      }
    }
  }

  private renderMap() {
    const run = this.run;
    const reachable = run.reachable(run.player);
    const key = `${run.turn}|${run.selected}|${run.racers.map(racer => racer.node ? `${racer.node.row}.${racer.node.lane}` : '-').join(',')}`;
    if (key === this.mapKey) return;
    this.mapKey = key;
    const visited = this.visited();
    for (const [row, buttons] of this.nodes.entries()) {
      for (const [lane, button] of buttons.entries()) {
        const open = !run.result && row === run.turn && reachable.includes(lane);
        button.disabled = !open;
        button.classList.toggle('is-open', open);
        button.classList.toggle('is-selected', open && run.selected === lane);
        button.classList.toggle('is-visited', visited.has(`${row}.${lane}`));
        button.classList.toggle('is-past', row < run.turn);
      }
    }
    for (const line of this.track.querySelectorAll<SVGLineElement>('line')) {
      const match = /^r(\d+)l(\d+)to(\d+)$/.exec(line.dataset.key ?? '');
      const started = line.dataset.key === `start${run.player.path[0]?.lane}`;
      const walked = started || (!!match && visited.has(`${match[1]}.${match[2]}`) && visited.has(`${Number(match[1]) + 1}.${match[3]}`));
      const planned = match ? Number(match[1]) === run.turn - 1 && visited.has(`${match[1]}.${match[2]}`) && Number(match[3]) === run.selected
        : line.dataset.key === `start${run.selected}` && run.turn === 0;
      line.classList.toggle('is-walked', walked);
      line.classList.toggle('is-planned', planned);
    }
    this.renderMarkers();
    const selected = run.selected === null ? null : run.map.rows[run.turn]?.[run.selected];
    const kind = selected ? run.config.nodes.kinds[selected.kind] : null;
    setText(this.title, run.result ? '市場已收盤' : `第 ${run.turn + 1} 交易日 · 選擇下一步`);
    setText(element(this.info, 'strong'), kind ? kind.name : run.result ? '' : '點選亮起的節點');
    setText(element(this.info, 'span'), kind ? kind.detail : run.result ? '' : '與相連路線相鄰的節點才可前往');
    this.confirm.disabled = !kind || !!run.result;
    const forecast = run.forecast;
    setText(this.forecast, run.result ? '' : forecast ? `預告｜${forecast.title}` :
      run.eventIn === 1 ? '本回合結束後發生市場事件' : `市場事件：${run.eventIn} 回合後`);
    this.scrollToTurn();
  }

  /** Nodes the player has walked through, as "row.lane". */
  private visited() {
    const result = new Set<string>();
    for (const step of this.run.player.path) result.add(`${step.row}.${step.lane}`);
    return result;
  }

  private renderMarkers() {
    const run = this.run;
    const height = (run.map.rows.length + 1) * ROW;
    const groups = new Map<string, Racer[]>();
    for (const racer of run.racers) {
      const key = racer.node ? `${racer.node.row}.${racer.node.lane}` : 'start';
      groups.set(key, [...(groups.get(key) ?? []), racer]);
    }
    const markers: HTMLElement[] = [];
    for (const [key, racers] of groups) {
      const [row, lane] = key === 'start' ? [-1, (run.map.lanes - 1) / 2] : key.split('.').map(Number);
      racers.forEach((racer, index) => {
        const dot = document.createElement('i');
        dot.className = `node-marker${racer.isPlayer ? ' is-player' : ''}`;
        dot.style.setProperty('--racer', racer.character.color);
        dot.style.left = `calc(${(lane + .5) / run.map.lanes * 100}% + ${(index - (racers.length - 1) / 2) * 12}px)`;
        dot.style.top = `${height - (row + 1.5) * ROW + 22}px`;
        dot.title = racer.character.name;
        markers.push(dot);
      });
    }
    this.markers.replaceChildren(...markers);
  }

  private scrolled = false;

  /** Keeps the current choice row in view; jumps on the first render, glides afterwards. */
  private scrollToTurn() {
    const height = (this.run.map.rows.length + 1) * ROW;
    requestAnimationFrame(() => {
      const target = height - (this.run.turn + 1.5) * ROW - this.mapBox.clientHeight * .62;
      this.mapBox.scrollTo({ top: Math.max(0, target), behavior: this.scrolled ? 'smooth' : 'auto' });
      this.scrolled = true;
    });
  }

  private renderWallet() {
    const { run } = this;
    const { layersPerHundred, bonusCap } = run.config.cash;
    setText(this.wallet, `${run.player.cash} 元`);
    setText(this.bonus, `+${run.score(run.player).bonus.toFixed(2)} 層`);
    this.bonus.title = `每 100 元加 ${layersPerHundred} 層，上限 ${bonusCap} 層`;
  }

  private renderRanks(ranking: Racer[]) {
    const run = this.run;
    const key = ranking.map(item => `${item.character.id}${run.score(item).total}${run.isFrozen(item)}`).join('|');
    if (key === this.rankKey) return;
    this.rankKey = key;
    const rows = ranking.map((racer, index) => {
      const li = document.createElement('li');
      li.classList.toggle('is-player', racer.isPlayer);
      li.style.setProperty('--racer', racer.character.color);
      li.innerHTML = '<b class="rank-number"></b><i class="rank-dot"></i><strong></strong><span></span>';
      setText(element(li, '.rank-number'), String(index + 1));
      setText(element(li, 'strong'), racer.character.name);
      const score = run.score(racer);
      setText(element(li, 'span'), `${score.layers} 層${score.bonus ? ` +${score.bonus.toFixed(1)}` : ''}${run.isFrozen(racer) ? ' · 停牌' : ''}`);
      return li;
    });
    this.rankings.replaceChildren(...rows);
  }

  private renderSlots() {
    const cards = this.run.player.inventory;
    setText(this.bagTitle, `持有卡片 ${cards.filter(Boolean).length} / ${cards.length}`);
    const key = cards.map(card => card?.id ?? '-').join(',') + this.run.result;
    if (key === this.slotKey) return;
    this.slotKey = key;
    for (const [index, button] of this.slots.entries()) {
      const card = cards[index];
      button.disabled = !card || !!this.run.result;
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
    const bullets = this.run.log;
    const key = bullets.map(item => item.at + item.title).join('|');
    if (key === this.logKey && this.eventLog.hasChildNodes()) return;
    this.logKey = key;
    const rows = bullets.map(item => {
      const entry = document.createElement('li');
      entry.dataset.tone = item.tone;
      entry.innerHTML = '<canvas aria-hidden="true"></canvas><div><strong></strong><span></span></div>';
      drawIcon(element(entry, 'canvas'), item.icon, '#e4c585');
      setText(element(entry, 'strong'), item.title);
      setText(element(entry, 'span'), item.description);
      return entry;
    });
    if (!rows.length) {
      const empty = document.createElement('li');
      setText(empty, '選一個節點開始第一個交易日');
      rows.push(empty);
    }
    this.eventLog.replaceChildren(...rows);
  }
}
