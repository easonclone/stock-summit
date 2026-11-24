import type { FinancialConfig, TradingCard } from '../config/financial-settings';
import { canBorrow, debtBalance, depositBalance, leverageExposure, marginLtv, netWorth, returnRate, warningReasons } from '../core/economy';
import type { TradingRun, DayOutcome, Investor } from '../core/trading-run';
import type { RouteNode } from '../core/node-map';
import { cardPreparationAvailable } from '../core/trade-preview';
import { hedgeLayers, marketTone, type CardBlock } from '../core/trading-effects';
import { dayBreakdown } from './breakdown';
import { cardFace, pairLabel } from './card-face';
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
      <div class="opening-title"><h1>股市攻頂戰</h1><p>Pixel Stock Arena</p></div>
      <p class="opening-description">四人同場炒股。選卡、選投資、下單，${config.gameplay.turns} 天後總身家最高的人贏。</p>
      <ol class="opening-steps" aria-label="怎麼玩"><li>選卡</li><li>選投資</li><li>下單</li><li>看結果</li></ol>
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
  if (outcome.risk.call) return 'call';
  if (outcome.ledger.protected) return 'shield';
  if (outcome.incomingCards.length && outcome.close < outcome.start) return 'hit';
  if (outcome.close > outcome.start) return 'gain';
  if (outcome.close < outcome.start) return 'loss';
  return choosing && investor === run.player ? 'think' : 'idle';
}

const moodText: Record<Mood, string> = {
  idle: '', think: '想一下…', gain: '賺啦！', loss: '唉…', shield: '護盾擋住！', hit: '被狙擊了！',
  call: '要補錢了！', broke: '破產…', recover: '重新出發！', win: '我是股神！'
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
  const { account } = run.player;
  const rules = run.config.financial;
  const chips: string[] = [];
  const chip = (tone: string, text: string) => chips.push(`<li class="chip ${tone}">${text}</li>`);
  if (account.investmentValue > 0) chip('', `股票 ${money(account.investmentValue)}`);
  if (account.deposits.length) {
    const due = Math.min(...account.deposits.map(item => item.maturity));
    chip('ice', `定存 ${money(depositBalance(account))} · 第 ${due} 日到期`);
  }
  const debt = debtBalance(account);
  if (debt > 0) chip('warn', `欠款 ${money(debt)}`);
  if (account.closingPayable > 0) chip('warn', `收盤另付 ${money(account.closingPayable)}`);
  const shields = hedgeLayers(run.player);
  if (shields) chip('ice', `◆ 護盾 ×${shields}`);
  if (run.player.prepared.length) chip('gold', `布局中 ${run.player.prepared.length} 張 · 剩 ${Math.max(...run.player.prepared.map(item => item.expires - run.day + 1))} 日`);
  for (const { day } of run.intelligenceFor(run.player)) chip('ice', `已知第 ${day} 日新聞`);
  const warnings = warningReasons(account, rules);
  const locked = Math.max(0, account.leverageRestrictedUntil - run.day + 1);
  if (account.financialStatus !== 'normal' || warnings.length) chip('danger', `▲ ${warnings[0] ?? financialLabels[account.financialStatus]}`);
  if (locked) chip('danger', `重整中 ${locked} 日不能借錢`);
  return chips.length ? `<ul class="chips" aria-label="目前狀態">${chips.join('')}</ul>` : '';
}

