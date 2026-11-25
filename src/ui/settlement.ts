import type { TradingRun, Investor } from '../core/trading-run';
import { netWorth, returnRate } from '../core/economy';
import { arrow, direction, escapeHtml, money, signedMoney, signedPercent } from './format';
import { performanceChart } from './performance-chart';

function titleFor(run: TradingRun, investor: Investor, rank: number | null) {
  if (investor.account.eliminated) return '下次再戰';
  if (investor.recoveries) return '東山再起';
  if (rank === 1 && run.closed) return '本局股神';
  if (investor.stats.shields >= 2) return '避險大師';
  if (investor.stats.combos >= 12) return '連招大師';
  const days = run.reports.flatMap(report => report.outcomes.filter(item => item.investor === investor).map(item => item.allocation));
  if (days.filter(id => id === 'all').length >= days.length * 0.7 && days.length) return '全押狂人';
  if (days.filter(id => id === 'cash').length >= days.length * 0.5 && days.length) return '現金為王';
  return '慢慢存、穩穩賺';
}

function detailMarkup(run: TradingRun, investor: Investor) {
  const { account, character } = investor;
  const gains = run.reports.flatMap(report => report.outcomes.filter(item => item.investor === investor).map(item => item.close - item.start));
  const details = [
    ['最高總身家', money(account.peakNetWorth)], ['最大單日獲利', signedMoney(Math.max(0, ...gains))],
    ['現金／股票', `${money(account.cash)}／${money(account.investmentValue)}`],
    ['股票賺賠', signedMoney(account.stats.investmentPnl)], ['現金收入', signedMoney(account.stats.cashYield)],
    ['用道具／王牌發動', `${investor.stats.itemsUsed}／${investor.stats.combos} 次`], ['護盾擋下', `${investor.stats.shields} 次`],
    ['王牌', investor.jokers.map(joker => escapeHtml(joker.name)).join('、') || '沒有'],
    ['商店', investor.purchases.length ? `買 ${investor.purchases.length} 張，淨花 ${money(investor.stats.spent)}` : '沒有買'],
    ...(account.bankruptcyCount ? [['歸零／翻身', `${account.bankruptcyCount}／${investor.recoveries} 次`]] : [])
  ];
  const events = run.reports.flatMap(report => {
    const outcome = report.outcomes.find(item => item.investor === investor);
    const changedRank = report.day > 1 && (investor.ranks[report.day - 1] ?? 0) > (investor.ranks[report.day] ?? Infinity);
    const notes = [
      outcome?.recovery ? `歸零翻身，拿到 ${money(outcome.recovery.recoveryCash)}` :
        outcome?.risk.insolvent ? '歸零出局' : '',
      changedRank ? `排名 ${investor.ranks[report.day - 1]} → ${investor.ranks[report.day]}` : ''
    ].filter(Boolean);
    return notes.length ? [`第 ${report.day} 日・${notes.join('、')}`] : [];
  });
  return `<details ${investor === run.player ? 'open' : ''}><summary>${escapeHtml(character.name)}・績效明細</summary>
    <dl class="report-detail">${details.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${events.length ? `<ul class="report-events">${events.map(event => `<li>${event}</li>`).join('')}</ul>` : ''}</details>`;
}

/** The player's highlights, read from the run's actual settlement records. */
function highlightsMarkup(run: TradingRun, investor: Investor) {
  const { stats } = investor;
  const mvp = Object.entries(stats.jokerGain).sort((a, b) => b[1] - a[1])[0];
  const joker = mvp && mvp[1] > 0 ? run.config.jokers.find(card => card.id === mvp[0]) : undefined;
  const items = [
    ['本局最大單日獲利', stats.bestDay && stats.bestDay.amount > 0 ? `第 ${stats.bestDay.day} 日 ${signedMoney(stats.bestDay.amount)}` : '還沒有'],
    ['最有貢獻的王牌', joker ? `${escapeHtml(joker.name)} ${signedMoney(mvp[1])}` : '還沒有'],
    ['最精彩的連招', stats.bestCombo ? `第 ${stats.bestCombo.day} 日 ${stats.bestCombo.steps} 連發 ${signedMoney(stats.bestCombo.amount)}` : '還沒有']
  ];
  return `<ul class="highlights" aria-label="本局亮點">${items.map(([label, value]) => `<li><span>${label}</span><strong>${value}</strong></li>`).join('')}</ul>`;
}

export function settlementMarkup(run: TradingRun, personal = false) {
  const standings = run.standings();
  const winners = standings.filter(item => item.rank === 1);
  const player = run.player;
  const winner = winners.map(item => item.investor.character.name).join('、');
  const title = personal ? '個人結算' : winners.length ? `${winner}${winners.length > 1 ? ' 並列第一' : ' 本局股神'}` : '全場畢業';
  const standingsMarkup = standings.map(({ investor, rank }) => {
    const { account, character } = investor;
    return `<li class="report-row ${rank === 1 && run.closed ? 'winner' : ''}" style="--ink:${character.color}">
      <b class="report-rank">${rank === null ? '出局' : `#${rank}`}</b>
      <canvas class="portrait" width="32" height="32" data-portrait="${character.id}" data-reaction="${rank === 1 && run.closed ? '收盤勝利' : ''}" aria-hidden="true"></canvas>
      <span><strong>${escapeHtml(character.name)}</strong><small>${titleFor(run, investor, rank)}</small></span>
      <span><strong>${money(netWorth(account))}</strong><small class="${direction(returnRate(account))}">${arrow(returnRate(account))} ${signedPercent(returnRate(account))}</small></span>
    </li>`;
  });
  return `<main class="settlement" id="settlement"><section class="report-hero panel">
    <p class="opening-label"><i aria-hidden="true"></i> ${run.closed ? '市場已收盤' : '本席已出局'}</p><h1>${escapeHtml(title)}</h1>
    <p>已結算 ${run.reports.length} 日 · 市場種子 ${run.options.seed}</p>${highlightsMarkup(run, player)}</section>
    <div class="report-layout"><section class="panel leaderboard"><div class="section-head"><h2>${run.closed ? '本局戰績' : '目前排行榜'}</h2><span>總身家</span></div>
      <ol>${standingsMarkup.join('')}</ol></section>${performanceChart(run)}</div>
    <section class="panel report-details"><h2>本局戰績明細</h2>${(personal ? [player] : standings.map(item => item.investor)).map(investor => detailMarkup(run, investor)).join('')}</section>
    <div class="settlement-actions">
      ${personal && !run.closed ? '<button type="button" data-act="spectate">返回觀戰</button>' : '<button type="button" data-act="share">分享戰績</button>'}
      <button type="button" data-act="replay">同種子再玩</button><button type="button" class="gold-button" data-act="new">再開一局 →</button>
    </div></main>`;
}

export function shareText(run: TradingRun) {
  const url = new URL(location.href);
  url.searchParams.set('seed', String(run.options.seed));
  const standings = run.standings().map(({ investor, rank }) =>
    `${rank === null ? '出局' : `第 ${rank} 名`} ${investor.character.name} ${money(netWorth(investor.account))}（${signedPercent(returnRate(investor.account))}）`);
  return `股市攻頂戰 Stock Summit · Market Showdown\n市場種子 ${run.options.seed}・第 ${run.reports.length} 日\n${standings.join('\n')}\n${url}`;
}
