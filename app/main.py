from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
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
async def spa_fallback_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse | FileResponse:
    if exc.status_code != 404 or request.url.path.startswith("/api"):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    # Non-API 404 — serve the SPA so client-side routing handles it
    index = _static / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"detail": "Not Found"}, status_code=404)


# Serve the built React app in production
_static = Path(__file__).parent.parent / "ui" / "dist"
if _static.is_dir():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="static")
