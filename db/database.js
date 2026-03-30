// ==========================================
// db/database.js — JSON 檔案儲存（不需要編譯）
// ==========================================
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data.json');

// 預設空資料結構
const DEFAULT = { users: [], nextUserId: 1 };

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT, null, 2));
      return { ...DEFAULT };
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { ...DEFAULT };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── 模擬 better-sqlite3 的介面，讓 routes/auth.js 幾乎不用改 ──
const db = {
  // 查詢單筆
  queryOne(filter) {
    const data = readDB();
    return data.users.find(filter) || null;
  },

  // 查詢多筆
  queryAll(filter, limit) {
    const data = readDB();
    let result = filter ? data.users.filter(filter) : [...data.users];
    if (limit) result = result.slice(0, limit);
    return result;
  },

  // 新增用戶
  insertUser({ username, email, password }) {
    const data = readDB();
    const id   = data.nextUserId++;
    const user = {
      id, username, email, password,
      score: 1000, wins: 0, games: 0,
      created_at: new Date().toISOString()
    };
    data.users.push(user);
    writeDB(data);
    return user;
  },

  // 更新用戶
  updateUser(id, fields) {
    const data = readDB();
    const idx  = data.users.findIndex(u => u.id === id);
    if (idx !== -1) Object.assign(data.users[idx], fields);
    writeDB(data);
  },
};

function getDB() {
  return db;
}

// 確保 data.json 存在
readDB();
console.log('[DB] JSON 資料庫就緒');

module.exports = { getDB };
