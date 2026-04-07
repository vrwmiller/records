# Lambda Code Redeploy Runbook

## Purpose

Rebuild and push a new Lambda deployment package when Python application code or dependencies have changed, without modifying infrastructure configuration. Use this runbook for code-only deploys — when only files under `app/`, `ui/dist/`, or `requirements.txt` have changed and no Terraform changes are required.

## Preconditions

- AWS CLI configured for the `records` profile.
- Python 3.14 venv available locally.
- `requirements.txt` is up to date.
- `ui/dist/` has been built if any frontend changes are included (see `ui/` build instructions).
- Run from the repository root.

```bash
aws sts get-caller-identity --profile records
```

Confirm account `920835814440` before proceeding.

---

## Step 1 — Install Dependencies (Linux Target)

Lambda runs on Amazon Linux. Dependencies installed on macOS will include wrong native binaries. Always build with explicit platform and Python version flags:

```bash
rm -rf /tmp/lambda-package

pip install \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.13 \
  --only-binary=:all: \
  --target /tmp/lambda-package \
  -r requirements.txt
```

> **Do not skip the platform flags.** A macOS `pip install` produces incompatible native extensions that silently fail on Lambda (import errors at runtime).

---

## Step 2 — Stage Application Files

```bash
cp -r app /tmp/lambda-package/
mkdir -p /tmp/lambda-package/ui
cp -r ui/dist /tmp/lambda-package/ui/
```

If migrations will be run via the VPC-isolated Lambda pattern (see db-migrations.md), also include:

```bash
cp -r migrations /tmp/lambda-package/
cp alembic.ini /tmp/lambda-package/
```

---

## Step 3 — Build Zip

```bash
REPO_ROOT=$(pwd)
cd /tmp/lambda-package
zip -r "$REPO_ROOT/lambda.zip" .
cd "$REPO_ROOT"
```

Expected size: ~48 MB. A significantly smaller zip (< 10 MB) suggests dependencies were omitted.

---

## Step 4 — Upload to Lambda

```bash
aws lambda update-function-code \
  --function-name records-<env> \
  --zip-file fileb://lambda.zip \
  --profile records \
  --region us-east-1
```

The response includes `CodeSize` and `State`. Wait for `State: Active` before testing. If `State` shows `Pending`, poll with:

```bash
aws lambda get-function-configuration \
  --function-name records-<env> \
  --profile records \
  --region us-east-1 \
  --query '[State, LastUpdateStatus]'
```

---

## Step 5 — Smoke Test

```bash
curl -s https://jcaqlbm9rd.execute-api.us-east-1.amazonaws.com/api/health
```

Expected response: `{"status":"ok"}`.

Check CloudWatch for errors from the first few invocations:

```bash
aws logs tail /aws/lambda/records-<env> \
  --since 5m \
  --profile records \
  --region us-east-1 \
  --filter-pattern "ERROR"
```

---

## Step 6 — Clean Up

```bash
rm lambda.zip
```

The `/tmp/lambda-package` directory can be left in place and overwritten on the next build; it is not persisted between dev machine restarts.

---

## Rollback

Lambda does not support automatic rollback of code deploys from `update-function-code`. To revert:

1. Identify the previous zip (if preserved) or check out the previous application code.
2. Rebuild via Steps 1–4.
3. Re-upload.

Alternatively, if the previous version was published as a Lambda version:

```bash
aws lambda update-function-configuration \
  --function-name records-<env> \
  --profile records \
  --region us-east-1 \
  # (set alias target to previous version number)
```

> This project does not currently use Lambda versions or aliases. Rollback requires rebuilding the previous code.
