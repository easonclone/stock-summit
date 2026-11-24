import type { TradingRun } from '../core/trading-run';
import type { RouteNode } from '../core/node-map';
import { escapeHtml } from './format';

export function routeMapMarkup(run: TradingRun, selectedLane: number | null) {
  const reachable = run.reachable(run.player);
  const visited = new Set(run.player.path.map(node => `${node.row}-${node.lane}`));
  const x = (lane: number) => 20 + lane * 40;
  const lines = (row: RouteNode[]) => row.flatMap(node => node.next.map(lane =>
    `<line x1="${x(node.lane)}" x2="${x(lane)}" y1="0" y2="25" class="${visited.has(`${node.row}-${node.lane}`) &&
      (visited.has(`${node.row + 1}-${lane}`) || (node.row + 2 === run.day && selectedLane === lane)) ? 'visited-link' : ''}"/>`)).join('');
  const rows = run.map.rows.map((row, index) => `<section class="map-row ${index + 1 === run.day ? 'current-row' : ''}" data-map-day="${index + 1}">
    <b>第 ${index + 1} 日</b><div class="map-lanes">
    ${row.map(node => {
      const kind = run.config.nodes.kinds[node.kind];
      const past = visited.has(`${index}-${node.lane}`);
      const open = reachable.includes(node);
      const occupants = run.investors.filter(investor => investor.path.includes(node));
      const content = `<span>${escapeHtml(kind.name)}</span><span class="map-occupants">${occupants.map(investor =>
        `<i title="${escapeHtml(investor.character.name)}" aria-label="${escapeHtml(investor.character.name)}" style="--ink:${investor.character.color}"></i>`).join('')}</span>`;
      return open ? `<button type="button" class="map-node open" style="--ink:${kind.color}" data-act="map-pick" data-value="${node.lane}"
        aria-pressed="${selectedLane === node.lane}" title="${escapeHtml(kind.detail)}">${content}</button>`
        : `<div class="map-node ${past ? 'past' : ''}" style="--ink:${kind.color}" title="${escapeHtml(kind.detail)}">${content}</div>`;
    }).join('')}</div>
    ${index < run.map.rows.length - 1 ? `<svg class="map-lines" viewBox="0 0 160 25" preserveAspectRatio="none" aria-hidden="true">${lines(row)}</svg>` : ''}
    </section>`).join('');
  return `<div class="map-intro"><span>亮框是今天可以走的路</span><span>色點是大家走過的路</span></div><div class="map-rows">${rows}</div>`;
}
