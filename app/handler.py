"""Lambda entry point for Record Ranch.

Fetches DB credentials from Secrets Manager at cold start, sets DATABASE_URL
in the process environment before the FastAPI app is imported (which triggers
pydantic-settings to read env vars), then wraps the app with Mangum.

AWS_REGION is a reserved Lambda env var set automatically by the runtime.
All other required env vars (DB_SECRET_ID, COGNITO_USER_POOL_ID,
COGNITO_CLIENT_ID, S3_IMAGE_BUCKET) are set via the Lambda environment
configuration in Terraform.

IMPORTANT — Migrations are NOT run here. Before deploying any image that
includes schema changes, run migrations manually:

    source env.sh
    # Set DATABASE_URL from Secrets Manager (see deploy-from-scratch.md step 5)
    alembic upgrade head
"""

import json
import os
from urllib.parse import quote_plus

import boto3
from mangum import Mangum


def _build_database_url() -> str:
    """Fetch DB connection info and master password from Secrets Manager.

    Called once at cold start. The result is cached in os.environ so
    subsequent invocations in the same execution environment skip the
    Secrets Manager round-trip.
    """
    region = os.environ["AWS_REGION"]
    secret_id = os.environ["DB_SECRET_ID"]

    client = boto3.client("secretsmanager", region_name=region)

    conn_info = json.loads(
        client.get_secret_value(SecretId=secret_id)["SecretString"]
    )
    master_arn = conn_info["master_user_secret_arn"]

    password_info = json.loads(
        client.get_secret_value(SecretId=master_arn)["SecretString"]
    )

    host = conn_info["host"]
    port = conn_info["port"]
    dbname = conn_info["dbname"]
    username = quote_plus(conn_info["username"])
    password = quote_plus(password_info["password"])

    return f"postgresql+psycopg://{username}:{password}@{host}:{port}/{dbname}"


# Fetch at cold start, before importing app (which loads pydantic-settings and
# requires DATABASE_URL to be present in the environment).
if "DATABASE_URL" not in os.environ:
    os.environ["DATABASE_URL"] = _build_database_url()

from app.main import app  # noqa: E402

handler = Mangum(app)
