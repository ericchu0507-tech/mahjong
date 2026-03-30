// ==========================================
// routes/auth.js — 帳號 API（註冊 / 登入 / 個人資料）
// ==========================================
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function validateUsername(s) {
  return s && /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(s);
}
function validateEmail(s) {
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function validatePassword(s) {
  return s && s.length >= 6;
}

// ==========================================
// POST /api/auth/register
// ==========================================
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!validateUsername(username))
      return res.status(400).json({ error: '用戶名 2-20 字（英數中文底線）' });
    if (!validateEmail(email))
      return res.status(400).json({ error: 'Email 格式不正確' });
    if (!validatePassword(password))
      return res.status(400).json({ error: '密碼至少 6 個字元' });

    const db = getDB();
    const exists = db.queryOne(u => u.username === username || u.email === email);
    if (exists) return res.status(409).json({ error: '用戶名或 Email 已被使用' });

    const hash = await bcrypt.hash(password, 10);
    const user = db.insertUser({ username, email, password: hash });

    res.json({ token: signToken(user), user: { id: user.id, username, score: 1000 } });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ==========================================
// POST /api/auth/login
// ==========================================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: '請輸入用戶名和密碼' });

    const db   = getDB();
    const user = db.queryOne(u => u.username === username || u.email === username);
    if (!user) return res.status(401).json({ error: '用戶不存在' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: '密碼錯誤' });

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, score: user.score, wins: user.wins, games: user.games }
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ==========================================
// GET /api/auth/me
// ==========================================
router.get('/me', requireAuth, (req, res) => {
  const db   = getDB();
  const user = db.queryOne(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: '找不到用戶' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

// ==========================================
// GET /api/auth/leaderboard
// ==========================================
router.get('/leaderboard', (req, res) => {
  const db    = getDB();
  const users = db.queryAll(null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ id, username, score, wins, games }) => ({ id, username, score, wins, games }));
  res.json({ users });
});

module.exports = router;
