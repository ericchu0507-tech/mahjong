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
  if (gc) {
    if (id === 'game') {
      gc.style.display = 'grid';
      requestAnimationFrame(scaleGameToFit);
    } else {
      gc.style.display = 'none';
      gc.style.transform = '';
      gc.style.left = '';
      gc.style.top = '';
    }
  }
}

// 自動縮放遊戲桌以符合螢幕大小
function scaleGameToFit() {
  const gc = document.getElementById('game-container');
  if (!gc || gc.style.display === 'none') return;

  const LOGICAL_W = 1300;
  const naturalH  = gc.scrollHeight || 900;

  const scaleX = window.innerWidth  / LOGICAL_W;
  const scaleY = window.innerHeight / naturalH;
  const scale  = Math.min(scaleX, scaleY, 1);

  const scaledW = LOGICAL_W * scale;
  const scaledH = naturalH  * scale;

  gc.style.transform       = `scale(${scale})`;
  gc.style.transformOrigin = 'top left';
  gc.style.left            = `${(window.innerWidth  - scaledW) / 2}px`;
  gc.style.top             = `${(window.innerHeight - scaledH) / 2}px`;
}
window.addEventListener('resize', scaleGameToFit);

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

  // 遊戲開始 — 伺服器發送初始狀態
  socket.on('game:start', (state) => {
    showScreen('game');
    renderServerState(state);
  });

  // 遊戲狀態更新
  socket.on('game:state', (state) => {
    renderServerState(state);
  });

  // 有人胡牌
  socket.on('game:hu', (result) => {
    const winnerPlayer = result.players
      ? result.players.find((_, i) => i === result.winnerSeat)
      : null;
    const winnerName = winnerPlayer?.username || '玩家';
    const isSelf = result.winnerSeat === (window._myGameSeat || 0);
    const title  = isSelf
      ? (result.isSelfDraw ? '🎉 你自摸！' : '🎉 你胡牌！')
      : `${winnerName} 胡牌了！`;

    const detail = [
      result.reasons?.join('、') || '',
      `共 ${result.tai} 台 × $${result.totalPay / result.tai} = $${result.totalPay}`,
      '─────',
      result.scores?.map(s => {
        const p = socket._roomPlayers?.find(pl => pl.userId === s.userId);
        return `${p?.username || s.userId}：$${s.score}`;
      }).join('　') || '',
    ].join('\n');

    document.getElementById('win-title').textContent = title;
    document.getElementById('win-detail').innerHTML  = detail.replace(/\n/g, '<br>');
    document.getElementById('win-overlay').style.display = 'flex';
  });

  // 留局/流局
  socket.on('game:ended', ({ reason }) => {
    document.getElementById('win-title').textContent = reason === '留局' ? '留局' : '流局';
    document.getElementById('win-detail').innerHTML  = '牌已用完，重新開局';
    document.getElementById('win-overlay').style.display = 'flex';
  });

  socket.on('error', ({ message }) => {
    alert('⚠️ ' + message);
  });
}

// ==========================================
// 遊戲動作 — 送到伺服器
// ==========================================
function sendGameAction(type, extra = {}) {
  if (socket) socket.emit('game:action', { type, ...extra });
}

