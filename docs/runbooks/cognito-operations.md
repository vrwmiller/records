# Cognito Operations Runbook

## Purpose

Document baseline Cognito operational tasks for user access management.

## Common Tasks

- Create user or invite user into the pool.
- Reset user password.
- Recover locked account.
- Validate MFA enrollment status.

## User Bootstrap Checklist

1. Confirm user should have access.
2. Create or invite user in the correct user pool.
3. Require password reset on first login if applicable.
4. Verify email attribute and verification state.

## MFA Troubleshooting

- If software token MFA fails, verify device clock and code window.
- Re-bind software token only after identity verification.
- Record MFA reset actions in operational notes.

## Lockout and Recovery

1. Validate reason for lockout.
2. Perform admin unlock/reset per policy.
3. Require re-authentication and credential refresh.
4. Confirm successful login after remediation.

## Security Guardrails

- Do not disable auth protections as a convenience shortcut.
- Fail closed on ambiguous user identity or authorization context.
