import type { TradingRun } from '../core/trading-run';
import type { TerminalSelection } from './trading-terminal';

export type TipId = 'leverage' | 'deposit' | 'shield' | 'margin_call' | 'bankruptcy';

const tips: Record<TipId, string> = {
  leverage: '開槓桿＝借錢買股：賺賠都放大，每天還要付利息。',
  deposit: '定存會鎖幾天，每天領利息，不受新聞漲跌影響，到期領回本金。',
  shield: '護盾會在利空時自動擋下部分損失，擋一次就用掉。',
  margin_call: '借錢買的股票跌太多，券商會要你補錢；補不出來就強制賣股。',
  bankruptcy: '收盤時總身家變負就破產出局。借錢前先想好最壞情況。'
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

  /** Which first-encounter tip applies now, from the selected route and the player's real account. */
  private tipFor(run: TradingRun, ui: TerminalSelection): TipId | null {
    const { account, hedges } = run.player;
    const node = ui.lane === null ? null : run.reachable(run.player).find(item => item.lane === ui.lane);
    const latest = run.reports.at(-1)?.outcomes.find(item => item.investor === run.player);
    const preview = ui.lane === null ? null : run.preview(ui.lane, ui.slot, false, ui.prepare);
    const checks: [TipId, boolean][] = [
      ['bankruptcy', run.investors.some(item => item.account.eliminated) || Boolean(latest?.risk.insolvent)],
      ['margin_call', account.financialStatus === 'margin_call' || account.financialStatus === 'warning' || Boolean(latest?.risk.call) || Boolean(preview?.exposureRisk)],
      ['leverage', Boolean(preview?.orderDebt) || account.marginDebt > 0],
      ['deposit', node?.kind === 'deposit' || account.deposits.length > 0],
      ['shield', hedges.length > 0]
    ];
    return checks.find(([id, hit]) => hit && !this.seen.has(id))?.[0] ?? null;
  }

  markup(run: TradingRun, ui: TerminalSelection) {
    if (!this.enabled || run.player.account.eliminated) return '';
    const parts: string[] = [];
    if (run.reports.length < 3) {
      const step = ui.lane !== null ? 2 : ui.slot !== null ? 1 : 0;
      parts.push(`<ol class="coach-steps" aria-label="怎麼玩">${['選卡', '選投資', '下單', '看結果'].map((label, index) =>
        `<li class="${index < step ? 'done' : index === step ? 'now' : ''}">${label}</li>`).join('')}</ol>`);
    }
    const tip = this.tipFor(run, ui);
    if (tip) parts.push(`<p class="coach-tip" role="note"><span>${tips[tip]}</span><button type="button" class="text-button" data-act="tip-ok" data-value="${tip}">知道了</button></p>`);
    if (!parts.length) return '';
    return `<div class="coach">${parts.join('')}<button type="button" class="coach-off" data-act="coach-off" aria-label="關閉新手提示">略過教學</button></div>`;
  }
}
