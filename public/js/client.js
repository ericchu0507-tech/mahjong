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
// naturalH 只量一次，之後快取，避免每次 action 都 reflow 閃爍
let _gameNaturalH = 0;

function measureAndScale() {
  const gc = document.getElementById('game-container');
  if (!gc) return;
  // 暫時移除 transform 量真實高度
  gc.style.transform = 'none';
  gc.style.left = '0';
  gc.style.top  = '0';
  requestAnimationFrame(() => {
    const h = gc.offsetHeight;
    if (h > 100) { _gameNaturalH = h; }
    applyScale();
  });
}

function applyScale() {
  const gc = document.getElementById('game-container');
  if (!gc || gc.style.display === 'none' || !_gameNaturalH) return;
  const LOGICAL_W = 2600;
  const scale  = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / _gameNaturalH, 1);
  const scaledW = LOGICAL_W * scale;
  const scaledH = _gameNaturalH * scale;
  gc.style.transform       = `scale(${scale})`;
  gc.style.transformOrigin = 'top left';
  gc.style.left            = `${(window.innerWidth  - scaledW) / 2}px`;
  gc.style.top             = `${(window.innerHeight - scaledH) / 2}px`;
}

function scaleGameToFit() {
  // 只有還沒量到高度時才重新量，其他時候直接套 scale（不 reflow，不閃）
  if (!_gameNaturalH) {
    measureAndScale();
  } else {
    applyScale();
  }
}

