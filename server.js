// ==========================================
// server.js — 主伺服器（Express + Socket.io）
// ==========================================
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const { getDB }  = require('./db/database');
const { MahjongGame, canWin, chiCombos, countSame } = require('./game/MahjongGame');

// gameInstances: Map<roomId, MahjongGame>
const gameInstances = new Map();
// pendingChiRequests: Map<roomId, { userId, tileIds, timer }>
const pendingChiRequests = new Map();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ==========================================
// 中介層
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// API 路由
// ==========================================
app.use('/api/auth', require('./routes/auth'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 房間狀態（純記憶體）
// rooms = Map<roomId, { id, name, baseBet, status, hostId, players: [] }>
// player = { userId, username, score, ready, socketId }
// ==========================================
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getLobbyList() {
  return [...rooms.values()]
    .filter(r => r.status === 'waiting')
    .map(r => ({
      id:           r.id,
      name:         r.name,
      base_bet:     r.baseBet,
      status:       r.status,
      player_count: r.players.length,
      host_name:    r.players[0]?.username || '?',
    }));
}

// ==========================================
// Socket.io — JWT 驗證
// ==========================================
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('未登入'));
  try {
    const payload    = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId    = payload.id;
    socket.username  = payload.username;
    next();
  } catch {
    next(new Error('Token 無效'));
  }
});

// ==========================================
// Socket.io — 連線事件
// ==========================================
io.on('connection', (socket) => {
  console.log(`[Socket] ${socket.username}(${socket.userId}) 連線`);

  // 取得大廳列表
  socket.on('lobby:list', () => {
    socket.emit('lobby:list', getLobbyList());
  });

  // 建立房間
  socket.on('room:create', ({ name, baseBet, basePay, ruleset, allowBots }) => {
    const db      = getDB();
    const user    = db.queryOne(u => u.id === socket.userId);
    const roomId  = generateRoomId();
    const bet     = [1, 5, 10].includes(Number(baseBet)) ? Number(baseBet) : 1;
    const pay     = Math.max(1, Math.min(99999, parseInt(basePay) || 100));
    const rules   = ['taiwan','american','hk'].includes(ruleset) ? ruleset : 'taiwan';

    const room = {
      id:         roomId,
      name:       name || `${socket.username}的房間`,
      baseBet:    bet,
      basePay:    pay,
      ruleset:    rules,
      allowBots:  allowBots !== false,
      status:     'waiting',
      hostId:     socket.userId,
      players: [{
        userId:   socket.userId,
        username: socket.username,
        score:    user?.score || 1000,
        ready:    false,
        socketId: socket.id,
        isBot:    false,
      }],
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.currentRoom = roomId;

    socket.emit('room:joined', { room: roomToClient(room) });
    io.emit('lobby:list', getLobbyList());
  });

  // 加入房間
  socket.on('room:join', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room)                  return socket.emit('error', { message: '房間不存在' });
    if (room.status !== 'waiting') return socket.emit('error', { message: '房間已開始' });
    if (room.players.length >= 4)  return socket.emit('error', { message: '房間已滿' });

    const already = room.players.find(p => p.userId === socket.userId);
    if (!already) {
      const db   = getDB();
      const user = db.queryOne(u => u.id === socket.userId);
      room.players.push({
        userId:   socket.userId,
        username: socket.username,
        score:    user?.score || 1000,
        ready:    false,
        socketId: socket.id,
      });
    }

    socket.join(roomId);
    socket.currentRoom = roomId;

    socket.emit('room:joined',  { room: roomToClient(room) });
    io.to(roomId).emit('room:update', { room: roomToClient(room) });
    io.emit('lobby:list', getLobbyList());
  });

  // 準備
  socket.on('room:ready', () => {
    const room = rooms.get(socket.currentRoom);
    if (!room) return;
    const p = room.players.find(p => p.userId === socket.userId);
    if (p) p.ready = true;

    io.to(room.id).emit('room:update', { room: roomToClient(room) });

    const minPlayers = 2; // 改成 4 正式四人對戰
    const humanPlayers = room.players.filter(p => !p.isBot);
    const allReady = humanPlayers.length >= minPlayers && humanPlayers.every(p => p.ready);
    const canFill  = humanPlayers.length >= 1 && humanPlayers.every(p => p.ready) && room.allowBots;
    if (allReady || canFill) {
      startGame(room.id);
    }
  });

  // 取消準備
  socket.on('room:unready', () => {
    const room = rooms.get(socket.currentRoom);
    if (!room) return;
    const p = room.players.find(p => p.userId === socket.userId);
    if (p) p.ready = false;
    io.to(room.id).emit('room:update', { room: roomToClient(room) });
  });

  // 離開房間
  socket.on('room:leave', () => leaveRoom(socket));

  // 遊戲動作（Phase 2）
  socket.on('game:action', (data) => {
    handleGameAction(socket.currentRoom, socket.userId, data);
  });

  // 斷線
  socket.on('disconnect', () => {
    console.log(`[Socket] ${socket.username} 斷線`);
    leaveRoom(socket);
  });
});