function heroMarkup(run: TradingRun) {
  const { account } = run.player;
  const standing = run.standings().find(item => item.investor === run.player)!;
  const rate = returnRate(account);
  return `<section class="hero" aria-label="我的總身家">
    <div class="hero-main"><span>總身家</span><strong>${money(netWorth(account))}</strong>
      <b class="${direction(rate)}">${rate ? `${arrow(rate)} ` : ''}${signedPercent(rate)}</b></div>
    <div class="hero-side"><div><span>排名</span><strong>${standing.rank ? `${standing.rank}<small> / ${run.investors.length}</small>` : '出局'}</strong></div>
      <div><span>手上現金</span><strong>${money(account.cash)}</strong></div></div>
    ${chipsMarkup(run)}
    <div class="hero-tools"><button type="button" data-act="chart">走勢</button><button type="button" data-act="finance">財務明細</button><button type="button" data-act="map">路線圖</button></div>
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
  const crisis = outcome.risk.call || outcome.risk.insolvent;
  const notes = [
    outcome.card ? `打出「${escapeHtml(outcome.card.name)}」` : '',
    view.cardShare > 0 ? `其中卡片貢獻 ${money(view.cardShare)}` : '',
    view.shielded > 0 ? `護盾少賠 ${money(view.shielded)}` : '',
    outcome.incomingCards.length ? `被 ${outcome.incomingCards.map(escapeHtml).join('、')} 影響` : '',
    outcome.targetedRivals.length ? `影響 ${outcome.targetedRivals.map(escapeHtml).join('、')}` : ''
  ].filter(Boolean);
  return `<section class="day-result ${crisis ? 'crisis' : ''} ${animate ? 'result-animate' : ''}" aria-label="第 ${last.day} 日結算">
    <header><span>第 ${last.day} 日 · ${outcome.node ? escapeHtml(run.config.nodes.kinds[outcome.node.kind].name) : '場外'}</span>
      <strong class="${direction(view.net)}">${arrow(view.net)} ${signedMoney(view.net)}</strong>
      ${before && after && before !== after ? `<b class="rank-change ${direction(before - after)}">#${before} → #${after}</b>` : ''}
      ${view.combos ? `<b class="combo-tag">連招 ×${view.combos}</b>` : ''}</header>
    ${view.lines.length ? `<ul>${view.lines.map(line => `<li><span>${line.label}</span><b class="${direction(line.amount)}">${signedMoney(line.amount)}</b></li>`).join('')}</ul>` : ''}
    ${notes.length ? `<p>${notes.join(' · ')}</p>` : ''}
    ${crisis ? '<button type="button" class="text-button" data-act="crisis">看危機明細</button>' : ''}
  </section>`;
}

export const cardBlockCopy: Record<CardBlock, string> = {
  no_stock: '手上沒有股票', full_shield: '護盾已滿',
  no_news: '後面沒有新聞了', known_news: '這則消息已知道',
  cash_high: '現金還夠，用不到', cannot_borrow: '現在借不到錢',
  no_debt: '目前沒有欠款', low_cash: '現金不足',
  no_opponent: '前面沒有適合的對手', route: '要搭配指定投資',
  need_downturn: '要等市場利空', already_prepared: '已在布局中', no_days: '沒有後續交易日',
  no_deposit: '手上沒有定存', recovery_required: '重整後才能用',
  already_used: '本局已用過', equity_high: '身家要低於本金一半'
};

interface CardStatus { tone: 'ok' | 'pair' | 'prep' | 'blocked'; label: string; reason?: string; synergyLanes: number[]; usableLanes: number[] }

/** Whether a card can be played today and with which investments, using the same previews as confirmation. */
function cardStatus(run: TradingRun, slot: number, routes: RouteNode[], lane: number | null): CardStatus {
  const card = run.player.hand[slot];
  const results = routes.map(node => ({ node, preview: run.preview(node.lane, slot)! }));
  const usable = results.filter(item => item.preview.enabledCard);
  const synergy = usable.filter(item => item.preview.synergies > 0);
  const names = (items: typeof results) => items.map(item => item.preview.kind.name).join('、');
  const base = { synergyLanes: synergy.map(item => item.node.lane), usableLanes: usable.map(item => item.node.lane) };
  if (lane !== null) {
    const here = results.find(item => item.node.lane === lane);
    if (here?.preview.enabledCard) return { ...base, tone: here.preview.synergies ? 'pair' : 'ok', label: here.preview.synergies ? '這條路有連招' : '這條路可用' };
  }
  if (usable.length) {
    if (usable.length === results.length) return { ...base, tone: synergy.length ? 'pair' : 'ok', label: synergy.length ? `可用 · 走${names(synergy)}更強` : '今天可用' };
    return { ...base, tone: 'pair', label: `走${names(usable)}可用` };
  }
  if (cardPreparationAvailable(run.config, card) && routes.some(node => run.preview(node.lane, slot, false, true)?.enabledCard)) {
    return { ...base, tone: 'prep', label: '可以提前布局' };
  }
  const block = results.map(item => item.preview.cardBlock).find(item => item && item !== 'route') ?? results[0]?.preview.cardBlock ?? 'route';
  return { ...base, tone: 'blocked', label: '今天用不了', reason: cardBlockCopy[block] };
}

function handMarkup(run: TradingRun, lane: number | null, slot: number | null, prepare: boolean) {
  const routes = run.reachable(run.player);
  const statuses = run.player.hand.map((_, index) => cardStatus(run, index, routes, lane));
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
      ${face.duration ? `<span class="card-days">⏱ ${escapeHtml(face.duration)}</span>` : ''}
    </button>`;
  }).join('');
  const selected = slot === null ? null : run.player.hand[slot];
  return `<section class="hand-section" aria-label="今日手牌">
    <div class="section-head"><h2>手牌</h2><span>今天打 1 張 · ${run.player.hand.length}／${run.config.gameplay.inventorySize}</span></div>
    <div class="hand-row">${cards}</div>
    ${run.player.prepared.length ? `<p class="pending-cards">${run.player.prepared.map(item => `${escapeHtml(run.config.cards.find(entry => entry.id === item.id)?.name ?? '布局')}：還有 ${item.expires - run.day + 1} 個交易日。${['deposit', 'stock'].includes(item.kind) ? '符合條件時每日領取。' : '可觸發 1 次。'}`).join(' ')}</p>` : ''}
    ${selected ? cardPanel(run, selected, slot!, lane, prepare, statuses[slot!]) : ''}
  </section>`;
}

