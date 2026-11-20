-- v1 bootstrap: openDatabase always applies subsequent versioned migrations through v4
-- (including rerates and rerate_scores); keep this historical schema for legacy imports.
CREATE TABLE films (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  title_fr TEXT, original_title TEXT, year INTEGER,
  watched_at TEXT NOT NULL,
  director_text TEXT, summary TEXT, comment TEXT,
  imdb_id TEXT UNIQUE, letterboxd_url TEXT,
  runtime_min INTEGER, genres TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(genres)),
  countries TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(countries)),
  languages TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(languages)),
  rated TEXT, imdb_rating REAL, imdb_votes INTEGER, metascore INTEGER,
  rt_score INTEGER, awards TEXT, box_office TEXT, poster_path TEXT, plot_en TEXT,
  omdb_raw TEXT, wikidata_raw TEXT, hydrated_at TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(title, watched_at)
);
CREATE TABLE viewers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  is_core INTEGER NOT NULL DEFAULT 0 CHECK(is_core IN (0, 1))
);
CREATE TABLE ratings (
  film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES viewers(id),
  score REAL CHECK(score BETWEEN -10 AND 10),
  PRIMARY KEY(film_id, viewer_id)
);
CREATE TABLE credits (
  film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('director','writer','composer','cinematographer','editor','producer','actor')),
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK(source IN ('omdb','wikidata','manual')),
  PRIMARY KEY(film_id, role, name)
);
CREATE TABLE companies (
  film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  name TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('omdb','wikidata','manual')),
  PRIMARY KEY(film_id, name)
);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE,
  emoji TEXT, color TEXT
);
CREATE TABLE film_tags (
  film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(film_id, tag_id)
);
-- raw_response stores successful JSON responses beside the request accounting.
-- Attempts, including network failures, consume budget; cache hits do not.
CREATE TABLE api_log (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, request_key TEXT NOT NULL,
  status INTEGER NOT NULL, at TEXT NOT NULL, raw_response TEXT
);
CREATE INDEX api_log_budget ON api_log(provider, at);
CREATE INDEX api_log_cache ON api_log(provider, request_key);
CREATE INDEX ratings_viewer ON ratings(viewer_id);
INSERT INTO viewers(name, is_core) VALUES ('Fleur', 1), ('Noé', 1);
-- +1 😭 : on a pleuré (cosmétique, sans effet sur les notes).
INSERT INTO tags(label, emoji, color) VALUES ('+1', '😭', '#8b5cf6');
