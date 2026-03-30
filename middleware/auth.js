// ==========================================
// middleware/auth.js — JWT 驗證中介層
// ==========================================
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '請先登入' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username }
    next();
  } catch {
    return res.status(401).json({ error: 'Token 無效或已過期，請重新登入' });
  }
}

module.exports = { requireAuth };
