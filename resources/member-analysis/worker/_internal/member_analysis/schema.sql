PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS derived_games (
  server_id TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_derived_games_updated_at
ON derived_games(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_derived_games_game
ON derived_games(game_id DESC, server_id ASC);

CREATE INDEX IF NOT EXISTS idx_derived_games_patch
ON derived_games(json_extract(payload_json, '$.patch'));

CREATE INDEX IF NOT EXISTS idx_derived_games_date
ON derived_games(json_extract(payload_json, '$.date'));

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

PRAGMA user_version=2;
