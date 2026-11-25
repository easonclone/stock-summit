import type { FinancialConfig, GameCard } from '../config/financial-settings';
import { netWorth, returnRate } from '../core/economy';
import type { TradingRun, DayOutcome, Investor } from '../core/trading-run';
import { allocationOption } from '../core/trade-preview';
import { sellPrice, type BuyBlock } from '../core/shop';
import { marketTone, type ChainStep, type ItemBlock } from '../core/settlement';
import { dayBreakdown } from './breakdown';
import { cardBadge, rarityLabel } from './card-face';
import { attackOf } from '../core/attacks';
import type { Forecast } from '../core/trade-preview';
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
      <ol class="opening-steps" aria-label="怎麼玩"><li>今天買多少股票</li><li>要不要用道具</li><li>開始交易</li></ol>
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
  if (outcome.ledger.shielded) return 'shield';
  if (outcome.attackedBy.length && outcome.close < outcome.start) return 'hit';
  if (outcome.close > outcome.start) return 'gain';
  if (outcome.close < outcome.start) return 'loss';
  return choosing && investor === run.player ? 'think' : 'idle';
}

const moodText: Record<Mood, string> = {
  idle: '', think: '想一下…', gain: '賺啦！', loss: '唉…', shield: '護盾擋住！', hit: '被打中了！',
  call: '', broke: '歸零了…', recover: '重新出發！', win: '我是股神！'
};

