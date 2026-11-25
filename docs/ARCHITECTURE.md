# 架構

| 位置 | 職責 |
| --- | --- |
| `src/config/financial-settings.ts` | Zod 驗證與跨檔效果引用檢查（王牌、道具、新聞各自允許的效果類型） |
| `src/core/trading-run.ts` | 開局選王牌、商店與階段道具、道具取得、同步決策、狙擊、收盤、歸零翻身 |
| `src/core/shop.ts` | 商店定價、折扣、回收價、能不能買（差額、已持有、需替換）與購買，玩家與電腦共用 |
| `src/core/settlement.ts` | 單一結算引擎：換倉、道具、共同市場與新聞、王牌加成與倍率、護盾、固定現金收入；每一步寫入 `DayLedger.steps` |
| `src/core/economy.ts` | 現金、股票與績效帳務 |
| `src/core/financial-risk.ts`、`bankruptcy.ts` | 歸零判斷與一次翻身 |
| `src/core/trade-preview.ts`、`npc-strategy.ts` | 用複製帳本在幾個市場情境下試算；電腦依同一試算挑配置、道具與卡片 |
| `src/core/market-events.ts`、`random.ts`、`targets.ts` | 新聞排程、種子亂數與新聞目標 |
| `src/main.ts`、`src/ui` | DOM 互動、SVG 績效、像素圖示、視窗與音效；Phaser 延遲載入以播放重大市場像素效果 |
| `src/ui/fx-events.ts` | 純函式 `buildFxPlan`：只讀已結算的 `DayReport`（攻擊紀錄、未命中、結算連鎖），產生有時間的演出事件與每席財富影格；影格最後必等於收盤，不重算卡片、不碰亂數 |
| `src/ui/arena-fx.ts` | 在競技場 DOM 播放演出計畫：命中閃光、浮字、粒子、震動、延遲傷害條、王牌連鎖與音效；重繪時全部清除，同一日不重播；減少動態只留靜態數字與財富條 |
| `src/ui/paint.ts` | 繪製肖像、角色、城市背景、卡圖與圖示的畫布 |
| `src/config/feedback-settings.ts` | 讀取並驗證 `feedback.json`（命中分級門檻須遞增、節奏毫秒數） |
| `fx-lab.html`、`src/dev/fx-lab.ts`、`scripts/capture-fx.mjs` | 開發用演出實驗室（不進正式建置）：以真實結算跑 12 種攻防情境，截圖並檢查浮字等於紀錄、未命中不顯示傷害 |
| `scripts/simulate.mjs` | 用正式引擎無畫面執行策略、角色與王牌對照模擬 |

每人先取得開盤帳務、自己的王牌與道具、自己取得的新聞方向與公開排名。引擎鎖定四人的配置與道具，再抽共同市場與新聞目標，依結算順序處理每個人，接著處理狙擊與固定現金收入，最後判斷歸零與排名。畫面只透過命令確認交易、選擇卡片提案及接受翻身，預覽讀取獨立帳本副本。

共同市場、新聞排程、新聞目標、各席位王牌、道具與決策各用分離的亂數串流。無效確認與預覽不消耗正式結算亂數。

`src/core/market-events.ts` 依種子、已公布新聞及公共規則排出市場日程。實際預告只交給已取得消息的席位；玩家及電腦的情境試算只讀取整份新聞清單的平均利多／利空幅度，或自己用小道消息得知的方向。

演出分層：核心結算完成後，`buildFxPlan` 把紀錄轉成演出事件，`ArenaFx` 只負責播放。演出不決定結算時點，交易按鈕在結算後立即可按；換日字幕延到演出結束後才出現，可略過且不影響結果。
