# Database Migrations Runbook

Tool: Alembic  
Migration scripts: `migrations/versions/`  
Config: `alembic.ini` (URL sourced from environment — not hardcoded)

---

## Prerequisites

```bash
source venv/bin/activate        # activate Python environment
export DATABASE_URL="postgresql+psycopg://<user>:<pass>@<host>/<db>"
export COGNITO_USER_POOL_ID=<pool-id>   # required by app/config.py at import time
export COGNITO_CLIENT_ID=<client-id>
```

In production, source these values from Secrets Manager or your deployment environment. Never commit real credentials.

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
