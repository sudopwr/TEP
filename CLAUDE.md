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
moves through a processor, crypto wallets and an exchange before landing as
INR in a bank. Each hop has its own fee, rate, reference and document. That
lives in a spreadsheet today, where copy-paste errors silently destroyed four
amounts and two fee values. The app enforces its own invariants instead.

## 2. Requirements

### Functional

| # | Requirement |
|---|---|
| F1 | Record companies (prop firms, processors) and their contracts |
| F2 | Record a payout: company, date, gross amount, platform charges, reference |
| F3 | Record transactions forming a **tree**: a payout splits into withdrawals, each into transfers and a final sale |
| F4 | Every transaction: from/to account, from/to amount + currency, optional rate |
| F5 | Record fees per transaction by type: TDS, exchange fee, GST, network fee, platform charge |
| F6 | Attach documents to a company, payout, or transaction; one document may attach to several |
| F7 | Full-text search across document filenames and extracted PDF text |
| F8 | Show the money trail for a payout as a tree, with amounts at each hop |
| F9 | Show settlement per payout: gross proceeds, total fees, net credited |
| F10 | Show current balance per account per currency, including crypto dust |
| F11 | Flag suspicious rows: fee off schedule, unreconciled rate, currency not allowed |
| F12 | Import the legacy CSV once, applying known corrections |
| F13 | Financial-year report: total credited, total TDS, total fees, per company |
| F14 | Sign in with a username and password. A single admin account exists; there is no registration flow |
| F15 | Ships with `admin` / `admin`, flagged must-change. No data route works until it changes |
| F16 | The signed-in user can change their username and password from within the app |
| F17 | Session persists across restarts via a signed httpOnly cookie; sign-out revokes it |

### Non-functional

| # | Requirement |
|---|---|
| N1 | Money is **never** a float. Integers in minor units, scale per currency |
| N2 | Every list view responds in under 100ms on a few thousand rows |
| N3 | Domain layer has zero runtime dependencies |
| N4 | Every use case has a unit test; every route an integration test; core journeys an e2e test |
| N5 | One command starts dev, one command builds, one command runs all tests |
| N6 | Data lives in `data/` — `app.db` plus `files/`. Backup = copy that folder |
| N7 | Binds `127.0.0.1` only. Sign-in gates every route except `/health` and auth |
| N9 | Passwords stored only as an argon2id hash; plaintext never touches disk, logs, or an error |
| N10 | The server refuses a non-loopback address while the default password is in place |
| N8 | UI components are independent and reusable — no feature imports another feature's components |

## 3. Use cases

Each maps to one class in `packages/core/src/usecases/`.

**UC1 — RecordPayout.** Company, date, gross, currency, charges, reference.
Creates it `open`. Rejects gross <= 0 and an unknown company.

**UC2 — RecordTransaction.** Rejects: same from and to account, a rate on a
same-currency move, a parent from a different payout, a currency the
destination cannot hold.

**UC3 — RecordSale.** The important one. A USDT amount and an INR rate ->
gross proceeds, the exchange's schedule applied for exchange fee and GST, a
TDS amount accepted from the statement, net INR out. Where 0.5% and 18% live.

**UC4 — AttachDocument.** Hashes, stores, dedupes by hash, links. Re-uploading
links the existing document instead of duplicating it.

**UC5 — GetPayoutTrail.** The transaction tree, with amounts, fees and
documents at each node. **UC6 — GetSettlement.** Gross proceeds, fees by type,
net credited. **UC7 — GetAccountBalances.** Per account per currency, derived
from movements, never stored. **UC8 — RunDataQualityChecks.** The flagged rows
with reasons. **UC9 — SearchDocuments.** FTS5 over filename and text.

**UC11 — SignIn.** Verifies the hash, opens a session, reports the must-change
flag. One generic error either way, and a hash comparison even for an unknown
username so timing reveals nothing. Re-hashes a credential stored under weaker
parameters, without clearing the flag — a rehash is not a password change.

**UC12 — AuthenticateSession.** Session ID to user, or reject. Refuses expired
and revoked (revoked wins when both). Extends past half-life.

