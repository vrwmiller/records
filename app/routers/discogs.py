"""Discogs proxy router.

Forwards authenticated requests to the Discogs API.  No Discogs data is written
to the local database by these endpoints; they are read-only proxies that let
the UI call Discogs through the backend so that:

  - The Discogs token never leaves the server.
  - Cognito authentication is enforced on every call.
  - Rate-limit headers can be observed server-side if needed in the future.

Routes:
  GET /discogs/releases?q=...         — search for releases
  GET /discogs/releases/{id}          — full release detail
"""

from __future__ import annotations

from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import get_current_user
from app.services.discogs import get_release, search_releases

router = APIRouter(tags=["discogs"])

_Auth = Annotated[dict, Depends(get_current_user)]


@router.get("/discogs/releases")
def search(
    q: Annotated[str, Query(min_length=1, description="Search query")],
    _user: _Auth,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
) -> Any:
    """Proxy a Discogs release search.  Returns the raw Discogs JSON response."""
    try:
        return search_releases(q, page=page, per_page=per_page)
    except httpx.HTTPStatusError as exc:
        try:
            detail: Any = exc.response.json()
        except Exception:
            detail = "Discogs API error"
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=detail,
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Discogs API unreachable",
        ) from exc


@router.get("/discogs/releases/{discogs_release_id}")
def detail(
    discogs_release_id: int,
    _user: _Auth,
) -> Any:
    """Proxy a Discogs release detail fetch.  Returns the raw Discogs JSON payload."""
    try:
        return get_release(discogs_release_id)
    except httpx.HTTPStatusError as exc:
        try:
            detail: Any = exc.response.json()
        except Exception:
            detail = "Discogs API error"
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=detail,
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Discogs API unreachable",
        ) from exc
