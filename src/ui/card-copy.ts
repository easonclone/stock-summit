import type { FinanceEffect, FinancialConfig, GameCard } from '../config/financial-settings';
import { money, percent } from './format';

function copy(effect: FinanceEffect, config: FinancialConfig): [string, string?] {
  const add = (value: number) => '獲利 +' + percent(value);
  const cap = '股票獲利上限為基礎獲利的 ' + config.settlement.maxGainMultiplier + ' 倍。';
  switch (effect.type) {
    case 'cash_yield': return ['每天領現金的 ' + percent(effect.rate) + '，最多 ' + money(effect.cap), '以這張牌發動時手上的現金計算。'];
    case 'stock_yield': return ['每天領股票的 ' + percent(effect.rate) + '，最多 ' + money(effect.cap), '以這張牌發動時的股票市值計算，收益直接入現金。'];
    case 'gain_add': case 'today_add': return ['股票' + add(effect.amount), '只在股票有賺時發動。加成以基礎獲利計算，和同類加成相加。' + cap];
    case 'rebound_add': return ['昨天股價跌，今天股票' + add(effect.amount), '需要今天股票有賺，以基礎獲利計算，和同類加成相加。' + cap];
    case 'streak_add': return ['每連賺一天，今天' + add(effect.step), '昨天為止連續獲利的天數越多，加成越高，最多 +' + percent(effect.cap) + '。' + cap];
    case 'joker_add': return ['每多一張其他王牌，' + add(effect.amount), '只算其他王牌，且今天的股票要有賺錢。' + cap];
    case 'yield_boost': return ['加倍現金收益 ×' + effect.factor, '搭配現金奶牛，兩張合計每天最多 ' + money(effect.cap) + '。'];
    case 'loss_cut': return ['股票虧損減少 ' + percent(effect.amount), '和比例護盾合計最多抵銷 ' + percent(config.settlement.maxLossCut) + '，依結算順序套用。'];
    case 'news_mult': return ['科技利多時，股票獲利 ×' + effect.factor, '須有 AI 或台股科技利多新聞影響你，且今天股票整體有賺。' + cap];
    case 'repeat_mult': return ['股票連賺時，今天獲利 ×' + effect.factor, '昨天及今天的股票都獲利才會發動。' + cap];
    case 'swing_mult': case 'today_mult': return ['股票獲利、虧損都 ×' + effect.factor, '虧損最多跌到股票歸零。' + cap];
    case 'bear_bonus': return ['沒買股又遇跌，拿 ' + money(effect.amount), '今天須全留現金，且影響你的股價變動為負。'];
    case 'item_bonus': return ['每用一張道具領 ' + money(effect.amount), '每日最多 ' + money(effect.cap) + '。保留的道具不算。'];
    case 'shop_discount': return ['商店價格 ' + Number(((1 - effect.rate) * 10).toFixed(1)) + ' 折', '每日商店和王牌商店皆適用。'];
    case 'attack_bonus': return ['拿有效攻擊金額的 ' + percent(effect.rate), '依實際股票扣款及掠奪的淨額結算；反擊本身不計。'];
    case 'news_item': return ['新聞結束後，道具 ' + effect.count + ' 選 1', '最後一天收盤不發牌。滿手可替換或放棄。'];
    case 'hold_bonus': return ['連續持股 ' + effect.days + ' 天領 ' + money(effect.amount), '依每天收盤時有沒有股票計算。領取後重新計天數。'];
    case 'climb_bonus': return ['首次脫離最後一名，拿 ' + money(effect.amount), '每局一次，依收盤排名判斷。'];
    case 'cash_grant': return ['立即拿 ' + money(effect.amount)];
    case 'random_cash': return ['立即拿 ' + money(effect.min) + '～' + money(effect.max), '金額隨機，本張只能從抽牌取得。'];
    case 'defense': {
      const rules = '待命至下次股票虧損才生效。每天最多部署一張防禦，待命防禦合計最多 ' + config.financial.maxDefenses + ' 張。';
      if (effect.mode === 'cut') return ['下次股票虧損少賠 ' + percent(effect.amount), rules + '和其他比例減傷合計最多 ' + percent(config.settlement.maxLossCut) + '。'];
      if (effect.mode === 'absorb') return ['下次股票虧損最多擋 ' + money(effect.amount), rules];
      return ['下次股票虧損反轉為獲利', rules + '抵掉剩餘虧損後，最多轉成 ' + money(effect.amount) + ' 獲利。'];
    }
    case 'mirror': return ['單體攻擊反彈 ' + percent(effect.amount) + '，最多 ' + money(config.settlement.reflectionCap), '掠奪時拿回現金，股票攻擊時扣回對方股票。破盾、群攻和反擊不觸發。每天最多部署一張防禦，待命防禦合計最多 ' + config.financial.maxDefenses + ' 張。'];
    case 'attack': return ['讓指定對手股票跌 ' + percent(effect.amount), '按股價結算後的股票計算。沒打中會保留。'];
    case 'cash_raid': return ['搶對手 ' + percent(effect.rate) + ' 現金，最多 ' + money(effect.amount), '把對手的現金轉給你。對手沒現金就保留這張牌。'];
    case 'shield_break': return ['打掉一個護盾，再扣 ' + money(effect.amount) + ' 股票', '股價結算後才破盾。如果護盾已用掉，就會保留這張牌。'];
    case 'area_attack': return ['其他對手的股票各跌 ' + percent(effect.amount), '依對手股價結算後的股票及每日傷害上限個別計算，群攻不觸發反擊鏡。'];
    case 'strike_boost': return ['下一張攻擊牌效果 ×' + effect.factor, '先排這張，再排攻擊牌。攻擊沒命中時保留兩張。'];
    case 'stock_cash': return ['領配置後股票的 ' + percent(effect.rate) + ' 當現金', '按重新配置後、股價漲跌前的股票價值計算。'];
    case 'relief': return ['總身家低於 ' + money(effect.below) + '，拿 ' + money(effect.amount), '每局只能使用一次。'];
    case 'intel': return ['揭露下一個新聞日的方向', '只看得到利多、利空或特殊事件。'];
    case 'item_pack': return ['道具 ' + effect.count + ' 選 1，今天可用', '卡包不會開出其他抽牌道具。'];
    case 'generate': {
      const pool = effect.pool === 'attack' ? '攻擊牌' : effect.pool === 'defense' ? '防禦牌' : '道具';
      return [effect.choose ? pool + ' ' + effect.count + ' 選 1' : '立即拿 ' + effect.count + ' 張不同道具', '今天就可以用，不會拿到其他抽牌道具。'];
    }
    case 'voucher': return ['下次購物最多折 ' + money(effect.amount), '可留到下次購物，只能存一張。'];
    default: return [''];
  }
}

export function cardDescription(config: FinancialConfig, card: GameCard) {
  const [line, detail] = copy(config.effects[card.effectIds[0]], config);
  return { line: line || card.name, detail: detail ?? '' };
}
