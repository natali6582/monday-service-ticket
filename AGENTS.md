# Repository Agent Instructions

You are a coding agent working in this repository. Follow these rules on every task.

## Core Rules

1. Plan first, no code.
   - Before writing or changing files, state the steps, files to touch, inputs, expected outputs, assumptions, and definition of done.
   - Wait for explicit approval before implementing.

2. Work in small steps.
   - Break every task into the smallest meaningful steps.
   - Execute only the approved current step and report evidence before moving on.

3. Preserve source state.
   - Make a copy or backup before changing any existing source file.
   - Do not overwrite source files blindly.
   - Do not revert user changes unless the user explicitly asks.

4. Challenge assumptions.
   - Do not agree blindly with proposed solutions.
   - Surface conflicting evidence, risks, and better alternatives when relevant.

5. Lock scope.
   - Change only what was requested.
   - If you notice unrelated issues, list them as "found, not fixed".

6. Verify every change.
   - Run a check that proves the change worked.
   - Report evidence, such as tests, syntax checks, diffs, hashes, counts, or live verification.
   - A claim without proof is not done.

7. Keep secrets out of source control.
   - Never commit API tokens, OAuth tokens, passwords, or private keys.
   - Monday API credentials must stay in Wix Secrets Manager under `MONDAY_API_KEY`.
   - It is acceptable to commit the secret name, but not the secret value.

8. Avoid hidden state.
   - Scripts should be reproducible from explicit inputs.
   - Avoid mutable globals, stale caches, appending unintentionally, and one-off manual fixes.
   - If a script creates outputs, use a fresh output directory or clear the output path intentionally.

9. Integrate changes into the main path.
   - Requested logic must be wired into the real workflow, not left as a one-off patch or side script.
   - If a request cannot apply uniformly, explain the tradeoff before implementing.

10. Keep GitHub updates narrow.
    - Inspect `git status --short --branch` before staging.
    - Stage only intended files.
    - Do not use broad staging such as `git add -A` when unrelated files are present.

## Python TDD Rule

If Python code is added to this repository, use strict TDD unless the change is a trivial text typo:

1. RED: write a meaningful behavior test first and confirm it fails for the right reason.
2. GREEN: implement the minimum code needed to pass.
3. REFACTOR: clean up while keeping tests green.
4. Run relevant tests, then the full test suite.

Tests must validate behavior, not source-code text or shallow existence checks.

Recommended commands for Python projects:

```bash
py -m pytest tests
py -m pytest tests/<file>.py -q
```

## This Repository

This repository stores Wix Velo automation code for creating Monday.com service-ticket items from Wix form submissions.

Important files:

- `monday_ticket.js` - current Wix automation action code.
- `backups/` - timestamped code snapshots.
- `README.md` - operational notes and runtime contract.

Before changing `monday_ticket.js`, copy the previous version into `backups/` with a timestamped filename.
