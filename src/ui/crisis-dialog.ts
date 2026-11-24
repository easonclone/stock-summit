import type { TradingRun, DayOutcome, DayReport } from '../core/trading-run';
import { escapeHtml, money, signedMoney } from './format';

/** Shown when total worth hits zero. No debt exists, so there is nothing owed and nothing to repay. */
export function crisisMarkup(run: TradingRun, report: DayReport, outcome: DayOutcome, pending: boolean) {
  const rules = run.config.financial;
  const applied = outcome.recovery;
  const before = applied?.before ?? outcome.close;
  const sources = [report.market && outcome.marketApplied ? report.market.title : '', ...outcome.incomingCards].filter(Boolean);
  const reaction = pending ? '總身家歸零了！你還有一次翻身機會。' :
    applied ? '東山再起！這次從小本開始。' :
    '第二次歸零，本局交易結束。';
  return `<div class="crisis-flag">第 ${report.day} 日 · 身家歸零</div>
    <p><strong>${reaction}</strong></p>
    <p>${sources.length ? `${sources.map(escapeHtml).join('／')}之後，` : ''}這天總身家變動 ${signedMoney(before - outcome.start)}。</p>
    ${pending ? `<p>翻身後拿到 ${money(rules.recoveryCash)} 現金重新開始，不用還。手牌和護盾會清空。第二次歸零就出局。</p>
      <button class="gold-button" type="button" data-act="recover">東山再起</button>` :
      !applied && !run.closed ? '<p>你還能看其他人繼續玩，或查看自己的戰績。</p><div class="dialog-actions"><button type="button" data-act="close-dialog">觀看剩餘賽局</button><button type="button" data-act="personal">查看個人結算</button><button type="button" data-act="new">再玩一局</button></div>' : ''}
  `;
}
