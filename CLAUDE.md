# CLAUDE.md — Payout Tracker

This file is the project's memory. Read it before doing anything. Update it at the end
of every task. If something here contradicts the code, the code is wrong or this file is
stale — say so, don't guess.

## 1. What this is

A local application tracking trading-firm payouts from gross award to net rupees in the
bank, every document attached and every fee accounted for. One machine, `127.0.0.1`, one
user signing in, several traders it keeps payouts for (F24). A payout arrives as USD on a
prop firm platform and moves through a processor, crypto wallets and an exchange before
landing as INR in a bank, each hop with its own fee, rate, reference and document. That
lived in a spreadsheet, where copy-paste destroyed four amounts and two fees.

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
| F18 | Delete a payout, taking its transactions, their fees and its document links |
| F19 | Edit an account; delete one, refused while any transaction still uses it |
| F20 | Delete a transaction, taking the legs below it and their fees |
| F21 | Edit a transaction: the row itself, never its kind, parent, payout or fees |
| F22 | Delete a document: the file, its row, and every attachment to it |
| F23 | Attach a document to a payout or a leg, one already on file included; remove one |
| F24 | Several traders in one ledger: add one, switch, and scope every payout-derived screen to a trader and a period: a first and last month, so a tax year is expressible |

### Non-functional
| # | Requirement |
|---|---|
| N1 | Money is **never** a float. Integers in minor units, scale per currency |
| N2 | Every list view responds in under 100ms on a few thousand rows |
| N3 | Domain layer has zero runtime dependencies |
| N4 | Every use case a unit test; every route an integration test; core journeys e2e |
| N5 | One command starts dev, one command builds, one command runs all tests |
| N6 | Data lives in `data/` — `app.db` plus `files/`. Backup = copy that folder |
| N7 | Binds `127.0.0.1` only. Sign-in gates every route except `/health` and auth |
| N9 | Passwords stored only as an argon2id hash; plaintext never touches disk, logs, or an error |
| N10 | The server refuses a non-loopback address while the default password is in place |
| N8 | UI components are independent and reusable — no feature imports another feature's components |

## 3. Use cases

Each maps to one class in `packages/core/src/usecases/`.

**UC1 — RecordPayout.** Trader, company, date, gross, currency, charges, reference;
rejects gross <= 0, an unknown company, an unknown trader. **UC2 — RecordTransaction.**
Rejects a same-account move, a rate on a same-currency move, a parent from another
payout, a currency the destination cannot hold. **UC3 — RecordSale.** The important one:
a USDT amount and an INR rate -> gross proceeds, §8's schedule for exchange fee and GST,
TDS from the statement, net INR out. **UC4 — AttachDocument.** Hashes, stores, dedupes,
links: re-uploading links the existing document rather than duplicating it. **UC5 —
GetPayoutTrail.** The tree, with amounts, fees and documents at each node. **UC6 —
GetSettlement.** Gross proceeds, fees by type, net credited. **UC7 —
GetAccountBalances.** Per account per currency, derived never stored. **UC8 —
RunDataQualityChecks.** §7's flagged rows, with reasons. **UC9 — SearchDocuments.** FTS5
over filename and text. **UC10 — GenerateFinancialYearReport.** A date range: credited /
TDS / fees by company. **UC11–UC14 — SignIn, AuthenticateSession, ChangeCredentials,
SignOut**, spelled out in §5a: one message either way and a weaker credential re-hashed
*without* clearing the flag; revoked beating expired, a session extending past
half-life; the current password checked *first*, so it is no "is that username taken?"
oracle, the policy run against the *new* username, must-change cleared only on a new
password, every other session revoked; a sign-out that revokes server-side, idempotent,
identical for a forged ID as a spent one. **UC15–UC18 — DeletePayout, DeleteTransaction,
EditTransaction, DeleteDocument** (F18, F20–F22) and **UC19–UC21 — LinkDocument,
DetachDocument, ListDocumentsFor** (F23): each counts first, then does one atomic thing;
§13's "what deletes, and what refuses" is the reasoning. **UC22, UC23 — RecordTrader,
ListTraders.** F24: a person payouts belong to, with no credential of any kind. **UC24 —
the scope** (`payout-scope.ts`): trader and range, both optional, honoured *identically*
by UC7, UC8, UC10 and `ListPayouts`. **Not numbered**, because §3 assumed they existed:
`RecordCompany`, `RecordAccount`, `EditAccount`, `DeleteAccount`, `ListCompanies`,
`ListAccounts`, `ListPayouts`, `ListTransactions`, `GetDocument`, `ImportLegacyCsv`.

