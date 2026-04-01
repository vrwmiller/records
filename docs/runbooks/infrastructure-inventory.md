# Infrastructure Inventory Reference

## Purpose

Provide a concise reference of baseline infrastructure currently provisioned by Terraform.

## Networking

- Resource type: VPC, subnets, route table, internet gateway, security groups
- Purpose: isolate app and data tiers while providing controlled ingress and egress
- Critical settings:
  - private and public subnet split
  - DB ingress restricted to app security group
  - app ingress allows HTTPS
- Validation:
  - `terraform validate`
  - `terraform plan`

## Database

- Resource type: Amazon RDS PostgreSQL 16
- Purpose: transactional system of record for inventory and history
- Critical settings:
  - storage encrypted
  - automated backups with PITR retention
  - deletion protection enabled
  - single-AZ posture by design
- Validation:
  - confirm plan shows no unexpected replacement
  - verify backup retention/deletion protection in AWS console after apply

## Authentication

- Resource type: Amazon Cognito user pool and app client
- Purpose: user authentication boundary for app/API access
- Critical settings:
  - email sign-in
  - optional software token MFA
  - no client secret for app client
- Validation:
  - verify IDs in Terraform outputs
  - test sign-in flow once app wiring exists

## Object Storage

- Resource type: Amazon S3 bucket for record images
- Purpose: durable storage for optional record images
- Critical settings:
  - block all public access
  - versioning enabled
  - server-side encryption enabled
  - lifecycle rule for incomplete multipart uploads
- Validation:
  - verify bucket policy/access block settings in AWS console

## Secret Management

- Resource type: AWS Secrets Manager secret for DB credentials
- Purpose: central secret source for runtime DB authentication
- Critical settings:
  - credentials are generated and stored as structured JSON
  - app must retrieve credentials at runtime
- Validation:
  - verify secret ARN output exists
  - verify secret value is present after apply
