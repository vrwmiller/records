# SSM Parameter Management Runbook

## Purpose

Create, verify, and rotate SecureString parameters in AWS Systems Manager Parameter Store for Record Ranch. These parameters hold runtime secrets (e.g. the Discogs API token) that the Lambda function reads at invocation time. They must exist before any `terraform apply` that references them.

## Preconditions

- AWS CLI configured for the `records` profile with write permissions to SSM.
- The target environment is known (`dev` or `prod`).
- The secret value is available from its authoritative source (e.g. Discogs developer console).

```bash
aws sts get-caller-identity --profile records
```

Confirm account `920835814440` is returned before proceeding.

---

## Naming Convention

All parameters follow the pattern:

```bash
/records/<env>/<secret-name>
```

| Parameter                     | Purpose                               |
|-------------------------------|---------------------------------------|
| `/records/dev/discogs-token`  | Discogs API token for the dev Lambda  |
| `/records/prod/discogs-token` | Discogs API token for the prod Lambda |

The Terraform variable `discogs_token_ssm_name` in `infra/terraform.tfvars` must match the parameter name for the target environment. The Lambda reads the SSM name from its `DISCOGS_TOKEN_SSM_NAME` environment variable, which Terraform sets to the value of that variable.

---

## Create a Parameter (First Time)

To avoid storing the token in shell history, read it interactively:

```bash
read -rs DISCOGS_TOKEN
aws ssm put-parameter \
  --name "/records/<env>/discogs-token" \
  --value "$DISCOGS_TOKEN" \
  --type SecureString \
  --profile records
unset DISCOGS_TOKEN
```

`read -rs` reads silently (no echo) and does not add the value to shell history. `unset` clears it from the environment immediately after use.

SSM will reject the call if the parameter already exists without `--overwrite`. This is intentional — it prevents accidental overwrites during initial provisioning.

---

## Verify a Parameter Exists

Never print the raw value in shared sessions. Use character count to confirm the token is present and plausible:

```bash
aws ssm get-parameter \
  --name "/records/<env>/discogs-token" \
  --with-decryption \
  --profile records \
  --query Parameter.Value \
  --output text | wc -c
```

A valid Discogs API token is 40 characters. The `wc -c` output will be 41 (40 chars + newline). Any other count indicates a truncated or malformed value.

---

## Rotate a Parameter (Overwrite Existing)

```bash
read -rs DISCOGS_TOKEN
aws ssm put-parameter \
  --name "/records/<env>/discogs-token" \
  --value "$DISCOGS_TOKEN" \
  --type SecureString \
  --overwrite \
  --profile records
unset DISCOGS_TOKEN
```

After rotation:

1. Verify character count (see above).
2. New Lambda cold starts will fetch the rotated token from SSM. However, warm Lambda runtimes cache the resolved token for the lifetime of that runtime (`_ssm_token_cache` in `app/services/discogs.py`) — they will continue using the old token until a cold start occurs. To force immediate pickup, trigger a Lambda redeploy (see lambda-redeploy.md) or any configuration change that replaces existing runtimes.
3. Confirm the old token has been revoked in the Discogs developer console **only after** confirming the new token is in use — revoking while warm runtimes hold the old token will cause Discogs API failures.

---

## Relationship to Terraform

The parameter name in SSM and the value of `discogs_token_ssm_name` in `infra/terraform.tfvars` must match. Terraform does not create the SSM parameter itself — it only writes the parameter name into the Lambda environment variable. If the parameter does not exist at deploy time, the Lambda will fail at invocation with a `ParameterNotFound` error.

**Required sequence when provisioning a new environment:**

1. Create the SSM parameter (`aws ssm put-parameter`).
2. Set `discogs_token_ssm_name` in `terraform.tfvars`.
3. Run `terraform apply`.

---

## Rollback

- If the new token is invalid, rotate again using the previous known-good token.
- If neither token is available, revoke and regenerate from the Discogs developer console, then create/overwrite the SSM parameter.

## Security Rules

- Never log or print the raw token value.
- Never store the token value in source control, `.env` files, or shell history. Use `read -rs` to read the token interactively, as shown above.
- Use `--with-decryption` only when the retrieved value is immediately consumed — do not pass decrypted output to logs.
