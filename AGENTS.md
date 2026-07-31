# Agent Guide

Rules for any AI agent working in this repository.

## Ground rules (non-negotiable)

1. **Never push to `main`.** All work happens on branches.
2. **Never merge a PR.** Open PRs only; the human is the sole merge gate.
   Do not approve, merge, or enable auto-merge — not even your own PRs,
   not even when CI is green.
3. **Stop and ask if a ticket is unclear.** Do not guess at intent, invent
   requirements, or silently expand scope. Ask on the issue and wait.
4. **Stay in scope.** Do only what the issue's spec says. If you notice an
   unrelated problem, file a new issue instead of fixing it in place.

## How work flows

- Work is tracked as GitHub issues. Use the `gh` CLI to read and comment.
- `.factory/goals/triage.md` — how to turn a vague issue into a spec.
- `.factory/goals/implement.md` — how to implement a spec'd issue.
- Branch naming: `issue-<number>-<short-slug>`, e.g. `issue-12-void-settlement`.
- Every PR references its issue (`Closes #12`) and must pass CI
  (typecheck + tests) before requesting review.

## Code rules

- Read **STANDARDS.md** before writing code. Key points: money is integer
  pence, odds are integer hundredths of their decimal form, no floats in
  money or odds paths, settlement logic requires table-driven tests.
- `npm run typecheck` and `npm test` must both pass before you push.
- Never commit user data: `*.db`, `*.sqlite`, `/data`. This is a public repo.

## Layout

- `src/` — application code (Hono API, better-sqlite3 storage).
- `test/` — Vitest tests.
- `.factory/goals/` — agent playbooks for specific jobs.