// ==========================================
// 工具
// ==========================================
function roomToClient(room) {
  return {
    id:       room.id,
    name:     room.name,
    base_bet: room.baseBet,
    base_pay: room.basePay || 100,
    ruleset:  room.ruleset || 'taiwan',
    status:   room.status,
    players:  room.players.filter(p => !p.isBot).map(p => ({
      id:       p.userId,
      username: p.username,
      score:    p.score,
      ready:    p.ready ? 1 : 0,
    })),
  };
}

// ── 人機自動出牌 ──
function scheduleBotTurnIfNeeded(roomId) {
  const game = gameInstances.get(roomId);
  const room = rooms.get(roomId);
  if (!game || !room || game.phase === 'ended') return;

  const currentPlayer = game.players[game.currentSeat];
  if (!currentPlayer) return;

  const roomPlayer = room.players.find(p => p.userId === currentPlayer.userId);
  if (!roomPlayer?.isBot) return;

  // 人機延遲 0.3 秒出牌
  setTimeout(() => {
    const g = gameInstances.get(roomId);
    const r = rooms.get(roomId);
    if (!g || !r || g.phase === 'ended') return;

    // 人機：用智慧出牌選孤張
    const botPlayer = g.players[g.currentSeat];
    if (!botPlayer) return;

    const toDiscard = botSmartDiscard(botPlayer.hand);
    if (!toDiscard) return;

    const result = g.discard(botPlayer.userId, toDiscard.id);
    if (result.error) return;

    broadcastGameState(r, g);
    // 人機出牌後同樣給真人 30 秒吃碰視窗
    scheduleNextTurn(roomId, result.tile, result.fromSeat, 30000);
  }, 400);
}

// ── Bot 吃碰決策 ──
function scheduleBotClaimIfNeeded(roomId) {
  const game = gameInstances.get(roomId);
  const room = rooms.get(roomId);
  if (!game || !room || game.phase !== 'waiting_response') return;
  if (!game.pendingDiscard) return;

  const discard     = game.pendingDiscard;
  const fromSeat    = game.pendingFromSeat;

  // 延遲 0.8 秒讓人類玩家先行動，再讓 bot 決策
  setTimeout(() => {
    const g = gameInstances.get(roomId);
    const r = rooms.get(roomId);
    if (!g || !r || g.phase !== 'waiting_response') return;

    // 先找能碰的 bot（任何座位）
    for (let seat = 0; seat < 4; seat++) {
      const p = g.players[seat];
      const rp = r.players.find(x => x.userId === p.userId);
      if (!rp?.isBot) continue;
      if (seat === fromSeat) continue;

      // 胡牌優先
      if (canWin([...p.hand, discard])) {
        const res = g.hu(p.userId);
        if (!res.error) {
          const db = getDB();
          res.scores.forEach(({ userId: uid, score }) => {
            db.updateUser(uid, { score });
          });
          io.to(roomId).emit('game:hu', { ...res, roomId });
          gameInstances.delete(roomId);
          r.status = 'waiting';
          return;
        }
      }

      // 碰牌
      if (countSame(p.hand, discard) >= 2) {
        const res = g.peng(p.userId);
        if (!res.error) {
          clearRoomTimer(roomId);
          broadcastGameState(r, g);
          // 碰完後 bot 需要出牌
          scheduleBotTurnIfNeeded(roomId);
          return;
        }
      }
    }

    // 再找能吃的 bot（只有下家）
    const nextSeat = (fromSeat + 1) % 4;
    const nextP = g.players[nextSeat];
    const nextRp = r.players.find(x => x.userId === nextP?.userId);
    if (nextRp?.isBot && g.phase === 'waiting_response') {
      const combos = chiCombos(nextP.hand, discard);
      if (combos.length > 0) {
        const tileIds = combos[0].map(t => t.id);
        const res = g.chi(nextP.userId, tileIds);
        if (!res.error) {
          clearRoomTimer(roomId);
          broadcastGameState(r, g);
          scheduleBotTurnIfNeeded(roomId);
          return;
        }
      }
    }

    // 沒有任何 bot 要吃碰：
    // 只要有任何真人玩家（非出牌者），就繼續等待讓玩家自己決定
    const hasHumanWaiting = r.players.some(rp => {
      if (rp.isBot) return false;
      const seat2 = g.players.findIndex(p => p.userId === rp.userId);
      return seat2 !== fromSeat;
    });

    if (!hasHumanWaiting) {
      // 全部是 bot，直接推進
      clearRoomTimer(roomId);
      advanceTurn(roomId);
    }
    // 有真人玩家 → 繼續等待，玩家自己按過/吃/碰/胡
  }, 800);
}

