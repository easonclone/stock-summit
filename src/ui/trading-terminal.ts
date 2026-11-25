import { cardStyles, holderStyle, styleNames } from '../core/npc-strategy';
import { iconMarkup } from './pixels';
import type { FinancialConfig, GameCard } from '../config/financial-settings';
import { netWorth, returnRate } from '../core/economy';
import type { TradingRun, DayOutcome, Investor } from '../core/trading-run';
import { allocationOption } from '../core/trade-preview';
import { sellPrice, type BuyBlock } from '../core/shop';
import { marketTone, type ChainStep, type ItemBlock } from '../core/settlement';
import { dayBreakdown } from './breakdown';
import { worthRange } from './fx-events';
import { cardDescription } from './card-copy';
import { timelineMarkup } from './timeline';
import { rarityLabel } from './card-face';
import { sacrificeCost, sacrificeRefund } from '../core/sacrifice';
import { eventFamilyNames, eventRuleCopy } from './event-copy';
import { newsArt, newsCategories, newsImpact } from './theater';
import { isAreaAttack, attackOf } from '../core/attacks';
import { itemTiming } from '../core/item-timing';
import type { ActionChoice, Forecast } from '../core/trade-preview';
import { arrow, direction, escapeHtml, money, percent, signedMoney, signedPercent } from './format';
import { performanceChart } from './performance-chart';

export const financialLabels = { normal: '交易正常', bankruptcy: '身家歸零' };

