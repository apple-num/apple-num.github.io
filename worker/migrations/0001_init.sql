-- 게임 시작 기록 (서버가 발급한 시드)
CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  seed        INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  submitted   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_games_started ON games (started_at);

-- 검증을 통과한 점수
CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     TEXT NOT NULL UNIQUE,
  initials    TEXT NOT NULL,
  score       INTEGER NOT NULL,
  clear_ms    INTEGER NOT NULL,
  week_key    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_week ON scores (week_key, score DESC, clear_ms ASC);
CREATE INDEX IF NOT EXISTS idx_scores_all ON scores (score DESC, clear_ms ASC);
