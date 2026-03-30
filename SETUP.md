# 啟動說明

## 第一次設定

### 1. 安裝 Node.js
到 https://nodejs.org 下載 LTS 版本安裝

### 2. 安裝依賴套件
```
cd mahjong
npm install
```

### 3. 建立 .env 設定檔
複製 `.env.example` 為 `.env`，修改 JWT_SECRET：
```
JWT_SECRET=隨便打一段長字串當密鑰
PORT=3000
NODE_ENV=development
```

### 4. 啟動伺服器
```
npm start
```
或開發模式（檔案變更自動重啟）：
```
npm run dev
```

### 5. 開啟遊戲
瀏覽器前往：http://localhost:3000

---

## 部署到 Railway（線上版）

### 1. 安裝 Railway CLI
```
npm install -g @railway/cli
```

### 2. 建立帳號並登入
到 https://railway.app 建立免費帳號
```
railway login
```

### 3. 部署
```
cd mahjong
railway init
railway up
```

### 4. 設定環境變數
在 Railway 控制台設定：
- JWT_SECRET=你的密鑰
- NODE_ENV=production

### 注意
Railway 免費方案每月有使用時數限制。
SQLite 資料庫檔案需要設定 Railway Volume 才能持久保存。
