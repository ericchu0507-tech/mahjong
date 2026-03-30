// ==========================================
// client.js — 前端客戶端（登入/大廳/房間/Socket）
// ==========================================

// ── 狀態 ──
let authToken   = localStorage.getItem('mj_token') || null;
let currentUser = JSON.parse(localStorage.getItem('mj_user') || 'null');
let socket      = null;
let isReady     = false;

// ── API 基底 URL（自動偵測）──
const API = window.location.origin;

// ==========================================
// 頁面載入：自動登入或顯示登入畫面
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  if (authToken && currentUser) {
    connectSocket();
    showLobby();
  } else {
    showScreen('auth-overlay');
  }
});

// ==========================================
// 畫面切換
// ==========================================
function showScreen(id) {
  ['auth-overlay','lobby-overlay','room-overlay'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? 'flex' : 'none';
  });
  // game-container 是獨立處理
  const gc = document.getElementById('game-container');
  if (gc) gc.style.display = id === 'game' ? 'flex' : 'none';
}

function showLobby() {
  showScreen('lobby-overlay');
  document.getElementById('lobby-username').textContent = currentUser.username;
  document.getElementById('lobby-score').textContent = `$${currentUser.score}`;
  refreshLobby();
  loadLeaderboard();
}

// ==========================================
// 登入 / 註冊 Tab 切換
// ==========================================
function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('form-login').style.display    = tab === 'login'    ? 'flex' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'flex' : 'none';
}

// ==========================================
// 登入
// ==========================================
async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res  = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }

    saveAuth(data.token, data.user);
    connectSocket();
    showLobby();
  } catch {
    errEl.textContent = '連線失敗，請稍後再試';
  }
}

// ==========================================
// 註冊
// ==========================================
async function doRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('register-error');
  errEl.textContent = '';

  try {
    const res  = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }

    saveAuth(data.token, data.user);
    connectSocket();
    showLobby();
  } catch {
    errEl.textContent = '連線失敗，請稍後再試';
  }
}

function saveAuth(token, user) {
  authToken   = token;
  currentUser = user;
  localStorage.setItem('mj_token', token);
  localStorage.setItem('mj_user',  JSON.stringify(user));
}

// ==========================================
// 登出
// ==========================================
function doLogout() {
  authToken   = null;
  currentUser = null;
  localStorage.removeItem('mj_token');
  localStorage.removeItem('mj_user');
  if (socket) { socket.disconnect(); socket = null; }
  showScreen('auth-overlay');
}

// ==========================================
// Socket.io 連線
// ==========================================
function connectSocket() {
  if (socket) return;
  socket = io({ auth: { token: authToken } });

  socket.on('connect', () => console.log('[Socket] 已連線'));
  socket.on('connect_error', (err) => {
    console.warn('[Socket] 連線錯誤:', err.message);
    if (err.message === 'Token 無效') doLogout();
  });

  // 大廳：房間列表更新
  socket.on('lobby:list', renderRoomList);

  // 進入房間
  socket.on('room:joined', ({ room }) => {
    renderRoomScreen(room);
    showScreen('room-overlay');
  });

  // 房間狀態更新
  socket.on('room:update', ({ room }) => {
    renderRoomScreen(room);
  });

  // 遊戲開始
  socket.on('game:start', (data) => {
    console.log('[Game] 遊戲開始', data);
    // 單機模式暫時：隱藏房間，顯示遊戲
    showScreen('game');
    // 觸發現有單機遊戲邏輯（之後換成伺服器驅動）
    startSinglePlayerGame();
  });

  socket.on('error', ({ message }) => {
    alert('⚠️ ' + message);
  });
}

// ==========================================
// 大廳：刷新 + 排行榜
// ==========================================
function refreshLobby() {
  if (socket) socket.emit('lobby:list');
}

