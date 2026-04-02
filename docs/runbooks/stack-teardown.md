# Stack Teardown Runbook

## Purpose

Define the safe, complete procedure for dismantling the Record Ranch AWS infrastructure. This runbook covers all resources provisioned by Terraform under `infra/` plus the out-of-band resources (S3 state bucket, Cognito users, DynamoDB lock table) that exist outside Terraform state.

Follow every step in order. Do not skip the pre-teardown checklist.

---

## Pre-Teardown Checklist

Complete all items before proceeding.

- [ ] **Confirm intent** — This is irreversible. All inventory data, transaction history, and image assets will be permanently deleted.
- [ ] **Take a manual pre-teardown RDS snapshot** — This is an operator-initiated snapshot taken before starting teardown, and is separate from the destroy-time final snapshot controlled by Terraform's `skip_final_snapshot` setting (see Step 2). Even if data recovery is not expected, this manual snapshot preserves the option. See the [backup-restore-drill runbook](backup-restore-drill.md) for snapshot procedure.
- [ ] **Export S3 image assets** if needed — Download any images you want to retain before the bucket is destroyed.
- [ ] **Revoke active sessions** — Sign out of the application and invalidate all active Cognito tokens if other sessions may be open.
- [ ] **Confirm AWS account and region** — Verify you are targeting the correct account and region:

  ```bash
  aws sts get-caller-identity --profile records
  aws configure get region --profile records
  ```

  Expected account: `920835814440`.
  Expected region:  `us-east-1`.

- [ ] **Confirm Terraform version** — Must be >= 1.10.0:

  ```bash
  terraform version
  ```

- [ ] **Confirm `terraform.tfvars`** — Must exist at `infra/terraform.tfvars`.

---

## Step 1 — Disable RDS Deletion Protection

`infra/database.tf` sets `deletion_protection = true`. Terraform destroy will fail against a protected instance.

> **Important:** Steps 1–3 require editing local Terraform files before applying. These are teardown-only changes — **do not commit or push them**. They exist only to clear AWS safeguards so the destroy can proceed.

Disable it by editing the Terraform config:

```bash
# In infra/database.tf, change:
#   deletion_protection = true
# to:
#   deletion_protection = false
```

Then apply the change in isolation:

```bash
cd infra
terraform init
terraform apply -target=aws_db_instance.main
```

Confirm the apply completes and deletion protection is off before continuing.

---

## Step 2 — Allow Final Snapshot or Skip It

`infra/database.tf` sets `skip_final_snapshot = false`, which means Terraform destroy will attempt to create a final snapshot named by `final_snapshot_identifier`. Terraform destroy will wait for this snapshot to complete (typically 10–20 minutes for the dev instance size).

If you want the final snapshot (recommended):

- Proceed to Step 3 as-is. The snapshot will be created and retained in RDS. You must manually delete it afterward if you want nothing left in the account.

If you want to skip the snapshot entirely:

```bash
# In infra/database.tf, change:
#   skip_final_snapshot = false
# to:
#   skip_final_snapshot = true
```

Apply the change:

```bash
cd infra
terraform init
terraform apply -target=aws_db_instance.main
```

---

## Step 3 — Disable Cognito User Pool Deletion Protection

`infra/auth.tf` sets `deletion_protection = "ACTIVE"` on the `aws_cognito_user_pool.main` resource. Terraform destroy will fail with an `InvalidParameterException` unless this is cleared first.

Edit the Terraform config:

```bash
# In infra/auth.tf, change:
#   deletion_protection = "ACTIVE"
# to:
#   deletion_protection = "INACTIVE"
```

Apply the change:

```bash
cd infra
terraform init
terraform apply -target=aws_cognito_user_pool.main
```

Confirm the apply completes before continuing.

---

## Step 4 — Delete Cognito Users (Optional Pre-Destroy Audit)

Terraform will destroy the Cognito user pool (and all users within it) as part of Step 6. This step is optional but recommended for auditability — it produces an explicit record of which users were deleted before the pool is removed.

Get the pool ID from Terraform state:

```bash
cd infra
POOL_ID=$(terraform output -raw cognito_user_pool_id)
```

