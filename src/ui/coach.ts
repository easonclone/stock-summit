import type { TradingRun } from '../core/trading-run';
import type { TerminalSelection } from './trading-terminal';
import { marketTone } from '../core/settlement';

export type TipId = 'allocation' | 'jokers' | 'items' | 'shop' | 'cash_safe' | 'shield' | 'bankruptcy';

const tips: Record<TipId, string> = {
  allocation: '先選今天買多少股票。股票會跟著市場漲跌，現金不會。',
  jokers: '王牌會每天自動幫你，不用按。賺錢時看結算，就知道是哪張王牌發威。',
  items: '道具一天最多用一張，也可以留著以後用。',
  shop: '今天收盤後商店開門。王牌要用現金買，全部買股就沒錢逛商店。',
  cash_safe: '股票跌的時候，留在手上的現金一毛都不會少。',
  shield: '護盾放著就好，下次股票賠錢時會自動擋下，擋一次就用掉。',
  bankruptcy: '總身家歸零時，第一次可以拿翻身資金重來，第二次就出局。'
};

const storageKey = 'stock-summit-coach';

/** First-run guidance. Purely presentational; reads the run, never changes it. Storage failures fall back to defaults. */
export class Coach {
  enabled = true;
  private seen = new Set<TipId>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as { off?: boolean; seen?: TipId[] };
      this.enabled = !saved.off;
      this.seen = new Set((saved.seen ?? []).filter(id => id in tips));
    } catch { /* private mode or blocked storage */ }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.seen.clear();
    this.save();
  }

  dismiss(id: TipId) {
    if (!(id in tips)) return;
    this.seen.add(id);
    this.save();
  }

  private save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ off: !this.enabled, seen: [...this.seen] }));
    } catch { /* ignore */ }
  }

  /** Which first-encounter tip applies now, from the player's real record. */
  private tipFor(run: TradingRun): TipId | null {
    const { defenses } = run.player;
    const latest = run.reports.at(-1);
    const outcome = latest?.outcomes.find(item => item.investor === run.player);
    const fell = Boolean(latest?.market && outcome?.marketApplied && marketTone(latest.market, run.config) === 'negative');
    const checks: [TipId, boolean][] = [
      ['bankruptcy', run.investors.some(item => item.account.eliminated) || Boolean(outcome?.risk.insolvent)],
      ['allocation', run.day === 1],
      ['shop', run.shopOpensAfter(run.day)],
      ['cash_safe', fell],
      ['shield', defenses.length > 0],
      ['jokers', run.day >= 2],
      ['items', run.day >= 3 && run.player.items.length > 0]
    ];
    return checks.find(([id, hit]) => hit && !this.seen.has(id))?.[0] ?? null;
  }

  markup(run: TradingRun, ui: TerminalSelection) {
    if (!this.enabled || run.player.account.eliminated) return '';
    const parts: string[] = [];
    if (run.reports.length < 3) {
      const step = ui.item !== null ? 2 : ui.allocation !== null ? 1 : 0;
      parts.push(`<ol class="coach-steps" aria-label="怎麼玩">${['買多少股票', '用道具（可不用）', '開始交易'].map((label, index) =>
        `<li class="${index < step ? 'done' : index === step ? 'now' : ''}">${label}</li>`).join('')}</ol>`);
    }
    const tip = this.tipFor(run);
    if (tip) parts.push(`<p class="coach-tip" role="note"><span>${tips[tip]}</span><button type="button" class="text-button" data-act="tip-ok" data-value="${tip}">知道了</button></p>`);
    if (!parts.length) return '';
    return `<div class="coach">${parts.join('')}<button type="button" class="coach-off" data-act="coach-off" aria-label="關閉新手提示">略過教學</button></div>`;
  }
}
