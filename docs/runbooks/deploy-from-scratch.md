# Deploy from Scratch — Record Ranch

## Purpose

Step-by-step procedure to deploy the full Record Ranch application stack to AWS from a clean checkout. Intended for first-time deploys and for validating the deploy process after infrastructure changes.

## Prerequisites

- AWS CLI configured with the `records` profile (`aws configure --profile records`)
- Terraform >= 1.10.0 installed
- Docker installed and running
- Node 24 installed (via nvm: `. ~/.nvm/nvm.sh && nvm use`)
- Python 3.13 or 3.14 virtual environment (see `env.sh`)
- Repository cloned and `venv` activated

---

## 1. Initialize Terraform (first time only, or after provider changes)

```bash
cd infra/
terraform init
```

Expected: "Terraform has been successfully initialized."

---

## 2. Deploy the base infrastructure

This creates networking, RDS, Cognito, S3, secrets, and ECR. App Runner is provisioned in this step, but its first deploy will fail if no image exists in ECR yet — that is expected and documented below.

```bash
terraform apply
```

> **On first deploy only:** App Runner service creation will fail with an image-not-found error because ECR is empty. This is expected. All other resources (networking, Cognito, RDS, S3, secrets, ECR) are created successfully. The Terraform exit code will be non-zero; continue to step 3.

Capture outputs for use in later steps:

```bash
terraform output -json
```

Key values (update these after each fresh deploy — do not store credentials):

| Output | Description |
| --- | --- |
| `cognito_user_pool_id` | Cognito user pool ID |
| `cognito_client_id` | Cognito app client ID |
| `ecr_repository_url` | ECR URL to push the image |
| `apprunner_service_url` | Public HTTPS URL of the deployed app |
| `image_bucket_name` | S3 bucket for record images |
| `db_secret_arn` | Secrets Manager secret for DB connection info |

---

## 3. Build the React UI and Docker image

The Vite build bakes Cognito IDs into the JavaScript bundle at compile time. Read them from Terraform outputs before building:

```bash
COGNITO_USER_POOL_ID=$(cd infra && terraform output -raw cognito_user_pool_id)
COGNITO_CLIENT_ID=$(cd infra && terraform output -raw cognito_client_id)
ECR_URL=$(cd infra && terraform output -raw ecr_repository_url)
```

Build the multi-stage Docker image from the repo root:

```bash
docker build \
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

## 5. Re-apply Terraform to create the App Runner service

With an image now in ECR, re-run apply to complete App Runner provisioning:

```bash
cd infra/
terraform apply
```

App Runner will pull the image from ECR and start the service. Initial deploy takes 2–4 minutes.

---

## 6. Run database migrations

The entrypoint script (`scripts/entrypoint.sh`) automatically runs `alembic upgrade head` on every container start. Verify the service started cleanly by checking the App Runner logs:

```bash
aws logs tail /aws/apprunner/records-dev/application \
  --profile records --region us-east-1 --follow
```

Look for `[entrypoint] Starting uvicorn on port 8000...` to confirm a clean start. If migrations failed, the error will appear here and the service will not start.

---

## 7. Verify the deployment

```bash
APP_URL=$(cd infra && terraform output -raw apprunner_service_url)
curl -s "${APP_URL}/api/health"
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
2. Push to ECR (step 4).
3. Trigger a new App Runner deployment:

```bash
SERVICE_ARN=$(aws apprunner list-services \
  --profile records --region us-east-1 \
  --query 'ServiceSummaryList[?ServiceName==`records-dev`].ServiceArn' \
  --output text)

aws apprunner start-deployment \
  --service-arn "$SERVICE_ARN" \
  --profile records --region us-east-1
```

Wait for deployment to reach `RUNNING`:

```bash
aws apprunner describe-service \
  --service-arn "$SERVICE_ARN" \
  --profile records --region us-east-1 \
  --query 'Service.Status'
```

---

## Known constraints

- **First apply order**: App Runner requires an image in ECR before it can be created. On first deploy, `terraform apply` will provision all base infrastructure but fail on the App Runner service — this is expected. Push the image (steps 3–4) then re-run `terraform apply` (step 5) to complete provisioning.
- **RDS is private**: The database is in private subnets and not directly reachable from a laptop. The container (running in the VPC via the VPC connector) reaches it normally. For direct DB access from a local machine, an SSM port-forward to the RDS host is required.
- **Cognito IDs baked into the UI bundle**: If the Cognito user pool or client is replaced (e.g., in a new environment), rebuild and redeploy the image.
- **No automatic redeployment**: `auto_deployments_enabled = false`. Only a pushed image plus `start-deployment` triggers a new release.
