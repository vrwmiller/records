import os

# Set required env var stubs before any app module is imported.
# These values are only used for test execution and do not connect to real infrastructure.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")  # pragma: allowlist secret
os.environ.setdefault("COGNITO_USER_POOL_ID", "us-east-1_test")
os.environ.setdefault("COGNITO_CLIENT_ID", "testclient")
