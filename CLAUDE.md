# Job Scanner — rules for every Claude Code agent

## What this project does
Scans ~100 company career sites daily, keeps jobs that fit one candidate's profile
(senior frontend / full-stack / frontend+AI, H-1B transfer needed), scores them with Claude,
and shows a ranked shortlist in a React dashboard.

## Stack
- Node.js 20+, TypeScript (strict), ES modules. Run TS with `tsx`.
- SQLite via `better-sqlite3`. Schema: `db/schema.sql`. Open the DB only through `openDb()` in `src/db/index.ts`.
- Tests: Node's built-in test runner (`node:test` + `node:assert/strict`) in `tests/`.
- Dashboard (Phase 3): React + Vite + TypeScript in `dashboard/`.

## Commands
- `npm test` — run all tests (must pass before you say you're done)
- `npm run typecheck` — must show no errors
- `npm run db:seed` — load companies.csv
- `npm run db:fixtures` — load the 20 sample jobs from `fixtures/jobs.json`

## Shared contracts — DO NOT CHANGE without asking the human first
- `db/schema.sql`
- `src/db/types.ts` (`Company`, `FetchedJob`, `Job`, `Score`, `Connector`, `Scorer`)
- `src/db/seed.ts` (`saveJobs` is how every connector stores jobs)
- `src/connectors/http.ts` (`politeJson` / `politeText` are the only way connectors make HTTP calls)
- `fixtures/jobs.json` (other phases test against it; add new fixtures in a separate file)
If you need a change here, stop and explain what and why.

## Folder ownership (only edit your phase's folders, plus your own tests)
| Phase | Folders |
| --- | --- |
| 1A Simple connectors | `src/connectors/greenhouse.ts`, `lever.ts`, `ashby.ts`, `smartrecruiters.ts`, `tests/connectors-*.test.ts`, `tests/samples/{greenhouse,lever,ashby,smartrecruiters}/`, `scripts/try-1a.ts` |
| 1B Workday + detector | `src/connectors/workday.ts`, `src/detect/`, `tests/workday*.test.ts`, `tests/detect*.test.ts`, `tests/samples/{workday,detect}/`, `scripts/try-workday.ts`, `scripts/detect-ats.ts` |
| 2 Filter + scoring | `src/filter/`, `src/scoring/`, `prompts/`, `schema/`, `.claude/commands/`, `tests/filter*.test.ts`, `tests/scoring*.test.ts` |
| 3 Dashboard | `dashboard/` |
| 4 Automation | `.github/workflows/`, `src/run/` |

## Coding rules
- Every connector implements `Connector` from `src/db/types.ts` and returns `FetchedJob[]`. It never writes to the DB itself.
- One failing company must never stop a run: catch the error, record it in `fetch_log`, move on.
- Polite fetching: always use `politeJson` or `politeText` from `src/connectors/http.ts` (1 request per second per host,
  15-second timeout, our User-Agent, one retry on 5xx). Only public job listings. If it throws an
  `HttpError` with `blocked === true` (403/429), stop calling that company for the run and report it.
- Unit tests must not hit the network: save real sample responses under `tests/samples/` and test against those.
- Dates are ISO-8601 UTC strings. Booleans in the DB are 0/1.
- No new npm dependencies without asking. Prefer built-in `fetch` and Node APIs.
- Keep functions small and typed; no `any` except when parsing unknown JSON, then narrow it immediately.

## Privacy
- Never commit `private/` (resume), `.env`, or `data/*.db`. They are in `.gitignore`.
- Never put the candidate's resume text in code, tests, or fixtures.

## Definition of done (every phase)
1. `npm run typecheck` passes and `npm test` passes.
2. New code has tests, including at least one failure case.
3. You list the files you changed and anything the human must do (e.g. fill an ID by hand).
4. Work is committed on your phase branch in small commits with clear messages.
