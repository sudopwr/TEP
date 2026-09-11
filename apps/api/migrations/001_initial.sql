-- ============================================================
--  Personal payout tracker — SQLite schema
--  Money is stored as INTEGER in the smallest unit of the
--  currency, where "smallest unit" is defined by currencies.scale.
--  Never use REAL for money.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- Reference ----------

CREATE TABLE currencies (
  code    TEXT PRIMARY KEY,                                  -- 'INR', 'USD', 'USDT'
  scale   INTEGER NOT NULL CHECK (scale BETWEEN 0 AND 18),   -- decimals used for storage
  divisor INTEGER NOT NULL,                                  -- 10^scale, stored so views
                                                             -- don't need the math extension
  kind    TEXT NOT NULL CHECK (kind IN ('fiat', 'crypto')),
  symbol  TEXT
);

-- ---------- Counterparties ----------

CREATE TABLE companies (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,        -- 'Tradeify001' from the sheet
  name       TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every place money can sit: prop firm, processor, exchange, wallet, bank.
CREATE TABLE accounts (
  id                    INTEGER PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,   -- 'rise', 'coindcx', 'bank-hdfc'
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN
                          ('prop_firm','processor','exchange','wallet','bank')),
  company_id            INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  default_currency_code TEXT REFERENCES currencies(code),   -- NULL = genuinely multi-currency
  is_mine               INTEGER NOT NULL DEFAULT 1 CHECK (is_mine IN (0,1)),
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wallet addresses / masked account numbers / payment emails.
-- Separate table because one account can have several, and they rotate.
CREATE TABLE account_identifiers (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN
                ('wallet','bank_account','email','platform_id')),
  value      TEXT NOT NULL,
  label      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (account_id, kind, value)
);

-- An account may hold several currencies (Rise pays in USD or USDT;
-- CoinDCX holds USDT and INR). This is the allow-list, not a balance.
CREATE TABLE account_currencies (
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  PRIMARY KEY (account_id, currency_code)
) WITHOUT ROWID;

