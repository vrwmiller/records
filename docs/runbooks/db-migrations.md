# Database Migrations Runbook

Tool: Alembic  
Migration scripts: `migrations/versions/`  
Config: `alembic.ini` (URL sourced from environment — not hardcoded)

---

## Prerequisites

```bash
source venv/bin/activate        # activate Python environment
export DATABASE_URL="postgresql+psycopg://<user>:<pass>@<host>/<db>"
```

`DATABASE_URL` is the only variable required to run Alembic. The Cognito and other application env vars are **not** needed for migrations — `app.config` is not imported at migration time (the import is lazy inside `get_engine()`, which Alembic does not call).

In production, source `DATABASE_URL` from Secrets Manager or your deployment environment. Never commit real credentials.

---

## Check Current Migration State

```bash
alembic current
```

Shows the revision applied to the database. If output is blank, no migrations have run yet.

```bash
alembic history --verbose
```

Lists all revision history in order.

---

## Apply Pending Migrations

```bash
alembic upgrade head
```

Applies all unapplied migrations up to the current head. Safe to run repeatedly — Alembic tracks applied revisions in the `alembic_version` table.

To apply a specific revision:

```bash
alembic upgrade <revision_id>
```

---

## Roll Back Last Migration

```bash
alembic downgrade -1
```

Rolls back one revision. Each migration file's `downgrade()` function defines the rollback path.

To roll back to a specific revision:

```bash
alembic downgrade <revision_id>
```

To roll back everything (destructive — use with caution):

```bash
alembic downgrade base
```

---

## Create a New Migration

### Option A — Manual (preferred for schema changes involving constraints or custom DDL)

```bash
alembic revision -m "describe the change"
```

Edit the generated file in `migrations/versions/`. Fill in both `upgrade()` and `downgrade()`.

### Option B — Autogenerate (requires a live database at current state)

```bash
alembic revision --autogenerate -m "describe the change"
```

Alembic compares `Base.metadata` against the live DB schema. **Always review the generated file before committing** — autogenerate does not detect all constraint or index changes, and may produce incomplete or incorrect DDL.

---

## Migration Authoring Standards

- Include a docstring describing intent, rollback safety, and index rationale
- Use named constraints (`name=` arg) on all `CheckConstraint`, `ForeignKeyConstraint`, `PrimaryKeyConstraint` — avoids autogenerate noise on PostgreSQL
- Never use Alembic enum types (`sa.Enum(...)` with `create_type=True`) for `collection_type` or `status` — these are `TEXT` with `CHECK` constraints so that adding new values does not require DDL type alteration
- Prefer additive migrations; destructive changes require explicit approval
- Populate `down_revision` correctly — do not leave it as `None` unless this is truly the first revision

---

## Verify Migration File Integrity

```bash
alembic heads          # should show exactly one head unless branches exist
alembic branches       # shows divergent heads; resolve before deploying
```

---

## Production Deployment Pattern

1. Deploy new application code (do not start serving traffic yet if schema is required first)
2. Run `alembic upgrade head` against the production database
3. Verify with `alembic current` — confirm expected revision ID
4. Start or restart the application service

Rollback:

1. Roll back the application to the previous image
2. Run `alembic downgrade -1` to revert the schema change

---

## Risks and Notes

- Alembic's `alembic_version` table is created automatically on first `upgrade` run
- `DATABASE_URL` must use the `postgresql+psycopg://` driver prefix in this environment (Python 3.14, psycopg v3)
- `psycopg2-binary` is not available on Python 3.14 — do not use the `postgresql://` or `postgresql+psycopg2://` prefix
- The FK from `inventory_transaction` → `inventory_item` uses `ON DELETE RESTRICT` — physical row deletion of inventory items is not permitted; use soft-delete (`deleted_at`, `status = 'deleted'`) instead

---

## Applying Migrations Against Private RDS (VPC-Isolated Pattern)

The RDS instance is in a private subnet with `PubliclyAccessible: False`. There is no bastion host or EC2 instance. Migrations cannot be run directly from a laptop.

**Solution:** create a temporary Lambda function in the same VPC as the application Lambda, invoke it to run `alembic upgrade head`, then delete it.

### Prerequisites

- AWS CLI configured for the `records` profile.
- Lambda zip already includes the `migrations/` directory and `alembic.ini` (see lambda-redeploy.md Step 2 notes).
- Existing application Lambda configuration is used for VPC/role settings — do not hardcode these values.

### Step 1 — Retrieve Application Lambda VPC Configuration

