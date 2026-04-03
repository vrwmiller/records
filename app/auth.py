from __future__ import annotations

import functools
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwk, jwt

from app.config import settings

_bearer = HTTPBearer()


@functools.lru_cache(maxsize=1)
def _get_jwks() -> dict[str, Any]:
    """Fetch and cache Cognito JWKS. Cache is cleared on process restart."""
    url = (
        f"https://cognito-idp.{settings.aws_region}.amazonaws.com"
        f"/{settings.cognito_user_pool_id}/.well-known/jwks.json"
    )
    try:
        response = httpx.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWKS fetch unavailable",
        )


def _verify_token(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token header",
        )

    kid = header.get("kid")
    jwks = _get_jwks()
    key_data = next((k for k in jwks["keys"] if k["kid"] == kid), None)

    if key_data is None:
        # Kid not found — clear cache and retry once with fresh JWKS
        _get_jwks.cache_clear()
        jwks = _get_jwks()
        key_data = next((k for k in jwks["keys"] if k["kid"] == kid), None)

    if key_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token signing key not found",
        )

    issuer = (
        f"https://cognito-idp.{settings.aws_region}.amazonaws.com"
        f"/{settings.cognito_user_pool_id}"
    )
    try:
        public_key = jwk.construct(key_data)
        claims: dict[str, Any] = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
            issuer=issuer,
            options={"verify_at_hash": False},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token verification failed",
        )

    if claims.get("token_use") != "id":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ID token required",
        )

    return claims


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict[str, Any]:
    return _verify_token(credentials.credentials)


def require_role(role: str) -> Any:
    """Return a FastAPI dependency that enforces membership in a Cognito group.

    Raises HTTP 403 when the authenticated user's ``cognito:groups`` claim does
    not include *role*.  Raises HTTP 403 when the ``Authorization`` header is
    missing (via ``HTTPBearer``), and raises HTTP 401 when a presented bearer
    token is invalid (via the ``get_current_user`` dependency).
    """

    def _check(claims: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        raw = claims.get("cognito:groups")
        groups: list[str] = raw if isinstance(raw, list) else []
        if role not in groups:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' required",
            )
        return claims

    return Depends(_check)
