# Working in this repo alongside another agent

Two assistants edit this project on the same machine: **Codex** (OpenAI, desktop app + VS Code) and
**Claude Code** (terminal). Both write to the same working tree, so read this before you start.

## Leave a note before you touch shared files

- Codex → Claude: nothing to run; Claude reads this file and `git status`.
- Claude → Codex: `codex queue --thread <session-id> --message "…"`
  (`codex.exe` lives in `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\`; session ids are in
  `%USERPROFILE%\.codex\session_index.jsonl`).
- Either way, add a line under **In flight** below, and delete it when the work lands.

## Who owns what (28 Sep 2026)

- **Astra (Codex)** owns the product surface: UI, layout, design tokens and CSS, shared components
  (`Dialog`, `DataTable`, `LiveRefresh`), accessibility, responsive / theme / RTL, and product
  behaviour it judges broken. Its quota is limited, so it should spend it here, not on chores.
- **Claude (Claude Code)** owns the plumbing: server actions, SQLite schema and migrations, the
  snapshot backup, the Windows and Mac agents, test suites, docs, commits, deploys and live
  verification.
- Hand work over in one line: Astra writes `done: <thing>, safe to commit`; Claude commits and
  deploys it. Either side can ask the other with a line starting `claude:` or `astra:`.

## In flight

- done: desktop v1.1 browser linking, hidden company connection, Windows per-user installation, verified update downloads, acknowledged queues with event deduplication and server-side unlink. Isolated production build, TypeScript, eslint, 32 unit tests, browser linking/API suite and 450-event Mac sender fixture pass. Codex is handling the user-authorized release; native Mac GUI verification still requires a Mac.

- done: employee calendar now opens the existing attendance editor for authorized employees on today/past dates, including days without punches. TypeScript, eslint and 29 tests pass; browser/live verification and deployment pending. Claude: safe to deploy after verification.

- Astra: second visual pass ready for commit — attendance hero, route briefings, depth/type/motion, team roster (Details retains the table), approval cards, kiosk, notification styling, persistent heatmap legend and Urdu strings. TypeScript + eslint clean; 17 engine tests pass; isolated QA dev on 3217 checked desktop/mobile, light Urdu, roster search/view switching, heatmap selection and reduced motion with no page errors. Screenshots in ignored test-run/pass2-*.png. Claude: production suites/deployment verification pending; next review should cover the complete original brief, not assume this pass finishes it. employees/[id], download and app-downloads remain Claude-owned.
- Claude: updating the older suites for the new confirm dialog, then committing and deploying the
  uncommitted work (`/download`, `/employees/[id]`, public exe route).

## Do not surprise the other agent

- **Never run `npm run build` into `.next/` while the other agent may be testing.** A build wipes
  `.next/standalone`, so a running server suddenly serves pages whose JavaScript 404s and every
  browser test fails for no visible reason. Build into your own directory instead:
  `PULSE_DIST_DIR=.next-<yourname> npm run build` (see `next.config.ts`), and copy assets with
  `cp -r <dist>/static <dist>/standalone/<dist>/static && cp -r public <dist>/standalone/public`.
- Local test servers: Claude uses port **3300**, Codex uses its own. Do not kill node processes you
  did not start — check `Get-CimInstance Win32_Process` command lines first.
- Do not revert the other agent's uncommitted work. If a change looks wrong, say so in a note.
- Commit your own work in small commits so the other agent can tell the changes apart.

## Before you claim something works

- `npx tsc --noEmit` and `npx eslint src scripts` must be clean.
- `npm test` — the rules engine (17 unit tests).
- Browser suites need a server you built yourself, then
  `BASE=http://localhost:<port> ADMIN_PW='…' node scripts/<suite>.mjs`. The suites are listed in
  README.md under **Tests**.
- If you change how confirmations or dialogs work, update **every** suite that drives them, not just
  the one you wrote. `scripts/e2e-smoke.mjs` and `scripts/live-acceptance.mjs` still assume
  `window.confirm`; `ActionButton` now opens an in-page dialog instead.

## The parts that are easy to break

- `src/lib/engine.ts` is pure and unit-tested. Company rules live there: 09:00–18:00, fixed 13:15–14:15
  break, 90 late minutes a week, half-day leave is afternoon only, late sitting is not overtime.
  Change it only with tests.
- Forms dispatch server actions from a `useTransition`, not `<form action={…}>`. With `useActionState`
  React stopped dispatching after an action returned without refreshing the router, so a rejected
  submit (a mistyped password) jammed the form until a page reload. `scripts/retry-test.mjs` guards it.
- The database is a single SQLite file, snapshotted to a private GitHub repo with a serial number
  (`src/lib/backup.ts`). Two servers writing the same snapshot repo will fight; `scripts/backup-race-test.mjs`
  covers it.
- `setOnWrite` is kept on `globalThis` because production loads `src/lib/db.ts` twice. Do not "clean
  that up" — without it, writes made in a request are never snapshotted and get lost on redeploy.

## Deployment

Render free plan, `https://pulse-attendance.onrender.com`, deployed from `main` on push.
Anything uncommitted is not live. `ADMIN_RECOVERY_CODE` still has to be set in Render → Environment
before admin self-recovery works.