function botSmartDiscard(hand) {
  if (!hand || hand.length === 0) return null;
  let minScore = Infinity;
  let toDiscard = hand[0];
  hand.forEach((tile, idx) => {
    const sameCount = hand.filter((t, i) => i !== idx && t.suit === tile.suit && t.value === tile.value).length;
    let score = 0;
    if (sameCount >= 2) score = 6;
    else if (sameCount === 1) score = 4;
    else if (tile.suit !== 'zi' && tile.suit !== 'flower') {
      const v = tile.value;
      const adj = hand.filter((t, i) => i !== idx && t.suit === tile.suit &&
        (t.value === v-2 || t.value === v-1 || t.value === v+1 || t.value === v+2)).length;
      score = adj >= 2 ? 5 : adj >= 1 ? 2 : 0;
    }
    if (score < minScore) { minScore = score; toDiscard = tile; }
  });
  return toDiscard;
}

function leaveRoom(socket) {
  const roomId = socket.currentRoom;
  if (!roomId) return;
  socket.currentRoom = null;

  const room = rooms.get(roomId);
  if (!room) return;

  room.players = room.players.filter(p => p.userId !== socket.userId);
  socket.leave(roomId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
  } else {
    io.to(roomId).emit('room:update', { room: roomToClient(room) });
  }
  io.emit('lobby:list', getLobbyList());
}

const BOT_NAMES = ['電腦小明', '電腦小華', '電腦阿嬌', '電腦老王'];
let botIdCounter = -1;

function fillBotsIfNeeded(room) {
  if (!room.allowBots) return;
  let botCount = 0;
  while (room.players.length < 4) {
    const botId   = botIdCounter--;
    const botName = BOT_NAMES[botCount % BOT_NAMES.length];
    room.players.push({
      userId:   botId,
      username: botName,
      score:    1000,
      ready:    true,
      socketId: null,
      isBot:    true,
    });
    botCount++;
  }
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // 人數不足時補人機
  fillBotsIfNeeded(room);
  room.status = 'playing';

  const game = new MahjongGame(room);
  gameInstances.set(roomId, game);
  game.start();

  io.emit('lobby:list', getLobbyList());
  console.log(`[Game] Room ${roomId} 遊戲開始（${room.players.filter(p=>p.isBot).length} 個人機）`);

  // 先送抽風/骰子動畫資訊
  const intro = game.getIntroInfo();
  room.players.filter(p => !p.isBot).forEach(p => {
    io.to(p.socketId).emit('game:intro', intro);
  });

  // 4 秒後才正式開始（動畫結束）
  setTimeout(() => {
    const g = gameInstances.get(roomId);
    const r = rooms.get(roomId);
    if (!g || !r) return;
    r.players.filter(p => !p.isBot).forEach(p => {
      const state = g.getStateForPlayer(p.userId);
      io.to(p.socketId).emit('game:start', state);
    });
    scheduleBotTurnIfNeeded(roomId);
    scheduleAutoDiscard(roomId);
  }, 4000);
}

