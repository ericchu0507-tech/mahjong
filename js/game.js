// ==========================================
// game.js — 遊戲狀態與基本邏輯（第一階段：UI 互動）
// ==========================================

// 遊戲狀態物件
const gameState = {
  players: [
    { id: 0, name: '你',   wind: null, score: 1000, hand: [], flowers: [], melds: [] },
    { id: 1, name: '玩家2', wind: null, score: 1000, hand: [], flowers: [], melds: [] },
    { id: 2, name: '玩家3', wind: null, score: 1000, hand: [], flowers: [], melds: [] },
    { id: 3, name: '玩家4', wind: null, score: 1000, hand: [], flowers: [], melds: [] },
  ],
  deck: [],
  discardPiles: [[], [], [], []],
  currentPlayer: 0,
  dealer: 0,
  roundWind: 'dong',
  phase: 'setup',
  selectedTile: null,
  baseBet: 1,
  drawnTile: null,
  pendingDiscard: null,
  pendingFrom: null,
  pendingAnGang: false,
  timeBankLeft: 3,       // 每局 time bank 次數
  isTing: false,         // 聽牌模式：電腦代打
  lastWinnerIdx: -1,     // 上一局勝者（-1=留局）
  // 座位映射：visual position → playerIndex
  // 'bottom'=player0(固定), 'right', 'top', 'left'
  seatMap: { bottom: 0, right: 1, top: 2, left: 3 },
  // 出牌順序（playerIndex 陣列，東→南→西→北）
  playOrder: [0, 1, 2, 3],
};

// ==========================================
// 初始化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-start-game').addEventListener('click', startGame);
  document.getElementById('btn-chi').addEventListener('click',  onChiClick);
  document.getElementById('btn-peng').addEventListener('click', onPengClick);
  document.getElementById('btn-gang').addEventListener('click', onGangClick);
  document.getElementById('btn-hu').addEventListener('click',   onHuClick);
  document.getElementById('btn-pass').addEventListener('click', onPassClick);
  document.getElementById('btn-timebank').addEventListener('click', onTimeBankClick);
  document.getElementById('btn-ting').addEventListener('click', onTingClick);
  document.getElementById('btn-play-again').addEventListener('click', () => {
    document.getElementById('win-overlay').style.display = 'none';
    stopTimer();
    document.getElementById('start-overlay').style.display = 'flex';
  });
  document.getElementById('btn-continue-game').addEventListener('click', () => {
    document.getElementById('win-overlay').style.display = 'none';
    stopTimer();
    continueNextRound();
  });
});

// ==========================================
// 計時器
// ==========================================
let timerInterval = null;
let timerSeconds  = 0;
const TIMER_TOTAL  = 94.2; // stroke-dasharray = 2π×15

