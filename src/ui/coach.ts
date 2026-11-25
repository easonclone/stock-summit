import type { FinancialConfig } from '../config/financial-settings';
import { money } from './format';

export function playGuideMarkup(config: FinancialConfig) {
  const { turns, actionLimit, itemPlayLimit, stageDays } = config.gameplay;
  const shopDays = stageDays.filter(day => day < turns);
  return `<div class="play-guide">
    <p>每位角色從 <strong>${money(config.financial.initialCapital)}</strong> 起家。${turns} 日後，現金和股票加起來最多的人獲勝。</p>
    <dl>
      <dt>交易</dt><dd>決定買多少股票，然後按「開始交易」。股票會跟著市場漲跌，現金可以用來購物。</dd>
      <dt>王牌</dt><dd>開局選一張。符合條件時，王牌會自動發動。</dd>
      <dt>道具</dt><dd>立即牌和防禦牌先點開，再按「立即使用」或「部署」。一天最多部署一張。行動牌最多選 ${actionLimit} 張，下單時發動。全天最多用 ${itemPlayLimit} 張道具。</dd>
      ${config.shop.enabled ? `<dt>商店</dt><dd>道具商店每天開門，第 ${shopDays.join('、')} 日收盤後開放王牌商店。兩間都只收現金。</dd>` : ''}
    </dl>
    <p class="muted">市場新聞是虛構情境。可點上方日期查看日程。</p>
  </div>`;
}
