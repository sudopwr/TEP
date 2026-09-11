-- ============================================================
--  Authentication (CLAUDE.md §5a).
--
--  One account, no registration. These two tables are the whole
--  of it: a credential and the sessions issued against it.
--
--  Numbered 003, not 002. §5a says "migration 002 inserts admin",
--  which was written before 002_reference_currencies.sql existed;
--  that file is applied history in every database already created,
--  and renumbering applied history is exactly what the migration
--  runner's checksum guard exists to prevent. §5a has been
--  corrected to match.
--
--  The admin row is NOT inserted here. An argon2id hash cannot be
--  written into a .sql file without committing a literal hash of a
--  known password to the repository, so the row is seeded by
--  db/seeds.ts inside this migration's own transaction.
-- ============================================================

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE CHECK (length(username) > 0),

  -- The full argon2id encoded string: algorithm, version, parameters,
  -- salt and tag. Never a bare digest — §5a's "raising the cost later
  -- is a rehash on next login" only works because the parameters that
  -- produced this value travel inside it.
  password_hash        TEXT NOT NULL CHECK (length(password_hash) > 0),

  -- The cage. While this is 1, every data route 403s and the server
  -- refuses to leave loopback. See §5a.
  must_change_password INTEGER NOT NULL DEFAULT 1
                         CHECK (must_change_password IN (0, 1)),

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  password_changed_at  TEXT
);

-- Server-side sessions (§13: "Sessions are server-side rows, not JWTs").
-- Sign-out has to actually revoke, and a stateless token cannot be revoked
-- without building this table anyway.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,               -- 32 random bytes, base64url
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,

  -- A session that expires before it was created is not a session.
  CHECK (expires_at > created_at)
);

-- Every guarded request reads a session, and housekeeping sweeps by expiry.
-- Timestamps are ISO-8601 TEXT, so this index orders chronologically.
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Revoking every session but one is a single statement in UC13; this keeps
-- it from scanning the table.
CREATE INDEX idx_sessions_user ON sessions(user_id);