window.addEventListener('resize', () => {
  // 視窗大小改變時重新量高度
  _gameNaturalH = 0;
  measureAndScale();
});
// resize 已在 scaleGameToFit 定義區塊內處理

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
  // 開場動畫（抽風 + 骰子）
  socket.on('game:intro', (intro) => {
    showIntroAnimation(intro);
  });

  socket.on('game:start', (state) => {
    hideIntroAnimation();
    showScreen('game');
    _gameNaturalH = 0; // 每次開局重新量高度一次
    const gc = document.getElementById('game-container');
    if (gc) { gc.classList.add('entering'); setTimeout(() => gc.classList.remove('entering'), 600); }
    renderServerState(state);
  });

  // 暫時休息確認
  socket.on('game:temp_bot_on', () => {
    const btn = document.getElementById('btn-resume-game');
    if (btn) { btn.style.display = 'inline-block'; }
    const leaveBtn = document.getElementById('btn-leave-game-temp');
    if (leaveBtn) leaveBtn.textContent = '人機代打中…';
  });

  // 回來繼續
  socket.on('game:resumed', (state) => {
    const btn = document.getElementById('btn-resume-game');
    if (btn) { btn.style.display = 'none'; }
    const leaveBtn = document.getElementById('btn-leave-game-temp');
    if (leaveBtn) leaveBtn.textContent = '暫時休息';
    renderServerState(state);
  });

  // 遊戲狀態更新
  socket.on('game:state', (state) => {
    renderServerState(state);
  });

  // 有人胡牌
  socket.on('game:hu', (result) => {
    speakChinese('胡牌');
    showActionAnnounce('hu', result.winnerName || '');
    const mySeat     = window._myGameSeat || 0;
    const isSelf     = result.winnerSeat === mySeat;
    const winnerName = result.winnerName || '玩家';
    const title      = isSelf
      ? (result.isSelfDraw ? '自摸！' : '胡牌！')
      : `${winnerName} 胡牌了！`;

    // 翻開桌上其他玩家的手牌
    revealAllHands(result);

    // 台數與放槍資訊
    let payLine = `${result.reasons?.join('、') || '底台'}，共 ${result.tai} 台 × $${result.totalPay / result.tai} = $${result.totalPay}`;
    if (result.isSelfDraw) {
      payLine += '<br>自摸：三家各付';
    } else {
      payLine += `<br><span style="color:#ff6b6b;">放槍：${result.loserName || '?'}</span>`;
    }

    // 分數列（顯示誰贏誰輸）
    const scoreHtml = (result.scores || []).map((s, i) => {
      const name  = result.playerNames?.[i] || `玩家${i+1}`;
      const prev  = window._lastGameState?.players?.[i]?.score;
      const diff  = prev !== undefined ? s.score - prev : 0;
      const sign  = diff >= 0 ? `<span style="color:#4caf50;">+${diff}</span>` : `<span style="color:#f44336;">${diff}</span>`;
      const badge = i === result.winnerSeat ? '🏆' : i === result.loserSeat ? '🎯' : '';
      return `<span>${badge}${name}：$${s.score}（${sign}）</span>`;
    }).join('&nbsp;&nbsp;');

    // 建立牌型顯示（面子 + 排序後手牌）
    function buildTilesHtml(hand, melds, winningTile) {
      const SUIT_ORDER = { wan:0, tiao:1, tong:2, zi:3, flower:4 };
      const sorted = [...(hand || [])].sort((a, b) => {
        const sd = (SUIT_ORDER[a.suit]||0) - (SUIT_ORDER[b.suit]||0);
        if (sd) return sd;
        return (typeof a.value==='number' ? a.value : 99) - (typeof b.value==='number' ? b.value : 99);
      });
      let html = '<div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;align-items:flex-end;">';
      (melds || []).forEach(meld => {
        html += '<div style="display:flex;gap:1px;background:rgba(255,255,255,0.1);border-radius:4px;padding:2px;">';
        meld.tiles.forEach((tile, ti) => {
          const fd = (meld.type === 'angang') && (ti === 0 || ti === 3);
          html += createTileElement(tile, fd, true).outerHTML;
        });
        html += '</div>';
      });
      html += '<div style="display:flex;gap:1px;">';
      sorted.forEach(tile => {
        const el = createTileElement(tile, false, true);
        if (winningTile && tile.id === winningTile.id) {
          el.style.outline = '2px solid #ffcc02';
          el.style.outlineOffset = '2px';
        }
        html += el.outerHTML;
      });
      return html + '</div></div>';
    }

    // 所有玩家的牌型（贏家＋其他三家）
    let allHandsHtml = '';
    (result.allPlayers || []).forEach(pd => {
      const isWinner = pd.seat === result.winnerSeat;
      const isLoser  = pd.seat === result.loserSeat;
      const badge    = isWinner ? '🏆 ' : isLoser ? '🎯 ' : '';
      const color    = isWinner ? '#ffcc02' : isLoser ? '#ff6b6b' : '#ccc';
      allHandsHtml += `<div style="margin:6px 0;text-align:center;">
        <div style="font-size:13px;color:${color};font-weight:bold;margin-bottom:2px;">${badge}${pd.username}</div>
        ${buildTilesHtml(pd.hand, pd.melds, isWinner ? result.winningTile : null)}
      </div>`;
    });

    // 進程資訊（圈風 / 連莊）
    const prog = result.progression;
    window._gameProgression = prog;
    let progressLine = '';
    if (prog) {
      const RW = ['東','南','西','北'];
      const roundName  = (RW[prog.roundWindIdx] || '東') + '風圈';
      const streakText = prog.dealerStreak > 0 ? `連莊${prog.dealerStreak}` : '';
      const nextLabel  = prog.gameOver ? '一將完成！' : `下一局${streakText ? '（'+streakText+'）' : ''}`;
      progressLine = `<div style="font-size:12px;color:#aaa;text-align:center;margin-top:10px;">${roundName}　${nextLabel}</div>`;
    }

    // 更新下一局按鈕文字
    const continueBtn = document.getElementById('btn-continue-game');
    if (continueBtn) {
      continueBtn.textContent = prog?.gameOver ? '查看總結算' : '下一局';
    }

    document.getElementById('win-title').textContent = title;
    document.getElementById('win-detail').innerHTML  =
      payLine +
      '<div style="margin:10px 0;border-top:1px solid rgba(255,255,255,0.15);padding-top:8px;">' +
      allHandsHtml + '</div>' +
      '<div style="margin-top:8px;font-size:13px;">' + scoreHtml + '</div>' +
      progressLine;
    document.getElementById('win-overlay').style.display = 'flex';
  });

  // 留局/流局
  socket.on('game:ended', ({ reason, progression }) => {
    window._gameProgression = progression;
    const RW = ['東','南','西','北'];
    let progressLine = '';
    if (progression) {
      const roundName  = (RW[progression.roundWindIdx] || '東') + '風圈';
      const nextLabel  = progression.gameOver ? '一將完成！' : '下一局';
      progressLine = `<div style="font-size:12px;color:#aaa;margin-top:8px;">${roundName}　${nextLabel}</div>`;
    }
    const continueBtn = document.getElementById('btn-continue-game');
    if (continueBtn) {
      continueBtn.textContent = progression?.gameOver ? '查看總結算' : '下一局';
    }
    document.getElementById('win-title').textContent = reason === '留局' ? '留局' : '流局';
    document.getElementById('win-detail').innerHTML  = '牌已用完，重新開局' + progressLine;
    document.getElementById('win-overlay').style.display = 'flex';
  });

  // 讓人機接手 → 回大廳
  socket.on('game:surrendered', () => {
    hideIntroAnimation();
    showScreen('lobby');
    socket.emit('lobby:list');
  });

  socket.on('error', ({ message }) => {
    alert('⚠️ ' + message);
  });

  // 一將結束
  socket.on('game:tournament_end', ({ players }) => {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const MEDALS = ['🥇','🥈','🥉','  '];
    const COLORS  = ['#ffd700','#c0c0c0','#cd7f32','#888'];
    const STARTS  = 1000; // 起始積分

    const rows = sorted.map((p, i) => {
      const diff  = p.score - STARTS;
      const sign  = diff >= 0 ? `+${diff}` : `${diff}`;
      const color = diff >= 0 ? '#4caf50' : '#f44336';
      return `
        <div style="display:flex;align-items:center;gap:12px;margin:7px 0;
          background:rgba(255,255,255,0.06);border-radius:10px;padding:10px 16px;">
          <div style="font-size:28px;min-width:36px;text-align:center;">${MEDALS[i]}</div>
          <div style="flex:1;text-align:left;">
            <div style="font-size:15px;font-weight:bold;color:${COLORS[i]}">${escHtml(p.username)}</div>
            ${p.isBot ? '<div style="font-size:11px;color:#666;">人機</div>' : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:18px;font-weight:bold;">$${p.score}</div>
            <div style="font-size:12px;color:${color};">${sign}</div>
          </div>
        </div>`;
    }).join('');

    document.getElementById('win-title').textContent = '🎊 一將完成！';
    document.getElementById('win-detail').innerHTML  =
      `<div style="font-size:12px;color:#aaa;margin-bottom:6px;">最終排名（起始 $${STARTS}）</div>${rows}`;
    window._gameProgression = { gameOver: true };
    const continueBtn = document.getElementById('btn-continue-game');
    if (continueBtn) { continueBtn.style.display = ''; continueBtn.textContent = '開始下一將（重新抽風）'; }
    document.getElementById('win-overlay').style.display = 'flex';
  });

  // 按鈕接線：下一局 / 下一將 / 回大廳
  document.getElementById('btn-continue-game')?.addEventListener('click', () => {
    document.getElementById('win-overlay').style.display = 'none';
    const btn = document.getElementById('btn-continue-game');
    if (btn) { btn.textContent = '下一局'; btn.style.display = ''; }
    if (socket) socket.emit('room:next_round');
  });
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    document.getElementById('win-overlay').style.display = 'none';
    showLobby();
  });
}

