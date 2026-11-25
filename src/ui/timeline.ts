import type { TradingRun } from '../core/trading-run';
import { escapeHtml } from './format';
import { iconMarkup } from './pixels';

function dayInfo(run: TradingRun, day: number) {
  const news = run.hasNewsOn(day);
  const shop = run.shopOpensAfter(day);
  const final = day === run.config.gameplay.turns;
  const completed = run.reports.some(report => report.day === day);
  const current = !run.closed && run.day === day;
  return { news, shop, final, completed, current };
}

const marks = (news: boolean, shop: boolean, final: boolean) =>
  `${final ? iconMarkup('crown', '#ffdb8e') : shop ? iconMarkup('shop', '#f8ca76') : news ? iconMarkup('news', '#a9d2f4') : ''}`;

/** What kind of stop a day is on the map, using only what the timeline already discloses. */
export function nodeKind(run: TradingRun, day: number) {
  const { news, shop, final } = dayInfo(run, day);
  return final ? '最終決戰' : shop ? '收盤商店' : news ? '新聞日' : '交易日';
}

/** The next stop after today, for the "下站" preview. */
export function nextNode(run: TradingRun) {
  const day = run.day + 1;
  return run.closed || day > run.config.gameplay.turns ? null : { day, kind: nodeKind(run, day) };
}

/**
 * The run as a roguelike route: 15 nodes on one path, done / today / ahead in solid colours, small pixel marks for the
 * shop, news days and the final, and the next node outlined. Height stays within 24px.
 */
export function timelineMarkup(run: TradingRun) {
  const turns = run.config.gameplay.turns;
  const next = nextNode(run);
  const segments = Array.from({ length: turns }, (_, index) => {
    const day = index + 1;
    const { news, shop, final, completed, current } = dayInfo(run, day);
    const kind = final ? 'final' : shop ? 'shop' : news ? 'news' : 'plain';
    return `<span class="track-day ${completed ? 'done' : current ? 'now' : 'ahead'} node-${kind} ${next?.day === day ? 'next' : ''}">
      <span class="track-mark">${marks(news, shop, final)}</span><i></i></span>`;
  }).join('');
  return `<button type="button" class="day-track" data-act="schedule" aria-haspopup="dialog" style="--days:${turns}"
    aria-label="路線：第 ${run.closed ? run.reports.length : run.day} / ${turns} 日${next ? `，下站第 ${next.day} 日 ${next.kind}` : ''}。點開看 ${turns} 日行程">${segments}</button>`;
}

/** The whole schedule in one list, with the same disclosure limits as the single-day view. */
export function scheduleMarkup(run: TradingRun) {
  const rows = Array.from({ length: run.config.gameplay.turns }, (_, index) => {
    const day = index + 1;
    const { news, shop, final, completed, current } = dayInfo(run, day);
    return `<li class="${completed ? 'done' : current ? 'now' : 'ahead'}" ${current ? 'aria-current="step"' : ''}>
      <b class="schedule-day">DAY ${String(day).padStart(2, '0')}<small>${nodeKind(run, day)}</small></b><span class="schedule-mark" aria-hidden="true">${marks(news, shop, final)}</span>
      ${timelineDetail(run, day)}</li>`;
  }).join('');
  return `<ol class="schedule">${rows}</ol>`;
}

/** 只讀已公開的結算與玩家取得的情報，日期表只表示何時有新聞。 */
export function timelineDetail(run: TradingRun, day: number) {
  const { news, shop, final, completed, current } = dayInfo(run, day);
  const report = run.reports.find(entry => entry.day === day);
  const published = report?.market ?? (run.latestNews?.day === day ? run.latestNews.event : null);
  const intel = run.intelFor(run.player);
  const known = intel?.day === day ? (intel.tone === 'positive' ? '利多' : intel.tone === 'negative' ? '利空' : '特殊事件') : null;
  return `<div class="timeline-detail"><p>${completed ? '已收盤' : current ? '交易中' : '尚未開盤'}${final ? ' · 最終決戰' : ''}</p>
      ${shop ? '<p>◆ 收盤後開王牌商店</p>' : ''}
      ${published ? `<p>▤ 虛構新聞 · <strong>${escapeHtml(published.title)}</strong></p><p>${escapeHtml(published.subtitle)}</p>`
        : news ? `<p>▤ 收盤時公布市場新聞${known ? ' · 小道消息：' + known : ''}</p>` : ''}
      ${final ? '<p>收盤以總身家決定冠軍。</p>' : ''}</div>`;
}
