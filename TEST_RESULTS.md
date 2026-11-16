# Validation results — 16 November 2026

## Commands actually run

- `cd server && npm test`: 21 tests total, **20 passed and 1 known failing TODO (SW-005)**. Normal failures: 0. The TODO contains a real failing assertion; the project is not bug-free.
- `cd client && npm test`: **6 passed, 0 failed**.
- `cd client && npm run build`: succeeded, 36 modules transformed. React Router emitted non-fatal ignored "use client" directive warnings.

## Automated coverage

Registration validation, email normalization, duplicate registration, bcrypt storage/verification, login errors, JWT signature/expiry/tampering/identity, owner isolation, required and typed glucose values, inclusive 40/600 bounds, decimals, date reality/future checks, invalid slot types, same-slot uniqueness, a full four-slot day, independent dates, duplicate simultaneous creates, partial edit, duplicate edit, deletion, report recalculation, individual-reading average/rounding, inclusive monthly boundaries, January/year rollover, leap February, empty summaries, malformed JSON, oversized bodies, invalid reading IDs, safe database-error responses, and date-only parser regression.

Session tests cover stored token restoration, logout clearing storage, expiry clearing storage, temporary backend failure with retry, network failure, and distinguishing failed login from session expiration.

## Browser checks actually performed

Using the existing fictional demo account in the in-app browser (no new registration or reading submission): login succeeded, dashboard loaded, historical-day data and statistics loaded, matching calendar date displayed, empty daily/previous-month states displayed. Form/report date mismatch reproduced. Refresh unexpectedly returned to login (SW-003), so browser-level persistence is not considered verified despite passing module tests. The current sessionStorage code was confirmed in the served source. The console reported a Vite HMR WebSocket failure.

## What changed during this audit

Added eight backend edge-case tests and two documentation files (`BUGS.md`, this file). Application code and real database records were not changed. Signing in changed only the temporary browser session. Its final page is the login screen.

## Limits / remaining work

- No finite test run can check every possible input or prove absence of bugs.
- Backend tests use pg-mem, not a live PostgreSQL test instance. No production records were modified. Real PostgreSQL concurrency/load, networking and TLS remain separate checks.
- Browser checks were read-only with respect to database records. End-to-end registration/create/edit/delete in the browser, mobile layouts and accessibility were not fully exercised in this run.
- The concurrent partial-edit regression is reproducible and intentionally failing as TODO until a fix is authorized.
- Summary-card failure state is a source-reviewed finding, not browser-injected proof.
- Date-selection persistence is an open UX choice, not an assignment requirement.
- Seed/setup scripts and public deployment were not executed. No GitHub publication was performed.

Next recommended order: fix SW-005 (lost updates), SW-001 (date context), investigate SW-003 (browser refresh login), fix SW-004 (failure states), then address date persistence and root test command.

## SW-005 fix verification — 16 November 2026

After the approved fix: **21/21 backend tests passed, 9/9 frontend tests passed, 0 TODO tests**, and the frontend production build succeeded. The original audit results above remain as history. Backend updates now touch only requested fields; frontend edits send only fields changed by the user. The deterministic concurrent partial-edit regression is enabled and passing. No real Neon records were changed. Other tracked issues were not fixed in this change.

## SW-004 fix verification — 16 November 2026

Explicit loading/error props now distinguish failed summaries from pending ones. Six new rendered React-component tests passed; the complete frontend suite passed **15/15** with no TODO tests, and the production build succeeded. Retry-state rendering, empty results and stale-data suppression are covered. Backend code and Neon records were unchanged; no browser network failure was injected.

## SW-006 fix verification — 16 November 2026

The root `npm test` command now runs both suites and was verified end-to-end: **21 backend tests + 15 frontend tests = 36 passed**, with no failures or TODOs. Individual commands are `npm run test:server` and `npm run test:client`. No database records changed.

## SW-003 live-browser recheck — 16 November 2026

Signed in with the existing demo account in a fresh in-app browser tab, confirmed dashboard, reloaded, observed session verification, and confirmed dashboard restoration for the same account. The earlier refresh-logout symptom was not reproduced. No application code was changed and no real database records were modified. SW-003 is marked not reproduced on latest recheck / monitoring rather than fixed with an unproven code change.

## SW-002 selected-date improvement — 16 November 2026

Added per-account, per-tab selected-date persistence and a Today shortcut. **22 frontend tests passed**, including seven new date-selection cases; production build succeeded. Browser confirmed 13 November survives reload and Today returns to 16 November. No Neon records were changed. Backend code was unchanged, so backend tests were not repeated for this frontend-only change.

## Full recheck after selected-date improvement — 16 November 2026

Current suites: **22 backend + 22 frontend = 44 passing tests**, 0 failures and 0 TODOs. The root command first passed the then-existing 43 tests. One additional repeatable seed test was added, and the complete backend suite was rerun: 22/22 passed. The frontend suite passed 22/22. `npm run build` succeeded (39 modules). Non-fatal React Router directive warnings remain.

New seed coverage executes the real seed script with its database dependency replaced by pg-mem: one account with a valid bcrypt hash, 150 fictional readings across 45 days, valid values/ownership, at most four distinct slots per date, and a second execution preserving existing readings and password. This does not connect to Neon.

Live browser checks using the existing fictional demo account: wrong password rejected; correct login accepted; daily/month-to-date/previous-month summaries loaded; the saved 15 November reading displayed 125 mg/dl with daily count 1, min/max/average 125; edit form loaded then was cancelled; delete confirmation was opened then cancelled; reload restored login and the selected 15 November date; Today returned to the current date; logout returned to login and remained logged out after refresh. No real reading was added, changed or deleted.

Remaining limits: SW-001's form and report date controls remain independent when manually changed (matching dates in a screenshot do not exercise that path). Automatic cross-tab refresh is not implemented, as discussed and deferred. Browser mutation flows were tested through the isolated API suites rather than modifying real records. Full real-PostgreSQL concurrency, load, mobile/accessibility and production deployment testing remain outside this verification. Passing tests are evidence for covered cases, not a guarantee of perfection.

## SW-001 fix verification — 16 November 2026

The previously recorded independent date controls are now synchronized in add mode. Browser checks passed in both directions, and verified report date/Today are disabled during editing, Cancel restores add mode, and Today aligns both dates. No readings were submitted. All 22 frontend tests passed and production build succeeded; backend code was unchanged. Older open-issue observations above describe historical states before this fix.
