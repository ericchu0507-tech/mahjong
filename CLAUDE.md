# 台灣麻將 — 專案記憶檔

## 專案簡介
Node.js + Express + Socket.io 多人連線台灣麻將，部署於 Render.com，GitHub 自動部署。

## 檔案結構
```
mahjong/
├── server.js              ← Express + Socket.io 主伺服器
├── game/MahjongGame.js    ← 遊戲引擎（計分/出牌/吃碰槓胡）
├── db/database.js         ← JSON 檔案資料庫（使用者帳號）
├── routes/auth.js         ← JWT 登入/註冊 API
├── public/
│   ├── index.html         ← 單頁應用主頁面
│   ├── css/style.css      ← 所有樣式（2600px 固定寬度 + CSS scale）
│   └── js/
│       ├── client.js      ← Socket.io 客戶端 + 渲染邏輯
│       └── tiles.js       ← 牌組定義 + 牌面 SVG/HTML 渲染
```

## 核心架構

### 座位與出牌順序
- 玩家依風位排序：**東(0)→南(1)→西(2)→北(3)**
- `start()` 發完風位後立即重新排序玩家陣列，確保 `(seat+1)%4` = 下家
- 玩家自己**永遠在畫面最下方**（bottom），下家右、對家上、上家左
- `seatToVisual(seat)` = diff → ['bottom','right','top','left']

### 遊戲流程
1. 建房（設底台、每台金額）→ 等人/補人機
2. 發 `game:intro`（抽風動畫）→ 玩家點牌抽風
3. 骰子動畫停 3 秒 → client 送 `game:ready` → server 送 `game:start`
4. 輪流出牌（真人 15 秒自動出牌；bot 0.8 秒）
5. 胡牌/留局 → 結算 → 連莊追蹤

### 關鍵 Socket 事件
| 事件 | 方向 | 說明 |
|------|------|------|
| `game:intro` | S→C | 抽風/骰子資訊 |
| `game:ready` | C→S | 動畫播完，開始遊戲 |
| `game:start` | S→C | 初始牌況 |
| `game:state` | S→C | 每次狀態更新 |
| `game:action` | C→S | 出牌/吃/碰/槓/胡/過 |
| `game:hu` | S→C | 胡牌結算（含所有人手牌） |
| `game:ended` | S→C | 留局/流局 |
| `game:temp_surrender` | C→S | 暫時休息（人機代打） |
| `game:surrender` | C→S | 永久離場 |
| `game:resume` | C→S | 回來繼續 |

### 防相公機制
- `discard()` 前：手牌必須 `% 3 === 2`
- `nextTurn()` 前：手牌必須 `% 3 === 1`
- `pass()` 後：`currentSeat` 維持在**出牌者**，`nextTurn` 才 +1 到正確下家

### 計分規則（台灣麻將）
- **底台**：房主設定（預設 3 台）
- **莊家台**：N=0（首局）+1；連莊N次 = +N（莊家）+N（拉莊）
- **圈風刻子** +1、**門風刻子** +1（可疊加）
- **花牌**：只有符合自己座位方位的花才算（東↔春/梅、南↔夏/蘭、西↔秋/竹、北↔冬/菊）
- **三元牌**：中/發/白 各刻子 +1，可疊加
- **門清** +1、**自摸** +1
- **混一色** +4、**清一色** +8、**字一色** +8
- **非莊家自摸**：莊家多付 1 台
- **放槍**：只有放槍者付款

### 吃碰優先級
- 碰/胡 優先於 吃
- bot 決策：先找能碰的 → 確認無人能碰才讓 bot 吃
- 真人按吃後延遲 1.5 秒執行，讓其他人有機會搶碰

### 牌面圖案（tiles.js）
- **七筒**：上方3顆左高右低斜排（藍藍紅）+ 下方2+2（紅）
- **六條**：3+3（兩排各3根）
- **七條**：1+3+3（頂1紅 + 兩排各3綠）
- **八條**：4+4（兩排各4根）
- **一條**：鸚鵡圖案

## 牌的尺寸
- 手牌：66×90px（CSS transform scale 到視窗）
- 棄牌小牌：tile-small（58×78px）

## 用戶偏好
- 純 HTML/CSS/JS + Node.js，不用前端框架
- 更動前說明計畫確認再動手
- 用繁體中文溝通
- **不要亂改沒說要改的地方**（寬度、字體等）
- 更新完自動 git push

## 部署
- Render.com 免費方案（手動 Deploy 觸發）
- GitHub repo: ericchu0507-tech/mahjong
- 冷啟動約 50 秒
