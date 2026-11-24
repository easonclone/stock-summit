# 資料契約

- `src/config/financial.json` 集中維護初始資金、融資上限、追繳門檻、費率、定存期限、避險上限與破產重整參數。
- `src/config/gameplay.json` 維護交易日數、事件間隔、手牌容量及起手張數。
- `src/config/npc.json` 維護決策擾動、前瞻、流動性成本、財務及手牌評估係數。難度只改決策。
- `src/data/characters.json` 維護四位角色的 ID、姓名、外觀描述、代表色與肖像鍵。
- `src/data/finance.json` 定義共用效果、節點及卡片。每筆資料透過 `effectIds` 引用效果，啟動時驗證引用、唯一識別碼、權重和數值門檻。
- `src/data/market-states.json` 與 `src/config/ui-theme.json` 定義盤勢文字、圖示與漲跌配色。

| 資料類型 | 主要欄位 |
| --- | --- |
| 效果 | `type` 和對應參數。支援買進及融資、賣出、重估、現金收益、定存、股息、避險、預告、追繳條件、還款與協同 |
| 節點 | ID、出現最早列、權重、描述、標籤、圖示、效果與可選三選一卡 |
| 卡片 | ID、名稱、說明、使用條件、持續時間、權重、圖示及效果；主動使用 |
| 市場事件 | ID、標題、副標、描述、分類、權重、特效層級、目標、效果及必填的虛構標記 |

協同可依節點標籤與已發生的盤勢判斷，追加重估率或股息倍數。市場調整由效果種類定義，不需要為不同新聞加入程式分支。

`src/data/market-events.json` 收錄 60 則虛構新聞。六類代碼依序為 `ai`、`taiwan`、`us`、`global`、`flows`、`memes`，數量為 12、12、10、8、10、8。事件只引用既有的股票漲跌及追繳效果。新聞文案不存效果百分比，畫面依效果設定和當日帳本輸出。

卡片新增 `freedom`，搭配效果可設定 `base` 與 `prepareDays`；`fee_coupon.days` 設定融資券期限。玩法開關及換牌上限設定於 `src/config/card-rules.json`。

完整牌池加入 `rarity`、`expandedOnly` 及選用的 `pairing`。`timed` 記錄持續或一次性布局，`route_card` 調整自有股票風險，`attack` 透過開盤目標套用。設定 `cardRules.rarity` 控制 65／30／5 的稀有度權重。
