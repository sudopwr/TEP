# CLAUDE.md — Payout Tracker

This file is the project's memory. Read it before doing anything.
Update it at the end of every task. If something here contradicts the
code, the code is wrong or this file is stale — say so, don't guess.

## 1. What this is

A single-user local application for tracking trading-firm payouts from
gross award to net rupees in the bank, with every supporting document
attached and every fee accounted for.

It runs on one machine, bound to `127.0.0.1`. There is no multi-user
concept, no login, no cloud. The user is the only user.

**Problem it solves.** A payout arrives as USD on a prop firm platform and
moves through a processor, crypto wallets, and an exchange before landing
as INR in a bank. Each hop has its own fee, rate, reference ID and
document. That lives in a spreadsheet today, where copy-paste errors
silently destroyed four amounts and two fee values. The app replaces it
with something that enforces its own invariants.

## 2. Requirements

### Functional

| # | Requirement |
|---|---|
| F1 | Record companies (prop firms, processors) and their contracts |
| F2 | Record a payout: company, date, gross amount, platform charges, reference |
| F3 | Record transactions forming a **tree** — a payout splits into withdrawals, each withdrawal into transfers and a final sale |
| F4 | Every transaction has a from-account, to-account, from-amount + currency, to-amount + currency, and an optional rate |
| F5 | Record fees per transaction by type: TDS, exchange fee, GST, network fee, platform charge |
| F6 | Attach documents (PDF, PNG, CSV) to a company, payout, or transaction; one document may attach to several |
| F7 | Full-text search across document filenames and extracted PDF text |
| F8 | Show the money trail for a payout as a tree, with amounts at each hop |
| F9 | Show settlement per payout: gross proceeds, total fees, net credited |
| F10 | Show current balance per account per currency, including crypto dust |
| F11 | Flag suspicious rows: fee off the declared schedule, unreconciled rate, currency not allowed on an account |
| F12 | Import the legacy CSV once, applying known corrections |
| F13 | Financial-year report: total credited, total TDS, total fees, per company |
| F14 | Sign in with a username and password. A single admin account exists; there is no registration flow |
| F15 | The database ships with `admin` / `admin`, flagged as must-change. No data route is reachable until the password has been changed |
| F16 | The signed-in user can change their username and password from within the app |
| F17 | Session persists across restarts via a signed httpOnly cookie; sign-out revokes it server-side |

### Non-functional

| # | Requirement |
|---|---|
| N1 | Money is **never** a float. Integers in minor units, scale per currency |
| N2 | Every list view responds in under 100ms on a few thousand rows |
| N3 | Domain layer has zero runtime dependencies |
| N4 | Every use case has a unit test; every route an integration test; core journeys an e2e test |
| N5 | One command starts dev, one command builds, one command runs all tests |
| N6 | Data lives in `data/` — `app.db` plus `files/`. Backup = copy that folder |
| N7 | Server binds `127.0.0.1` only. Sign-in gates every route except `/health` and the auth endpoints |
| N9 | Passwords are stored only as an argon2id hash. The plaintext never touches disk, logs, or an error message |
| N10 | The server refuses to start on a non-loopback address while the default password is still in place |
| N8 | UI components are independent and reusable — no feature imports another feature's components |

## 3. Use cases

Each maps to one class in `packages/core/src/usecases/`.

**UC1 — RecordPayout.** Given company, date, gross amount, currency,
charges, reference. Creates a payout in `open` status. Rejects a gross
amount of zero or less, and an unknown company.

**UC2 — RecordTransaction.** Given payout, optional parent, date, kind,
from/to account, from/to amount and currency, optional rate. Rejects: same
from and to account, a rate on a same-currency move, a parent from a
different payout, a currency the destination cannot hold.

**UC3 — RecordSale.** The important one. Given a USDT amount and an INR
rate, computes gross proceeds, applies the exchange's fee schedule to
derive exchange fee and GST, accepts a TDS amount, returns net INR. Where
the 0.5% and 18% rules live.

**UC4 — AttachDocument.** Given bytes, filename, and a target (company /
payout / transaction). Hashes the content, stores the file, dedupes by
hash, links it. Re-uploading links the existing document rather than
duplicating it.

**UC5 — GetPayoutTrail.** Given a payout, returns the transaction tree
with each node's amounts, fees, and documents.

**UC6 — GetSettlement.** Given a payout, returns gross proceeds, total
fees by type, and net credited.

**UC7 — GetAccountBalances.** Returns balance per account per currency,
derived from movements. Never stored.

