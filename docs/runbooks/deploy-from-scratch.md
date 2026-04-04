# Deploy from Scratch — Record Ranch

## Purpose

Step-by-step procedure to deploy the full Record Ranch application stack to AWS from a clean checkout. Intended for first-time deploys and for validating the deploy process after infrastructure changes.

## Prerequisites

- AWS CLI configured with the `records` profile (`aws configure --profile records`)
- Terraform >= 1.10.0 installed
- Docker installed and running
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

This creates networking, RDS, Cognito, S3, secrets, and ECR. Lambda is provisioned in this step, but its first deploy will fail if no image exists in ECR yet — that is expected and documented below.

```bash
terraform -chdir=infra apply
```

> **On first deploy only:** Lambda function creation will fail with an image-not-found error because ECR is empty. This is expected. All other resources (networking, Cognito, RDS, S3, secrets, ECR) are created successfully. The Terraform exit code will be non-zero; continue to step 3.

Capture outputs for use in later steps:

```bash
terraform -chdir=infra output -json
```

Key values (update these after each fresh deploy — do not store credentials):

| Output | Description |
| --- | --- |
| `cognito_user_pool_id` | Cognito user pool ID |
| `cognito_client_id` | Cognito app client ID |
| `ecr_repository_url` | ECR URL to push the image |
| `lambda_function_url` | Public HTTPS URL of the deployed app (available after step 5 only) |
| `image_bucket_name` | S3 bucket for record images |
| `db_secret_arn` | Secrets Manager secret for DB connection info |

---

## 3. Build the React UI and Docker image

The Vite build bakes Cognito IDs into the JavaScript bundle at compile time. Read them from Terraform outputs before building:

```bash
COGNITO_USER_POOL_ID=$(terraform -chdir=infra output -raw cognito_user_pool_id)
COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw cognito_client_id)
ECR_URL=$(terraform -chdir=infra output -raw ecr_repository_url)
```

Build the multi-stage Docker image from the repo root:

```bash
docker build \
  --platform linux/amd64 \
  --build-arg VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" \
  --build-arg VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
  -t records-app:latest .
```

Expected: build completes without errors. The final image contains the FastAPI backend and the compiled React assets.

---

## 4. Authenticate Docker to ECR and push the image

```bash
aws ecr get-login-password --profile records --region us-east-1 \
  | docker login --username AWS --password-stdin "$ECR_URL"

docker tag records-app:latest "${ECR_URL}:latest"
docker push "${ECR_URL}:latest"
```

Expected: `latest: digest: sha256:...` push confirmation.

---

## 5. Re-apply Terraform to create the Lambda function

With an image now in ECR, re-run apply to complete Lambda provisioning:

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
APP_URL=$(cd infra && terraform output -raw lambda_function_url)
curl -s "${APP_URL}api/health"
# Expected: {"status":"ok"}
```

Then open `$APP_URL` in a browser and sign in with the admin account.

---

## 8. Create the first user (if Cognito pool is new)

See [cognito-operations.md](cognito-operations.md) for creating users and adding them to the `admin` group.

For the owner account:

```bash
COGNITO_USER_POOL_ID=$(cd infra && terraform output -raw cognito_user_pool_id)

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

1. Build a new image (step 3 above).
1. Push to ECR (step 4).
1. Update the Lambda function code:

```bash
ECR_URL=$(terraform -chdir=infra output -raw ecr_repository_url)

aws lambda update-function-code \
  --function-name records-dev \
  --image-uri "${ECR_URL}:latest" \
  --profile records --region us-east-1
```

1. If the deploy includes schema changes, run migrations (step 6) **before** updating the function code.

---

## Known constraints

- **First apply order:** Lambda requires an image in ECR before it can be created. On first deploy, `terraform apply` will provision all base infrastructure but fail on the Lambda function — this is expected. Push the image (steps 3–4) then re-run `terraform apply` (step 5) to complete provisioning.
- **RDS is private:** The database is in private subnets and not directly reachable from a laptop. For direct DB access or to run migrations locally, an SSM port-forward to the RDS host is required.
- **Migrations are manual:** `alembic upgrade head` must be run before any deploy that introduces schema changes. Lambda does not run migrations at startup.
- **Cognito IDs baked into the UI bundle:** If the Cognito user pool or client is replaced (e.g., in a new environment), rebuild and redeploy the image.
- **Cold starts:** Lambda may take 2–5 seconds to respond after a period of inactivity. For a personal single-user tool this is tolerable.
