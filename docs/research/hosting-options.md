# Hosting Options Analysis

## Context

The data tier (RDS, Cognito, S3, Secrets Manager, VPC) is provisioned. This document captures the
analysis of compute hosting options for the FastAPI backend and React UI.

---

## Options Considered

### Option A: AWS App Runner (implemented in PR #29)

The backend runs as a persistent container. App Runner manages the runtime, TLS, and scaling.
The React UI is served as static files by FastAPI from the same container (`ui/dist/`).

**Scaling**: Minimum 1 instance always running. Scales up under load, back to 1 at idle. Never
reaches zero automatically.

**Pros**
- No cold starts — instance is always warm, requests are served immediately
- Simplest operational model — point at an ECR image, done
- TLS and health checks built in
- VPC connector provides private-subnet egress to RDS with no extra components
- Manual pause is available (explicit action, ~30s to resume) for extended idle periods

**Cons**
- Continuous compute cost even at zero traffic (~$25–30/month for 512 CPU / 1024 MB)
- No automatic idle scale-down

### Option B: AWS Lambda + API Gateway (scale-to-zero)

The FastAPI app is wrapped with `mangum` (an ASGI-to-Lambda adapter) and deployed as a Lambda
function. API Gateway (or a Lambda Function URL) routes HTTP traffic to it. The React UI is
served separately (S3 + CloudFront, or included as Lambda response for small payloads — neither
is practical; S3 + CloudFront is the correct pairing).

**Scaling**: True scale-to-zero. No requests = no instances = no compute cost.

**Pros**
- Near-zero compute cost at low traffic (Lambda free tier: 1M requests/month, 400k GB-seconds)
- No idle cost — baseline is only RDS (~$13–15/month)
- Scales per-request automatically

**Cons**
- **Cold starts**: 2–5 seconds on first request after an idle period. Unavoidable without a
  warming strategy (scheduled pings, Provisioned Concurrency at extra cost)
- **DB connection management**: Lambda's stateless per-invocation model conflicts with
  SQLAlchemy's connection pool. Each cold invocation may open a new RDS connection
  - Mitigated by RDS Proxy (~$11/month), which pools connections on Lambda's behalf
  - At single-user scale, direct RDS connection without a proxy is defensible — connection
    exhaustion requires concurrency that will never materialize for this workload
- **Migrations**: `alembic upgrade head` cannot run at container startup. Must be run manually
  (or via a separate one-off Lambda invocation) before each schema-changing deploy
- **More Terraform surface**: Lambda function + API Gateway + IAM + deployment package
  management replaces a single App Runner service resource
- **Code change**: `mangum` wrapper required around the FastAPI app; Dockerfile base image
  changes to the Lambda Python runtime image

---

## Cost Comparison (estimated monthly, single-user workload)

| Option | Compute | RDS | RDS Proxy | Total |
|---|---|---|---|---|
| App Runner | ~$25–30 | ~$13–15 | — | **~$40–45** |
| Lambda (no proxy) | ~$0 | ~$13–15 | — | **~$13–15** |
| Lambda + RDS Proxy | ~$0 | ~$13–15 | ~$11 | **~$25** |

---

## Decision Point

At the time of analysis (PR #29 open, no Terraform applied yet), either option is viable with
equal implementation cost. Nothing was provisioned in AWS.

**Recommendation for this workload**: Lambda without RDS Proxy is the lowest-cost option and the
connection risk is negligible at single-user scale. Cold starts are the primary trade-off. If
the 2–5s delay on first daily use is acceptable, Lambda is the better fit financially.

App Runner is the right choice if cold starts would be disruptive or if operational simplicity
is the priority.

---

## Status

**Lambda (no proxy) selected.** PR #30 implements Lambda + Function URL. App Runner removed.
See PR #30 for the full implementation.

---

## Deployment Packaging Decision (April 2026)

### Container image vs. zip

Lambda supports two deployment package types: container image (ECR) and zip archive.

PR #30 was initially implemented using container image deployments. This requires Docker locally
to build and push the image to ECR before `terraform apply` can create the Lambda function.

Docker is intentionally not installed on the development machine to reduce local overhead.
Installing Docker solely to support Lambda image builds is not justified for a single-developer,
single-environment project.

**Decision: switch to zip-based deployment.**

| | Container image | Zip |
|---|---|---|
| Local tooling required | Docker | None (pip + zip) |
| Runtime | Any (custom image) | AWS managed runtime |
| Python version | 3.14 (matches local venv) | 3.13 (latest managed) |
| Max package size | No practical limit | 250 MB unzipped |
| Redeploy mechanism | `docker build` + `docker push` + `terraform apply` | `pip install -t` + `zip` + `aws lambda update-function-code` |
| ECR required | Yes | No |

**Python version**: Lambda managed runtimes do not yet support Python 3.14. Python 3.13 is the
latest supported managed runtime. The application does not use any 3.14-specific language
features; 3.13 is a compatible drop-in.

**Consequences**:

- `Dockerfile` and `infra/ecr.tf` removed
- `infra/lambda.tf` updated: `package_type = "Zip"`, `runtime = "python3.13"`,
  `handler = "app.handler.handler"`, `filename` points to the built zip
- `requirements.txt`: `mangum` constraint unchanged; `psycopg[binary]` version marker updated
  to `python_version >= "3.13"` so Lambda 3.13 and local 3.14 both receive the precompiled
  manylinux wheel. `awslambdaric` was never in `requirements.txt` (it was Dockerfile-only).
- `deploy-from-scratch.md` runbook updated to replace Docker build/push steps with
  `pip install -t` + `zip` + `aws lambda update-function-code`
