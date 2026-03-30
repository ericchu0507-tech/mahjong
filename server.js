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
  socket.on('room:create', ({ name, baseBet }) => {
    const db     = getDB();
    const user   = db.queryOne(u => u.id === socket.userId);
    const roomId = generateRoomId();
    const bet    = [1, 5, 10].includes(Number(baseBet)) ? Number(baseBet) : 1;

    const room = {
      id:      roomId,
      name:    name || `${socket.username}的房間`,
      baseBet: bet,
      status:  'waiting',
      hostId:  socket.userId,
      players: [{
        userId:   socket.userId,
        username: socket.username,
        score:    user?.score || 1000,
        ready:    false,
        socketId: socket.id,
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

    if (room.players.length === 4 && room.players.every(p => p.ready)) {
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
    status:   room.status,
    players:  room.players.map(p => ({
      id:       p.userId,
      username: p.username,
      score:    p.score,
      ready:    p.ready ? 1 : 0,
    })),
  };
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

function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.status = 'playing';
  io.to(roomId).emit('game:start', { roomId });
  io.emit('lobby:list', getLobbyList());
  console.log(`[Game] Room ${roomId} 遊戲開始`);
}

function handleGameAction(roomId, userId, data) {
  console.log(`[Game] Room ${roomId} Player ${userId}:`, data?.type);
}

// ==========================================
// 啟動
// ==========================================
getDB();
server.listen(PORT, () => {
  console.log(`\n🀄 台灣麻將伺服器已啟動`);
  console.log(`   本機：http://localhost:${PORT}\n`);
});
