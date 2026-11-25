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

export function timelineMarkup(run: TradingRun) {
  const cells = Array.from({ length: run.config.gameplay.turns }, (_, index) => {
    const day = index + 1;
    const { news, shop, final, completed, current } = dayInfo(run, day);
    const labels = ['第 ' + day + ' 日', current ? '今天' : completed ? '已完成' : '未開始',
      news ? '市場新聞' : '', shop ? '王牌商店' : '', final ? '最終決戰' : ''];
    return `<button class="timeline-day${completed ? ' completed' : ''}" type="button" data-act="timeline" data-value="${day}"
      ${news ? 'data-news' : ''} ${shop ? 'data-shop' : ''} ${final ? 'data-final' : ''} ${current ? 'aria-current="step"' : ''}
      aria-label="${labels.filter(Boolean).join('，')}"><strong>${String(day).padStart(2, '0')}</strong>
      <span aria-hidden="true">${news ? iconMarkup('news', '#a9d2f4') : ''}${shop ? iconMarkup('shop', '#f8ca76') : ''}${final ? iconMarkup('crown', '#ffdb8e') : ''}</span></button>`;
  });
  return `<nav class="timeline" aria-label="交易日進度" style="--days:${run.config.gameplay.turns}">${cells.join('')}</nav>`;
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