function handleGameAction(roomId, userId, data) {
  const game = gameInstances.get(roomId);
  const room = rooms.get(roomId);
  if (!game || !room) return;

  const { type } = data;
  let result;

  if (type === 'discard') {
    clearAutoDiscard(roomId);
    result = game.discard(userId, data.tileId);
    if (result.error) return sendError(userId, room, result.error);

    // 廣播出牌
    broadcastGameState(room, game);

    // 等待玩家吃碰槓胡（30 秒後自動推進）
    scheduleNextTurn(roomId, result.tile, result.fromSeat, 30000);

  } else if (type === 'pass') {
    clearRoomTimer(roomId);
    result = game.pass(userId);
    if (result.error) return sendError(userId, room, result.error);
    advanceTurn(roomId);

  } else if (type === 'peng') {
    clearRoomTimer(roomId);
    // 碰牌優先：取消任何待執行的吃牌
    const chiTimer = roomTimers.get(roomId + '_chi');
    if (chiTimer) { clearTimeout(chiTimer); roomTimers.delete(roomId + '_chi'); }
    pendingChiRequests.delete(roomId);
    result = game.peng(userId);
    if (result.error) return sendError(userId, room, result.error);
    broadcastGameState(room, game);
    scheduleAutoDiscard(roomId);

  } else if (type === 'chi') {
    clearRoomTimer(roomId);
    // 延遲 1.5 秒執行，讓碰牌有機會搶先
    const pending = { userId, tileIds: data.tileIds };
    pendingChiRequests.set(roomId, pending);
    const chiTimer = setTimeout(() => {
      const req = pendingChiRequests.get(roomId);
      if (!req || req !== pending) return; // 已被碰牌取消
      pendingChiRequests.delete(roomId);
      const g = gameInstances.get(roomId);
      const r = rooms.get(roomId);
      if (!g || !r) return;
      const res = g.chi(req.userId, req.tileIds);
      if (res.error) return sendError(req.userId, r, res.error);
      broadcastGameState(r, g);
      scheduleAutoDiscard(roomId);
    }, 1500);
    roomTimers.set(roomId + '_chi', chiTimer);
    return;

  } else if (type === 'gang') {
    clearRoomTimer(roomId);
    result = game.gang(userId, data.tileId);
    if (result.error) return sendError(userId, room, result.error);
    broadcastGameState(room, game);

  } else if (type === 'hu') {
    clearRoomTimer(roomId);
    result = game.hu(userId);
    if (result.error) return sendError(userId, room, result.error);

    // 更新資料庫分數
    const db = getDB();
    result.scores.forEach(({ userId: uid, score }) => {
      db.updateUser(uid, { score });
      if (uid === userId) db.updateUser(uid, { wins: (db.queryOne(u => u.id === uid)?.wins || 0) + 1 });
    });
    db.queryAll(null).forEach(u => db.updateUser(u.id, { games: (u.games || 0) + 1 }));

    io.to(roomId).emit('game:hu', { ...result, roomId });
    gameInstances.delete(roomId);
    if (room) room.status = 'waiting';
  }
}

// ── 定時器 ──
const roomTimers = new Map();
function clearRoomTimer(roomId) {
  if (roomTimers.has(roomId)) {
    clearTimeout(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }
}
function scheduleNextTurn(roomId, discardTile, fromSeat, delay) {
  clearRoomTimer(roomId);
  // bot 吃碰決策
  scheduleBotClaimIfNeeded(roomId);
  const timer = setTimeout(() => {
    const game = gameInstances.get(roomId);
    const room = rooms.get(roomId);
    if (!game || !room || game.phase === 'ended') return;
    advanceTurn(roomId);
  }, delay);
  roomTimers.set(roomId, timer);
}

function advanceTurn(roomId) {
  const game = gameInstances.get(roomId);
  const room = rooms.get(roomId);
  if (!game || !room) return;

  const result = game.nextTurn();
  if (result.ended) {
    io.to(roomId).emit('game:ended', { reason: result.reason });
    gameInstances.delete(roomId);
    if (room) room.status = 'waiting';
    return;
  }
  broadcastGameState(room, game);
  scheduleBotTurnIfNeeded(roomId);
  scheduleAutoDiscard(roomId);
}

// ── 15 秒自動出牌（真人超時） ──
const autoDiscardTimers = new Map();
function clearAutoDiscard(roomId) {
  if (autoDiscardTimers.has(roomId)) {
    clearTimeout(autoDiscardTimers.get(roomId));
    autoDiscardTimers.delete(roomId);
  }
}
function scheduleAutoDiscard(roomId) {
  clearAutoDiscard(roomId);
  const game = gameInstances.get(roomId);
  const room = rooms.get(roomId);
  if (!game || !room || game.phase !== 'playing') return;
  const currentPlayer = game.players[game.currentSeat];
  const roomPlayer = room.players.find(p => p.userId === currentPlayer?.userId);
  if (roomPlayer?.isBot) return;
  const seatSnapshot = game.currentSeat;
  const timer = setTimeout(() => {
    const g = gameInstances.get(roomId);
    const r = rooms.get(roomId);
    if (!g || !r || g.phase !== 'playing') return;
    if (g.currentSeat !== seatSnapshot) return;
    const player = g.players[g.currentSeat];
    if (!player?.hand?.length) return;
    const toDiscard = botSmartDiscard(player.hand);
    if (!toDiscard) return;
    const result = g.discard(player.userId, toDiscard.id);
    if (result.error) return;
    broadcastGameState(r, g);
    scheduleNextTurn(roomId, result.tile, result.fromSeat, 30000);
  }, 15000);
  autoDiscardTimers.set(roomId, timer);
}

function broadcastGameState(room, game) {
  room.players.forEach(p => {
    const state = game.getStateForPlayer(p.userId);
    io.to(p.socketId).emit('game:state', state);
  });
}

function sendError(userId, room, message) {
  const p = room.players.find(pl => pl.userId === userId);
  if (p) io.to(p.socketId).emit('error', { message });
}

// ==========================================
// 啟動
// ==========================================
getDB();
server.listen(PORT, () => {
  console.log(`\n🀄 台灣麻將伺服器已啟動`);
  console.log(`   本機：http://localhost:${PORT}\n`);
});
