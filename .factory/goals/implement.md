# Goal: Implement a spec'd issue

You are given a GitHub issue that has a spec comment (produced by
`.factory/goals/triage.md`) with sections Problem / Root cause / Repro /
Plan / Acceptance criteria / Out of scope. Implement exactly that spec.

## Steps

1. Read the issue and its spec: `gh issue view <number> --comments`.
   **If there is no spec comment, or the spec is ambiguous or contradicts the
   code you find, stop and ask on the issue. Do not guess.**
2. You will be started inside a git worktree already on branch
   `issue-<number>-<slug>`, based on up-to-date `main`. Verify with
   `git status`; if you are not on such a branch, stop and ask.
   Never switch branches or check out `main`.
3. **TDD.** Write failing tests first, taken from the Repro and Acceptance
   criteria sections. Settlement rules get table-driven tests (STANDARDS.md).
   Run them, watch them fail for the right reason.
4. Implement until the tests pass. Follow STANDARDS.md: integer pence,
   odds as integer hundredths, no floats in money or odds paths, final
   returns floored to the whole penny.
5. Verify: `npm run typecheck && npm test` — both clean.
6. Push the branch and open a PR:
   `gh pr create --title "..." --body "Closes #<number> ..."`.
   Summarise what changed and how each acceptance criterion is met.
7. Stop. **Do not merge the PR** — the human is the sole merge gate.

## Rules

- Stay inside the spec's Plan and respect Out of scope. Unrelated problems
  you notice become new issues (`gh issue create`), not extra commits.
- Never push to `main`.
- Every acceptance criterion must map to a test or a demonstrated command
  in the PR description.
