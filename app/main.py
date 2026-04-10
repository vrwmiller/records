from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.routers import discogs, health, inventory

app = FastAPI(title="Record Ranch", version="0.1.0")

_cors_origins = [
    origin.strip()
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(discogs.router, prefix="/api")


@app.exception_handler(StarletteHTTPException)
async def spa_fallback_handler(request: Request, exc: StarletteHTTPException) -> FileResponse:
    path = request.url.path
    is_api_path = path == "/api" or path.startswith("/api/")
    has_extension = Path(path).suffix != ""
    accept = request.headers.get("accept", "").lower()
    wants_html = "text/html" in accept

    if exc.status_code != 404 or is_api_path or has_extension or not wants_html:
        # Delegate to FastAPI's default handler to preserve exc.headers (e.g. Allow on 405)
        return await http_exception_handler(request, exc)

    # Non-API browser navigation 404 — serve the SPA so client-side routing handles it
    index = _static / "index.html"
    if index.exists():
        return FileResponse(str(index))

    return await http_exception_handler(request, exc)


# Serve the built React app in production
_static = Path(__file__).parent.parent / "ui" / "dist"
if _static.is_dir():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="static")
