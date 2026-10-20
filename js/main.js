import {
  ROWS, COLS, TIME_LIMIT_MS, TARGET,
  generateBoard, normRect, rectInfo, applyMove, hasAnyMove,
} from '../shared/game.js';
import { API_ENABLED, startGame, submitScore, fetchRanking } from './api.js';

const $ = (s) => document.querySelector(s);
const el = {
  stage: $('#stage'),
  board: $('#board'),
  selection: $('#selection'),
  score: $('#score'),
  sumBadge: $('#sumBadge'),
  sumValue: $('#sumValue'),
  timeText: $('#timeText'),
  timeFill: $('#timeFill'),
  startScreen: $('#startScreen'),
  resultScreen: $('#resultScreen'),
  rankScreen: $('#rankScreen'),
  startBtn: $('#startBtn'),
  retryBtn: $('#retryBtn'),
  bestText: $('#bestText'),
  resultTitle: $('#resultTitle'),
  resultScore: $('#resultScore'),
  resultSub: $('#resultSub'),
  submitForm: $('#submitForm'),
  initials: $('#initials'),
  submitBtn: $('#submitBtn'),
  formMsg: $('#formMsg'),
  rankList: $('#rankList'),
  toast: $('#toast'),
};

// ---------- localStorage (막혀 있어도 게임은 돌아가게) ----------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

// ---------- 상태 ----------
const state = {
  board: null,
  cells: [],           // 논리 인덱스(r*COLS+c) -> div
  transposed: false,   // 세로 화면이면 판을 돌려서 배치
  cell: 32,
  running: false,
  startT: 0,
  score: 0,
  moves: [],
  gameId: null,
  ranked: false,
  sel: null,           // { r0, c0, r1, c1, pointerId }
  lastSubmitted: null, // { gameId, initials }
};

// ---------- 판 DOM ----------
function buildCells() {
  el.board.querySelectorAll('.cell').forEach((n) => n.remove());
  state.cells = [];
  for (let i = 0; i < ROWS * COLS; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = '<span class="apple"><span class="num"></span></span>';
    el.board.appendChild(cell);
    state.cells.push(cell);
  }
}

function renderBoard() {
  state.board.forEach((v, i) => {
    const cell = state.cells[i];
    cell.classList.remove('sel', 'ok', 'pop', 'gone');
    if (v > 0) cell.querySelector('.num').textContent = v;
    else cell.classList.add('gone');
  });
}

// 화면 좌표계(표시 행/열) <-> 논리 좌표계
const dispRows = () => (state.transposed ? COLS : ROWS);
const dispCols = () => (state.transposed ? ROWS : COLS);
const toDisp = (r, c) => (state.transposed ? [c, r] : [r, c]);
const toLogical = (dr, dc) => (state.transposed ? [dc, dr] : [dr, dc]);

function layout() {
  const rect = el.stage.getBoundingClientRect();
  const style = getComputedStyle(el.stage);
  const w = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const h = rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const pad = 8; // 판 테두리 여백

  const landscapeCell = Math.min((w - pad * 2) / COLS, (h - pad * 2) / ROWS);
  const portraitCell = Math.min((w - pad * 2) / ROWS, (h - pad * 2) / COLS);
  state.transposed = portraitCell > landscapeCell;
  state.cell = Math.max(16, Math.floor(Math.max(landscapeCell, portraitCell)));

  document.documentElement.style.setProperty('--cell', `${state.cell}px`);
  el.board.style.width = `${state.cell * dispCols() + pad * 2}px`;
  el.board.style.height = `${state.cell * dispRows() + pad * 2}px`;
  el.board.style.padding = `${pad}px`;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const [dr, dc] = toDisp(r, c);
      const cell = state.cells[r * COLS + c];
      cell.style.left = `${pad + dc * state.cell}px`;
      cell.style.top = `${pad + dr * state.cell}px`;
    }
  }
  if (state.sel) drawSelection();
}

// ---------- 드래그 선택 ----------
function hitCell(clientX, clientY) {
  const rect = el.board.getBoundingClientRect();
  const pad = parseFloat(el.board.style.padding) || 0;
  let dc = Math.floor((clientX - rect.left - pad) / state.cell);
  let dr = Math.floor((clientY - rect.top - pad) / state.cell);
  dc = Math.max(0, Math.min(dispCols() - 1, dc));
  dr = Math.max(0, Math.min(dispRows() - 1, dr));
  return toLogical(dr, dc);
}

function currentRect() {
  const { r0, c0, r1, c1 } = state.sel;
  return normRect(r0, c0, r1, c1);
}