function startTimer(seconds, onExpire) {
  stopTimer();
  timerSeconds = seconds;
  updateTimerUI(seconds, seconds);

  const ring    = document.getElementById('timer-ring');
  const numEl   = document.getElementById('timer-num');
  const bankBtn = document.getElementById('btn-timebank');
  bankBtn.disabled = gameState.timeBankLeft <= 0;

  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerUI(timerSeconds, seconds);
    if (timerSeconds <= 0) {
      stopTimer();
      onExpire();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const numEl = document.getElementById('timer-num');
  const ring  = document.getElementById('timer-ring');
  if (numEl) { numEl.textContent = ''; numEl.classList.remove('urgent'); }
  if (ring)  { ring.classList.remove('urgent'); ring.style.strokeDashoffset = 0; }
  const bankBtn = document.getElementById('btn-timebank');
  if (bankBtn) bankBtn.disabled = true;
}

function updateTimerUI(remaining, total) {
  const ring  = document.getElementById('timer-ring');
  const numEl = document.getElementById('timer-num');
  if (!ring || !numEl) return;

  const fraction = remaining / total;
  const offset   = TIMER_TOTAL * (1 - fraction);
  ring.style.strokeDashoffset = offset;
  numEl.textContent = remaining;

  const urgent = remaining <= 3;
  ring.classList.toggle('urgent', urgent);
  numEl.classList.toggle('urgent', urgent);
}

function onTimeBankClick() {
  if (gameState.timeBankLeft <= 0) return;
  gameState.timeBankLeft--;
  document.getElementById('timebank-count').textContent = gameState.timeBankLeft;
  document.getElementById('btn-timebank').disabled = gameState.timeBankLeft <= 0;
  // 在目前計時上加 10 秒
  timerSeconds += 10;
  updateTimerUI(timerSeconds, timerSeconds);
}

function startGame() {
  gameState.baseBet = parseInt(document.getElementById('base-bet').value);
  document.getElementById('start-overlay').style.display = 'none';
  showWindOverlay();
}

// ==========================================
// 抽風覆蓋層：玩家自選一張，AI 依序抽剩餘
// ==========================================
function showWindOverlay() {
  const overlay = document.getElementById('wind-overlay');
  const container = document.getElementById('wind-tiles');
  overlay.style.display = 'flex';
  container.innerHTML = '';

  const winds = drawWinds();
  const windNames  = { dong: '東', nan: '南', xi: '西', bei: '北' };
  const windColors = { dong: '#c62828', nan: '#1a3fcc', xi: '#1a3fcc', bei: '#1a3fcc' };

  // 記錄哪些牌已被抽走
  const taken = [false, false, false, false]; // taken[tileIdx] = true if claimed
  let playerTookIdx = -1;

  // 建立四張蓋牌，全部可點
  winds.forEach((wind, tileIdx) => {
    const tile = document.createElement('div');
    tile.classList.add('wind-tile');
    tile.dataset.tileIdx = tileIdx;

    tile.addEventListener('click', () => {
      if (playerTookIdx !== -1) return; // 玩家已選過
      if (taken[tileIdx]) return;

      taken[tileIdx] = true;
      playerTookIdx = tileIdx;

      // 立即翻開玩家選的牌
      revealTile(tile, winds[tileIdx], '你', windNames, windColors);
      document.getElementById('wind-instruction').textContent = 'AI 玩家抽牌中...';

      // AI 依序抽剩下三張（玩家2→玩家3→玩家4）
      const aiNames = ['玩家2', '玩家3', '玩家4'];
      let aiStep = 0;
      const remaining = [0,1,2,3].filter(i => !taken[i]);

      function aiPickNext() {
        if (aiStep >= 3) {
          // 全部抽完，指派風位並繼續
          finishWindDraw(winds, taken, playerTookIdx, windNames);
          return;
        }
        const pickIdx = remaining[aiStep];
        taken[pickIdx] = true;
        aiStep++;
        const tileEl = container.children[pickIdx];
        revealTile(tileEl, winds[pickIdx], aiNames[aiStep - 1], windNames, windColors);
        setTimeout(aiPickNext, 600);
      }
      setTimeout(aiPickNext, 600);
    });

    container.appendChild(tile);
  });

  document.getElementById('wind-instruction').textContent = '請點選任意一張牌，決定你的風位';
  document.getElementById('wind-result').textContent = '';
}

function revealTile(tileEl, wind, ownerName, windNames, windColors) {
  tileEl.classList.add('revealed');
  if (wind === 'dong') tileEl.classList.add('is-dong');
  tileEl.style.color = windColors[wind];
  tileEl.innerHTML = `${windNames[wind]}<span class="wind-owner">${ownerName}</span>`;
}

function finishWindDraw(winds, taken, playerTileIdx, windNames) {
  // 玩家0 = 人類，得到 winds[playerTileIdx]
  // AI 依選牌順序（taken order）得到其餘風
  const aiPlayers = [1, 2, 3];
  const aiOrder = [0,1,2,3].filter(i => i !== playerTileIdx); // 其他3張的 tileIdx

  gameState.players[0].wind = winds[playerTileIdx];
  aiOrder.forEach((tileIdx, i) => {
    gameState.players[aiPlayers[i]].wind = winds[tileIdx];
  });

  // 抽到東的玩家是莊家
  gameState.dealer = gameState.players.findIndex(p => p.wind === 'dong');
  gameState.currentPlayer = gameState.dealer;

  // 建立座位映射 & 出牌順序
  buildSeatMap();

  const myWind = windNames[gameState.players[0].wind];
  const dealerName = gameState.players[gameState.dealer].name;
  document.getElementById('wind-result').textContent =
    `你抽到【${myWind}】　莊家：${dealerName}（東風）`;

  setTimeout(() => {
    document.getElementById('wind-overlay').style.display = 'none';
    showDiceOverlay();
  }, 2000);
}

// ==========================================
// 座位映射 & 出牌順序（東→南→西→北）
// ==========================================
function buildSeatMap() {
  const windSeq = ['dong', 'nan', 'xi', 'bei'];

  // 找每個風對應的 playerIndex
  function playerWithWind(w) {
    return gameState.players.findIndex(p => p.wind === w);
  }

  // player 0 永遠在底部；其他位置依 player0 的風往後排
  const p0WindIdx = windSeq.indexOf(gameState.players[0].wind);
  gameState.seatMap = {
    bottom: 0,
    right:  playerWithWind(windSeq[(p0WindIdx + 1) % 4]),
    top:    playerWithWind(windSeq[(p0WindIdx + 2) % 4]),
    left:   playerWithWind(windSeq[(p0WindIdx + 3) % 4]),
  };

  // 出牌順序：東→南→西→北
  gameState.playOrder = windSeq.map(w => playerWithWind(w));
}

// 回傳 playerIndex 在畫面上的 visual key（'bottom'|'right'|'top'|'left'）
function visualPosOf(playerIndex) {
  const sm = gameState.seatMap;
  if (sm.bottom === playerIndex) return 'bottom';
  if (sm.right  === playerIndex) return 'right';
  if (sm.top    === playerIndex) return 'top';
  if (sm.left   === playerIndex) return 'left';
  return 'bottom';
}

// visual key → discard DOM id（'bottom'→0, 'top'→1, 'right'→2, 'left'→3）
const VISUAL_DISCARD_ID = { bottom: 0, top: 1, right: 2, left: 3 };

// ==========================================
// 骰子覆蓋層（莊家擲骰）
// ==========================================
function showDiceOverlay() {
  const overlay = document.getElementById('dice-overlay');
  overlay.style.display = 'flex';

  const dealer = gameState.players[gameState.dealer];
  const isHumanDealer = gameState.dealer === 0;
  document.getElementById('dice-result-text').textContent =
    `${dealer.name} 是莊家（東風）${isHumanDealer ? '，請擲骰子' : '，自動擲骰中...'}`;

  const btn = document.getElementById('btn-roll-dice');

  function doRoll() {
    const dies = document.querySelectorAll('.die');
    const faces = ['⚀','⚁','⚂','⚃','⚄','⚅'];
    dies.forEach(d => d.classList.add('rolling'));
    btn.disabled = true;

    setTimeout(() => {
      const result = rollDice(3);
      dies.forEach((d, i) => {
        d.classList.remove('rolling');
        d.textContent = faces[result.dice[i] - 1];
      });
      document.getElementById('dice-result-text').textContent =
        `${dealer.name} 擲出：${result.dice.join(' + ')} = ${result.total}　開門位置第 ${result.total} 疊`;

      setTimeout(() => {
        overlay.style.display = 'none';
        dealTiles(result.total);
      }, 1500);
    }, 700);
  }

  if (isHumanDealer) {
    btn.style.display = '';
    btn.disabled = false;
    // 移除舊監聽避免重複
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', doRoll);
  } else {
    btn.style.display = 'none';
    setTimeout(doRoll, 1000);
  }
}

// ==========================================
// 開始第一回合（莊家先打牌）
// ==========================================
function startFirstTurn() {
  const dealer = gameState.dealer;
  if (dealer === 0) {
    // 莊家是玩家自己：先摸一張（開門牌），然後打牌
    const tile = drawFromWall(0, true);
    if (tile && tile.isFlower) {
      gameState.players[0].flowers.push(gameState.players[0].hand.pop());
      const rep = drawFromWallEnd(0);
      gameState.drawnTile = rep;
    }
    renderMyHand();
    enableMyTurn();
    checkSelfDraw();
    checkAnGang();
    setHint('你是莊家！已摸開門牌，請打出一張牌');
  } else {
    setHint(`${gameState.players[dealer].name} 打牌中...`);
    setTimeout(() => autoPlay(dealer), 800);
  }
}


// ==========================================
// 第三步：發牌
// ==========================================
function dealTiles(diceTotal) {
  setHint('發牌中...');

  // 建立並洗牌
  const fullDeck = createDeck();   // 來自 tiles.js
  gameState.deck = shuffleDeck(fullDeck);

  // 分離花牌到牌牆尾端（簡化處理：直接混在牌牆裡，摸到再補）
  // 重置狀態
  gameState.isTing = false;
  gameState.tingOptions = [];
  gameState.tingWaiting = [];
  gameState.timeBankLeft = 3;
  document.getElementById('btn-ting').classList.remove('ting-active');
  document.getElementById('btn-ting').disabled = true;
  document.getElementById('timebank-count').textContent = 3;
  clearAllDisplays();

  // 清空手牌
  gameState.players.forEach(p => {
    p.hand = [];
    p.flowers = [];
    p.melds = [];
  });
  gameState.discardPiles = [[], [], [], []];

  // 發牌：從莊家開始，逆時針，每次4張，共4輪 → 每人16張
  const dealerIndex = gameState.dealer;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 4; i++) {
      const playerIndex = (dealerIndex + i) % 4;
      for (let t = 0; t < 4; t++) {
        drawFromWall(playerIndex, false); // false = 不顯示摸牌動畫
      }
    }
  }

  // 補花（從莊家開始）
  autoFlowerReplacement(() => {
    // 發牌完成，開始遊戲
    gameState.phase = 'playing';
    renderAllHands();
    updatePlayerInfo();
    setHint(`${gameState.players[gameState.dealer].name} 請打牌`);
    gameState.currentPlayer = gameState.dealer;

    // 開始第一回合
    startFirstTurn();
  });
}

// ==========================================
// 從牌牆摸一張牌
// ==========================================
function drawFromWall(playerIndex, markAsDrawn = true) {
  if (gameState.deck.length === 0) return null;

  // 從牌牆前端摸牌（花牌從尾端補）
  const tile = gameState.deck.shift();
  gameState.players[playerIndex].hand.push(tile);

  if (markAsDrawn) {
    gameState.drawnTile = tile;
  }

  return tile;
}

// 從牌牆尾端補牌（補花用）
function drawFromWallEnd(playerIndex) {
  if (gameState.deck.length === 0) return null;
  const tile = gameState.deck.pop();
  gameState.players[playerIndex].hand.push(tile);
  return tile;
}

