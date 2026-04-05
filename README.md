# Record Ranch

Record Ranch is a private inventory system for record collectors and sellers.

## System Overview

The system is designed to:

- Track record lifecycle events across acquisition, transfer, and sale
- Separate inventory into PERSONAL and DISTRIBUTION collections
- Preserve an auditable transaction history for all state changes
- Support import of legacy Microsoft Access inventory exports
- Use Discogs as a metadata enrichment source (not as ownership authority)

## High-Level Components

- Database layer for inventory items, transactions, and pressing metadata
- API layer for inventory actions and import workflows
- Web UI for collection-aware inventory management
- Import pipeline for staged validation and commit of legacy data
- Backup and audit support for operational resilience

## Current Repository Status

- Full stack deployed to AWS (Lambda + RDS + API Gateway + Cognito)
- Application is accessible at the API Gateway HTTPS endpoint (`app_url` Terraform output)
- React UI is served as static files bundled into the Lambda zip package
- Database migrations are at head; Alembic manages schema lifecycle
- Infrastructure managed via Terraform in `infra/`; state stored in S3 with locking

## Documentation References

- Proposal: [docs/proposal.md](docs/proposal.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Design: [docs/design.md](docs/design.md)
- Runbooks: [docs/runbooks/](docs/runbooks/)

## Infrastructure Bootstrap

Before running `terraform init` for the first time, one AWS resource must be created manually. It cannot be managed by the Terraform configuration it supports.

**S3 state bucket** (if it does not already exist):

```bash
aws s3api create-bucket \
  --bucket records-tfstate-920835814440-us-east-1 \
  --region us-east-1 \
  --profile records

aws s3api put-bucket-versioning \
  --bucket records-tfstate-920835814440-us-east-1 \
  --versioning-configuration Status=Enabled \
  --profile records

aws s3api put-bucket-encryption \
  --bucket records-tfstate-920835814440-us-east-1 \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  --profile records

aws s3api put-public-access-block \
  --bucket records-tfstate-920835814440-us-east-1 \
  --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' \
  --profile records

aws s3api put-bucket-policy \
  --bucket records-tfstate-920835814440-us-east-1 \
  --policy '{"Version":"2012-10-17","Statement":[{"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::records-tfstate-920835814440-us-east-1","arn:aws:s3:::records-tfstate-920835814440-us-east-1/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}' \
  --profile records
```

State locking is handled by S3 native locking (`use_lockfile = true` in `infra/main.tf`) — no DynamoDB table is required. Once the bucket is created, run `terraform init` inside `infra/`.

**Per-environment state keys:** Terraform backend blocks do not support variable interpolation, so the S3 key in `main.tf` is a static default for `dev`. Each environment must use a distinct key to avoid sharing state. Override at init time:

```bash
# dev (default — matches key in main.tf)
terraform init

# prod
terraform init -backend-config="key=records/prod/terraform.tfstate"
```

## Developer Setup

All setup commands must be run from the repository root.

Before running any tooling, activate the Python virtual environment:

```bash
source ./env.sh
```

This creates the venv if it does not exist, activates it, and sets required environment variables.

To install git hooks (runs markdownlint, secret scanning, and Terraform formatting/validation plus secret-safety checks on every commit):

```bash
bash scripts/install-hooks.sh
```

## Notes

For deployment procedures, infrastructure details, and operational runbooks, see [docs/runbooks/](docs/runbooks/). The deploy-from-scratch runbook covers the full provisioning sequence including Lambda packaging, Cognito setup, and database migrations.