export function openingMarkup(config: FinancialConfig, chosen: string, difficulty: string) {
  const featured = config.characters.find(character => character.id === chosen) ?? config.characters[0];
  return `<section class="opening">
    <div class="opening-hero">
      <p class="opening-label"><i aria-hidden="true"></i> 還沒開盤</p>
      <div class="opening-title"><h1>股市攻頂戰</h1><p>Pixel Stock Arena</p></div>
    </div>
    <section class="open-board panel"><h2>選一位角色出賽</h2>
    <div class="investor-feature" style="--ink:${featured.color}">
      <canvas class="sprite" width="72" height="96" data-sprite="${featured.id}" aria-hidden="true"></canvas>
      <div><strong>${escapeHtml(featured.name)}</strong><p>${escapeHtml(featured.description)}</p></div>
    </div><div class="seats opening-seats">
    ${config.characters.map(character => `<button type="button" class="seat" data-act="character" aria-label="${escapeHtml(character.name)}，${escapeHtml(character.description)}" title="${escapeHtml(character.description)}" data-value="${character.id}" aria-pressed="${character.id === chosen}" style="--ink:${character.color}">
      <canvas class="portrait" width="64" height="64" data-portrait="${character.id}" aria-hidden="true"></canvas>
      <strong>${escapeHtml(character.name)}</strong>
    </button>`).join('')}</div>
    <div class="opening-settings"><label>電腦難度<select data-input="difficulty">
      ${[['easy', '入門'], ['normal', '標準'], ['hard', '高手']].map(([value, label]) => `<option value="${value}" ${value === difficulty ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label></div>
    <button type="button" class="gold-button" data-act="start">開盤啦 <span aria-hidden="true">→</span></button>
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
  const openingEvent = run.publicEvent;
  const news = openingEvent ? { day: run.day, event: openingEvent } : run.latestNews;
  const report = news ? run.reports.find(entry => entry.day === news.day) : undefined;
  const impact = openingEvent ? eventRuleCopy(run.config, openingEvent) : report ? newsImpact(report, run.player, run.config) : news?.event.subtitle;
  const tone = news ? marketTone(news.event, run.config) : 'neutral';
  const fresh = Boolean(news && latest?.market && news.day === latest.day);
  const next = run.nextEventDay;
  const capital = run.config.financial.initialCapital;
  // One shared scale for the whole show: includes every running total of the day, so bars never rescale mid-animation.
  const maxWorth = Math.max(capital, ...run.investors.map(investor => netWorth(investor.account)),
    ...(latest?.outcomes.map(outcome => worthRange(outcome).peak) ?? []));
  const step = capital / 2;
  const scale = step * (1 + Math.floor(maxWorth / step));
  const fill = (value: number) => 100 * Math.max(0, value) / scale;
  const fighters = [...run.investors.filter(investor => investor !== run.player), run.player].map(investor => {
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
    const bubble = moodText[mood] && (animate || mood === 'think' || mood === 'win' || mood === 'broke') ? moodText[mood] : '';
    // Hit numbers, flashes and the bar movement are played by ArenaFx from the settled records; the markup only
    // starts the bar at the open when that show is about to run.
    const shown = animate && outcome ? outcome.start : value;
    return `<article class="fighter mood-${mood} ${isPlayer ? 'is-player' : ''} ${animate && climb > 0 ? 'rank-up' : ''} ${selectable ? 'can-target' : ''} ${selected ? 'is-target' : ''}" style="--ink:${investor.character.color}"
      data-fighter="${id}" aria-label="${escapeHtml(investor.character.name)}，${standing.rank ? `第 ${standing.rank} 名` : '出局'}，總身家 ${money(value)}${outcome && delta ? `，今天 ${signedMoney(delta)}` : ''}">
      ${bubble ? `<span class="bubble">${bubble}</span>` : ''}
      <canvas class="sprite" width="72" height="96" data-sprite="${investor.character.id}" data-mood="${mood}" aria-hidden="true"></canvas>
      <canvas class="portrait arena-portrait" width="64" height="64" data-portrait="${id}" aria-hidden="true"></canvas>

      <div class="plate"><b class="rank">${standing.rank === 1 ? iconMarkup('crown', '#f4c56d') : ''}${standing.rank ? `#${standing.rank}` : '出局'}${climb ? `<small class="${direction(climb)}">${arrow(climb)}</small>` : ''}</b>
        <strong>${escapeHtml(investor.character.name)}${isPlayer ? '<em>你</em>' : ''}</strong>
        <span class="worth">${money(shown)}</span>
        <span class="wealth-track" aria-hidden="true" data-start="${shown}" style="--now:${fill(shown)}%;--lag:${fill(shown)}%;--capital:${fill(capital)}%"><i></i><b></b><small></small></span>
        ${investor.defenses.length || investor.memory.mirror !== null ? `<small class="fighter-status" aria-label="護盾 ${investor.defenses.length}，${investor.memory.mirror === null ? '' : '反擊鏡待命'}">${investor.defenses.length ? iconMarkup('shield', '#a5d4ff') + investor.defenses.length : ''}${investor.memory.mirror !== null ? iconMarkup('mirror', '#b3efff') : ''}</small>` : ''}</div>
      ${selectable ? `<button type="button" class="target-seat" data-act="target" data-value="${id}" aria-pressed="${Boolean(selected)}" aria-label="指定 ${isPlayer ? '自己（獻祭）' : escapeHtml(investor.character.name)}，現金 ${money(selectable.cash)}，股票 ${money(selectable.stock)}，護盾 ${selectable.shields}"><span>${isPlayer ? '自己' : iconMarkup('target', '#efca75')}</span></button>` : ''}
    </article>`;
  }).join('');
  return `<section class="arena tone-${tone} ${fresh ? `fresh-news sev-${news!.event.severity}` : ''} ${animate ? 'arena-animate' : ''}" aria-label="四人交易競技場">
    <div class="battle-head"><button type="button" class="ticker ${news ? 'ticker-illustrated' : ''}" data-act="news" aria-label="市場快訊：${news ? escapeHtml(news.event.title) : '尚無新聞'}，點開看詳情">
      ${news ? newsArt(news.event.category, news.event.family) : '<span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>'}
      <span class="ticker-text"><small>${openingEvent ? '今日規則' : fresh ? '快訊' : '市場'} · ${openingEvent?.family ? eventFamilyNames[openingEvent.family] : run.config.market[tone].name}</small>
        <strong>${news ? escapeHtml(news.event.title) : '交易所開盤，等待第一則新聞'}</strong>
        ${impact ? `<span class="ticker-impact">${escapeHtml(impact)}</span>` : ''}</span>
      <span class="ticker-next">${next === null ? '新聞已結束' : `下則 第 ${next} 日`}</span>
    </button>
    ${run.dailyShop && !run.player.account.eliminated ? `<button type="button" class="battle-shop-trigger" data-act="open-daily-shop" aria-haspopup="dialog">${iconMarkup('shop', '#efc579')}<span>今日商店</span></button>` : ''}
    </div><div class="stage" data-scale="${scale}">
      <div class="battle-market-board"><strong>大盤走勢</strong><canvas width="480" height="100" role="img"
        aria-label="${run.reports.length ? '已結算的共同大盤 K 棒' : '開盤，等待首日結算'}"
        data-market-rates="${run.reports.map(report => report.marketRate).join(',')}"
        data-market-news="${run.reports.map(report => report.market?.target === 'all' ? report.newsRate ?? 0 : 0).join(',')}"
        data-market-days="${run.config.gameplay.turns}"></canvas></div>${fighters}</div>
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
  const jokerIntel = run.jokerIntelFor(run.player);
  if (jokerIntel.category) chip('gold', '明日新聞 · ' + newsCategories[jokerIntel.category]);
  if (jokerIntel.tone) chip('gold', '今日新聞 · ' + run.config.market[jokerIntel.tone].name);
  if (intel) chip('gold', `第 ${intel.day} 日新聞：${intel.tone === 'positive' ? '利多' : intel.tone === 'negative' ? '利空' : '特殊事件'}`);
  return chips.length ? `<ul class="chips" aria-label="目前狀態">${chips.join('')}</ul>` : '';
}

function heroMarkup(run: TradingRun) {
  const { account } = run.player;
  const rate = returnRate(account);
  return `<section class="hero" aria-label="我的總身家">
    <div class="hero-main"><span>總身家</span><strong>${money(netWorth(account))}</strong>
      <b class="${direction(rate)}">${rate ? `${arrow(rate)} ` : ''}${signedPercent(rate)}</b></div>
    <div class="hero-side"><div><span>現金</span><strong class="cash-ink">${money(account.cash)}</strong></div>
      <div><span>股票</span><strong class="stock-ink">${money(account.investmentValue)}</strong></div></div>
  </section>`;
}

const stepIcon: Record<ChainStep['source'], string> = {
  shop: '🛒', market: '📈', news: '📰', joker: '★', item: '◆', defense: '🛡', attack: '🎯', sacrifice: '◆', event: '🎁', cap: '⛔'
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
    outcome.items.length ? '用了 ' + outcome.items.map(card => `「${escapeHtml(card.name)}」`).join('、') : '',
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
  used: '這局已經用過', last_day: '最後一天用了也來不及', play_limit: '今天出牌次數已用完',
  defense_today: '今天已經放過防禦', voucher_ready: '手上已有一張待用招待券',
  sacrifice_used: '今天已經獻祭過', sacrifice_funds: '身家不足以支付獻祭成本'
};

/** A joker or item face: name, pixel art, one sentence, rarity. Details open in a dialog. */
export function cardMarkup(config: FinancialConfig, card: GameCard, kind: 'joker' | 'item', attrs = '', status = '', showJokerType = false) {
  const effect = card.effectIds.map(id => config.effects[id]);
  const timing = kind === 'item' ? itemTiming(config, card) : null;
  const role = attackOf(config, card) ? ' card-attack' : effect.some(item => item.type === 'defense' || item.type === 'mirror') ? ' card-defense' : '';
  const sacrifice = timing && effect.some(entry => entry.type === 'sacrifice_attack' || entry.type === 'sacrifice_draw');
  const phase = sacrifice ? '獻祭' : timing === 'instant' ? '立即' : timing === 'defense' ? '防禦' : '行動';
  const phaseIcon = sacrifice ? 'fire' : timing === 'instant' ? 'bolt' : timing === 'defense' ? 'shield' : 'target';
  const phaseColor = sacrifice ? '#e895b7' : timing === 'instant' ? '#efca75' : timing === 'defense' ? '#a0caed' : '#e99b81';
  const mark = card.rarity === 'legendary' ? '✦' : card.rarity === 'rare' ? '◆' : '·';
  const { line } = cardDescription(config, card);
  return `<span class="game-card ${kind}${role} rarity-${card.rarity}${timing ? ' phase-' + timing : ''}${sacrifice ? ' phase-sacrifice' : ''}" style="--ink:${card.color}" ${attrs}>
    <span class="card-top"><canvas data-card-art="${card.icon}" data-card-design="${card.id}" data-color="${card.color}" width="${kind === 'joker' ? 128 : 64}" height="${kind === 'joker' ? 128 : 64}" aria-hidden="true"></canvas>
      <b class="rarity-mark" aria-label="${rarityLabel[card.rarity]}">${mark}</b></span>
    ${timing ? `<small class="item-phase">${iconMarkup(phaseIcon, phaseColor)}${phase}</small>` : showJokerType ? `<small class="item-phase shop-joker-type">${iconMarkup('crown', '#efca75')}王牌</small>` : ''}<strong>${escapeHtml(card.name)}</strong><span class="card-line">${escapeHtml(line)}</span>
    ${status ? `<span class="card-status">${status}</span>` : ''}</span>`;
}

/** Jokers whose effect fired in the player's latest settlement, to light them up. */
function firedJokers(run: TradingRun) {
  const outcome = run.reports.at(-1)?.outcomes.find(item => item.investor === run.player);
  const gains = new Map<string, { amount: number; order: number }>();
  for (const step of outcome?.ledger.steps ?? []) {
    if (step.source !== 'joker' || !step.amount) continue;
    const existing = gains.get(step.id);
    gains.set(step.id, { amount: (existing?.amount ?? 0) + step.amount, order: existing?.order ?? gains.size });
  }
  return gains;
}

/** Payouts come from the settlement chain. With motion, ArenaFx reveals them one by one; otherwise they show at once. */
function jokerMarkup(run: TradingRun, fresh: boolean, animate: boolean) {
  const { jokerSlots } = run.config.gameplay;
  const lean = holderStyle(run.player, run.config);
  const fired = fresh ? firedJokers(run) : new Map<string, { amount: number; order: number }>();
  const entries = run.player.jokers.map((joker, index) => {
    const payout = fired.get(joker.id);
    const charge = joker.effectIds.some(id => run.config.effects[id].type === 'stored_strike') ? '蓄力 +' + percent(run.player.memory.charge) : '';
    return `<button type="button" class="card-button passive-token ${payout ? 'fired' : ''}" data-act="card-detail" data-kind="joker" data-value="${index}"
      data-joker-id="${joker.id}" style="--ink:${joker.color}" aria-label="王牌 ${escapeHtml(joker.name)}${charge ? '，' + charge : ''}：${escapeHtml(cardDescription(run.config, joker).line)}">
      <canvas data-card-art="${joker.icon}" data-card-design="${joker.id}" data-color="${joker.color}" width="128" height="128" aria-hidden="true"></canvas>
      <span class="passive-label"><strong>${escapeHtml(joker.name)}</strong>${charge ? `<small>${charge}</small>` : ''}</span>
      ${payout ? `<span class="joker-payout ${direction(payout.amount)} ${animate ? 'fx-wait' : ''}">${signedMoney(payout.amount)}</span>` : ''}</button>`;
  });
  return `<section class="joker-section passive-rail" aria-label="常駐王牌">
    <div class="section-head"><h2>王牌</h2><span>${lean ? styleNames[lean] + ' · ' : ''}${run.player.jokers.length} / ${jokerSlots}</span></div>
    <div class="joker-row">${entries.join('')}</div></section>`;
}

function itemMarkup(run: TradingRun, allocation: string, ui: TerminalSelection) {
  const slot = ui.item;
  const actions = ui.actions ?? [];
  const cards = run.player.items.map((item, index) => {
    const timing = itemTiming(run.config, item);
    const forecast = timing === 'action' ? run.preview(allocation, index) : null;
    const block = timing === 'action' ? forecast?.itemBlock ?? null : run.openingBlock(index);
    const order = actions.findIndex(action => action.slot === index);
    const status = order >= 0 ? `已排 ${order + 1}` : block ? itemBlockCopy[block] : timing === 'action' && forecast?.targets.length ? '選對手' : '';
    return `<button type="button" class="card-button ${block ? 'blocked' : ''}" data-act="item" data-value="${index}" data-card-id="${item.id}" data-timing="${timing}" aria-pressed="${order >= 0 || ui.inspectItem === index}"
      aria-label="道具 ${escapeHtml(item.name)}：${escapeHtml(cardDescription(run.config, item).line)}${status ? '，' + escapeHtml(status) : ''}">${cardMarkup(run.config, item, 'item', '', escapeHtml(status))}</button>`;
  });
  const selected = slot === null ? null : run.player.items[slot];
  return `<section class="item-section battle-hand" aria-label="道具手牌">
    <div class="section-head"><h2>道具</h2><span>行動 ${actions.length} / ${run.actionLimit}</span></div>
    ${morningItemMarkup(run)}
    <div class="item-row" data-hand-day="${run.day}">${cards.join('')}</div>
    ${ui.feedback && !ui.feedback.startsWith('買下 ') ? `<p class="opening-feedback use-feedback" role="status">⚡ ${escapeHtml(ui.feedback)}</p>` : ''}
    ${openingItemDetails(run, ui.inspectItem)}
    ${actions.length ? `<div class="action-lineup" aria-label="行動順序">${actions.map((action, index) => {
      const card = run.player.items[action.slot];
      const target = run.investors.find(rival => rival.character.id === action.targetId);
      const direct = attackOf(run.config, card);
      const caption = `${index + 1}. ${escapeHtml(card.name)}${target ? ' → ' + (target === run.player ? '自己' : escapeHtml(target.character.name)) : ''}`;
      return direct && !isAreaAttack(direct) ? `<button type="button" data-act="focus-action" data-value="${action.slot}">${caption} ⌖</button>` : `<span>${caption}</span>`;
    }).join('')}${actions.length === 2 && actions.some(action => run.player.items[action.slot].effectIds.some(id => run.config.effects[id].type === 'strike_boost')) &&
      attackOf(run.config, run.player.items[actions[1].slot])?.type !== 'sacrifice_attack' && actions[1].targetId !== run.player.character.id &&
      attackOf(run.config, run.player.items[actions[1].slot]) ? '<b class="combo-tag">連招</b>' : ''}</div>` : ''}
    ${selected ? `<p class="item-note" data-item-status aria-live="polite"><strong>${escapeHtml(selected.name)}</strong>${selectedNote(run, allocation, slot!)}
      <button type="button" class="text-button" data-act="card-detail" data-kind="item" data-value="${slot}">完整說明</button></p>` : ''}
  </section>`;
}

function openingItemDetails(run: TradingRun, slot?: number) {
  if (slot === undefined) return '';
  const card = run.player.items[slot];
  if (!card) return '';
  const { line, detail } = cardDescription(run.config, card);
  const block = run.openingBlock(slot);
  const timing = itemTiming(run.config, card);
  const draw = card.effectIds.map(id => run.config.effects[id]).find(effect => effect.type === 'sacrifice_draw');
  const cost = draw ? sacrificeCost(run.player, run.day, draw, run.player.account.investmentValue, run.eventRules) : 0;
  const refund = sacrificeRefund(run.config, run.player, cost, run.eventRules);
  return `<section class="quick-detail" aria-label="${escapeHtml(card.name)}"><div><strong>${escapeHtml(card.name)}</strong><p>${escapeHtml(line)}</p>
    ${cost ? `<p>自己先扣 ${money(cost)}${refund ? '，返還 ' + money(refund) : ''}。</p>` : ''}${detail ? `<p class="muted">${escapeHtml(detail)}</p>` : ''}${block ? `<p class="blocked-copy">${escapeHtml(itemBlockCopy[block])}</p>` : ''}</div>
    <button type="button" class="gold-button ${timing === 'defense' ? 'deploy-button' : ''}" data-act="use-item" data-value="${slot}" data-card-id="${card.id}" ${block ? 'disabled' : ''}>${timing === 'defense' ? '◆ 部署' : '⚡ 立即使用'}</button></section>`;
}

function morningItemMarkup(run: TradingRun) {
  const card = run.playerOpeningItem;
  if (!card) return '';
  const full = run.offer?.source === 'daily';
  return `<div class="morning-item" data-morning-item>
    <p><strong>今日抽到 ${escapeHtml(card.name)}</strong></p>
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
  return `：${escapeHtml(cardDescription(run.config, item).line)}`;
}

/** Full rules for one joker or item. */
export function cardDetailMarkup(run: TradingRun, card: GameCard, kind: 'joker' | 'item') {
  const total = kind === 'joker' ? run.player.stats.jokerGain[card.id] : undefined;
  const { detail } = cardDescription(run.config, card);
  const styles = kind === 'joker' ? [...cardStyles(card, run.config)].map(style => styleNames[style]) : [];
  return `<div class="card-detail">${cardMarkup(run.config, card, kind)}
    ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
    <p class="muted">${kind === 'joker' ? '王牌 · 每天自動發動' : '道具 · 用一次就沒了'} · ${rarityLabel[card.rarity]}${styles.length ? ' · ' + styles.join('／') : ''}</p>
    ${total ? `<p class="gold">本局已經幫你 ${signedMoney(total)}。</p>` : ''}</div>`;
}

/** 配置列保留三個原有選項和實際預估，明細可自行展開。 */
function allocationMarkup(run: TradingRun, allocation: string, preview: Forecast | null) {
  const buttons = run.config.allocation.options.map(option => `<button type="button" class="alloc-button" data-act="alloc"
    data-value="${option.id}" aria-pressed="${option.id === allocation}"><strong>${escapeHtml(option.name)}</strong><small>${percent(option.ratio)} 股</small></button>`).join('');
  const gain = Math.max(0, preview?.high ?? 0);
  const loss = Math.min(0, preview?.low ?? 0);
  return `<section class="alloc-section" aria-label="持股配置">
    <div class="alloc-row">${buttons}</div>
    ${preview ? `<div class="preview" aria-live="polite"><p>現金 <b class="cash-ink">${money(preview.cash)}</b> · 股票 <b class="stock-ink">${money(preview.stock)}</b></p>
      ${gain || loss ? `<details><summary>預估損益</summary><p>${gain ? `<b class="gain">+${money(gain)}</b>` : ''}${gain && loss ? ' ～ ' : ''}${loss ? `<b class="loss">−${money(-loss)}</b>` : ''}</p></details>` : ''}</div>` : ''}
  </section>`;
}

export function chartDialogMarkup(run: TradingRun) {
  return performanceChart(run);
}

/** The latest news and what it did to the player (from the settlement record), plus any private intel. */
export function newsMarkup(run: TradingRun) {
  const openingEvent = run.publicEvent;
  const current = openingEvent ? { day: run.day, event: openingEvent } : run.latestNews;
  const intel = run.intelFor(run.player);
  const report = current ? run.reports.find(item => item.day === current.day) : null;
  const tone = current ? marketTone(current.event, run.config) : 'neutral';
  const impact = openingEvent ? eventRuleCopy(run.config, openingEvent) : report ? newsImpact(report, run.player, run.config) : '';
  const jokerIntel = run.jokerIntelFor(run.player);
  return `<div class="news-detail ${tone}">
    ${current ? `${newsArt(current.event.category, current.event.family)}<p class="news-kicker">第 ${current.day} 日 · 虛構新聞 · ${tone === 'neutral' ? '特殊事件' : run.config.market[tone].name}</p><h3>${escapeHtml(current.event.title)}</h3>
      <p>${escapeHtml(current.event.subtitle)}</p>
      ${impact ? `<p data-market-impact class="gold">${impact}</p>` : ''}
      ${current.event.family ? (openingEvent ? '' : `<p>${escapeHtml(eventRuleCopy(run.config, current.event))}</p>`) : `<p>${escapeHtml(current.event.description)}</p>`}` : '<p>還沒有市場新聞。</p>'}
    <p>${run.nextEventDay === null ? '本局新聞已全部公布。' : `下一則新聞在第 ${run.nextEventDay} 日。`}</p>
    ${jokerIntel.category ? `<p class="intel">先知 · 明日新聞類型 ${newsCategories[jokerIntel.category]}</p>` : ''}
    ${jokerIntel.tone ? `<p class="intel">內線之王 · 今日新聞方向 ${run.config.market[jokerIntel.tone].name}</p>` : ''}
    ${intel ? `<p class="intel">◆ 小道消息：第 ${intel.day} 日的新聞是${intel.tone === 'positive' ? '利多' : intel.tone === 'negative' ? '利空' : '特殊事件'}。漲跌多少還不知道。</p>` : ''}
  </div>`;
}

const offerTitle: Record<string, string> = {
  opening: '開局選一張王牌', stage: '選一張王牌', pack: '神秘卡包・三選一', daily: '今日免費道具', news: '消息靈通・拿到一張道具', event: '事件補給'
};

export function offerHeading(run: TradingRun) {
  return offerTitle[run.offer?.source ?? 'event'];
}

export function offerMarkup(run: TradingRun, offered: number | null, replace: number | null) {
  const offer = run.offer!;
  const owned = offer.kind === 'joker' ? run.player.jokers : run.player.items;
  const capacity = offer.kind === 'joker' ? run.config.gameplay.jokerSlots : run.itemLimit;
  const full = owned.length >= capacity;
  const intro = offer.kind === 'joker'
    ? offer.source === 'opening' ? '王牌會一直留著，每天自動幫你。先挑一張！' : '王牌每天自動發動。'
    : offer.cards.length > 1 ? '選一張道具帶走。' : '';
  return `<p>${intro}${full ? `${offer.kind === 'joker' ? '王牌' : '道具'}已滿，選一張要換掉的。` : ''}</p>
    <div class="offer-grid">${offer.cards.map((card, index) => `<button type="button" class="card-button offer-card" data-act="offer-card" data-value="${index}" aria-pressed="${offered === index}"
      aria-label="${escapeHtml(card.name)}：${escapeHtml(cardDescription(run.config, card).line)}">${cardMarkup(run.config, card, offer.kind)}</button>`).join('')}</div>
    ${full ? `<div class="replace-list" aria-label="要換掉的${offer.kind === 'joker' ? '王牌' : '道具'}">${owned.map((card, index) =>
      `<button type="button" data-act="replace" data-value="${index}" aria-pressed="${replace === index}">換掉 ${escapeHtml(card.name)}</button>`).join('')}</div>` : ''}
    <div class="dialog-actions"><button type="button" data-act="decline">${offer.source === 'opening' ? '先不要' : '不要了'}</button>
      <button type="button" class="gold-button" data-act="take" ${offered === null || (full && replace === null) ? 'disabled' : ''}>${offer.kind === 'joker' ? '拿這張王牌' : '拿這張道具'}</button></div>`;
}

const shopBlockCopy: Record<BuyBlock, string> = { sold: '已售出', owned: '已持有', cash: '現金不足', full: '選一張要替換的卡' };

/**
 * The stage shop: three jokers and two items with real prices for this buyer. Only cash pays; buying lowers total
 * worth by the price, and owned cards never count toward it. Every number comes from the run's shop rules.
 */
export function shopMarkup(run: TradingRun, picked: number | null, replace: number | null) {
  const shop = run.shop!;
  const { cash } = run.player.account;
  const { jokerSlots } = run.config.gameplay;
  const itemSlots = run.itemLimit;
  const shelves = shop.slots.map((slot, index) => {
    const check = run.shopCheck(index);
    const tag = check.block === 'cash' ? `還差 ${money(check.shortfall)}` : check.block === 'full' ? '需替換一張' : check.block ? shopBlockCopy[check.block] : '可購買';
    const discounted = check.price < slot.base;
    return `<button type="button" class="card-button shop-card ${check.block === 'sold' ? 'sold' : ''} ${check.block === 'cash' ? 'short' : ''}" data-act="shop-card" data-value="${index}"
      aria-pressed="${picked === index}" aria-label="${slot.kind === 'joker' ? '王牌' : '道具'} ${escapeHtml(slot.card.name)}，${money(check.price)}，${tag}：${escapeHtml(cardDescription(run.config, slot.card).line)}">
      ${cardMarkup(run.config, slot.card, slot.kind, '', '', true)}
      <span class="price-tag"><b>${money(check.price)}</b>${discounted ? `<s aria-label="原價 ${money(slot.base)}">${money(slot.base)}</s>` : ''}</span>
      <span class="shop-status">${tag}</span></button>`;
  });
  const slot = picked === null ? null : shop.slots[picked];
  const check = picked === null ? null : run.shopCheck(picked, replace);
  const owned = slot?.kind === 'joker' ? run.player.jokers : run.player.items;
  const replaceList = slot && check?.needsReplace && (check.block === null || check.block === 'full') ? `<div class="replace-list" aria-label="要換掉的${slot.kind === 'joker' ? '王牌' : '道具'}">${owned.map((card, index) =>
    `<button type="button" data-act="shop-replace" data-value="${index}" aria-pressed="${replace === index}">換掉 ${escapeHtml(card.name)}${slot.kind === 'joker' ? ` <small>回收 +${money(sellPrice(run.config, card, shop.rules))}</small>` : ''}</button>`).join('')}</div>` : '';
  const description = slot ? cardDescription(run.config, slot.card) : null;
  const note = slot && check && description ? `<div class="shop-note" aria-live="polite"><strong>${escapeHtml(slot.card.name)}</strong>
    <p>${escapeHtml(description.detail || description.line)}</p>
    ${check.block ? `<p class="shop-warning">${check.block === 'cash' ? `手上現金還差 ${money(check.shortfall)}。` : shopBlockCopy[check.block]}</p>` : ''}</div>` : '';
  return `<div class="shop" data-shop-day="${shop.day}">
    <div class="shop-wallet"><span class="shop-cash">${iconMarkup('cash', '#ffc973')}<span>可用現金 <b class="cash-ink" data-shop-cash>${money(cash)}</b></span></span>
      <span class="shop-capacity"><span>王牌 ${run.player.jokers.length} / ${jokerSlots}</span><span>道具 ${run.player.items.length} / ${itemSlots}</span></span></div>
    <div class="shop-grid">${shelves.join('')}</div>
    ${note}${replaceList}
    <div class="dialog-actions"><button type="button" data-act="leave-shop">離開商店</button>
      <button type="button" class="gold-button" data-act="buy" ${!check || check.block ? 'disabled' : ''}>${check && slot ? `用 ${money(check.price)} 買下` : '先選一件商品'}</button></div>
  </div>`;
}

export function dailyShopMarkup(run: TradingRun, selected?: number, feedback?: string) {
  const shop = run.dailyShop;
  if (!shop) return '';
  const isJoker = selected !== undefined && shop.slots[selected]?.kind === 'joker';
  const stock = isJoker ? run.player.jokers : run.player.items;
  const purchased = shop.slots.some(slot => slot.sold);
  return `<section class="daily-shop" aria-label="今日商品"><div class="shop-sign"><h3>${iconMarkup('cash', '#ffc973')}可用現金</h3><span>${money(run.player.account.cash)}${run.player.memory.voucher ? ' · 折價券' : ''}</span></div>
    <div class="daily-shelves">${shop.slots.map((slot, index) => {
      const check = run.dailyShopCheck(index);
      return `<article class="daily-product${check.block === 'sold' ? ' sold' : ''}"><button class="card-button" type="button" data-act="daily-detail" data-value="${index}" aria-label="查看 ${escapeHtml(slot.card.name)}">${cardMarkup(run.config, slot.card, slot.kind)}</button>
        <button class="shelf-buy" type="button" data-act="daily-buy" data-value="${index}" ${check.block && check.block !== 'full' ? 'disabled' : ''}>${check.block === 'sold' ? '售出' : check.block === 'cash' ? '差 ' + money(check.shortfall) : '購買 ' + money(check.price)}</button></article>`;
    }).join('')}</div>
    ${feedback?.startsWith('買下 ') ? `<p class="opening-feedback purchase-feedback" role="status">◉ ${escapeHtml(feedback)}</p>` : ''}
    ${selected !== undefined && run.dailyShopCheck(selected).block === 'full' ? `<div class="morning-choices"><span>選一張換掉</span>${stock.map((card, index) =>
      `<button type="button" data-act="daily-buy-replace" data-value="${index}">${escapeHtml(card.name)}</button>`).join('')}<button type="button" data-act="daily-buy-cancel">取消</button></div>` : ''}
    <footer class="opening-shop-actions"><button type="button" class="gold-button" data-act="finish-daily-shop">${purchased ? '回到戰場' : '略過購物'}</button></footer></section>`;
}

export interface TerminalSelection {
  allocation: string | null; item: number | null; targetId?: string;
  /** Motion allowed for the day just settled (ArenaFx moves bars from the open to the close). */
  animate: boolean;
  /** The latest day was settled just now, so its numbers are shown once (statically when motion is reduced). */
  fresh?: boolean;
  actions?: ActionChoice[]; dailyPick?: number; feedback?: string; inspectItem?: number;
}

export function tradingMarkup(run: TradingRun, ui: TerminalSelection) {
  const { item, animate } = ui;
  const fresh = Boolean(ui.fresh || animate);
  const allocation = ui.allocation ?? run.player.allocation;
  const eliminated = run.player.account.eliminated;
  const actions = ui.actions ?? [];
  const preview = eliminated ? null : run.preview(allocation, item, ui.targetId, actions);
  const canTrade = eliminated || run.canLock({ allocation, actions });
  const choosing = ui.allocation !== null || item !== null;
  const target = preview?.attack;
  const sacrifice = preview?.sacrifice;
  const sacrificeAmounts = sacrifice ? '自己預計扣 ' + money(sacrifice.cost) + (sacrifice.refund ? '，返還 ' + money(sacrifice.refund) : '') +
    (sacrifice.damage.length ? '。' + sacrifice.damage.map(hit => escapeHtml(hit.target.name) + ' 約損失 ' + money(hit.amount)).join('、') : '。請選對手') : '';
  const targetHint = sacrifice ? `<p class="target-hint" aria-live="polite">${sacrificeAmounts}。實際金額於收盤結算。</p>` : preview?.targets.length ? `<p class="target-hint" data-target-hint aria-live="polite">⌖ ${target ?
    escapeHtml(target.target.name) + (target.kind === 'shield_break' ? ' · 預計打掉 1 個護盾' : ' · 依目前' + (target.kind === 'cash_raid' ? '現金' : '股票') + '估計 ' + money(target.amount)) + '。點同一人可取消。' : '點競技場上的角色選擇目標。'}</p>` : '';
  const results = resultMarkup(run, animate);
  return `<main class="trading battle-terminal" id="market" aria-label="卡牌競技場">
    ${timelineMarkup(run)}
    ${arenaMarkup(run, choosing, animate, preview)}
    <div class="battle-console">
      ${eliminated ? '<section class="panel spectator"><h2>本席已出局</h2><button type="button" data-act="personal">查看個人結算</button></section>' :
        `${chipsMarkup(run)}${jokerMarkup(run, fresh, animate)}${itemMarkup(run, allocation, ui)}${targetHint}`}
      <details class="battle-audit"><summary>財務明細</summary>${heroMarkup(run)}<button type="button" data-act="chart">總身家走勢</button>${results}</details>
    </div>
    <div class="trade-dock">${eliminated ? '' : allocationMarkup(run, allocation, preview)}<div class="dock-inner"><div class="dock-caption"><span>${eliminated ? '觀戰模式' : `第 ${run.day} / ${run.config.gameplay.turns} 日`}${item !== null && !eliminated ? ` · ${escapeHtml(run.player.items[item].name)}` : ''}</span>
      <strong>${eliminated ? '其餘席位繼續' : target ? '⌖ ' + escapeHtml(target.target.name) : preview?.targets.length ? '請先選對手' : escapeHtml(allocationOption(run.config, allocation).name)}</strong></div>
      <button type="button" class="gold-button" data-act="trade" ${!canTrade || run.offer?.source === 'daily' ? 'disabled' : ''}>
      ${eliminated ? '看下一個交易日' : run.day === run.config.gameplay.turns ? '結束回合・收盤' : '結束回合'} <span aria-hidden="true">→</span></button></div></div>
    </main>`;
}