**UC8 — RunDataQualityChecks.** Returns the list of flagged rows with
reasons.

**UC9 — SearchDocuments.** Given a query string, returns matching
documents via FTS5.

**UC11 — SignIn.** Verifies the argon2id hash, creates a session, returns
it with the must-change flag. One generic error either way, and a hash
comparison even for an unknown username so timing reveals nothing.
Re-hashes a credential stored under weaker parameters — without clearing
the flag, because a rehash is not a password change.

**UC12 — AuthenticateSession.** Session ID to user, or reject. Refuses
expired and revoked (revoked wins when both). Extends past half-life.

**UC13 — ChangeCredentials.** Verifies the current password *first* (so it
is not a free "is that username taken?" oracle), applies the policy against
the *new* username, clears must-change only if the password actually
changed, and revokes every session but the caller's.

**UC14 — SignOut.** Revokes server-side. Idempotent, and says the same
thing for a forged ID as a spent one.

**UC10 — GenerateFinancialYearReport.** Given a date range, totals
credited / TDS / fees, grouped by company.

## 4. Domain glossary

Use these words in code. Do not invent synonyms.

- **Company** — a prop firm or payment processor. Has a contract document.
- **Account** — anywhere money sits: `prop_firm`, `processor`, `exchange`, `wallet`, `bank`.
- **Payout** — a single award from a company. Root of a transaction tree.
- **Transaction** — one movement between two accounts. Has a `parent_id`.
- **Kind** — `payout_credit` | `withdrawal` | `transfer` | `sale` | `deposit`.
- **Sale** — the exchange → bank leg. The only leg producing INR.
- **Gross proceeds** — `from_amount × rate`, before fees.
- **Net credited** — gross proceeds minus TDS, exchange fee, and GST.
- **Dust** — small crypto residue left in a wallet after a transfer.
- **Must-change** — the flag on the admin row that blocks every data route
  until the shipped default password has been replaced.
- **Session** — a server-side row keyed by a random 256-bit ID, referenced
  by a signed httpOnly cookie.

## 5. Architecture

```
packages/core/          ZERO dependencies. Never imports Fastify, SQLite, React.
  domain/               Money, Invoice-style entities, errors
  usecases/             one class per UC above
  ports/                interfaces the outside world must satisfy

apps/api/               Fastify + better-sqlite3
  adapters/             implements core ports
  routes/               thin — parse, call use case, serialize
  auth/                 password hashing, session cookie, route guard
  container.ts          the only file that knows about everything

apps/web/               React + Vite + MUI + TanStack Query
  shared/               reusable components, zero feature knowledge
  features/             one folder per feature, no cross-imports
```

**The dependency rule.** Dependencies point inward only. `core` knows
nothing about anything. If `packages/core/package.json` ever gains a
runtime dependency, something has leaked and must be reverted.

**Ports earn their existence.** Create an interface only where a fake is
needed in tests or a second implementation genuinely exists. A wrapper
around one library with one caller is not a port.

## 5a. Authentication

Username and password, one account, no registration. There is nothing to
sign up for — the app is for one person on one machine.

**Storage.** argon2id via `@node-rs/argon2` at the library's recommended
parameters (m=19456, t=2, p=1). Never SHA-anything, never a homemade salt.
`password_hash` holds the full encoded string including salt and parameters,
so raising the cost later is a rehash-on-next-login, not a migration.

```
users(id INTEGER PK, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL,
      created_at TEXT NOT NULL, password_changed_at TEXT)

sessions(id TEXT PK, user_id INTEGER NOT NULL REFERENCES users(id),
         created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
         revoked_at TEXT)
```

**The default account.** Migration `003_auth.sql` creates the tables; the
hash is computed at migration time by `db/seeds.ts`, never written into the
`.sql` file — a literal hash there means one shared salt in every install,
in a file the checksum makes unchangeable. (This said `002` before
`002_reference_currencies.sql` existed; renumbering applied history is what
the checksum guard exists to prevent.)

A deliberate convenience with a deliberate cage: (1) every route except
`/health`, `/auth/login`, `/auth/me`, `/auth/logout` and
`/auth/change-credentials` returns 403 `password_change_required` while the
flag is set; (2) the server refuses to bind anywhere but `127.0.0.1` while
it is set, and says why; (3) the UI routes to the change screen with no way
past — **not built; there is no web app yet**. The default is safe only
because of all three; remove one and the default must go too.