// ==========================================
// 遊戲動作 — 送到伺服器
// ==========================================
function sendGameAction(type, extra = {}) {
  if (socket) socket.emit('game:action', { type, ...extra });
}

function onTempSurrender() {
  if (socket) socket.emit('game:temp_surrender');
}
function onResumeGame() {
  if (socket) socket.emit('game:resume');
}
function onSurrenderGame() {
  if (!confirm('確定永久離開遊戲？你的位置將由人機接手。')) return;
  if (socket) socket.emit('game:surrender');
}

// ==========================================
// 渲染伺服器狀態
// ==========================================
function renderServerState(state) {
  if (!state) return;

  // ── 出牌動畫：偵測到新棄牌時觸發 ──
  const prevDiscardId = window._lastPendingDiscardId;
  const currDiscardId = state.pendingDiscard?.id;
  if (currDiscardId && currDiscardId !== prevDiscardId) {
    const fromPlayer = state.players[state.pendingFromSeat];
    const fromName = fromPlayer?.userId === currentUser?.id
      ? '你'
      : (fromPlayer?.username || '?');
    showDiscardCenter(state.pendingDiscard, fromName);
    playTone('discard');
  }
  window._lastPendingDiscardId = currDiscardId ?? null;

  // ── 摸牌音效（換到我的回合且有 drawnTile）──
  if (state.phase === 'playing' && state.currentSeat === state.mySeat &&
      state.drawnTile && state.drawnTile?.id !== window._lastDrawnTileId) {
    playTone('draw');
    window._lastDrawnTileId = state.drawnTile.id;
  }

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

    const isCurrentTurn = seat === state.currentSeat && state.phase === 'playing';
    const emoji = getAvatar(p.userId);

    if (nameEl) {
      nameEl.textContent = (isMe ? '你' : p.username);
      // 更新 player-info 的 active-turn 樣式
      const infoEl = nameEl.closest('.player-info');
      if (infoEl) {
        infoEl.classList.toggle('active-turn', isCurrentTurn && !isMe);
        infoEl.classList.toggle('my-turn', isCurrentTurn && isMe);
      }
    }
    if (scoreEl) scoreEl.textContent = `$${p.score}`;
    if (windEl) {
      windEl.textContent = isDealer
        ? `${windNames[p.wind] || '?'} 莊`
        : (windNames[p.wind] || '?');
      windEl.classList.toggle('dealer', isDealer);
    }
    // 更新 avatar emoji + 動畫
    const avatarEl = nameEl?.closest('.player-info')?.querySelector('.avatar');
    if (avatarEl) {
      avatarEl.textContent = emoji;
      avatarEl.classList.toggle('active', isCurrentTurn);
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
        flowerEl.appendChild(createTileElement(tile, false, false));
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

  // 回合進程資訊（圈風 / 莊家 / 連莊）
  const roundInfoEl = document.getElementById('game-round-info');
  if (roundInfoEl) {
    const RW_NAMES = ['東','南','西','北'];
    const circleWind = RW_NAMES[state.roundWindIdx || 0] + '風圈';
    const dealerWind = windNames[state.players[state.dealer]?.wind] || '?';
    const streak     = state.dealerStreak || 0;
    const streakTxt  = streak > 0 ? ` 連${streak}` : '';
    roundInfoEl.textContent = `${circleWind} 莊：${dealerWind}${streakTxt}`;
  }

  // 剩餘牌數
  const deckCountEl = document.getElementById('deck-count');
  if (deckCountEl) deckCountEl.textContent = `剩 ${state.deckCount ?? '?'} 張`;

  // 動作提示 + 按鈕
  updateActionButtons(state);

  // ── 補花通知（花牌張數增加時）──
  if (!window._prevFlowerCounts) window._prevFlowerCounts = {};
  state.players.forEach(p => {
    const prev = window._prevFlowerCounts[p.userId] ?? -1;
    const curr = p.flowers?.length || 0;
    if (prev >= 0 && curr > prev) {
      const who = p.userId === currentUser?.id ? '你' : p.username;
      showToast(`🌸 ${who} 補花！`);
      playTone('flower');
    }
    window._prevFlowerCounts[p.userId] = curr;
  });

  // ── 吃碰槓公告（面子張數增加時）──
  if (!window._prevMeldCounts) window._prevMeldCounts = {};
  state.players.forEach(p => {
    const prev = window._prevMeldCounts[p.userId] ?? -1;
    const curr = p.melds?.length || 0;
    if (prev >= 0 && curr > prev) {
      const newMeld = p.melds?.[curr - 1];
      const type = newMeld?.type;
      const who = p.userId === currentUser?.id ? '你' : p.username;
      if (type === 'chi')  { showActionAnnounce('chi', who);  speakChinese('吃'); }
      if (type === 'peng') { showActionAnnounce('peng', who); speakChinese('碰'); }
      if (['gang','jiagang','angang'].includes(type)) { showActionAnnounce('gang', who); speakChinese('槓'); }
    }
    window._prevMeldCounts[p.userId] = curr;
  });

  // ── 聽牌提示（只顯示給自己）──
  const tenpaiEl = document.getElementById('tenpai-hint');
  if (tenpaiEl) {
    const waiting = state.tenpaiWaiting;
    if (waiting && waiting.length > 0) {
      const ZI_CH  = { dong:'東',nan:'南',xi:'西',bei:'北',zhong:'中',fa:'發',bai:'白' };
      const SUIT_CH = { wan:'萬', tiao:'條', tong:'筒' };
      const names = waiting.map(t =>
        t.suit === 'zi' ? (ZI_CH[t.value] || t.value) : `${t.value}${SUIT_CH[t.suit] || ''}`
      ).join('、');
      tenpaiEl.textContent = `聽牌 🀄 等待：${names}`;
      tenpaiEl.style.display = 'block';
    } else {
      tenpaiEl.style.display = 'none';
    }
  }

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
    // 槓牌檢查：暗槓（手上4張）或加槓（摸到碰牌的第四張）
    const drawn = state.drawnTile;
    const canAngang = myHand.some(tile =>
      myHand.filter(t => t.suit === tile.suit && t.value === tile.value).length >= 4
    );
    const canJiagang = drawn && me?.melds?.some(m =>
      m.type === 'peng' && m.tiles[0].suit === drawn.suit && m.tiles[0].value === drawn.value
    );
    if (canAngang || canJiagang) {
      const gangEl = document.getElementById('btn-gang');
      if (gangEl) gangEl.disabled = false;
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
        <span>底台${r.base_tai||3}台</span>
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
  const baseTai   = parseInt(document.getElementById('room-base-tai').value) || 3;
  const basePay   = parseInt(document.getElementById('room-base-pay').value) || 100;
  const ruleset   = document.getElementById('room-ruleset').value;
  const allowBots = document.getElementById('room-allow-bots').checked;
  socket.emit('room:create', { name, baseTai, basePay, ruleset, allowBots });
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
  document.getElementById('room-bet-display').textContent = `底台${room.base_tai||3}台 / 每台$${room.base_pay || 100}`;

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
// 15 秒倒數 Timer
// ==========================================
let _turnTimerInterval = null;
function startTurnTimer(seconds) {
  stopTurnTimer();
  const numEl  = document.getElementById('timer-num');
  const ringEl = document.getElementById('timer-ring');
  if (!numEl || !ringEl) return;

  const total = seconds;
  let remaining = total;
  const circ = 94.2;

  function tick() {
    numEl.textContent = remaining;
    const pct = remaining / total;
    ringEl.style.strokeDashoffset = circ * (1 - pct);
    const urgent = remaining <= 5;
    numEl.classList.toggle('urgent', urgent);
    ringEl.classList.toggle('urgent', urgent);
    if (remaining <= 0) { stopTurnTimer(); return; }
    remaining--;
  }
  tick();
  _turnTimerInterval = setInterval(tick, 1000);
}
function stopTurnTimer() {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  const numEl  = document.getElementById('timer-num');
  const ringEl = document.getElementById('timer-ring');
  if (numEl)  { numEl.textContent = ''; numEl.classList.remove('urgent'); }
  if (ringEl) { ringEl.style.strokeDashoffset = 0; ringEl.classList.remove('urgent'); }
}

// ==========================================
// 開場動畫（抽風 + 骰子）
// ==========================================
function showIntroAnimation(intro) {
  // 加入動畫 CSS
  if (!document.getElementById('intro-style')) {
    const s = document.createElement('style');
    s.id = 'intro-style';
    s.textContent = `
      @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
      @keyframes flipIn {
        0%   { transform: rotateY(90deg); opacity:0; }
        100% { transform: rotateY(0deg);  opacity:1; }
      }
      @keyframes diceRoll {
        0%,100% { transform: rotate(0deg); }
        25%     { transform: rotate(-15deg); }
        75%     { transform: rotate(15deg); }
      }
      .intro-wind-card {
        width:80px;height:110px;background:linear-gradient(145deg,#2e6da4,#1a4d7c);
        border:2px solid #5a9fd4;border-radius:10px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        font-size:48px;font-weight:900;color:#fff;
        transition:transform 0.15s;box-shadow:3px 5px 10px rgba(0,0,0,0.6);
      }
      .intro-wind-card:hover { transform:translateY(-8px); }
      .intro-wind-card.revealed {
        animation: flipIn 0.4s ease;
        cursor:default;
      }
      .intro-wind-card.revealed:hover { transform:none; }
      .intro-dice { font-size:56px; animation: diceRoll 0.3s ease infinite; }
      .intro-dice.settled { animation: none; }
    `;
    document.head.appendChild(s);
  }

  let el = document.getElementById('intro-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'intro-overlay';
    el.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.92);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      z-index:9999;gap:28px;color:#fff;font-family:inherit;`;
    document.body.appendChild(el);
  }

  const windNames   = { dong:'東', nan:'南', xi:'西', bei:'北' };
  const windColors  = { dong:'#e53935', nan:'#1565c0', xi:'#2e7d32', bei:'#555' };
  const diceFaces   = ['','⚀','⚁','⚂','⚃','⚄','⚅'];
  const diceSum     = intro.dice.reduce((a,b)=>a+b,0);
  // 用 userId 找自己的座位（排序後 players[0] 不一定是我）
  const myIdx       = intro.players.findIndex(p => p.userId === currentUser?.id);
  const myActualIdx = myIdx >= 0 ? myIdx : 0;
  const myWind      = intro.players[myActualIdx]?.wind;
  const myWindName  = windNames[myWind] || '?';

  // 第一階段：4張牌背，我點一張
  el.innerHTML = `
    <div style="font-size:26px;font-weight:900;color:#ffcc02;letter-spacing:3px;">✦ 抽風牌 ✦</div>
    <div style="font-size:15px;color:#aaa;">點擊一張牌抽取你的風位</div>
    <div id="intro-cards" style="display:flex;gap:20px;"></div>
    <div id="intro-result" style="min-height:60px;"></div>
  `;

  // 建立 4 張牌背，洗風的順序
  const winds = ['dong','nan','xi','bei'];
  // 把我的風放在隨機位置，其餘隨機排
  const others = intro.players.filter((_, i) => i !== myActualIdx).map(p => p.wind);
  const allWinds = [...others, myWind];
  // 隨機排列這 4 個風的顯示位置
  for (let i = allWinds.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [allWinds[i], allWinds[j]] = [allWinds[j], allWinds[i]];
  }

  const cardsEl = el.querySelector('#intro-cards');
  const resultEl = el.querySelector('#intro-result');
  let picked = false;

  allWinds.forEach((wind, i) => {
    const card = document.createElement('div');
    card.className = 'intro-wind-card';
    card.innerHTML = `<span style="font-size:32px;opacity:0.3;">?</span>`;
    card.addEventListener('click', () => {
      if (picked) return;
      picked = true;

      // 被點的那張永遠顯示玩家真實的風（myWind）
      // 其餘三張隨機分配其他人的風
      const otherWinds = intro.players.filter((_, idx) => idx !== myActualIdx).map(p => p.wind);
      for (let j = otherWinds.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [otherWinds[j], otherWinds[k]] = [otherWinds[k], otherWinds[j]];
      }
      const displayWinds = [];
      let oi = 0;
      for (let ci = 0; ci < 4; ci++) {
        displayWinds[ci] = (ci === i) ? myWind : otherWinds[oi++];
      }

      // 翻開所有牌
      cardsEl.querySelectorAll('.intro-wind-card').forEach((c, ci) => {
        const w = displayWinds[ci];
        const isMe = ci === i;
        setTimeout(() => {
          c.classList.add('revealed');
          c.style.background = `linear-gradient(145deg,${windColors[w]},${windColors[w]}aa)`;
          c.style.border = isMe ? '3px solid #ffcc02' : '2px solid rgba(255,255,255,0.2)';
          c.innerHTML = `<span style="font-size:52px;text-shadow:0 2px 8px rgba(0,0,0,0.5);">${windNames[w]}</span>`;
        }, ci * 180);
      });

      // 結果顯示玩家實際的風（myWind），停留 3 秒後進骰子
      const isDealer = myWind === 'dong';
      setTimeout(() => {
        resultEl.innerHTML = `
          <div style="text-align:center;font-size:20px;color:#ffcc02;font-weight:bold;">
            你抽到：<span style="font-size:32px;color:${windColors[myWind]};
              text-shadow:0 0 20px ${windColors[myWind]};">${myWindName}</span>
            ${isDealer ? ' 🎉 你是莊家！' : ''}
          </div>
        `;
        setTimeout(() => showDicePhase(el, intro, diceFaces, diceSum), 3000);
      }, 4 * 180 + 400);
    });
    cardsEl.appendChild(card);
  });
}

function showDicePhase(el, intro, diceFaces, diceSum) {
  const windNames = { dong:'東', nan:'南', xi:'西', bei:'北' };
  const windColors= { dong:'#e53935', nan:'#1565c0', xi:'#2e7d32', bei:'#555' };
  const dealer = intro.players[intro.dealer] || intro.players[0];

  el.innerHTML = `
    <div style="font-size:26px;font-weight:900;color:#ffcc02;letter-spacing:3px;">✦ 擲骰開門 ✦</div>
    <div style="font-size:15px;color:#aaa;margin-bottom:4px;">
      莊家 <span style="color:${windColors['dong']};font-weight:bold;">${dealer.username}</span> 擲骰
    </div>
    <div id="dice-row" style="display:flex;gap:20px;">
      ${intro.dice.map(()=>`<span class="intro-dice">${diceFaces[Math.ceil(Math.random()*6)]}</span>`).join('')}
    </div>
    <div id="dice-sum" style="font-size:18px;color:#aaa;min-height:28px;"></div>
    <div style="font-size:16px;color:#bbb;margin-top:8px;">各家風位</div>
    <div style="display:flex;gap:16px;">
      ${intro.players.map(p=>`
        <div style="text-align:center;">
          <div style="width:56px;height:56px;border-radius:50%;background:${windColors[p.wind]};
            display:flex;align-items:center;justify-content:center;font-size:28px;
            font-weight:900;margin:0 auto 6px;border:2px solid rgba(255,255,255,0.3);">
            ${windNames[p.wind]}
          </div>
          <div style="font-size:13px;color:#ffcc02;">${p.username}</div>
          ${p.wind==='dong'?'<div style="font-size:11px;background:#ff6f00;border-radius:6px;padding:1px 6px;margin-top:2px;">莊</div>':''}
        </div>`).join('')}
    </div>
    <div id="dice-waiting" style="font-size:13px;color:#666;animation:blink 1s infinite;margin-top:8px;">遊戲即將開始...</div>
  `;

  // 骰子滾動 1.5 秒後停止，停留 3 秒，然後通知 server 準備好了
  const diceEls = el.querySelectorAll('.intro-dice');
  setTimeout(() => {
    diceEls.forEach((d, i) => {
      d.classList.add('settled');
      d.textContent = diceFaces[intro.dice[i]];
    });
    el.querySelector('#dice-sum').textContent = `點數合計：${diceSum}`;
    const waiting = el.querySelector('#dice-waiting');
    if (waiting) waiting.textContent = '請記住各家風位...';

    // 停留 3 秒後告知 server 開始遊戲
    setTimeout(() => {
      if (waiting) waiting.textContent = '遊戲即將開始！';
      if (socket) socket.emit('game:ready');
    }, 3000);
  }, 1500);
}

// 翻開桌上所有玩家手牌（胡牌結算用）
function revealAllHands(result) {
  const state = window._lastGameState;
  if (!state || !result.allPlayers) return;
  const mySeat = state.mySeat;
  const seatToVisual = (seat) => {
    const diff = (seat - mySeat + 4) % 4;
    return ['bottom', 'right', 'top', 'left'][diff];
  };
  const VISUAL_HAND = { bottom: 'my-hand', top: 'hand-top', right: 'hand-right', left: 'hand-left' };
  const SUIT_ORDER  = { wan:0, tiao:1, tong:2, zi:3, flower:4 };

  result.allPlayers.forEach(pd => {
    if (pd.seat === mySeat) return; // 自己的牌已正常顯示
    const vpos  = seatToVisual(pd.seat);
    const handEl = document.getElementById(VISUAL_HAND[vpos]);
    if (!handEl) return;
    handEl.innerHTML = '';
    const sorted = [...(pd.hand || [])].sort((a, b) => {
      const sd = (SUIT_ORDER[a.suit]||0) - (SUIT_ORDER[b.suit]||0);
      if (sd) return sd;
      return (typeof a.value==='number' ? a.value : 99) - (typeof b.value==='number' ? b.value : 99);
    });
    sorted.forEach(tile => {
      handEl.appendChild(createTileElement(tile, false, true));
    });
  });
}

function hideIntroAnimation() {
  const el = document.getElementById('intro-overlay');
  if (el) el.remove();
}

// ==========================================
// 角色頭像 Emoji 分配（依 userId 固定）
// ==========================================
const AVATARS = ['😀','🤖','🐼','🦊','🐯','🐻','🐸','🦁'];
const _avatarMap = new Map();
let _avatarCounter = 0;
function getAvatar(userId) {
  if (!_avatarMap.has(userId)) {
    _avatarMap.set(userId, AVATARS[_avatarCounter++ % AVATARS.length]);
  }
  return _avatarMap.get(userId);
}

// ==========================================
// 出牌放大顯示（1 秒）
// ==========================================
let _discardCenterTimer = null;
function showDiscardCenter(tile, fromName) {
  const overlay = document.getElementById('discard-center-overlay');
  if (!overlay) return;
  if (_discardCenterTimer) clearTimeout(_discardCenterTimer);

  const nameEl = document.getElementById('discard-center-name');
  const tileEl = document.getElementById('discard-center-tile');
  if (nameEl) nameEl.textContent = fromName ? `${fromName} 出牌` : '';

  if (tileEl) {
    tileEl.innerHTML = '';
    const t = createTileElement(tile, false, false);
    t.classList.add('discard-center-anim');
    tileEl.appendChild(t);
  }

  overlay.classList.add('show');
  overlay.style.display = 'flex';

  _discardCenterTimer = setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('show');
  }, 1000);
}