## 4. Domain glossary

Use these words in code. Do not invent synonyms.
- **Company** — a prop firm or payment processor. Has a contract document.
- **Account** — anywhere money sits: `prop_firm`, `processor`, `exchange`, `wallet`, `bank`.
- **Trader** — a person payouts belong to. Never a **user**: §5a's one account signs
  in, a trader never does.
- **Payout** — a single award from a company; the root of a transaction tree.
  A **transaction** is one movement between two accounts, with a `parent_id`.
- **Kind** — `payout_credit` | `withdrawal` | `transfer` | `sale` | `deposit`.
- **Sale** — the exchange → bank leg, the only one producing INR.
- **Gross proceeds** — `from_amount × rate`, before fees; **net credited** is that minus TDS, exchange fee and GST. **Dust** is the crypto residue a transfer leaves behind.
- **Must-change**, **Session** — the flag on the admin row blocking every data route, and the server-side row keyed by a random 256-bit ID behind the signed httpOnly cookie; §5a has both.

## 5. Architecture

```
packages/core/        ZERO dependencies. Never Fastify, SQLite or React.
  domain/ usecases/ ports/   Money and entities / one class per UC / interfaces
apps/api/             Fastify + better-sqlite3; serves the built UI too
  adapters/ routes/   implements core ports, the only SQL / thin: parse (zod), one use case, serialize
  routes/web.ts       the one static mount, plus the SPA fallback
  auth/ db/           hashing, cookie, guards / pragmas, migrations, seeds
  container.ts        the only file importing both a use case and an adapter
  decorators.ts server.ts main.ts   instance types / plugin order and guards / migrate, check bind, listen

apps/web/             React 18 + Vite + MUI v6 + react-router v7
  shared/theme/ components/   the ONE theme, only palette.ts holding a hex / reusable, zero feature knowledge, one per file
  shared/api/         the only place that talks to the server: TanStack Query v5, the queryKeys factory, the scope, the 401 and 403 rules
  shared/layout/ feedback/   the rail and page frame / the toast
  features/ routes.tsx   one folder each, no cross-imports / the UI composition root, the one file that may build a screen out of several

e2e/                  ten spec files, 25 journeys, each against a world of its own
```

