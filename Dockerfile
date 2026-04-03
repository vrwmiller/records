# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: Build the React UI
# ---------------------------------------------------------------------------
FROM node:24-slim AS ui-build

WORKDIR /build/ui

# Install dependencies first so this layer is cached separately from source.
COPY ui/package.json ui/package-lock.json ./
RUN npm ci

# Vite bakes Cognito IDs into the bundle at build time via VITE_ env vars.
# Pass them as build arguments when running docker build:
#   --build-arg VITE_COGNITO_USER_POOL_ID=us-east-1_xxx
#   --build-arg VITE_COGNITO_CLIENT_ID=yyy
ARG VITE_COGNITO_USER_POOL_ID
ARG VITE_COGNITO_CLIENT_ID
ENV VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID

COPY ui/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Python application
# ---------------------------------------------------------------------------
FROM python:3.13-slim AS app

WORKDIR /app

# System dependencies needed by psycopg2-binary (libpq).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies. requirements.txt installs psycopg2-binary for
# Python < 3.14; we additionally install psycopg[binary] (psycopg3) so the
# app and entrypoint can use the postgresql+psycopg:// DSN prefix consistently
# across local dev (Python 3.14 + psycopg3) and this container.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir 'psycopg[binary]>=3.2.1,<3.3'

# Install AWS CLI v1 via pip (awscli) for the entrypoint secret fetch.
RUN pip install --no-cache-dir awscli

# Copy application source.
COPY app/ ./app/
COPY alembic.ini ./
COPY migrations/ ./migrations/

# Copy the built React assets from stage 1.
# FastAPI mounts ui/dist/ as static files when the directory exists.
COPY --from=ui-build /build/ui/dist ./ui/dist/

# Entrypoint fetches DB credentials from Secrets Manager, runs migrations,
# and starts uvicorn.
COPY scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
