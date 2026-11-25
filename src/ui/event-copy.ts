import type { FinancialConfig, TradingEvent } from '../config/financial-settings';
import { eventPrice, rulesFor } from '../core/event-rules';
import { money, percent, signedPercent } from './format';

export const eventFamilyNames: Record<NonNullable<TradingEvent['family']>, string> = {
  market: '市場', cash: '現金', attack: '攻擊', defense: '防禦', cards: '卡牌', shop: '商店', sacrifice: '獻祭', ranking: '排名'
};

export function eventRuleCopy(config: FinancialConfig, event: TradingEvent) {
  if (!event.family) return '';
  const rules = rulesFor(config, event);
  const price = eventPrice(config, event, -1);
  const lines: string[] = [];
  if (rules.coinMove) lines.push(`股價 ${signedPercent(rules.coinMove[0])} 或 ${signedPercent(rules.coinMove[1])}，各半機率`);
  else if (rules.rebound) lines.push(`昨天大盤下跌，今天股價 ${signedPercent(rules.rebound)}`);
  else if (price) lines.push(`股價 ${signedPercent(price.floor)}${price.floor !== price.ceiling ? '～' + signedPercent(price.ceiling) : ''}`);
  for (const id of event.effectIds) {
    const effect = config.effects[id];
    if (effect.type === 'cash_grant') lines.push(`每位存續投資人領 ${money(effect.amount)}`);
  }
  if (rules.gain) lines.push(`股票獲利 +${percent(rules.gain)}`);
  if (rules.loss) lines.push(`市場虧損 +${percent(rules.loss)}`);
  if (rules.marketCut) lines.push(`市場虧損減少 ${percent(rules.marketCut)}`);
  if (rules.shieldBoost) lines.push(`已部署市場防禦效果 +${percent(rules.shieldBoost)}`);
  if (rules.cashYield) lines.push(`收盤現金收益 ${percent(rules.cashYield[0])}，最多 ${money(rules.cashYield[1])}`);
  if (rules.cashMajority) lines.push(`收盤現金占身家至少 ${percent(rules.cashMajority[0])}，領 ${money(rules.cashMajority[1])}`);
  if (rules.cashJokers !== undefined) lines.push(`現金收益王牌 ×${rules.cashJokers}`);
  if (rules.cashLeader) lines.push(`收盤現金最多者平分 ${money(rules.cashLeader)}`);
  if (rules.attackBoost) lines.push(`直接攻擊傷害 +${percent(rules.attackBoost)}`);
  if (rules.areaBoost) lines.push(`群攻傷害 +${percent(rules.areaBoost)}`);
  if (rules.guardWeakness) lines.push(`直接攻擊減傷效果降低 ${percent(rules.guardWeakness)}`);
  if (rules.attackCut) lines.push(`直接攻擊傷害減少 ${percent(rules.attackCut)}`);
  if (rules.reflectBoost) lines.push(`反擊傷害 +${percent(rules.reflectBoost)}`);
  if (rules.firstHitCut) lines.push(`首次受到直接攻擊少賠 ${percent(rules.firstHitCut)}`);
  if (rules.damageCap) lines.push(`當日直接傷害上限為開盤身家的 ${percent(rules.damageCap)}`);
  if (rules.bounty) lines.push(`首次打中對手領 ${money(rules.bounty)}`);
  if (rules.damageIncome) lines.push(`實際攻擊傷害的 ${percent(rules.damageIncome[0])} 轉成現金，最多 ${money(rules.damageIncome[1])}`);
  if (rules.insurance) lines.push(`實際市場減傷的 ${percent(rules.insurance[0])} 轉成現金，最多 ${money(rules.insurance[1])}`);
  if (rules.draws) {
    const { count, pick, last, pool } = rules.draws;
    const labels = { all: '', attack: '攻擊', defense: '防禦', sacrifice: '獻祭', rare: '稀有', legendary: '傳說' };
    lines.push(pick ? `開盤道具 ${count} 選 1` : `${last ? '開盤最後一名' : '開盤每位玩家'}領 ${count} 張${labels[pool]}道具`);
  }
  if (rules.actionSlots) lines.push(`今天可多用 ${rules.actionSlots} 張行動卡`);
  if (rules.handSlots) lines.push(`今天多 ${rules.handSlots} 格手牌，明日移除超出的末尾道具`);
  if (rules.comboIncome) lines.push(`成功用 ${rules.comboIncome[0]} 張道具領 ${money(rules.comboIncome[1])}`);
  if (rules.generateBonus) lines.push(`首次用生成道具，多拿 ${rules.generateBonus} 張非生成道具`);
  if (rules.recycle) lines.push(`首次放棄或替換道具領 ${money(rules.recycle)}`);
  if (rules.shopDiscount) lines.push(`商品打 ${Math.round((1 - rules.shopDiscount) * 100) / 10} 折`);
  if (rules.shopItems) lines.push(`今日商店多 ${rules.shopItems} 個道具貨位`);
  if (rules.shopRebate) lines.push(`首筆購物返還實付金額的 ${percent(rules.shopRebate)}`);
  if (rules.shopSell) lines.push(`王牌回收價為原價的 ${percent(rules.shopSell)}`);
  if (rules.shopJokers) lines.push({ rare: '今日加售 1 張稀有王牌', legendary: '今日加售 1 張半價傳說王牌', compatible: '今日加售 2 張相容流派的王牌' }[rules.shopJokers]);
  if (rules.voucher) lines.push(`每人獲得 ${money(rules.voucher)} 折價券`);
  if (rules.sacrificeBoost) lines.push(`獻祭傷害 +${percent(rules.sacrificeBoost)}`);
  if (rules.sacrificeArea) lines.push(`獻祭群攻傷害 +${percent(rules.sacrificeArea)}`);
  if (rules.sacrificeRefund) lines.push(`獻祭返還 ${percent(rules.sacrificeRefund)} 成本`);
  if (rules.sacrificeDraws) lines.push(`獻祭後領 ${rules.sacrificeDraws} 張非生成攻擊道具`);
  if (rules.sacrificeFactor) lines.push(`獻祭成本與基礎衍生傷害 ×${rules.sacrificeFactor}`);
  if (rules.sacrificeTomorrow) lines.push(`今天獻祭，明天股票獲利 +${percent(rules.sacrificeTomorrow)}`);
  if (rules.leaderBounty) lines.push(`首次打中開盤第一名領 ${money(rules.leaderBounty)}`);
  if (rules.overtakeLeader) lines.push(`收盤超過開盤第一名領 ${money(rules.overtakeLeader)}`);
  if (rules.lastAttack) lines.push(`開盤最後一名直接攻擊 +${percent(rules.lastAttack)}`);
  if (rules.leaderGuard) lines.push(`開盤第一名受到的直接攻擊減少 ${percent(rules.leaderGuard)}`);
  if (rules.rankGain) lines.push(`收盤上升至少 ${rules.rankGain[0]} 名領 ${money(rules.rankGain[1])}`);
  if (rules.defendLeader) lines.push(`開盤第一名收盤守住領先，領 ${money(rules.defendLeader)}`);
  if (rules.bottomGain) lines.push(`開盤後兩名股票獲利 +${percent(rules.bottomGain)}`);
  if (rules.bottomAttack) lines.push(`開盤後兩名直接攻擊 +${percent(rules.bottomAttack)}`);
  return lines.join(' · ');
}
