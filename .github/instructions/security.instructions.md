---
description: "Security requirements for API, database, and integration code in Record Ranch."
applyTo: "**/*.py, **/*.sql, **/*.yaml, **/*.yml, docs/design.md, env.sh"
---

# Security Standards - Record Ranch

## Secrets and Credentials

- Never commit real credentials or tokens.
- Use placeholders in checked-in env templates.
- Route runtime secrets through secure secret management.

## API Security

- Validate and sanitize all user inputs.
- Enforce authorization for state-changing routes.
- Fail closed on missing auth context.

## Data Security

- Protect sensitive metadata and user data at rest and in transit.
- Keep backups encrypted and access-scoped.
- Avoid overbroad DB privileges.

## Discogs Integration Security

- Treat external payloads as untrusted input.
- Bound retries and handle throttling safely.
- Do not execute or interpolate external strings into SQL.

## Review Focus

Flag and block:
- injection paths
- auth bypass risks
- insecure secret handling
- data exposure risks
