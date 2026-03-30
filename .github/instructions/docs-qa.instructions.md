---
description: "Combined documentation, lint, and test standards for Record Ranch."
applyTo: "docs/**/*.md, **/*.md, tests/**/*.py, **/*test*.py"
---

# Docs and QA Standards - Record Ranch

## Documentation Responsibilities

- Keep proposal, architecture, and design docs consistent.
- Architecture doc stays high-level.
- Design doc carries concrete implementation details.
- When behavior changes, update docs in the same change set.

## Test Responsibilities

- Add or update tests for behavioral changes.
- Validate critical flows:
- acquire
- transfer
- sell
- collection filtering
- For executable behavior changes where a unit test is reasonably possible, require the test in the same PR.
- If such a test is missing, treat it as a blocking finding.
- Deferral is allowed only with explicit rationale and a linked follow-up issue.
- Pure docs/process/license-only changes are exempt from the unit test requirement.

## Lint and Quality Gate

- Ensure markdown and code formatting are clean.
- Resolve broken links, stale references, and contradictory statements.
- Reject vague claims in docs that are not reflected in implementation.
- Treat lint and unit test checks as mandatory review criteria for touched scope.
- If lint or unit test targets are missing for touched scope, report that absence explicitly as a finding/testing gap.

## Review Output

- Report findings by severity.
- Include file and line references.
- If no findings, state that explicitly and note residual risks.
- Always include gate status for touched scope: lint `passed|failed|not-available` and tests `passed|failed|not-available`.
