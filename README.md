# 股市攻頂戰 Stock Summit

**Market Showdown** 是一款四人同步回合制的像素股市競技場。玩家與三位電腦對手用相同本金和交易規則，在 15 個交易日後依總身家排名。60 則市場快訊均為虛構遊戲情境。

## 操作

1. 選角色和電腦難度，開局從三張王牌挑一張。每人自動拿三張不同道具，其中包含收益和防禦道具各一張。
2. 每天選擇買多少股票，可搭配一張道具。選到攻擊道具時，點競技場裡的對手再開始交易。王牌會自動發動。四席的財富條顯示實際總身家。
3. 第 2 日起開盤免費抽一張道具。持有四張時，可選一張換掉，或放棄新道具。
4. 第 3、6、9、12 日收盤後可用現金逛商店。畫面會提示下次開店日。
5. 收盤後可看排行榜、績效走勢與連鎖明細，也可以複製結算摘要。

桌機可用 Tab 導覽，透過 Enter 或空白鍵操作按鈕。設定支援國際漲跌配色、減少動態、新聞演出速度及音效開關。收盤後可重玩相同市場，或開一局新種子。網址可加上 `?seed=3708` 指定市場。

## 本機啟動與檢查

使用 Node.js 22。

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run simulate -- 1000
node scripts/verify-browser.mjs --desktop-only
```

移除 `--desktop-only` 即可一併測試手機寬度。可用 `CHROME_PATH` 指定瀏覽器，驗證截圖輸出到 `test-results/v2/`。建置產物位於 `dist/`，GitHub Pages 沿用原工作流程及相對路徑。

[V3.1 規格與平衡紀錄](docs/V3_1_PLAN.md) · [介面](docs/UI_DESIGN.md) · [資料設定](docs/DATA_SCHEMA.md)