// ==========================================
// 音效
// ==========================================
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

// 短音效（摸牌/出牌/補花 用合成音）
function playTone(type) {
  try {
    const ctx = getAudioCtx();
    const configs = {
      draw:    { freq: 480, waveType: 'triangle', dur: 0.07, vol: 0.15 },
      discard: { freq: 700, waveType: 'sine',     dur: 0.06, vol: 0.18 },
      flower:  { freq: [880,1100], waveType: 'triangle', dur: 0.2, vol: 0.15 },
      hu:      { freq: [523,659,784,1047], waveType: 'sine', dur: 0.7, vol: 0.25 },
    };
    const c = configs[type];
    if (!c) return;
    const now = ctx.currentTime;
    if (Array.isArray(c.freq)) {
      c.freq.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = c.waveType;
        const t0 = now + i * c.dur / c.freq.length;
        const t1 = now + (i+1) * c.dur / c.freq.length;
        o.frequency.setValueAtTime(f, t0);
        g.gain.setValueAtTime(c.vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t1);
        o.start(t0); o.stop(t1);
      });
    } else {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = c.waveType;
      o.frequency.setValueAtTime(c.freq, now);
      g.gain.setValueAtTime(c.vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + c.dur);
      o.start(now); o.stop(now + c.dur);
    }
  } catch (e) {}
}

