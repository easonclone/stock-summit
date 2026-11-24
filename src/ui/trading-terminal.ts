import type { FinancialConfig, TradingCard } from '../config/financial-settings';
import { canBorrow, debtBalance, depositBalance, leverageExposure, netWorth, returnRate, warningReasons } from '../core/economy';
import type { TradingRun, DayOutcome } from '../core/trading-run';
import type { RouteNode } from '../core/node-map';
import { marketTone } from '../core/trading-effects';
import { arrow, direction, escapeHtml, money, percent, signedMoney, signedPercent } from './format';
import { performanceChart } from './performance-chart';

export const financialLabels = { normal: '交易正常', warning: '當心風險', margin_call: '融資追繳', bankruptcy: '交易出局' };

export function iconMarkup(icon: string, color: string) {
  return `<canvas class="pixel-icon" data-icon="${icon}" data-color="${color}" width="10" height="9" aria-hidden="true"></canvas>`;
}

export function openingMarkup(config: FinancialConfig, seed: number, chosen: string, difficulty: string) {
  return `<section class="opening">
    <div class="opening-hero">
      <p class="opening-label"><i aria-hidden="true"></i> 還沒開盤</p>
      <div class="opening-title"><h1>股市攻頂戰</h1><p>Market Showdown</p></div>
      <p class="opening-description">四人同場炒股。選牌、挑路線，收盤看誰的總身家最高。</p>
      <div class="opening-metrics"><div><span>起手本金</span><strong>${money(config.financial.initialCapital)}</strong></div><div><span>交易週期</span><strong>${config.gameplay.turns} 日</strong></div><div><span>同場對手</span><strong>4 人</strong></div></div>
    </div>
    <section class="open-board panel"><h2>選擇交易席位</h2><div class="seats opening-seats">
    ${config.characters.map(character => `<button type="button" class="seat" data-act="character" data-value="${character.id}" aria-pressed="${character.id === chosen}" style="--ink:${character.color}">
      <canvas class="portrait" width="32" height="32" data-portrait="${character.id}" aria-hidden="true"></canvas>
      <strong>${escapeHtml(character.name)}</strong>
    </button>`).join('')}</div>
    <div class="opening-settings"><label>電腦難度<select data-input="difficulty">
      ${[['easy', '入門'], ['normal', '標準'], ['hard', '高手']].map(([value, label]) => `<option value="${value}" ${value === difficulty ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label><label>市場種子<input data-input="seed" type="number" inputmode="numeric" required min="0" max="4294967295" value="${seed}"></label></div>
    <button type="button" class="gold-button" data-act="start">開盤啦 <span aria-hidden="true">→</span></button>
    <p class="opening-note">四位角色使用相同交易規則。市場新聞為虛構遊戲情境。</p>
    <details class="card-detail"><summary>第一次玩？</summary><p>先挑一條投資路線。手上有搭得起來的牌就一起打，或者留到下次。確定下單後，四個人一起看結果。手頭吃緊時，可以賣股、還錢或買個保險。</p></details>
    </section>
  </section>`;
}

function marketMarkup(run: TradingRun, animate: boolean) {
  const current = run.latestNews;
  const intel = run.intelFor(run.player);
  const tone = current ? marketTone(current.event, run.config) : 'neutral';
  const next = run.nextEventDay;
  return `<section class="market-strip ${tone} ${current?.event.severity ?? ''} ${animate && current?.day === run.reports.at(-1)?.day ? 'market-flash' : ''}" aria-label="市場快訊">
    <div class="market-main"><span class="market-icon" aria-hidden="true">${tone === 'negative' ? '▼' : tone === 'positive' ? '▲' : '◆'}</span>
      <div><span class="market-caption">市場快訊 · 虛構情境</span><strong>${current ? escapeHtml(current.event.title) : '交易所已開盤'}</strong></div></div>
    <div class="market-info"><span><b>${run.config.market[tone].name}</b> 盤勢</span><span>${next === null ? '市場事件已結束' : `下次事件・第 ${next} 日`}</span></div>
    ${intel ? `<p class="intel">◆ 已取得情報・第 ${run.player.intelDay} 日・${escapeHtml(intel.title)}：${escapeHtml(intel.description)}</p>` : ''}
  </section>`;
}

function reaction(outcome: DayOutcome | undefined, selected: boolean) {
  if (!outcome) return selected ? '思考中' : '等開盤';
  if (outcome.recovery) return '重整完成';
  if (outcome.risk.insolvent) return '宣告破產';
  if (outcome.risk.call?.liquidated) return '強制平倉';
  if (outcome.risk.call) return '融資追繳';
  if (outcome.ledger.protected) return '避險成功';
  if (outcome.close > outcome.start) return '這筆有賺';
  if (outcome.close < outcome.start) return '這筆賠了';
  return '持平';
}

function seatsMarkup(run: TradingRun, selected: boolean, animated: boolean) {
  const latest = run.reports.at(-1);
  const stands = run.standings();
  return `<section class="seats" aria-label="四位投資人">${run.investors.map(investor => {
    const { character, account } = investor;
    const isPlayer = investor === run.player;
    const state = account.financialStatus;
    const standing = stands.find(item => item.investor === investor)!;
    const outcome = latest?.outcomes.find(item => item.investor === investor);
    const delta = outcome ? outcome.close - outcome.start : 0;
    const change = investor.ranks.length > 2 && standing.rank && investor.ranks.at(-2) ? investor.ranks.at(-2)! - standing.rank : 0;
    const response = reaction(outcome, selected);
    return `<article class="seat ${isPlayer ? 'player-seat' : ''} ${state} ${animated && outcome ? 'seat-animate' : ''}" style="--ink:${character.color}" aria-label="${escapeHtml(character.name)} ${financialLabels[state]}">
      <div class="seat-head"><span>${isPlayer ? '你的席位' : '電腦'}</span><b>${standing.rank ? `#${standing.rank}` : '出局'}${change ? `<small class="${direction(change)}"> ${arrow(change)}</small>` : ''}</b></div>
      <div class="portrait-wrap"><canvas class="portrait" width="32" height="32" data-portrait="${character.id}" data-reaction="${response}" aria-hidden="true"></canvas></div>
      <h3>${escapeHtml(character.name)}</h3>
      <strong class="seat-value">${money(netWorth(account))}</strong>
      <span class="seat-return ${direction(returnRate(account))}">${arrow(returnRate(account))} ${signedPercent(returnRate(account))}</span>
      <span class="seat-status">${state === 'normal' ? response : financialLabels[state]}${animated && delta ? ` · ${signedMoney(delta)}` : ''}</span>
      <span class="seat-position">${account.marginDebt ? '融資中' : '無融資'}${investor.hedges.length ? ` · ◆${investor.hedges.length}` : ''}</span>
    </article>`;
  }).join('')}</section>`;
}

function financialMarkup(run: TradingRun, expanded: boolean) {
  const { account, hedges } = run.player;
  const { financial } = run.config;
  const restrictions = Math.max(0, account.leverageRestrictedUntil - run.day + 1);
  const warnings = warningReasons(account, financial);
  return `<section class="panel finance-panel" aria-label="我的財務">
    <div class="section-head"><h2>我的錢包</h2><span class="risk-label ${account.financialStatus}">${account.financialStatus === 'normal' ? '●' : '▲'} ${financialLabels[account.financialStatus]}</span></div>
    <div class="financial-kpis">
      <div><span>總身家</span><strong class="gold">${money(netWorth(account))}</strong></div>
      <div><span>手上現金</span><strong>${money(account.cash)}</strong></div>
      <div><span>防跌保護</span><strong class="ice">◆ ${hedges.length}</strong></div>
    </div>
    ${warnings.length || restrictions ? `<div class="warning-bar">▲ ${warnings.join('、') || '破產重整期間'}。暫時不能借錢加碼${restrictions ? `（剩 ${restrictions} 日）` : ''}。可以先賣股、還錢，或加點保護。</div>` : ''}
    <details data-detail="financial" ${expanded ? 'open' : ''}><summary>資產負債明細</summary><dl class="finance-detail">
      <div><dt>投資部位市值</dt><dd>${money(account.investmentValue)}</dd></div><div><dt>定存資產</dt><dd>${money(depositBalance(account))}</dd></div>
      <div><dt>融資負債</dt><dd>${money(account.marginDebt)}</dd></div><div><dt>紓困負債</dt><dd>${money(account.bailoutDebt)}</dd></div>
      <div><dt>部位／淨資產</dt><dd>${netWorth(account) > 0 ? `×${leverageExposure(account).toFixed(2)}` : '不適用'}</dd></div>
      <div><dt>收盤另應付費用</dt><dd>${money(account.closingPayable)}</dd></div>
      ${hedges.length ? `<div><dt>下次回撤抵銷</dt><dd>${percent(hedges[0])}</dd></div>` : ''}
    </dl></details>
  </section>`;
}

export function offerMarkup(run: TradingRun, offered: number | null, replace: number | null) {
  const offer = run.offer!;
  const full = run.player.hand.length >= run.config.gameplay.inventorySize;
  return `<p>${offer.source === 'draw' ? '手牌已滿。可以替換一張手牌，或棄置新卡。' : '選擇一張加入手牌。'}${full && offer.source === 'draft' ? '手牌已滿時請同時選擇要替換的卡片。' : ''}</p>
    <div class="offer-grid">${offer.cards.map((card, index) => `<button type="button" class="offer-card" style="--ink:${card.color}" data-act="offer-card" data-value="${index}" aria-pressed="${offered === index}">
      ${iconMarkup(card.icon, card.color)}<strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.description)}</span></button>`).join('')}</div>
    ${full ? `<div class="replace-list" aria-label="要替換的手牌">${run.player.hand.map((card, index) =>
      `<button type="button" data-act="replace" data-value="${index}" aria-pressed="${replace === index}">${escapeHtml(card.name)}</button>`).join('')}</div>` : ''}
    <div class="dialog-actions"><button type="button" data-act="decline">棄置新卡</button><button type="button" class="gold-button" data-act="take" ${offered === null || (full && replace === null) ? 'disabled' : ''}>加入手牌</button></div>`;
}

function handMarkup(run: TradingRun, lane: number | null, slot: number | null, expanded: boolean) {
  const selectedCard = slot === null ? null : run.player.hand[slot];
  const cards = run.player.hand.map((card, index) => {
    const synergy = lane !== null && Boolean(run.preview(lane, index)?.synergies);
    return `<button type="button" class="hand-card ${synergy ? 'synergy' : ''}" style="--ink:${card.color}" data-act="card" data-value="${index}" aria-pressed="${slot === index}">
      <span class="card-art">${iconMarkup(card.icon, card.color)}<small>${index + 1}</small></span>
      <strong>${escapeHtml(card.name)}</strong><span>${synergy ? '◆ 可以接連招' : escapeHtml(card.duration)}</span></button>`;
  }).join('');
  return `<section class="hand-section" aria-label="今日手牌"><div class="section-head"><h2>今日手牌</h2><span>今天最多打 1 張 · ${run.player.hand.length}／${run.config.gameplay.inventorySize}</span></div>
    <div class="hand-grid">${cards}</div>
    ${selectedCard ? cardDescription(run, selectedCard, expanded) : '<p class="hand-hint">點卡看效果，也可直接挑一條路。</p>'}
  </section>`;
}

function cardDescription(run: TradingRun, card: TradingCard, expanded: boolean) {
  const values = card.effectIds.flatMap(id => {
    const effect = run.config.effects[id];
    if (effect.type === 'bailout') return [`現金得低於起手本金的 ${percent(effect.cashThreshold)}。拿到 ${money(effect.amount)}，救命貸款增加 ${money(effect.amount + effect.fee)}，含手續費 ${money(effect.fee)}。`];
    if (effect.type === 'cash_yield') return [`現金比率門檻 ${percent(effect.threshold)}；收益率 ${percent(effect.rate)}。`];
    if (effect.type === 'hedge') return [`可抵銷 ${percent(effect.protection)} 的符合條件損失。`];
    if (effect.type === 'combo') return [`接連招後，${effect.mode === 'dividend' ? '股息多' : '股票報酬率加'} ${percent(effect.amount)}${effect.mode === 'dividend' ? '' : '（百分點）'}。`];
    if (effect.type === 'maintenance') return [`融資追繳門檻收緊為 ${percent(effect.ltv)}。`];
    if (effect.type === 'sell') return [`賣出股票市值的 ${percent(effect.fraction)}，有欠款就先還。`];
    if (effect.type === 'repay') return [`最多拿手上現金的 ${percent(effect.fraction)} 支付還款和手續費。手續費為還款額的 ${percent(effect.feeRate)}。`];
    return [];
  });
  return `<details class="card-detail" data-detail="card" ${expanded ? 'open' : ''}><summary>${escapeHtml(card.name)}・卡片效果</summary>
    <p>${escapeHtml(card.description)} ${values.join(' ')}</p><p>使用條件　${escapeHtml(card.condition)}　／　持續　${escapeHtml(card.duration)}</p></details>`;
}

function actionsMarkup(run: TradingRun, lane: number | null, slot: number | null) {
  const routes = run.reachable(run.player);
  const preview = lane === null ? null : run.preview(lane, slot);
  const tiles = routes.map((node: RouteNode) => {
    const estimate = run.preview(node.lane, slot)!;
    const kind = estimate.kind;
    return `<button type="button" class="action-tile" style="--ink:${kind.color}" data-act="lane" data-value="${node.lane}" data-kind="${node.kind}" aria-pressed="${node.lane === lane}">
      ${iconMarkup(kind.icon, kind.color)}<strong>${escapeHtml(kind.name)}</strong><small>${!estimate.available ? '今天借不到' :
      `${signedMoney(estimate.low)} 至 ${signedMoney(estimate.high)}`}</small></button>`;
  }).join('');
  const card = slot === null ? null : run.player.hand[slot];
  const blocked = preview && !preview.available;
  return `<section class="actions-section" aria-label="今天要怎麼投？">
    <div class="section-head"><h2>今天要怎麼投？</h2><button type="button" class="text-button" data-act="map">路線圖 <span aria-hidden="true">↗</span></button></div>
    <div class="action-grid" style="--routes:${routes.length}">${tiles}</div>
    ${preview ? `<div class="preview panel" aria-live="polite"><div class="preview-title"><strong>${escapeHtml(preview.kind.name)}・交易預覽</strong>
      <span class="${direction(preview.expected)}">${arrow(preview.expected)} ${signedMoney(preview.low)} 至 ${signedMoney(preview.high)}</span></div>
      <p>${escapeHtml(preview.kind.detail)}</p>
      <details><summary>看金額和細節</summary><dl class="preview-breakdown"><div><dt>自有投入</dt><dd>${money(preview.invested + preview.deposited)}</dd></div><div><dt>新增借款</dt><dd>${money(preview.orderDebt)}</dd></div><div><dt>預估負債變動</dt><dd>${signedMoney(preview.debtChange)}</dd></div><div><dt>估計處分／還款</dt><dd>${money(preview.sold)}／${money(preview.repaid)}</dd></div></dl>
      ${preview.orderDebt ? `<p>融資日息 ${percent(run.config.financial.marginDailyRate)}，開辦費 ${percent(run.config.financial.originationFee)}。</p>` : ''}
      ${preview.deposited ? `<p>定存日息 ${percent(run.config.financial.depositDailyRate)}，鎖住 ${run.config.financial.depositDays} 個交易日。</p>` : ''}
      </details>
      ${card && !preview.enabledCard ? '<p class="preview-warning">▲ 這張牌在這條路打不出來，換牌、換路或先留著。</p>' : ''}
      ${preview.synergies && card ? `<p class="synergy-note">◆ ${escapeHtml(card.name)} × ${escapeHtml(preview.kind.name)} · 卡片連招，估計多拿 ${signedMoney(preview.synergyGain)}</p>` : ''}
      ${preview.opponents.length ? `<p class="preview-warning">▲ 追繳門檻收緊對象　${preview.opponents.map(escapeHtml).join('、')}</p>` : ''}
      ${blocked ? `<p class="preview-warning">▲ ${canBorrow(run.player.account, run.day, run.config.financial) ? '可用擔保資金不足' : '目前限制新增槓桿'}。這筆開不了槓桿，選了也會先觀望。</p>` : ''}
      ${preview.exposureRisk ? `<p class="preview-warning">▲ 虧損情境可能觸發追繳，估計需補繳 ${money(preview.marginRequired)}。</p>` : ''}
      <small>這是依已知消息估的區間，收盤結果可能不同。</small>
    </div>` : '<p class="empty-preview">先選一條路，就能看可能賺賠多少、會不會欠錢。</p>'}
  </section>`;
}

function latestMarkup(run: TradingRun) {
  const last = run.reports.at(-1);
  const player = last?.outcomes.find(outcome => outcome.investor === run.player);
  if (!last || !player) return '';
  const delta = player.close - player.start;
  const crisis = player.risk.call || player.risk.insolvent;
  return `<section class="last-trade ${crisis ? 'crisis-trade' : ''}" aria-label="上一筆結算"><div><small>第 ${last.day} 日結算</small>
    <strong class="${direction(delta)}">${arrow(delta)} ${signedMoney(delta)}</strong></div>
    <div><b>${player.node ? escapeHtml(run.config.nodes.kinds[player.node.kind].name) : '場外'}</b>
    <p>${[
      player.openingInterest ? `定存利息 ${signedMoney(player.openingInterest)}` : '',
      player.card ? escapeHtml(player.card.name) : '',
      player.targetedRivals.length ? `影響 ${player.targetedRivals.map(escapeHtml).join('、')}` : '',
      player.incomingCards.length ? `受到${player.incomingCards.map(escapeHtml).join('、')}` : '',
      player.ledger.synergies ? `協同 ${signedMoney(player.ledger.synergyGain)}` : '',
      player.ledger.protected ? `抵銷損失 ${money(player.ledger.protected)}` : '',
      player.marketPnl ? `市場 ${signedMoney(player.marketPnl)}` : '',
      player.ledger.fees ? `費用 ${money(player.ledger.fees)}` : ''
    ].filter(Boolean).join(' · ') || '已更新收盤績效'}</p></div>
    ${crisis ? '<button type="button" class="text-button" data-act="crisis">危機明細</button>' : ''}
    </section>`;
}

export interface TerminalSelection {
  lane: number | null; slot: number | null; financeOpen: boolean; cardOpen: boolean; animate: boolean
}

export function tradingMarkup(run: TradingRun, ui: TerminalSelection) {
  const { lane, slot, financeOpen, cardOpen, animate } = ui;
  const eliminated = run.player.account.eliminated;
  const preview = lane === null ? null : run.preview(lane, slot);
  return `<main class="trading" id="market" aria-label="交易終端">
    ${marketMarkup(run, animate)}
    ${seatsMarkup(run, lane !== null, animate)}
    <div class="trade-layout">
      <div class="analysis-column">${performanceChart(run)}${financialMarkup(run, financeOpen)}${latestMarkup(run)}</div>
      <div class="decision-column">
        ${eliminated ? '<section class="panel spectator"><h2>本席已出局</h2><p>其他投資人會繼續結算。</p><button type="button" data-act="personal">查看個人結算</button><button type="button" data-act="map">查看路線圖</button></section>' :
      `${handMarkup(run, lane, slot, cardOpen)}${actionsMarkup(run, lane, slot)}`}
      </div>
    </div></main>
    <div class="trade-dock"><div class="dock-inner"><div class="dock-caption"><span>${eliminated ? '觀戰模式' : `第 ${run.day} 日 · 交易準備`}</span>
      <strong>${preview ? escapeHtml(preview.kind.name) : eliminated ? '僅執行其餘席位' : '先選一條路'}</strong></div>
      <button type="button" class="gold-button" data-act="trade" ${!eliminated && (lane === null || (slot !== null && !preview?.enabledCard)) ? 'disabled' : ''}>
      ${eliminated ? '觀看下一交易日' : run.day === run.config.gameplay.turns ? '確定下單・收盤' : '確定下單・看結果'} <span aria-hidden="true">→</span></button></div></div>`;
}
