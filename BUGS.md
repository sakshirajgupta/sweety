# Sweety bug tracker

Audit date: 16 November 2026 (India). Application behaviour was inspected and tested; no production bug fixes were applied during this audit. Real Neon records were not added, edited or deleted.

## SW-001 — Form date and displayed report date can differ

Priority: P2. Status: **fixed and browser-verified on 16 November 2026**.

Add mode now synchronizes report and form date changes in both directions, retaining entered slot/value. Today uses the same handler. While editing, report-date selection and Today are disabled; the form explains that changing its date proposes moving the existing reading only when saved. Cancel restores the selected report date. An empty date field remains temporarily blank while editing input; browser required validation prevents saving it.

Verification: in the live browser, changing report date from 15 to 14 November also changed the form to the 14th; changing the form back to the 15th changed reports/list to the 15th. Opening Edit disabled report date and Today. Cancel followed by Today aligned both dates on the 16th. No readings were saved or changed. Existing 22 frontend tests passed and production build succeeded. The interactive synchronization checks were browser checks, not new automated component tests.

## SW-002 — Selected historical day resets to today on reload

Priority: P3. Status: **implemented and browser-verified on 16 November 2026** (requested UX improvement).

The selected report date is now stored in sessionStorage per account and tab. First visits use today; valid remembered past dates survive reload. Invalid/future stored dates fall back to today. A Today button returns to the current calendar day, without saving or deleting readings. The form initially opens on the restored date; clicking Today updates the form date only when no existing reading is being edited, preserving unsaved edit context.

Verification: seven selected-date tests cover first visit, reload, account isolation, Today reset, invalid/future dates, unavailable storage and separate tabs. All 22 frontend tests passed and the build succeeded. In the live browser, selected 13 November, reloaded, verified the dashboard and form still showed 13 November, then clicked Today and verified 16 November. Existing demo account only; no readings written.

Limits: sessionStorage is per tab and normally ends when the tab closes. Browsers blocking storage fall back to today on reload. Subsequent SW-001 fix synchronizes these controls in add mode and locks report navigation while editing; see its section.

## SW-003 — Browser session did not survive refresh in the test environment

Priority: P2. Status: **not reproduced in the latest live-browser recheck; monitoring**. Earlier symptom remains in the history.

Reproduce in the Codex in-app browser: sign in using the existing demo account, confirm dashboard, reload. The page returned to `/login`.

Expected: a valid saved token is verified via `/api/auth/me` and dashboard is restored.

Actual: login form appeared. Six module-level session tests pass, but do not reproduce the browser failure. Vite is serving the current sessionStorage implementation. The browser console also reported a Vite HMR WebSocket connection failure; that alone does not prove the cause of the auth problem.

Next investigation: compare a normal Chrome tab with the in-app browser; check storage availability/persistence and the `/api/auth/me` network response without exposing the token. `api.js` silently falls back to memory when sessionStorage throws, which would explain refresh logout if storage is unavailable; this cause is not yet confirmed.

Latest recheck (16 November 2026): opened a fresh in-app browser tab, signed in with the existing demo account, confirmed the dashboard, reloaded, observed "Checking your session…", then confirmed the same account dashboard returned. The current sessionStorage restoration worked in this run. No login-code change was made, and no database records were changed. This does not establish why the earlier browser run failed or prove that every browser/storage configuration works. If it recurs, capture the origin, tab lifecycle and /api/auth/me response status without exposing credentials.

## SW-004 — Summary cards remain in loading state after dashboard request failure

Priority: P2. Status: **fixed and component-tested on 16 November 2026**.

Original issue: a failed dashboard request left `reports` null. Summary cards interpreted null as ongoing loading even though the request had failed.

Fix: summary cards now receive explicit loading and error state. A failure displays "Unable to load this summary" with guidance to the existing "Try loading again" button. Missing data after loading finishes is also treated as an unavailable summary, not an indefinite loader. Successful empty responses remain friendly empty states. Retry clears the error and can render fresh results normally.

Verification: six rendered React-component tests cover loading, failure, stale data, retry recovery, empty results and missing data. All 15 frontend tests passed, and the production build succeeded. No real database access was needed. Browser failure injection was not performed; retry state transitions are verified at the rendered-component level, not an end-to-end network test.

## SW-005 — Simultaneous partial edits lose an independent change

Priority: P2. Status: **fixed and regression-tested on 16 November 2026**.

Original reproduction: with `{ slot: morning, value: 120 }`, overlap PATCH requests `{ value: 125 }` and `{ slot: after_lunch }` after both read the original row. Both previously returned 200 but the final value reverted to 120.

Fix: the backend UPDATE writes only explicitly supplied columns, using a fixed column allowlist and parameterized values. The frontend now sends only fields actually changed from the originally opened reading, instead of a full stale form snapshot. Unknown/owner fields are never included. An unchanged UI edit sends no request; an API PATCH with no recognized fields returns 400.

Verification: the previously failing deterministic two-request regression now passes as a normal test (no TODO). All 21 backend tests and 9 frontend tests passed; frontend production build succeeded. Tests used isolated data and no Neon records changed.

Scope: independent field edits are preserved. If two requests explicitly change the same field, the last successful write wins; version-based conflict prompts are not implemented. A real PostgreSQL load/concurrency run was not performed.

## SW-006 — Root test command omits frontend tests

Priority: P3. Status: **fixed and verified on 16 November 2026**.

Fix: the root `npm test` now runs `npm run test:server && npm run test:client`. Each suite can also be run separately. A failing backend suite stops the command and returns failure instead of being hidden by a later command. README documents this behaviour.

Verification: ran the root command successfully: **21 backend + 15 frontend = 36 passing tests**, 0 failures, 0 TODO tests. No Neon access was involved.

## Previously fixed / checked

- Date display shifting to the previous day: fixed by PostgreSQL date-only parsing; regression passes.
- Full day blocking another date: not reproduced. Separate dates accept independent four-slot sets.
- Duplicate create: one of three simultaneous same-slot requests succeeds; other two return 409 in the isolated emulator test. This is not proof of real PostgreSQL transaction/concurrency behaviour.
- Owner isolation: read, edit, delete and reports prevent another test account from accessing readings.

See `TEST_RESULTS.md` for commands, results and limits.