**The interface.** Ledger paper, not dashboard blue: ink `#1C1A17` on paper `#FAF7F2`,
plus three saturated colours, each a fact about money — `positive` (arrived), `negative`
(left), `flag` (§7's "suspicious, not impossible"); `muted` derives from ink. Colourless
chrome lets colour *mean* something, and colour never carries meaning alone. Plex Sans
for the interface, Plex Mono for every number, self-hosted; `numeric` carries
`tabular-nums lining-nums slashed-zero`. Light only, to read beside statements. **The
dependency rule** (N3): a runtime dependency in `packages/core/package.json` means
something leaked. **Ports earn their existence**: an interface only where a fake is
needed or a second implementation exists, never a wrapper round one library.

## 5a. Authentication

Username and password, one account, no registration — for one person on one machine.
**Storage.** argon2id via `@node-rs/argon2` at its recommended parameters (m=19456, t=2,
p=1). Never SHA-anything, never a homemade salt. `password_hash` holds the full encoded
string, salt and parameters included, so raising the cost later is a rehash on next
login. `003_auth.sql` is the authority on the tables. The admin hash is computed at
migration time by `db/seeds.ts`, never written into the `.sql` — a literal hash there
means one shared salt in every install, in a file the checksum makes unchangeable (which
is also what stops applied history being renumbered).

A deliberate convenience with a deliberate cage: (1) every route except `/health`,
`/auth/login`, `/auth/me`, `/auth/logout` and `/auth/change-credentials` returns 403
`password_change_required` while the flag is set; (2) the server refuses to bind
anywhere but `127.0.0.1` while it is set, and says why; (3) the UI routes to the change
screen with no way past — no rail, no skip, no dismissible banner, the copy saying the
password ships with every copy and works here only. The default is safe only because of
all three; remove one and it must go too. **Password policy.** 12 characters minimum;
rejects the current password, the username and a short embedded common list, itself all
12+ characters. No composition rules — length beats punctuation. A pure function in
`core/domain/password-policy.ts` returns every violation, not the first, so the browser
runs the same one. **Rehash is not a change**, nor is a rename: `must_change_password`
clears only when a password is set.

**Failure handling.** One byte-identical message for every sign-in failure, and an
unknown username still runs a full argon2 verification so the timing matches. 5 attempts
a minute on `/auth/login`; never log a password. **Forgetting it.** No reset flow —
nowhere to mail a link. Delete the row and restart: migrations see an empty `users`
table, re-seed the shipped credential with its cage, and say so loudly. Sessions
cascade.

**Session.** ID is 32 random bytes, base64url, compared timing-safely. Cookie:
`httpOnly`, `sameSite=lax`, `secure=false` (loopback has no TLS), `path=/`, 30 days,
session ID only. `SESSION_SECRET` lives in gitignored `.env`, made on first run; losing
it only signs everyone out.

## 6. Money

`INTEGER` in minor units; scale lives in the `currencies` table (INR 2, USD 2, USDT 8)
and rates are scaled by 1e8. Never `REAL`, never `number` arithmetic: `Money` does it,
and throws on a currency mismatch.
- `4599` INR = ₹45.99 · `75317770000` USDT = 753.1777 USDT · `9766520000` rate = 97.6652

## 7. Invariants

By database constraints, not repeated in code unless the message needs to be friendlier:
- `from_account_id <> to_account_id`
- `rate_applied IS NULL` when `from_currency = to_currency`
- dates match `YYYY-MM-DD`
- one fee per type per transaction
- a `document_links` row targets exactly one of company / payout / transaction
- amounts are positive
- every payout has a trader (`trader_id` NOT NULL, ON DELETE RESTRICT: a person with
  payouts cannot be deleted out from under them)

Enforced by views, not constraints — suspicious rather than impossible, since enforcing
"cross-currency implies a rate" would block entry before the rate is known
(`v_data_quality`):
- a cross-currency move with no recorded rate
- `to_amount` that doesn't reconcile with rate and fees
- a fee more than 2% off the declared schedule
- a leg sending more than its parent delivered — legitimate when earlier dust is still
  in the wallet

## 8. Fee rules

Declared in `fee_schedules`, not hardcoded:
| Account | Fee | Basis | Rate |
|---|---|---|---|
| CoinDCX | exchange_fee | to_amount | 0.50% |
| CoinDCX | gst | exchange_fee | 18% |
| Rise | network_fee | flat | ~$4.00 |

The Rise fee is flat: four withdrawals cost $16.31 where one would have cost $4.03
(§11).

## 9. Known defects in the source CSV

The importer corrects these. Do not "fix" it to trust the sheet.
1. **`From` amount wrong on all four sale rows** — `45.957` copy-pasted; true values are
  `to_amount / rate`, Transaction0011 being 741.72.
2. **Exchange fee and GST swapped** between Transaction003 and Transaction0011: as
  written 8.39% and 0.03%; swapped, both 0.508%.
3. **`1.43908E+19`** — Excel destroyed a long reference by making it a float.
  Unrecoverable; all reference columns are `TEXT`.
4. **Duplicate `ToAmount` header** — the first occurrence is the from-side.
5. **`Transaction0010` sorts before `Transaction002`** as text: internal keys are
  integers, the sheet ID kept as `code`. Not `Transaction0011`, the row §7's dust flags.

## 10. Verified reference figures

```
From TradeifyPayout001. Any refactor must still produce these.
payout gross    $1,008.01     gross proceeds  ₹86,027.56
total fees      ₹ 1,384.63    net credited    ₹84,642.93
TDS ₹868.88  exchange_fee ₹437.09  GST ₹78.66  network_fee $16.31  charge $100.79
balances:  Bank ₹84,642.93   CoinDCX 14.0908 USDT   TrustWallet 1.3323 USDT
```

## 11. Open questions

- Does CoinDCX charge 0.5% on **order value** or **net proceeds**? On proceeds
  Transaction005 computes to 0.4866% and Transaction008 to 0.5308%; on order value,
  partial fills explain it and `fee_schedules.basis` becomes `from_amount`. Check one.
- Warn before a withdrawal below a threshold, given the flat $4 fee? Open.
- Reached from outside this machine? Then Tailscale in front rather than an exposed port,
  and revisit §5a: one password over a LAN deserves a second factor, and `secure=false`
  must become `true` behind TLS.

## 12. Conventions
- TypeScript everywhere, `strict: true`. Vitest for unit and integration, Playwright in
  `e2e/`; test file next to source, `money.test.ts`.
- No default exports except React components. Errors are typed classes in
  `core/domain/errors.ts`, never bare strings, each written for the reader — the browser
  passes it through. SQL lives in adapters, never routes or use cases, prepared once.
- Commit message: `feat(core): ...`, `fix(api): ...`, `test(web): ...`.
- Copy: sentence case, active voice, the user's words — the button says "Record payout"
  and the toast "Payout recorded"; an error says what happened and what to do, never
  "Something went wrong".

## 13. Decision log

Newest last. Never delete an entry — supersede it.
- **Money as scaled integers, scale per currency**: one fixed scale breaks INR or USDT,
  floats break both quietly. **Fees are rows, not columns**, each in its own currency.
  **Status and totals are derived**; a stored status drifts on the first edit. **The
  browser formats money; the server owns the value**: `MoneyDisplay` takes integer minor
  units (superseding "render the server's `amount` string"), kept honest by a `scale`
  prop and the currency table. `Intl.NumberFormat` takes an exact decimal *string*:
  `2^53 + 1` paise renders digit for digit, rupees group Indian-style, an unknown
  currency **throws**. **`document_links` uses three nullable FKs with a CHECK summing
  to 1**, not polymorphic `entity_type`/`entity_id`, which discards referential
  integrity. **Addresses snapshot on the leg, normalized in `account_identifiers`.**
- ~~**Google sign-in with a one-subject allow-list.**~~ Superseded by **username and
  password, one account**: it needed a Cloud project, internet and a hostname-bound
  redirect. §5a is the bill. **Auth, in one place.** **Sessions are rows, not JWTs**:
  sign-out must actually revoke, which a token cannot without this table. **Auth lives
  in `apps/api/auth/`, not `core`**, which sees a `PasswordHasher` port. **Migrations
  carry seeds**; §5a's three constraints make `admin` defensible. **Guards are global
  with an exemption list, never opt-in**, so a forgotten route fails closed:
  `PUBLIC_ROUTES` + `MUST_CHANGE_EXEMPT` = §5a's five, the last two in the second only
  since both must know who is asking; `RequireAuth`/`RequireSession` mirror them in the
  browser, for the right screen not safety. **Session-id compare is constant-time; the
  index probe isn't** — kept honest so nobody swaps in a 6-digit code and keeps `===`.
- **Traps**, each covered by a test. `Error` owns `cause` and `name` (`.failure`,
  `.migrationName`). `Algorithm.Argon2id` is an ambient `const enum`
  `verbatimModuleSyntax` will not inline. `.catch(e => e as E)` widens the type *and*
  passes when the call resolves, and after `.then` swallows what the success path
  throws. `Date.parse('2025-02-30')` rolls to 2 March. Fastify's ajv deletes undeclared
  fields. `fetch('/api/x')` throws outside a browser. An `sx` width is pixels, not
  spacing. MUI peer-accepts React 19, so npm hoisted it beside apps/web's 18 until a
  root `overrides` pinned one. `\b` through a non-raw string is a *backspace*
  (`no-control-regex` caught it twice). Vitest does not typecheck; `npm run typecheck`
  is the only net. **Test timeouts move, the cost does not** (`vitest.config.ts` says
  why). **happy-dom, not jsdom**: jsdom installs its own `AbortController` while `fetch`
  is undici's, `instanceof`-checking Node's — two realms, one check, every request
  failing. **zod at the edge, not Fastify's JSON Schema**: money as a validated decimal
  *string* and a rate transformed to a 1e8 bigint are a refinement and a transform,
  which JSON Schema has neither of. **Money leaves as two strings**, and N1 reaches the
  keyboard: `AmountField` filters keystrokes. **Unions derive from a runtime array**, so
  the API cannot drift; `from`/`to` are one field in two halves, refused apart. **The
  error map is keyed by `error.name`**, since a constructor breaks when two copies of
  core load. **Constraint violations are translated in the adapter** (§7's "friendlier
  message"): `document_links` has two FKs, so it checks which side. **Documents are
  served by a handler, never a static mount**, which would publish every file to anyone
  guessing a hash. **A 400 carries `details.issues`**: each message under its own field.
- **One composition root per process**: `container.ts` on the server (the F12 CLI wired
  its own adapters until `container.test.ts` caught it) and `routes.tsx` in the browser,
  where the payout screen wants parts from four features and `payouts/` importing
  `transactions/` would leave neither readable — hence the shell's `toolbar` slot for
  the bar. **The palette is a lint rule**: `no-raw-hex` fails the build for a hex under
  apps/web bar `shared/theme/palette.ts`. **N8 is three more**: `no-feature-imports`,
  `no-fetch-in-shared` (hence `ScopeProvider` beside `AuthProvider` in `shared/api/`)
  and `no-cross-feature-imports`, path-resolving. **`sortBy` is separate from `cell` in
  `DataTable`**, so a money column sorts on its int (as text, `9.00` sorts after
  `84,642.93`), absent values pinning to the bottom in *both* directions. **`TreeView`
  splits each row** into an indented label and an un-indented aside, or nesting turns
  §10's trail into a staircase. **Cache keys come from `queryKeys`, never inline**: two
  call sites spell one key two ways, and the screen reads the one no mutation
  invalidated. The hierarchy makes invalidation precise — a leg reaches that payout's
  trail, settlement, balances and checks — with a test on what stays put. **A 401 is
  handled in the caches, never at a call site**: it clears everything (a signed-out
  session must not leave balances in memory), seeds `auth.me` null, bar `/auth/me`,
  `/auth/login` and `/auth/change-credentials` — answers rather than expiries, told
  apart by a `mutationKey`: clearing on a wrong password destroys the mutation holding
  the error. **Signed-in state is that one `useQuery`**: a second `user` in React state
  disagrees the moment a session is revoked. **F15's 403 routes by writing the auth
  cache, not `navigate`** — `RequireAuth` reads `mustChangePassword` off `auth.me`, so
  no stale tab sits on a data screen. **No "mark settled" endpoint**: settling *is* the
  sale that reaches a bank (`useSettlePayout`), figures left to the server.
- **`/api/accounts` and `/api/accounts/balances` answer two questions**: a balance is
  derived from movements (UC7), so an account recorded a minute ago is absent — right
  for a balance sheet, useless for a form asking where money went. An allow-list is a
  **set**, sorted: SQLite reads it back ordered, a fake does not. **One process in
  production, two in development.** `npm start` serves the built bundle from the API, so
  the browser sees one origin and §5a's `sameSite=lax` cookie needs no proxy pretending
  otherwise; `npm run dev` keeps Vite for reload. **The SPA fallback never answers for
  `/api`, `/auth` or `/health`**: JSON asked for and HTML returned is a typo reported
  three layers away. The guards know the interface by the registered routes, never a
  guessed pattern. **Web fixtures come from the API's own test server** — §10's tree as
  the routes serialise it (`reference-payout.ts`); an MSW handler *filters* where the
  server does, or a hook that never sent the scope would pass. **One e2e world per
  journey** (temp database, legacy import, an OS-picked port), or the suite turns
  order-dependent — and the first test that *clicked* found two bugs every DOM assertion
  had passed. **`npm run backup` uses SQLite's backup API, never a file copy**: in WAL
  mode the newest pages are in `app.db-wal`, so `cp` gives three snapshots of three
  instants and, unless something checkpointed, no schema at all (a test shows it). Files
  are copied. **The bundle's size warning is raised, not obeyed**: 500kB is download
  advice, this is local disk, and splitting would worsen §11. **`npm run dev` watches
  with `node --watch`, not `tsx watch`**: under concurrently's prefixed output the
  supervisor's child never ran the module — no error, no listen — so Vite's proxy
  answered ECONNREFUSED and the bug read as the app's (`--raw` cures it, losing the
  prefixes).
- **A missing choice is added from inside the dropdown** (`SelectWithCreate`), its
  create item an action, not a value. Its dialog renders **outside** the form: a portal
  is elsewhere in the DOM but not in the React tree, and its submit ran the payout's
  `onSubmit`. Select only once the invalidation resolves or MUI draws an empty box;
  assert with `find`, a closing modal still holding `aria-hidden` and a list that
  reloaded having replaced the element a test was holding. An empty select *value* reads
  as "nothing chosen", so each "All" entry carries a word. **What deletes, and what
  refuses.** A **payout** deletes for real (F18), not into a "cancelled" status — the
  fourth state §13 refused: legs, fees and links go, **documents stay** (F6), one
  transaction, the tree peeled **leaf-first** since `parent_id` is RESTRICT, checked per
  row: a cascade fails below depth one, and a test asserts it. An **account** is a party
  to events, not an event: deleting one with any leg is a 409 **counting** them, only
  its configuration cascades, and an edit is a **replacement** (F19), an empty
  allow-list meaning "holds anything". A **leg** takes the legs below it (F20), a child
  being money that arrived from it. **Editing a leg** (F21) replaces the row and nothing
  around it — not the kind (§8's fee engine), not the parent, not the **fees**: TDS came
  off a statement, so §7 reports a mismatch rather than arithmetic overwriting evidence.
  **Removing a document is not deleting it** (F23): breaking a relationship leaves the
  file to be attached again. A **document** is a thing (F6): deleting one takes every
  attachment, file *after* row — a row without bytes answers 422, bytes without a row
  are litter. The payout delete alone **removes** cache entries rather than invalidating
  them — a deleted trail 404s.
- **AGPL-3.0-only**, verbatim in `LICENSE`, `license` in all four manifests, no per-file
  headers. Its §13 is the point — a copy reached over a network owes its users the
  source — so §11's "reached from outside?" is a licence question too. **A trader is not
  a user** (F24): §5a's account is who is *using* this, a trader is who the money
  belongs to — no password, no `users` row, and a name added from a dropdown is never a
  way to sign in (a test checks the dialog for a password field). **Whose money and when
  are one selection**, `PayoutScope`, honoured identically by the list, the balances,
  the checks and the report; half-honouring it is how one screen disagrees with the one
  beside it. The hooks fold it in, never a call site, so no screen can forget; in the
  key it sits *after* the caller's own filter, leaving `balances.all()` matching every
  scoped spelling. The report keeps its own range, the bar not re-cutting a year
  somebody asked for. **A period is two months, not a year**: a tax year starts in
  April, so April 2024 to March 2025 must be sayable, the year list reaches back a year
  further than the data, and clearing either end clears both. **In UTC**: local, `new
  Date(2025, 2, 31)` reaches the server as the 30th. `004_traders.sql` adds `trader_id`
  by **rebuilding the table**: with foreign keys on, `ALTER TABLE ADD COLUMN ... NOT
  NULL REFERENCES` is impossible, so it is SQLite's 12-step dance under
  `defer_foreign_keys` and `legacy_alter_table`, §10's figures and the views proven
  after.

## 14. Task protocol

At the end of every task:
1. Run the full test suite. Do not report done with a failing test.
2. Append anything durable to §13 — a decision, a gotcha, a corrected assumption; move
  anything resolved out of §11.
3. If the task changed the schema, update §6, §7 or §8 to match.
4. Keep this file under 400 lines. Condense old entries, never delete them.
