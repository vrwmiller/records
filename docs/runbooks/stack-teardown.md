# Stack Teardown Runbook

## Purpose

Define the safe, complete procedure for dismantling the Record Ranch AWS infrastructure. This runbook covers all resources provisioned by Terraform under `infra/` plus the out-of-band resources (S3 state bucket, Cognito users, DynamoDB lock table) that exist outside Terraform state.

Follow every step in order. Do not skip the pre-teardown checklist.

---

## Pre-Teardown Checklist

Complete all items before proceeding.

- [ ] **Confirm intent** — This is irreversible. All inventory data, transaction history, and image assets will be permanently deleted.
- [ ] **Take a final RDS snapshot** — Even if data recovery is not expected, a snapshot preserves the option. See the [backup-restore-drill runbook](backup-restore-drill.md) for snapshot procedure.
- [ ] **Export S3 image assets** if needed — Download any images you want to retain before the bucket is destroyed.
- [ ] **Revoke active sessions** — Sign out of the application and invalidate all active Cognito tokens if other sessions may be open.
- [ ] **Confirm AWS credentials** — Verify you are targeting the correct account and region:

  ```bash
  aws sts get-caller-identity --profile records
  ```

  Expected account: `920835814440`, region: `us-east-1`.

- [ ] **Confirm Terraform version** — Must be >= 1.10.0:

  ```bash
  terraform version
  ```

- [ ] **Confirm `terraform.tfvars`** — Must exist at `infra/terraform.tfvars`.

---

## Step 1 — Disable RDS Deletion Protection

`infra/database.tf` sets `deletion_protection = true`. Terraform destroy will fail against a protected instance.

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

Delete all users:

```bash
aws cognito-idp list-users \
  --user-pool-id "$POOL_ID" \
  --profile records \
  --query 'Users[].Username' \
  --output text \
| tr '\t' '\n' \
| while read -r username; do
  echo "Deleting user: $username"
  aws cognito-idp admin-delete-user \
    --user-pool-id "$POOL_ID" \
    --username "$username" \
    --profile records
done
```

---

## Step 5 — Empty the S3 Images Bucket

By default, Terraform will not destroy a non-empty S3 bucket. In this stack, `infra/storage.tf` does not set `force_destroy` for the images bucket, so you must empty it first (or enable `force_destroy` before running `terraform destroy`).

Delete current objects:

```bash
aws s3 rm s3://records-images-920835814440-dev --recursive --profile records
```

Delete all versioned objects and delete markers (versioning is enabled, per `infra/storage.tf`):

```python
# Save as /tmp/purge-versions.py and run: python3 /tmp/purge-versions.py
import subprocess, json

BUCKET = "records-images-920835814440-dev"
PROFILE = "records"

out = subprocess.check_output([
    "aws", "s3api", "list-object-versions",
    "--bucket", BUCKET, "--profile", PROFILE, "--output", "json"
])
data = json.loads(out)
for entry in data.get("Versions", []) + data.get("DeleteMarkers", []):
    subprocess.check_call([
        "aws", "s3api", "delete-object",
        "--bucket", BUCKET,
        "--key", entry["Key"],
        "--version-id", entry["VersionId"],
        "--profile", PROFILE
    ])
    print(f"Deleted {entry['Key']} @ {entry['VersionId']}")
```

Verify the bucket is empty:

```bash
aws s3 ls s3://records-images-920835814440-dev --profile records
```

No output means the bucket is empty and safe to destroy.

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

---

## Step 7 — Delete Terraform State Bucket

The S3 state bucket is bootstrapped outside Terraform and must be removed manually after all managed resources are destroyed.

Delete all versioned objects and delete markers, then remove the bucket:

```python
# Save as /tmp/purge-state-bucket.py and run: python3 /tmp/purge-state-bucket.py
import subprocess, json

BUCKET = "records-tfstate-920835814440-us-east-1"
PROFILE = "records"
REGION = "us-east-1"

out = subprocess.check_output([
    "aws", "s3api", "list-object-versions",
    "--bucket", BUCKET, "--profile", PROFILE, "--output", "json"
])
data = json.loads(out)
for entry in data.get("Versions", []) + data.get("DeleteMarkers", []):
    subprocess.check_call([
        "aws", "s3api", "delete-object",
        "--bucket", BUCKET,
        "--key", entry["Key"],
        "--version-id", entry["VersionId"],
        "--profile", PROFILE
    ])
    print(f"Deleted {entry['Key']} @ {entry['VersionId']}")

subprocess.check_call([
    "aws", "s3api", "delete-bucket",
    "--bucket", BUCKET,
    "--region", REGION,
    "--profile", PROFILE
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

```bash
# Remove user from group
aws iam remove-user-from-group \
  --user-name records \
  --group-name admins \
  --profile records

# Delete access keys (list first)
aws iam list-access-keys --user-name records --profile records
aws iam delete-access-key --user-name records --access-key-id <KEY_ID> --profile records

# Delete the user
aws iam delete-user --user-name records --profile records
```

> This step is irreversible and removes the AWS credentials used throughout this project. Only proceed if the entire AWS account usage for this project is ending.

---

## Post-Teardown

- [ ] Confirm no remaining resources in Step 9
- [ ] Delete or archive the local repository if the project is fully retired
- [ ] Remove `ui/.env.local` from the local machine (contains Cognito credentials)
- [ ] Remove `infra/terraform.tfvars` from the local machine (contains environment configuration)
- [ ] Archive or delete the `records` AWS CLI profile from `~/.aws/credentials` and `~/.aws/config`
