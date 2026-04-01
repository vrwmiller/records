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

- Documentation-first project state
- No runnable application implementation yet
- Environment and dependency scaffolding present for future build-out

## Documentation References

- Proposal: [docs/proposal.md](docs/proposal.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Design: [docs/design.md](docs/design.md)
- Runbooks: planned (will live under docs/runbooks/)

## Infrastructure Bootstrap

Before running `terraform init` for the first time, two AWS resources must be created manually. These cannot be managed by the Terraform configuration they support.

**1. S3 state bucket** (if it does not already exist):

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

**2. DynamoDB lock table** (required for safe concurrent `terraform apply` runs):

```bash
aws dynamodb create-table \
  --table-name records-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1 \
  --profile records
```

Both resources are referenced in `infra/main.tf`. Once created, run `terraform init` inside `infra/`.

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

When implementation begins, this README should be expanded with full setup, local run instructions, testing commands, and deployment guidance.