// ==========================================
// 補花邏輯（遞迴）
// ==========================================
function autoFlowerReplacement(callback) {
  let needReplacement = false;

  // 從莊家開始順時針檢查
  for (let i = 0; i < 4; i++) {
    const playerIndex = (gameState.dealer + i) % 4;
    const player = gameState.players[playerIndex];
    const flowerIndices = player.hand
      .map((t, idx) => t.isFlower ? idx : -1)
      .filter(idx => idx !== -1);

    if (flowerIndices.length > 0) {
      needReplacement = true;
      // 移除花牌，放入花牌區，從尾端補牌
      flowerIndices.reverse().forEach(idx => {
        const flower = player.hand.splice(idx, 1)[0];
        player.flowers.push(flower);
        drawFromWallEnd(playerIndex);
      });
    }
  }

  if (needReplacement) {
    // 再次檢查補進來的牌是否還是花牌
    autoFlowerReplacement(callback);
  } else {
    callback();
  }
}

// ==========================================
// 渲染手牌
// ==========================================
function renderAllHands() {
  renderMyHand();
  renderOtherHands();
  renderAllMelds();
  renderAllFlowers();
}

// 渲染自己的手牌（玩家0）
function renderMyHand() {
  const container = document.getElementById('my-hand');
  container.innerHTML = '';

  const player = gameState.players[0];
  // 先排序手牌，再顯示
  const sorted = sortHand(player.hand);

  sorted.forEach((tile, index) => {
    const el = createTileElement(tile, false);

    // 最後一張是剛摸進來的牌，加上特殊標記
    if (tile === gameState.drawnTile) {
      el.classList.add('drawn');
    }

    el.addEventListener('click', () => onMyTileClick(tile, el));
    container.appendChild(el);
  });
}

// 渲染其他玩家（牌背），依座位映射
function renderOtherHands() {
  const sm = gameState.seatMap;
  renderBackHand('hand-top',   gameState.players[sm.top].hand.length,   false);
  renderBackHand('hand-right', gameState.players[sm.right].hand.length, true);
  renderBackHand('hand-left',  gameState.players[sm.left].hand.length,  true);
}

function renderBackHand(containerId, count, vertical) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.classList.add('tile', 'tile-back');
    if (vertical) el.classList.add('tile-vertical');
    container.appendChild(el);
  }
}

// ==========================================
// 手牌排序
// ==========================================
function sortHand(hand) {
  const suitOrder = { wan: 0, tiao: 1, tong: 2, zi: 3, flower: 4 };
  const ziOrder = { dong: 0, nan: 1, xi: 2, bei: 3, zhong: 4, fa: 5, bai: 6 };

  return [...hand].sort((a, b) => {
    const suitDiff = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitDiff !== 0) return suitDiff;
    if (a.suit === 'zi') return (ziOrder[a.value] || 0) - (ziOrder[b.value] || 0);
    return (a.value || 0) - (b.value || 0);
  });
}

// ==========================================
// 玩家操作：點擊手牌
// ==========================================
function onMyTileClick(tile, el) {
  if (gameState.currentPlayer !== 0) return;
  if (gameState.phase !== 'playing') return;

  // 如果已選中同一張牌 → 出牌
  if (gameState.selectedTile === tile) {
    playTile(tile);
    return;
  }

  // 取消上一張選中
  document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));

  // 選中這張牌
  gameState.selectedTile = tile;
  el.classList.add('selected');
}

// ==========================================
// 出牌
// ==========================================
function playTile(tile) {
  const player = gameState.players[0];
  const index = player.hand.indexOf(tile);
  if (index === -1) return;

  stopTimer();
  player.hand.splice(index, 1);
  gameState.discardPiles[0].push(tile);
  gameState.selectedTile = null;
  gameState.drawnTile = null;

  addDiscardToCenter(tile, 0);

  // 更新手牌顯示
  renderMyHand();
  disableMyTurn();

  // 先檢查 AI 是否胡牌，再輪到下一家
  if (checkAIWinAfterDiscard(tile, 0)) return;
  nextTurn();
}

// ==========================================
// 輪到下一玩家
// ==========================================
function nextTurn() {
  // 依東→南→西→北的 playOrder 輪轉
  const order = gameState.playOrder;
  const currentIdx = order.indexOf(gameState.currentPlayer);
  gameState.currentPlayer = order[(currentIdx + 1) % 4];

  const player = gameState.players[gameState.currentPlayer];
  setHint(`${player.name} 摸牌中...`);

  // 留局：剩 16 張以下不能摸
  if (gameState.deck.length <= 16) {
    setHint('留局！牌牆剩餘不足，無法繼續');
    stopTimer();
    setTimeout(() => showGameOverOverlay('留局'), 800);
    return;
  }

  if (gameState.currentPlayer === 0) {
    // 輪到自己摸牌
    const tile = drawFromWall(0, true);
    if (!tile) {
      setHint('流局！牌已摸完');
      return;
    }
    // 如果摸到花牌，自動補
    if (tile.isFlower) {
      player.flowers.push(player.hand.pop());
      const repTile = drawFromWallEnd(0);
      gameState.drawnTile = repTile;
      renderPlayerFlowers(0);
    }
    renderMyHand();

    if (gameState.isTing) {
      // 聽牌模式：先檢查自摸，否則自動打摸上來的牌
      if (canWin(player.hand)) {
        gameState.pendingDiscard = gameState.drawnTile;
        gameState.pendingFrom = 0;
        onHuClick();
      } else {
        setHint('聽牌中：自動打牌...');
        setTimeout(() => {
          const toDiscard = gameState.drawnTile || player.hand[player.hand.length - 1];
          if (toDiscard) playTile(toDiscard);
        }, 600);
      }
    } else {
      enableMyTurn();
      checkSelfDraw();
      checkAnGang();
      setHint('你的回合！請出一張牌（點兩下出牌）');
    }
  } else {
    // 電腦玩家自動出牌（暫時隨機）
    setTimeout(() => {
      autoPlay(gameState.currentPlayer);
    }, 800);
  }
}

// ==========================================
// AI 智慧出牌：評分後選孤張丟棄
// ==========================================
function aiSmartDiscard(hand) {
  function tileScore(tile, idx) {
    const sameCount = hand.filter((t, i) => i !== idx && t.suit === tile.suit && t.value === tile.value).length;
    if (sameCount >= 2) return 6; // 刻子
    if (sameCount === 1) return 4; // 對子

    if (tile.suit !== 'zi' && tile.suit !== 'flower') {
      const v = tile.value;
      const adj = hand.filter((t, i) => i !== idx && t.suit === tile.suit &&
        (t.value === v - 2 || t.value === v - 1 || t.value === v + 1 || t.value === v + 2)).length;
      if (adj >= 2) return 5; // 順子成形
      if (adj >= 1) return 2; // 相鄰單張
    }
    return 0; // 孤張
  }

  let minScore = Infinity;
  let toDiscard = hand[0];
  hand.forEach((tile, idx) => {
    const s = tileScore(tile, idx);
    if (s < minScore) { minScore = s; toDiscard = tile; }
  });
  return toDiscard;
}