-- ---------- Fee rules ----------
-- Declared once so reports can predict a fee and the data-quality view can
-- catch a wrong one. CoinDCX: 0.5% of proceeds, plus GST at 18% of that fee.
CREATE TABLE fee_schedules (
  id             INTEGER PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fee_type       TEXT NOT NULL CHECK (fee_type IN
                   ('tds','exchange_fee','gst','network_fee','platform_charge')),
  basis          TEXT NOT NULL CHECK (basis IN
                   ('to_amount','from_amount','exchange_fee','flat')),
  rate_bps       INTEGER CHECK (rate_bps IS NULL OR rate_bps >= 0),  -- 50 = 0.50%
  flat_amount    INTEGER CHECK (flat_amount IS NULL OR flat_amount >= 0),
  currency_code  TEXT REFERENCES currencies(code),
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  CHECK ((basis = 'flat') = (flat_amount IS NOT NULL)),
  CHECK ((basis = 'flat') = (rate_bps IS NULL)),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- ---------- Payouts ----------

CREATE TABLE payouts (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,          -- 'TradeifyPayout001'
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payout_date   TEXT NOT NULL,
  reference     TEXT,                          -- 'FTDFYSLX50676373980'
  gross_amount  INTEGER NOT NULL CHECK (gross_amount > 0),
  charges       INTEGER NOT NULL DEFAULT 0 CHECK (charges >= 0),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','settled','cancelled')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (payout_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

-- ---------- Transactions ----------
-- One row = one movement of value from one account to another.
-- parent_id builds the tree: a payout splits into withdrawals,
-- each withdrawal into a conversion, each conversion into a sale.

CREATE TABLE transactions (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,        -- 'Transaction001'
  payout_id       INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES transactions(id) ON DELETE RESTRICT,
  txn_date        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('payout_credit','withdrawal','transfer','sale','deposit')),

  from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  from_address    TEXT,                        -- snapshot of address used that day
  to_address      TEXT,

  from_amount     INTEGER NOT NULL CHECK (from_amount > 0),
  from_currency   TEXT NOT NULL REFERENCES currencies(code),
  to_amount       INTEGER NOT NULL CHECK (to_amount > 0),
  to_currency     TEXT NOT NULL REFERENCES currencies(code),
  rate_applied    INTEGER CHECK (rate_applied IS NULL OR rate_applied > 0),  -- scaled 1e8

  from_external_ref TEXT,     -- TEXT, always. See note in the write-up.
  to_external_ref   TEXT,
  explorer_url      TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (from_account_id <> to_account_id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (txn_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- a rate is meaningless when the currency does not change.
  -- the reverse is NOT enforced: a cross-currency move may legitimately
  -- have an unknown rate at entry time. flag those in a view instead.
  CHECK (from_currency <> to_currency OR rate_applied IS NULL)
);

CREATE INDEX ix_txn_payout  ON transactions(payout_id);
CREATE INDEX ix_txn_parent  ON transactions(parent_id);
CREATE INDEX ix_txn_date    ON transactions(txn_date);
CREATE INDEX ix_txn_from    ON transactions(from_account_id, txn_date);
CREATE INDEX ix_txn_to      ON transactions(to_account_id, txn_date);

-- Fees as rows, not columns: TDS / exchange fee / GST / network fee
-- apply to different transaction kinds, and new ones appear over time.
CREATE TABLE transaction_fees (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  fee_type       TEXT NOT NULL CHECK (fee_type IN
                   ('tds','exchange_fee','gst','network_fee','platform_charge')),
  amount         INTEGER NOT NULL CHECK (amount >= 0),
  currency_code  TEXT NOT NULL REFERENCES currencies(code),
  UNIQUE (transaction_id, fee_type)
);

-- ---------- Documents ----------

CREATE TABLE documents (
  id             INTEGER PRIMARY KEY,
  filename       TEXT NOT NULL,               -- original name
  stored_path    TEXT NOT NULL UNIQUE,        -- relative to data/files
  mime_type      TEXT,
  byte_size      INTEGER,
  sha256         TEXT UNIQUE,                 -- dedupe + integrity
  doc_type       TEXT CHECK (doc_type IN
                   ('agreement','invoice','receipt','screenshot','statement','other')),
  doc_date       TEXT,
  extracted_text TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One document can attach to several things (a payout screenshot is also
-- evidence for the first transaction). Exactly one FK is set per row.
CREATE TABLE document_links (
  id             INTEGER PRIMARY KEY,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  company_id     INTEGER REFERENCES companies(id)     ON DELETE CASCADE,
  payout_id      INTEGER REFERENCES payouts(id)       ON DELETE CASCADE,
  transaction_id INTEGER REFERENCES transactions(id)  ON DELETE CASCADE,
  role           TEXT,                        -- 'invoice','proof','contract'
  CHECK ((company_id IS NOT NULL)
       + (payout_id IS NOT NULL)
       + (transaction_id IS NOT NULL) = 1)
);

CREATE UNIQUE INDEX ux_doclink_company ON document_links(document_id, company_id)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX ux_doclink_payout ON document_links(document_id, payout_id)
  WHERE payout_id IS NOT NULL;
CREATE UNIQUE INDEX ux_doclink_txn ON document_links(document_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Full-text search over document text + filename.
CREATE VIRTUAL TABLE documents_fts USING fts5(
  filename, extracted_text,
  content='documents', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, filename, extracted_text)
  VALUES (new.id, new.filename, new.extracted_text);
END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, filename, extracted_text)
  VALUES ('delete', old.id, old.filename, old.extracted_text);
END;
CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, filename, extracted_text)
  VALUES ('delete', old.id, old.filename, old.extracted_text);
  INSERT INTO documents_fts(rowid, filename, extracted_text)
  VALUES (new.id, new.filename, new.extracted_text);
END;

-- ---------- Views ----------

-- Human-readable amounts. Scale lives in one place, so no magic numbers
-- scattered through app code.
CREATE VIEW v_transactions AS
SELECT
  t.id, t.code, p.code AS payout_code, pt.code AS parent_code,
  t.txn_date, t.kind,
  fa.name AS from_account, ta.name AS to_account,
  t.from_amount / CAST(fc.divisor AS REAL) AS from_amt,  t.from_currency,
  t.to_amount   / CAST(tc.divisor AS REAL) AS to_amt,    t.to_currency,
  t.rate_applied / 1e8 AS rate,
  (SELECT COALESCE(SUM(f.amount), 0) / 100.0
     FROM transaction_fees f
    WHERE f.transaction_id = t.id AND f.currency_code = 'INR') AS fees_inr
FROM transactions t
JOIN payouts p       ON p.id  = t.payout_id
LEFT JOIN transactions pt ON pt.id = t.parent_id
JOIN accounts fa     ON fa.id = t.from_account_id
JOIN accounts ta     ON ta.id = t.to_account_id
JOIN currencies fc   ON fc.code = t.from_currency
JOIN currencies tc   ON tc.code = t.to_currency;

-- Gross proceeds, fees, and what the bank actually credited.
-- to_amount on a sale is from_amount * rate, i.e. BEFORE fees --
-- TDS, exchange fee and GST are deducted separately.
CREATE VIEW v_payout_settlement AS
SELECT
  p.code AS payout_code,
  c.name AS company,
  p.payout_date,
  p.gross_amount / 100.0 AS gross_usd,
  (SELECT COALESCE(SUM(t.to_amount), 0) / 100.0
     FROM transactions t JOIN accounts a ON a.id = t.to_account_id
    WHERE t.payout_id = p.id AND a.type = 'bank' AND t.to_currency = 'INR')
    AS proceeds_inr,
  (SELECT COALESCE(SUM(f.amount), 0) / 100.0
     FROM transaction_fees f JOIN transactions t ON t.id = f.transaction_id
    WHERE t.payout_id = p.id AND f.currency_code = 'INR')
    AS fees_inr,
  (SELECT COALESCE(SUM(t.to_amount), 0) / 100.0
     FROM transactions t JOIN accounts a ON a.id = t.to_account_id
    WHERE t.payout_id = p.id AND a.type = 'bank' AND t.to_currency = 'INR')
  - (SELECT COALESCE(SUM(f.amount), 0) / 100.0
     FROM transaction_fees f JOIN transactions t ON t.id = f.transaction_id
    WHERE t.payout_id = p.id AND f.currency_code = 'INR')
    AS net_credited_inr
FROM payouts p
JOIN companies c ON c.id = p.company_id;

-- Running balance per account per currency, derived from movements.
CREATE VIEW v_account_balances AS
SELECT a.name AS account, m.currency_code,
       SUM(m.delta) / CAST(cu.divisor AS REAL) AS balance
FROM (
  SELECT to_account_id AS account_id, to_currency AS currency_code, to_amount AS delta
    FROM transactions
  UNION ALL
  SELECT from_account_id, from_currency, -from_amount FROM transactions
  UNION ALL
  -- a fee is debited from whichever side of the move holds that currency
  SELECT CASE WHEN f.currency_code = t.to_currency
              THEN t.to_account_id ELSE t.from_account_id END,
         f.currency_code, -f.amount
    FROM transaction_fees f JOIN transactions t ON t.id = f.transaction_id
) m
JOIN accounts a    ON a.id = m.account_id
JOIN currencies cu ON cu.code = m.currency_code
GROUP BY a.id, m.currency_code
HAVING ROUND(SUM(m.delta)) <> 0;

-- Suspicious-but-legal rows. Constraints block impossible states;
-- this view surfaces the merely questionable ones.
CREATE VIEW v_data_quality AS
  SELECT code, 'cross-currency move with no rate recorded' AS issue
    FROM transactions
   WHERE from_currency <> to_currency AND rate_applied IS NULL
  UNION ALL
  SELECT t.code, 'sends more than the parent delivered'
    FROM transactions t JOIN transactions p ON p.id = t.parent_id
   WHERE t.from_currency = p.to_currency AND t.from_amount > p.to_amount
  UNION ALL
  -- to_amount should equal (from_amount minus fees charged in the source
  -- currency) times the rate. tolerance of 1 unit absorbs rounding.
  SELECT t.code, 'to_amount does not reconcile with rate and fees'
    FROM transactions t
    JOIN currencies fc ON fc.code = t.from_currency
    JOIN currencies tc ON tc.code = t.to_currency
   WHERE t.rate_applied IS NOT NULL
     AND ABS(t.to_amount
             - ((t.from_amount - COALESCE((SELECT SUM(f.amount) FROM transaction_fees f
                                            WHERE f.transaction_id = t.id
                                              AND f.currency_code = t.from_currency), 0))
                * (t.rate_applied / 100000000.0) * tc.divisor / fc.divisor))
         > 0.01 * tc.divisor
  UNION ALL
  -- fee differs from the declared schedule by more than 2%
  SELECT t.code, 'fee ' || f.fee_type || ' does not match declared schedule'
    FROM transaction_fees f
    JOIN transactions t   ON t.id = f.transaction_id
    JOIN fee_schedules s  ON s.account_id = t.from_account_id
                         AND s.fee_type = f.fee_type
                         AND t.txn_date >= s.effective_from
                         AND (s.effective_to IS NULL OR t.txn_date <= s.effective_to)
   WHERE s.basis <> 'flat'
     AND ABS(f.amount - (s.rate_bps / 10000.0) * CASE s.basis
               WHEN 'to_amount'    THEN t.to_amount
               WHEN 'from_amount'  THEN t.from_amount
               WHEN 'exchange_fee' THEN (SELECT COALESCE(SUM(x.amount), 0)
                                           FROM transaction_fees x
                                          WHERE x.transaction_id = t.id
                                            AND x.fee_type = 'exchange_fee')
             END)
         > 0.02 * f.amount
  UNION ALL
  -- a currency moved through an account that is not on its allow-list
  SELECT t.code, 'currency not permitted on ' || a.name
    FROM transactions t JOIN accounts a ON a.id = t.to_account_id
   WHERE EXISTS (SELECT 1 FROM account_currencies WHERE account_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM account_currencies
                      WHERE account_id = a.id AND currency_code = t.to_currency)
  UNION ALL
  SELECT p.code, 'payout has no transaction reaching a bank account'
    FROM payouts p
   WHERE NOT EXISTS (SELECT 1 FROM transactions t JOIN accounts a ON a.id = t.to_account_id
                      WHERE t.payout_id = p.id AND a.type = 'bank');