# Secrets Rotation Runbook

## Purpose

Define a safe process for rotating database credentials stored in Secrets Manager.

## Preconditions

- Confirm maintenance window and impact tolerance.
- Confirm rollback plan and owner on-call availability.

## Rotation Procedure

1. Generate new credential material via approved secret workflow.
2. Update the database credential to use the new password.
3. Update the secret value in Secrets Manager to match the database credential.
4. Restart or refresh dependent app runtime sessions.
5. Validate connectivity with least-privilege app path.

> **Order matters:** Always update the database credential before updating Secrets Manager. This ensures any runtime credential refresh observes a valid, in-sync credential pair and avoids an authentication failure window.

## Post-Rotation Validation

- App can read/write required inventory paths.
- Legacy credential no longer authenticates.
- Error logs show no auth failures after cutover.

## Rollback

- If failures occur, restore last known-good credential pair and re-validate.
- Record incident details and schedule follow-up remediation.

## Security Rules

- Never paste raw credentials into tickets, docs, or source control.
- Limit secret update permissions to least-privilege operators.
