import type { Race, Racer } from '../core/race';
import { clock, element, setText } from './hud';
import { drawIcon, portrait } from './pixels';

export const reportMarkup = `
  <div class="pane result closing-board">
    <div class="close-heading">
      <div><p class="eyebrow"><i class="square"></i> 收盤行情</p><h1></h1><p class="result-summary"></p></div>
      <canvas id="winner-portrait" aria-hidden="true"></canvas>
    </div>
    <section class="closing-overview" aria-label="我的交易績效">
      <div><span>我的排名</span><strong id="my-position"></strong></div>
      <div><span>我的最終分數</span><strong id="my-close"></strong></div>
      <div><span id="change-label"></span><strong id="my-change"></strong></div>
      <canvas id="equity-line" width="144" height="38" aria-label="玩家登山進度走勢"></canvas>
    </section>
    <div class="result-table" tabindex="0" aria-label="完整收盤排名"><table>
      <thead><tr><th scope="col">名次</th><th scope="col">交易員</th><th scope="col">實際層數</th><th scope="col">收集金額</th><th scope="col">鈔票加成</th><th scope="col">最終分數</th><th scope="col">末段漲跌</th><th scope="col">盤中高點</th><th scope="col">最大回撤</th><th scope="col">事件／用卡</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <section class="closing-badges" aria-label="賽局成就"><h2>本日成就</h2><ul></ul></section>
    <div class="closing-foot"><p class="result-seed"></p>
      <div class="pane-actions"><button id="back" class="button subtle" type="button">返回首頁</button><button id="new-course" class="button subtle" type="button">新賽道</button><button id="replay" class="button primary" type="button">再玩一局</button></div>
    </div>
  </div>`;

function formattedChange(points: number) {
  const rounded = Math.round(points * 10) / 10;
  return { text: `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(1)}`,
    tone: rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'neutral' };
}

function closeChart(canvas: HTMLCanvasElement, racer: Racer, end: number) {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const step = (width - 8) / Math.max(1, racer.closes.length - 1);
  ctx.fillStyle = '#111d2c';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#354655';
  for (let y = 8; y < height; y += 10) ctx.fillRect(0, y, width, 1);
  ctx.strokeStyle = '#e9ca79';
  ctx.lineWidth = 2;
  ctx.beginPath();
  racer.closes.forEach((progress, index) => ctx.lineTo(4 + index * step, height - 4 - progress / 100 * (height - 8)));
  ctx.stroke();
  ctx.fillStyle = '#ffe6a1';
  ctx.fillRect(width - 6, height - 6 - end / 100 * (height - 8), 4, 4);
}

export function renderReport(root: HTMLElement, race: Race) {
  const winner = race.winner!;
  const ranks = race.ranking();
  const player = race.player;
  const latest = formattedChange(race.closingChange(player));
  setText(element(root, 'h1'), race.result === 'summit'
    ? `${winner.character.name}成為人中之人！` : `${winner.character.name}領先收盤！`);
  const first = race.firstToSummit;
  setText(element(root, '.result-summary'),
    `${first ? `${first.character.name}率先登頂` : '時間到期'} · ${clock(race.time)} · ${race.marketCount} 次市場事件`);
  setText(element(root, '#my-position'), `#${ranks.indexOf(player) + 1} / ${ranks.length}`);
  setText(element(root, '#my-close'), race.score(player).total.toFixed(2));
  setText(element(root, '#change-label'), `近 ${race.config.gameplay.eventIntervalMs / 1000} 秒漲跌`);
  const change = element(root, '#my-change');
  change.dataset.tone = latest.tone;
  setText(change, `${latest.text} 個百分點`);
  setText(element(root, '.result-seed'), `賽局種子 ${race.options.seed}`);
  portrait(element(root, '#winner-portrait'), winner.character);
  closeChart(element(root, '#equity-line'), player, race.track.progress(player.body.y));

  const rows = element(root, 'tbody');
  for (const [index, racer] of ranks.entries()) {
    const score = race.score(racer);
    const row = document.createElement('tr');
    const delta = formattedChange(race.closingChange(racer));
    row.classList.toggle('is-player', racer.isPlayer);
    const cells = [String(index + 1).padStart(2, '0'), racer.character.name + (racer.isPlayer ? '（玩家）' : ''),
      score.layers.toFixed(2), `${racer.cash} 元`, `+${score.bonus.toFixed(2)}`, score.total.toFixed(2), `${delta.text} 個百分點`, `${racer.highest.toFixed(1)}%`,
      `${racer.drawdown.toFixed(1)} 個百分點`, `${racer.marketHits}／${racer.used}`];
    for (const [column, value] of cells.entries()) {
      const cell = document.createElement('td');
      if (column === 5) cell.className = 'closing-score';
      if (column === 6) cell.dataset.tone = delta.tone;
      setText(cell, value);
      row.append(cell);
    }
    rows.append(row);
  }

  const strongestRebound = [...ranks].sort((a, b) => b.rebound - a.rebound)[0];
  const mostCards = [...ranks].sort((a, b) => b.used - a.used)[0];
  const mostShielded = [...ranks].sort((a, b) => b.shielded - a.shielded)[0];
  const badges = element(root, '.closing-badges ul');
  const badge = (title: string, detail: string, icon: Parameters<typeof drawIcon>[1]) => {
    const li = document.createElement('li');
    li.innerHTML = '<canvas aria-hidden="true"></canvas><div><strong></strong><span></span></div>';
    drawIcon(element(li, 'canvas'), icon, '#efd58d');
    setText(element(li, 'strong'), title);
    setText(element(li, 'span'), detail);
    badges.append(li);
  };
  badge('收盤龍頭', winner.character.name, 'bull');
  const winnerScore = race.score(winner);
  if (ranks.some(other => race.score(other).layers > winnerScore.layers)) {
    badge('鈔票反超', `${winner.character.name} · 鈔票加成 +${winnerScore.bonus.toFixed(2)} 層`, 'bills');
  }
  if (strongestRebound.rebound >= 1) {
    badge('絕地反彈', `${strongestRebound.character.name} · 回升 ${strongestRebound.rebound.toFixed(1)} 個百分點`, 'up');
  }
  if (mostCards.used) badge('卡片操盤手', `${mostCards.character.name} · ${mostCards.used} 次用卡`, 'bills');
  if (mostShielded.shielded) badge('避險高手', `${mostShielded.character.name} · 擋下 ${mostShielded.shielded} 次利空`, 'shield');
}
