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
FROM python:3.14-slim AS app

WORKDIR /app

# psycopg[binary] is a self-contained wheel that bundles libpq, so no system
# libpq headers are needed at runtime. App Runner health checks are HTTP probes
# at the platform level and do not require curl inside the container. No
# additional system packages are required.

# Python 3.14 matches the documented developer environment. requirements.txt
# selects psycopg[binary] (psycopg3) for Python >= 3.14, so only one driver
# is installed — no psycopg2-binary.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

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
