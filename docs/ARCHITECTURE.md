# 架構
資料：`src/data/{characters,events,effects,cards,market-states}.json`、`src/data/maps/mountain-01.json`；設定：`src/config/{gameplay,cash,physics,npc,nodes,ui-theme}.json`，由 `src/config/settings.ts` 以 zod 驗證並檢查跨檔 effectIds 引用。

核心（不依賴 DOM 或 Phaser）：
- `src/core/node-map.ts`：以種子生成 15×4 路線圖，`nodeMapProblems` 驗證相鄰、交叉、死路、可達性與節點出現回合。
- `src/core/run.ts`：`Run` 保存一局狀態。`select(lane)` 記錄玩家待選節點，`resolve()` 依序執行：電腦用卡 → 電腦選路 → 四人進入節點 → 回合 +1 → 每 `eventEvery` 回合市場事件 → 更新收盤紀錄 → 第 `turns` 回合收盤。`score`、`ranking`、`nodeValue` 供介面與電腦共用。
- `src/core/effects.ts`：共用效果引擎，狀態以回合數到期（`freezeUntil`、`momentumUntil` 為排他上限）。
- `src/core/movement.ts`：`Track` 提供層數與安全落點，位移一律依平台層級。
- `src/core/targets.ts`、`src/core/random.ts`：市場目標快照與可重現亂數。

呈現：`src/scenes/course.ts`（Phaser）只讀取 `Run` 狀態，依 `impacts` 內插升降動畫；`src/ui/hud.ts` 繪製路線圖（HTML 按鈕＋SVG 連線）、卡欄與排名，透過回呼呼叫 `Run` 方法，不直接修改狀態；`src/ui/report.ts` 繪製結算；`src/main.ts` 負責頁面切換、鍵盤與種子。

同一種子重現路線圖、市場事件、卡片抽取與電腦選擇。「再玩一局」沿用種子，「新賽道」換新種子，`?seed=` 可指定。