function arenaMarkup(run: TradingRun, choosing: boolean, animate: boolean, preview: Forecast | null) {
  const latest = run.reports.at(-1);
  const standings = run.standings();
  const news = run.latestNews;
  const tone = news ? marketTone(news.event, run.config) : 'neutral';
  const fresh = Boolean(news && latest?.market && news.day === latest.day);
  const next = run.nextEventDay;
  const capital = run.config.financial.initialCapital;
  const maxWorth = Math.max(capital, ...run.investors.map(investor => netWorth(investor.account)), ...(latest?.outcomes.map(outcome => outcome.start) ?? []));
  const step = capital / 2;
  const scale = step * (1 + Math.floor(maxWorth / step));
  const fill = (value: number) => 100 * Math.max(0, value) / scale;
  const fighters = run.investors.map(investor => {
    const outcome = latest?.outcomes.find(item => item.investor === investor);
    const standing = standings.find(item => item.investor === investor)!;
    const before = investor.ranks.at(-2);
    const climb = before && standing.rank ? before - standing.rank : 0;
    const mood = moodOf(run, investor, outcome, choosing);
    const delta = outcome ? outcome.close - outcome.start : 0;
    const isPlayer = investor === run.player;
    const value = netWorth(investor.account);
    const id = investor.character.id;
    const selectable = preview?.targets.find(target => target.id === id);
    const selected = preview?.attack?.target.id === id;
    const sent = latest?.attacks.find(hit => hit.from === id);
    const received = latest?.attacks.find(hit => hit.to === id);
    const strike = received && received.kind !== 'shield_break' ? received.amount - (received.kind === 'cash_raid' ? received.reflected : 0) : 0;
    const rebound = sent?.reflected ?? 0;
    const bubble = moodText[mood] && (animate || mood === 'think' || mood === 'win' || mood === 'broke') ? moodText[mood] : '';
    return `<article class="fighter mood-${mood} ${isPlayer ? 'is-player' : ''} ${animate && climb > 0 ? 'rank-up' : ''} ${selectable ? 'can-target' : ''} ${selected ? 'is-target' : ''} ${animate && sent ? 'striking' : ''} ${animate && (received || rebound) ? 'struck' : ''} ${animate && received?.reflected ? 'reflecting' : ''}" style="--ink:${investor.character.color}"
      aria-label="${escapeHtml(investor.character.name)}，${standing.rank ? `第 ${standing.rank} 名` : '出局'}，總身家 ${money(value)}">
      ${bubble ? `<span class="bubble">${bubble}</span>` : ''}
      ${animate && delta ? `<span class="float ${direction(delta)}">${signedMoney(delta)}</span>` : ''}
      ${animate && (received || rebound) ? `<span class="strike-flash">✦ ${received?.kind === 'shield_break' ? '破盾' : [strike ? money(-strike) : '', rebound ? '反擊 ' + money(-rebound) : ''].filter(Boolean).join(' · ')}</span>` : ''}
      ${animate && outcome?.ledger.shielded ? `<span class="shield-pop">◆ 擋下 ${money(outcome.ledger.shielded)}</span>` : ''}
      <canvas class="sprite" width="48" height="54" data-sprite="${investor.character.id}" data-mood="${mood}" aria-hidden="true"></canvas>

      <div class="plate"><b class="rank">${standing.rank === 1 ? '♛ ' : ''}${standing.rank ? `#${standing.rank}` : '出局'}${climb ? `<small class="${direction(climb)}">${arrow(climb)}</small>` : ''}</b>
        <strong>${escapeHtml(investor.character.name)}${isPlayer ? '<em>你</em>' : ''}</strong>
        <span class="worth">${money(value)}</span>
        <span class="wealth-track ${animate ? 'wealth-moving' : ''}" aria-hidden="true" style="--start:${fill(outcome?.start ?? value)}%;--end:${fill(value)}%;--capital:${fill(capital)}%"><i></i><b></b><small></small></span>
        ${investor.defenses.length || investor.memory.mirror !== null ? `<small class="fighter-status" aria-label="護盾 ${investor.defenses.length}，${investor.memory.mirror === null ? '' : '反擊鏡待命'}">${investor.defenses.length ? '🛡' + investor.defenses.length : ''}${investor.memory.mirror !== null ? ' ◈' : ''}</small>` : ''}</div>
      ${selectable ? `<button type="button" class="target-seat" data-act="target" data-value="${id}" aria-pressed="${Boolean(selected)}" aria-label="指定 ${escapeHtml(investor.character.name)}，現金 ${money(selectable.cash)}，股票 ${money(selectable.stock)}，護盾 ${selectable.shields}"><span aria-hidden="true">⌖</span></button>` : ''}
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

/** Cash and stock as one two-colour bar; widths are the real shares of total worth. */
export function moneyBar(cash: number, stock: number, label = '') {
  const total = Math.max(1, cash + stock);
  const share = Math.round(stock / total * 100);
  return `<div class="money-bar" role="img" aria-label="${label}現金 ${money(cash)}，股票 ${money(stock)}">
    <span class="bar-cash" style="width:${100 - share}%"></span><span class="bar-stock" style="width:${share}%"></span></div>`;
}

function chipsMarkup(run: TradingRun) {
  const chips: string[] = [];
  const chip = (tone: string, text: string) => chips.push(`<li class="chip ${tone}">${text}</li>`);
  for (const defense of run.player.defenses) chip('ice', `◆ ${escapeHtml(defense.name)}待命`);
  const intel = run.intelFor(run.player);
  if (intel) chip('gold', `第 ${intel.day} 日新聞：${intel.tone === 'positive' ? '利多' : intel.tone === 'negative' ? '利空' : '特殊事件'}`);
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
      <div><span>現金</span><strong class="cash-ink">${money(account.cash)}</strong></div>
      <div><span>股票</span><strong class="stock-ink">${money(account.investmentValue)}</strong></div></div>
    ${moneyBar(account.cash, account.investmentValue, '目前')}
    ${chipsMarkup(run)}
    <div class="hero-tools"><button type="button" data-act="chart">走勢</button></div>
  </section>`;
}

const stepIcon: Record<ChainStep['source'], string> = {
  market: '📈', news: '📰', joker: '★', item: '◆', defense: '🛡', attack: '🎯', event: '🎁', cap: '⛔'
};

function stepLabel(step: ChainStep) {
  const value = step.value === undefined ? '' : step.kind === 'mult' ? ` ×${step.value}` : step.kind === 'add' ? ` +${percent(step.value)}`
    : step.kind === 'cap' ? ` ${step.value} 倍` : '';
  const verb = step.kind === 'cut' ? '少賠' : '';
  return `${escapeHtml(step.name)}${verb ? ` ${verb}` : ''}${value}`;
}

/** The player's latest day as the actual settlement chain: base stock result, then each joker and item in order. */
function resultMarkup(run: TradingRun, animate: boolean) {
  const last = run.reports.at(-1);
  const outcome = last?.outcomes.find(item => item.investor === run.player);
  if (!last || !outcome) return '';
  const view = dayBreakdown(outcome);
  const before = run.player.ranks.at(-2);
  const after = run.player.ranks.at(-1);
  const crisis = outcome.risk.insolvent;
  const restart = view.lines.find(line => line.key === 'restart');
  const notes = [
    outcome.item ? `用了「${escapeHtml(outcome.item.name)}」` : '',
    outcome.attackBlocked ? '攻擊沒打中，道具留下了' : '',
    ...last.attacks.filter(hit => hit.from === run.player.character.id).map(hit => {
      const target = run.investors.find(investor => investor.character.id === hit.to)!;
      return `打中 ${escapeHtml(target.character.name)} ${hit.kind === 'shield_break' ? '（破盾）' : money(-hit.amount)}${hit.reflected ? ' · 遭到反擊 ' + money(hit.reflected) : ''}`;
    }),
    outcome.received.length ? `拿到 ${outcome.received.map(card => `「${escapeHtml(card.name)}」`).join('')}` : '',
    view.chain.length ? '' : '今天沒有股票，也沒有王牌發動'
  ].filter(Boolean);
  return `<section class="day-result ${crisis ? 'crisis' : ''} ${animate ? 'result-animate' : ''}" aria-label="第 ${last.day} 日結算">
    <header><span>第 ${last.day} 日 · ${escapeHtml(allocationOption(run.config, outcome.allocation).name)}</span>
      <strong class="${direction(view.net)}">${arrow(view.net)} ${signedMoney(view.net)}</strong>
      ${before && after && before !== after ? `<b class="rank-change ${direction(before - after)}">#${before} → #${after}</b>` : ''}
      ${view.combos >= 2 ? `<b class="combo-tag">連招 ×${view.combos}</b>` : ''}</header>
    ${view.chain.length || restart ? `<ol class="chain">${view.chain.map((step, index) => `<li class="src-${step.source} kind-${step.kind}" style="--i:${index}">
      <span aria-hidden="true">${stepIcon[step.source]}</span><span>${stepLabel(step)}</span><b class="${direction(step.amount)}">${signedMoney(step.amount)}</b></li>`).join('')}
      ${restart ? `<li class="src-restart"><span aria-hidden="true">↺</span><span>${restart.label}</span><b class="${direction(restart.amount)}">${signedMoney(restart.amount)}</b></li>` : ''}</ol>` : ''}
    ${notes.length ? `<p>${notes.join(' · ')}</p>` : ''}
    ${crisis ? '<button type="button" class="text-button" data-act="crisis">看歸零明細</button>' : ''}
  </section>`;
}

export const itemBlockCopy: Record<ItemBlock, string> = {
  no_stock: '今天沒有股票，用了不會多賺', full_defense: '護盾已經放滿兩個', no_news: '後面沒有新聞了',
  known_news: '已經知道下一則新聞', no_target: '目前沒有符合條件的對手', mirror_ready: '已經有一面反擊鏡在等了', not_low: '身家要低於 $5,000 才能用',
  used: '這局已經用過', last_day: '最後一天用了也來不及'
};

/** A joker or item face: name, pixel art, one sentence, rarity. Details open in a dialog. */
export function cardMarkup(config: FinancialConfig, card: GameCard, kind: 'joker' | 'item', attrs = '', status = '') {
  const effect = card.effectIds.map(id => config.effects[id]);
  const role = attackOf(config, card) ? ' card-attack' : effect.some(item => item.type === 'defense' || item.type === 'mirror') ? ' card-defense' : '';
  return `<span class="game-card ${kind}${role} rarity-${card.rarity}" style="--ink:${card.color}" ${attrs}>
    <span class="card-top">${iconMarkup(card.icon, card.color)}<b class="card-value">${escapeHtml(cardBadge(config, card))}</b></span>
    <strong>${escapeHtml(card.name)}</strong><span class="card-line">${escapeHtml(card.line)}</span>
    ${status ? `<span class="card-status">${status}</span>` : ''}</span>`;
}

/** Jokers whose effect fired in the player's latest settlement, to light them up. */
function firedJokers(run: TradingRun) {
  const outcome = run.reports.at(-1)?.outcomes.find(item => item.investor === run.player);
  return new Set(outcome?.ledger.steps.filter(step => step.source === 'joker').map(step => step.id) ?? []);
}

function jokerMarkup(run: TradingRun, animate: boolean) {
  const { jokerSlots } = run.config.gameplay;
  const fired = animate ? firedJokers(run) : new Set<string>();
  const cards = run.player.jokers.map((joker, index) => `<button type="button" class="card-button ${fired.has(joker.id) ? 'fired' : ''}" data-act="card-detail" data-kind="joker" data-value="${index}"
      style="--i:${index}" aria-label="王牌 ${escapeHtml(joker.name)}：${escapeHtml(joker.line)}">${cardMarkup(run.config, joker, 'joker')}</button>`);
  const empty = Array.from({ length: jokerSlots - cards.length }, () => '<span class="card-slot joker" aria-hidden="true">王牌</span>');
  return `<section class="joker-section" aria-label="我的王牌">
    <div class="section-head"><h2>我的王牌</h2><span>${run.player.jokers.length} / ${jokerSlots} · 每天自動發動</span></div>
    <div class="joker-row">${[...cards, ...empty].join('')}</div></section>`;
}

function itemMarkup(run: TradingRun, allocation: string, slot: number | null) {
  const { itemSlots } = run.config.gameplay;
  const cards = run.player.items.map((item, index) => {
    const forecast = run.preview(allocation, index);
    const block = forecast?.itemBlock ?? null;
    const status = block ? itemBlockCopy[block] : forecast?.targets.length ? '選對手' : slot === index ? '今天使用' : '可以用';
    return `<button type="button" class="card-button ${block ? 'blocked' : ''}" data-act="item" data-value="${index}" data-card-id="${item.id}" aria-pressed="${slot === index}"
      aria-label="道具 ${escapeHtml(item.name)}：${escapeHtml(item.line)}，${status}">${cardMarkup(run.config, item, 'item', '', escapeHtml(status))}</button>`;
  });
  const empty = Array.from({ length: itemSlots - cards.length }, () => '<span class="card-slot item" aria-hidden="true">道具</span>');
  const selected = slot === null ? null : run.player.items[slot];
  return `<section class="item-section" aria-label="今天要不要用道具？">
    <div class="section-head"><h2>② 要不要用道具？</h2><span>最多 1 張 · 可以不用</span></div>
    ${morningItemMarkup(run)}
    <div class="item-row" style="--item-slots:${itemSlots}">${[...cards, ...empty].join('')}</div>
    ${selected ? `<p class="item-note" data-item-status aria-live="polite"><strong>${escapeHtml(selected.name)}</strong>${selectedNote(run, allocation, slot!)}
      <button type="button" class="text-button" data-act="card-detail" data-kind="item" data-value="${slot}">完整說明</button></p>` : ''}
  </section>`;
}

function morningItemMarkup(run: TradingRun) {
  const card = run.playerOpeningItem;
  if (!card) return '';
  const full = run.offer?.source === 'daily';
  return `<div class="morning-item" data-morning-item>
    <p><strong>今日抽到 ${escapeHtml(card.name)}</strong> · ${escapeHtml(card.line)}</p>
    ${full ? `<details open><summary>道具已滿，選一張換掉，或放棄新道具</summary><div class="morning-choices">
      ${run.player.items.map((owned, index) => `<button type="button" data-act="daily-replace" data-value="${index}" aria-label="換掉第 ${index + 1} 張：${escapeHtml(owned.name)}">換掉 ${escapeHtml(owned.name)}</button>`).join('')}
      <button type="button" data-act="daily-decline">放棄新道具</button></div></details>` : ''}
  </div>`;
}

/** What the selected item does today, from the same preview the confirmation uses. */
function selectedNote(run: TradingRun, allocation: string, slot: number) {
  const forecast = run.preview(allocation, slot);
  const item = run.player.items[slot];
  if (!forecast || forecast.itemBlock) return `：今天用不了，${itemBlockCopy[forecast?.itemBlock ?? 'used']}。`;
  if (forecast.itemCash) return `：今天用，馬上拿到 ${money(forecast.itemCash)}。`;
  if (forecast.targets.length) return '：點上方角色選對手。';
  return `：${escapeHtml(item.line)}`;
}

/** Full rules for one joker or item. */
export function cardDetailMarkup(run: TradingRun, card: GameCard, kind: 'joker' | 'item') {
  const total = kind === 'joker' ? run.player.stats.jokerGain[card.id] : undefined;
  return `<div class="card-detail">${cardMarkup(run.config, card, kind)}
    <p>${escapeHtml(card.line)}</p><p>${escapeHtml(card.detail)}</p>
    <p class="muted">${kind === 'joker' ? '王牌 · 每天自動發動' : '道具 · 用一次就沒了'} · ${rarityLabel[card.rarity]}</p>
    ${total ? `<p class="gold">本局已經幫你 ${signedMoney(total)}。</p>` : ''}</div>`;
}

/** Step 1: three stock ratios with the real cash/stock split and an estimate from the same settlement engine. */
function allocationMarkup(run: TradingRun, allocation: string, slot: number | null) {
  const worth = netWorth(run.player.account);
  const buttons = run.config.allocation.options.map(option => {
    const stock = Math.floor(Math.max(0, worth) * option.ratio);
    return `<button type="button" class="alloc-button" data-act="alloc" data-value="${option.id}" aria-pressed="${option.id === allocation}">
      <strong>${escapeHtml(option.name)}</strong><small>${percent(option.ratio)} 股票</small>${moneyBar(worth - stock, stock, `${option.name}：`)}</button>`;
  }).join('');
  const preview = run.preview(allocation, slot);
  const chosen = allocationOption(run.config, allocation);
  const gain = Math.max(0, preview?.high ?? 0);
  const loss = Math.min(0, preview?.low ?? 0);
  return `<section class="alloc-section" aria-label="今天買多少股票？">
    <div class="section-head"><h2>① 今天買多少股票？</h2><span>${allocation === run.player.allocation ? '沿用昨天' : '已改變'}</span></div>
    <div class="alloc-row">${buttons}</div>
    ${preview ? `<div class="preview" aria-live="polite">
      <p>現金 <b class="cash-ink">${money(preview.cash)}</b> · 股票 <b class="stock-ink">${money(preview.stock)}</b></p>
      <p>${escapeHtml(chosen.detail)}${gain || loss ? ` 今天大約 ${gain ? `<b class="gain">+${money(gain)}</b>` : ''}${gain && loss ? ' ～ ' : ''}${loss ? `<b class="loss">−${money(-loss)}</b>` : ''}（估計，含王牌）` : ''}</p>
      ${run.eventToday() ? `<p class="preview-warning">▲ 今天有新聞${preview.ledger && run.intelFor(run.player)?.day === run.day ? '，你已經知道方向' : '，可能大漲也可能大跌'}</p>` : ''}
    </div>` : ''}
  </section>`;
}

export function chartDialogMarkup(run: TradingRun) {
  return performanceChart(run);
}

/** The latest news and what it did to the player (from the settlement record), plus any private intel. */
export function newsMarkup(run: TradingRun) {
  const current = run.latestNews;
  const intel = run.intelFor(run.player);
  const report = current ? run.reports.find(item => item.day === current.day) : null;
  const outcome = report?.outcomes.find(item => item.investor === run.player);
  const tone = current ? marketTone(current.event, run.config) : 'neutral';
  const impact = !outcome ? '' : !outcome.marketApplied ? '這則新聞沒有影響你。' :
    tone === 'neutral' ? '這是特殊事件，股價沒有變動。' :
    outcome.marketPnl ? `新聞讓你的股票${outcome.marketPnl > 0 ? '多了' : '少了'} ${money(Math.abs(outcome.marketPnl))}（王牌和護盾另計）。` : '你當天沒有股票，新聞沒有影響你的錢。';
  return `<div class="news-detail ${tone}">
    ${current ? `<p class="news-kicker">第 ${current.day} 日 · 虛構新聞 · ${tone === 'neutral' ? '特殊事件' : run.config.market[tone].name}</p><h3>${escapeHtml(current.event.title)}</h3>
      <p>${escapeHtml(current.event.subtitle)}</p>
      ${impact ? `<p data-market-impact class="gold">${impact}</p>` : ''}
      <p>${escapeHtml(current.event.description)}</p>` : '<p>還沒有市場新聞。</p>'}
    <p>${run.nextEventDay === null ? '本局新聞已全部公布。' : `下一則新聞在第 ${run.nextEventDay} 日。`}</p>
    ${intel ? `<p class="intel">◆ 小道消息：第 ${intel.day} 日的新聞是${intel.tone === 'positive' ? '利多' : intel.tone === 'negative' ? '利空' : '特殊事件'}。漲跌多少還不知道。</p>` : ''}
  </div>`;
}

const offerTitle: Record<string, string> = {
  opening: '開局選一張王牌', stage: '選一張王牌', pack: '神秘卡包・三選一', daily: '今日免費道具', news: '消息靈通・拿到一張道具', event: '拿到一張道具'
};

export function offerHeading(run: TradingRun) {
  return offerTitle[run.offer?.source ?? 'event'];
}

export function offerMarkup(run: TradingRun, offered: number | null, replace: number | null) {
  const offer = run.offer!;
  const owned = offer.kind === 'joker' ? run.player.jokers : run.player.items;
  const capacity = offer.kind === 'joker' ? run.config.gameplay.jokerSlots : run.config.gameplay.itemSlots;
  const full = owned.length >= capacity;
  const intro = offer.kind === 'joker'
    ? offer.source === 'opening' ? '王牌會一直留著，每天自動幫你。先挑一張！' : '王牌每天自動發動。'
    : offer.cards.length > 1 ? '選一張道具帶走。' : '';
  return `<p>${intro}${full ? `${offer.kind === 'joker' ? '王牌' : '道具'}已滿，選一張要換掉的。` : ''}</p>
    <div class="offer-grid">${offer.cards.map((card, index) => `<button type="button" class="card-button offer-card" data-act="offer-card" data-value="${index}" aria-pressed="${offered === index}"
      aria-label="${escapeHtml(card.name)}：${escapeHtml(card.line)}">${cardMarkup(run.config, card, offer.kind)}</button>`).join('')}</div>
    ${full ? `<div class="replace-list" aria-label="要換掉的${offer.kind === 'joker' ? '王牌' : '道具'}">${owned.map((card, index) =>
      `<button type="button" data-act="replace" data-value="${index}" aria-pressed="${replace === index}">換掉 ${escapeHtml(card.name)}</button>`).join('')}</div>` : ''}
    <div class="dialog-actions"><button type="button" data-act="decline">${offer.source === 'opening' ? '先不要' : '不要了'}</button>
      <button type="button" class="gold-button" data-act="take" ${offered === null || (full && replace === null) ? 'disabled' : ''}>${offer.kind === 'joker' ? '拿這張王牌' : '拿這張道具'}</button></div>`;
}

const shopBlockCopy: Record<BuyBlock, string> = { sold: '已買下', owned: '已經有了', cash: '現金不夠', full: '先選要換掉哪張' };

/**
 * The stage shop: three jokers and two items with real prices for this buyer. Only cash pays; buying lowers total
 * worth by the price, and owned cards never count toward it. Every number comes from the run's shop rules.
 */
export function shopMarkup(run: TradingRun, picked: number | null, replace: number | null, first: boolean) {
  const shop = run.shop!;
  const { cash } = run.player.account;
  const { jokerSlots, itemSlots } = run.config.gameplay;
  const shelves = shop.slots.map((slot, index) => {
    const check = run.shopCheck(index);
    const tag = check.block === 'sold' ? '已買下' : check.block === 'owned' ? '已經有了' : check.block === 'cash' ? `差 ${money(check.shortfall)}` : check.needsReplace ? '要換掉一張' : '買得起';
    const discounted = check.price < slot.base;
    return `<button type="button" class="card-button shop-card ${check.block === 'sold' ? 'sold' : ''} ${check.block === 'cash' ? 'short' : ''}" data-act="shop-card" data-value="${index}"
      aria-pressed="${picked === index}" aria-label="${slot.kind === 'joker' ? '王牌' : '道具'} ${escapeHtml(slot.card.name)}，${money(check.price)}，${tag}：${escapeHtml(slot.card.line)}">
      ${cardMarkup(run.config, slot.card, slot.kind)}
      <span class="price-tag">${discounted ? `<s>${money(slot.base)}</s> ` : ''}<b>${money(check.price)}</b></span>
      <span class="shop-status">${tag}</span></button>`;
  });
  const slot = picked === null ? null : shop.slots[picked];
  const check = picked === null ? null : run.shopCheck(picked, replace);
  const owned = slot?.kind === 'joker' ? run.player.jokers : run.player.items;
  const replaceList = slot && check?.needsReplace && (check.block === null || check.block === 'full') ? `<div class="replace-list" aria-label="要換掉的${slot.kind === 'joker' ? '王牌' : '道具'}">${owned.map((card, index) =>
    `<button type="button" data-act="shop-replace" data-value="${index}" aria-pressed="${replace === index}">換掉 ${escapeHtml(card.name)}${slot.kind === 'joker' ? ` <small>回收 +${money(sellPrice(run.config, card))}</small>` : ''}</button>`).join('')}</div>` : '';
  const note = slot && check ? `<p class="shop-note" aria-live="polite"><strong>${escapeHtml(slot.card.name)}</strong>：${escapeHtml(slot.card.line)}${escapeHtml(slot.card.detail)}
    ${check.block ? `<span class="shop-warning">${check.block === 'cash' ? `現金還差 ${money(check.shortfall)}。股票不能拿來付，下次商店日前可以多留點現金。` : shopBlockCopy[check.block]}</span>` : ''}</p>` : '';
  return `<div class="shop" data-shop-day="${shop.day}">
    <p class="shop-wallet">現金 <b class="cash-ink" data-shop-cash>${money(cash)}</b> · 王牌 ${run.player.jokers.length} / ${jokerSlots} · 道具 ${run.player.items.length} / ${itemSlots}</p>
    ${first ? '<p class="coach-tip shop-tip">只能用現金買。買了總身家會少掉售價，王牌本身不算錢，但之後每天都會幫你賺。</p>' : ''}
    <div class="shop-grid">${shelves.join('')}</div>
    ${note}${replaceList}
    <div class="dialog-actions"><button type="button" data-act="leave-shop">離開商店</button>
      <button type="button" class="gold-button" data-act="buy" ${!check || check.block ? 'disabled' : ''}>${check && slot ? `用 ${money(check.price)} 買下` : '先選一張'}</button></div>
  </div>`;
}

export interface TerminalSelection {
  allocation: string | null; item: number | null; targetId?: string; animate: boolean
}

export function tradingMarkup(run: TradingRun, ui: TerminalSelection, coach: string) {
  const { item, animate } = ui;
  const allocation = ui.allocation ?? run.player.allocation;
  const eliminated = run.player.account.eliminated;
  const preview = eliminated ? null : run.preview(allocation, item, ui.targetId);
  const choosing = ui.allocation !== null || item !== null;
  const target = preview?.attack;
  const targetHint = preview?.targets.length ? `<p class="target-hint" data-target-hint aria-live="polite">⌖ ${target ?
    escapeHtml(target.target.name) + (target.kind === 'shield_break' ? ' · 預計打掉 1 個護盾' : ' · 依目前' + (target.kind === 'cash_raid' ? '現金' : '股票') + '估計 ' + money(target.amount)) + '。點同一人可取消。' : '點競技場上的對手選擇目標。'}</p>` : '';
  const shop = run.nextShopDay;
  const shopNotice = shop === null ? '本局商店已結束' : shop !== run.day ? `下次商店：第 ${shop} 日收盤後`
    : `${run.eventToday() ? '今天有市場新聞 · ' : ''}收盤後商店開門`;
  return `<main class="trading" id="market" aria-label="交易畫面">
    <div class="play-layout">
      <div class="stage-column">${arenaMarkup(run, choosing, animate, preview)}${heroMarkup(run)}${resultMarkup(run, animate)}</div>
      <div class="decision-column"><p class="shop-notice" data-shop-notice>${shopNotice}</p>${coach}
        ${eliminated ? '<section class="panel spectator"><h2>本席已出局</h2><p>其他投資人會繼續結算。</p><button type="button" data-act="personal">查看個人結算</button></section>' :
      `${allocationMarkup(run, allocation, item)}${jokerMarkup(run, animate)}${itemMarkup(run, allocation, item)}${targetHint}`}
      </div>
    </div></main>
    <div class="trade-dock"><div class="dock-inner"><div class="dock-caption"><span>${eliminated ? '觀戰模式' : `第 ${run.day} / ${run.config.gameplay.turns} 日`}${item !== null && !eliminated ? ` · ${escapeHtml(run.player.items[item].name)}` : ''}</span>
      <strong>${eliminated ? '其餘席位繼續' : target ? '⌖ ' + escapeHtml(target.target.name) : preview?.targets.length ? '請先選對手' : escapeHtml(allocationOption(run.config, allocation).name)}</strong></div>
      <button type="button" class="gold-button" data-act="trade" ${run.offer?.source === 'daily' || (!eliminated && item !== null && (preview?.itemBlock || (preview?.targets.length && !target))) ? 'disabled' : ''}>
      ${eliminated ? '看下一個交易日' : run.day === run.config.gameplay.turns ? '開始交易・收盤' : '開始交易'} <span aria-hidden="true">→</span></button></div></div>`;
}
