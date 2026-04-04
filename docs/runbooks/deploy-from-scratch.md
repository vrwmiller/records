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

## 2. Deploy the base infrastructure

This creates networking, RDS, Cognito, S3, and secrets. Lambda is provisioned here too — the zip must exist before apply (build it in step 3 first on a first deploy).

> **On first deploy:** build the Lambda zip package (step 3) before running `terraform apply`. The `filename` in `lambda.tf` references `../lambda.zip` from the `infra/` directory; if the file does not exist, `terraform apply` will fail.

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

## 3. Build the Lambda zip package and React UI

The zip package must be built before `terraform apply` on a first deploy (it is also rebuilt on every code or dependency change).

### 3a. Build the React UI

The Vite build bakes Cognito IDs into the JavaScript bundle at compile time. Read them from Terraform outputs before building:

```bash
COGNITO_USER_POOL_ID=$(terraform -chdir=infra output -raw cognito_user_pool_id)
COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw cognito_client_id)
```

```bash
cd ui
VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" \
VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
. ~/.nvm/nvm.sh && npm run build
cd ..
```

Expected: `ui/dist/` is populated with compiled assets.

### 3b. Build the Lambda zip

Install dependencies into a staging directory using the correct target platform (Lambda runs on Linux x86_64 regardless of host architecture):

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

Copy application code and compiled UI assets into the staging directory, then zip:

```bash
cp -r app /tmp/lambda-package/
cp -r ui/dist /tmp/lambda-package/app/static

cd /tmp/lambda-package
zip -r ~/records/lambda.zip .
cd ~/records
```

Expected: `lambda.zip` exists at the repo root.

---

## 4. Apply Terraform

With `lambda.zip` present, apply Terraform. On first deploy this creates all infrastructure including the Lambda function:

```bash
terraform -chdir=infra apply
```

Expected: Lambda function and Function URL are created successfully.

---

## 6. Run database migrations

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

## 7. Verify the deployment

```bash
APP_URL=$(terraform -chdir=infra output -raw lambda_function_url)
curl -s "${APP_URL}api/health"
# Expected: {"status":"ok"}
```

Then open `$APP_URL` in a browser and sign in with the admin account.

---

## 8. Create the first user (if Cognito pool is new)

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

## 9. Redeploy after code changes

1. Rebuild the zip (step 3 above).
1. Update the Lambda function code directly — no Terraform required for code-only changes:

```bash
aws lambda update-function-code \
  --function-name records-dev \
  --zip-file fileb://lambda.zip \
  --profile records --region us-east-1
```

1. If the deploy includes schema changes, run migrations (step 6) **before** updating the function code.
1. If the deploy includes Terraform changes (env vars, IAM, etc.), run `terraform apply` instead of (or in addition to) the CLI update.

---

## Known constraints

- **First deploy order:** Build `lambda.zip` (step 3) before running `terraform apply`. Terraform references the zip at `../lambda.zip` and will fail if the file does not exist.
- **Platform targeting:** The `pip install --platform manylinux2014_x86_64` flag is required when building on macOS (including Apple Silicon). Omitting it produces wheels compiled for the host OS that will fail to load on Lambda.
- **RDS is private:** The database is in private subnets and not directly reachable from a laptop. For direct DB access or to run migrations locally, an SSM port-forward to the RDS host is required.
- **Migrations are manual:** `alembic upgrade head` must be run before any deploy that introduces schema changes. Lambda does not run migrations at startup.
- **Cognito IDs baked into the UI bundle:** If the Cognito user pool or client is replaced (e.g., in a new environment), rebuild and redeploy the image.
- **Cold starts:** Lambda may take 2–5 seconds to respond after a period of inactivity. For a personal single-user tool this is tolerable.
