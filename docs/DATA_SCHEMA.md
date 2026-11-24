# 資料契約（實作時以 Zod 或等效 schema 驗證）
characters: [{id,name,description,color,spriteKey,portrait}]，不含能力值；physics 共用 moveSpeed、climbSpeed、jumpVelocity、gravity、hitbox。
events: [{id,title,description,fictional:true,weight,target,effectIds}]；target = all/random_one/random_two/first_place/last_place。
effects: ID -> discriminated union。例如 {"down_2":{"type":"displacement","layers":-2},"up_1":{"type":"displacement","layers":1},"boost":{"type":"speed_modifier","multiplier":1.2,"durationMs":8000},"freeze":{"type":"freeze","durationMs":3000},"shield":{"type":"shield","charges":1}}。另支援 reveal_next_event、limit_loss、clear_negative。
cards: [{id,name,description,weight,trigger,target,effectIds}]；trigger=manual/on_pickup；target=self/nearest_ahead。無有效目標不得消耗卡片。
map: {id,width,height,spawnPoints,finishPlatformId,platforms:[{id,layer,x,y,width,height,safeLanding:{x,y},edges:[{to,type}]}],ladders,cardSpawns,zones}。edge type=walk/climb/jump/drop。座標 y 向下，layer 向上；位移依 layer 並 clamp，選可用安全落點。
效果順序：解析目標、檢查護盾/停損、位移或狀態更新、通知 UI。護盾按負面市場事件每次消耗一 charge，不按單個子效果。速度效果同類刷新期限，不無限乘疊；不同效果衝突時凍結優先。所有持續時間採遊戲時鐘。驗證唯一 ID、正權重、引用存在、平台落點及路徑可達性。

補充契約：cardSpawns.kind 為 public/recovery，obstacles 設置 platformId、type、fromX、toX。障礙類型集中於 obstacles.json，巡邏障礙透過 effectIds 指定碰撞效果。市場狀態定義 travelSpeed、patrolSpeed；事件和卡片以 icon 指定像素圖示。卡片 pool 為 public/recovery/both。

地圖 cash 提供 bundles 和 bonusCap。每疊鈔票以 platformId、x 定位，並以 amount 指定面額。cash.json 定義拾取範圍與每 100 元換算的層數。ledges 指定 from、to、x、width 與 rise，驗證兩段跳幾何並可供 cardSpawns 引用。

`cash_loss_or_freeze` 效果採 `amount` 和 `durationMs`，金額達門檻時扣款，否則套用凍結。`falling-traders.json` 定義隨機間隔、預警時間、速度、碰撞尺寸及 `effectIds`，命中沿用共用效果引擎。
