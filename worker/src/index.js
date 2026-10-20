// 애플넘 랭킹 API — Cloudflare Worker + D1
//   POST /api/start                     -> { gameId, seed }
//   POST /api/submit { gameId, initials, moves } -> { score, weekRank, allRank }
//   GET  /api/ranking?period=week|all   -> { items: [{ initials, score, clearMs, gameId }] }
import { TIME_LIMIT_MS, replay } from '../../shared/game.js';

const SUBMIT_GRACE_MS = 30_000;   // 네트워크 지연 등을 감안한 여유 시간
const RANK_LIMIT = 30;
const GAME_TTL_MS = 24 * 60 * 60 * 1000;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

// 한국 시간 기준 이번 주 월요일 (YYYY-MM-DD)
function weekKey(nowMs) {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=일
  const diff = (day + 6) % 7;  // 월요일까지 지난 일수
  kst.setUTCDate(kst.getUTCDate() - diff);
  return kst.toISOString().slice(0, 10);
}

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

async function handleStart(env, ctx, cors) {
  const now = Date.now();
  const gameId = crypto.randomUUID();
  const seed = randomSeed();
  await env.DB.prepare('INSERT INTO games (id, seed, started_at, submitted) VALUES (?, ?, ?, 0)')
    .bind(gameId, seed, now)
    .run();
  // 오래된 게임 정리
  ctx.waitUntil(env.DB.prepare('DELETE FROM games WHERE started_at < ?').bind(now - GAME_TTL_MS).run());
  return json({ gameId, seed }, 200, cors);
}

async function handleSubmit(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400, cors);
  }
  const { gameId, initials, moves } = body || {};
  if (typeof gameId !== 'string' || gameId.length > 64) return json({ error: 'bad_request' }, 400, cors);
  if (typeof initials !== 'string' || !/^[A-Z]{3}$/.test(initials)) return json({ error: 'bad_initials' }, 400, cors);

  const game = await env.DB.prepare('SELECT seed, started_at, submitted FROM games WHERE id = ?').bind(gameId).first();
  if (!game) return json({ error: 'not_found' }, 404, cors);
  if (game.submitted) return json({ error: 'already_submitted' }, 409, cors);

  const now = Date.now();
  const elapsed = now - game.started_at;
  if (elapsed > TIME_LIMIT_MS + SUBMIT_GRACE_MS) return json({ error: 'expired' }, 410, cors);

  const result = replay(game.seed >>> 0, moves);
  if (!result.ok || result.score <= 0) return json({ error: 'invalid_replay', reason: result.reason }, 422, cors);
  // 실제 흐른 시간보다 늦은 이동 기록은 거부
  if (result.lastT > elapsed + 2000) return json({ error: 'invalid_replay', reason: 'time_mismatch' }, 422, cors);

  // 중복 제출 방지 (조건부 업데이트)
  const upd = await env.DB.prepare('UPDATE games SET submitted = 1 WHERE id = ? AND submitted = 0').bind(gameId).run();
  if (!upd.meta || upd.meta.changes !== 1) return json({ error: 'already_submitted' }, 409, cors);

  const wk = weekKey(now);
  await env.DB.prepare(
    'INSERT INTO scores (game_id, initials, score, clear_ms, week_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(gameId, initials, result.score, result.lastT, wk, now)
    .run();

  const rankSql = (withWeek) => `
    SELECT COUNT(DISTINCT initials) AS n FROM scores
    WHERE initials != ?1 ${withWeek ? 'AND week_key = ?4' : ''}
      AND (score > ?2 OR (score = ?2 AND clear_ms < ?3))`;
  const [w, a] = await Promise.all([
    env.DB.prepare(rankSql(true)).bind(initials, result.score, result.lastT, wk).first(),
    env.DB.prepare(rankSql(false)).bind(initials, result.score, result.lastT).first(),
  ]);

  return json({ score: result.score, weekRank: (w?.n ?? 0) + 1, allRank: (a?.n ?? 0) + 1 }, 200, cors);
}

async function handleRanking(url, env, cors) {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
  const where = period === 'week' ? 'WHERE week_key = ?1' : '';
  // 이니셜별 최고 기록만 표시
  const sql = `
    SELECT initials, score, clear_ms AS clearMs, game_id AS gameId FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY initials ORDER BY score DESC, clear_ms ASC, created_at ASC
      ) AS rn
      FROM scores ${where}
    ) WHERE rn = 1
    ORDER BY score DESC, clearMs ASC, created_at ASC
    LIMIT ${RANK_LIMIT}`;
  const stmt = env.DB.prepare(sql);
  const { results } = period === 'week' ? await stmt.bind(weekKey(Date.now())).all() : await stmt.all();
  return json({ period, items: results || [] }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/start' && request.method === 'POST') return await handleStart(env, ctx, cors);
      if (url.pathname === '/api/submit' && request.method === 'POST') return await handleSubmit(request, env, cors);
      if (url.pathname === '/api/ranking' && request.method === 'GET') return await handleRanking(url, env, cors);
      if (url.pathname === '/') return json({ ok: true, name: 'apple-num-api' }, 200, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'server_error' }, 500, cors);
    }
  },
};
