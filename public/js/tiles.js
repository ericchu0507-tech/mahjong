// ==========================================
// tiles.js — 麻將牌組定義 + 牌面渲染
// ==========================================

const SUITS = {
  WAN:    'wan',
  TIAO:   'tiao',
  TONG:   'tong',
  ZI:     'zi',
  FLOWER: 'flower'
};

const ZI_TILES = [
  { value: 'dong',  display: '東' },
  { value: 'nan',   display: '南' },
  { value: 'xi',    display: '西' },
  { value: 'bei',   display: '北' },
  { value: 'zhong', display: '中' },
  { value: 'fa',    display: '發' },
  { value: 'bai',   display: '白' },
];

const FLOWER_TILES = [
  { value: 'chun', display: '春' },
  { value: 'xia',  display: '夏' },
  { value: 'qiu',  display: '秋' },
  { value: 'dong2',display: '冬' },
  { value: 'mei',  display: '梅' },
  { value: 'lan',  display: '蘭' },
  { value: 'ju',   display: '菊' },
  { value: 'zhu',  display: '竹' },
];

const NUM_CHINESE = ['', '一', '二', '三', '四', '伍', '六', '七', '八', '九'];

// ── 筒子 ──
// 每個圓定義：[x%, y%, outerColor, midColor, innerColor]
const _B = '#1565c0', _G = '#2e7d32', _R = '#c62828';

const TONG_CIRCLES = {
  1: [[50,50,_R,_B,_B]],
  2: [[50,27,_G,_G,_G],[50,73,_B,_B,_B]],
  3: [[50,17,_R,_R,_R],[50,50,_G,_G,_G],[50,83,_B,_B,_B]],
  4: [[27,27,_B,_B,_B],[73,27,_G,_G,_G],
      [27,73,_R,_R,_R],[73,73,_G,_G,_G]],
  5: [[27,20,_B,_B,_B],[73,20,_G,_G,_G],
      [50,50,_R,_R,_R],
      [27,80,_G,_G,_G],[73,80,_B,_B,_B]],
  6: [[27,15,_R,_R,_R],[73,15,_R,_R,_R],
      [27,50,_R,_R,_R],[73,50,_R,_R,_R],
      [27,85,_R,_R,_R],[73,85,_R,_R,_R]],
  // 7筒：上排3顆斜排(左低右高) + 下方2×2
  7: [[18,26,_R,_R,_R],[50,18,_B,_B,_B],[82,10,_G,_G,_G],
      [27,55,_B,_B,_B],[73,55,_G,_G,_G],
      [27,82,_R,_R,_R],[73,82,_B,_B,_B]],
  8: [[27,9,_B,_B,_B],[73,9,_B,_B,_B],
      [27,33,_B,_B,_B],[73,33,_B,_B,_B],
      [27,57,_B,_B,_B],[73,57,_B,_B,_B],
      [27,81,_B,_B,_B],[73,81,_B,_B,_B]],
  9: [[18,15,_B,_B,_B],[50,15,_G,_G,_G],[82,15,_B,_B,_B],
      [18,50,_R,_R,_R],[50,50,_G,_G,_G],[82,50,_R,_R,_R],
      [18,85,_B,_B,_B],[50,85,_G,_G,_G],[82,85,_B,_B,_B]],
};

// 圓的直徑（依數量決定，避免重疊）
const TONG_DIAM    = {1:26, 2:21, 3:18, 4:17, 5:15, 6:14, 7:13, 8:12, 9:11};
const TONG_DIAM_SM = {1:15, 2:12, 3:10, 4: 9, 5: 8, 6: 8, 7: 7, 8: 7, 9: 6};

