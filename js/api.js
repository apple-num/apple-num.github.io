import { API_BASE } from './config.js';

export const API_ENABLED = Boolean(API_BASE);

async function request(path, { method = 'GET', body, timeout = 6000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(API_BASE.replace(/\/$/, '') + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.error;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function startGame() {
  return request('/api/start', { method: 'POST', body: {}, timeout: 4000 });
}

export function submitScore(gameId, initials, moves) {
  return request('/api/submit', { method: 'POST', body: { gameId, initials, moves } });
}

export function fetchRanking(period) {
  return request(`/api/ranking?period=${encodeURIComponent(period)}`);
}
