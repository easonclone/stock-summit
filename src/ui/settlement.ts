import type { TradingRun, Investor } from '../core/trading-run';
import { debtBalance, depositBalance, netWorth, returnRate } from '../core/economy';
import { arrow, direction, escapeHtml, money, percent, signedMoney, signedPercent } from './format';
import { performanceChart } from './performance-chart';

function titleFor(run: TradingRun, investor: Investor, rank: number | null) {
  if (investor.account.eliminated) return '等待再開盤';
  if (investor.recoveries) return '東山再起';
  if (rank === 1 && run.closed) return '本局股神';
  if (investor.hedgesUsed >= 2) return '避險大師';
  if (investor.synergies >= 3) return '卡牌操盤手';
  if (investor.path.filter(node => run.config.nodes.kinds[node.kind].tags.includes('margin')).length >= 3) return '槓桿狂人';
  if (investor.account.stats.depositYield >= investor.account.initialCapital * 0.03) return '存股達人';
  if (investor.account.cash >= netWorth(investor.account) * 0.7) return '現金為王';
  return '穩健交易員';
}

function detailMarkup(run: TradingRun, investor: Investor) {
  const { account, character } = investor;
  const details = [
    ['最高淨資產', money(account.peakNetWorth)], ['最大回撤', percent(account.maxDrawdown)],
    ['現金／定存餘額', `${money(account.cash)}／${money(depositBalance(account))}`],
    ['現金策略收益', signedMoney(account.stats.cashYield)], ['定存利息', signedMoney(account.stats.depositYield)],
    ['股息收益', signedMoney(account.stats.dividends)], ['投資損益', signedMoney(account.stats.investmentPnl)],
    ['融資／紓困負債', `${money(account.marginDebt)}／${money(account.bailoutDebt)}`],
    ['融資與重整費用', money(account.stats.fees)], ['卡片使用／協同', `${investor.used}／${investor.synergies} 次`],
    ['成功避險', `${investor.hedgesUsed} 次`], ['強制平倉', `${account.stats.liquidations} 次`],
    ['破產／重整', `${account.bankruptcyCount}／${investor.recoveries} 次`], ['舊債減免', money(account.stats.debtForgiven)]
  ];
  const events = run.reports.flatMap(report => {
    const outcome = report.outcomes.find(item => item.investor === investor);
    const changedRank = report.day > 1 && (investor.ranks[report.day - 1] ?? 0) > (investor.ranks[report.day] ?? Infinity);
    const notes = [
      outcome?.risk.call?.liquidated ? `強制平倉 ${money(outcome.risk.call.sold)}` : '',
      outcome?.recovery ? `破產重整、減免 ${money(outcome.recovery.marginForgiven + outcome.recovery.bailoutForgiven)}` :
        outcome?.risk.insolvent ? '破產出局' : '',
      changedRank ? `排名 ${investor.ranks[report.day - 1]} → ${investor.ranks[report.day]}` : ''
    ].filter(Boolean);
    return notes.length ? [`第 ${report.day} 日・${notes.join('、')}`] : [];
  });
  return `<details ${investor === run.player ? 'open' : ''}><summary>${escapeHtml(character.name)}・績效明細</summary>
    <dl class="report-detail">${details.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${events.length ? `<ul class="report-events">${events.map(event => `<li>${event}</li>`).join('')}</ul>` : ''}</details>`;
}

export function settlementMarkup(run: TradingRun, personal = false) {
  const standings = run.standings();
  const winners = standings.filter(item => item.rank === 1);
  const player = run.player;
  const winner = winners.map(item => item.investor.character.name).join('、');
  const title = personal ? '個人結算' : winners.length ? `${winner}${winners.length > 1 ? ' 並列第一' : ' 本局股神'}` : '本局全員破產';
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
    <p>已結算 ${run.reports.length} 日 · 市場種子 ${run.options.seed}</p></section>
    <div class="report-layout"><section class="panel leaderboard"><div class="section-head"><h2>${run.closed ? '最終排行榜' : '目前排行榜'}</h2><span>淨資產</span></div>
      <ol>${standingsMarkup.join('')}</ol></section>${performanceChart(run)}</div>
    <section class="panel report-details"><h2>投資績效明細</h2>${(personal ? [player] : standings.map(item => item.investor)).map(investor => detailMarkup(run, investor)).join('')}</section>
    <div class="settlement-actions">
      ${personal && !run.closed ? '<button type="button" data-act="spectate">返回觀戰</button>' : '<button type="button" data-act="share">分享結算</button>'}
      <button type="button" data-act="replay">同種子再玩</button><button type="button" class="gold-button" data-act="new">開啟新市場 →</button>
    </div></main>`;
}

export function shareText(run: TradingRun) {
  const url = new URL(location.href);
  url.searchParams.set('seed', String(run.options.seed));
  const standings = run.standings().map(({ investor, rank }) =>
    `${rank === null ? '出局' : `第 ${rank} 名`} ${investor.character.name} ${money(netWorth(investor.account))}（${signedPercent(returnRate(investor.account))}）`);
  return `股市攻頂戰 Stock Summit · Market Showdown\n市場種子 ${run.options.seed}・第 ${run.reports.length} 日\n${standings.join('\n')}\n${url}`;
}
