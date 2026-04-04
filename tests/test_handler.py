"""Unit tests for app.handler._build_database_url.

Tests verify that the cold-start secret fetch constructs a correctly
URL-encoded DATABASE_URL from Secrets Manager payloads, without making
real AWS calls.
"""

import json
import os
from unittest.mock import MagicMock, patch

_CONN_INFO = {
    "host": "db.example.com",
    "port": 5432,
    "dbname": "records",
    # Include special characters to verify URL encoding.
    "username": "admin user",
    "master_user_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-xxx",  # pragma: allowlist secret
}

_PASSWORD_INFO = {"password": "p@ss:word!"}  # pragma: allowlist secret


def _make_mock_client() -> MagicMock:
    client = MagicMock()

    def _get_secret(SecretId: str) -> dict:
        if SecretId == _CONN_INFO["master_user_secret_arn"]:
            return {"SecretString": json.dumps(_PASSWORD_INFO)}
        return {"SecretString": json.dumps(_CONN_INFO)}

    client.get_secret_value.side_effect = _get_secret
    return client


def test_build_database_url_returns_correct_scheme_and_host() -> None:
    """URL starts with postgresql+psycopg:// and embeds host/port/dbname."""
    mock_client = _make_mock_client()
    os.environ["AWS_REGION"] = "us-east-1"
    os.environ["DB_SECRET_ID"] = "records/dev/db-connection-info"

    with patch("boto3.client", return_value=mock_client):
        from app.handler import _build_database_url

        url = _build_database_url()

    assert url.startswith("postgresql+psycopg://")
    assert "@db.example.com:5432/records" in url


def test_build_database_url_url_encodes_username_and_password() -> None:
    """Special characters in credentials are percent-encoded."""
    mock_client = _make_mock_client()
    os.environ["AWS_REGION"] = "us-east-1"
    os.environ["DB_SECRET_ID"] = "records/dev/db-connection-info"

    with patch("boto3.client", return_value=mock_client):
        from app.handler import _build_database_url

        url = _build_database_url()

    # quote_plus encodes space as '+'; '@', ':', '!' as percent-sequences.
    assert "admin+user" in url
    assert "p%40ss%3Aword%21" in url


def test_build_database_url_fetches_both_secrets() -> None:
    """Both the connection-info secret and the master-password secret are read."""
    mock_client = _make_mock_client()
    os.environ["AWS_REGION"] = "us-east-1"
    os.environ["DB_SECRET_ID"] = "records/dev/db-connection-info"

    with patch("boto3.client", return_value=mock_client):
        from app.handler import _build_database_url

        _build_database_url()

    assert mock_client.get_secret_value.call_count == 2
