# Sweety — Blood Glucose Tracker

A personal glucose diary built with React + Vite, Node.js + Express, and PostgreSQL. Users register and log in, save up to four glucose readings a day, edit/delete their own readings, and view daily, month-to-date and previous-month reports.

## Run locally

Requires Node.js 22.12+ (or a compatible newer version), npm, and a PostgreSQL database. Neon works; PostgreSQL does not have to be installed locally.

1. In `server`, run `npm install`.
2. Copy `server/.env.example` to `server/.env` **only if `.env` does not already exist**. Keep your existing settings when upgrading.
3. Set `DATABASE_URL` to the **separate Sweety database**, not another project's database. Keep the full provider URL and SSL options. Use verified TLS; never disable certificate validation.
4. Set a random `JWT_SECRET` of at least 32 bytes. Generate a new secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and store it privately in `.env`.
5. If tables do not exist, review `server/schema.sql`, confirm the target, then run `npm run db:setup -- --confirm-sweety` from `server`. The script creates missing tables and never drops existing data. If you already ran the supplied table SQL, skip this step.
6. From `server`, run `npm run dev`. API: `http://localhost:4000`.
7. In another terminal, open `client`, run `npm install`, then `npm run dev`. Open the URL Vite prints (usually `http://127.0.0.1:5173`).
8. Register a test account or use the optional seed below.

The Vite development proxy forwards `/api` to port 4000. If you change the backend port, update `client/vite.config.js`. No frontend environment variables or database credentials are needed. All backend variables are listed in `server/.env.example`; never commit `.env`.

## Database and optional demo seed

Tables: `users` (name, normalized unique email, bcrypt password hash) and `readings` (owner, calendar date, slot, integer value). Foreign keys enforce ownership references. Four allowed slots plus a unique constraint on `(user_id, reading_date, slot)` prevent duplicates and cap a day at four entries, including simultaneous requests.

After checking the connection targets Sweety, run from `server`:

```sh
npm run seed -- --confirm-sweety
```

This creates `demo@sweety.example` / `SweetyDemo123!` with fictional readings across 45 days. Override these using `DEMO_EMAIL` and `DEMO_PASSWORD`. If that email already exists, the seed does nothing and does not reset any password or readings. It does not modify other users. The script is provided for you to run; it is not run automatically.

## Tests and frontend build

From the Sweety root, run `npm test` to run backend tests followed by frontend tests. If the backend fails, the command stops and reports failure. Run `npm run test:server` or `npm run test:client` to check just one suite. These tests do not connect to Neon.

From `server`:

```sh
npm test
```

API integration tests cover password hashing, registration/login, JWT expiry and tampering, owner isolation, reading validation, all four slots, duplicate create/edit, partial edits, delete, reports, rounding, inclusive date boundaries, previous-year January, leap-year February, empty states and malformed requests.

Tests use **pg-mem**, an in-memory PostgreSQL emulator, and Supertest. They do not read `.env` or connect to Neon. Identity syntax is translated to SERIAL for emulator compatibility. Emulator tests do not replace a full PostgreSQL integration run; concurrency and provider TLS behavior are not exercised by them. Earlier development smoke tests against the Sweety Neon database verified registration, password storage, login, tokens, create/view/edit and ownership filtering. The seed script is also tested against the emulator for valid fictional readings and repeat-run safety; this does not connect to Neon.

From `client`:

```sh
npm run build
```

This produces `client/dist`. A production deployment must serve those files with SPA fallback and forward `/api` to the Express server, or provide equivalent reverse-proxy configuration. `vite preview` only previews the static build; it does not replace that production API setup.

## API

All reading/report endpoints require `Authorization: Bearer <token>`. Only registration and login are public. JSON errors use `{ "message": "..." }`.

