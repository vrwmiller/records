# Terraform Workflow Runbook

## Purpose

Define the standard Terraform workflow for Record Ranch infrastructure changes.

## Preconditions

Run all `terraform` commands from the `infra/` directory. These must be satisfied before `terraform init`:

1. **AWS credentials** — Confirm the target profile is active and points to the correct account:

   ```bash
   aws sts get-caller-identity --profile records
   ```

2. **S3 state bucket** — Verify it exists:

   ```bash
   aws s3api head-bucket --bucket records-tfstate-920835814440-us-east-1 --profile records
   ```

   If missing, create it (see the bootstrap section of the project README).

3. **`terraform.tfvars`** — Must exist at `infra/terraform.tfvars`. Copy from `infra/terraform.tfvars.example` and fill in values. This file is gitignored and must not be committed.

4. **Terraform version** — Must satisfy the constraint in `infra/main.tf` (`>= 1.0`). Run `terraform version` to confirm.

## Standard Workflow

All commands run from `infra/`:

1. Initialize backend and providers:

   ```bash
   terraform init
   ```

   If backend configuration has changed since last init, use `-reconfigure`:

   ```bash
   terraform init -reconfigure
   ```

2. Format and validate:

   ```bash
   terraform fmt
   terraform validate
   ```

3. Review plan:

   ```bash
   terraform plan -out /tmp/records.tfplan
   ```

   - Store plan artifacts outside the repository tree.
   - Never commit Terraform plan artifacts; they may contain sensitive values.

4. Apply reviewed plan:

   ```bash
   terraform apply /tmp/records.tfplan
   ```

   RDS instance creation typically takes 10–20 minutes.

5. Clean up plan artifact after apply:

   ```bash
   rm /tmp/records.tfplan
   ```

## State Backend Expectations

- Backend uses S3 for remote state.
- State bucket is versioned and encrypted.
- State location is environment-scoped by key naming convention.
- State locking uses S3 native locking (`use_lockfile = true`), which stores a `.tflock` object alongside the state file. DynamoDB-based locking is deprecated as of Terraform 1.10 and is no longer used by this project.

## Change Safety Rules

- Never apply unreviewed changes directly to production environments.
- Treat replacement of stateful resources (for example RDS) as high risk.
- If `terraform plan` includes unexpected destroy actions, stop and investigate.

## Drift and Recovery

- If backend or provider settings change, run `terraform init -reconfigure`.
- For state drift investigations, use `terraform plan` first before any imports or state edits.
- Perform manual state operations only with explicit review and rollback notes.

## Interrupted Apply Recovery

If `terraform apply` is interrupted mid-run:

1. **Release the stuck state lock.** The lock ID is shown in the error message when you next run any Terraform command:

   ```bash
   terraform force-unlock -force <LOCK-ID>
   ```

2. **Re-plan to identify drift** between Terraform state and actual AWS resources:

   ```bash
   terraform plan
   ```

   Resources that exist in AWS but not in state will appear as `will be created`. Resources that exist in state but not in AWS will appear as `will be destroyed`.

3. **Import orphaned resources** rather than recreating them. Use the format required by each resource type. Common examples:

   ```bash
   # RDS instance
   terraform import aws_db_instance.main <db-instance-identifier>

   # Route table
   terraform import aws_route_table.private <rtb-id>

   # Route table association (subnet-id/rtb-id format)
   terraform import 'aws_route_table_association.private[0]' <subnet-id>/<rtb-id>
   ```

4. **Re-plan after imports** to confirm state is clean (no unexpected creates/destroys), then apply:

   ```bash
   terraform plan -out /tmp/records.tfplan
   terraform apply /tmp/records.tfplan
   rm /tmp/records.tfplan
   ```
