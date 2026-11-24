# 資料契約（啟動時以 zod 驗證）
characters: [{id,name,description,color,spriteKey,portrait}]，不含能力值。

events: [{id,title,description,fictional:true,weight,target,effectIds,icon}]；target = all/random_one/random_two/first_place/last_place。

effects: ID → discriminated union：
- `displacement {layers}`：依平台層級位移並 clamp。
- `momentum {layers,turns}`：接下來 turns 回合，節點每次爬升多 layers 層。
- `freeze {turns}`：停牌，期間進入的節點無效。
- `cash_loss_or_freeze {amount,turns}`：手持達 amount 扣款，否則停牌。
- `cash_gain {amount}`、`exposure {multiplier}`（下一次市場下滑倍率）、`shield {charges}`、`reveal_next_event`、`limit_loss {layers}`、`clear_negative`。

cards: [{id,name,description,weight,trigger,target,pool,effectIds,icon,color}]；trigger = manual/on_pickup；target = self/nearest_ahead；pool = public/recovery/both。無有效目標不得消耗卡片；即時卡目標必須為自己；補給池只含主動卡。

nodes.json: {lanes,maxLinks,attempts,kinds:{[id]:{name,detail,icon,color,effectIds,draw?,weight,fromRow}}}；draw = public（一般卡）/recovery（符合落後條件才發補給卡）；fromRow 為最早出現的列（0 起算）。

gameplay.json: turns、eventEvery、inventorySize、recoveryGapLayers、recoveryRanks，以及 newsMs、cardNewsMs、effectAnimationMs（只影響呈現）。cash.json: layersPerHundred、bonusCap。npc.json: choiceNoise、cardUseChance（依難度）、lookahead、cardValue、intelValue、shieldValue、exposurePenalty。market-states.json: 盤勢名稱與圖示。

map: {id,width,height,spawnPoints,finishPlatformId,platforms,ladders,ledges,zones}，只用於山路畫面與層數換算；驗證梯子、跳台與平台落點。

效果順序：市場利空先檢查避險（每次事件消耗一次），再套用槓桿倍率，最後停損上限，然後位移或狀態更新。驗證唯一 ID、正權重、引用存在、至少一種第 1 回合可出現的節點。
