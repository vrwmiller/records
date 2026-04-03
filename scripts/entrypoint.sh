#!/bin/sh
# Entrypoint for the Record Ranch container.
#
# Fetches DB credentials from AWS Secrets Manager at startup. The password is
# not baked into the image; it is retrieved at runtime and lives in the
# process environment as DATABASE_URL while the service is running. The RDS
# master password is managed (and rotated) by AWS; reading it fresh on each
# container start ensures we always use the current credential.
#
# Required environment variables (set via App Runner service configuration):
#   DB_SECRET_ID     - Secrets Manager secret name/ARN for db-connection-info
#   AWS_REGION       - AWS region (e.g. us-east-1)
#   COGNITO_USER_POOL_ID
#   COGNITO_CLIENT_ID
#   S3_IMAGE_BUCKET  - (optional) images bucket name

set -e

echo "[entrypoint] Fetching DB connection info from Secrets Manager..."

CONN=$(aws secretsmanager get-secret-value \
  --secret-id "${DB_SECRET_ID}" \
  --region "${AWS_REGION}" \
  --query SecretString \
  --output text)

HOST=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['host'])")
PORT=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['port'])")
DBNAME=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['dbname'])")
USERNAME=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['username'])")
MASTER_ARN=$(printf '%s' "$CONN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['master_user_secret_arn'])")

echo "[entrypoint] Fetching DB password from managed master secret..."

PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "${MASTER_ARN}" \
  --region "${AWS_REGION}" \
  --query SecretString \
  --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")

ENCODED_USERNAME=$(DB_USER="${USERNAME}" python3 -c "import os, urllib.parse; print(urllib.parse.quote(os.environ['DB_USER'], safe=''))")
ENCODED_PASSWORD=$(DB_PASS="${PASSWORD}" python3 -c "import os, urllib.parse; print(urllib.parse.quote(os.environ['DB_PASS'], safe=''))")

export DATABASE_URL="postgresql+psycopg://${ENCODED_USERNAME}:${ENCODED_PASSWORD}@${HOST}:${PORT}/${DBNAME}"

echo "[entrypoint] Running database migrations..."
alembic upgrade head

echo "[entrypoint] Starting uvicorn on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