// 中文語音播報（吃/碰/槓/胡）
function speakChinese(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-TW';
    utter.rate  = 1.1;
    utter.pitch = 1.1;
    utter.volume = 1.0;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

// ==========================================
// 吃碰槓胡 動作公告動畫
// ==========================================
let _announceTimer = null;
function showActionAnnounce(type, playerName) {
  const el = document.getElementById('action-announce');
  if (!el) return;
  if (_announceTimer) { clearTimeout(_announceTimer); el.innerHTML = ''; }

  const labels = { chi: '吃', peng: '碰', gang: '槓', hu: '胡' };
  const label = labels[type] || type;

  el.innerHTML = `
    <div class="action-badge ${type}">${label}</div>
    <div class="action-badge-name">${escHtml(playerName)}</div>
  `;
  _announceTimer = setTimeout(() => { el.innerHTML = ''; }, 1400);
}

// ==========================================
// Toast 通知
// ==========================================
let _toastTimer = null;
function showToast(msg, duration = 2200) {
  const el = document.getElementById('game-toast');
  if (!el) return;
  if (_toastTimer) { clearTimeout(_toastTimer); }
  el.textContent = msg;
  el.style.display = 'block';
  el.style.opacity = '1';
  _toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, duration);
}

// ==========================================
// 工具
// ==========================================
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
