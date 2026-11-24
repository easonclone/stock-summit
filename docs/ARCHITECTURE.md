# 架構

| 位置 | 職責 |
| --- | --- |
| `src/config/financial-settings.ts` | Zod 驗證與跨檔效果引用檢查 |
| `src/core/trading-run.ts` | 開盤、抽卡與換牌、開盤快照、同步決策、結算及收盤 |
| `src/core/economy.ts` | 現金、部位、定存、債務、費用與績效帳務 |
| `src/core/financial-risk.ts`、`bankruptcy.ts` | 財務警戒、追繳、平倉、破產與重整 |
| `src/core/trading-effects.ts` | 依共用 effectIds 執行單一財務效果系統 |
| `src/core/trade-preview.ts`、`npc-strategy.ts` | 用複製帳本評估卡片＋路線情境；規則式決策與保留手牌 |
| `src/core/node-map.ts`、`random.ts`、`targets.ts` | 種子分岔圖、資料流與事件目標 |
| `src/main.ts`、`src/ui` | DOM 互動、SVG 績效及路線、像素圖示、視窗與音效；Phaser 延遲載入以播放重大市場像素效果 |
| `scripts/simulate.mjs` | 用正式引擎無畫面執行對照模擬 |

每人先取得開盤帳務、手牌、已知情報、公開排名與可前往路線。引擎鎖定決策以及個別事件的目標，先執行全部席位的卡片與路線，接著套用市場、利息、費用、追繳及破產判定。資產轉移與損益計入逐日結算。畫面只透過命令確認交易、選擇換牌及接受重整，預覽讀取獨立帳本副本。

路線生成、即日行情、事件時程、目標、各席位抽卡與決策各用分離的亂數串流。無效確認與預覽不消耗正式結算亂數。分岔採相鄰且不交叉的連線，各列節點不同，連續單線最多兩日。高價值類型的出現日與權重由資料調整。
