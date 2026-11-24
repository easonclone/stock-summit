import type { TradingRun, DayOutcome, DayReport } from '../core/trading-run';
import { escapeHtml, money, percent, signedMoney } from './format';

export function crisisMarkup(run: TradingRun, report: DayReport, outcome: DayOutcome, pending: boolean) {
  const rules = run.config.financial;
  const call = outcome.risk.call;
  const node = outcome.node ? run.config.nodes.kinds[outcome.node.kind].name : '場外';
  const title = outcome.risk.insolvent ? '宣告破產' : call?.liquidated ? '強制平倉' : '融資追繳';
  const applied = outcome.recovery;
  const sources = [node, report.market && outcome.marketApplied ? report.market.title : '', ...outcome.incomingCards].filter(Boolean);
  return `<div class="crisis-flag">第 ${report.day} 日 · ${title}</div>
    <p>${sources.map(escapeHtml).join('／')}結算後觸發財務危機。</p>
    ${call ? `<p>融資比率 ${Number.isFinite(call.ratio) ? percent(call.ratio) : '無可擔保部位'}，追繳門檻 ${percent(call.threshold)}。</p>
      <dl class="crisis-ledger">
        <div><dt>平倉前淨資產</dt><dd>${money(call.before)}</dd></div>
        <div><dt>需補繳金額</dt><dd>${money(call.required)}</dd></div>
        <div><dt>部位處分金額</dt><dd>${money(call.sold)}</dd></div>
        <div><dt>已清償融資</dt><dd>${money(call.paid)}</dd></div>
        <div><dt>平倉費及增量損失</dt><dd>${money(call.fee)}</dd></div>
        <div><dt>平倉後淨資產</dt><dd>${money(call.after)}</dd></div>
        <div><dt>仍未清償融資</dt><dd>${money(call.debtLeft)}</dd></div>
      </dl>` : ''}
    ${outcome.risk.insolvent ? `<dl class="crisis-ledger">
      <div><dt>破產時淨資產</dt><dd>${money(applied?.before ?? outcome.close)}</dd></div>
      <div><dt>本日交易變動</dt><dd>${signedMoney((applied?.before ?? outcome.close) - outcome.start)}</dd></div>
      ${pending || applied ? `<div><dt>緊急重整現金</dt><dd>${money(rules.recoveryCash)}</dd></div>
      <div><dt>紓困負債</dt><dd>${money(rules.recoveryDebt)}</dd></div>
      <div><dt>收盤應付重整費</dt><dd>${money(rules.recoveryClosingFee)}</dd></div>
      <div><dt>清除手牌與避險</dt><dd>${pending ? outcome.investor.hand.length : outcome.clearedCards} 張／${pending ? outcome.investor.hedges.length : outcome.clearedHedges} 層</dd></div>
      <div><dt>限制新增槓桿</dt><dd>${rules.recoveryLockDays} 日</dd></div>
      <div><dt>重整後即時淨資產</dt><dd>${money(rules.recoveryCash - rules.recoveryDebt)}</dd></div>
      ${applied ? `<div><dt>原負債減免</dt><dd>${money(applied.marginForgiven + applied.bailoutForgiven)}</dd></div>` : ''}` : ''}
      </dl>` : ''}
    ${pending ? '<p>舊資產會先處分並依序清償融資與紓困，剩餘舊債的減免會記入報告。</p><button class="gold-button" type="button" data-act="recover">接受重整・東山再起</button>' :
      outcome.risk.insolvent && !applied && !run.closed ? '<p>本席已出局。你可以觀看剩餘賽局，或查看個人結算。</p><div class="dialog-actions"><button type="button" data-act="close-dialog">觀看剩餘賽局</button><button type="button" data-act="personal">查看個人結算</button><button type="button" data-act="new">新市場</button></div>' : ''}
  `;
}