// ==========================================
// AI 胡牌：放炮（別人打牌）
// ==========================================
function checkAIWinAfterDiscard(discard, fromPlayerIndex) {
  const order = gameState.playOrder;
  const fromIdx = order.indexOf(fromPlayerIndex);
  for (let offset = 1; offset <= 3; offset++) {
    const playerIdx = order[(fromIdx + offset) % 4];
    if (playerIdx === 0) continue;           // 玩家由 checkActionsAfterDiscard 處理
    if (playerIdx === fromPlayerIndex) continue;
    const ai = gameState.players[playerIdx];
    if (canWin([...ai.hand, discard])) {
      ai.hand.push(discard);                 // 把打出的牌給 AI
      executeAIWin(playerIdx, fromPlayerIndex);
      return true;
    }
  }
  return false;
}

function executeAIWin(winnerIdx, loserIdx) {
  const winner = gameState.players[winnerIdx];
  const loser  = gameState.players[loserIdx];
  gameState.phase = 'ended';
  stopTimer();
  const { tai, reasons } = calcScore(winnerIdx, false, loserIdx);
  const totalPay = tai * gameState.baseBet;
  loser.score  -= totalPay;
  winner.score += totalPay;
  gameState.lastWinnerIdx = winnerIdx;
  const detail = [
    reasons.join('、'),
    `共 ${tai} 台 × $${gameState.baseBet} = $${totalPay}`,
    `${loser.name} 付 $${totalPay}`,
    '─────',
    gameState.players.map(p => `${p.name}：$${p.score}`).join('　'),
  ].join('\n');
  document.getElementById('win-title').textContent  = `🎉 ${winner.name} 胡牌！`;
  document.getElementById('win-detail').innerHTML   = detail.replace(/\n/g, '<br>');
  document.getElementById('win-overlay').style.display = 'flex';
}

function executeAISelfDraw(winnerIdx) {
  const winner = gameState.players[winnerIdx];
  gameState.phase = 'ended';
  stopTimer();
  const { tai, reasons } = calcScore(winnerIdx, true, winnerIdx);
  const totalPay = tai * gameState.baseBet;
  gameState.players.forEach((p, i) => {
    if (i !== winnerIdx) { p.score -= totalPay; winner.score += totalPay; }
  });
  gameState.lastWinnerIdx = winnerIdx;
  const detail = [
    reasons.join('、'),
    `共 ${tai} 台 × $${gameState.baseBet} = $${totalPay}`,
    `自摸！每人付 $${totalPay}`,
    '─────',
    gameState.players.map(p => `${p.name}：$${p.score}`).join('　'),
  ].join('\n');
  document.getElementById('win-title').textContent  = `🎉 ${winner.name} 自摸！`;
  document.getElementById('win-detail').innerHTML   = detail.replace(/\n/g, '<br>');
  document.getElementById('win-overlay').style.display = 'flex';
}

// ==========================================
// 電腦自動出牌
// ==========================================
function autoPlay(playerIndex) {
  const player = gameState.players[playerIndex];

  // 留局：剩 16 張以下不能摸
  if (gameState.deck.length <= 16) {
    setHint('留局！牌牆剩餘不足，無法繼續');
    stopTimer();
    setTimeout(() => showGameOverOverlay('留局'), 800);
    return;
  }

  // 先摸牌
  const tile = drawFromWall(playerIndex);
  if (!tile) {
    setHint('流局！');
    return;
  }

  // 如果是花牌，補牌並顯示
  if (tile.isFlower) {
    player.flowers.push(player.hand.pop());
    drawFromWallEnd(playerIndex);
    renderPlayerFlowers(playerIndex);
  }

  // 摸牌後先判斷 AI 自摸胡
  if (canWin(player.hand)) {
    setTimeout(() => executeAISelfDraw(playerIndex), 600);
    return;
  }

  // 智慧出牌：選孤張打出
  const discarded = aiSmartDiscard(player.hand);
  const discIdx = player.hand.indexOf(discarded);
  player.hand.splice(discIdx, 1);
  gameState.discardPiles[playerIndex].push(discarded);

  // 顯示棄牌
  addDiscardToCenter(discarded, playerIndex);
  setHint(`${player.name} 打出：${discarded.label}`);

  // 先檢查其他 AI 胡牌（高優先），再檢查玩家吃碰槓胡
  setTimeout(() => {
    if (checkAIWinAfterDiscard(discarded, playerIndex)) return;
    checkActionsAfterDiscard(discarded, playerIndex);
    if (gameState.phase !== 'waiting_action') {
      nextTurn();
    }
  }, 600);
}

// ==========================================
// 棄牌顯示到對應玩家區域（依視覺座位）
// ==========================================
function addDiscardToCenter(tile, playerIndex) {
  const vpos = visualPosOf(playerIndex);
  const domId = VISUAL_DISCARD_ID[vpos];
  const container = document.getElementById(`discard-tiles-${domId}`);
  if (!container) return;
  const el = createTileElement(tile, false, true);
  container.appendChild(el);
}

// ==========================================
// 啟用/禁用自己的出牌模式
// ==========================================
function enableMyTurn() {
  document.getElementById('btn-pass').disabled = false;

  // 聽牌偵測：只有真正聽牌才顯示按鈕
  if (!gameState.isTing) {
    const hand = gameState.players[0].hand;
    const tingOpts = getTingOptions(hand);
    if (tingOpts.length > 0) {
      gameState.tingOptions = tingOpts;
      document.getElementById('btn-ting').disabled = false;
    } else {
      gameState.tingOptions = [];
      document.getElementById('btn-ting').disabled = true;
    }
  }

  // 摸打計時：10 秒，超時自動打剛摸的牌
  startTimer(10, () => {
    if (gameState.currentPlayer !== 0 || gameState.phase !== 'playing') return;
    const hand = gameState.players[0].hand;
    const toDiscard = gameState.drawnTile || hand[hand.length - 1];
    if (toDiscard) playTile(toDiscard);
  });
}

function disableMyTurn() {
  gameState.selectedTile = null;
  document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));
  document.getElementById('btn-pass').disabled = true;
  document.getElementById('btn-ting').disabled = true;
}

// ==========================================
// 更新玩家資訊顯示（名稱、風位、莊家標記）
// ==========================================
function updatePlayerInfo() {
  const windNames = { dong: '東', nan: '南', xi: '西', bei: '北' };
  const sm = gameState.seatMap;

  // visual slot → DOM index (name-0 = bottom, name-1 = top, name-2 = right, name-3 = left)
  const slots = [
    { domIdx: 0, playerIdx: sm.bottom },
    { domIdx: 1, playerIdx: sm.top    },
    { domIdx: 2, playerIdx: sm.right  },
    { domIdx: 3, playerIdx: sm.left   },
  ];

  slots.forEach(({ domIdx, playerIdx }) => {
    const player  = gameState.players[playerIdx];
    const isDealer = playerIdx === gameState.dealer;
    const windText = player.wind ? windNames[player.wind] : '?';

    const nameEl  = document.getElementById(`name-${domIdx}`);
    const windEl  = document.getElementById(`wind-${domIdx}`);
    const scoreEl = document.getElementById(`score-${domIdx}`);

    if (nameEl)  nameEl.textContent  = player.name;
    if (scoreEl) scoreEl.textContent = `$${player.score}`;
    if (windEl) {
      windEl.textContent = isDealer ? `${windText} 莊` : windText;
      windEl.classList.toggle('dealer', isDealer);
    }
  });

  // 中間圓盤：顯示圈風
  const roundWindEl = document.getElementById('round-wind');
  if (roundWindEl) roundWindEl.textContent = windNames[gameState.roundWind] || '東';
}