**Password policy.** 12 characters minimum; rejects the current password,
the username, and a short embedded common list. No composition rules —
length beats punctuation, and forced symbols produce `Password1!`. A pure
function in `core/domain/password-policy.ts` returning every violation, not
the first. Every common-list entry is itself 12+ characters, since anything
shorter already dies on length. No *username* length rule: never specified,
and `kd` is a fine name here.

**Rehash is not a change**, nor is a rename: `must_change_password` clears
only when a password is actually set.

**Failure handling.** One message for every sign-in failure — unknown
username and wrong password give byte-identical responses, and an unknown
username still runs a full argon2 verification against a per-process dummy
hash so the timing matches. 5 attempts per minute on `/auth/login` only.
Never log a password: `server.ts` carries the redaction paths.

**Session.** ID is 32 random bytes, base64url, compared timing-safely.
Cookie: `httpOnly`, `sameSite=lax`, `secure=false` (loopback has no TLS),
`path=/`, 30 days, session ID only. `SESSION_SECRET` lives in gitignored
`.env`, generated on first run — it signs the cookie, so losing it only
signs everyone out.

## 6. Money

Stored as `INTEGER` in minor units. Scale lives in the `currencies`
table: INR 2, USD 2, USDT 8. Rates are scaled by 1e8.

- `4599` INR = ₹45.99
- `75317770000` USDT = 753.1777 USDT
- `9766520000` rate = 97.6652

Never `REAL`, never `number` arithmetic on decimals in the domain. The
`Money` value object is the only thing allowed to do arithmetic, and it
throws on currency mismatch.

## 7. Invariants

Enforced by database constraints — do not duplicate in application code
unless the message needs to be friendlier:

- `from_account_id <> to_account_id`
- `rate_applied IS NULL` when `from_currency = to_currency`
- dates match `YYYY-MM-DD`
- one fee per type per transaction
- a `document_links` row targets exactly one of company / payout / transaction
- amounts are positive

Enforced by views, not constraints, because they are suspicious rather
than impossible — see `v_data_quality`:

- a cross-currency move with no recorded rate
- `to_amount` that doesn't reconcile with rate and fees
- a fee more than 2% off the declared schedule
- a transaction sending more than its parent delivered (legitimate when
  dust from an earlier transfer is still in the wallet)

## 8. Fee rules

Declared in `fee_schedules`, not hardcoded:

| Account | Fee | Basis | Rate |
|---|---|---|---|
| CoinDCX | exchange_fee | to_amount | 0.50% |
| CoinDCX | gst | exchange_fee | 18% |
| Rise | network_fee | flat | ~$4.00 |

The Rise withdrawal fee is flat, not proportional. Four withdrawals cost
$16.31 where one would have cost $4.03. The app should make this visible
— see the open question in §11.

## 9. Known defects in the source CSV

The importer corrects these. Do not "fix" the importer to trust the
sheet.

1. **`From` amount wrong on all four sale rows** — `45.957` copy-pasted.
   True values recomputed as `to_amount / rate`. Transaction0011's real
   from-amount is 741.72, not 45.957.
2. **Exchange fee and GST swapped** between Transaction003 and
   Transaction0011. As written they imply 8.39% and 0.03%; swapped, both
   are 0.508%.
3. **`1.43908E+19`** — Excel destroyed a long platform reference ID by
   converting it to a float. Unrecoverable. All reference columns are
   `TEXT`.
4. **Duplicate `ToAmount` header** — the first occurrence is the from-side.
5. **`Transaction0010` sorts before `Transaction002`** as text. Internal
   keys are integers; the sheet ID is kept as `code`.

## 10. Verified reference figures

From `TradeifyPayout001`. Any refactor must still produce these:

```
payout gross          $1,008.01
gross proceeds        ₹86,027.56
total fees            ₹ 1,384.63
net credited          ₹84,642.93

TDS             ₹868.88   exchange_fee  ₹437.09
GST             ₹ 78.66   network_fee   $ 16.31
platform_charge $100.79

balances:  Bank 84,642.93 INR
           CoinDCX 14.0908 USDT
           TrustWallet 1.3323 USDT
```

## 11. Open questions

- Does CoinDCX charge 0.5% on **order value** or on **net proceeds**?
  Transaction005 computes to 0.4866% and Transaction008 to 0.5308% on
  proceeds. If it's order value, partial fills explain the spread and
  `fee_schedules.basis` becomes `from_amount`. Check one order on the
  CoinDCX statement.
- Should the app warn before a withdrawal below a threshold, given the
  flat $4 fee? Suggested but not decided.
