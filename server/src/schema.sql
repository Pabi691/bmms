-- Building Maintenance Management System — SQLite schema
-- All monetary values are stored as INTEGER paise (₹1 = 100) to avoid floating-point errors.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buildings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  address       TEXT,
  description   TEXT,
  floors        INTEGER,
  total_flats   INTEGER,
  manager_name  TEXT,
  contact       TEXT,
  notes         TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flats (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount >= 0),
  owner_name     TEXT,
  resident_name  TEXT,
  mobile         TEXT,
  floor          INTEGER,
  size_sqft      REAL,
  notes          TEXT,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (building_id, number)
);

-- A payment received against a specific maintenance month.
-- applied_amount + advance_amount = amount (validated in service layer).
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id        INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  month          INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year           INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  applied_amount INTEGER NOT NULL CHECK (applied_amount >= 0),
  advance_amount INTEGER NOT NULL CHECK (advance_amount >= 0),
  method         TEXT NOT NULL CHECK (method IN ('cash','upi','bank','online','other')),
  paid_on        TEXT NOT NULL,
  notes          TEXT,
  deleted        INTEGER NOT NULL DEFAULT 0,   -- soft delete: financial records are never hard-deleted
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Advance ledger: 'credit' when extra payment creates advance, 'debit' when advance is applied to a month.
CREATE TABLE IF NOT EXISTS advance_tx (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id     INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('credit','debit')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  month       INTEGER,          -- for debit: the month the advance was applied to; for credit: source month
  year        INTEGER,
  payment_id  INTEGER REFERENCES payments(id) ON DELETE CASCADE,
  notes       TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  category    TEXT NOT NULL,
  custom_name TEXT,
  description TEXT,
  method      TEXT NOT NULL CHECK (method IN ('cash','upi','bank','online','other')),
  paid_to     TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emergency_funds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id   INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  reason        TEXT,
  target_amount INTEGER NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  notes         TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fund_tx (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id     INTEGER NOT NULL REFERENCES emergency_funds(id) ON DELETE CASCADE,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id     INTEGER REFERENCES flats(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('contribution','expense')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL CHECK (method IN ('cash','upi','bank','online','other')),
  date        TEXT NOT NULL,
  notes       TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sheet_connections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL UNIQUE REFERENCES buildings(id) ON DELETE CASCADE,
  sheet_id    TEXT NOT NULL,
  sheet_tab   TEXT NOT NULL DEFAULT 'Sheet1',
  sheet_name  TEXT,
  status      TEXT NOT NULL DEFAULT 'connected',
  last_sync   TEXT
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,      -- success | error
  message     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flats_building        ON flats(building_id);
CREATE INDEX IF NOT EXISTS idx_payments_building     ON payments(building_id, year, month);
CREATE INDEX IF NOT EXISTS idx_payments_flat         ON payments(flat_id, year, month);
CREATE INDEX IF NOT EXISTS idx_advance_flat          ON advance_tx(flat_id);
CREATE INDEX IF NOT EXISTS idx_expenses_building     ON expenses(building_id, date);
CREATE INDEX IF NOT EXISTS idx_fundtx_fund           ON fund_tx(fund_id);

-- ---------- auth / RBAC ----------

-- One unified table for all three roles. role dictates which scope
-- columns are populated (enforced by the CHECK below):
--   master_admin   -> building_id NULL, flat_id NULL (global)
--   building_admin -> building_id set,  flat_id NULL (scoped to one building)
--   resident       -> building_id set,  flat_id set  (scoped to one flat)
CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  role                  TEXT NOT NULL CHECK (role IN ('master_admin','building_admin','resident')),
  username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash         TEXT NOT NULL,
  full_name             TEXT,
  email                 TEXT,
  mobile                TEXT,
  building_id           INTEGER REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id               INTEGER REFERENCES flats(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (role='master_admin'   AND building_id IS NULL     AND flat_id IS NULL) OR
    (role='building_admin' AND building_id IS NOT NULL AND flat_id IS NULL) OR
    (role='resident'       AND building_id IS NOT NULL AND flat_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_users_building ON users(building_id);
CREATE INDEX IF NOT EXISTS idx_users_flat     ON users(flat_id);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

-- Server-side session record, keyed by a random id embedded in the JWT
-- as `sid`. The JWT gives signature integrity; this row gives us
-- revocation, inactivity-timeout enforcement, and login-activity history.
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  revoked         INTEGER NOT NULL DEFAULT 0,
  revoked_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, revoked, expires_at);

-- A resident's payment claim. Deliberately separate from `payments` so
-- pending/rejected submissions never touch recordPayment/buildingSummary/
-- flatLedger/cascade logic until actually approved by a building admin —
-- approval is the moment a real `payments` row gets created.
CREATE TABLE IF NOT EXISTS payment_submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id       INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id           INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  submitted_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month             INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year              INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  amount            INTEGER NOT NULL CHECK (amount > 0),
  method            TEXT NOT NULL CHECK (method IN ('upi','bank','other')),
  transaction_ref   TEXT,
  paid_on           TEXT NOT NULL,
  screenshot_path   TEXT NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TEXT,
  rejection_reason  TEXT,
  payment_id        INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paysub_building ON payment_submissions(building_id, status);
CREATE INDEX IF NOT EXISTS idx_paysub_flat     ON payment_submissions(flat_id);

-- Recurring per-flat charges beyond Maintenance (which stays in
-- flats.monthly_amount). Custom charges are one-off, entered at payment
-- time, so they never get a row here.
CREATE TABLE IF NOT EXISTS flat_charges (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id        INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category IN ('electricity','internet','water')),
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount >= 0),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (flat_id, category)
);
CREATE INDEX IF NOT EXISTS idx_flatcharges_flat     ON flat_charges(flat_id);
CREATE INDEX IF NOT EXISTS idx_flatcharges_building  ON flat_charges(building_id);

-- Per-line breakdown of a resident's multi-category payment submission.
-- Submissions made before this feature existed have zero rows here — the
-- approval route treats "no items" as the legacy single-category path.
CREATE TABLE IF NOT EXISTS payment_submission_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL REFERENCES payment_submissions(id) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category IN ('maintenance','electricity','internet','water','custom')),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  is_adjustment  INTEGER NOT NULL DEFAULT 0,
  custom_title   TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paysubitems_submission ON payment_submission_items(submission_id);

-- One row per approved direct-vendor-payment credit. Created ONLY at the
-- moment of approval — a resident-submitted claim's pending/rejected state
-- lives on payment_submissions.adjustment_* + .status; this table only ever
-- holds decided, active credit. deleted=1 means "revoked" (mirrors
-- payments/expenses/advance_tx's own soft-delete convention).
CREATE TABLE IF NOT EXISTS resident_credits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id   INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  flat_id       INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  submission_id INTEGER REFERENCES payment_submissions(id) ON DELETE SET NULL,
  category      TEXT NOT NULL CHECK (category IN
                  ('electricity','internet','water','sweeper','security','cleaning','generator','custom')),
  custom_title  TEXT,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year          INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  paid_on       TEXT NOT NULL,
  receipt_path  TEXT,
  expense_id    INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_residentcredits_flat       ON resident_credits(flat_id, deleted);
CREATE INDEX IF NOT EXISTS idx_residentcredits_building   ON resident_credits(building_id, deleted);
CREATE INDEX IF NOT EXISTS idx_residentcredits_submission ON resident_credits(submission_id);

CREATE TABLE IF NOT EXISTS notices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id  INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notices_building ON notices(building_id, archived, created_at);