function cardPanel(run: TradingRun, card: TradingCard, slot: number, lane: number | null, prepare: boolean, status: CardStatus) {
  const face = cardFace(run.config, card);
  const preview = lane === null ? null : run.preview(lane, slot, true, prepare);
  const impact = preview?.enabledCard ? preview.cardImpact : null;
  const results = impact && preview ? [
    preview.activeComboGain + preview.baseGain > 0 ? `估計多賺 ${money(preview.activeComboGain + preview.baseGain)}` : '',
    preview.extraProtection > 0 ? `遇利空估計少賠 ${money(preview.extraProtection)}` : '',
    impact.sold ? `先賣 ${money(impact.sold)} 股票` : '',
    impact.repaid ? `先還 ${money(impact.repaid)}` : '',
    impact.cash > 0 ? `現金 +${money(impact.cash)}` : '',
    impact.debt > 0 ? `欠款 +${money(impact.debt)}` : '',
    impact.fees ? `手續費 ${money(impact.fees)}` : ''
  ].filter(Boolean) : [];
  const usableHere = preview ? preview.enabledCard : status.tone !== 'blocked';
  const message = preview
    ? preview.enabledCard ? (preview.preparation ? '這條路可以提前布局。' : preview.synergies ? '現在可以使用，這條路會觸發連招。' : '現在可以使用。')
      : `這條路用不了：${cardBlockCopy[preview.cardBlock ?? 'route']}。${status.usableLanes.length ? '亮起的投資可以用。' : ''}`
    : status.tone === 'blocked' ? `今天用不了：${status.reason}。` : `${prepare ? '可以提前布局' : status.label}。先挑一個投資看試算。`;
  const canPrepare = cardPreparationAvailable(run.config, card);
  return `<div class="card-panel" style="--ink:${card.color}" aria-live="polite">
    <p><strong>${escapeHtml(card.name)}</strong> ${escapeHtml(face.value)}</p>
    <p class="${usableHere ? 'gold' : 'ice'}" data-card-status tabindex="-1">${message}</p>
    ${results.length ? `<p class="synergy-note" data-card-impact>${results.join(' · ')}（估計）</p>` : ''}
    ${face.pairs.length ? `<p>搭配：${escapeHtml(pairLabel(face, 4))}</p>` : ''}
    <div class="card-buttons">
      ${canPrepare ? `<button type="button" data-act="prepare" aria-pressed="${prepare}">${prepare ? '改為今天使用' : '改為提前布局'}</button>` : ''}
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
    if (effect.type === 'bailout') return [`現金低於起手本金的 ${percent(effect.cashThreshold)} 才能用。拿到 ${money(effect.amount)}，救命貸款增加 ${money(effect.amount + effect.fee)}（含手續費 ${money(effect.fee)}）。`];
    if (effect.type === 'cash_yield') return [`現金比率要達 ${percent(effect.threshold)}，收益率 ${percent(effect.rate)}。`];
    if (effect.type === 'hedge') return [`可抵銷 ${percent(effect.protection)} 的符合條件損失。`];
    if (effect.type === 'combo') return [`${effect.base ? `基本效果 ${percent(effect.base)}；` : ''}接連招後${effect.mode === 'dividend' ? '股息多' : '股票漲跌幅加'} ${percent(effect.amount)}。`];
    if (effect.type === 'maintenance') return [`融資追繳門檻收緊為 ${percent(effect.ltv)}。`];
    if (effect.type === 'sell') return [`賣出股票市值的 ${percent(effect.fraction)}，有欠款就先還。`];
    if (effect.type === 'repay') return [`最多拿手上現金的 ${percent(effect.fraction)} 還款，手續費為還款額的 ${percent(effect.feeRate)}。`];
    return [];
  });
  return `<div class="card-rules" style="--ink:${card.color}">
    <p class="rules-head">${iconMarkup(card.icon, card.color)}<strong>${escapeHtml(card.name)}</strong><b>${escapeHtml(face.value)}</b></p>
    <p>${escapeHtml(card.description)}</p>
    <dl class="preview-breakdown"><div><dt>使用條件</dt><dd>${escapeHtml(card.condition)}</dd></div><div><dt>效果時間</dt><dd>${escapeHtml(card.duration)}</dd></div>
    ${face.pairs.length ? `<div><dt>搭配投資</dt><dd>${escapeHtml(pairLabel(face, 6))}</dd></div>` : ''}</dl>
    ${values.length ? `<p>${values.join(' ')}</p>` : ''}
  </div>`;
}

function actionsMarkup(run: TradingRun, lane: number | null, slot: number | null, prepare: boolean) {
  const routes = run.reachable(run.player);
  const rules = run.config.financial;
  const card = slot === null ? null : run.player.hand[slot];
  const tiles = routes.map((node: RouteNode) => {
    const estimate = run.preview(node.lane, slot, false, prepare)!;
    const kind = estimate.kind;
    const spend = estimate.invested + estimate.deposited;
    const facts = [
      estimate.deposited ? `存 ${money(estimate.deposited)} · 日息約 ${money(Math.round(estimate.deposited * rules.depositDailyRate))} · ${rules.depositDays} 日到期` :
        spend ? `出 ${money(spend)}` : '',
      estimate.orderDebt ? `借 ${money(estimate.orderDebt)}` : '',
      estimate.sold ? `賣 ${money(estimate.sold)}` : '',
      estimate.repaid ? `還 ${money(estimate.repaid)}` : ''
    ].filter(Boolean);
    const tags = [
      !estimate.available ? '<i class="tag danger">借不到</i>' : '',
      estimate.orderDebt ? '<i class="tag warn">槓桿</i>' : '',
      estimate.exposureRisk ? '<i class="tag danger">可能追繳</i>' : '',
      card && estimate.enabledCard && estimate.synergies ? '<i class="tag gold">連招</i>' : card && estimate.enabledCard ? '<i class="tag ok">可出卡</i>' : ''
    ].filter(Boolean).join('');
    const gain = Math.max(0, estimate.high);
    const loss = Math.min(0, estimate.low);
    return `<button type="button" class="action-tile ${card && estimate.enabledCard ? 'card-fit' : ''} ${card && estimate.synergies && estimate.enabledCard ? 'card-combo' : ''}" style="--ink:${kind.color}"
      data-act="lane" data-value="${node.lane}" data-kind="${node.kind}" aria-pressed="${node.lane === lane}">
      <span class="tile-head">${iconMarkup(kind.icon, kind.color)}<strong>${escapeHtml(kind.name)}</strong></span>
      <span class="tile-range">${gain || loss ? `${gain ? `<b class="gain">估 +${money(gain)}</b>` : ''}${loss ? `<b class="loss">估 −${money(-loss)}</b>` : ''}` : '<b class="flat">不賺不賠</b>'}</span>
      ${facts.length ? `<span class="tile-facts">${facts.join(' · ')}</span>` : ''}
      ${tags ? `<span class="tile-tags">${tags}</span>` : ''}
    </button>`;
  }).join('');
  const preview = lane === null ? null : run.preview(lane, slot, false, prepare);
  return `<section class="actions-section" aria-label="今天要怎麼投？">
    <div class="section-head"><h2>今天要怎麼投？</h2><span>金額皆為估計</span></div>
    <div class="action-grid" style="--routes:${routes.length}">${tiles}</div>
    ${preview ? `<div class="preview" aria-live="polite">
      <p><strong>${escapeHtml(preview.kind.name)}</strong> ${escapeHtml(preview.kind.detail)}</p>
      ${card && !preview.enabledCard ? `<p class="preview-warning">▲ 這條路不能用「${escapeHtml(card.name)}」：${cardBlockCopy[preview.cardBlock ?? 'route']}</p>` : ''}
      ${!preview.available ? `<p class="preview-warning">▲ ${canBorrow(run.player.account, run.day, rules) ? '擔保不夠，借不到這筆錢' : '目前不能借錢加碼'}，下單會改成觀望。</p>` : ''}
      ${preview.exposureRisk ? `<p class="preview-warning">▲ 跌得深時，券商可能要你補 ${money(preview.marginRequired)}。</p>` : ''}
      ${preview.opponents.length ? `<p class="preview-warning">▲ 會影響 ${preview.opponents.map(escapeHtml).join('、')}</p>` : ''}
      ${preview.feeSaved > 0 ? `<p class="synergy-note">優惠券估計省下 ${money(preview.feeSaved)}</p>` : ''}
      ${preview.orderDebt || preview.deposited || preview.debtChange || preview.fees ? `<details><summary>費用與細節</summary><dl class="preview-breakdown">
        ${preview.fees ? `<div><dt>預估費用</dt><dd>${money(preview.fees)}</dd></div>` : ''}
        ${preview.debtChange ? `<div><dt>欠款變動</dt><dd>${signedMoney(preview.debtChange)}</dd></div>` : ''}</dl>
        ${preview.orderDebt ? `<p>融資日息 ${percent(rules.marginDailyRate)}，開辦費 ${percent(rules.originationFee)}。</p>` : ''}
        ${preview.deposited ? `<p>定存日息 ${percent(rules.depositDailyRate)}，鎖 ${rules.depositDays} 個交易日，到期領回本金。</p>` : ''}
      </details>` : ''}
    </div>` : ''}
  </section>`;
}

/** Full balance sheet for the details dialog: every account figure, including zero ones. */
export function financeDetailMarkup(run: TradingRun) {
  const { account, hedges } = run.player;
  const ltv = marginLtv(account);
  return `<dl class="finance-detail">
    <div><dt>總身家（淨資產）</dt><dd>${money(netWorth(account))}</dd></div><div><dt>手上現金</dt><dd>${money(account.cash)}</dd></div>
    <div><dt>股票市值</dt><dd>${money(account.investmentValue)}</dd></div><div><dt>定存</dt><dd>${money(depositBalance(account))}</dd></div>
    <div><dt>融資借款</dt><dd>${money(account.marginDebt)}</dd></div><div><dt>救命貸款</dt><dd>${money(account.bailoutDebt)}</dd></div>
    <div><dt>部位／淨資產</dt><dd>${netWorth(account) > 0 ? `×${leverageExposure(account).toFixed(2)}` : '不適用'}</dd></div>
    <div><dt>融資比率</dt><dd>${account.marginDebt ? percent(Number.isFinite(ltv) ? ltv : 1) : '—'}</dd></div>
    <div><dt>收盤另應付</dt><dd>${money(account.closingPayable)}</dd></div><div><dt>護盾</dt><dd>${hedges.length ? hedges.map(percent).join('、') : '—'}</dd></div>
    <div><dt>追繳門檻</dt><dd>${percent(run.config.financial.callLtv)}</dd></div><div><dt>財務狀態</dt><dd>${financialLabels[account.financialStatus]}</dd></div>
  </dl>
  ${account.deposits.length ? `<p>定存批次：${account.deposits.map(item => `${money(item.balance)} 第 ${item.maturity} 日到期`).join('、')}</p>` : ''}`;
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
  const maintenance = current?.event.effectIds.map(id => run.config.effects[id]).find(rule => rule.type === 'maintenance');
  return `<div class="news-detail ${tone}">
    ${current ? `<p class="news-kicker">第 ${current.day} 日 · 虛構新聞 · ${run.config.market[tone].name}</p><h3>${escapeHtml(current.event.title)}</h3>
      <p>${escapeHtml(current.event.subtitle)}</p>
      ${report ? `<p data-market-impact class="gold">${rate == null ? '' : `股票市值${rate < 0 ? '下跌' : rate > 0 ? '上漲' : '持平'}${rate ? ` ${percent(Math.abs(rate))}` : ''}。`}${impact}</p>` : ''}
      <details><summary>新聞規則</summary><p>${escapeHtml(current.event.description)}${maintenance ? ` 這天的追繳門檻收緊至 ${percent(Math.min(maintenance.ltv, run.config.financial.callLtv))}。` : ''}</p></details>`
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
  lane: number | null; slot: number | null; prepare: boolean; animate: boolean
}

export function tradingMarkup(run: TradingRun, ui: TerminalSelection, coach: string) {
  const { lane, slot, prepare, animate } = ui;
  const eliminated = run.player.account.eliminated;
  const preview = lane === null ? null : run.preview(lane, slot, false, prepare);
  const choosing = lane !== null || slot !== null;
  return `<main class="trading" id="market" aria-label="交易畫面">
    <div class="play-layout">
      <div class="stage-column">${arenaMarkup(run, choosing, animate)}${heroMarkup(run)}${resultMarkup(run, animate)}</div>
      <div class="decision-column">${coach}
        ${eliminated ? '<section class="panel spectator"><h2>本席已出局</h2><p>其他投資人會繼續結算。</p><button type="button" data-act="personal">查看個人結算</button><button type="button" data-act="map">查看路線圖</button></section>' :
      `${handMarkup(run, lane, slot, prepare)}${actionsMarkup(run, lane, slot, prepare)}`}
      </div>
    </div></main>
    <div class="trade-dock"><div class="dock-inner"><div class="dock-caption"><span>${eliminated ? '觀戰模式' : `第 ${run.day} 日`}${slot !== null && !eliminated ? ` · ${escapeHtml(run.player.hand[slot].name)}` : ''}</span>
      <strong>${preview ? escapeHtml(preview.kind.name) : eliminated ? '其餘席位繼續' : '先選投資'}</strong></div>
      <button type="button" class="gold-button" data-act="trade" ${!eliminated && (lane === null || (slot !== null && !preview?.enabledCard)) ? 'disabled' : ''}>
      ${eliminated ? '看下一個交易日' : run.day === run.config.gameplay.turns ? '確定下單・收盤' : '確定下單'} <span aria-hidden="true">→</span></button></div></div>`;
}