function drawSelection() {
  const [r1, c1, r2, c2] = currentRect();
  const info = rectInfo(state.board, r1, c1, r2, c2);
  const status = info.sum === TARGET && info.count > 0 ? 'ok' : info.sum > TARGET ? 'over' : '';

  // 사각형 표시 (화면 좌표계로 변환)
  const [a, b] = [toDisp(r1, c1), toDisp(r2, c2)];
  const top = Math.min(a[0], b[0]);
  const left = Math.min(a[1], b[1]);
  const bottom = Math.max(a[0], b[0]);
  const right = Math.max(a[1], b[1]);
  const pad = parseFloat(el.board.style.padding) || 0;
  const s = el.selection.style;
  s.left = `${pad + left * state.cell - 2}px`;
  s.top = `${pad + top * state.cell - 2}px`;
  s.width = `${(right - left + 1) * state.cell + 4}px`;
  s.height = `${(bottom - top + 1) * state.cell + 4}px`;
  el.selection.className = `selection ${status}`;
  el.selection.hidden = false;

  // 사과 강조
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const inside = r >= r1 && r <= r2 && c >= c1 && c <= c2 && state.board[r * COLS + c] > 0;
      const cell = state.cells[r * COLS + c];
      cell.classList.toggle('sel', inside);
      cell.classList.toggle('ok', inside && status === 'ok');
    }
  }

  // 합계 (손가락에 가리지 않게 상단 HUD에 표시)
  el.sumValue.textContent = info.count ? info.sum : '–';
  el.sumBadge.className = `hud-sum ${status}`;
}

function clearSelection() {
  state.sel = null;
  el.selection.hidden = true;
  state.cells.forEach((c) => c.classList.remove('sel', 'ok'));
  el.sumValue.textContent = '–';
  el.sumBadge.className = 'hud-sum';
}

el.board.addEventListener('pointerdown', (e) => {
  if (!state.running || state.sel) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  el.board.setPointerCapture(e.pointerId);
  const [r, c] = hitCell(e.clientX, e.clientY);
  state.sel = { r0: r, c0: c, r1: r, c1: c, pointerId: e.pointerId };
  drawSelection();
});

el.board.addEventListener('pointermove', (e) => {
  if (!state.sel || e.pointerId !== state.sel.pointerId) return;
  e.preventDefault();
  const [r, c] = hitCell(e.clientX, e.clientY);
  if (r === state.sel.r1 && c === state.sel.c1) return;
  state.sel.r1 = r;
  state.sel.c1 = c;
  drawSelection();
});

function endDrag(e, cancelled) {
  if (!state.sel || e.pointerId !== state.sel.pointerId) return;
  const [r1, c1, r2, c2] = currentRect();
  clearSelection();
  if (cancelled || !state.running) return;

  const info = rectInfo(state.board, r1, c1, r2, c2);
  if (info.count === 0) return;
  if (info.sum !== TARGET) {
    if (info.count > 1) shake();
    return;
  }

  const t = Math.min(TIME_LIMIT_MS, Math.floor(performance.now() - state.startT));
  const cleared = applyMove(state.board, r1, c1, r2, c2);
  state.moves.push([r1, c1, r2, c2, t]);
  state.score += cleared;
  el.score.textContent = state.score;

  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = state.cells[r * COLS + c];
      if (cell.classList.contains('gone')) continue;
      cell.classList.add('pop');
      setTimeout(() => cell.classList.add('gone'), 280);
    }
  }
  if (navigator.vibrate) navigator.vibrate(12);

  if (!hasAnyMove(state.board)) {
    setTimeout(() => endGame(state.score === ROWS * COLS ? 'clear' : 'stuck'), 320);
  }
}

el.board.addEventListener('pointerup', (e) => endDrag(e, false));
el.board.addEventListener('pointercancel', (e) => endDrag(e, true));
el.board.addEventListener('contextmenu', (e) => e.preventDefault());
// iOS 핀치 확대 제스처 차단
document.addEventListener('gesturestart', (e) => e.preventDefault());

let shakeTimer = 0;
function shake() {
  el.board.classList.remove('shake');
  void el.board.offsetWidth;
  el.board.classList.add('shake');
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => el.board.classList.remove('shake'), 260);
}

// ---------- 타이머 ----------
function tick() {
  if (!state.running) return;
  const elapsed = performance.now() - state.startT;
  const left = Math.max(0, TIME_LIMIT_MS - elapsed);
  el.timeText.textContent = Math.ceil(left / 1000);
  el.timeFill.style.transform = `scaleX(${left / TIME_LIMIT_MS})`;
  el.timeFill.classList.toggle('low', left < 15_000);
  if (left <= 0) {
    endGame('timeout');
    return;
  }
  requestAnimationFrame(tick);
}

// ---------- 게임 흐름 ----------
function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

async function newGame() {
  el.startBtn.disabled = true;
  el.retryBtn.disabled = true;

  let seed;
  state.gameId = null;
  state.ranked = false;
  if (API_ENABLED) {
    try {
      const res = await startGame();
      seed = res.seed >>> 0;
      state.gameId = res.gameId;
      state.ranked = true;
    } catch {
      showToast('랭킹 서버에 연결하지 못해 연습 모드로 시작해요');
    }
  }
  if (seed === undefined) seed = randomSeed();

  state.board = generateBoard(seed);
  state.score = 0;
  state.moves = [];
  el.score.textContent = '0';
  renderBoard();
  clearSelection();

  el.startScreen.hidden = true;
  el.resultScreen.hidden = true;
  el.startBtn.disabled = false;
  el.retryBtn.disabled = false;

  state.running = true;
  state.startT = performance.now();
  requestAnimationFrame(tick);
}

