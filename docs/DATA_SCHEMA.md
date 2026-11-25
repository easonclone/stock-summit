# 資料契約

- `src/config/financial.json`：初始資金、翻身資金、可翻身次數、待命護盾上限。
- `src/config/allocation.json`：三種配置（比例）、預設配置與共同市場效果 id。
- `src/config/gameplay.json`：交易日數、新聞間隔、王牌與道具上限、起始道具數與保證池（`startItems`、`openingItems`）、每日開盤道具開始日（`dailyItemStart`，`null` 可停用）、行動牌與當日出牌上限、王牌選項數、商店與階段日（`stageDays`）、稀有度權重（65／30／5）。
- `src/config/shop.json`：`enabled`、每日道具商品數、收盤商店上架的王牌與道具數、依稀有度的 `price.joker`／`price.item`、王牌回收比例 `sellRate`。啟動時驗證回收比例低於最低折扣後售價比例。
- `src/config/settlement.json`：倍率上限、少賠上限、每人每日承受直接攻擊次數、直接損失占開盤身家上限及反擊金額上限。
- `src/config/npc.json`：決策擾動（只受難度影響）、風險厭惡、保留道具價值與道具估值、商店估值係數（`jokerShopScale`、`itemShopScale`、`shopMargin`）、商店日留現金加分（`shopCashValue`、`shopBudget`）、同流派加分 `styleSynergy`。
- `src/data/characters.json`：四位角色的 ID、姓名、外觀描述、代表色與肖像鍵。
- `src/data/finance.json`：所有效果（市場、王牌、道具共用）。
- `src/data/cards.json`：`jokers` 與 `items`。欄位為 `id`、`name`、`icon`、`color`、`rarity`、`weight`、`effectIds`，可選 `shopOnly`（只在商店出現，不進開局與卡包）。牌面的一句話與詳情由 `src/ui/card-copy.ts` 讀取同一份效果設定產生。
- `src/data/market-events.json`：60 則虛構新聞。
- `src/data/market-states.json` 與 `src/config/ui-theme.json`：盤勢文字、圖示與漲跌配色。

啟動時 `readFinancialConfig` 驗證：效果引用存在、ID 不重複、每類資料只能引用該類允許的效果（例如王牌不能直接改股價、道具不能放永久加成）、新聞最多一個股價效果、起始配置存在、可抽王牌足夠。

| 效果類型 | 用在 | 意義 |
| --- | --- | --- |
| `price` | 共同市場、新聞 | 股價漲跌範圍 |
| `cash_grant`、`item_grant` | 新聞、道具 | 拿現金、拿道具 |
| `gain_add`、`streak_add`、`rebound_add`、`joker_add`、`today_add` | 王牌、道具 | 股票有賺時的百分比加成（先相加） |
| `news_mult`、`repeat_mult`、`swing_mult`、`today_mult` | 王牌、道具 | 特殊倍率（依序相乘；`swing_mult`、`today_mult` 也放大虧損） |
| `loss_cut`、`defense` | 王牌、道具 | 少賠（`defense` 為待命護盾：`cut`／`absorb`／`reverse`） |
| `cash_yield`、`yield_boost`、`stock_yield`、`bear_bonus`、`item_bonus`、`attack_bonus`、`hold_bonus`、`climb_bonus` | 王牌 | 收盤固定現金 |
| `news_item`、`shop_discount` | 王牌 | 新聞後拿道具、商店折扣 |
| `intel`、`item_pack`、`stock_cash`、`relief` | 道具 | 偷看方向、三選一、領股票 %、低身家救急 |
| `attack`、`cash_raid`、`shield_break` | 道具 | 指定對手並在市場結算後扣股票、轉移現金或破一盾，單體攻擊牌只接受單一效果 |
| `mirror` | 道具 | 單面待命，受到造成金額變動的直接攻擊後依設定比例反擊 |

- `src/config/feedback.json`（只影響呈現）：`tiers` 為命中分級門檻（傷害占目標開盤身家比例：`normal` 3%、`strong` 8%、`heavy` 15%，以下為輕擊）；`bigMarket` 為大漲跌門檻；`timing` 為演出節奏毫秒數（基本間隔、王牌連鎖起點與間隔、攻擊起點與間隔、反擊延遲、名次延遲、總長上限）。

`TradeChoice.actions` 依序儲存道具格號及單體攻擊的鎖定目標，`DayReport.attacks` 記錄命中者、目標、種類、實際金額和反擊金額。`amount` 是實際金額，破盾另以種類表示；`itemId` 為使用的道具，`factor` 為雙重打擊等倍數。`DayReport.misses`（`AttackMiss`）記錄沒有造成效果的攻擊與原因：`limit`（對手今天已被打過）、`no_stock`、`no_cash`、`no_shield`、`capped`（損失已到上限）；只供畫面顯示「未命中」，不改變規則。

新聞的方向由股價效果的正負決定；沒有股價效果的是特殊事件。新聞文案不存百分比，畫面依效果設定和當日紀錄輸出。

## 市場事件劇場（只負責呈現）

- `src/data/event-theater.json`：`scenes` 為 12 種可重用像素場景（AI 科技中心、半導體工廠、交易所、中央銀行、記者會、港口、能源市場、金庫、散戶聊天室、券商辦公室、黑天鵝、市場狂歡）；`speakers` 為五位新聞角色；`events` 以新聞 id 對應 `sceneId`、`speakerId`、`animationId`、`soundId` 與 1–3 句 `dialogue`；`closing` 為收盤演出。嚴重度、標題、漲跌方向一律讀取 `market-events.json` 與效果引擎，不重複維護數值。
- `src/data/character-lines.json`：17 種情境（剛開槓桿遇利多／利空、空手遇大漲、剛賣光就漲、空手避跌、定存避險、護盾、連招、被攻擊、追繳、超車、名次大跌、破產、重整、奪冠、新聞獲利、新聞虧損），每種至少 3 句共用台詞，另可為四位角色各加一句個人口吻。台詞只能用 `{amount}`、`{rank}`，數值由實際結算填入。
- `src/config/theater-settings.ts` 於啟動時驗證：60 則新聞皆有演出、場景與主播存在、台詞數量與佔位符合法、角色 id 存在。
- 結算紀錄 `DayOutcome.exposure` 記下市場開盤時的股票與現金，只供呈現判斷誰受影響，不參與計算。`DayOutcome.ledger.steps` 是當日結算連鎖，畫面直接重播。
