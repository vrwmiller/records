"""Unit tests for the Discogs proxy router and service layer.

Router tests use FastAPI TestClient with a dependency override for auth.
Service calls (search_releases, get_release) are mocked — no real HTTP calls
are made.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_USER = {"sub": "user-001", "email": "test@example.com"}


def _fake_user() -> dict:
    return _FAKE_USER


def _client_with_auth() -> TestClient:
    app.dependency_overrides[get_current_user] = _fake_user
    return TestClient(app)


def _teardown() -> None:
    app.dependency_overrides.pop(get_current_user, None)


# ---------------------------------------------------------------------------
# GET /api/discogs/releases (search)
# ---------------------------------------------------------------------------

class TestDiscogsSearch:
    def setup_method(self) -> None:
        self.client = _client_with_auth()

    def teardown_method(self) -> None:
        _teardown()

    def test_returns_discogs_payload(self) -> None:
        payload = {
            "results": [
                {
                    "id": 12345,
                    "title": "Radiohead - OK Computer",
                    "year": "1997",
                    "country": "UK",
                    "resource_url": "https://api.discogs.com/releases/12345",
                    "thumb": "",
                    "label": ["Parlophone"],
                    "format": ["Vinyl", "LP"],
                }
            ],
            "pagination": {"page": 1, "pages": 1, "per_page": 50, "items": 1, "urls": {}},
        }
        with patch("app.routers.discogs.search_releases", return_value=payload) as mock_search:
            resp = self.client.get("/api/discogs/releases", params={"q": "OK Computer"})

        assert resp.status_code == status.HTTP_200_OK
        body = resp.json()
        assert body["results"][0]["id"] == 12345
        mock_search.assert_called_once_with("OK Computer", page=1, per_page=50)

    def test_requires_auth(self) -> None:
        app.dependency_overrides.pop(get_current_user, None)
        client = TestClient(app)
        resp = client.get("/api/discogs/releases", params={"q": "test"})
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_empty_query_rejected(self) -> None:
        resp = self.client.get("/api/discogs/releases", params={"q": ""})
        assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_missing_query_rejected(self) -> None:
        resp = self.client.get("/api/discogs/releases")
        assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_discogs_404_returned_as_404(self) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        exc = httpx.HTTPStatusError("not found", request=MagicMock(), response=mock_resp)
        with patch("app.routers.discogs.search_releases", side_effect=exc):
            resp = self.client.get("/api/discogs/releases", params={"q": "nonexistent"})
        assert resp.status_code == 404

    def test_discogs_429_returned_as_429(self) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        exc = httpx.HTTPStatusError("rate limited", request=MagicMock(), response=mock_resp)
        with patch("app.routers.discogs.search_releases", side_effect=exc):
            resp = self.client.get("/api/discogs/releases", params={"q": "test"})
        assert resp.status_code == 429

    def test_network_error_returns_503(self) -> None:
        exc = httpx.RequestError("timeout", request=MagicMock())
        with patch("app.routers.discogs.search_releases", side_effect=exc):
            resp = self.client.get("/api/discogs/releases", params={"q": "test"})
        assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE

    def test_pagination_params_forwarded(self) -> None:
        payload = {"results": [], "pagination": {"page": 2, "pages": 5, "per_page": 25, "items": 100, "urls": {}}}
        with patch("app.routers.discogs.search_releases", return_value=payload) as mock_search:
            self.client.get("/api/discogs/releases", params={"q": "vinyl", "page": "2", "per_page": "25"})
        mock_search.assert_called_once_with("vinyl", page=2, per_page=25)


# ---------------------------------------------------------------------------
# GET /api/discogs/releases/{id} (detail)
# ---------------------------------------------------------------------------

class TestDiscogsDetail:
    def setup_method(self) -> None:
        self.client = _client_with_auth()

    def teardown_method(self) -> None:
        _teardown()

    def test_returns_release_payload(self) -> None:
        payload = {
            "id": 12345,
            "title": "Radiohead - OK Computer",
            "artists_sort": "Radiohead",
            "year": 1997,
            "country": "UK",
            "resource_url": "https://api.discogs.com/releases/12345",
            "tracklist": [],
            "images": [],
        }
        with patch("app.routers.discogs.get_release", return_value=payload) as mock_get:
            resp = self.client.get("/api/discogs/releases/12345")

        assert resp.status_code == status.HTTP_200_OK
        body = resp.json()
        assert body["id"] == 12345
        assert body["artists_sort"] == "Radiohead"
        mock_get.assert_called_once_with(12345)

    def test_requires_auth(self) -> None:
        app.dependency_overrides.pop(get_current_user, None)
        client = TestClient(app)
        resp = client.get("/api/discogs/releases/12345")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_discogs_404_returned_as_404(self) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        exc = httpx.HTTPStatusError("not found", request=MagicMock(), response=mock_resp)
        with patch("app.routers.discogs.get_release", side_effect=exc):
            resp = self.client.get("/api/discogs/releases/99999")
        assert resp.status_code == 404

    def test_network_error_returns_503(self) -> None:
        exc = httpx.RequestError("timeout", request=MagicMock())
        with patch("app.routers.discogs.get_release", side_effect=exc):
            resp = self.client.get("/api/discogs/releases/12345")
        assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


# ---------------------------------------------------------------------------
# Service unit tests (no HTTP)
# ---------------------------------------------------------------------------

class TestDiscogsService:
    def test_search_releases_builds_correct_request(self) -> None:
        from app.services.discogs import search_releases

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"results": [], "pagination": {}}

        with patch("httpx.Client") as mock_client_cls:
            instance = mock_client_cls.return_value.__enter__.return_value
            instance.get.return_value = mock_resp

            result = search_releases("OK Computer", page=1, per_page=50)

        call_kwargs = instance.get.call_args
        assert "/database/search" in call_kwargs.args[0]
        params = call_kwargs.kwargs["params"]
        assert params["q"] == "OK Computer"
        assert params["type"] == "release"
        assert result == {"results": [], "pagination": {}}

    def test_search_releases_sends_required_headers(self) -> None:
        from app.services.discogs import search_releases

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"results": [], "pagination": {}}

        with patch("httpx.Client") as mock_client_cls:
            instance = mock_client_cls.return_value.__enter__.return_value
            instance.get.return_value = mock_resp
            search_releases("test")

        headers = instance.get.call_args.kwargs["headers"]
        assert "User-Agent" in headers
        assert "RecordRanch" in headers["User-Agent"]
        assert "Accept" in headers

    def test_get_release_builds_correct_url(self) -> None:
        from app.services.discogs import get_release

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": 12345}

        with patch("httpx.Client") as mock_client_cls:
            instance = mock_client_cls.return_value.__enter__.return_value
            instance.get.return_value = mock_resp

            result = get_release(12345)

        call_args = instance.get.call_args
        assert "/releases/12345" in call_args.args[0]
        assert result == {"id": 12345}

    def test_get_release_sends_required_headers(self) -> None:
        from app.services.discogs import get_release

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": 99}

        with patch("httpx.Client") as mock_client_cls:
            instance = mock_client_cls.return_value.__enter__.return_value
            instance.get.return_value = mock_resp
            get_release(99)

        headers = instance.get.call_args.kwargs["headers"]
        assert "User-Agent" in headers
        assert "RecordRanch" in headers["User-Agent"]
        assert "Accept" in headers