// ==========================================
// 渲染伺服器狀態
// ==========================================
function renderServerState(state) {
  if (!state) return;
  window._lastGameState = state;
  window._myGameSeat    = state.mySeat;

  // 找出我的 visual 位置對應（我永遠在底部）
  // seat 0=東 1=南 2=西 3=北，但畫面上我在底部
  const mySeat = state.mySeat;
  // visual: bottom=我, right=下家, top=對家, left=上家
  const seatToVisual = (seat) => {
    const diff = (seat - mySeat + 4) % 4;
    return ['bottom', 'right', 'top', 'left'][diff];
  };

  // DOM id 映射
  const VISUAL_NAME  = { bottom: 'name-0', top: 'name-1', right: 'name-2', left: 'name-3' };
  const VISUAL_SCORE = { bottom: 'score-0', top: 'score-1', right: 'score-2', left: 'score-3' };
  const VISUAL_WIND  = { bottom: 'wind-0', top: 'wind-1', right: 'wind-2', left: 'wind-3' };
  const VISUAL_DISCARD = { bottom: 'discard-tiles-0', top: 'discard-tiles-1', right: 'discard-tiles-2', left: 'discard-tiles-3' };
  const VISUAL_HAND  = { bottom: 'my-hand', top: 'hand-top', right: 'hand-right', left: 'hand-left' };
  const VISUAL_MELDS = { bottom: 'my-melds', top: 'melds-top', right: 'melds-right', left: 'melds-left' };
  const VISUAL_FLOWERS = { bottom: 'flowers-bottom', top: 'flowers-top', right: 'flowers-right', left: 'flowers-left' };
  const windNames    = { dong: '東', nan: '南', xi: '西', bei: '北' };

  state.players.forEach((p, seat) => {
    const vpos = seatToVisual(seat);
    const isMe = seat === mySeat;
    const isDealer = seat === state.dealer;

    // 名字/分數/風位
    const nameEl  = document.getElementById(VISUAL_NAME[vpos]);
    const scoreEl = document.getElementById(VISUAL_SCORE[vpos]);
    const windEl  = document.getElementById(VISUAL_WIND[vpos]);
    if (nameEl)  nameEl.textContent  = isMe ? '你' : p.username;
    if (scoreEl) scoreEl.textContent = `$${p.score}`;
    if (windEl) {
      windEl.textContent = isDealer
        ? `${windNames[p.wind] || '?'} 莊`
        : (windNames[p.wind] || '?');
      windEl.classList.toggle('dealer', isDealer);
    }

    // 棄牌
    const discardEl = document.getElementById(VISUAL_DISCARD[vpos]);
    if (discardEl) {
      discardEl.innerHTML = '';
      (p.discards || []).forEach(tile => {
        discardEl.appendChild(createTileElement(tile, false, true));
      });
    }

    // 花牌
    const flowerEl = document.getElementById(VISUAL_FLOWERS[vpos]);
    if (flowerEl) {
      flowerEl.innerHTML = '';
      (p.flowers || []).forEach(tile => {
        flowerEl.appendChild(createTileElement(tile, false, true));
      });
    }

    // 面子
    const meldEl = document.getElementById(VISUAL_MELDS[vpos]);
    if (meldEl) {
      meldEl.innerHTML = '';
      (p.melds || []).forEach(meld => {
        const wrap = document.createElement('div');
        wrap.className = 'meld-group';
        meld.tiles.forEach((tile, i) => {
          const faceDown = meld.type === 'angang' && (i === 0 || i === 3);
          wrap.appendChild(createTileElement(tile, faceDown, true));
        });
        meldEl.appendChild(wrap);
      });
    }

    // 手牌
    const handEl = document.getElementById(VISUAL_HAND[vpos]);
    if (handEl) {
      handEl.innerHTML = '';
      if (isMe && p.hand) {
        // 自己的手牌：可點擊
        p.hand.forEach(tile => {
          const el = createTileElement(tile, false, false);
          const isDrawn = state.drawnTile && tile.id === state.drawnTile.id;
          if (isDrawn) el.classList.add('drawn');
          el.addEventListener('click', () => onMyTileClick(tile, el));
          el.addEventListener('dblclick', () => onMyTileDiscard(tile));
          handEl.appendChild(el);
        });
      } else {
        // 其他玩家：蓋牌
        for (let i = 0; i < p.handCount; i++) {
          handEl.appendChild(createTileElement({}, true, vpos !== 'bottom'));
        }
      }
    }
  });

  // 圓盤風向
  const roundWindEl = document.getElementById('round-wind');
  if (roundWindEl) roundWindEl.textContent = windNames[state.roundWind] || '東';

  // 動作提示 + 按鈕
  updateActionButtons(state);

  // 確保縮放正確（手牌渲染後重新量測）
  requestAnimationFrame(scaleGameToFit);
}

