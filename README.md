# Society Ledger — Building Maintenance Management System

A complete local web application for managing multiple buildings: flats, monthly maintenance, full/partial/extra payments, dues, advance balances with month-wise adjustment, expenses, emergency funds, cash/online/bank balances, flat-wise ledgers, financial dashboards, and per-building Google Sheets sync.

**Stack:** React 18 + Vite + React Router + Recharts · Node.js + Express · SQLite (better-sqlite3, persistent, relational, foreign keys) · Google Sheets API via service-account (credentials in `.env` only).

All money is stored as **integer paise** in the database — no floating-point rounding errors. Financial calculations run on the backend inside database transactions. Financial records are **soft-deleted** and every change is written to an audit log.

---

## 1. Install dependencies

Requires Node.js 18+ (tested on Node 22).

```bash
cd server && npm install
cd ../client && npm install
```

## 2. Configure environment variables

```bash
cd server
cp .env.example .env
```

Edit `server/.env`:

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 4000) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email for Sheets sync |
| `GOOGLE_PRIVATE_KEY` | Its private key (keep the `\n` escapes, wrap in quotes) |
| `SHEETS_AUTOSYNC` | `true` to auto-sync connected sheets after every data change |

The app runs fully without Google credentials — only the sync feature needs them.

## 3. Initialize the local database

Nothing to do manually: the schema in `server/src/schema.sql` is applied automatically the first time the backend starts. The database file is created at `server/data/bmms.sqlite`.

## 4. Run database migrations

The schema script is idempotent — it runs on every backend start, so new tables/indexes added in future versions are applied automatically. To fully reset, stop the server and delete `server/data/bmms.sqlite*`.

## 5. Add sample data (optional)

```bash
cd server && npm run seed
```

Creates a demo building ("Green Residency") with flats, payments and an expense.

## 6. Start the backend

```bash
cd server && npm run dev
# → BMMS API running on http://localhost:4000
```

## 7. Start the React application

In a second terminal:

```bash
cd client && npm run dev
```

The Vite dev server proxies `/api` to the backend automatically.

## 8. Access the application

Open **http://localhost:5173** in your browser (works on mobile browsers on the same network too — run `npm run dev -- --host` in `client` and open `http://<your-ip>:5173` from your phone).

---

## Google Sheets setup

1. In Google Cloud Console, create a project → enable the **Google Sheets API** → create a **Service Account** → create a JSON key.
2. Put `client_email` and `private_key` from that JSON into `server/.env`.
3. Create a Google Sheet for a building and **share it with the service-account email** (Editor).
4. In the app: Building → Google Sheet → paste the sheet URL → Connect → **Sync now**.

The sheet receives building info, flat-wise status, all payments, expenses, emergency funds, and per-flat ledgers. The local SQLite database is always the source of truth; the sheet is a synchronized reporting copy. Sync results (success/error) are recorded in the sync log with a retry button.

## How the money logic works

- **Due:** monthly amount − payments applied − advance applied for that month. Example: ₹580 required, ₹300 paid → ₹280 due (status: Partially paid).
- **Advance:** any amount above the month's due is stored as an advance credit. Example: ₹2,080 paid against ₹580 → ₹580 applied, ₹1,500 advance. Apply it to any future month from **Payments → Apply advance** (choose the month and amount, or apply the maximum). Full credit/debit history is kept per flat.
- **Balances:** every income and expense carries a payment method; Cash / Online (UPI + online) / Bank balances are computed from the full history, so edits and deletions always keep them correct.
- **Editing a payment** soft-deletes the original and records a corrected one — the audit log preserves the trail.

## Project structure

```
server/
  src/schema.sql          # relational schema (paise integers, FKs, soft-delete)
  src/db.js               # SQLite init + money helpers + audit
  src/services/finance.js # dues, advances, ledgers, summaries (transactional)
  src/services/sheets.js  # Google Sheets sync (service-account JWT, no SDK)
  src/routes/api.js       # validated REST API
  src/seed.js             # optional demo data
client/
  src/api.js              # fetch helper + formatting
  src/components/ui.jsx   # layout, nav, modal, chips, toast, theme
  src/pages/              # Buildings, Dashboard, Flats, Payments, Ledger,
                          # Expenses, Funds, Sheets
  src/styles.css          # glassmorphism design system, light/dark themes
```

## Future scalability

The separation (React ⇄ REST API ⇄ service layer ⇄ SQLite) means resident logins, payment gateways, WhatsApp/SMS/email reminders, PDF/Excel reports, and a cloud database can be added without restructuring: add auth middleware in `server/src/index.js`, new routes in `routes/`, and swap the DB layer behind `db.js` when moving to Postgres/MySQL.
