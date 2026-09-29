export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  max_user_id TEXT UNIQUE NOT NULL,
  grade INTEGER CHECK (grade >= 1 AND grade <= 11),
  region_code TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  quiet_from TEXT NOT NULL DEFAULT '22:00',
  quiet_to TEXT NOT NULL DEFAULT '08:00',
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_subjects (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL,
  UNIQUE(user_id, subject_code)
);

CREATE TABLE IF NOT EXISTS olympiads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  organizer TEXT NOT NULL,
  rsosh_level INTEGER CHECK (rsosh_level IN (1, 2, 3) OR rsosh_level IS NULL),
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  grade_from INTEGER NOT NULL,
  grade_to INTEGER NOT NULL,
  benefits_note TEXT,
  url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  olympiad_id TEXT NOT NULL REFERENCES olympiads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'qualifying', 'final', 'results')),
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  region_code TEXT,
  format TEXT NOT NULL CHECK (format IN ('online', 'offline', 'hybrid'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  olympiad_id TEXT NOT NULL REFERENCES olympiads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'interested' CHECK (status IN ('interested', 'registered', 'done', 'dropped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, olympiad_id)
);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reg_start', 'reg_3d', 'reg_1d', 'stage_1d', 'demo_1m', 'custom')),
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subscription_id, stage_id, kind)
);

CREATE TABLE IF NOT EXISTS dialog_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(send_at, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_stages_olympiad ON stages(olympiad_id);
`;
