// ==========================================
// game/MahjongGame.js — 伺服器端遊戲引擎
// ==========================================

// ── 牌組定義 ──
const ZI_TILES    = ['dong','nan','xi','bei','zhong','fa','bai'];
const FLOWER_VALS = ['chun','xia','qiu','dong2','mei','lan','ju','zhu'];
const NUM_CH      = ['','一','二','三','四','伍','六','七','八','九'];
const SUIT_CH     = { wan:'萬', tiao:'條', tong:'筒' };
const ZI_CH       = { dong:'東',nan:'南',xi:'西',bei:'北',zhong:'中',fa:'發',bai:'白' };

function createDeck() {
  const deck = [];
  let id = 0;
  ['wan','tiao','tong'].forEach(suit => {
    for (let v = 1; v <= 9; v++) {
      for (let c = 0; c < 4; c++) {
        deck.push({ id: id++, suit, value: v, isFlower: false, isHonor: false,
          display: NUM_CH[v], subLabel: SUIT_CH[suit],
          label: NUM_CH[v] + SUIT_CH[suit] });
      }
    }
  });
  ZI_TILES.forEach(val => {
    for (let c = 0; c < 4; c++) {
      deck.push({ id: id++, suit: 'zi', value: val, isFlower: false, isHonor: true,
        display: ZI_CH[val], subLabel: '',
        label: ZI_CH[val] });
    }
  });
  FLOWER_VALS.forEach(val => {
    const disp = {chun:'春',xia:'夏',qiu:'秋',dong2:'冬',mei:'梅',lan:'蘭',ju:'菊',zhu:'竹'}[val];
    deck.push({ id: id++, suit: 'flower', value: val, isFlower: true, isHonor: false,
      display: disp, subLabel: '',
      label: disp });
  });
  return deck;
}

function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rollDice(count = 3) {
  const dice = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
  return { dice, total: dice.reduce((a, b) => a + b, 0) };
}

// ── 胡牌判斷 ──
function canWin(hand) {
  if (hand.length % 3 !== 2) return false;
  return checkWin(hand);
}

function checkWin(tiles) {
  if (tiles.length === 0) return true;
  if (tiles.length === 2)
    return tiles[0].suit === tiles[1].suit && tiles[0].value === tiles[1].value;
  if (tiles.length % 3 !== 2) return false;

  const sorted = sortTiles(tiles);
  const tried  = new Set();
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = sorted[i].suit + '-' + sorted[i].value;
    if (tried.has(key)) continue;
    tried.add(key);
    const j = sorted.findIndex((t, idx) => idx > i && t.suit === sorted[i].suit && t.value === sorted[i].value);
    if (j !== -1) {
      const rest = sorted.filter((_, idx) => idx !== i && idx !== j);
      if (checkMelds(rest)) return true;
    }
  }
  return false;
}

function checkMelds(tiles) {
  if (tiles.length === 0) return true;
  const sorted = sortTiles(tiles);
  const first  = sorted[0];

  // 刻子
  if (sorted.filter(t => t.suit === first.suit && t.value === first.value).length >= 3) {
    const rest = [...sorted]; let rem = 3;
    for (let i = 0; i < rest.length && rem > 0; i++) {
      if (rest[i].suit === first.suit && rest[i].value === first.value) { rest.splice(i, 1); i--; rem--; }
    }
    if (checkMelds(rest)) return true;
  }

  // 順子
  if (first.suit !== 'zi' && first.suit !== 'flower') {
    const rest = [...sorted];
    const i1 = rest.findIndex(t => t.suit === first.suit && t.value === first.value + 1);
    if (i1 !== -1) {
      const r2 = [...rest]; r2.splice(i1, 1);
      const i2 = r2.findIndex(t => t.suit === first.suit && t.value === first.value + 2);
      if (i2 !== -1) {
        const r3 = [...r2]; r3.splice(i2, 1);
        r3.splice(r3.findIndex(t => t === first), 1);
        if (checkMelds(r3)) return true;
      }
    }
  }
  return false;
}

function sortTiles(tiles) {
  const so = { wan: 0, tiao: 1, tong: 2, zi: 3, flower: 4 };
  return [...tiles].sort((a, b) => {
    const sd = (so[a.suit] || 0) - (so[b.suit] || 0);
    if (sd) return sd;
    const av = typeof a.value === 'number' ? a.value : ZI_TILES.indexOf(a.value);
    const bv = typeof b.value === 'number' ? b.value : ZI_TILES.indexOf(b.value);
    return av - bv;
  });
}

function countSame(hand, tile) {
  return hand.filter(t => t.suit === tile.suit && t.value === tile.value).length;
}