**UC13 — ChangeCredentials.** Verifies the current password *first* (so it is
not a free "is that username taken?" oracle), applies the policy against the
*new* username, clears must-change only if the password actually changed, and
revokes every session but the caller's.

**UC14 — SignOut.** Revokes server-side. Idempotent, and says the same thing
for a forged ID as a spent one.

**Not numbered**, because §3 was written assuming these already existed:
`RecordCompany` and `ListCompanies` (F1), `ListPayouts` (F2),
`ListTransactions` (F3), `GetDocument` (F6, metadata only — the route streams
the bytes), `ImportLegacyCsv` (F12).

**UC10 — GenerateFinancialYearReport.** A date range, totalling credited /
TDS / fees, grouped by company.

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
  adapters/             implements core ports; the only place SQL lives
  routes/               thin — parse (zod), call one use case, serialize
  auth/                 password hashing, session cookie, route guards
  db/                   connection pragmas, migration runner, seeds
  decorators.ts         types only: what a route may reach off the instance
  container.ts          the only file importing both a use case and an adapter
  server.ts             plugin order, guards, error handler
  main.ts               bootstrap: migrate, check bind address, listen

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

**Storage.** argon2id via `@node-rs/argon2` at its recommended parameters
(m=19456, t=2, p=1). Never SHA-anything, never a homemade salt. `password_hash`
holds the full encoded string, salt and parameters included, so raising the
cost later is a rehash-on-next-login rather than a migration.

`users(id, username UNIQUE, password_hash, must_change_password, created_at,
password_changed_at)` and `sessions(id TEXT PK, user_id FK, created_at,
expires_at, revoked_at)` — see `003_auth.sql`, which is the authority.

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

**Password policy.** 12 characters minimum; rejects the current password, the
username and a short embedded common list. No composition rules — length beats
punctuation, and forced symbols produce `Password1!`. A pure function in
`core/domain/password-policy.ts` returning every violation, not the first.
Every common-list entry is itself 12+ characters, since anything shorter dies
on length. No *username* length rule: never specified, and `kd` is fine.
**Rehash is not a change**, nor is a rename — `must_change_password` clears
only when a password is actually set.

**Failure handling.** One message for every sign-in failure — unknown username
and wrong password give byte-identical responses, and an unknown username still
runs a full argon2 verification against a per-process dummy hash so the timing
matches. 5 attempts a minute on `/auth/login` only. Never log a password:
`server.ts` carries the redaction paths.

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

By database constraints; not duplicated in application code unless the
message needs to be friendlier:

- `from_account_id <> to_account_id`
- `rate_applied IS NULL` when `from_currency = to_currency`
- dates match `YYYY-MM-DD`
- one fee per type per transaction
- a `document_links` row targets exactly one of company / payout / transaction
- amounts are positive

Enforced by views, not constraints — suspicious rather than impossible
(`v_data_quality`):

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

The Rise withdrawal fee is flat, not proportional: four withdrawals cost
$16.31 where one would have cost $4.03. See the open question in §11.

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
- SQL lives in adapter files (never routes or use cases); statements prepared
  once per connection.
- Commit message: `feat(core): ...`, `fix(api): ...`, `test(web): ...`.

## 13. Decision log

Append here. Newest last. Never delete an entry — supersede it.

- **Money as scaled integers, scale per currency.** One fixed scale breaks INR
  or USDT; floats break both, quietly.
- **Fees as rows, not columns**, each carrying its own currency — TDS is INR,
  the Rise fee USD. New types then need no migration.
- **Status and totals derived, never stored**; a stored status drifts the first
  time a row is edited. `to_amount` on a sale is gross proceeds, matching the
  statement; fees are separate rows and net is derived.
- **`document_links` uses three nullable FKs with a CHECK summing to 1**, not
  polymorphic `entity_type`/`entity_id`, which discards referential integrity.
- **Addresses snapshotted on the transaction, normalized in
  `account_identifiers`** — the FK says which account, the snapshot which
  address was used that day.
