# CLAUDE.md — Payout Tracker

This file is the project's memory. Read it before doing anything. Update it at
the end of every task. If something here contradicts the code, the code is
wrong or this file is stale — say so, don't guess.

## 1. What this is

A single-user local application for tracking trading-firm payouts from gross
award to net rupees in the bank, with every supporting document attached and
every fee accounted for. It runs on one machine, bound to `127.0.0.1`, and the
user is the only user. A payout arrives as USD on a prop firm platform and
moves through a processor, crypto wallets and an exchange before landing as INR
in a bank. Each hop has its own fee, rate, reference and document. That lived in
a spreadsheet, where copy-paste silently destroyed four amounts and two fees.

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
| N4 | Every use case a unit test; every route an integration test; core journeys e2e |
| N5 | One command starts dev, one command builds, one command runs all tests |
| N6 | Data lives in `data/` — `app.db` plus `files/`. Backup = copy that folder |
| N7 | Binds `127.0.0.1` only. Sign-in gates every route except `/health` and auth |
| N9 | Passwords stored only as an argon2id hash; plaintext never touches disk, logs, or an error |
| N10 | The server refuses a non-loopback address while the default password is in place |
| N8 | UI components are independent and reusable — no feature imports another feature's components |

## 3. Use cases

Each maps to one class in `packages/core/src/usecases/`.

**UC1 — RecordPayout.** Company, date, gross, currency, charges, reference;
rejects gross <= 0 and an unknown company. **UC2 — RecordTransaction.** Rejects
a same-account move, a rate on a same-currency move, a parent from another
payout, and a currency the destination cannot hold. **UC3 — RecordSale.** The important one. A USDT amount and an INR rate -> gross
proceeds, the exchange's schedule applied for exchange fee and GST, a TDS
amount accepted from the statement, net INR out. Where 0.5% and 18% live. **UC4
— AttachDocument.** Hashes, stores, dedupes by hash, links; re-uploading links
the existing document instead of duplicating it. **UC5 — GetPayoutTrail.** The tree, with amounts, fees and documents at each
node. **UC6 — GetSettlement.** Gross proceeds, fees by type, net credited.
**UC7 — GetAccountBalances.** Per account per currency, derived never stored.
**UC8 — RunDataQualityChecks.** Flagged rows with reasons. **UC9 —
SearchDocuments.** FTS5 over filename and text. **UC10 —
GenerateFinancialYearReport.** A date range: credited / TDS / fees by company. **UC11 — SignIn.** Verifies the hash, opens a session, reports the must-change
flag. One generic error either way, and a hash comparison even for an unknown
username so timing reveals nothing; re-hashes a weaker credential *without*
clearing the flag. **UC12 — AuthenticateSession.** Session ID to user, or
reject; revoked wins over expired; extends past half-life. **UC13 —
ChangeCredentials.** Verifies the current password *first* (so it is not a free
"is that username taken?" oracle), applies the policy against the *new*
username, clears must-change only if the password actually changed, and revokes
every session but the caller's. **UC14 — SignOut.** Revokes server-side;
idempotent, and identical for a forged ID as a spent one. **Not numbered**,
because §3 assumed they existed: `RecordCompany`, `RecordAccount`,
`ListCompanies`, `ListAccounts`, `ListPayouts`, `ListTransactions`,
`GetDocument` and `ImportLegacyCsv`.

## 4. Domain glossary

Use these words in code. Do not invent synonyms.
- **Company** — a prop firm or payment processor. Has a contract document.
- **Account** — anywhere money sits: `prop_firm`, `processor`, `exchange`, `wallet`, `bank`.
- **Payout** — a single award from a company; the root of a transaction tree.
  A **transaction** is one movement between two accounts, with a `parent_id`.
- **Kind** — `payout_credit` | `withdrawal` | `transfer` | `sale` | `deposit`.
- **Sale** — the exchange → bank leg, the only one producing INR.
- **Gross proceeds** — `from_amount × rate`, before fees; **net credited** is that minus TDS, exchange fee and GST. **Dust** is the crypto residue a transfer leaves behind.
- **Must-change** — the flag on the admin row blocking every data route until the default password is replaced.
- **Session** — a server-side row keyed by a random 256-bit ID, behind a signed httpOnly cookie.

## 5. Architecture