- `POST /api/auth/register`: `{ name, email, password }`; returns 201, without password/hash.
- `POST /api/auth/login`: `{ email, password }`; returns a signed one-hour token and public user details.
- `GET /api/auth/me`: public details for the authenticated user.
- `POST /api/readings`: `{ date: "YYYY-MM-DD", slot, value }`; 201 on success.
- `GET /api/readings`: own readings, newest dates first; optional `?date=YYYY-MM-DD`.
- `PATCH /api/readings/:id`: any subset of `{ date, slot, value }`; omitted fields remain unchanged.
- `DELETE /api/readings/:id`: delete only an owned reading.
- `GET /api/reports?date=YYYY-MM-DD`: daily (including readings), month-to-date, and the **whole previous month** relative to the selected date.

Slots: `morning`, `after_breakfast`, `after_lunch`, `after_dinner`. Values must be JSON numbers and whole integers from 40 to 600. Dates cannot be in the future. Duplicate slots return 409. Unknown/not-owned reading IDs return the same 404. Missing/invalid/expired tokens return 401. Reports return null statistics and count 0 when empty; the UI shows a friendly message. Averages are calculated across individual readings and displayed to one decimal place.

## Files explained

- `server/index.js`: loads settings, checks the database and starts the server.
- `server/db.js`: creates the PostgreSQL connection pool; it does not run example queries automatically.
- `server/app.js`: routes, validation, JWT checks and owner-filtered database queries; exported separately for tests.
- `server/schema.sql`: the database table definitions.
- `server/scripts/`: explicit setup and fictional demo-data scripts.
- `server/test/api.test.js`: repeatable tests that cannot reach your real database.
- `client/src/main.jsx`: React login, registration, dashboard, forms, reports and delete confirmation.
- `client/src/api.js`: HTTP requests and in-memory login token.
- `client/src/styles.css`: responsive styling.

## Notes / assumptions

- PostgreSQL is used as the assignment explicitly requires, despite its MERN title.
- Any real past date is allowed, not just dates after account creation.
- Calendar dates use India Standard Time (`Asia/Kolkata`). The server supports `APP_TIMEZONE`, but the frontend is intentionally fixed to India for this version; update both together if changing the product timezone.
- The selected report date is remembered per account in the current tab using sessionStorage. First visits show today; the Today button returns to the current day. The form starts on the restored date. In add mode, changing either date control updates both. While editing, report-date navigation and Today are disabled until Save or Cancel; changing the form date explicitly moves the reading only on Save. Invalid/future saved dates fall back to today.
- All four slots are optional. Four is the maximum, not a daily requirement. On a full day a repeated slot is reported as a duplicate; a fifth distinct slot cannot exist.
- Passwords have a minimum of 8 characters and a maximum of 72 UTF-8 bytes to respect bcrypt's limit. These are project choices. Password whitespace is preserved; all-whitespace passwords are rejected.
- Tokens live in sessionStorage for the current tab. Refreshing the page verifies the saved token through /api/auth/me and restores the session; logout clears it. Normal tab closure ends sessionStorage, although browser session-recovery features may restore tabs and storage. Storage-blocked browsers fall back to memory. Temporary connection failures preserve the token and offer retry. Already issued JWTs expire after one hour and are not revoked server-side by logout.
- Existing manually created demo data is kept. Seed is opt-in. Tests use isolated generated records in memory.
- This records and summarizes data; it does not diagnose or recommend medication. The accepted 40–600 range is an input rule, not a healthy glucose range. Use fictional data for demonstrations.
- With more time: real PostgreSQL CI, frontend/browser tests, rate limiting, password reset, refresh sessions using secure cookies, pagination and charts. Bonus Redis, jobs, Docker and doctor roles are not implemented.

## Submission checklist

- Create a public GitHub repository after reviewing files for secrets; use meaningful commits from now on. Do not fabricate past commits.
- Keep `.env` and `node_modules` ignored. Commit `.env.example` and lock files.
- Capture screenshots or a 2–3 minute recording: register/login, add/edit/delete, duplicate error, report ranges and empty states.
- Run tests and the frontend build. Add screenshots to the repository and link them here.

No public repository or hosting is created automatically. Screenshots and browser verification must be completed before claiming the UI was visually verified.
