-- ============================================================
--  Reference data the schema cannot function without.
--
--  Every money column is an INTEGER in minor units, and the
--  scale that makes those integers mean something lives here
--  (CLAUDE.md §6). transactions.from_currency and friends are
--  foreign keys onto this table, so an empty currencies table
--  makes the schema unusable rather than merely unpopulated.
--
--  divisor is 10^scale, stored so views need no math extension.
-- ============================================================

INSERT INTO currencies (code, scale, divisor, kind, symbol) VALUES
  ('INR',  2,       100, 'fiat',   '₹'),
  ('USD',  2,       100, 'fiat',   '$'),
  ('USDT', 8, 100000000, 'crypto', 'USDT');
