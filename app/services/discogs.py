"""Discogs API client.

Thin synchronous wrapper around the Discogs REST API.  All calls are user-triggered
(search and release detail on acquire/edit); the backend never polls Discogs
autonomously.

This client returns the raw Discogs JSON response body for each request.
Response headers, including X-Discogs-Ratelimit, X-Discogs-Ratelimit-Used, and
X-Discogs-Ratelimit-Remaining, are not currently forwarded as part of the
returned payload.
"""

from __future__ import annotations

import httpx

from app.config import settings

_BASE_URL = "https://api.discogs.com"
_USER_AGENT = "RecordRanch/1.0 +https://github.com/vrwmiller/records"
_ACCEPT = "application/vnd.discogs.v2.discogs+json"
_TIMEOUT = 10.0

# Cached SSM-resolved token for production. Only populated when the SSM path
# is used; reset to None on cold start. Not shared with the direct env-var path
# so that tests can mock settings.discogs_token freely without interference.
_ssm_token_cache: str | None = None


def _get_token() -> str:
    """Resolve the Discogs API token.

    Checks in priority order:
    1. ``settings.discogs_token`` — set directly in the environment (local dev).
    2. ``settings.discogs_token_ssm_name`` — SSM SecureString parameter name;
       fetched once per Lambda cold start and cached in ``_ssm_token_cache``.
    """
    global _ssm_token_cache
    if settings.discogs_token:
        return settings.discogs_token
    if settings.discogs_token_ssm_name:
        if _ssm_token_cache is None:
            import boto3  # noqa: PLC0415 — lazy import; boto3 unused in local dev
            ssm = boto3.client("ssm", region_name=settings.aws_region)
            resp = ssm.get_parameter(
                Name=settings.discogs_token_ssm_name,
                WithDecryption=True,
            )
            _ssm_token_cache = resp["Parameter"]["Value"]
        return _ssm_token_cache
    return ""


def _headers() -> dict[str, str]:
    h: dict[str, str] = {
        "User-Agent": _USER_AGENT,
        "Accept": _ACCEPT,
    }
    token = _get_token()
    if token:
        h["Authorization"] = f"Discogs token={token}"
    return h


def search_releases(
    q: str,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """Search the Discogs database for releases matching *q*.

    Returns the raw Discogs JSON response (``results`` + ``pagination``).
    Raises ``httpx.HTTPStatusError`` on non-2xx responses.
    """
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.get(
            f"{_BASE_URL}/database/search",
            params={"q": q, "type": "release", "page": page, "per_page": per_page},
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()


def get_release(discogs_release_id: int) -> dict:
    """Fetch full release detail for *discogs_release_id*.

    Returns the raw Discogs JSON payload.
    Raises ``httpx.HTTPStatusError`` on non-2xx responses.
    """
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.get(
            f"{_BASE_URL}/releases/{discogs_release_id}",
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()