- Is the app ever going to be reached from outside this machine? If yes,
  put Tailscale in front rather than exposing the port, and revisit §5a —
  a single password over a LAN deserves a second factor, and the
  `secure=false` cookie flag must become `true` behind TLS.

## 12. Conventions

- TypeScript everywhere. `strict: true`.
- Vitest for unit and integration. Playwright for e2e.
- Test file next to source: `money.ts` / `money.test.ts`.
- No default exports except React components.
- Errors are typed classes in `core/domain/errors.ts`, never bare strings.
- SQL lives in adapter files, never in routes or use cases.
- Prepared statements built once at module level.
- Commit message: `feat(core): ...`, `fix(api): ...`, `test(web): ...`.

## 13. Decision log

Append here. Newest last. Never delete an entry — supersede it.

- **Money as scaled integers, scale per currency.** One fixed scale breaks
  INR or USDT; floats break both, quietly.
- **Fees as rows, not columns.** New types shouldn't need a migration, and a
  fee carries its own currency — TDS is INR, the Rise fee USD.
- **Status and totals derived, never stored**; a stored status drifts the
  first time a row is edited.
- **`document_links` uses three nullable FKs with a CHECK summing to 1**, not
  polymorphic `entity_type`/`entity_id`, which discards referential integrity.
- **Addresses snapshotted on the transaction, normalized in
  `account_identifiers`.** The FK says which account, the snapshot which
  address was used that day.
- **Constraints for impossible states, views for suspicious ones.** Enforcing
  "cross-currency implies a rate" would block entry before the rate is known.
- **`to_amount` on a sale is gross proceeds**, matching the statement. Fees
  are separate rows; net is derived.
- ~~**Google sign-in with a one-subject allow-list.**~~ Superseded: it
  stored no credential, but needed a Google Cloud project, internet access,
  and a hostname-bound redirect URI — three dependencies an offline local
  tool should not carry.
- **Username and password with a single account**, replacing the above. The
  cost is that we now own the hashing, the timing and the rate limiting.
  Accepted; §5a is where it is paid, and its rules are not optional.
- **Ships with `admin` / `admin` and a must-change flag.** Indefensible
  except for §5a's three constraints. Remove any one and the default goes.
- **Sessions are server-side rows, not JWTs.** Sign-out must actually
  revoke, and a stateless token cannot be without building this very table.
- **Auth logic lives in `apps/api/auth/`, not `core`.** Hashing and cookies
  are infrastructure; `core` sees a `PasswordHasher` port.
- **Changing credentials revokes all other sessions** — including on a
  username-only change. The reason anyone changes one is that they think it
  leaked.
- **Guards are global with an exemption list, never opt-in per route.** A
  forgotten route must fail closed. `PUBLIC_ROUTES` + `MUST_CHANGE_EXEMPT`
  = §5a's five; `/auth/me` and `/auth/change-credentials` are in the second
  list only, since both need to know who is asking and 401 when nobody is.
- **Migrations can carry a seed running in their transaction**, for rows no
  SQL text can express — so far one, the admin credential, whose salt must
  differ per install. Keyed by filename so a test directory can't clash.
- **`removeAdditional: false` on Fastify's ajv.** The default silently drops
  an undeclared field, turning a typo'd `newPasword` into a 200 that changed
  nothing while the person believes it did.
- **Session-id compare is constant-time; the index probe isn't.** An honest
  limit, not a fix — with a 256-bit id the residue is negligible. The rule
  stays so nobody swaps in a 6-digit code and keeps the `===`.
- **`cause` and `name` are taken on `Error`** — hence `.failure` on
  `AuthenticationFailedError`, as `.migrationName` already worked around.
- **`Algorithm.Argon2id` is an ambient `const enum`** `verbatimModuleSyntax`
  won't inline; the literal `2` is used, pinned by a test on the `$argon2id$`
  prefix.
- **`.catch(e => e as E)` in a test is a bug** — it widens the type and passes
  when the call *resolves*. Use `packages/core/test/rejection.ts`; vitest does
  not typecheck, so `npm run typecheck` is the only net.

## 14. Task protocol

At the end of every task:

1. Run the full test suite. Do not report done with a failing test.
2. Append anything durable to §13 — a decision, a gotcha, a corrected
   assumption.
3. Move anything resolved out of §11.
4. If the task changed the schema, update §6, §7, or §8 to match.
5. Keep this file under 400 lines. Condense old entries rather than
   letting it sprawl.