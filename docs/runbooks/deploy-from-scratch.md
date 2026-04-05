# Deploy from Scratch — Record Ranch

## Purpose

Step-by-step procedure to deploy the full Record Ranch application stack to AWS from a clean checkout. Intended for first-time deploys and for validating the deploy process after infrastructure changes.

## Prerequisites

- AWS CLI configured with the `records` profile (`aws configure --profile records`)
- Terraform >= 1.10.0 installed
- Node 24 installed (via nvm: `. ~/.nvm/nvm.sh && nvm use`)
- Python 3.14 virtual environment (see `env.sh`)
- Repository cloned and `venv` activated

---

## 1. Initialize Terraform (first time only, or after provider changes)

```bash
terraform -chdir=infra init
```

Expected: "Terraform has been successfully initialized."

---

## 2. Build the Lambda zip package

The zip must exist before `terraform apply` — the AWS Lambda provider reads the `filename` file during apply. Build it now before provisioning infrastructure.

Install Python dependencies into a staging directory targeting the Lambda runtime platform (Linux x86_64):

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

Copy application code. On first deploy the React UI has not been built yet (Cognito IDs are not available until after `terraform apply`), so the UI is omitted here and added after apply in step 4:

```bash
cp -r app /tmp/lambda-package/

REPO_ROOT=$(pwd)
cd /tmp/lambda-package
zip -r "$REPO_ROOT/lambda.zip" .
cd "$REPO_ROOT"
```

Expected: `lambda.zip` exists at the repo root.

---

## 3. Deploy the base infrastructure

This creates networking, RDS, Cognito, S3, secrets, and the Lambda function:

```bash
terraform -chdir=infra apply
```

Capture outputs for use in later steps:

```bash
terraform -chdir=infra output -json
```

Key values (update these after each fresh deploy — do not store credentials):

| Output | Description |
| --- | --- |
| `cognito_user_pool_id` | Cognito user pool ID |
| `cognito_client_id` | Cognito app client ID |
| `lambda_function_url` | Public HTTPS URL of the deployed app |
| `image_bucket_name` | S3 bucket for record images |
| `db_secret_arn` | Secrets Manager secret for DB connection info |

---

## 4. Build and deploy the full zip (with React UI)

With Cognito outputs now available, build the React UI and rebuild the zip with UI assets included.

### 4a. Build the React UI

The Vite build bakes Cognito IDs into the JavaScript bundle at compile time:

```bash
COGNITO_USER_POOL_ID=$(terraform -chdir=infra output -raw cognito_user_pool_id)
COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw cognito_client_id)
```

```bash
cd ui
. ~/.nvm/nvm.sh
npm ci
VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" \
VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
npm run build
cd ..
```

Expected: `ui/dist/` is populated with compiled assets.

### 4b. Rebuild the zip with UI included

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
cd /tmp/lambda-package
zip -r "$REPO_ROOT/lambda.zip" .
cd "$REPO_ROOT"
```

### 4c. Push the zip to Lambda

```bash
# Set ENVIRONMENT to the Terraform environment you deployed (dev or prod)
ENVIRONMENT=dev

aws lambda update-function-code \
  --function-name "records-${ENVIRONMENT}" \
  --zip-file fileb://lambda.zip \
  --profile records --region us-east-1
```

Expected: function update confirmation with `CodeSize` in the response.

---

## 5. Run database migrations

**Migrations do not run at Lambda startup.** Before the first use, and before any deploy that includes schema changes, run migrations manually from your local machine with `DATABASE_URL` set from Secrets Manager:

```bash
# Build DATABASE_URL from the Terraform-managed Secrets Manager ARN (environment-agnostic)
DB_SECRET_ARN=$(terraform -chdir=infra output -raw db_secret_arn)
CONN=$(aws secretsmanager get-secret-value \
  --secret-id "$DB_SECRET_ARN" \
  --profile records --region us-east-1 \
  --query SecretString --output text)

HOST=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['host'])")
PORT=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['port'])")
DBNAME=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['dbname'])")
USERNAME=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['username'])")
MASTER_ARN=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['master_user_secret_arn'])")

PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$MASTER_ARN" \
  --profile records --region us-east-1 \
  --query SecretString --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")

# URL-encode credentials — AWS-generated passwords routinely contain @, :, /
ENCODED_USERNAME=$(printf '%s' "$USERNAME" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote_plus(sys.stdin.read().strip()))")
ENCODED_PASSWORD=$(printf '%s' "$PASSWORD" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote_plus(sys.stdin.read().strip()))")

export DATABASE_URL="postgresql+psycopg://${ENCODED_USERNAME}:${ENCODED_PASSWORD}@${HOST}:${PORT}/${DBNAME}"
alembic upgrade head
```

> **Note:** The RDS instance is in private subnets and is not reachable from a laptop without a VPN or SSM port-forward. See [Known Constraints](#known-constraints) below.

---

## 6. Verify the deployment

```bash
APP_URL=$(terraform -chdir=infra output -raw lambda_function_url)
curl -s "${APP_URL}api/health"
# Expected: {"status":"ok"}
```

Then open `$APP_URL` in a browser and sign in with the admin account.

---

## 7. Create the first user (if Cognito pool is new)

See [cognito-operations.md](cognito-operations.md) for creating users and adding them to the `admin` group.

For the owner account:

```bash
COGNITO_USER_POOL_ID=$(terraform -chdir=infra output -raw cognito_user_pool_id)

aws cognito-idp admin-create-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username records@hostileadmin.com \
  --user-attributes Name=email,Value=records@hostileadmin.com Name=email_verified,Value=true \
  --profile records --region us-east-1

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username records@hostileadmin.com \
  --group-name admin \
  --profile records --region us-east-1
```

---

## 8. Redeploy after code changes

1. Rebuild the zip and redeploy: run step 4 (4a, 4b, 4c).
1. If the deploy includes schema changes, run migrations (step 5) **before** step 4c.
1. If the deploy includes Terraform changes (env vars, IAM, etc.), run `terraform apply` (step 3) instead of or in addition to step 4c.

---

## Known constraints

- **Platform targeting:** The `pip install --platform manylinux2014_x86_64` flag is required when building on macOS (including Apple Silicon). Omitting it produces wheels compiled for the host OS that will fail to load on Lambda.
- **RDS is private:** The database is in private subnets and not directly reachable from a laptop. For direct DB access or to run migrations locally, an SSM port-forward to the RDS host is required.
- **Migrations are manual:** `alembic upgrade head` must be run before any deploy that introduces schema changes. Lambda does not run migrations at startup.
- **Cognito IDs baked into the UI bundle:** If the Cognito user pool or client is replaced (e.g., in a new environment), rebuild the zip (step 4) and redeploy (step 4c).
- **Cold starts:** Lambda may take 2–5 seconds to respond after a period of inactivity. For a personal single-user tool this is tolerable.