```bash
aws lambda get-function-configuration \
  --function-name records-dev \
  --profile records \
  --region us-east-1 \
  --query 'VpcConfig'
```

Note the `SubnetIds` and `SecurityGroupIds` arrays. The migration Lambda must use the same values.

### Step 2 — Write the Migration Handler

Create `/tmp/migrate_handler.py`:

```python
import json, os, subprocess, sys

def handler(event, context):
    import boto3
    secrets = boto3.client("secretsmanager", region_name="us-east-1")

    # DB_SECRET_ID holds the secret name (not ARN) — matches the application Lambda env var
    outer = json.loads(
        secrets.get_secret_value(SecretId=os.environ["DB_SECRET_ID"])["SecretString"]
    )
    inner = json.loads(
        secrets.get_secret_value(
            SecretId=outer["master_user_secret_arn"]
        )["SecretString"]
    )

    host = outer["host"]
    port = outer.get("port", 5432)
    dbname = outer["dbname"]
    user = inner["username"]
    # AWS-generated passwords may contain '%'; escape for configparser interpolation
    password = inner["password"].replace("%", "%%")

    db_url = f"postgresql+psycopg://{user}:{password}@{host}:{port}/{dbname}"

    env = {**os.environ, "DATABASE_URL": db_url}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True, text=True, env=env
    )
    return {
        "status": "ok" if result.returncode == 0 else "error",
        "stdout": result.stdout,
        "stderr": result.stderr,
        "current_revision": result.stdout.strip().split()[-1] if result.returncode == 0 else None,
    }
```

> **Key env var name:** The application uses `DB_SECRET_ID` (not `DB_SECRET_ARN`) — confirm with `aws lambda get-function-configuration --function-name records-dev --query Environment`.
> **`%` password issue:** AWS-generated RDS passwords can contain `%` characters. Python's `configparser` (used by Alembic internally) treats `%` as an interpolation prefix and raises `InterpolationSyntaxError`. The `.replace("%", "%%")` call escapes them before the URL is passed to Alembic.

### Step 3 — Bundle the Handler into the Existing Zip

```bash
cp /tmp/migrate_handler.py /tmp/lambda-package/
REPO_ROOT=/Users/vmiller/records
cd /tmp/lambda-package && zip -r "$REPO_ROOT/migrate.zip" . && cd "$REPO_ROOT"
```

### Step 4 — Create the Temporary Migration Lambda

```bash
# Retrieve values from the application Lambda
ROLE=$(aws lambda get-function-configuration \
  --function-name records-dev --profile records --region us-east-1 \
  --query 'Role' --output text)

SUBNETS=$(aws lambda get-function-configuration \
  --function-name records-dev --profile records --region us-east-1 \
  --query 'VpcConfig.SubnetIds' --output text | tr '\t' ',')

SGS=$(aws lambda get-function-configuration \
  --function-name records-dev --profile records --region us-east-1 \
  --query 'VpcConfig.SecurityGroupIds' --output text | tr '\t' ',')

DB_SECRET=$(aws lambda get-function-configuration \
  --function-name records-dev --profile records --region us-east-1 \
  --query 'Environment.Variables.DB_SECRET_ID' --output text)

aws lambda create-function \
  --function-name records-dev-migrate-tmp \
  --runtime python3.13 \
  --handler migrate_handler.handler \
  --role "$ROLE" \
  --zip-file fileb://migrate.zip \
  --timeout 120 \
  --environment "Variables={DB_SECRET_ID=$DB_SECRET}" \
  --vpc-config "SubnetIds=$SUBNETS,SecurityGroupIds=$SGS" \
  --profile records \
  --region us-east-1
```

Wait for the function to reach `Active` state:

```bash
aws lambda get-function-configuration \
  --function-name records-dev-migrate-tmp \
  --profile records --region us-east-1 \
  --query '[State, LastUpdateStatus]'
```

### Step 5 — Invoke and Verify

```bash
aws lambda invoke \
  --function-name records-dev-migrate-tmp \
  --profile records \
  --region us-east-1 \
  /tmp/migrate-result.json

cat /tmp/migrate-result.json
```

Expected: `{"status": "ok", "current_revision": "<head-revision-id>", ...}`.

If `status` is `"error"`, check `stderr` in the result for the Alembic traceback.

### Step 6 — Clean Up

```bash
aws lambda delete-function \
  --function-name records-dev-migrate-tmp \
  --profile records \
  --region us-east-1

rm migrate.zip /tmp/migrate_handler.py /tmp/migrate-result.json
```

Delete the temporary function immediately after confirming success. Do not leave it running.
