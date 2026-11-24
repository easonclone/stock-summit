import type { TradingRun } from '../core/trading-run';
import { escapeHtml, signedPercent } from './format';

export function performanceChart(run: TradingRun) {
  const base = run.config.financial.initialCapital;
  const end = Math.max(3, run.reports.length, run.config.gameplay.turns);
  const values = run.investors.flatMap(investor => investor.closes.map(value => value / base - 1));
  const lower = Math.min(-0.08, ...values);
  const upper = Math.max(0.10, ...values);
  const low = lower - (upper - lower) * 0.12;
  const high = upper + (upper - lower) * 0.12;
  const x = (day: number) => 46 + day / end * 598;
  const y = (rate: number) => 16 + (high - rate) / (high - low) * 158;
  const yLabels = [upper, 0, lower];
  const xLabels = Array.from(new Set([0, ...Array.from({ length: Math.floor(end / 3) }, (_, i) => (i + 1) * 3), end]));
  const events = run.reports.filter(report => report.market || report.outcomes.some(item => item.risk.call?.liquidated || item.recovery || item.risk.insolvent));
  const lastDay = run.reports.at(-1)?.day ?? 0;
  const eventLines = events.map(report => `<line class="event-line" x1="${x(report.day)}" x2="${x(report.day)}" y1="16" y2="174">
      <title>${escapeHtml(`第 ${report.day} 日：${report.market?.title ?? '財務危機'}`)}</title></line>`).join('');
  const curves = run.investors.map(investor => {
    const points = investor.closes.map((amount, index) => `${x(index)},${y(amount / base - 1)}`).join(' ');
    const last = investor.closes.at(-1)!;
    const color = investor.character.color;
    const markers = events.flatMap(report => {
      const outcome = report.outcomes.find(item => item.investor === investor);
      if (!outcome || !(outcome.risk.call?.liquidated || outcome.recovery || outcome.risk.insolvent)) return [];
      const label = outcome.recovery ? '重整' : outcome.risk.insolvent ? '破產出局' : '強制平倉';
      return [`<rect x="${x(report.day) - 4}" y="${y(outcome.close / base - 1) - 4}" width="8" height="8" fill="${color}">
        <title>${escapeHtml(`${investor.character.name}・第 ${report.day} 日・${label}`)}</title></rect>`];
    }).join('');
    return `<polyline points="${points}" stroke="${color}" fill="none" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      ${markers}<circle cx="${x(investor.closes.length - 1)}" cy="${y(last / base - 1)}" r="4" fill="${color}">
        <title>${escapeHtml(`${investor.character.name} ${signedPercent(last / base - 1)}`)}</title></circle>`;
  }).join('');
  const grid = xLabels.map(day => `<path d="M${x(day)} 16V174" class="chart-grid"/>
    <text class="${day > 0 && day < end && (day === 3 || end - day <= 3) ? 'minor-tick' : ''}" text-anchor="${day === 0 ? 'start' : day === end ? 'end' : 'middle'}"
      x="${x(day)}" y="205">${day === 0 ? '開盤' : `第 ${day} 日`}</text>`).join('');
  const horizontal = yLabels.map(value => `<path d="M46 ${y(value)}H644" class="${value ? 'chart-grid' : 'chart-baseline'}"/>
    <text x="2" y="${y(value) + 5}">${signedPercent(value)}</text>`).join('');
  return `<figure class="chart">
    <figcaption><span class="section-title">投資績效走勢</span><span class="chart-period">${lastDay ? `已結算 ${lastDay} 日` : '等待首筆結算'}</span></figcaption>
    <svg viewBox="0 0 652 212" preserveAspectRatio="none" role="img" aria-label="四位投資人的逐日實際報酬率，虛線為市場或財務事件，方塊為財務危機">
      ${grid}${horizontal}${eventLines}${curves}
    </svg>
    <div class="chart-key">${run.investors.map(({ character }) => `<span><i style="--ink:${character.color}"></i>${escapeHtml(character.name)}</span>`).join('')}<span class="chart-markers">┊ 事件　▪ 財務危機</span></div>
  </figure>`;
}
