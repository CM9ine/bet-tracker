# Goal: Triage an issue into a spec

You are given a GitHub issue that is probably vague ("settlement looks wrong",
"add each-way bets"). Your job is **not** to fix it. Your job is to interview
the human, then post a spec comment on the issue that a different agent can
implement without asking anything.

## Steps

1. Read the issue and all comments: `gh issue view <number> --comments`.
2. Read the relevant code (`src/`) and tests (`test/`) so your questions are
   informed, not generic.
3. **Interview the human.** Ask about anything ambiguous: expected behaviour,
   concrete examples with numbers, edge cases (void bets, rounding direction,
   zero stakes), what's explicitly out of scope. Prefer a few sharp questions
   with proposed defaults ("I'd round returns down to the penny — OK?") over
   an open-ended questionnaire. Continue until you could write the spec with
   no guesses.
4. Post the spec as an issue comment via
   `gh issue comment <number> --body-file <spec.md>`. When — and only when —
   the human explicitly approves the spec in conversation, relabel the issue:
   `gh issue edit <number> --remove-label triage --add-label ready`.
   Never relabel without explicit approval.

## Spec format

The audience is an implementing agent, not the human — be precise, use file
paths, function names, runnable commands, and concrete numbers. Sections, in
order:

- **Problem** — what is wrong or missing, in one or two sentences.
- **Root cause** — for bugs: the offending code, cited as `path:line`.
  For features: why the current code can't do this.
- **Repro** — exact commands or requests that demonstrate the problem, with
  observed vs expected output. For features: a demonstration of the gap.
- **Plan** — ordered implementation steps naming the files to touch and
  tests to add. Settlement changes must specify the table-driven test cases
  (see STANDARDS.md).
- **Acceptance criteria** — checklist of verifiable statements, each testable
  by a command or a test case with concrete values (integer pence, odds as
  integer hundredths — e.g. stake `1000`, odds `250`, return `2500`).
- **Out of scope** — what the implementer must not touch, based on what the
  human said.

## Rules

- Do not write implementation code during triage.
- Do not post the spec while questions remain unanswered — stop and ask.
- Amounts in specs are integer pence; odds are integer hundredths
  (STANDARDS.md).
