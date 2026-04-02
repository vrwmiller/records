# User Management Runbook

Tool: AWS CLI (`aws cognito-idp`)  
User pool: set `COGNITO_USER_POOL_ID` from environment or Secrets Manager before running commands.

Record Ranch does not expose self-registration. All users are created by an administrator.

---

## Prerequisites

```bash
export COGNITO_USER_POOL_ID="<pool-id>"   # e.g. us-east-1_abc123
export AWS_PROFILE=records
export AWS_REGION=us-east-1
```

---

## Add a User

```bash
read -rs TEMP_PASSWORD
aws cognito-idp admin-create-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>" \
  --user-attributes Name=email,Value="<email>" Name=email_verified,Value=true \
  --temporary-password "$TEMP_PASSWORD" \
  --message-action SUPPRESS
unset TEMP_PASSWORD
```

> **Note:** `read -rs` prompts silently and keeps the password out of shell history and the process list.

- `--message-action SUPPRESS` skips the Cognito welcome email. Remove it if you want Cognito to send the invite automatically.
- The user will be required to set a permanent password on first sign-in.
- Passwords must meet the user pool policy: minimum 12 characters, mixed case, digits, and symbols (configured in `infra/auth.tf`).

---

## List Users

```bash
aws cognito-idp list-users \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --query 'Users[*].{Username:Username,Status:UserStatus,Enabled:Enabled}' \
  --output table
```

---

## Reset a User's Password

Force a new temporary password (user must change it on next sign-in):

```bash
read -rs NEW_PASSWORD
aws cognito-idp admin-set-user-password \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>" \
  --password "$NEW_PASSWORD" \
  --no-permanent
unset NEW_PASSWORD
```

Set a permanent password directly (bypasses change-on-first-login):

```bash
read -rs NEW_PASSWORD
aws cognito-idp admin-set-user-password \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>" \
  --password "$NEW_PASSWORD" \
  --permanent
unset NEW_PASSWORD
```

> **Note:** `read -rs` prompts silently and keeps the password out of shell history and the process list.

---

## Disable a User

Prevents the user from signing in without deleting their account or history:

```bash
aws cognito-idp admin-disable-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>"
```

Re-enable:

```bash
aws cognito-idp admin-enable-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>"
```

---

## Delete a User

Permanent — cannot be undone. Confirm the username before running.

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>"
```

---

## Sign a User Out of All Sessions

Invalidates all active tokens immediately:

```bash
aws cognito-idp admin-user-global-sign-out \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "<email>"
```

---

## Notes

- Self-registration is disabled in the UI via `hideSignUp` on the Amplify Authenticator component. Cognito user pool self-signup may also be disabled at the pool level in Terraform via `admin_create_user_config { allow_admin_create_user_only = true }` for defense in depth.
- Usernames are email addresses by default in this pool configuration.
- All user management operations are available in the AWS Console under Cognito → User pools → `<pool>` → Users, but CLI is preferred for auditability.
