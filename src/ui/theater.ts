import type { FinancialConfig, TradingEvent } from '../config/financial-settings';
import type { DayReport, Investor } from '../core/trading-run';
import { eventRuleCopy } from './event-copy';
import { marketTone, priceEffect } from '../core/settlement';
import { escapeHtml, percent, signedMoney } from './format';
import eventArt from '../assets/hd-art/market-events.png';
import familyArt from '../assets/hd-art/event-families.png';
import anchorArt from '../assets/hd-art/market-anchor.png';

export type TheaterMode = 'full' | 'off';

export const newsCategories: Record<TradingEvent['category'], string> = {
  ai: 'AI 與科技', taiwan: '台股與半導體', us: '美國經濟與利率',
  global: '國際政治與貿易', flows: '市場資金', memes: '股市迷因'
};

const eventFrames: Record<TradingEvent['category'], string> = {
  ai: '0% 0%', taiwan: '50% 0%', us: '100% 0%',
  global: '0% 100%', flows: '50% 100%', memes: '100% 100%'
};

const familyFrames: Record<NonNullable<TradingEvent['family']>, string> = {
  market: '0% 0%', cash: '33.3333% 0%', attack: '66.6667% 0%', defense: '100% 0%',
  cards: '0% 100%', shop: '33.3333% 100%', sacrifice: '66.6667% 100%', ranking: '100% 100%'
};

export function preloadNewsArt() {
  for (const source of [eventArt, familyArt, anchorArt]) {
    const image = new Image();
    image.src = source;
  }
}

export function newsArt(category: TradingEvent['category'], family?: TradingEvent['family']) {
  const url = family ? familyArt : eventArt;
  const frame = family ? familyFrames[family] : eventFrames[category];
  return `<span class="news-art" aria-hidden="true" ${family ? `data-news-family="${family}"` : ''} style="--news-art:url('${url}');--news-frame:${frame};--news-size:${family ? '400%' : '300%'} 200%"></span>`;
}

export function newsImpact(report: DayReport, investor: Investor, config: FinancialConfig) {
  const event = report.market;
  if (!event) return '';
  const outcome = report.outcomes.find(item => item.investor === investor);
  if (!outcome || !outcome.marketApplied) return '這則新聞未影響你的席位';
  const bonuses = outcome.ledger.steps.filter(step => step.source === 'event' && step.id === event.id);
  const cash = bonuses.filter(step => step.kind === 'cash').reduce((sum, step) => sum + step.amount, 0);
  const stockBonus = bonuses.filter(step => step.kind !== 'cash').reduce((sum, step) => sum + step.amount, 0);
  const items = report.day < config.gameplay.turns ? outcome.ledger.requests.items : 0;
  const stock = priceEffect(config, event) ? [
    report.newsRate === undefined ? '股價受影響' : '股價 ' + (report.newsRate > 0 ? '+' : '') + percent(report.newsRate),
    outcome.exposure.stock ? '你的股票 ' + signedMoney(outcome.marketPnl) : '你當天沒有持股'
  ] : [];
  return [...stock, stockBonus ? '股票效果 ' + signedMoney(stockBonus) : '', cash ? '現金 ' + signedMoney(cash) : '', items ? '道具 +' + items : ''].filter(Boolean).join(' · ') || eventRuleCopy(config, event) || '你的資產沒有變動';
}

/** 單張新聞卡只讀取已結算資料，由玩家點擊或按鍵關閉。 */
export class MarketTheater {
  private readonly element: HTMLElement;
  private finish!: () => void;
  readonly done = new Promise<void>(resolve => { this.finish = resolve; });

  constructor(root: HTMLElement, report: DayReport, player: Investor, config: FinancialConfig) {
    const event = report.market!;
    const tone = marketTone(event, config);
    this.element = document.createElement('section');
    this.element.className = `theater sev-${event.severity} tone-${tone}`;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'market-brief-title');
    this.element.innerHTML = `<div class="theater-frame">
      ${newsArt(event.category, event.family)}
      <div class="rpg-box"><img class="rpg-face" src="${anchorArt}" alt="" width="128" height="128">
        <div class="rpg-body"><h2 id="market-brief-title">${escapeHtml(event.title)}</h2><p>${escapeHtml(event.subtitle)}</p>
          <strong data-market-impact>${escapeHtml(newsImpact(report, player, config))}</strong></div>
        <button type="button" class="theater-skip" data-th="skip" aria-label="關閉新聞">關閉</button>
      </div></div>`;
    this.element.addEventListener('click', this.close);
    document.addEventListener('keydown', this.onKey, true);
    root.append(this.element);
    this.element.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab') { event.preventDefault(); return; }
    if (!['Escape', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  readonly close = () => {
    document.removeEventListener('keydown', this.onKey, true);
    this.element.remove();
    this.finish();
  };
}