function chiCombos(hand, discard) {
  if (discard.suit === 'zi' || discard.suit === 'flower') return [];
  const combos = [];
  const v = discard.value;
  const s = discard.suit;
  const has = (val) => hand.find(t => t.suit === s && t.value === val);

  if (v >= 3 && has(v-2) && has(v-1)) combos.push([has(v-2), has(v-1), discard]);
  if (v >= 2 && v <= 8 && has(v-1) && has(v+1)) combos.push([has(v-1), discard, has(v+1)]);
  if (v <= 7 && has(v+1) && has(v+2)) combos.push([discard, has(v+1), has(v+2)]);
  return combos;
}

// ── 聽牌偵測 ──
function getAllTileTypes() {
  const types = [];
  ['wan','tiao','tong'].forEach(suit => {
    for (let v = 1; v <= 9; v++) types.push({ suit, value: v });
  });
  ZI_TILES.forEach(value => types.push({ suit: 'zi', value }));
  return types;
}

function getTenpaiWaiting(hand) {
  if (hand.length % 3 !== 1) return [];
  return getAllTileTypes().filter(({ suit, value }) => {
    const fake = { id: -1, suit, value, isFlower: false };
    return canWin([...hand, fake]);
  });
}

// ==========================================
// MahjongGame 類別
// ==========================================
class MahjongGame {
  constructor(room) {
    this.roomId  = room.id;
    this.baseBet = room.baseBet  || 1;
    this.basePay = room.basePay  || 100; // 每台金額

    // 四位玩家（依房間順序）
    this.players = room.players.map((p, i) => ({
      userId:   p.userId,
      username: p.username,
      score:    p.score || 1000,
      wind:     null,
      hand:     [],
      flowers:  [],
      melds:    [],
      seat:     i,      // 座位 0-3
    }));

    this.deck         = [];
    this.discardPiles = [[], [], [], []]; // index = seat
    this.currentSeat  = 0;   // 目前輪到的座位
    this.dealer       = 0;   // 莊家座位
    this.roundWind    = 'dong';
    this.phase        = 'setup';
    this.drawnTile    = null;
    this.pendingDiscard = null;
    this.pendingFromSeat = null;
    this.lastWinnerUserId = null;

    // 待響應玩家（等吃碰槓胡）
    this.waitingFor   = null; // userId
    this.waitingTimer = null;
  }

  // ── 工具 ──
  getSeat(userId) {
    return this.players.findIndex(p => p.userId === userId);
  }
  getPlayer(userId) {
    return this.players.find(p => p.userId === userId);
  }
  playerAt(seat) {
    return this.players[seat];
  }

  // ── 開始遊戲 ──
  start() {
    // 隨機決定風位
    const winds = ['dong','nan','xi','bei'];
    for (let i = winds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [winds[i], winds[j]] = [winds[j], winds[i]];
    }
    this.players.forEach((p, i) => { p.wind = winds[i]; });
    this.dealer = this.players.findIndex(p => p.wind === 'dong');
    this.currentSeat = this.dealer;

    // 骰子（三顆，決定開門）
    this.dice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    ];

    // 洗牌發牌
    this.deck = shuffleDeck(createDeck());
    this.dealTiles();
    this.phase = 'playing';