let _selectedTile = null;
function onMyTileClick(tile, el) {
  document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));
  _selectedTile = tile;
  el.classList.add('selected');
}
function onMyTileDiscard(tile) {
  const state = window._lastGameState;
  if (!state || state.currentSeat !== state.mySeat) return;
  sendGameAction('discard', { tileId: tile.id });
  _selectedTile = null;
}

function updateActionButtons(state) {
  const isMyTurn   = state.currentSeat === state.mySeat;
  const hasPending = !!state.pendingDiscard;
  const me         = state.players[state.mySeat];
  const myHand     = me?.hand || [];
  const hint       = document.getElementById('action-hint');

  // 隱藏所有按鈕
  ['btn-chi','btn-peng','btn-gang','btn-hu','btn-pass','btn-ting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });

  if (isMyTurn && !hasPending && state.phase === 'playing') {
    // 我的回合，出牌
    if (hint) hint.textContent = '你的回合！雙擊出牌';
    const passEl = document.getElementById('btn-pass');
    if (passEl) passEl.disabled = false;
    // 胡牌檢查（自摸）
    if (myHand.length % 3 === 2) {
      const huEl = document.getElementById('btn-hu');
      if (huEl) { huEl.disabled = false; }
    }
  } else if (hasPending && state.pendingFromSeat !== state.mySeat) {
    // 有人出牌，我可能可以吃碰槓胡
    const discard = state.pendingDiscard;
    const fromSeat = state.pendingFromSeat;
    const isUpstream = fromSeat === (state.mySeat + 3) % 4;

    const canPeng = myHand.filter(t => t.suit === discard.suit && t.value === discard.value).length >= 2;
    const canGang = !isUpstream && myHand.filter(t => t.suit === discard.suit && t.value === discard.value).length >= 3;
    const canChi  = isUpstream && chiCombosClient(myHand, discard).length > 0;
    const canHu   = canWinClient([...myHand, discard]);

    if (canChi || canPeng || canGang || canHu) {
      if (hint) hint.textContent = '你可以吃碰槓胡！';
      if (canChi)  document.getElementById('btn-chi').disabled  = false;
      if (canPeng) document.getElementById('btn-peng').disabled = false;
      if (canGang) document.getElementById('btn-gang').disabled = false;
      if (canHu)   document.getElementById('btn-hu').disabled   = false;
      document.getElementById('btn-pass').disabled = false;
    }
  } else if (!isMyTurn) {
    const currentPlayer = state.players[state.currentSeat];
    if (hint) hint.textContent = `${currentPlayer?.username || '?'} 的回合...`;
  }
}

// 前端簡化版 canWin（給按鈕判斷用）
function canWinClient(hand) {
  if (hand.length % 3 !== 2) return false;
  return checkWinClient(hand);
}
function checkWinClient(tiles) {
  if (tiles.length === 0) return true;
  if (tiles.length === 2) return tiles[0].suit === tiles[1].suit && tiles[0].value === tiles[1].value;
  if (tiles.length % 3 !== 2) return false;
  const sorted = [...tiles].sort((a,b)=>{
    const so={wan:0,tiao:1,tong:2,zi:3};
    return ((so[a.suit]||0)-(so[b.suit]||0)) || ((a.value||0)-(b.value||0));
  });
  const tried = new Set();
  for (let i = 0; i < sorted.length-1; i++) {
    const key = sorted[i].suit+'-'+sorted[i].value;
    if (tried.has(key)) continue; tried.add(key);
    const j = sorted.findIndex((t,idx)=>idx>i&&t.suit===sorted[i].suit&&t.value===sorted[i].value);
    if (j!==-1) {
      const rest = sorted.filter((_,idx)=>idx!==i&&idx!==j);
      if (checkMeldsClient(rest)) return true;
    }
  }
  return false;
}
function checkMeldsClient(tiles) {
  if (tiles.length===0) return true;
  const s=[...tiles].sort((a,b)=>{const so={wan:0,tiao:1,tong:2,zi:3};return((so[a.suit]||0)-(so[b.suit]||0))||((a.value||0)-(b.value||0));});
  const f=s[0];
  if(s.filter(t=>t.suit===f.suit&&t.value===f.value).length>=3){const r=[...s];let rem=3;for(let i=0;i<r.length&&rem>0;i++){if(r[i].suit===f.suit&&r[i].value===f.value){r.splice(i,1);i--;rem--;}}if(checkMeldsClient(r))return true;}
  if(f.suit!=='zi'&&f.suit!=='flower'){const r=[...s];const i1=r.findIndex(t=>t.suit===f.suit&&t.value===f.value+1);if(i1!==-1){const r2=[...r];r2.splice(i1,1);const i2=r2.findIndex(t=>t.suit===f.suit&&t.value===f.value+2);if(i2!==-1){const r3=[...r2];r3.splice(i2,1);r3.splice(r3.findIndex(t=>t===f),1);if(checkMeldsClient(r3))return true;}}}
  return false;
}
function chiCombosClient(hand, discard) {
  if (discard.suit==='zi'||discard.suit==='flower') return [];
  const combos=[]; const v=discard.value; const s=discard.suit;
  const has=(val)=>hand.find(t=>t.suit===s&&t.value===val);
  if(v>=3&&has(v-2)&&has(v-1))combos.push([has(v-2),has(v-1)]);
  if(v>=2&&v<=8&&has(v-1)&&has(v+1))combos.push([has(v-1),has(v+1)]);
  if(v<=7&&has(v+1)&&has(v+2))combos.push([has(v+1),has(v+2)]);
  return combos;
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
  const name      = document.getElementById('room-name').value.trim();
  const baseBet   = document.getElementById('room-bet').value;
  const ruleset   = document.getElementById('room-ruleset').value;
  const allowBots = document.getElementById('room-allow-bots').checked;
  socket.emit('room:create', { name, baseBet: Number(baseBet), ruleset, allowBots });
}

// ==========================================
// 規則說明 Modal
// ==========================================
function showRulesModal() {
  document.getElementById('rules-modal').style.display = 'flex';
}
function hideRulesModal() {
  document.getElementById('rules-modal').style.display = 'none';
}
function switchRulesTab(tab, btn) {
  ['taiwan','american','hk'].forEach(t => {
    document.getElementById(`rules-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.rules-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
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
// 吃/槓 需要選牌的動作
// ==========================================
function onClientChi() {
  const state   = window._lastGameState;
  if (!state) return;
  const discard = state.pendingDiscard;
  const me      = state.players[state.mySeat];
  if (!discard || !me?.hand) return;

  const combos = chiCombosClient(me.hand, discard);
  if (combos.length === 0) return;
  if (combos.length === 1) {
    sendGameAction('chi', { tileIds: combos[0].map(t => t.id) });
    return;
  }
  // 多種吃法：顯示選項
  const overlay = document.getElementById('chi-select-overlay');
  const opts    = document.getElementById('chi-select-options');
  if (!overlay || !opts) return;
  opts.innerHTML = '';
  combos.forEach(combo => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-chi';
    btn.style.margin = '4px';
    combo.forEach(tile => btn.appendChild(createTileElement(tile, false, true)));
    btn.addEventListener('click', () => {
      overlay.style.display = 'none';
      sendGameAction('chi', { tileIds: combo.map(t => t.id) });
    });
    opts.appendChild(btn);
  });
  overlay.style.display = 'flex';
}

function onClientGang() {
  const state = window._lastGameState;
  if (!state) return;
  if (_selectedTile) {
    sendGameAction('gang', { tileId: _selectedTile.id });
  } else {
    // 找手牌中有四張的
    const me = state.players[state.mySeat];
    const four = me?.hand?.find(tile =>
      me.hand.filter(t => t.suit === tile.suit && t.value === tile.value).length >= 4
    );
    if (four) sendGameAction('gang', { tileId: four.id });
  }
}

// ==========================================
// 工具
// ==========================================
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
