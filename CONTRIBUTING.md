# Contributing

Thanks for taking a look. Bug reports, feature ideas and pull requests are all welcome.

## Getting set up

Node.js 24 or newer is required — the database uses the built-in `node:sqlite` module.

```bash
npm install
npm run dev          # http://localhost:3000  (admin@company.com / Admin@123)
npm run seed:demo    # optional sample company
```

Delete the `data/` folder to start over with a clean database.

## Before opening a pull request

```bash
npm test             # rules engine unit tests
npx tsc --noEmit     # types
npm run lint
npm run build
```

If you touched anything a user clicks, also run the end-to-end checks against a running server
(they drive the installed Microsoft Edge, no browser download needed):

```bash
BASE=http://localhost:3000 node scripts/e2e-smoke.mjs
BASE=http://localhost:3000 node scripts/password-test.mjs
```

## How the code is laid out

| Path | What lives there |
|---|---|
| `src/lib/engine.ts` | The rules engine: punches + shift + leave → a day's status. Pure functions, no database. Unit-tested in `engine.test.ts` |
| `src/lib/db.ts` | Schema, migrations and seed data. Migrations must be additive and idempotent |
| `src/lib/agent.ts` | Desktop-agent logic: events → punches, automatic check-out, offline handling |
| `src/actions/` | Server actions. **Every one re-checks the role on the server** |
| `src/app/(app)/` | Signed-in pages |
| `src/components/` | Shared UI |
| `agent/src/PulseAgent.cs` | The Windows tray agent (C# 5, .NET Framework 4.x — no SDK needed) |
| `scripts/` | Build, seed and test scripts |

## Conventions

- Keep attendance rules in the engine, not in pages, and cover new rules with a unit test
- Add a database column with an `ALTER TABLE` inside `migrate()` — never rewrite an existing table
- Never delete a punch; void it and keep the original (`voided = 1`)
- Write an audit entry for anything an admin or manager changes
- New user-facing text goes through `t("…")` and gets an Urdu string in `src/lib/i18n.ts`
- Layouts must survive a 400px-wide screen and work in both themes and in right-to-left

## Rebuilding the Windows agent

```bash
npm run build:agent   # Windows only; uses the csc.exe shipped with .NET Framework
```

Then test it against a running server with `node scripts/agent-api-test.mjs`.