// ==========================================
// 提示文字
// ==========================================
function setHint(text) {
  const hint = document.getElementById('action-hint');
  if (hint) hint.textContent = text;
}

// ==========================================
// 判斷工具函式
// ==========================================

// 同花色連續三張（順子）的所有可能組合
function chiCombos(hand, discard) {
  if (discard.suit === 'zi' || discard.suit === 'flower') return [];
  const combos = [];
  const v = discard.value;
  // 可能的吃法：discard 在組合的位置 0/1/2
  const patterns = [
    [v, v+1, v+2],
    [v-1, v, v+1],
    [v-2, v-1, v],
  ];
  patterns.forEach(([a, b, c]) => {
    if (a < 1 || c > 9) return;
    // discard 是組合中的某一張，手牌要有另外兩張
    const needed = [a, b, c].filter(n => n !== v);
    const handCopy = [...hand];
    const found = needed.every(n => {
      const idx = handCopy.findIndex(t => t.suit === discard.suit && t.value === n);
      if (idx === -1) return false;
      handCopy.splice(idx, 1);
      return true;
    });
    if (found) combos.push([a, b, c]);
  });
  return combos;
}

// 手牌中有幾張與 tile 相同
function countSame(hand, tile) {
  return hand.filter(t => t.suit === tile.suit && t.value === tile.value).length;
}

// 台灣麻將胡牌判斷：5面子+1對 = 17張（含已宣告面子的剩餘手牌）
// hand 傳入的是「還在手上的牌」（不含已碰/吃的面子）
// 胡牌時手牌張數 = 17 - 已宣告面子×3
// 例：無面子=17張，1個面子=14張，2個面子=11張...
function canWin(hand) {
  const h = [...hand];
  // 必須是 3n+2 的形式才能組成 n個面子+1對
  if (h.length % 3 !== 2) return false;
  return checkWin(h);
}

