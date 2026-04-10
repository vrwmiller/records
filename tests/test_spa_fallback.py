from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client() -> TestClient:
    from app.main import app

    return TestClient(app)


def test_spa_nav_route_served_as_html(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /inventory with Accept: text/html serves index.html (200)."""
    index = tmp_path / "index.html"  # type: ignore[operator]
    index.write_text("<!doctype html><html><body>SPA</body></html>")

    import app.main as main_module

    monkeypatch.setattr(main_module, "_static", tmp_path)

    from app.main import app

    c = TestClient(app)
    response = c.get("/inventory", headers={"Accept": "text/html,application/xhtml+xml,*/*"})
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")


def test_api_404_returns_json(client: TestClient) -> None:
    """GET /api/<unknown> returns JSON 404, not HTML."""
    response = client.get("/api/does-not-exist", headers={"Accept": "text/html,*/*"})
    assert response.status_code == 404
    assert response.headers.get("content-type", "").startswith("application/json")


def test_static_asset_extension_guard_returns_json(client: TestClient) -> None:
    """GET a .js path returns JSON 404 even when Accept includes text/html."""
    response = client.get("/assets/app.deadbeef.js", headers={"Accept": "text/html,*/*"})
    assert response.status_code == 404
    assert response.headers.get("content-type", "").startswith("application/json")


def test_non_404_exception_delegates_to_default_handler(client: TestClient) -> None:
    """Non-404 HTTP exceptions (e.g. 405) return JSON, not the SPA shell."""
    response = client.put("/api/health", headers={"Accept": "application/json"})
    assert response.status_code == 405
    assert response.headers.get("content-type", "").startswith("application/json")
