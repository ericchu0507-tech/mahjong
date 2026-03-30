# 台灣麻將 — 專案記憶檔

## 專案簡介
純 HTML/CSS/JS 實作的台灣麻將遊戲（無框架），目標為四人連線麻將。

## 檔案結構
```
mahjong/
├── index.html       ← 主頁面（HTML 結構）
├── css/style.css    ← 所有樣式
├── js/tiles.js      ← 牌組定義、牌面渲染、洗牌、擲骰子
└── js/game.js       ← 遊戲狀態、發牌、出牌、輪流邏輯
```

## 核心架構

### 資料層（tiles.js）
- `createDeck()` — 建立 144 張牌組（萬/條/筒/字/花）
- `shuffleDeck()` — 洗牌
- `createTileElement(tile, faceDown, small)` — 建立牌的 DOM 元素
- `makeTongGraphic(value, small)` — 筒子同心圓圖案（3層：外環/中環/內點）
- `makeTiaoGraphic(value, small)` — 條子竹節圖案（一條=鸚鵡）
- `rollDice(count)` — 擲骰子
- `drawWinds()` / `findDealer(winds)` — 抽風決定莊家

### 狀態層（game.js）
- `gameState` 物件：
  - `players[4]` — 四位玩家（手牌、風位、籌碼、花牌、面子）
  - `deck[]` — 牌牆剩餘牌
  - `discardPiles[4]` — 各玩家棄牌
  - `currentPlayer` — 目前輪到誰（playerIndex）
  - `dealer` — 莊家 playerIndex（抽到東風的人）
  - `roundWind` — 圈風
  - `phase` — 遊戲階段（setup/dealing/playing/ended）
  - `seatMap` — visual位置→playerIndex（bottom/right/top/left）
  - `playOrder` — 出牌順序陣列（東→南→西→北的 playerIndex）

### 台灣麻將特有規則
- 每人起手 **16 張**（莊家先多摸1張開門）
- 胡牌 = **5面子 + 1對** = 17 張（含手上牌 + 摸/碰的那張）
- **吃**：只能吃上家棄牌（順子）
- **碰**：任何人棄牌皆可碰
- **明槓**：只能槓非上家的棄牌（上家棄牌只能吃/碰）
- **明槓後補牌不能自摸胡**
- **暗槓**：自己摸牌時手上已有4張，可暗槓，暗槓後可自摸胡

### 遊戲流程
1. 開始畫面 → 2. 抽風（決定東南西北）→ 3. 擲骰子（決定開門）→ 4. 發牌 → 5. 輪流出牌

### 風位與座位規則
- 抽到**東**的玩家 = 莊家，先出牌
- 座位（反時針）：東=底部 → 南=右 → 西=上 → 北=左
- `buildSeatMap()` 在抽風完成後呼叫，player0 永遠在底部
- `visualPosOf(playerIndex)` → 'bottom'|'right'|'top'|'left'
- `VISUAL_DISCARD_ID` = { bottom:0, top:1, right:2, left:3 }

### 抽風 UI
- 4張牌全部可點，玩家（player0）先選，AI 依序自動抽剩餘3張
- `finishWindDraw()` 完成後呼叫 `buildSeatMap()`

### 出牌順序
- 東→南→西→北（`gameState.playOrder`）
- `nextTurn()` 依 playOrder 輪轉

### 棄牌顯示
- `addDiscardToCenter()` 用 `visualPosOf()` 換算正確 DOM id
- DOM: discard-tiles-0=底部, 1=上方, 2=右方, 3=左方

### 莊家顯示
- `updatePlayerInfo()` 在莊家的 wind-badge 顯示「東 莊」
- `.wind-badge.dealer` CSS class（橘色）

### 牌牆
- 每面 18 堆，每堆 2 張疊放（下層 + 上層），共 4 面 72 堆 = 144 張
- 順時針從底部開始：bottom → right → top → left
- `renderWall()` 在發牌完成及每次摸牌後呼叫

### 棄牌區
- 每位玩家棄牌以 grid 6欄排列，由左至右、由上至下
- tile-small 尺寸 40×54px

## 牌的尺寸
- 手牌：66×90px
- 棄牌小牌：40×54px

## 牌的 CSS class 命名
- `.tile` — 所有牌的基底
- `.tile-small` — 棄牌區縮小版
- `.tile-back` — 牌背
- `.wan` / `.tiao` / `.tong` / `.zi` / `.flower` — 各花色
- `.drawn` — 剛摸進來的牌（橘色發光）
- `.selected` — 被選中的牌（上移）

## 用戶偏好
- 純 HTML/CSS/JS，不用框架
- 筒/條不需要顯示數字（玩家自己數圖案）
- 牌要夠大但不超出視窗寬度
- 改動前先說明計畫，確認再動手
- 用繁體中文溝通

## 已知待修 Bug
- **7筒**：排列錯誤（正確：頂部1顆紅 + 下方3排各2顆 = 1+2+2+2）
- **5條**：排列錯誤（正確：2+1+2，中間那根位置不對）
- **7條**：排列錯誤（正確：H形 = 兩側各3根 + 中排中間補1根）

## 待確認問題
- **「排強」** — 用戶說過但未解釋意思（排序按鈕？排行榜？）