function renderRoomList(rooms) {
  const container = document.getElementById('room-list');
  if (!rooms || rooms.length === 0) {
    container.innerHTML = '<div class="room-empty">目前沒有開放的房間</div>';
    return;
  }
  container.innerHTML = rooms.map(r => `
    <div class="room-item" onclick="doJoinRoom('${r.id}')">
      <div class="room-item-name">${escHtml(r.name)}</div>
      <div class="room-item-info">
        <span>$${r.base_bet}/台</span>
        <span>${r.player_count}/4 人</span>
        <span class="room-host">${escHtml(r.host_name)}</span>
      </div>
    </div>
  `).join('');
}

async function loadLeaderboard() {
  try {
    const res  = await fetch(`${API}/api/auth/leaderboard`);
    const data = await res.json();
    const el   = document.getElementById('leaderboard');
    if (!data.users || data.users.length === 0) {
      el.innerHTML = '<div class="room-empty">暫無資料</div>';
      return;
    }
    el.innerHTML = data.users.map((u, i) => `
      <div class="lb-row ${u.id === currentUser?.id ? 'lb-me' : ''}">
        <span class="lb-rank">${i+1}</span>
        <span class="lb-name">${escHtml(u.username)}</span>
        <span class="lb-score">$${u.score}</span>
        <span class="lb-wins">${u.wins}勝</span>
      </div>
    `).join('');
  } catch {
    document.getElementById('leaderboard').innerHTML = '<div class="room-empty">載入失敗</div>';
  }
}

// ==========================================
// 房間操作
// ==========================================
function doCreateRoom() {
  if (!socket) return;
  const name    = document.getElementById('room-name').value.trim();
  const baseBet = document.getElementById('room-bet').value;
  socket.emit('room:create', { name, baseBet: Number(baseBet) });
}

function doJoinRoom(roomId) {
  if (!socket) return;
  socket.emit('room:join', { roomId });
}

function doLeaveRoom() {
  if (!socket) return;
  isReady = false;
  socket.emit('room:leave');
  showLobby();
}

function doReady() {
  if (!socket) return;
  isReady = !isReady;
  if (isReady) {
    socket.emit('room:ready');
    document.getElementById('btn-ready').textContent = '取消準備';
    document.getElementById('btn-ready').style.background = 'linear-gradient(135deg,#546e7a,#37474f)';
  } else {
    socket.emit('room:unready');
    document.getElementById('btn-ready').textContent = '準備好了！';
    document.getElementById('btn-ready').style.background = '';
  }
}

function renderRoomScreen(room) {
  if (!room) return;
  document.getElementById('room-title').textContent = room.name;
  document.getElementById('room-bet-display').textContent = `$${room.base_bet}/台`;

  const container = document.getElementById('room-players');
  const seats = [0, 1, 2, 3];
  container.innerHTML = seats.map(i => {
    const p = room.players[i];
    if (p) {
      const isMe = p.id === currentUser?.id;
      return `
        <div class="room-seat ${p.ready ? 'ready' : ''} ${isMe ? 'me' : ''}">
          <div class="seat-avatar">${isMe ? '😀' : '🀄'}</div>
          <div class="seat-name">${escHtml(p.username)}${isMe ? ' (你)' : ''}</div>
          <div class="seat-score">$${p.score}</div>
          <div class="seat-status">${p.ready ? '✅ 準備' : '⌛ 等待'}</div>
        </div>`;
    }
    return `<div class="room-seat empty"><div class="seat-empty">等待玩家...</div></div>`;
  }).join('');

  const readyCount = room.players.filter(p => p.ready).length;
  document.getElementById('room-hint').textContent =
    `${readyCount}/${room.players.length} 人準備，需要 4 人全部準備才能開始`;
}

// ==========================================
// 暫時：觸發單機遊戲（Phase 2 前的過渡）
// ==========================================
function startSinglePlayerGame() {
  // 隱藏所有 overlay，顯示遊戲畫面
  document.getElementById('start-overlay') && (document.getElementById('start-overlay').style.display = 'none');
  // 直接觸發現有的 startGame 邏輯（如果存在）
  if (typeof startGame === 'function') {
    document.getElementById('base-bet') && (document.getElementById('base-bet').value = '1');
    startGame();
  }
}

// ==========================================
// 工具
// ==========================================
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
