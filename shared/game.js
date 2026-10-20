// 사과 숫자 게임 공용 로직 — 브라우저와 Cloudflare Worker가 함께 사용합니다.
// 이 파일을 바꾸면 서버 검증 결과도 함께 바뀌므로, 프론트와 워커를 같이 배포하세요.

export const ROWS = 10;
export const COLS = 16;
export const TIME_LIMIT_MS = 120_000;
export const TARGET = 10;

// 시드 기반 난수 (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1~9 숫자로 판을 만들고, 전체 합이 10의 배수가 될 때까지 다시 뽑습니다.
export function generateBoard(seed) {
  const rnd = mulberry32(seed);
  for (;;) {
    const board = new Array(ROWS * COLS);
    let sum = 0;
    for (let i = 0; i < board.length; i++) {
      const v = 1 + Math.floor(rnd() * 9);
      board[i] = v;
      sum += v;
    }
    if (sum % TARGET === 0) return board;
  }
}

export function normRect(r1, c1, r2, c2) {
  return [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
}

// 사각형 안의 합과 남아 있는 사과 수
export function rectInfo(board, r1, c1, r2, c2) {
  [r1, c1, r2, c2] = normRect(r1, c1, r2, c2);
  let sum = 0;
  let count = 0;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const v = board[r * COLS + c];
      if (v > 0) {
        sum += v;
        count++;
      }
    }
  }
  return { sum, count };
}

// 유효하면 판을 수정하고 지운 개수를 반환, 아니면 0
export function applyMove(board, r1, c1, r2, c2) {
  [r1, c1, r2, c2] = normRect(r1, c1, r2, c2);
  const { sum, count } = rectInfo(board, r1, c1, r2, c2);
  if (sum !== TARGET || count === 0) return 0;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) board[r * COLS + c] = 0;
  }
  return count;
}

// 지울 수 있는 사각형이 하나라도 남아 있는지 (2차원 누적합)
export function hasAnyMove(board) {
  const W = COLS + 1;
  const ps = new Int32Array((ROWS + 1) * W);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ps[(r + 1) * W + c + 1] =
        board[r * COLS + c] + ps[r * W + c + 1] + ps[(r + 1) * W + c] - ps[r * W + c];
    }
  }
  for (let r1 = 0; r1 < ROWS; r1++) {
    for (let r2 = r1; r2 < ROWS; r2++) {
      for (let c1 = 0; c1 < COLS; c1++) {
        for (let c2 = c1; c2 < COLS; c2++) {
          const s =
            ps[(r2 + 1) * W + c2 + 1] - ps[r1 * W + c2 + 1] - ps[(r2 + 1) * W + c1] + ps[r1 * W + c1];
          if (s === TARGET) return true;
          if (s > TARGET) break; // 열을 늘리면 합은 줄지 않음
        }
      }
    }
  }
  return false;
}

// 이동 기록 검증: moves = [[r1, c1, r2, c2, tMs], ...]
export function replay(seed, moves) {
  if (!Array.isArray(moves) || moves.length > ROWS * COLS) {
    return { ok: false, reason: 'bad_moves' };
  }
  const board = generateBoard(seed);
  let score = 0;
  let lastT = 0;
  for (const m of moves) {
    if (!Array.isArray(m) || m.length !== 5 || !m.every(Number.isInteger)) {
      return { ok: false, reason: 'bad_move_format' };
    }
    const [r1, c1, r2, c2, t] = m;
    if (
      r1 < 0 || r2 < 0 || r1 >= ROWS || r2 >= ROWS ||
      c1 < 0 || c2 < 0 || c1 >= COLS || c2 >= COLS
    ) {
      return { ok: false, reason: 'out_of_range' };
    }
    if (t < lastT || t > TIME_LIMIT_MS) return { ok: false, reason: 'bad_time' };
    const cleared = applyMove(board, r1, c1, r2, c2);
    if (cleared === 0) return { ok: false, reason: 'invalid_move' };
    score += cleared;
    lastT = t;
  }
  return { ok: true, score, lastT };
}