```
packages/core/        ZERO dependencies. Never Fastify, SQLite or React.
  domain/ usecases/ ports/   Money and entities / one class per UC / interfaces

apps/api/             Fastify + better-sqlite3; serves the built UI too
  adapters/           implements core ports; the only place SQL lives
  routes/             thin — parse (zod), call one use case, serialize
  routes/web.ts       the one static mount, plus the SPA fallback
  auth/ db/           hashing, cookie, guards / pragmas, migrations, seeds
  container.ts        the only file importing both a use case and an adapter
  decorators.ts server.ts main.ts   instance types / plugin order and guards / migrate, check bind, listen

apps/web/             React 18 + Vite + MUI v6 + react-router v7
  shared/theme/       the ONE theme; only palette.ts may contain a hex
  shared/components/  reusable, zero feature knowledge; one per file
  shared/api/         the only place that talks to the server: TanStack Query
                      v5, the queryKeys factory, the 401 and 403 rules
  shared/layout/ feedback/   the rail and page frame / the toast
  features/           one folder each, no cross-imports
  routes.tsx          the UI composition root: the one file that may build
                      a screen out of several features

e2e/                  nine browser journeys, each against a world of its own
```

**The interface.** Ledger paper, not dashboard blue: ink `#1C1A17` on paper
`#FAF7F2`, plus three saturated colours, each a fact about money — `positive`
(arrived), `negative` (left), `flag` (§7's "suspicious, not impossible");
`muted` derives from ink. Colourless chrome is what lets colour *mean*
something, and colour never carries meaning alone. Plex Sans for the interface,
Plex Mono for every number, self-hosted; `numeric` carries `tabular-nums
lining-nums slashed-zero`. Light only — read beside statements.
**The dependency rule.** Dependencies point inward only; a runtime dependency
in `packages/core/package.json` means something leaked. **Ports earn their
existence**: an interface only where a fake is needed in tests or a second
implementation exists — a wrapper round one library with one caller is not.

## 5a. Authentication

Username and password, one account, no registration — for one person on one
machine. **Storage.** argon2id via `@node-rs/argon2` at its recommended parameters
(m=19456, t=2, p=1). Never SHA-anything, never a homemade salt. `password_hash`
holds the full encoded string, salt and parameters included, so raising the cost
later is a rehash-on-next-login. `003_auth.sql` is the authority on the tables.
The admin hash is computed at migration time by `db/seeds.ts`, never written
into the `.sql` — a literal hash there means one shared salt in every install,
in a file the checksum makes unchangeable. (It was `002` until
`002_reference_currencies.sql` existed: renumbering applied history is exactly
what the checksum guard prevents.)

A deliberate convenience with a deliberate cage: (1) every route except
`/health`, `/auth/login`, `/auth/me`, `/auth/logout` and
`/auth/change-credentials` returns 403 `password_change_required` while the
flag is set; (2) the server refuses to bind anywhere but `127.0.0.1` while it
is set, and says why; (3) the UI routes to the change screen with no way past —
no rail, no skip, no dismissible banner, and the copy says the password ships
with every copy and works on this machine only. The default is safe only
because of all three; remove one and the default must go too.
**Password policy.** 12 characters minimum; rejects the current password, the
username and a short embedded common list, every entry of which is itself 12+
characters. No composition rules — length beats punctuation. A pure function in
`core/domain/password-policy.ts` returning every violation, not the first, so
the browser runs the same one. **Rehash is not a change**, nor is a rename:
`must_change_password` clears only when a password is actually set.

**Failure handling.** One byte-identical message for every sign-in failure, and
an unknown username still runs a full argon2 verification so the timing matches.
5 attempts a minute on `/auth/login`; never log a password.
**Forgetting it.** No reset flow — nowhere to mail a link. Delete the row and
restart: migrations see an empty `users` table, re-seed the shipped credential
with its cage, and say so loudly. Sessions cascade, so no cookie outlives it.

**Session.** ID is 32 random bytes, base64url, compared timing-safely. Cookie:
`httpOnly`, `sameSite=lax`, `secure=false` (loopback has no TLS), `path=/`, 30
days, session ID only. `SESSION_SECRET` lives in gitignored `.env`, generated
on first run; losing it only signs everyone out.

## 6. Money

`INTEGER` in minor units; scale lives in the `currencies` table (INR 2, USD 2,
USDT 8). Rates are scaled by 1e8. Never `REAL`, never `number` arithmetic:
`Money` does it, and throws on a currency mismatch.
- `4599` INR = ₹45.99
- `75317770000` USDT = 753.1777 USDT
- `9766520000` rate = 97.6652

## 7. Invariants

By database constraints, not repeated in code unless the message needs to be
friendlier:
- `from_account_id <> to_account_id`
- `rate_applied IS NULL` when `from_currency = to_currency`
- dates match `YYYY-MM-DD`
- one fee per type per transaction
- a `document_links` row targets exactly one of company / payout / transaction
- amounts are positive

Enforced by views, not constraints — suspicious rather than impossible, since
enforcing "cross-currency implies a rate" would block entry before the rate is
known (`v_data_quality`):
- a cross-currency move with no recorded rate
- `to_amount` that doesn't reconcile with rate and fees
- a fee more than 2% off the declared schedule
- a leg sending more than its parent delivered — legitimate when earlier dust
  is still in the wallet

## 8. Fee rules

Declared in `fee_schedules`, not hardcoded:
| Account | Fee | Basis | Rate |
|---|---|---|---|
| CoinDCX | exchange_fee | to_amount | 0.50% |
| CoinDCX | gst | exchange_fee | 18% |
| Rise | network_fee | flat | ~$4.00 |

The Rise fee is flat: four withdrawals cost $16.31 where one would have cost
$4.03 (§11).

## 9. Known defects in the source CSV

The importer corrects these. Do not "fix" it to trust the sheet.
1. **`From` amount wrong on all four sale rows** — `45.957` copy-pasted. True
   values are `to_amount / rate`; Transaction0011 is 741.72, not 45.957.
2. **Exchange fee and GST swapped** between Transaction003 and Transaction0011:
   as written 8.39% and 0.03%; swapped, both 0.508%.
3. **`1.43908E+19`** — Excel destroyed a long reference by making it a float.
   Unrecoverable; all reference columns are `TEXT`.
4. **Duplicate `ToAmount` header** — the first occurrence is the from-side.
5. **`Transaction0010` sorts before `Transaction002`** as text. Internal keys
   are integers; the sheet ID is kept as `code`. Not to be confused with
   `Transaction0011`, the one row `v_data_quality` flags — see §7's dust.

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
  Transaction005 computes to 0.4866% and Transaction008 to 0.5308%; if it is
  order value, partial fills explain the spread and `fee_schedules.basis`
  becomes `from_amount`. Check one CoinDCX order.
- Warn before a withdrawal below a threshold, given the flat $4 fee? Open.
- Reached from outside this machine? If so, Tailscale in front rather than an
  exposed port, and revisit §5a: a single password over a LAN deserves a second
  factor, and `secure=false` must become `true` behind TLS.

## 12. Conventions
- TypeScript everywhere, `strict: true`. Vitest for unit and integration,
  Playwright for e2e in `e2e/`. Test file next to source: `money.test.ts`.
- No default exports except React components.
- Errors are typed classes in `core/domain/errors.ts`, never bare strings, and
  each message is written for the reader — the browser passes it through.
- SQL lives in adapters, never routes or use cases; statements prepared once.
- Commit message: `feat(core): ...`, `fix(api): ...`, `test(web): ...`.
- Copy: sentence case, active voice, the user's words — the button says "Record
  payout", the toast "Payout recorded", and an error says what happened and what
  to do, never "Something went wrong".

## 13. Decision log

Newest last. Never delete an entry — supersede it.
- **Money as scaled integers, scale per currency**: one fixed scale breaks INR
  or USDT, floats break both quietly. **Fees as rows, not columns**, each in
  its own currency. **Status and totals are derived**; a stored status drifts
  the first time a row is edited. **The browser formats money; the server owns
  the value.** `MoneyDisplay` takes integer minor units, so grouping and locale
  are presentation, and supersedes "render the server's `amount` string" — that
  kept the browser honest about *scale*, which a `scale` prop and a currency
  table now do. `Intl.NumberFormat#format` takes an exact decimal *string*, so
  `2^53 + 1` paise renders digit for digit; rupees group Indian-style. An unknown
  currency **throws**: guessing 2 for an 8-decimal token is a plausible balance.
- **`document_links` uses three nullable FKs with a CHECK summing to 1**, not
  polymorphic `entity_type`/`entity_id`, which discards referential integrity.
  **Addresses snapshot on the leg, normalized in `account_identifiers`.**
- ~~**Google sign-in with a one-subject allow-list.**~~ Superseded by
  **username and password, one account**: it needed a Cloud project, internet
  and a hostname-bound redirect. §5a is the bill.
- **Ships with `admin` / `admin` and a must-change flag**, defensible only
  because of §5a's three constraints. **Sessions are rows, not JWTs**: sign-out
  must actually revoke, which a token cannot without this table. **Auth lives
  in `apps/api/auth/`, not `core`**, which sees a `PasswordHasher` port.
  **Changing credentials revokes every other session**, rename included;
  **migrations carry seeds**.
- **Guards are global with an exemption list, never opt-in per route** — a
  forgotten route must fail closed. `PUBLIC_ROUTES` + `MUST_CHANGE_EXEMPT` =
  §5a's five; `/auth/me` and `/auth/change-credentials` are in the second only,
  since both must know who is asking. `RequireAuth`/`RequireSession` mirror
  them in the browser — for the right screen, not for safety.
- **Session-id compare is constant-time; the index probe isn't** — an honest
  limit; the rule stays so nobody swaps in a 6-digit code and keeps `===`.
- **Traps already fallen into**, each now covered by a test. `Error` owns `cause` and
  `name` (hence `.failure`, `.migrationName`). `Algorithm.Argon2id` is an ambient
  `const enum` `verbatimModuleSyntax` will not inline. `.catch(e => e as E)` widens
  the type *and* passes when the call resolves; after `.then` it swallows what the
  success path throws. `Date.parse('2025-02-30')` rolls to 2 March. Fastify's ajv
  deletes undeclared fields. `fetch('/api/x')` throws outside a browser. MUI
  peer-accepts React 19, so npm hoisted it while apps/web had 18; a root `overrides`
  pins one. `\b` through a non-raw string is a *backspace*; `no-control-regex` has
  caught that twice. Vitest does not typecheck; `npm run typecheck` is the only net.
  **Test timeouts move, the cost does not**: `unit` is 30s for argon2, `web` 15s
  because `userEvent` waits for React after every keystroke — both cross 5s only on a
  loaded machine, where a timeout reads like a hang. **happy-dom, not jsdom**: jsdom
  installs its own `AbortController` while the running `fetch` is undici's, which
  `instanceof`-checks Node's — two realms, one check, every request failing.
- **zod at the edge, not Fastify's JSON Schema**: money as a validated decimal
  *string* and a rate transformed to a 1e8 bigint are a refinement and a
  transform, neither survives JSON Schema. **Money leaves as two strings**, and
  N1 reaches the keyboard: `AmountField` filters keystrokes, not parses.
  **Unions derive from a runtime array**, so the API cannot drift.
- **The error map is keyed by `error.name`, not by constructor** — constructor
  identity breaks when two copies of core load. **Constraint violations are
  translated in the adapter**, per §7's "unless the message needs to be
  friendlier"; `document_links` has two FKs, so it checks which side first.
  **Documents are served by a handler, never a static mount**: a mount on
  `data/files` publishes every file to anyone who can guess a hash. **A 400
  carries `details.issues`**, so a form puts each message under its own field
  rather than leaving the reader to guess which of eight.
- **One composition root per process**: `container.ts` on the server (the F12
  CLI wired its own adapters until `container.test.ts` caught it) and
  `routes.tsx` in the browser — the payout screen wants parts from three
  features, and `payouts/` importing `transactions/` would leave neither
  readable alone. **The palette is a lint rule**: `design/no-raw-hex` fails the
  build for a hex anywhere under apps/web bar `shared/theme/palette.ts`. **N8
  is three more** — `no-feature-imports`, `no-fetch-in-shared` and
  `no-cross-feature-imports`, the last resolving paths rather than globbing.
- **`sortBy` is separate from `cell` in `DataTable`**, so a money column sorts
  on its integer — as text, `9.00` sorts after `84,642.93`. Absent values pin
  to the bottom in *both* directions: the nullish check sits outside the
  direction multiplier. **`TreeView` splits each row** into an indented label
  and an un-indented aside; nesting would turn §10's trail into a staircase.
- **Cache keys come from `queryKeys`, never inline.** Typed at two call sites they
  become two caches holding one fact: a mutation invalidates one spelling, the screen
  reads the other, the number is stale. The hierarchy makes precise invalidation
  expressible — a leg invalidates that payout's trail and settlement, the balances and
  the checks, and a test asserts every other payout stays untouched. **A 401 is
  handled in the query and mutation caches, never at a call site.** It clears
  everything — a signed-out session must not leave balances in memory — and seeds
  `auth.me` null. Three exemptions, each a 401 that is an answer rather than an
  expiry: `/auth/me`, `/auth/login` and `/auth/change-credentials` — clearing the
  cache on a wrong password destroys the mutation holding the error, so the reader
  sees *nothing*. They carry a `mutationKey` so the handler can tell. **Signed-in
  state is that one `useQuery`** — a second `user` in React state disagrees the moment
  a session is revoked elsewhere. **F15's 403 routes by writing the auth cache, not by
  calling `navigate`.** It sets `mustChangePassword` on `auth.me` and `RequireAuth`
  reads that, so a stale tab cannot sit on a data screen — and the screen it lands on
  has no rail, no skip and no dismissal (§5a).
- **There is no "mark settled" endpoint**, and should not be: status is derived.
  Settling *is* recording the sale that reaches a bank — `useSettlePayout` does
  that, flipping the cached status optimistically, figures left to the server.
- **Web fixtures come from the API's own test server**, never invented — §10's
  thirteen-leg tree as the routes serialise it, in `reference-payout.ts`.
- **`/api/accounts` and `/api/accounts/balances` answer two questions.** A
  balance is derived from movements (UC7), so an account recorded a minute ago
  is absent — right for a balance sheet, useless for a form asking where money
  went; before `RecordAccount`, accounts arrived only with the legacy import, so
  a fresh database had nowhere to move money between. An allow-list is a **set**:
  `RecordAccount` sorts it, SQLite reads it back ordered and a fake does not.
- **One process in production, two in development.** `npm start` serves the
  built bundle from the API, so the browser sees one origin and §5a's
  `sameSite=lax` cookie needs no proxy pretending otherwise; `npm run dev`
  keeps Vite for hot reload. **The SPA fallback never answers for `/api`,
  `/auth` or `/health`**: JSON asked for and a 200 of HTML returned is a typo
  reported three layers away. The guards recognise the interface by the routes
  the plugin registered, not a guessed pattern, so a later root-level route
  stays guarded. **One e2e world per journey** — temp database, legacy import,
  `start()` on a port the OS picks — or the suite turns order-dependent. The first
  test that ever *clicked* anything found two bugs every DOM assertion had passed:
  a 27px rail (an `sx` width is pixels, not spacing units), and the cage
  redirecting away from the very change it was guarding.
- **`npm run backup` uses SQLite's backup API, never a file copy.** In WAL mode
  the newest pages are in `app.db-wal`: `cp` gives three snapshots of three
  instants, and with nothing checkpointed the copy has no schema at all — a test
  shows exactly that. Attached files are copied: each is written once, never edited.
- **The bundle's size warning is raised, not obeyed**: 500kB is advice about
  download cost to somebody who might leave; this is read off local disk by
  somebody who already opened it, and splitting it would make §11 worse.
- **`npm run dev` watches with `node --watch`, not `tsx watch`.** Under
  concurrently's prefixed output the supervisor's child never ran the module —
  no error, no listen — so Vite's proxy answered ECONNREFUSED and the bug read
  as the app's. `--raw` cures it too, at the cost of the prefixes.
- **A missing choice is added from inside the dropdown** (`SelectWithCreate`),
  because needing one happens mid-form. Its item carries a sentinel never passed
  to `onChange`, so cancelling leaves the field as found; the dialog renders
  **outside** the form, since a portal is elsewhere in the DOM but not in the
  React tree and its submit ran the payout's `onSubmit` too. Select only once the
  invalidation resolves, or MUI draws an unmatched value as an empty box; assert
  with `find` — a closing modal still holds `aria-hidden` over what is behind it.
## 14. Task protocol

At the end of every task:
1. Run the full test suite. Do not report done with a failing test.
2. Append anything durable to §13 — a decision, a gotcha, a corrected
   assumption. Move anything resolved out of §11.
3. If the task changed the schema, update §6, §7 or §8 to match.
4. Keep this file under 400 lines. Condense old entries, never delete them.