Delete all users (paginated — loops until all users are deleted):

```python
# Save as /tmp/delete-cognito-users.py and run:
#   POOL_ID=<pool-id> python3 /tmp/delete-cognito-users.py
import os, subprocess, json

POOL_ID = os.environ["POOL_ID"]
PROFILE = "records"
REGION = "us-east-1"

pagination_token = None

while True:
    cmd = [
        "aws", "cognito-idp", "list-users",
        "--user-pool-id", POOL_ID,
        "--region", REGION,
        "--profile", PROFILE,
        "--output", "json",
    ]
    if pagination_token:
        cmd.extend(["--pagination-token", pagination_token])

    data = json.loads(subprocess.check_output(cmd))
    for user in data.get("Users", []):
        username = user["Username"]
        print(f"Deleting user: {username}")
        subprocess.check_call([
            "aws", "cognito-idp", "admin-delete-user",
            "--user-pool-id", POOL_ID,
            "--username", username,
            "--region", REGION,
            "--profile", PROFILE,
        ])

    pagination_token = data.get("PaginationToken")
    if not pagination_token:
        break
```

Run it:

```bash
POOL_ID=$POOL_ID python3 /tmp/delete-cognito-users.py
```

---

## Step 5 — Empty the S3 Images Bucket

By default, Terraform will not destroy a non-empty S3 bucket. In this stack, `infra/storage.tf` does not set `force_destroy` for the images bucket, so you must empty it first (or enable `force_destroy` before running `terraform destroy`).

Get the bucket name from Terraform state:

```bash
cd infra
BUCKET=$(terraform output -raw image_bucket_name)
echo "Bucket: $BUCKET"
```

Delete current objects:

```bash
aws s3 rm "s3://${BUCKET}" --recursive --profile records
```

Delete all versioned objects and delete markers (versioning is enabled, per `infra/storage.tf`):

```python
# Save as /tmp/purge-versions.py and run: BUCKET=<name> python3 /tmp/purge-versions.py
import subprocess, json, os

BUCKET = os.environ["BUCKET"]
PROFILE = "records"

key_marker = None
version_id_marker = None

while True:
    cmd = [
        "aws", "s3api", "list-object-versions",
        "--bucket", BUCKET, "--profile", PROFILE, "--output", "json",
    ]
    if key_marker is not None:
        cmd.extend(["--key-marker", key_marker])
    if version_id_marker is not None:
        cmd.extend(["--version-id-marker", version_id_marker])

    data = json.loads(subprocess.check_output(cmd))
    for entry in data.get("Versions", []) + data.get("DeleteMarkers", []):
        subprocess.check_call([
            "aws", "s3api", "delete-object",
            "--bucket", BUCKET,
            "--key", entry["Key"],
            "--version-id", entry["VersionId"],
            "--profile", PROFILE,
        ])
        print(f"Deleted {entry['Key']} @ {entry['VersionId']}")

    if not data.get("IsTruncated"):
        break

    key_marker = data.get("NextKeyMarker")
    version_id_marker = data.get("NextVersionIdMarker")
    if not key_marker and not version_id_marker:
        print("Listing truncated but continuation markers missing; stopping early.")
        break
```

Run it:

```bash
BUCKET=$BUCKET python3 /tmp/purge-versions.py
```

Verify no versions or delete markers remain:

```bash
aws s3api list-object-versions \
  --bucket "${BUCKET}" \
  --profile records \
  --query '{Versions: Versions, DeleteMarkers: DeleteMarkers}'
```

Both `Versions` and `DeleteMarkers` should be `null` or absent. If any entries remain, re-run the purge script.

---

## Step 6 — Run Terraform Destroy

All commands run from `infra/`:

```bash
cd infra
terraform init
terraform plan -destroy -out /tmp/records-destroy.tfplan
```

Review the plan carefully — confirm it lists only resources in this account and environment. Then apply:

```bash
terraform apply /tmp/records-destroy.tfplan
```

The destroy will take 15–30 minutes. RDS deletion is the longest step. If a final snapshot was requested (Step 2), Terraform will wait for it to complete before proceeding.

Expected output on success:

```
Destroy complete! Resources: N destroyed.
```

Immediately after destroy completes, revert the teardown-only Terraform edits made in Steps 1–3:

```bash
cd infra
git restore database.tf auth.tf
```

This prevents an accidental `terraform apply` from re-creating the stack with protections disabled.

## Step 7 — Clean Up Terraform State (Key-Only or Full Bucket)

The S3 state bucket is bootstrapped outside Terraform and must be removed manually after all managed resources are destroyed.

> **Important:** This bucket is designed to be shared across multiple environments using distinct backend keys (see comments in `infra/main.tf`). **Only delete the entire bucket** if you have confirmed that no other environment state keys remain inside it (i.e., this account is being fully decommissioned). If other environments still exist or may be added in the future, delete only the objects under this environment's backend key and its version history, rather than deleting the bucket.
>
> Before running the key-only script, confirm the exact backend key used for this environment. The default dev key is `records/terraform.tfstate`; other environments override it at `terraform init` time (e.g., `-backend-config="key=records/prod/terraform.tfstate"`). Export the **full, exact backend key** into `TF_STATE_KEY` before running. The script passes this value to the S3 `list-object-versions` `--prefix` filter for efficiency, but then checks each returned object key for an **exact match** before deleting — so only the precise state file key is affected.

**If other environments still exist — single-key cleanup:**

```python
# Save as /tmp/purge-state-key.py and run:
#   TF_STATE_KEY="records/<env>/terraform.tfstate" python3 /tmp/purge-state-key.py
# Deletes all versions of the exact state object key and its corresponding .tflock key
# (created by use_lockfile = true). --prefix narrows the API query but an exact equality
# check in the loop prevents adjacent objects from being deleted.
import os, subprocess, json

BUCKET = "records-tfstate-920835814440-us-east-1"
PROFILE = "records"
KEY = os.environ.get("TF_STATE_KEY")

if not KEY:
    raise SystemExit(
        "TF_STATE_KEY is not set. Set it to the exact Terraform backend key "
        "for this environment (e.g., 'records/terraform.tfstate' for dev, "
        "'records/prod/terraform.tfstate' for prod) before running."
    )

LOCKFILE_KEY = KEY + ".tflock"
TARGET_KEYS = {KEY, LOCKFILE_KEY}

for target_key in sorted(TARGET_KEYS):
    key_marker = None
    version_id_marker = None

    while True:
        cmd = [
            "aws", "s3api", "list-object-versions",
            "--bucket", BUCKET, "--profile", PROFILE, "--output", "json",
            "--prefix", target_key,
        ]
        if key_marker is not None:
            cmd.extend(["--key-marker", key_marker])
        if version_id_marker is not None:
            cmd.extend(["--version-id-marker", version_id_marker])

        data = json.loads(subprocess.check_output(cmd))
        for entry in data.get("Versions", []) + data.get("DeleteMarkers", []):
            if entry["Key"] != target_key:
                print(f"Skipping non-matching key: {entry['Key']}")
                continue
            subprocess.check_call([
                "aws", "s3api", "delete-object",
                "--bucket", BUCKET,
                "--key", entry["Key"],
                "--version-id", entry["VersionId"],
                "--profile", PROFILE,
            ])
            print(f"Deleted {entry['Key']} @ {entry['VersionId']}")

        if not data.get("IsTruncated"):
            break

        key_marker = data.get("NextKeyMarker")
        version_id_marker = data.get("NextVersionIdMarker")
        if not key_marker and not version_id_marker:
            print("Listing truncated but continuation markers missing; stopping early.")
            break
```

**If fully decommissioning — delete all versions then remove the bucket:**