// ── 建立筒子圖案 HTML ──
function makeTongGraphic(value, small) {
  const circles = TONG_CIRCLES[value] || [];
  const d  = (small ? TONG_DIAM_SM : TONG_DIAM)[value] || 10;
  const aW = small ? 30 : 50;
  const aH = small ? 38 : 70;
  const bw = Math.max(1, Math.round(d * 0.11));
  const mD = Math.round(d * 0.62);
  const iD = Math.round(d * 0.30);

  let html = `<div style="width:${aW}px;height:${aH}px;position:relative;">`;
  circles.forEach(([px, py, oc, mc, ic]) => {
    const x = Math.round((px/100)*aW - d/2);
    const y = Math.round((py/100)*aH - d/2);
    html += `<div style="position:absolute;left:${x}px;top:${y}px;
      width:${d}px;height:${d}px;border-radius:50%;
      border:${bw}px solid ${oc};box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;">
      <div style="width:${mD}px;height:${mD}px;border-radius:50%;
        border:${bw}px solid ${mc};box-sizing:border-box;
        display:flex;align-items:center;justify-content:center;">
        <div style="width:${iD}px;height:${iD}px;border-radius:50%;
          background:${ic};"></div>
      </div>
    </div>`;
  });
  html += '</div>';
  return html;
}

// ── 條子 ──
// 每個數字的排列：二維陣列，每格 'g'(綠) | 'r'(紅) | ''(空位佔位)
// 行由上至下，列由左至右
const TIAO_GRID = {
  // 1條：鳥（另處理）
  // 2/3條：單欄直排（細長）
  2: [['g'],['g']],
  3: [['g'],['g','g']],
  // 4條：2×2
  4: [['g','g'],['g','g']],
  // 5條：2+1+2，中間1根置中（3欄：左/中/右）
  5: [['g','','g'],
      ['','g',''],
      ['g','','g']],
  // 6條：2×3
  6: [['g','g'],['g','g'],['g','g']],
  // 7條：H形 — 兩側各3根，中排補中間1根（2+3+2）
  7: [['g','','g'],
      ['g','g','g'],
      ['g','','g']],
  // 8條：2×4，上4根綠、下4根紅（分兩組各4根）
  8: [['g','g'],
      ['g','g'],
      ['r','r'],
      ['r','r']],
  // 9條：3×3，中排左右改紅
  9: [['g','g','g'],
      ['r','g','r'],
      ['g','g','g']],
};

const GT = '#81c784', GM = '#2e7d32', GB = '#1b5e20';
const RT = '#ef9a9a', RM = '#c62828', RB = '#8b0000';

