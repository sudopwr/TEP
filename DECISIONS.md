# DECISIONS.md — Payout Tracker

Every decision this project has made and the reason it made it. Split out of
CLAUDE.md §13 when the two together outgrew that file's 400-line cap; nothing was
dropped in the move. Read it before changing anything it covers, and append here
rather than there.

Newest last. Never delete an entry — supersede it.
- **Money as scaled integers, scale per currency**: one fixed scale breaks INR or USDT,
  floats break both. **Fees are rows, not columns**, each in its own currency. **Status
  and totals are derived**; a stored status drifts on the first edit. **The browser
  formats money; the server owns the value**: `MoneyDisplay` takes integer minor units
  (superseding "render the server's `amount` string"), kept honest by a `scale` prop and
  the currency table. `Intl.NumberFormat` takes an exact decimal *string*: `2^53 + 1`
  paise renders digit for digit, rupees group Indian-style, unknown currencies
  **throw**. **`document_links` uses three nullable FKs with a CHECK summing to 1**, not
  polymorphic `entity_type`/`entity_id`, which drops referential integrity. **Addresses
  snapshot on the leg, normalized in `account_identifiers`.**
- ~~**Google sign-in with a one-subject allow-list.**~~ Superseded by **username and
  password, one account**: it needed a Cloud project, internet and a hostname-bound
  redirect; §5a is the bill. **Auth, in one place.** **Sessions are rows, not JWTs**:
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
  passes when the call resolves; after `.then` it swallows what the success path throws.
  `Date.parse('2025-02-30')` rolls to 2 March. Fastify's ajv deletes undeclared fields.
  `fetch('/api/x')` throws outside a browser. An `sx` width is pixels, not spacing. MUI
  peer-accepts React 19, so npm hoisted it beside apps/web's 18 until a root `overrides`
  pinned it. `\b` through a non-raw string is a *backspace* (`no-control-regex` caught
  it twice). Vitest does not typecheck; `npm run typecheck` is the only net. **Test
  timeouts move, the cost does not** (`vitest.config.ts` says why beside each).
  **happy-dom, not jsdom**: jsdom installs its own `AbortController` while `fetch` is
  undici's, `instanceof`-checking Node's — two realms, one check, everything failing.
  **zod at the edge, not Fastify's JSON Schema**: money as a validated decimal *string*
  and a rate transformed to a 1e8 bigint are a refinement and a transform, neither of
  which JSON Schema has. **Money leaves as two strings**, and N1 reaches the keyboard:
  `AmountField` filters keystrokes. **Unions derive from a runtime array**, so the API
  cannot drift; `from`/`to` are one field in two halves, refused apart. **The error map
  is keyed by `error.name`**: a constructor breaks when two copies of core load.
  **Constraint violations are translated in the adapter** (§7's "friendlier message"):
  `document_links` has two FKs, so it checks which. **Documents are served by a handler,
  never a static mount**, which would publish every file to anyone guessing a hash. **A
  400 carries `details.issues`**: each message under its own field.
- **One composition root per process**: `container.ts` on the server (the F12 CLI wired
  its own adapters until `container.test.ts` caught it) and `routes.tsx` in the browser,
  where the payout screen wants four features' parts and `payouts/` importing
  `transactions/` would leave neither readable — hence the shell's `toolbar` slot for
  the bar. **The palette is a lint rule**: `no-raw-hex` fails the build for a hex under
  apps/web bar `shared/theme/palette.ts`. **N8 is three more**: `no-feature-imports`,
  `no-fetch-in-shared` (hence `ScopeProvider` beside `AuthProvider` in `shared/api/`)
  and `no-cross-feature-imports`, which resolves paths. **`sortBy` is separate from
  `cell` in `DataTable`**, so a money column sorts on its int (as text, `9.00` sorts
  after `84,642.93`), absent values pinning to the bottom either way. **`TreeView`
  splits each row** into an indented label and an un-indented aside, or nesting turns
  §10's trail into a staircase. **Cache keys come from `queryKeys`, never inline**: two
  call sites spell one key two ways, and the screen reads the one no mutation
  invalidated. The hierarchy makes invalidation precise — a leg reaches that payout's
  trail, settlement, balances and checks — with a test on what stays. **A 401 is handled
  in the caches, never at a call site**: it clears everything (a signed-out session must
  not leave balances in memory), seeds `auth.me` null, bar `/auth/me`, `/auth/login` and
  `/auth/change-credentials` — answers rather than expiries, told apart by a
  `mutationKey`: clearing on a wrong password destroys the mutation holding the error.
  **Signed-in state is that one `useQuery`**: a second `user` in state disagrees the
  moment a session is revoked. **F15's 403 routes by writing the auth cache, not
  `navigate`** — `RequireAuth` reads `mustChangePassword` off `auth.me`, so no stale tab
  sits on a data screen. **No "mark settled" endpoint**: settling *is* the sale reaching
  a bank (`useSettlePayout`), figures left to the server. **`/api/accounts` and
  `/api/accounts/balances` answer two questions**: a balance is derived from movements
  (UC7), so an account recorded a minute ago is absent — right for a balance sheet,
  useless for a form asking where money went. An allow-list is a **set**, sorted: SQLite
  reads it back ordered, a fake does not. **One process in production, two in
  development.** `npm start` serves the built bundle from the API, so the browser sees
  one origin and §5a's `sameSite=lax` cookie needs no proxy pretending otherwise; `npm
  run dev` keeps Vite. **The SPA fallback never answers for `/api`, `/auth` or
  `/health`**: JSON asked for and HTML returned is a typo reported three layers away.
  The guards know the interface by the registered routes, never a guessed pattern. **Web
  fixtures come from the API's own test server** — §10's tree as the routes serialise it
  (`reference-payout.ts`); an MSW handler *filters* where the server does, or a hook
  that never sent the scope passes. **One e2e world per journey** (temp database, legacy
  import, an OS-picked port), or the suite turns order-dependent — and the first test
  that *clicked* found two bugs every DOM assertion passed. **`npm run backup` uses
  SQLite's backup API, never a file copy**: in WAL mode the newest pages are in
  `app.db-wal`, so `cp` gives three snapshots of three instants and, unless something
  checkpointed, no schema at all (a test shows it). Files are copied. **The bundle's
  size warning is raised, not obeyed**: 500kB is download advice, this is local disk,
  and splitting would worsen §11. **`npm run dev` watches with `node --watch`, not `tsx
  watch`**: under concurrently's prefixed output the supervisor's child never ran the
  module — no error, no listen — so Vite's proxy answered ECONNREFUSED and the bug read
  as the app's (`--raw` cures it, losing prefixes).
- **A missing choice is added from inside the dropdown** (`SelectWithCreate`), its
  create item an action, not a value. Its dialog renders **outside** the form: a portal
  is elsewhere in the DOM but not in the React tree, and its submit ran the payout's
  `onSubmit`. Select only once the invalidation resolves or MUI draws an empty box;
  assert with `find`, a closing modal still holding `aria-hidden` and a list that
  reloaded having replaced the element a test was holding. An empty select *value* reads
  as "nothing chosen", so each "All" entry carries a word. **A screenshot is pasted, not
  saved first** (F25): a paste has no target the way a drop does, so the listener is on
  the *window*, and only the newest zone mounted takes it — or a dialog over a panel
  stores the same file twice. Nothing is consumed until files are actually on the
  clipboard, so a text paste still reaches the box it was typed into. **Nothing is
  stored until it is named** (F26): `image.png` says nothing, and the name a file goes
  in under is the one it keeps — what the trail shows and what F7 matches. So every file
  waits with its name in a field, proposed as `pasted-<when>` when the clipboard gave
  none, and a typed name with no ending keeps the old one: that is an omission, not a
  decision. **What deletes, and what refuses.** A **payout** deletes for real (F18), not
  into a "cancelled" status — the fourth state §13 refused: legs, fees and links go,
  **documents stay** (F6), one transaction, the tree peeled **leaf-first** since
  `parent_id` is RESTRICT, checked per row: a cascade fails below depth one, and a test
  asserts it. An **account** is a party to events, not an event: deleting one with any
  leg is a 409 **counting** them, only its configuration cascades, and an edit is a
  **replacement** (F19), an empty allow-list meaning "holds anything". A **leg** takes
  the legs below it (F20), a child being money that came from it. **Editing a leg**
  (F21) replaces the row and nothing around it — not the kind (§8's fee engine), not the
  parent, not the **fees**: TDS came off a statement, so §7 reports a mismatch rather
  than arithmetic overwriting evidence. **Removing a document is not deleting it**
  (F23): breaking a relationship leaves the file to be attached again. A **document** is
  a thing (F6): deleting one takes every attachment, file *after* row — a row without
  bytes answers 422, bytes without a row are litter. The payout delete alone **removes**
  cache entries rather than invalidating them: a deleted trail 404s.
- **AGPL-3.0-only**, verbatim in `LICENSE`, `license` in all four manifests, no per-file
  headers. Its §13 is the point — a copy reached over a network owes its users the
  source — so §11's "reached from outside?" is a licence question. **A trader is not a
  user** (F24): §5a's account is who is *using* this, a trader is who the money belongs
  to — no password, no `users` row, a name in a dropdown never a way to sign in (a test
  checks the dialog for a password field). **Whose money and when are one selection**,
  `PayoutScope`, honoured identically by the list, the balances, the checks and the
  report; half-honouring it is how screens disagree. The hooks fold it in, never a call
  site, so no screen can forget; in the key it sits *after* the caller's own filter,
  leaving `balances.all()` matching every scoped spelling. The report keeps its own
  range, the bar not re-cutting a year somebody asked for. **A period is two months, not
  a year**: a tax year starts in April, so April 2024 to March 2025 must be sayable, the
  year list reaches back a year further than the data, and clearing either end clears
  both. **In UTC**: local, `new Date(2025, 2, 31)` reaches the server as the 30th.
  `004_traders.sql` adds `trader_id` by **rebuilding the table**: with foreign keys on,
  `ALTER TABLE ADD COLUMN ... NOT NULL REFERENCES` is impossible, so it is SQLite's
  12-step dance under `defer_foreign_keys` and `legacy_alter_table`, §10 and the views
  proven after.
