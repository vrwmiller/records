---
description: "Security requirements for API, database, and integration code in Record Ranch."
applyTo: "**/*.py, **/*.sql, **/*.yaml, **/*.yml, **/*.tf, **/*.tfvars, **/*.auto.tfvars, **/*.tf.json, docs/design.md, env.sh"
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

## Terraform Security

### Forbidden Patterns

Do not write any of the following in Terraform:

- Any `password =` attribute assignment in a `.tf` file (including but not limited to database resources) — enforced by `scripts/check-terraform-secrets.sh` for `infra/*.tf`
- Any `random_password` resource in a `.tf` file (generated secrets are persisted in Terraform state) — enforced by `scripts/check-terraform-secrets.sh` for `infra/*.tf`
- `secret_string = jsonencode({...})` where the payload includes a plaintext password or token — policy rule; reviewers must enforce
- Any `aws_secretsmanager_secret_version` where `secret_string` is built such that a plaintext credential or token would be stored in Terraform state (use a managed-secret pattern instead) — policy rule; reviewers must enforce

Required pattern for RDS credentials:

- Use `manage_master_user_password = true` on `aws_db_instance`
- Reference the managed secret ARN from outputs or data sources — never construct credentials inline

### Few-Shot Examples

**Bad — credential in state:**

```hcl
resource "aws_db_instance" "main" {
  password = random_password.db.result  # persists plaintext credential in Terraform state
}
```

```hcl
resource "aws_secretsmanager_secret_version" "db" {
  secret_string = jsonencode({ password = var.db_password })  # plaintext in state
}
```

**Good — managed credential, no plaintext secret in state:**

```hcl
resource "aws_db_instance" "main" {
  manage_master_user_password = true  # AWS stores the secret; no plaintext password in Terraform state
}

output "db_secret_arn" {
  value = aws_db_instance.main.master_user_secret[0].secret_arn
}
```

### Pre-Write Constraint

Before writing any Terraform resource that handles credentials:

1. Confirm no secret value will be persisted in Terraform state.
2. If a secret value would enter state, stop and use a managed credential approach instead.

## Review Focus

Flag and block:
- injection paths
- auth bypass risks
- insecure secret handling
- data exposure risks
- plaintext credentials or tokens in Terraform state
