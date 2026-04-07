# Routine Deploy Runbook

## Purpose

Define the authoritative sequence for deploying incremental changes to Record Ranch. Not every deploy requires all steps — use the decision tree below to identify which phases apply, then execute only those phases in order.

## Preconditions

- AWS CLI configured for the `records` profile (account `920835814440`, region `us-east-1`).
- Active Python virtual environment: `source venv/bin/activate`.
- Run all commands from the repository root unless a step specifies otherwise.

```bash
aws sts get-caller-identity --profile records
```

Confirm account `920835814440` before proceeding.

---

## Decision Tree — What to Run

| What changed?                                                     | Phases required (in order)        |
|-------------------------------------------------------------------|-----------------------------------|
| SSM parameter needs to be created or rotated                      | Phase 1 only                      |
| Terraform configuration changed (`.tf` files, `terraform.tfvars`) | Phase 1 (if SSM needed) → Phase 2 |
| Python code or dependencies changed (`app/`, `requirements.txt`)  | Phase 3                           |
| Frontend changed (`ui/`)                                          | Phase 3 (rebuild ui first)        |
| New Alembic migration added                                       | Phase 4                           |
| Any code change                                                   | Phase 5 (always)                  |

Phases are independent unless a cross-dependency is noted. Run them in numeric order when multiple phases apply.

---

## Phase 1 — SSM Parameters

Required when: a new SSM parameter must exist before `terraform apply`, or a token has been rotated.

Follow **ssm-parameters.md** for full steps. Summary:

```bash
# First-time create
aws ssm put-parameter \
  --name "/records/<env>/discogs-token" \
  --value "<token>" \
  --type SecureString \
  --profile records

# Verify (character count only — never print raw value)
aws ssm get-parameter \
  --name "/records/<env>/discogs-token" \
  --with-decryption \
  --profile records \
  --query Parameter.Value \
  --output text | wc -c
```

A Discogs token is 40 characters; `wc -c` output should be 41 (includes trailing newline).

---

## Phase 2 — Terraform Apply

Required when: `.tf` files or `infra/terraform.tfvars` changed.

Follow **terraform-workflow.md** for full steps. Summary:

```bash
cd infra/

terraform init          # only needed if providers or backend config changed
terraform fmt
terraform validate

terraform plan -out /tmp/records.tfplan
# Review: confirm no unexpected destroy actions before applying
terraform apply /tmp/records.tfplan
rm /tmp/records.tfplan

cd ..
```

> If `terraform plan` shows resource replacement for RDS or Lambda, stop. Replacement of stateful resources requires explicit review.

---

## Phase 3 — Lambda Code Redeploy

Required when: `app/`, `ui/dist/`, or `requirements.txt` changed.

Follow **lambda-redeploy.md** for full steps. Summary:

```bash
rm -rf /tmp/lambda-package

pip install \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.13 \
  --only-binary=:all: \
  --target /tmp/lambda-package \
  -r requirements.txt

cp -r app /tmp/lambda-package/
mkdir -p /tmp/lambda-package/ui
cp -r ui/dist /tmp/lambda-package/ui/

REPO_ROOT=$(pwd)
cd /tmp/lambda-package && zip -r "$REPO_ROOT/lambda.zip" . && cd "$REPO_ROOT"

aws lambda update-function-code \
  --function-name records-<env> \
  --zip-file fileb://lambda.zip \
  --profile records \
  --region us-east-1

rm lambda.zip
```

> If new Alembic migrations are also being deployed (Phase 4), include `migrations/` and `alembic.ini` in the zip before zipping. See lambda-redeploy.md Step 2.

---

## Phase 4 — Database Migrations

Required when: new Alembic migration files are present in `migrations/versions/` that have not been applied to the target database.

The RDS instance is not publicly accessible. Migrations cannot be run from a laptop. Follow the **VPC-Isolated Pattern** section in **db-migrations.md**.

High-level sequence:

1. Rebuild the Lambda zip including `migrations/` and `alembic.ini` (if not already done in Phase 3).
2. Create a temporary migration Lambda in the app VPC using the same role/subnets/security groups.
3. Invoke the migration Lambda and confirm `status: ok` and the expected `current_revision`.
4. Delete the temporary Lambda and clean up artifacts.

---

## Phase 5 — Smoke Test

Required after any deploy.

```bash
# Health check
curl -s https://jcaqlbm9rd.execute-api.us-east-1.amazonaws.com/api/health
```

Expected response: `{"status":"ok"}`.

```bash
# Inventory endpoint (expect 401 Unauthorized — confirms app is running and DB is reachable)
curl -s -o /dev/null -w "%{http_code}" \
  https://jcaqlbm9rd.execute-api.us-east-1.amazonaws.com/api/inventory
```

Expected: `401`. A `500` indicates a database or application error.

```bash
# CloudWatch error scan (last 10 minutes)
aws logs tail /aws/lambda/records-<env> \
  --since 10m \
  --profile records \
  --region us-east-1 \
  --filter-pattern "ERROR"
```

No output is the expected result. Any ERROR lines require investigation before considering the deploy successful.

---

## Rollback

| Phase                 | Rollback action                                                |
|-----------------------|----------------------------------------------------------------|
| Phase 1 (SSM)         | Rotate back to previous token value using `--overwrite`        |
| Phase 2 (Terraform)   | Revert `.tf` changes, re-plan, re-apply                        |
| Phase 3 (Lambda code) | Rebuild from previous git revision and re-upload               |
| Phase 4 (Migrations)  | Run `alembic downgrade -1` via the VPC-isolated Lambda pattern |

> There is no automatic rollback mechanism. Each phase requires manual reversal. Always confirm the previous known-good state before beginning a rollback.
