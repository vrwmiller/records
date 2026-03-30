# Copilot Code Review Instructions - Record Ranch

## Primary Objective

Report only high-confidence, actionable issues in these categories:

- Security vulnerabilities
- Correctness bugs
- Accessibility blockers that prevent core workflow completion

If an issue does not clearly fit one of these categories, do not comment.

## Mandatory Decision Gate

Before raising an issue, all conditions must be true:

1. Category match
   - The issue is security, correctness, or blocking accessibility.

2. Concrete evidence
   - Point to specific file and line.
   - Explain execution path or failure mode.

3. Deterministic impact
   - Exploit path, runtime failure, broken core flow, or guaranteed incorrect behavior.
   - If impact is speculative, do not comment.

4. Actionable fix
   - Suggest a specific, minimal change.

If any condition fails, do not comment.

## Hard Exclusions

Do not comment on:

- Pure style or formatting
- Naming-only preferences
- Broad refactor suggestions without a demonstrated bug
- Architecture choices already documented in docs/design.md or docs/architecture.md
- Features outside PR scope

## De-duplication Rules

- Do not repeat previously raised issues.
- Do not re-flag already resolved issues unless the underlying defect still exists and passes the decision gate.

## Severity Threshold

Report only when at least one is true:

- Plausible security exploit
- Runtime crash/failure path
- Data corruption/loss risk
- User cannot complete a primary flow

If minor or non-blocking, do not comment.

## Output Format

For each issue include:

- Category
- Location (file and line)
- Problem
- Impact
- Fix

If no qualifying issues:

- No blocking issues found in scope.

## Meta Rule

Silence is preferred over low-confidence feedback.