    return this.getPublicState();
  }

  // 回傳開場動畫資訊
  getIntroInfo() {
    const windNames = { dong:'東', nan:'南', xi:'西', bei:'北' };
    return {
      dice: this.dice,
      dealer: this.dealer,
      players: this.players.map(p => ({
        username: p.username,
        wind: p.wind,
        windName: windNames[p.wind],
      })),
    };
  }

  dealTiles() {
    // 每人先發 16 張
    for (let i = 0; i < 16; i++) {
      for (let s = 0; s < 4; s++) {
        const seat   = (this.dealer + s) % 4;
        const player = this.players[seat];
        const tile   = this.deck.shift();
        if (tile) player.hand.push(tile);
      }
    }
    // 處理花牌補牌
    this.players.forEach((p, seat) => {
      this._replaceFlowers(seat);
    });
    // 莊家多摸一張
    const t = this._drawTile(this.dealer);
    this.drawnTile = t;
    if (t && t.isFlower) {
      this.players[this.dealer].flowers.push(this.players[this.dealer].hand.pop());
      const rep = this._drawFromEnd(this.dealer);
      this.drawnTile = rep;
    }
  }

  _replaceFlowers(seat) {
    const player = this.players[seat];
    let changed = true;
    while (changed) {
      changed = false;
      const fi = player.hand.findIndex(t => t.isFlower);
      if (fi !== -1) {
        player.flowers.push(player.hand.splice(fi, 1)[0]);
        const rep = this._drawFromEnd(seat);
        if (rep) changed = true;
      }
    }
  }

  _drawTile(seat) {
    if (this.deck.length <= 16) return null; // 留局
    const tile = this.deck.shift();
    if (tile) this.players[seat].hand.push(tile);
    return tile;
  }

  _drawFromEnd(seat) {
    if (this.deck.length === 0) return null;
    const tile = this.deck.pop();
    if (tile) this.players[seat].hand.push(tile);
    return tile;
  }

  // ── 出牌 ──
  discard(userId, tileId) {
    const seat   = this.getSeat(userId);
    const player = this.players[seat];
    if (seat !== this.currentSeat) return { error: '還沒輪到你' };
    if (this.phase !== 'playing')  return { error: '目前不能出牌' };

    const tileIdx = player.hand.findIndex(t => t.id === tileId);
    if (tileIdx === -1) return { error: '找不到這張牌' };

    const tile = player.hand.splice(tileIdx, 1)[0];
    this.discardPiles[seat].push(tile);
    this.pendingDiscard  = tile;
    this.pendingFromSeat = seat;
    this.drawnTile = null;
    this.phase = 'waiting_response';

    return { ok: true, tile, fromSeat: seat };
  }

  // ── 過（放棄吃碰槓胡）──
  pass(userId) {
    if (this.waitingFor && this.waitingFor !== userId) return { error: '不是你的回合' };
    this.waitingFor = null;
    this.phase = 'playing';
    return { ok: true };
  }

  // ── 碰 ──
  peng(userId) {
    const seat   = this.getSeat(userId);
    const player = this.players[seat];
    const discard = this.pendingDiscard;
    if (!discard) return { error: '沒有待處理的牌' };
    if (countSame(player.hand, discard) < 2) return { error: '手牌不夠碰' };

    // 從手牌移除兩張相同牌，組成面子
    const meldTiles = [discard];
    let removed = 0;
    player.hand = player.hand.filter(t => {
      if (removed < 2 && t.suit === discard.suit && t.value === discard.value) {
        meldTiles.push(t);
        removed++;
        return false;
      }
      return true;
    });
    player.melds.push({ type: 'peng', tiles: meldTiles });

    // 從棄牌堆移除被碰的牌
    const fromPile = this.discardPiles[this.pendingFromSeat];
    const di = fromPile.findLastIndex ? fromPile.findLastIndex(t => t.id === discard.id)
      : [...fromPile].reverse().findIndex(t => t.id === discard.id);
    const realIdx = fromPile.findLastIndex
      ? di : (di === -1 ? -1 : fromPile.length - 1 - di);
    if (realIdx !== -1) fromPile.splice(realIdx, 1);

    this.pendingDiscard  = null;
    this.pendingFromSeat = null;
    this.currentSeat     = seat;
    this.phase = 'playing';
    return { ok: true, meld: { type: 'peng', tiles: meldTiles } };
  }

  // ── 吃 ──
  chi(userId, tileIds) {
    const seat   = this.getSeat(userId);
    const player = this.players[seat];
    const discard = this.pendingDiscard;
    if (!discard) return { error: '沒有待處理的牌' };

    // 驗證是否是上家
    const upstreamSeat = (seat + 3) % 4;
    if (this.pendingFromSeat !== upstreamSeat) return { error: '只能吃上家的牌' };

    const handTiles = tileIds.map(id => player.hand.find(t => t.id === id)).filter(Boolean);
    if (handTiles.length !== 2) return { error: '選牌錯誤' };

    // 移除這兩張
    handTiles.forEach(ht => {
      const idx = player.hand.findIndex(t => t.id === ht.id);
      if (idx !== -1) player.hand.splice(idx, 1);
    });

    const meldTiles = sortTiles([discard, ...handTiles]);
    player.melds.push({ type: 'chi', tiles: meldTiles });

    // 從棄牌堆移除被吃的牌
    const fromPile2 = this.discardPiles[this.pendingFromSeat];
    const di2 = fromPile2.map((t,i)=>i).reverse().find(i => fromPile2[i].id === discard.id);
    if (di2 !== undefined) fromPile2.splice(di2, 1);

    this.pendingDiscard  = null;
    this.pendingFromSeat = null;
    this.currentSeat     = seat;
    this.phase = 'playing';
    return { ok: true, meld: { type: 'chi', tiles: meldTiles } };
  }

  // ── 槓 ──
  gang(userId, tileId) {
    const seat   = this.getSeat(userId);
    const player = this.players[seat];

    // 我的回合（無待處理棄牌）
    if (!this.pendingDiscard) {
      const tile = player.hand.find(t => t.id === tileId);
      if (!tile) return { error: '找不到這張牌' };

      // 加槓：手上有對應碰牌
      const pengIdx = player.melds.findIndex(
        m => m.type === 'peng' && m.tiles[0].suit === tile.suit && m.tiles[0].value === tile.value
      );
      if (pengIdx !== -1) {
        player.hand = player.hand.filter(t => t.id !== tile.id);
        player.melds[pengIdx].type = 'jiagang';
        player.melds[pengIdx].tiles.push(tile);
        const drawn = this._drawFromEnd(seat);
        this.drawnTile = drawn;
        if (drawn && drawn.isFlower) {
          player.flowers.push(player.hand.pop());
          this.drawnTile = this._drawFromEnd(seat);
        }
        return { ok: true, type: 'jiagang', meld: player.melds[pengIdx], drawn: this.drawnTile };
      }

      // 暗槓：手牌有四張
      if (countSame(player.hand, tile) < 4) return { error: '手牌不夠暗槓' };
      const meldTiles = player.hand.filter(t => t.suit === tile.suit && t.value === tile.value);
      player.hand = player.hand.filter(t => !(t.suit === tile.suit && t.value === tile.value));
      player.melds.push({ type: 'angang', tiles: meldTiles });
      const drawn = this._drawFromEnd(seat);
      this.drawnTile = drawn;
      if (drawn && drawn.isFlower) {
        player.flowers.push(player.hand.pop());
        this.drawnTile = this._drawFromEnd(seat);
      }
      return { ok: true, type: 'angang', meld: { type: 'angang', tiles: meldTiles }, drawn: this.drawnTile };
    }

    // 明槓
    const discard = this.pendingDiscard;
    if (this.pendingFromSeat === (seat + 3) % 4) return { error: '不能槓上家的牌（只能吃/碰）' };
    if (countSame(player.hand, discard) < 3) return { error: '手牌不夠槓' };

    let removed = 0;
    const meldTiles = [discard];
    player.hand = player.hand.filter(t => {
      if (removed < 3 && t.suit === discard.suit && t.value === discard.value) {
        meldTiles.push(t); removed++; return false;
      }
      return true;
    });
    player.melds.push({ type: 'gang', tiles: meldTiles });

    const drawn = this._drawFromEnd(seat);
    this.drawnTile = drawn;
    if (drawn && drawn.isFlower) {
      player.flowers.push(player.hand.pop());
      this.drawnTile = this._drawFromEnd(seat);
    }

    this.pendingDiscard  = null;
    this.pendingFromSeat = null;
    this.currentSeat     = seat;
    this.phase = 'playing';
    return { ok: true, type: 'gang', meld: { type: 'gang', tiles: meldTiles }, drawn: this.drawnTile };
  }

  // ── 胡牌 ──
  hu(userId) {
    const seat   = this.getSeat(userId);
    const player = this.players[seat];
    const isSelfDraw = (this.pendingFromSeat === seat || !this.pendingDiscard);

    const handToCheck = this.pendingDiscard
      ? [...player.hand, this.pendingDiscard]
      : [...player.hand];

    if (!canWin(handToCheck)) return { error: '牌型無法胡牌' };

    const loserSeat = isSelfDraw ? null : this.pendingFromSeat;
    const { tai, reasons } = this.calcScore(seat, isSelfDraw, loserSeat);
    const totalPay = tai * this.basePay;

    if (isSelfDraw) {
      this.players.forEach((p, i) => {
        if (i !== seat) { p.score -= totalPay; player.score += totalPay; }
      });
    } else {
      const loser = this.players[loserSeat];
      loser.score  -= totalPay;
      player.score += totalPay;
    }

    this.lastWinnerUserId = userId;
    this.phase = 'ended';

    // 組合贏家手牌（包含胡的那張）
    const winnerHand = this.pendingDiscard
      ? [...player.hand, this.pendingDiscard]
      : [...player.hand];

    return {
      ok: true, isSelfDraw, tai, reasons,
      totalPay, loserSeat,
      winnerSeat: seat,
      winnerName:    player.username,
      loserName:     loserSeat !== null ? this.players[loserSeat].username : null,
      winnerHand,
      winnerMelds:   player.melds,
      winnerFlowers: player.flowers,
      winningTile:   this.pendingDiscard || this.drawnTile,
      playerNames:   this.players.map(p => p.username),
      scores: this.players.map(p => ({ userId: p.userId, score: p.score })),
      // 所有玩家的牌型（結算時展示）
      allPlayers: this.players.map((p, s) => ({
        seat: s, username: p.username,
        hand:    s === seat ? winnerHand : [...p.hand],
        melds:   p.melds,
        flowers: p.flowers,
      })),
    };
  }

  // ── 下一回合 ──
  nextTurn() {
    if (this.deck.length <= 16) {
      this.phase = 'ended';
      return { ended: true, reason: '留局' };
    }

    this.currentSeat = (this.currentSeat + 1) % 4;
    const player = this.players[this.currentSeat];
    const tile   = this._drawTile(this.currentSeat);

    if (!tile) {
      this.phase = 'ended';
      return { ended: true, reason: '留局' };
    }

    // 花牌補牌
    if (tile.isFlower) {
      player.flowers.push(player.hand.pop());
      const rep = this._drawFromEnd(this.currentSeat);
      this.drawnTile = rep;
    } else {
      this.drawnTile = tile;
    }

    this.pendingDiscard  = null;
    this.pendingFromSeat = null;
    this.phase = 'playing';
    return { ok: true, seat: this.currentSeat, drawn: this.drawnTile };
  }

  // ── 計分 ──
  calcScore(winnerSeat, isSelfDraw, loserSeat) {
    const winner  = this.players[winnerSeat];
    const allTiles = [...winner.hand];
    winner.melds.forEach(m => allTiles.push(...m.tiles));
    if (this.pendingDiscard) allTiles.push(this.pendingDiscard);

    let tai = 1;
    const reasons = ['底台 1台'];

    if (winner.melds.length === 0) { tai += 1; reasons.push('門前清 +1台'); }
    if (isSelfDraw)                 { tai += 1; reasons.push('自摸 +1台'); }
    if (winner.flowers.length > 0)  { tai += winner.flowers.length; reasons.push(`花牌×${winner.flowers.length} +${winner.flowers.length}台`); }

    const suits = allTiles.filter(t => !t.isFlower).map(t => t.suit);
    const uniqueSuits = [...new Set(suits)];
    if (uniqueSuits.length === 1 && uniqueSuits[0] !== 'zi') { tai += 4; reasons.push('清一色 +4台'); }
    if (uniqueSuits.length === 1 && uniqueSuits[0] === 'zi')  { tai += 4; reasons.push('字一色 +4台'); }
    if (uniqueSuits.filter(s => s !== 'zi').length === 1 && uniqueSuits.includes('zi')) { tai += 2; reasons.push('混一色 +2台'); }

    ['wan','tiao','tong'].forEach(suit => {
      const vals = allTiles.filter(t => t.suit === suit).map(t => t.value);
      if ([1,2,3,4,5,6,7,8,9].every(v => vals.includes(v))) {
        tai += 3; reasons.push(`一條龍 +3台`);
      }
    });

    return { tai, reasons };
  }

  // ── 給各玩家的狀態（隱藏他人手牌）──
  getStateForPlayer(userId) {
    const mySeat = this.getSeat(userId);
    return {
      phase:       this.phase,
      currentSeat: this.currentSeat,
      dealer:      this.dealer,
      roundWind:   this.roundWind,
      deckCount:   this.deck.length,
      pendingDiscard:  this.pendingDiscard,
      pendingFromSeat: this.pendingFromSeat,
      players: this.players.map((p, seat) => ({
        userId:   p.userId,
        username: p.username,
        score:    p.score,
        wind:     p.wind,
        flowers:  p.flowers,
        melds:    p.melds,
        discards: this.discardPiles[seat],
        handCount: p.hand.length,
        // 只有自己能看到手牌
        hand: seat === mySeat ? sortTiles(p.hand) : null,
      })),
      mySeat,
      myHand:   this.players[mySeat].hand,
      drawnTile: mySeat === this.currentSeat ? this.drawnTile : null,
    };
  }

  // ── 公開狀態（開局用）──
  getPublicState() {
    return {
      phase:     this.phase,
      dealer:    this.dealer,
      roundWind: this.roundWind,
      players:   this.players.map((p, seat) => ({
        userId:   p.userId,
        username: p.username,
        score:    p.score,
        wind:     p.wind,
        handCount: p.hand.length,
        flowers:  p.flowers,
        melds:    p.melds,
        discards: this.discardPiles[seat],
      })),
    };
  }

  // ── 給特定玩家的手牌資訊 ──
  getHandForPlayer(userId) {
    const player = this.getPlayer(userId);
    if (!player) return null;
    return {
      hand:      player.hand,
      drawnTile: this.drawnTile,
    };
  }
}

module.exports = { MahjongGame, canWin, chiCombos, countSame, getTenpaiWaiting };