function makeTiaoGraphic(value, small) {
  // 一條：鳥圖案
  if (value === 1) {
    const aW = small ? 30 : 50;
    const aH = small ? 38 : 70;
    const fs = small ? 18 : 30;
    const sw = small ? 4  : 7;
    const sh = small ? 10 : 18;
    return `<div style="width:${aW}px;height:${aH}px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
      <div style="font-size:${fs}px;line-height:1;">🦜</div>
      <div style="width:${sw}px;height:${sh}px;border-radius:${sw/2}px;
        background:linear-gradient(to bottom,${GT},${GB});"></div>
    </div>`;
  }

  const layout = TIAO_GRID[value];
  if (!layout) return '';

  const numRows = layout.length;
  const aW = small ? 30 : 50;
  const aH = small ? 38 : 70;

  // 竹節固定細寬，高度均分可用空間
  const barW = small ? 5  : 7;   // 固定細寬
  const gapC = small ? 3  : 5;
  const gapR = small ? 2  : 3;
  const barH = Math.max(small?8:12, Math.floor((aH - 4 - gapR*(numRows-1)) / numRows));
  const br   = Math.round(barW * 0.4);
  const nh   = Math.round(barH * 0.38);

  let html = `<div style="width:${aW}px;height:${aH}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${gapR}px;">`;

  layout.forEach(row => {
    html += `<div style="display:flex;gap:${gapC}px;align-items:center;">`;
    row.forEach(cell => {
      if (cell === '') {
        html += `<div style="width:${barW}px;height:${barH}px;"></div>`;
      } else {
        const top = cell === 'r' ? RT : GT;
        const mid = cell === 'r' ? RM : GM;
        const bot = cell === 'r' ? RB : GB;
        html += `<div style="width:${barW}px;height:${barH}px;border-radius:${br}px;
          background:linear-gradient(to bottom,${top} 0%,${mid} 50%,${bot} 100%);
          position:relative;box-shadow:inset -1px 0 2px rgba(0,0,0,0.3);flex-shrink:0;">
          <div style="position:absolute;top:${nh}px;left:1px;right:1px;height:1px;
            background:rgba(255,255,255,0.45);"></div>
        </div>`;
      }
    });
    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ==========================================
// 建立完整牌組（144張）
// ==========================================
function createDeck() {
  const deck = [];
  let id = 0;

  [SUITS.WAN, SUITS.TIAO, SUITS.TONG].forEach(suit => {
    const suitLabel = { wan: '萬', tiao: '條', tong: '筒' }[suit];
    for (let num = 1; num <= 9; num++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push({
          id: id++, suit, value: num,
          display: NUM_CHINESE[num],
          label: `${NUM_CHINESE[num]}${suitLabel}`,
          subLabel: suitLabel,
          isFlower: false, isHonor: false,
        });
      }
    }
  });

  ZI_TILES.forEach(zi => {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({
        id: id++, suit: SUITS.ZI, value: zi.value,
        display: zi.display, label: zi.display,
        subLabel: '', isFlower: false, isHonor: true,
      });
    }
  });

  FLOWER_TILES.forEach(flower => {
    deck.push({
      id: id++, suit: SUITS.FLOWER, value: flower.value,
      display: flower.display, label: flower.display,
      subLabel: '', isFlower: true, isHonor: false,
    });
  });

  return deck;
}

// ==========================================
// 洗牌
// ==========================================
function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ==========================================
// 建立牌的 DOM 元素
// ==========================================
function createTileElement(tile, faceDown = false, small = false) {
  const el = document.createElement('div');
  el.classList.add('tile');
  if (small) el.classList.add('tile-small');
  el.dataset.id = tile.id;
  el.dataset.suit = tile.suit;
  el.dataset.value = tile.value;

  if (faceDown) {
    el.classList.add('tile-back');
    return el;
  }

  // ── 萬子：數字藍，萬紅 ──
  if (tile.suit === SUITS.WAN) {
    el.classList.add('wan');
    el.innerHTML = `<span class="t-num">${tile.display}</span><span class="t-suit">萬</span>`;

  // ── 條子：竹節圖案 ──
  } else if (tile.suit === SUITS.TIAO) {
    el.classList.add('tiao');
    el.innerHTML = makeTiaoGraphic(tile.value, small);

  // ── 筒子：圓點圖案 ──
  } else if (tile.suit === SUITS.TONG) {
    el.classList.add('tong');
    el.innerHTML = makeTongGraphic(tile.value, small);

  // ── 字牌 ──
  } else if (tile.suit === SUITS.ZI) {
    el.classList.add('zi', tile.value);
    if (tile.value === 'bai') {
      el.innerHTML = `<span class="t-bai"></span>`;
    } else {
      el.innerHTML = `<span class="t-zi">${tile.display}</span>`;
    }

  // ── 花牌 ──
  } else if (tile.suit === SUITS.FLOWER) {
    el.classList.add('flower');
    const flowerNum = { chun:1, xia:2, qiu:3, dong2:4, mei:1, lan:2, ju:3, zhu:4 };
    const num = flowerNum[tile.value] || '';
    el.innerHTML = `<span class="t-flower">${tile.display}</span><span class="t-flower-num">${num}</span>`;
  }

  return el;
}

// ==========================================
// 擲骰子
// ==========================================
function rollDice(count = 3) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(Math.floor(Math.random() * 6) + 1);
  }
  return { dice: results, total: results.reduce((a, b) => a + b, 0) };
}

// ==========================================
// 抽東南西北
// ==========================================
function drawWinds() {
  const winds = ['dong', 'nan', 'xi', 'bei'];
  for (let i = winds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [winds[i], winds[j]] = [winds[j], winds[i]];
  }
  return winds;
}

function findDealer(winds) {
  return winds.indexOf('dong');
}