function checkWin(tiles) {
  if (tiles.length === 0) return true;
  if (tiles.length === 2) {
    return tiles[0].suit === tiles[1].suit && tiles[0].value === tiles[1].value;
  }
  if (tiles.length % 3 !== 2) return false;

  const sorted = [...tiles].sort((a,b) => {
    const so = {wan:0,tiao:1,tong:2,zi:3};
    const sd = (so[a.suit]||0) - (so[b.suit]||0);
    if (sd) return sd;
    return (a.value||0) - (b.value||0);
  });

  // 嘗試每種唯一牌作為對子
  const triedPairs = new Set();
  for (let i = 0; i < sorted.length - 1; i++) {
    const pairKey = sorted[i].suit + '-' + sorted[i].value;
    if (triedPairs.has(pairKey)) continue;
    triedPairs.add(pairKey);
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
  const sorted = [...tiles].sort((a,b) => {
    const so = {wan:0,tiao:1,tong:2,zi:3};
    const sd = (so[a.suit]||0) - (so[b.suit]||0);
    if (sd) return sd;
    return (a.value||0) - (b.value||0);
  });
  const first = sorted[0];

  // 嘗試刻子
  if (sorted.filter(t => t.suit===first.suit && t.value===first.value).length >= 3) {
    const rest = [...sorted];
    let removed = 0;
    for (let i = 0; i < rest.length && removed < 3; i++) {
      if (rest[i].suit===first.suit && rest[i].value===first.value) {
        rest.splice(i,1); i--; removed++;
      }
    }
    if (checkMelds(rest)) return true;
  }

  // 嘗試順子
  if (first.suit !== 'zi' && first.suit !== 'flower') {
    const rest = [...sorted];
    const idx1 = rest.findIndex(t => t.suit===first.suit && t.value===first.value+1);
    if (idx1 !== -1) {
      const r2 = [...rest]; r2.splice(idx1,1);
      const idx2 = r2.findIndex(t => t.suit===first.suit && t.value===first.value+2);
      if (idx2 !== -1) {
        const r3 = [...r2]; r3.splice(idx2,1);
        r3.splice(r3.findIndex(t=>t===first), 1);
        if (checkMelds(r3)) return true;
      }
    }
  }
  return false;
}

// ==========================================
// 別人出牌後：判斷玩家能做什麼
// ==========================================
function checkActionsAfterDiscard(discard, fromPlayerIndex) {
  const me = gameState.players[0];
  const isUpstream = isMyUpstream(fromPlayerIndex); // 只有上家才能吃

  const canChi  = isUpstream && chiCombos(me.hand, discard).length > 0;
  const canPeng = countSame(me.hand, discard) >= 2;
  // 槓不能對上家的棄牌（上家只能吃/碰）
  const canGang = !isUpstream && countSame(me.hand, discard) >= 3;
  // 胡：手牌+這張能胡
  const canHu   = canWin([...me.hand, discard]);

  if (!canChi && !canPeng && !canGang && !canHu) return;

  // 聽牌模式：自動胡或自動過
  if (gameState.isTing) {
    if (canHu) {
      gameState.pendingDiscard = discard;
      gameState.pendingFrom    = fromPlayerIndex;
      onHuClick();
    }
    return;
  }

  gameState.pendingDiscard = discard;
  gameState.pendingFrom    = fromPlayerIndex;

  setHint('你可以吃碰槓胡！');
  document.getElementById('btn-chi').disabled  = !canChi;
  document.getElementById('btn-peng').disabled = !canPeng;
  document.getElementById('btn-gang').disabled = !canGang;
  document.getElementById('btn-hu').disabled   = !canHu;
  document.getElementById('btn-pass').disabled = false;
  gameState.phase = 'waiting_action';

  // 吃碰槓胡選擇計時：10 秒，超時自動過
  startTimer(10, () => {
    if (gameState.phase !== 'waiting_action') return;
    onPassClick();
  });
}

// 判斷 fromPlayer 是否是我的上家（出牌順序中的前一位）
function isMyUpstream(fromPlayerIndex) {
  const order = gameState.playOrder;
  const myIdx   = order.indexOf(0);
  const prevIdx = (myIdx - 1 + 4) % 4;
  return order[prevIdx] === fromPlayerIndex;
}

// ==========================================
// 吃牌
// ==========================================
function onChiClick() {
  const discard = gameState.pendingDiscard;
  const combos  = chiCombos(gameState.players[0].hand, discard);
  if (combos.length === 0) return;

  if (combos.length === 1) {
    executeChi(combos[0], discard);
  } else {
    showChiSelect(combos, discard);
  }
}

function showChiSelect(combos, discard) {
  const overlay = document.getElementById('chi-select-overlay');
  const options = document.getElementById('chi-select-options');
  overlay.style.display = 'flex';
  options.innerHTML = '';

  combos.forEach(combo => {
    const div = document.createElement('div');
    div.classList.add('chi-option');
    combo.forEach(v => {
      const fakeTile = { suit: discard.suit, value: v,
        display: ['','一','二','三','四','伍','六','七','八','九'][v],
        label: v, isFlower: false, isHonor: false, id: -1 };
      div.appendChild(createTileElement(fakeTile, false, false));
    });
    div.addEventListener('click', () => {
      overlay.style.display = 'none';
      executeChi(combo, discard);
    });
    options.appendChild(div);
  });

  document.getElementById('btn-chi-cancel').onclick = () => {
    overlay.style.display = 'none';
  };
}

function executeChi(combo, discard) {
  stopTimer();
  const me = gameState.players[0];
  const meld = [discard];

  // 從手牌移除另外兩張
  combo.filter(v => v !== discard.value).forEach(v => {
    const idx = me.hand.findIndex(t => t.suit===discard.suit && t.value===v);
    if (idx !== -1) meld.push(me.hand.splice(idx, 1)[0]);
  });
  // 若 discard.value 出現兩次在 combo，要再移除一張
  const discardCount = combo.filter(v => v === discard.value).length;
  if (discardCount > 1) {
    const idx = me.hand.findIndex(t => t.suit===discard.suit && t.value===discard.value);
    if (idx !== -1) meld.push(me.hand.splice(idx, 1)[0]);
  }

  meld.sort((a,b) => a.value - b.value);
  me.melds.push({ type: 'chi', tiles: meld });
  gameState.pendingDiscard = null;
  clearActionButtons();
  renderMyMelds();
  renderMyHand();
  gameState.phase = 'playing';
  gameState.currentPlayer = 0;
  enableMyTurn();
  setHint('吃牌成功！請打出一張牌');
}

// ==========================================
// 碰牌
// ==========================================
function onPengClick() {
  stopTimer();
  const discard = gameState.pendingDiscard;
  const me = gameState.players[0];
  const meld = [discard];

  for (let i = 0; i < 2; i++) {
    const idx = me.hand.findIndex(t => t.suit===discard.suit && t.value===discard.value);
    if (idx !== -1) meld.push(me.hand.splice(idx, 1)[0]);
  }

  me.melds.push({ type: 'peng', tiles: meld });
  gameState.pendingDiscard = null;
  clearActionButtons();
  renderMyMelds();
  renderMyHand();
  gameState.phase = 'playing';
  gameState.currentPlayer = 0;
  enableMyTurn();
  setHint('碰牌成功！請打出一張牌');
}

// ==========================================
// 暗槓檢查（摸牌後手上有4張相同）
// ==========================================
function checkAnGang() {
  const me = gameState.players[0];
  const counts = {};
  me.hand.forEach(t => {
    const key = t.suit + '-' + t.value;
    counts[key] = (counts[key] || 0) + 1;
  });
  const hasAnGang = Object.values(counts).some(c => c >= 4);
  if (hasAnGang) {
    gameState.pendingAnGang = true;
    document.getElementById('btn-gang').disabled = false;
    document.getElementById('btn-pass').disabled = false;
  }
}

// ==========================================
// 槓牌（明槓 or 暗槓）
// ==========================================
function onGangClick() {
  if (gameState.pendingAnGang) {
    executeAnGang();
  } else {
    executeMingGang();
  }
}

function executeMingGang() {
  const discard = gameState.pendingDiscard;
  const me = gameState.players[0];
  const meld = [discard];

  for (let i = 0; i < 3; i++) {
    const idx = me.hand.findIndex(t => t.suit===discard.suit && t.value===discard.value);
    if (idx !== -1) meld.push(me.hand.splice(idx, 1)[0]);
  }

  me.melds.push({ type: 'gang', tiles: meld });
  gameState.pendingDiscard = null;
  clearActionButtons();
  renderMyMelds();

  // 明槓補牌：不能自摸胡
  const drawn = drawFromWallEnd(0);
  gameState.drawnTile = drawn;
  renderMyHand();
  gameState.phase = 'playing';
  gameState.currentPlayer = 0;
  enableMyTurn();
  setHint('明槓！已補牌，請打出一張牌');
}

function executeAnGang() {
  const me = gameState.players[0];

  // 找手上有4張的牌
  const counts = {};
  me.hand.forEach(t => {
    const key = t.suit + '-' + t.value;
    if (!counts[key]) counts[key] = [];
    counts[key].push(t);
  });
  const gangGroup = Object.values(counts).find(g => g.length >= 4);
  if (!gangGroup) return;

  // 從手牌移除4張
  gangGroup.slice(0, 4).forEach(t => {
    const idx = me.hand.indexOf(t);
    if (idx !== -1) me.hand.splice(idx, 1);
  });

  me.melds.push({ type: 'angang', tiles: gangGroup.slice(0, 4) });
  gameState.pendingAnGang = false;
  clearActionButtons();
  renderMyMelds();

  // 暗槓補牌：可以自摸胡
  const drawn = drawFromWallEnd(0);
  gameState.drawnTile = drawn;
  renderMyHand();
  gameState.phase = 'playing';
  gameState.currentPlayer = 0;
  enableMyTurn();
  checkSelfDraw();   // 暗槓可以自摸
  checkAnGang();     // 補牌後可能再次暗槓
  setHint('暗槓！已補牌，請打出一張牌');
}

// ==========================================
// 計分系統（台灣麻將）
// ==========================================
function calcScore(winnerIdx, isSelfDraw, loserIdx) {
  const winner = gameState.players[winnerIdx];
  const hand   = [...winner.hand];
  const melds  = winner.melds;
  const flowers = winner.flowers;

  let tai = 1; // 底台
  const reasons = ['底台 1台'];

  // 門前清（無任何吃碰槓面子）
  if (melds.length === 0) { tai += 1; reasons.push('門前清 +1台'); }

  // 自摸
  if (isSelfDraw) { tai += 1; reasons.push('自摸 +1台'); }

  // 花牌
  if (flowers.length > 0) {
    tai += flowers.length;
    reasons.push(`花牌×${flowers.length} +${flowers.length}台`);
  }

  // 全部手牌（含面子展開）
  const allTiles = [...hand];
  melds.forEach(m => allTiles.push(...m.tiles));

  // 清一色（全同花色，不含字牌）
  const suits = allTiles.filter(t=>!t.isFlower).map(t=>t.suit);
  const uniqueSuits = [...new Set(suits)];
  const isClearColor = uniqueSuits.length === 1 && uniqueSuits[0] !== 'zi';
  const isAllHonor   = uniqueSuits.length === 1 && uniqueSuits[0] === 'zi';
  if (isClearColor) { tai += 4; reasons.push('清一色 +4台'); }

  // 字一色（全字牌）
  if (isAllHonor) { tai += 4; reasons.push('字一色 +4台'); }

  // 混一色（只有一種數牌 + 字牌）
  const numSuits = uniqueSuits.filter(s => s !== 'zi');
  if (numSuits.length === 1 && uniqueSuits.includes('zi')) {
    tai += 2; reasons.push('混一色 +2台');
  }

  // 一條龍（1-9 同花色各一張）
  ['wan','tiao','tong'].forEach(suit => {
    const vals = allTiles.filter(t=>t.suit===suit).map(t=>t.value);
    if ([1,2,3,4,5,6,7,8,9].every(v => vals.includes(v))) {
      tai += 3; reasons.push(`一條龍(${suit==='wan'?'萬':suit==='tiao'?'條':'筒'}) +3台`);
    }
  });

  // 碰碰胡（所有面子都是刻子/槓，含純手牌的情況）
  const isPengPeng = melds.every(m => m.type==='peng'||m.type==='gang'||m.type==='angang')
    && checkAllTriplets(hand);
  if (isPengPeng) { tai += 2; reasons.push('碰碰胡 +2台'); }

  // 平胡（全順子，無字牌）
  const isAllSeq = melds.every(m => m.type==='chi') && melds.length > 0
    && hand.every(t=>t.suit!=='zi'&&t.suit!=='flower') && !isPengPeng;
  if (isAllSeq) { tai += 1; reasons.push('平胡 +1台'); }

  // 大三元（中發白各3張）
  const honor = allTiles.filter(t=>t.suit==='zi');
  const zhong = honor.filter(t=>t.value==='zhong').length;
  const fa    = honor.filter(t=>t.value==='fa').length;
  const bai   = honor.filter(t=>t.value==='bai').length;
  if (zhong>=3 && fa>=3 && bai>=3) { tai += 4; reasons.push('大三元 +4台'); }
  else if ((zhong>=3?1:0)+(fa>=3?1:0)+(bai>=3?1:0) >= 2 &&
           (zhong>=2?1:0)+(fa>=2?1:0)+(bai>=2?1:0) >= 3) {
    tai += 2; reasons.push('小三元 +2台');
  }

  return { tai, reasons };
}

function checkAllTriplets(hand) {
  const h = [...hand];
  if (h.length % 3 !== 2) return false;
  // 找對子後，剩下全是刻子
  for (let i = 0; i < h.length; i++) {
    for (let j = i+1; j < h.length; j++) {
      if (h[i].suit===h[j].suit && h[i].value===h[j].value) {
        const rest = h.filter((_,idx)=>idx!==i&&idx!==j);
        if (allTriplets(rest)) return true;
      }
    }
  }
  return false;
}
function allTriplets(tiles) {
  if (tiles.length===0) return true;
  const f = tiles[0];
  const same = tiles.filter(t=>t.suit===f.suit&&t.value===f.value);
  if (same.length<3) return false;
  const rest = [...tiles];
  let rem=3;
  for(let i=0;i<rest.length&&rem>0;i++){
    if(rest[i].suit===f.suit&&rest[i].value===f.value){rest.splice(i,1);i--;rem--;}
  }
  return allTriplets(rest);
}

// ==========================================
// 胡牌
// ==========================================
function onHuClick() {
  stopTimer();
  const discard    = gameState.pendingDiscard;
  const me         = gameState.players[0];
  const fromIdx    = gameState.pendingFrom;
  const fromPlayer = gameState.players[fromIdx];
  clearActionButtons();
  gameState.phase = 'ended';

  const isSelfDraw = fromIdx === 0;
  const { tai, reasons } = calcScore(0, isSelfDraw, fromIdx);
  const betPerTai = gameState.baseBet;
  const totalPay  = tai * betPerTai;

  // 結算點數
  let payDetail = '';
  if (isSelfDraw) {
    gameState.players.forEach((p, i) => {
      if (i === 0) return;
      p.score    -= totalPay;
      me.score   += totalPay;
    });
    payDetail = `自摸！每人付 $${totalPay}`;
  } else {
    fromPlayer.score -= totalPay;
    me.score         += totalPay;
    payDetail = `${fromPlayer.name} 付 $${totalPay}`;
  }

  const title  = isSelfDraw ? '🎉 自摸！' : '🎉 胡牌！';
  const isDealer = (0 === gameState.dealer);
  const carryMsg = isDealer ? '莊家胡牌，連莊！' : '換莊，繼續下一局';
  const detail = [
    reasons.join('、'),
    `共 ${tai} 台 × $${betPerTai} = $${totalPay}`,
    payDetail,
    '─────',
    gameState.players.map(p=>`${p.name}：$${p.score}`).join('　'),
    carryMsg,
  ].join('\n');

  gameState.lastWinnerIdx = 0;
  document.getElementById('win-title').textContent  = title;
  document.getElementById('win-detail').innerHTML   = detail.replace(/\n/g,'<br>');
  document.getElementById('win-overlay').style.display = 'flex';
}

// 自摸胡牌判斷（摸牌後立即檢查）
function checkSelfDraw() {
  const me = gameState.players[0];
  if (canWin(me.hand)) {
    gameState.pendingDiscard = gameState.drawnTile;
    gameState.pendingFrom    = 0;
    document.getElementById('btn-hu').disabled = false;
    document.getElementById('btn-pass').disabled = false;
  }
}

// ==========================================
// 過（放棄動作）
// ==========================================
function onPassClick() {
  stopTimer();
  const wasWaiting = gameState.phase === 'waiting_action';
  gameState.pendingDiscard = null;
  clearActionButtons();
  gameState.phase = 'playing';
  // 若是放棄吃碰槓胡，繼續輪到下一家
  if (wasWaiting) {
    nextTurn();
  }
}

// ==========================================
// 聽牌輔助：所有牌種
// ==========================================
function getAllTileTypes() {
  const types = [];
  ['wan','tiao','tong'].forEach(suit => {
    for (let v = 1; v <= 9; v++) types.push({ suit, value: v });
  });
  ['dong','nan','xi','bei','zhong','fa','bai'].forEach(value => {
    types.push({ suit: 'zi', value });
  });
  return types;
}

// 手牌 3n+1 張時，找出等什麼牌
function getTenpaiWaiting(hand) {
  if (hand.length % 3 !== 1) return [];
  const waiting = [];
  getAllTileTypes().forEach(({ suit, value }) => {
    const fake = { id: -1, suit, value, isFlower: false, isHonor: suit === 'zi' };
    if (canWin([...hand, fake])) waiting.push({ suit, value });
  });
  return waiting;
}

// 從完整手牌（3n+2）找出所有可能捨牌→等牌組合
function getTingOptions(hand) {
  const seen = new Set();
  const options = [];
  hand.forEach((tile, idx) => {
    const key = tile.suit + '-' + tile.value;
    if (seen.has(key)) return;
    seen.add(key);
    const remaining = hand.filter((_, i) => i !== idx);
    const waiting = getTenpaiWaiting(remaining);
    if (waiting.length > 0) options.push({ tile, idx, waitingTiles: waiting });
  });
  return options;
}

// 顯示聽牌等待的牌
function showTingWaiting(waitingTiles) {
  let el = document.getElementById('ting-waiting-display');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ting-waiting-display';
    el.style.cssText = [
      'position:fixed', 'bottom:155px', 'left:50%', 'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.82)', 'border:1px solid #ffcc02', 'border-radius:10px',
      'padding:7px 14px', 'z-index:200', 'display:flex', 'align-items:center',
      'gap:6px', 'flex-wrap:wrap', 'justify-content:center', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(el);
  }
  const numCh = ['','一','二','三','四','伍','六','七','八','九'];
  const suitCh = { wan:'萬', tiao:'條', tong:'筒' };
  const ziCh = { dong:'東', nan:'南', xi:'西', bei:'北', zhong:'中', fa:'發', bai:'白' };
  el.innerHTML = '<span style="color:#ffcc02;font-size:11px;white-space:nowrap;">聽牌等待：</span>';
  waitingTiles.forEach(t => {
    const span = document.createElement('span');
    span.style.cssText = 'background:#fff3;color:#fff;font-weight:900;font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid #ffcc02;';
    span.textContent = t.suit === 'zi' ? ziCh[t.value] : numCh[t.value] + suitCh[t.suit];
    el.appendChild(span);
  });
}

function hideTingWaiting() {
  const el = document.getElementById('ting-waiting-display');
  if (el) el.remove();
}

// ==========================================
// 清除所有棋盤 DOM 顯示（換局用）
// ==========================================
function clearAllDisplays() {
  [0,1,2,3].forEach(i => {
    const el = document.getElementById(`discard-tiles-${i}`);
    if (el) el.innerHTML = '';
  });
  ['my-melds','melds-top','melds-left','melds-right'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['flowers-bottom','flowers-top','flowers-left','flowers-right'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['my-hand','hand-top','hand-left','hand-right'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  const badge = document.getElementById('wall-count-badge');
  if (badge) badge.remove();
  hideTingWaiting();
}

// ==========================================
// 聽牌模式
// ==========================================
function onTingClick() {
  if (gameState.isTing) return;
  const options = gameState.tingOptions || [];
  if (options.length === 0) return;

  // 選等牌數最多的捨牌方案
  const best = options.reduce((a, b) => b.waitingTiles.length > a.waitingTiles.length ? b : a);

  gameState.isTing = true;
  gameState.tingWaiting = best.waitingTiles;
  const btn = document.getElementById('btn-ting');
  btn.classList.add('ting-active');
  btn.disabled = true;
  stopTimer();

  showTingWaiting(best.waitingTiles);
  setHint('聽牌！電腦代打直到結束...');

  if (gameState.phase === 'playing' && gameState.currentPlayer === 0) {
    setTimeout(() => playTile(best.tile), 300);
  }
}

// ==========================================
// 留局 / 流局結束畫面
// ==========================================
function showGameOverOverlay(reason) {
  const title  = reason === '留局' ? '留局' : '流局！';
  const detail = (reason === '留局'
    ? '牌牆剩餘16張，無法繼續。\n莊家連莊，重新開局。'
    : '牌已摸完，無人胡牌。\n莊家連莊，重新開局。')
    + '\n─────\n'
    + gameState.players.map(p=>`${p.name}：$${p.score}`).join('　');
  gameState.lastWinnerIdx = -1; // 留局：連莊
  document.getElementById('win-title').textContent  = title;
  document.getElementById('win-detail').innerHTML   = detail.replace(/\n/g,'<br>');
  document.getElementById('win-overlay').style.display = 'flex';
}

// ==========================================
// 繼續下一局（連莊 or 換莊）
// ==========================================
function continueNextRound() {
  const winnerIdx = gameState.lastWinnerIdx; // -1=留局, 0=玩家0勝
  const currentDealer = gameState.dealer;

  if (winnerIdx === -1 || winnerIdx === currentDealer) {
    // 連莊：莊家不換
  } else {
    // 換莊：出牌順序中下一位
    const order = gameState.playOrder;
    const dealerPos = order.indexOf(currentDealer);
    gameState.dealer = order[(dealerPos + 1) % 4];
  }

  // 重新洗牌發牌（保留分數、風位、莊家位置）
  const diceResult = rollDice(3);
  dealTiles(diceResult.total);
}

// ==========================================
// 清除動作按鈕
// ==========================================
function clearActionButtons() {
  ['btn-chi','btn-peng','btn-gang','btn-hu','btn-pass'].forEach(id => {
    document.getElementById(id).disabled = true;
  });
  gameState.pendingAnGang = false;
}

// ==========================================
// 渲染自己的面子
// ==========================================
// ==========================================
// 渲染所有玩家面子 & 花牌
// ==========================================

// visual slot → DOM id 對應
const MELD_DOM  = { bottom:'my-melds',  top:'melds-top',  left:'melds-left',  right:'melds-right'  };
const FLOWER_DOM= { bottom:'flowers-bottom', top:'flowers-top', left:'flowers-left', right:'flowers-right' };

function renderMyMelds() {
  renderPlayerMelds(0);
}

function renderPlayerMelds(playerIdx) {
  const vpos = visualPosOf(playerIdx);
  const domId = playerIdx === 0 ? 'my-melds' : MELD_DOM[vpos];
  const container = document.getElementById(domId);
  if (!container) return;
  container.innerHTML = '';

  const isMe = playerIdx === 0;
  gameState.players[playerIdx].melds.forEach(meld => {
    const group = document.createElement('div');
    group.classList.add('meld-group');

    // 排列：吃牌把棄牌放中間（依 value 排序，棄牌標記）
    let tiles = [...meld.tiles];
    if (meld.type === 'chi') {
      tiles.sort((a,b) => a.value - b.value);
    }

    tiles.forEach((t, i) => {
      const faceDown = meld.type === 'angang' && (i === 0 || i === 3);
      const el = createTileElement(t, faceDown, !isMe);
      if (isMe) {
        el.style.cursor = 'default';
        el.style.width  = '50px';
        el.style.height = '68px';
      }
      group.appendChild(el);
    });
    container.appendChild(group);
  });
}

function renderAllMelds() {
  for (let i = 0; i < 4; i++) renderPlayerMelds(i);
}

function renderPlayerFlowers(playerIdx) {
  const vpos  = visualPosOf(playerIdx);
  const domId = FLOWER_DOM[vpos];
  const container = document.getElementById(domId);
  if (!container) return;
  container.innerHTML = '';

  const flowerNum = { chun:1, xia:2, qiu:3, dong2:4, mei:1, lan:2, ju:3, zhu:4 };
  gameState.players[playerIdx].flowers.forEach(f => {
    const el = document.createElement('div');
    el.classList.add('flower-tile-sm');
    el.style.position = 'relative';
    const num = flowerNum[f.value] || '';
    el.innerHTML = `${f.display}<span style="position:absolute;bottom:2px;right:3px;font-size:8px;color:#aaa;font-weight:normal;">${num}</span>`;
    container.appendChild(el);
  });
}

function renderAllFlowers() {
  for (let i = 0; i < 4; i++) renderPlayerFlowers(i);
}

// ==========================================
// 渲染牌牆（每堆 2 張疊放，共 4 面各 18 堆）
// ==========================================
const WALL_STACKS_PER_SIDE = 18; // 每面 18 堆 × 2 張 = 36 張

function renderWall() {
  const remaining = gameState.deck.length;
  // 每 2 張為一堆，總堆數從剩餘張數換算
  const totalStacks = Math.ceil(remaining / 2);

  // 順時針從底部開始：bottom → right → top → left
  const sides   = ['wall-bottom', 'wall-right', 'wall-top', 'wall-left'];
  const isVert  = [false, true, false, true];

  sides.forEach((id, i) => {
    const stackStart = i * WALL_STACKS_PER_SIDE;
    const stackCount = Math.max(0, Math.min(WALL_STACKS_PER_SIDE, totalStacks - stackStart));
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';

    const vert = isVert[i];
    for (let j = 0; j < stackCount; j++) {
      const stack = document.createElement('div');
      stack.classList.add('wall-stack', vert ? 'wall-stack-v' : 'wall-stack-h');

      // 底牌
      const bottom = document.createElement('div');
      bottom.classList.add('wall-tile', vert ? 'wall-tile-v' : 'wall-tile-h');
      // 上牌（除非這是最後一堆且張數是奇數）
      const top = document.createElement('div');
      top.classList.add('wall-tile', vert ? 'wall-tile-v' : 'wall-tile-h');

      stack.appendChild(bottom);
      // 最後一堆若剩單張，就不顯示上層
      const isLastStack = (j === stackCount - 1);
      const hasTopTile  = !(isLastStack && remaining % 2 === 1);
      if (hasTopTile) stack.appendChild(top);

      el.appendChild(stack);
    }
  });

  // 剩餘牌數標籤
  let badge = document.getElementById('wall-count-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'wall-count-badge';
    badge.classList.add('wall-count-badge');
    document.body.appendChild(badge);
  }
  badge.textContent = `牌牆剩餘 ${remaining} 張`;
}

