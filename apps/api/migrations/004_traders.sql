-- ============================================================
--  Traders (CLAUDE.md F24).
--
--  A payout is an award to *somebody*. Until now there was one
--  somebody and the schema left them implicit; with more than one
--  person's payouts in the same ledger, "whose is this?" has to be
--  a column rather than a memory.
--
--  Not `users`. That table is 003's single sign-in account (§5a):
--  one credential, no registration, an admin who manages this
--  ledger. A trader is a person the *money* belongs to, has no
--  password and never signs in, and conflating the two would put a
--  login on every name somebody types into a dropdown.
-- ============================================================

CREATE TABLE traders (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,        -- 'kd', short and yours
  name       TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The trader every existing payout belongs to.
--
-- Inserted here rather than seeded, because unlike the admin credential
-- there is nothing secret about a name: the row is the same in every
-- installation until somebody renames it, which §13's "rename is not a
-- change" already allows.
INSERT INTO traders (id, code, name, notes)
VALUES (1, 'default', 'Me', 'Created when traders were introduced; rename it.');

-- ---------- payouts.trader_id ----------
--
--  Rebuilt rather than ALTERed, and the reason is a SQLite rule:
--  with foreign keys enabled, a column added by ALTER TABLE that
--  carries a REFERENCES clause *must* default to NULL. So the only
--  ways to get `trader_id INTEGER NOT NULL REFERENCES traders(id)`
--  are a nullable column that is never null in practice — §7 says
--  constraints, not habits — or this, the twelve-step rebuild.
--
--  `defer_foreign_keys` holds the checks to COMMIT, so the moment
--  between DROP and RENAME, when `transactions.payout_id` points at
--  a table that does not exist, is not an error. `legacy_alter_table`
--  stops RENAME re-parsing the four views that read payouts: they
--  would be re-parsed against the dropped table and fail, and by the
--  time anything queries them the name resolves again.

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

CREATE TABLE payouts_rebuilt (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  trader_id     INTEGER NOT NULL REFERENCES traders(id) ON DELETE RESTRICT,
  payout_date   TEXT NOT NULL,
  reference     TEXT,
  gross_amount  INTEGER NOT NULL CHECK (gross_amount > 0),
  charges       INTEGER NOT NULL DEFAULT 0 CHECK (charges >= 0),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','settled','cancelled')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (payout_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

INSERT INTO payouts_rebuilt
  (id, code, company_id, trader_id, payout_date, reference,
   gross_amount, charges, currency_code, status, notes, created_at)
SELECT
  id, code, company_id, 1, payout_date, reference,
  gross_amount, charges, currency_code, status, notes, created_at
FROM payouts;

DROP TABLE payouts;
ALTER TABLE payouts_rebuilt RENAME TO payouts;

PRAGMA legacy_alter_table = OFF;

CREATE INDEX ix_payout_trader ON payouts(trader_id, payout_date);
