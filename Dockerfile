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
# Stage 2: Lambda Python runtime
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS app

# Lambda expects function code under /var/task and adds it to PYTHONPATH.
WORKDIR /var/task

# Python 3.14 matches the documented developer environment. requirements.txt
# selects psycopg[binary] (psycopg3) for Python >= 3.14, so only one DB driver
# is installed. awslambdaric provides the Lambda Runtime Interface Client,
# enabling python:3.14-slim (a non-managed base image) to run in Lambda.
# No system packages are required — psycopg[binary] bundles libpq.
COPY requirements.txt ./
RUN pip install --no-cache-dir awslambdaric -r requirements.txt

# Copy application source.
COPY app/ ./app/

# Copy built React UI for static file serving from the same Lambda origin.
COPY --from=ui-build /build/ui/dist ./ui/dist/

# awslambdaric is the Lambda Runtime Interface Client. It connects to the
# Lambda runtime API so the function can receive events and return responses.
ENTRYPOINT ["/usr/local/bin/python3", "-m", "awslambdaric"]
CMD ["app.handler.handler"]