```python
# Save as /tmp/purge-state-bucket.py and run: python3 /tmp/purge-state-bucket.py
import subprocess, json

BUCKET = "records-tfstate-920835814440-us-east-1"
PROFILE = "records"
REGION = "us-east-1"

key_marker = None
version_id_marker = None

while True:
    cmd = [
        "aws", "s3api", "list-object-versions",
        "--bucket", BUCKET, "--profile", PROFILE, "--output", "json",
    ]
    if key_marker is not None:
        cmd.extend(["--key-marker", key_marker])
    if version_id_marker is not None:
        cmd.extend(["--version-id-marker", version_id_marker])

    data = json.loads(subprocess.check_output(cmd))
    for entry in data.get("Versions", []) + data.get("DeleteMarkers", []):
        subprocess.check_call([
            "aws", "s3api", "delete-object",
            "--bucket", BUCKET,
            "--key", entry["Key"],
            "--version-id", entry["VersionId"],
            "--profile", PROFILE,
        ])
        print(f"Deleted {entry['Key']} @ {entry['VersionId']}")

    if not data.get("IsTruncated"):
        break

    key_marker = data.get("NextKeyMarker")
    version_id_marker = data.get("NextVersionIdMarker")
    if not key_marker and not version_id_marker:
        print("Listing truncated but continuation markers missing; stopping early.")
        break

subprocess.check_call([
    "aws", "s3api", "delete-bucket",
    "--bucket", BUCKET,
    "--region", REGION,
    "--profile", PROFILE,
])
print(f"Bucket {BUCKET} deleted.")
```

---

## Step 8 — Delete the DynamoDB Lock Table (If Present)

A DynamoDB table `records-tfstate-lock` was provisioned during the original bootstrap phase. It is no longer used for locking (S3 native locking replaced it in PR #16) but may still exist in the account.

Check:

```bash
aws dynamodb describe-table \
  --table-name records-tfstate-lock \
  --profile records \
  --region us-east-1 \
  --query 'Table.TableStatus' \
  --output text 2>&1
```

If the table exists (output is `ACTIVE`), delete it:

```bash
aws dynamodb delete-table \
  --table-name records-tfstate-lock \
  --profile records \
  --region us-east-1
```

---

## Step 9 — Verify No Remaining Resources

Spot-check that no billable resources remain:

```bash
# RDS instances
aws rds describe-db-instances \
  --profile records --region us-east-1 \
  --query 'DBInstances[?contains(DBInstanceIdentifier, `records`)].{ID:DBInstanceIdentifier,Status:DBInstanceStatus}' \
  --output table

# VPCs
aws ec2 describe-vpcs \
  --profile records --region us-east-1 \
  --filters 'Name=tag:Project,Values=records' \
  --query 'Vpcs[].VpcId' \
  --output text

# Secrets Manager
aws secretsmanager list-secrets \
  --profile records --region us-east-1 \
  --filters 'Key=name,Values=records/' \
  --query 'SecretList[].Name' \
  --output text

# S3 buckets
aws s3 ls --profile records | grep records
```

All queries should return empty results. If any resources remain, investigate and remove manually using the AWS Console or CLI.

---

## Step 10 — Revoke AWS IAM Access (Optional)

If the `records` IAM user and `admins` group are no longer needed:

> **Important:** Use an administrator credential that is **not** backed by the `records` IAM user (for example, the root account or a separate admin profile). Using the `records` profile to delete its own access key will revoke your credentials mid-step and can leave cleanup incomplete. Also note that `aws iam delete-user` will fail if the user still has attached policies, inline policies, or MFA devices — resolve those first.

```bash
# Remove user from group (use a separate admin profile, not 'records')
aws iam remove-user-from-group \
  --user-name records \
  --group-name admins \
  --profile <admin-profile>

# List and delete all access keys
aws iam list-access-keys --user-name records --profile <admin-profile>
aws iam delete-access-key --user-name records --access-key-id <KEY_ID> --profile <admin-profile>

# Delete the user
aws iam delete-user --user-name records --profile <admin-profile>
```

> This step is irreversible and removes the AWS credentials used throughout this project. Only proceed if the entire AWS account usage for this project is ending.

---

## Post-Teardown

- [ ] Confirm no remaining resources in Step 9
- [ ] Delete or archive the local repository if the project is fully retired
- [ ] Remove `ui/.env.local` from the local machine (contains Cognito configuration / IDs)
- [ ] Remove `infra/terraform.tfvars` from the local machine (contains environment configuration)
- [ ] Archive or delete the `records` AWS CLI profile from `~/.aws/credentials` and `~/.aws/config`