function endGame(reason) {
  if (!state.running) return;
  state.running = false;
  clearSelection();
  el.timeText.textContent = reason === 'timeout' ? '0' : el.timeText.textContent;

  const best = Number(store.get('apple-num:best', '0'));
  const isBest = state.score > best;
  if (isBest) store.set('apple-num:best', String(state.score));

  el.resultTitle.textContent =
    reason === 'clear' ? '전부 지웠어요! 🎉' : reason === 'stuck' ? '더 지울 수 있는 사과가 없어요' : '시간 종료!';
  el.resultScore.textContent = state.score;
  el.resultSub.textContent = isBest
    ? '내 최고 기록이에요!'
    : `내 최고 기록 ${Math.max(best, state.score)}점`;

  el.formMsg.textContent = '';
  el.formMsg.className = 'form-msg';
  el.submitBtn.disabled = false;
  if (state.ranked && state.score > 0) {
    el.submitForm.hidden = false;
    el.initials.value = store.get('apple-num:initials', '');
  } else {
    el.submitForm.hidden = true;
    if (!API_ENABLED) el.resultSub.textContent += ' · 연습 모드(랭킹 미연결)';
  }

  el.resultScreen.hidden = false;
}

el.submitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const initials = el.initials.value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(initials)) {
    el.formMsg.textContent = '영문 3글자로 입력해 주세요';
    el.formMsg.className = 'form-msg err';
    return;
  }
  el.submitBtn.disabled = true;
  el.formMsg.textContent = '등록 중…';
  el.formMsg.className = 'form-msg';
  try {
    const res = await submitScore(state.gameId, initials, state.moves);
    store.set('apple-num:initials', initials);
    state.lastSubmitted = { gameId: state.gameId, initials };
    el.formMsg.textContent = `등록 완료! 이번 주 ${res.weekRank}위 · 전체 ${res.allRank}위`;
    el.submitForm.querySelector('.submit-row').hidden = true;
  } catch (err) {
    const msg = {
      already_submitted: '이미 등록한 판이에요',
      expired: '등록 가능한 시간이 지났어요',
      invalid_replay: '기록 검증에 실패했어요',
      not_found: '게임 정보를 찾을 수 없어요',
    }[err.code] || '등록에 실패했어요. 잠시 후 다시 시도해 주세요';
    el.formMsg.textContent = msg;
    el.formMsg.className = 'form-msg err';
    el.submitBtn.disabled = err.code === 'already_submitted';
  }
});

el.initials.addEventListener('input', () => {
  el.initials.value = el.initials.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
});

// ---------- 랭킹 ----------
let rankPeriod = 'week';

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function loadRanking() {
  el.rankList.innerHTML = '<li class="empty">불러오는 중…</li>';
  if (!API_ENABLED) {
    el.rankList.innerHTML = '<li class="empty">랭킹 서버가 아직 연결되지 않았어요</li>';
    return;
  }
  try {
    const { items } = await fetchRanking(rankPeriod);
    if (!items.length) {
      el.rankList.innerHTML = '<li class="empty">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</li>';
      return;
    }
    el.rankList.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      if (state.lastSubmitted && it.gameId === state.lastSubmitted.gameId) li.classList.add('me');
      li.innerHTML = `
        <span class="pos">${i + 1}</span>
        <span class="ini"></span>
        <span class="pts">${it.score}</span>
        <span class="tm">${it.score === ROWS * COLS ? fmtTime(it.clearMs) : ''}</span>`;
      li.querySelector('.ini').textContent = it.initials;
      el.rankList.appendChild(li);
    });
  } catch {
    el.rankList.innerHTML = '<li class="empty">랭킹을 불러오지 못했어요</li>';
  }
}

function openRanking() {
  el.rankScreen.hidden = false;
  loadRanking();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    rankPeriod = tab.dataset.period;
    loadRanking();
  });
});

$('#rankBtn1').addEventListener('click', openRanking);
$('#rankBtn2').addEventListener('click', openRanking);
$('#rankClose').addEventListener('click', () => { el.rankScreen.hidden = true; });
el.startBtn.addEventListener('click', newGame);
el.retryBtn.addEventListener('click', newGame);

// ---------- 기타 ----------
let toastTimer = 0;
function showToast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

function init() {
  buildCells();
  state.board = generateBoard(randomSeed()); // 시작 화면 뒤에 보일 판
  renderBoard();
  layout();
  const best = Number(store.get('apple-num:best', '0'));
  if (best) el.bestText.textContent = `내 최고 기록 ${best}점`;
}

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(layout);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

init();
