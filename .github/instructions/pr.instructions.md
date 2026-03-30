---
description: "Branch, commit, and pull request workflow standards for Record Ranch."
applyTo: "**"
---

# PR Workflow - Record Ranch

## Branching

- Never commit directly to main.
- Branch naming:
- feat/<topic>
- fix/<topic>
- chore/<topic>

Use lowercase and hyphen-separated words.

## Commits

- Keep commits scoped to one logical change.
- Use conventional prefixes:
- feat:
- fix:
- docs:
- chore:
- test:

## Pull Requests

- Open PRs with gh CLI.
- Use body files for multi-line PR text.
- Include:
- Summary
- Why
- Validation performed
- Risks and follow-ups

## Review Response Rules

- Validate comments against current code and docs.
- Fix valid issues in focused commits.
- Reject incorrect comments with factual, documented rationale.
- Re-run tests/lint for touched scope before final push.

## Pre-Commit

- This repo uses pre-commit with detect-secrets.
- If .secrets.baseline is updated by hook metadata changes, stage it and re-run commit.
