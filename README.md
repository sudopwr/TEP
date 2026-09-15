# Payout Tracker

Tracks a trading-firm payout from the gross award to the net rupees in your
bank — every hop, every fee, every rate, with the supporting document attached
to the leg it supports.

A payout arrives as USD on a prop firm platform and moves through a processor,
a couple of crypto wallets and an exchange before landing as INR in a bank.
Each hop has its own fee, its own rate and its own reference. This keeps the
whole chain in one place and checks the arithmetic, which a spreadsheet does
not: in the sheet this replaced, copy-paste had silently destroyed four amounts
and two fee values.

It runs on your machine, for you, bound to `127.0.0.1`. There is no cloud, no
account to create and nobody else who can see it.

## Before you start

- **Node 22 or newer.** `node --version` to check.
- **npm 10 or newer**, which comes with Node.

Nothing else. The database is a file, and it is created for you.

## First run

```bash
npm ci        # install exactly what the lockfile says
npm run build # type-check everything and build the interface
npm start
```

Then open <http://127.0.0.1:3000>.

`npm start` is one process. It serves the API and the interface on the same
address, which is not only convenience — the session cookie is `sameSite=lax`
with no domain, and it only works because the browser sees one origin.

### Sign in — and change the password straight away

The application ships with:

```
username: admin
password: admin
```

**That is a real password in a real installation, and it is the same one in
every copy of this software.** It is only defensible because of three things,
and you will notice all three:

1. Every screen that shows data answers "change your password" until you do.
2. The server refuses to listen on anything but `127.0.0.1` while it is set,
   so nothing on your network can reach it.
3. The first screen after you sign in is the one that changes it, and there is
   no way past it — no skip, no navigation, no dismissible banner.

Change it now. A passphrase of twelve characters or more; length is the whole
policy, so there are no symbols to remember. You can change the username too,
from **Account**, whenever you like.

### Bringing in an existing spreadsheet

If you have the legacy CSV:

```bash
npm run import -- path/to/your-sheet.csv
```

It corrects the known defects in that sheet on the way in — the copy-pasted
sale amounts, the swapped exchange fee and GST, the reference Excel turned into
a float — and reports every correction it made. Running it twice is safe: rows
are keyed by the code the sheet already gives them, so the second run inserts
nothing and tells you so.

## Every command

| Command | What it does |
|---|---|
| `npm run dev` | Both servers in watch mode: the API on 3000, the interface on 5173 with hot reload. Open **5173**. |
| `npm run build` | Type-checks core, then the API, then the interface, and builds the bundle. Fails on any type error. |
| `npm start` | One process serving both, on `127.0.0.1:3000`. |
| `npm test` | The unit and integration suites. |
| `npm run test:e2e` | Nine journeys through a real browser against a real server. |
| `npm run backup` | A timestamped copy of your data. See below. |
| `npm run import -- <csv>` | Import the legacy sheet, once. |

`npm run dev` and `npm start` are different shapes on purpose. In development
the interface is served by Vite so that a change to a component appears without
a reload; in production there is one process and one port and nothing to keep
in step.

## Where your data lives

```
data/
  app.db      the database — companies, payouts, transactions, fees, sessions
  files/      every document you have attached, stored by content hash
```

That folder is everything. It is not in version control and never should be.

If you want it somewhere else — a synced folder, an external disk — point the
application at it:

```bash
PAYOUT_DB=/somewhere/app.db PAYOUT_FILES=/somewhere/files npm start
```

One more file matters: **`.env`**, in the project root, holding
`SESSION_SECRET`. It is generated on first run. Losing it signs you out and
nothing more — it signs the session cookie, it is not your password and it
cannot be used to read anything.

## Backing up

```bash
npm run backup
```

This writes `backups/2026-09-13T07-42-19Z/` containing `app.db` and `files/`.
Run it while the application is running; nothing is locked and nothing stops.

**Do not back up by copying `data/` yourself.** The database runs in
write-ahead-log mode, which means your most recent transactions may be sitting
in `app.db-wal` rather than in `app.db`. Copying the files by hand gives you
three snapshots taken at three different instants, and the result is often a
database that opens cleanly and is missing the last thing you did — or, if
nothing has been checkpointed yet, one that is entirely empty. `npm run backup`
uses SQLite's own backup API, which reads the pages under a read transaction
and folds the log in, and writes a single consistent file.

### Restoring

1. Stop the application.
2. Copy `app.db` and `files/` from the backup folder into `data/`, replacing
   what is there.
3. Start it again.

That is the whole procedure. The backup has no sidecar files and no pending
log, so there is nothing else to bring across — which is the other reason not
to hand-copy a live database, where `app.db-wal` and `app.db-shm` must travel
with it or not at all.

## If you forget your password

There is no reset link, because there is nowhere to send one. Recover it from
the database instead.

1. Stop the application.
2. Delete the account row:

   ```bash
   sqlite3 data/app.db "DELETE FROM users;"
   ```

   (Any SQLite client will do. Your sessions go with it, which is intended —
   an old browser cookie must not survive a reset.)

3. Start the application again. Migrations run on every start, notice that
   there are no accounts, and put the shipped credential back. It says so
   plainly on the console.

4. Sign in with `admin` / `admin`. You are back in the cage from the first run:
   change the password before anything else works.

**None of your data is touched.** Payouts, transactions, fees and documents
are unrelated to the account row — you are replacing the key, not the filing
cabinet.

## What it can do

- Record companies, accounts and payouts.
- Record the tree of transactions a payout splits into: withdrawals, transfers
  and the sale that produces rupees — each with both amounts, its currencies,
  its rate and its fees.
- Show the money trail as a tree, with every hop's figures side by side.
- Show the settlement: gross proceeds, fees by type, net credited.
- Show the balance of every account in every currency, including crypto dust.
- Attach documents to a leg, and search them by filename and by the text
  inside a PDF.
- Flag rows worth a second look — a fee off its schedule, a cross-currency move
  with no rate, a leg that sends more than its parent delivered. These are
  questions, not errors; every one of them has a legitimate explanation.
- Total a financial year by company: credited, TDS withheld, fees paid.

## If something goes wrong

- **"No interface found"** on start — run `npm run build` first. The API is
  running fine; nothing is serving the screens.
- **Every screen says "change your password"** — that is the first-run cage
  working. Change it.
- **The server refuses to start on an address** — it will not leave
  `127.0.0.1` while the shipped password is in place. Change the password, or
  keep it on loopback, which is where it belongs.
- **A migration error about a checksum** — an applied migration has been
  edited. It is a record of what your database already did; restore the file
  rather than the database.

Development notes, the reasoning behind the design, and the decision log live
in [CLAUDE.md](CLAUDE.md).

## License

Released under the [GNU Affero General Public License v3.0](LICENSE). You may
use, study, change and share it; if you change it and let other people reach
your copy over a network, section 13 asks you to offer them the source of the
version they are using.
