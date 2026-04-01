# Terraform Workflow Runbook

## Purpose

Define the standard Terraform workflow for Record Ranch infrastructure changes.

## Preconditions

- Run commands from repository root.
- AWS credentials are available via profile, role, or environment.
- Terraform version is compatible with `infra/main.tf` constraints.

## Standard Workflow

1. Initialize backend and providers:
   - `cd infra`
   - `terraform init`
2. Format and validate:
   - `terraform fmt`
   - `terraform validate`
3. Review plan:
   - `terraform plan -out tfplan`
4. Apply reviewed plan:
   - `terraform apply tfplan`
5. Remove saved plan artifact if no longer needed.

## State Backend Expectations

- Backend uses S3 for remote state.
- State bucket is versioned and encrypted.
- State location is environment-scoped by key naming convention.

## Change Safety Rules

- Never apply unreviewed changes directly to production environments.
- Treat replacement of stateful resources (for example RDS) as high risk.
- If `terraform plan` includes unexpected destroy actions, stop and investigate.

## Drift and Recovery

- If backend or provider settings change, run `terraform init -reconfigure`.
- For state drift investigations, use `terraform plan` first before any imports or state edits.
- Perform manual state operations only with explicit review and rollback notes.
