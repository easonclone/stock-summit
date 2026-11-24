import type { FinancialConfig, TradingCard } from '../config/financial-settings';
import { netWorth, returnRate } from '../core/economy';
import type { TradingRun, DayOutcome, Investor } from '../core/trading-run';
import { allocationOption, cardPreparationAvailable } from '../core/trade-preview';
import { hedgeLayers, marketTone, type CardBlock } from '../core/trading-effects';
import { dayBreakdown } from './breakdown';
import { cardFace, pairLabel } from './card-face';
import { arrow, direction, escapeHtml, money, percent, signedMoney, signedPercent } from './format';
import { performanceChart } from './performance-chart';

export const financialLabels = { normal: '交易正常', bankruptcy: '身家歸零' };

export function iconMarkup(icon: string, color: string) {
  return `<canvas class="pixel-icon" data-icon="${icon}" data-color="${color}" width="10" height="9" aria-hidden="true"></canvas>`;
}

export function openingMarkup(config: FinancialConfig, seed: number, chosen: string, difficulty: string) {
  return `<section class="opening">
    <div class="opening-hero">
      <p class="opening-label"><i aria-hidden="true"></i> 還沒開盤</p>
      <div class="opening-title"><h1>股市攻頂戰</h1><p>Pixel Stock Arena</p></div>
      <p class="opening-description">你有 ${money(config.financial.initialCapital)}。買股票可能賺錢，也可能賠錢。${config.gameplay.turns} 天後，最有錢的人獲勝！</p>
      <ol class="opening-steps" aria-label="怎麼玩"><li>今天買多少股票</li><li>要不要用卡</li><li>開始交易</li></ol>
    </div>
    <section class="open-board panel"><h2>選一位角色出賽</h2><div class="seats opening-seats">
    ${config.characters.map(character => `<button type="button" class="seat" data-act="character" data-value="${character.id}" aria-pressed="${character.id === chosen}" style="--ink:${character.color}">
      <canvas class="sprite" width="48" height="54" data-sprite="${character.id}" data-mood="idle" aria-hidden="true"></canvas>
      <strong>${escapeHtml(character.name)}</strong>
    </button>`).join('')}</div>
    <div class="opening-settings"><label>電腦難度<select data-input="difficulty">
      ${[['easy', '入門'], ['normal', '標準'], ['hard', '高手']].map(([value, label]) => `<option value="${value}" ${value === difficulty ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label><label>市場種子<input data-input="seed" type="number" inputmode="numeric" required min="0" max="4294967295" value="${seed}"></label></div>
    <button type="button" class="gold-button" data-act="start">開盤啦 <span aria-hidden="true">→</span></button>
    <p class="opening-note">起手本金 ${money(config.financial.initialCapital)}。四位角色規則相同，新聞全是虛構情境。</p>
    </section>
  </section>`;
}

/** What each character is doing right now, read from the latest actual settlement. */
export type Mood = 'idle' | 'think' | 'gain' | 'loss' | 'shield' | 'hit' | 'call' | 'broke' | 'recover' | 'win';

export function moodOf(run: TradingRun, investor: Investor, outcome: DayOutcome | undefined, choosing: boolean): Mood {
  const rank = run.standings().find(item => item.investor === investor)?.rank;
  if (investor.account.eliminated) return 'broke';
  if (run.closed && rank === 1) return 'win';
  if (!outcome) return choosing && investor === run.player ? 'think' : 'idle';
  if (outcome.recovery) return 'recover';
  if (outcome.risk.insolvent) return 'broke';
  if (outcome.ledger.protected) return 'shield';
  if (outcome.incomingCards.length && outcome.close < outcome.start) return 'hit';
  if (outcome.close > outcome.start) return 'gain';
  if (outcome.close < outcome.start) return 'loss';
  return choosing && investor === run.player ? 'think' : 'idle';
}

const moodText: Record<Mood, string> = {
  idle: '', think: '想一下…', gain: '賺啦！', loss: '唉…', shield: '護盾擋住！', hit: '被狙擊了！',
  call: '', broke: '歸零了…', recover: '重新出發！', win: '我是股神！'
};

function arenaMarkup(run: TradingRun, choosing: boolean, animate: boolean) {
  const latest = run.reports.at(-1);
  const standings = run.standings();
  const news = run.latestNews;
  const tone = news ? marketTone(news.event, run.config) : 'neutral';
  const fresh = Boolean(news && latest?.market && news.day === latest.day);
  const next = run.nextEventDay;
  const fighters = run.investors.map(investor => {
    const outcome = latest?.outcomes.find(item => item.investor === investor);
    const standing = standings.find(item => item.investor === investor)!;
    const before = investor.ranks.at(-2);
    const climb = before && standing.rank ? before - standing.rank : 0;
    const mood = moodOf(run, investor, outcome, choosing);
    const delta = outcome ? outcome.close - outcome.start : 0;
    const isPlayer = investor === run.player;
    const value = netWorth(investor.account);
    const bubble = moodText[mood] && (animate || mood === 'think' || mood === 'win' || mood === 'broke') ? moodText[mood] : '';
    return `<article class="fighter mood-${mood} ${isPlayer ? 'is-player' : ''} ${animate && climb > 0 ? 'rank-up' : ''}" style="--ink:${investor.character.color}"
      aria-label="${escapeHtml(investor.character.name)}，${standing.rank ? `第 ${standing.rank} 名` : '出局'}，總身家 ${money(value)}">
      ${bubble ? `<span class="bubble">${bubble}</span>` : ''}
      ${animate && delta ? `<span class="float ${direction(delta)}">${signedMoney(delta)}</span>` : ''}
      ${animate && outcome?.ledger.protected ? `<span class="shield-pop">◆ 擋下 ${money(outcome.ledger.protected)}</span>` : ''}
      <canvas class="sprite" width="48" height="54" data-sprite="${investor.character.id}" data-mood="${mood}" aria-hidden="true"></canvas>
      <div class="plate"><b class="rank">${standing.rank ? `#${standing.rank}` : '出局'}${climb ? `<small class="${direction(climb)}">${arrow(climb)}</small>` : ''}</b>
        <strong>${escapeHtml(investor.character.name)}${isPlayer ? '<em>你</em>' : ''}</strong>
        <span class="worth">${money(value)}</span>
        <span class="ret ${direction(returnRate(investor.account))}">${signedPercent(returnRate(investor.account))}</span></div>
    </article>`;
  }).join('');
  return `<section class="arena tone-${tone} ${fresh ? `fresh-news sev-${news!.event.severity}` : ''} ${animate ? 'arena-animate' : ''}" aria-label="四人交易競技場">
    <button type="button" class="ticker" data-act="news" aria-label="市場快訊：${news ? escapeHtml(news.event.title) : '尚無新聞'}，點開看詳情">
      <span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="ticker-text"><small>${fresh ? '快訊' : '市場'} · ${run.config.market[tone].name}</small>
        <strong>${news ? escapeHtml(news.event.title) : '交易所開盤，等待第一則新聞'}</strong></span>
      <span class="ticker-next">${next === null ? '新聞已結束' : `下則 第 ${next} 日`}</span>
    </button>
    <div class="stage">${fighters}</div>
  </section>`;
}

function chipsMarkup(run: TradingRun) {
  const chips: string[] = [];
  const chip = (tone: string, text: string) => chips.push(`<li class="chip ${tone}">${text}</li>`);
  const shields = hedgeLayers(run.player);
  if (shields) chip('ice', `◆ 護盾 ×${shields}`);
  if (run.player.prepared.length) chip('gold', `布局中 ${run.player.prepared.length} 張 · 剩 ${Math.max(...run.player.prepared.map(item => item.expires - run.day + 1))} 日`);
  for (const { day } of run.intelligenceFor(run.player)) chip('ice', `已知第 ${day} 日新聞`);
  return chips.length ? `<ul class="chips" aria-label="目前狀態">${chips.join('')}</ul>` : '';
}

/** Cash and stock as one two-colour bar; widths are the real shares of total worth. */
export function moneyBar(cash: number, stock: number, label = '') {
  const total = Math.max(1, cash + stock);
  const share = Math.round(stock / total * 100);
  return `<div class="money-bar" role="img" aria-label="${label}現金 ${money(cash)}，股票 ${money(stock)}">
    <span class="bar-cash" style="width:${100 - share}%"></span><span class="bar-stock" style="width:${share}%"></span></div>`;
}

function heroMarkup(run: TradingRun) {
  const { account } = run.player;
  const standing = run.standings().find(item => item.investor === run.player)!;
  const rate = returnRate(account);
  return `<section class="hero" aria-label="我的總身家">
    <div class="hero-main"><span>總身家</span><strong>${money(netWorth(account))}</strong>
      <b class="${direction(rate)}">${rate ? `${arrow(rate)} ` : ''}${signedPercent(rate)}</b></div>
    <div class="hero-side"><div><span>排名</span><strong>${standing.rank ? `${standing.rank}<small> / ${run.investors.length}</small>` : '出局'}</strong></div>
      <div><span>現金</span><strong class="cash-ink">${money(account.cash)}</strong></div>
      <div><span>股票</span><strong class="stock-ink">${money(account.investmentValue)}</strong></div></div>
    ${moneyBar(account.cash, account.investmentValue, '目前')}
    ${chipsMarkup(run)}
    <div class="hero-tools"><button type="button" data-act="chart">走勢</button></div>
  </section>`;
}

/** Itemised result of the player's latest day, straight from the settlement record. */
function resultMarkup(run: TradingRun, animate: boolean) {
  const last = run.reports.at(-1);
  const outcome = last?.outcomes.find(item => item.investor === run.player);
  if (!last || !outcome) return '';
  const view = dayBreakdown(outcome);
  const before = run.player.ranks.at(-2);
  const after = run.player.ranks.at(-1);
  const crisis = outcome.risk.insolvent;
  const notes = [
    outcome.card ? `打出「${escapeHtml(outcome.card.name)}」` : '',
    view.cardShare > 0 ? `其中卡片貢獻 ${money(view.cardShare)}` : '',
    view.shielded > 0 ? `護盾少賠 ${money(view.shielded)}` : '',
    outcome.incomingCards.length ? `被 ${outcome.incomingCards.map(escapeHtml).join('、')} 影響` : '',
    outcome.targetedRivals.length ? `影響 ${outcome.targetedRivals.map(escapeHtml).join('、')}` : ''
  ].filter(Boolean);
  return `<section class="day-result ${crisis ? 'crisis' : ''} ${animate ? 'result-animate' : ''}" aria-label="第 ${last.day} 日結算">
    <header><span>第 ${last.day} 日 · ${escapeHtml(allocationOption(run.config, outcome.allocation).name)}</span>
      <strong class="${direction(view.net)}">${arrow(view.net)} ${signedMoney(view.net)}</strong>
      ${before && after && before !== after ? `<b class="rank-change ${direction(before - after)}">#${before} → #${after}</b>` : ''}
      ${view.combos ? `<b class="combo-tag">連招 ×${view.combos}</b>` : ''}</header>
    ${view.lines.length ? `<ul>${view.lines.map(line => `<li><span>${line.label}</span><b class="${direction(line.amount)}">${signedMoney(line.amount)}</b></li>`).join('')}</ul>` : ''}
    ${notes.length ? `<p>${notes.join(' · ')}</p>` : ''}
    ${crisis ? '<button type="button" class="text-button" data-act="crisis">看歸零明細</button>' : ''}
  </section>`;
}

export const cardBlockCopy: Record<CardBlock, string> = {
  no_stock: '手上沒有股票', full_shield: '護盾已滿',
  no_news: '後面沒有新聞了', known_news: '這則消息已知道',
  cash_high: '現金還夠，用不到', low_cash: '現金不夠多',
  no_opponent: '前面沒有適合的對手', route: '今天用不了',
  need_downturn: '要等市場利空', already_prepared: '已在布局中', no_days: '沒有後續交易日',
  recovery_required: '歸零翻身後才能用',
  already_used: '本局已用過', equity_high: '身家要低於本金一半'
};

interface CardStatus { tone: 'ok' | 'pair' | 'prep' | 'blocked'; label: string; reason?: string }

/** Whether a card can be played today with the chosen stock ratio, using the same preview as confirmation. */
function cardStatus(run: TradingRun, slot: number, allocation: string): CardStatus {
  const card = run.player.hand[slot];
  const preview = run.preview(0, slot, false, false, allocation);
  if (preview?.enabledCard) return { tone: preview.synergies ? 'pair' : 'ok', label: preview.synergies ? '今天有連招' : '今天可用' };
  if (cardPreparationAvailable(run.config, card) && run.preview(0, slot, false, true, allocation)?.enabledCard) {
    return { tone: 'prep', label: '可以先存著' };
  }
  const block = preview?.cardBlock ?? 'route';
  const reason = block === 'no_stock' ? '今天沒有股票，用了不會多賺' : cardBlockCopy[block];
  return { tone: 'blocked', label: '今天用不了', reason };
}

function handMarkup(run: TradingRun, allocation: string, slot: number | null, prepare: boolean) {
  const statuses = run.player.hand.map((_, index) => cardStatus(run, index, allocation));
  const cards = run.player.hand.map((card, index) => {
    const face = cardFace(run.config, card);
    const status = statuses[index];
    return `<button type="button" class="hand-card st-${status.tone}" style="--ink:${card.color}" data-act="card" data-value="${index}" data-card-id="${card.id}" aria-pressed="${slot === index}"
      aria-label="${escapeHtml(card.name)}：${escapeHtml(face.line)} ${status.label}${status.reason ? `，${status.reason}` : ''}">
      <span class="card-top">${iconMarkup(card.icon, card.color)}<kbd>${index + 1}</kbd></span>
      <strong>${escapeHtml(card.name)}</strong>
      <b class="card-value">${escapeHtml(face.value)}</b>
      <span class="card-line">${escapeHtml(face.line)}</span>
      <span class="card-status">${status.tone === 'blocked' ? escapeHtml(status.reason ?? status.label) : escapeHtml(status.label)}</span>
    </button>`;
  }).join('');
  const selected = slot === null ? null : run.player.hand[slot];
  return `<section class="hand-section" aria-label="今日手牌">
    <div class="section-head"><h2>② 要不要用卡？</h2><span>最多 1 張 · 可以不用</span></div>
    <div class="hand-row">${cards}</div>
    ${run.player.prepared.length ? `<p class="pending-cards">${run.player.prepared.map(item => `${escapeHtml(run.config.cards.find(entry => entry.id === item.id)?.name ?? '布局')}：還有 ${item.expires - run.day + 1} 個交易日。${['cash', 'stock'].includes(item.kind) ? '符合條件時每日領取。' : '可觸發 1 次。'}`).join(' ')}</p>` : ''}
    ${selected ? cardPanel(run, selected, slot!, allocation, prepare, statuses[slot!]) : ''}
  </section>`;
}

function cardPanel(run: TradingRun, card: TradingCard, slot: number, allocation: string, prepare: boolean, status: CardStatus) {
  const face = cardFace(run.config, card);
  const preview = run.preview(0, slot, true, prepare, allocation);
  const impact = preview?.enabledCard ? preview.cardImpact : null;
  const results = impact && preview ? [
    preview.activeComboGain + preview.baseGain > 0 ? `估計多賺 ${money(preview.activeComboGain + preview.baseGain)}` : '',
    preview.extraProtection > 0 ? `遇利空估計少賠 ${money(preview.extraProtection)}` : '',
    impact.cash > 0 ? `現金 +${money(impact.cash)}` : ''
  ].filter(Boolean) : [];
  const message = preview?.enabledCard
    ? preview.preparation ? '先存著，之後自動發動。' : preview.synergies ? '今天用會觸發連招。' : '今天可以用。'
    : `今天用不了：${status.reason ?? status.label}。`;
  const canPrepare = cardPreparationAvailable(run.config, card);
  return `<div class="card-panel" style="--ink:${card.color}" aria-live="polite">
    <p><strong>${escapeHtml(card.name)}</strong> ${escapeHtml(face.value)}</p>
    <p class="${preview?.enabledCard ? 'gold' : 'ice'}" data-card-status tabindex="-1">${message}</p>
    ${results.length ? `<p class="synergy-note" data-card-impact>${results.join(' · ')}（估計）</p>` : ''}
    <div class="card-buttons">
      ${canPrepare ? `<button type="button" data-act="prepare" aria-pressed="${prepare}">${prepare ? '改為今天使用' : '改為先存著'}</button>` : ''}
      ${run.player.exchangeLeft > 0 ? `<button type="button" data-act="exchange">免費換這張・剩 ${run.player.exchangeLeft} 次</button>` : ''}
      <button type="button" data-act="card-rules" data-value="${slot}">完整規則</button>
    </div>
  </div>`;
}

/** Full rules for one card, shown in the detail dialog. */
export function cardRulesMarkup(run: TradingRun, card: TradingCard) {
  const face = cardFace(run.config, card);
  const values = card.effectIds.flatMap(id => {
    const effect = run.config.effects[id];
    if (effect.type === 'cash_yield') return [`現金至少占總身家 ${percent(effect.threshold)}，多拿現金的 ${percent(effect.rate)}。`];
    if (effect.type === 'hedge') return [`可抵銷 ${percent(effect.protection)} 的符合條件損失。`];
    if (effect.type === 'combo') return [`${effect.base ? `基本效果 ${percent(effect.base)}；` : ''}連招時${effect.mode === 'dividend' ? '多領股票的' : '股票多賺'} ${percent(effect.amount)}。`];
    return [];
  });
  return `<div class="card-rules" style="--ink:${card.color}">
    <p class="rules-head">${iconMarkup(card.icon, card.color)}<strong>${escapeHtml(card.name)}</strong><b>${escapeHtml(face.value)}</b></p>
    <p>${escapeHtml(card.description)}</p>
    <dl class="preview-breakdown"><div><dt>使用條件</dt><dd>${escapeHtml(card.condition)}</dd></div><div><dt>效果時間</dt><dd>${escapeHtml(card.duration)}</dd></div>
    ${face.pairs.length ? `<div><dt>連招搭配</dt><dd>${escapeHtml(pairLabel(face, 6))}</dd></div>` : ''}</dl>
    ${values.length ? `<p>${values.join(' ')}</p>` : ''}
  </div>`;
}

/** Step 1: three stock ratios with the real cash/stock split each would produce today. */
function allocationMarkup(run: TradingRun, allocation: string, slot: number | null, prepare: boolean) {
  const worth = netWorth(run.player.account);
  const buttons = run.config.allocation.options.map(option => {
    const stock = Math.floor(Math.max(0, worth) * option.ratio);
    return `<button type="button" class="alloc-button" data-act="alloc" data-value="${option.id}" aria-pressed="${option.id === allocation}">
      <strong>${escapeHtml(option.name)}</strong><small>${percent(option.ratio)} 股票</small>${moneyBar(worth - stock, stock, `${option.name}：`)}</button>`;
  }).join('');
  const chosen = allocationOption(run.config, allocation);
  const planned = Math.floor(Math.max(0, worth) * chosen.ratio);
  const preview = run.preview(0, slot, false, prepare, allocation);
  const gain = Math.max(0, preview?.high ?? 0);
  const loss = Math.min(0, preview?.low ?? 0);
  return `<section class="alloc-section" aria-label="今天買多少股票？">
    <div class="section-head"><h2>① 今天買多少股票？</h2><span>${allocation === run.player.allocation ? '沿用昨天' : '已改變'}</span></div>
    <div class="alloc-row">${buttons}</div>
    ${preview ? `<div class="preview" aria-live="polite">
      <p>現金 <b class="cash-ink">${money(worth - planned)}</b> · 股票 <b class="stock-ink">${money(planned)}</b></p>
      <p>${escapeHtml(chosen.detail)}${gain || loss ? ` 今天大約 ${gain ? `<b class="gain">+${money(gain)}</b>` : ''}${gain && loss ? ' ～ ' : ''}${loss ? `<b class="loss">−${money(-loss)}</b>` : ''}（估計）` : ''}</p>
      ${preview.opponents.length ? `<p class="preview-warning">▲ 會影響 ${preview.opponents.map(escapeHtml).join('、')}</p>` : ''}
    </div>` : ''}
  </section>`;
}

export function chartDialogMarkup(run: TradingRun) {
  return performanceChart(run);
}

/** The latest news, what it did to the player (from the settlement record), and any private intel. */
export function newsMarkup(run: TradingRun) {
  const current = run.latestNews;
  const intel = run.intelligenceFor(run.player);
  const report = current ? run.reports.find(item => item.day === current.day) : null;
  const outcome = report?.outcomes.find(item => item.investor === run.player);
  const tone = current ? marketTone(current.event, run.config) : 'neutral';
  const rate = outcome?.ledger.marketRate;
  const blocked = outcome?.ledger.protected ?? 0;
  const impact = !outcome?.marketApplied ? '這則新聞沒有影響你。' :
    blocked > 0 ? `原本會賠 ${money(blocked - outcome.marketPnl)}，護盾擋下 ${money(blocked)}，實際${outcome.marketPnl === 0 ? '沒賠' : `賠 ${money(-outcome.marketPnl)}`}。` :
    outcome.marketPnl ? `你的股票${outcome.marketPnl > 0 ? '多了' : '少了'} ${money(Math.abs(outcome.marketPnl))}。` : '你的股票損益為 $0。';
  return `<div class="news-detail ${tone}">
    ${current ? `<p class="news-kicker">第 ${current.day} 日 · 虛構新聞 · ${run.config.market[tone].name}</p><h3>${escapeHtml(current.event.title)}</h3>
      <p>${escapeHtml(current.event.subtitle)}</p>
      ${report ? `<p data-market-impact class="gold">${rate == null ? '' : `股票市值${rate < 0 ? '下跌' : rate > 0 ? '上漲' : '持平'}${rate ? ` ${percent(Math.abs(rate))}` : ''}。`}${impact}</p>` : ''}
      <p>${escapeHtml(current.event.description)}</p>`
      : '<p>還沒有市場新聞。</p>'}
    <p>${run.nextEventDay === null ? '本局新聞已全部公布。' : `下一則新聞在第 ${run.nextEventDay} 日。`}</p>
    ${intel.map(({ day, event }) => `<p class="intel">◆ 你打聽到第 ${day} 日的新聞：${escapeHtml(event.title)}。${escapeHtml(event.description)}</p>`).join('')}
  </div>`;
}

export function offerMarkup(run: TradingRun, offered: number | null, replace: number | null) {
  const offer = run.offer!;
  const full = run.player.hand.length >= run.config.gameplay.inventorySize;
  return `<p>${offer.source === 'draw' ? '手牌滿了。選一張要換掉的牌，或把新卡丟掉。' : '選一張加入手牌。'}${full && offer.source === 'draft' ? '手牌已滿，請同時選要替換的牌。' : ''}</p>
    <div class="offer-grid">${offer.cards.map((card, index) => {
      const face = cardFace(run.config, card);
      return `<button type="button" class="offer-card" style="--ink:${card.color}" data-act="offer-card" data-value="${index}" aria-pressed="${offered === index}">
      ${iconMarkup(card.icon, card.color)}<strong>${escapeHtml(card.name)}</strong><b class="card-value">${escapeHtml(face.value)}</b><span>${escapeHtml(face.line)}</span>
      ${face.pairs.length ? `<small>搭 ${escapeHtml(pairLabel(face))}</small>` : ''}</button>`;
    }).join('')}</div>
    ${full ? `<div class="replace-list" aria-label="要替換的手牌">${run.player.hand.map((card, index) =>
      `<button type="button" data-act="replace" data-value="${index}" aria-pressed="${replace === index}">${escapeHtml(card.name)}</button>`).join('')}</div>` : ''}
    <div class="dialog-actions"><button type="button" data-act="decline">棄置新卡</button><button type="button" class="gold-button" data-act="take" ${offered === null || (full && replace === null) ? 'disabled' : ''}>加入手牌</button></div>`;
}

export interface TerminalSelection {
  allocation: string | null; slot: number | null; prepare: boolean; animate: boolean
}

export function tradingMarkup(run: TradingRun, ui: TerminalSelection, coach: string) {
  const { slot, prepare, animate } = ui;
  const allocation = ui.allocation ?? run.player.allocation;
  const eliminated = run.player.account.eliminated;
  const preview = eliminated ? null : run.preview(0, slot, false, prepare, allocation);
  const choosing = ui.allocation !== null || slot !== null;
  return `<main class="trading" id="market" aria-label="交易畫面">
    <div class="play-layout">
      <div class="stage-column">${arenaMarkup(run, choosing, animate)}${heroMarkup(run)}${resultMarkup(run, animate)}</div>
      <div class="decision-column">${coach}
        ${eliminated ? '<section class="panel spectator"><h2>本席已出局</h2><p>其他投資人會繼續結算。</p><button type="button" data-act="personal">查看個人結算</button></section>' :
      `${allocationMarkup(run, allocation, slot, prepare)}${handMarkup(run, allocation, slot, prepare)}`}
      </div>
    </div></main>
    <div class="trade-dock"><div class="dock-inner"><div class="dock-caption"><span>${eliminated ? '觀戰模式' : `第 ${run.day} / ${run.config.gameplay.turns} 日`}${slot !== null && !eliminated ? ` · ${escapeHtml(run.player.hand[slot].name)}` : ''}</span>
      <strong>${eliminated ? '其餘席位繼續' : escapeHtml(allocationOption(run.config, allocation).name)}</strong></div>
      <button type="button" class="gold-button" data-act="trade" ${!eliminated && slot !== null && !preview?.enabledCard ? 'disabled' : ''}>
      ${eliminated ? '看下一個交易日' : run.day === run.config.gameplay.turns ? '開始交易・收盤' : '開始交易'} <span aria-hidden="true">→</span></button></div></div>`;
}