- **Constraints for impossible states, views for suspicious ones.** Enforcing
  "cross-currency implies a rate" would block entry before the rate is known.
- ~~**Google sign-in with a one-subject allow-list.**~~ Superseded by
  **username and password with a single account**: it stored no credential but
  needed a Google Cloud project, internet access and a hostname-bound redirect
  URI. The cost of replacing it is that we now own the hashing, the timing and
  the rate limiting — accepted, and §5a is where it is paid.
- **Ships with `admin` / `admin` and a must-change flag.** Indefensible
  except for §5a's three constraints. Remove any one and the default goes.
- **Sessions are server-side rows, not JWTs.** Sign-out must actually
  revoke, and a stateless token cannot be without building this very table.
- **Auth logic lives in `apps/api/auth/`, not `core`** — hashing and cookies are
  infrastructure; `core` sees a `PasswordHasher` port. **Changing credentials
  revokes all other sessions**, including on a username-only change: the reason
  anyone changes one is that they think it leaked.
- **Guards are global with an exemption list, never opt-in per route** — a
  forgotten route must fail closed. `PUBLIC_ROUTES` + `MUST_CHANGE_EXEMPT` =
  §5a's five; `/auth/me` and `/auth/change-credentials` are in the second only,
  since both need to know who is asking and 401 when nobody is.
- **Migrations can carry a seed running in their transaction**, for rows no SQL
  text can express — so far one: the admin credential, whose salt must differ
  per install. Keyed by filename so a test directory cannot clash.
- **Session-id compare is constant-time; the index probe isn't** — an honest
  limit, not a fix. With a 256-bit id the residue is negligible; the rule stays
  so nobody swaps in a 6-digit code and keeps the `===`.
- **Traps already fallen into**, each now covered by a test: `Error` owns
  `cause` and `name` (hence `.failure`, `.migrationName`); `Algorithm.Argon2id`
  is an ambient `const enum` `verbatimModuleSyntax` will not inline (literal
  `2`, pinned on the `$argon2id$` prefix); `.catch(e => e as E)` widens the type
  *and* passes when the call resolves (use `test/rejection.ts`);
  `Date.parse('2025-02-30')` rolls over to 2 March; Fastify's ajv deletes
  undeclared fields by default. Vitest does not typecheck, so
  `npm run typecheck` is the only net for half of these.
- **zod at the edge, not Fastify's JSON Schema.** Money as a validated decimal
  *string* and a rate transformed to a 1e8 bigint are a refinement and a
  transform; neither survives translation to JSON Schema.
- **Money leaves as two strings**, `minor` and `amount`. `minor` is a bigint,
  and `Number()` would be a guess that goes wrong silently at scale. N1 covers
  the wire too.
- **Union types derive from a runtime array** — `DOCUMENT_TYPES`,
  `TRANSACTION_KINDS`, `FEE_TYPES` — so the API's idea of a kind cannot drift
  from the domain's.
- **Documents are served by a handler, never a static mount.** A mount on
  `data/files` publishes every file to anyone who can guess a hash, with no
  session check and nowhere to add one. `container.test.ts` fails if
  `@fastify/static` or `sendFile` appears anywhere.
- **The error map is keyed by `error.name`, not by constructor** — constructor
  identity breaks when two copies of core load, which has happened here. A test
  asserts it covers every `DomainError` core exports, so a new error cannot
  become a silent 500.
- **Constraint violations are translated in the adapter**, per §7's "unless the
  message needs to be friendlier". `document_links` has two FKs, so the adapter
  checks which side is missing before naming one.
- **One composition root.** The F12 CLI wired its own adapters until
  `container.test.ts` caught it; a second root is a second thing to keep in
  step.

## 14. Task protocol

At the end of every task:

1. Run the full test suite. Do not report done with a failing test.
2. Append anything durable to §13 — a decision, a gotcha, a corrected
   assumption.
3. Move anything resolved out of §11.
4. If the task changed the schema, update §6, §7, or §8 to match.
5. Keep this file under 400 lines. Condense old entries rather than
   letting it sprawl.