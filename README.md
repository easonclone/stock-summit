# 股市攻頂戰 Stock Summit

**Market Showdown** 是一款四人同步回合制的像素金融策略遊戲。選擇潘大帥、尤尤、老伯或張婷，與三位電腦對手用同樣的本金與交易規則，在 15 個交易日後以淨資產排名。60 則市場快訊分成六種題材，事件及資產數值都是虛構遊戲情境。

## 操作

1. 選擇角色及電腦難度，開盤。市場種子可自訂。
2. 每日從手牌選擇至多一張卡，再選擇可到達的投資機會。預覽顯示自己出多少、可能賺賠多少、現在能不能打牌及卡片連招。
3. 確認交易後四人同步結算。滿手時可換牌或棄置，投資機會可從三張不同卡中選一張。
4. 使用路線圖規劃後續節點，展開財務明細查看部位、定存、融資、紓困與收盤費。財務危機會提供損失、還款及重整明細。
5. 收盤後查看排行榜、績效走勢、投資風格及逐日危機紀錄，或複製結算摘要分享。

手機可使用所有按鈕。桌機可用 Tab 導覽、Enter 或空白鍵啟動按鈕、左右鍵切換路線、數字鍵 1–5 切換卡片。設定支援國際漲跌配色、減少動態與音效開關。收盤後可重玩相同市場，或再開一局新種子。網址可加上 `?seed=3708` 指定市場。

## 本機啟動與檢查

使用 Node.js 22。

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run simulate -- 1000
```

正式建置後可執行 `node scripts/verify-browser.mjs` 驗證 Chrome。可用 `CHROME_PATH` 指定 Chrome 或 Chromium 路徑，截圖輸出到 `test-results/v2/`。

模擬工具輸出八種策略的財務及風險統計，可用 `npm run simulate --silent -- 1000 > results.json` 匯出 JSON。正式靜態檔案位於 `dist/`，GitHub Pages 部署沿用既有工作流程及相對路徑。

[架構](docs/ARCHITECTURE.md) · [經濟與破產規則](docs/ECONOMY.md) · [改版前基準](docs/MIGRATION.md) · [平衡模擬](docs/BALANCE.md) · [驗收](docs/IMPLEMENTATION_PLAN.md)

[文案比較](docs/COPY_AUDIT.md) · [30 張卡牌規劃](docs/CARD_PLAN.md)

卡片可在持股時直接用，搭對路線可取得更高加成。股息與融資券可以提前布局，手牌選中時可使用每局三次的免費換牌。卡牌四組對照可執行 `npm run simulate -- 1000 --cards`；只驗證桌面可執行 `node scripts/verify-browser.mjs --desktop-only`。
