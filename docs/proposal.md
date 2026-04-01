# Record Ranch Inventory System – Proposal

## Objective

Build a private inventory system for record collectors and sellers that:

- Tracks all acquisitions, transfers, and sales
- Differentiates between personal and distribution collections
- Provides auditability and clear transaction history
- Supports future analytics and pricing features

---

## Motivation

Current inventory processes are:

- Manual or partially tracked
- Prone to misclassification between personal and sale inventory
- Difficult to analyze for trends or valuation

---

## Goals

1. Implement a dual-collection model (PERSONAL vs DISTRIBUTION)
2. Track all inventory actions as transactions
3. Provide APIs for acquisition, transfer, and sale
4. Develop UI workflows aligned with collection rules
5. Support import of existing Microsoft Access inventory data
6. Enable developer-friendly environment setup

---

## Scope

- Core inventory and transaction model
- Discogs metadata integration for cataloging and enrichment
- Presentation of Discogs market/value signal data for user consumption
- Import pipeline for existing Microsoft Access inventory data and lookup tables
- UI for adding, selling, and transferring records
- Developer environment and workflows
- Infrastructure-as-code baseline for networking, database, auth, object storage, and secrets
- Backup and audit processes

### Out of Scope (initial version)

- Automated pricing rules
- Valuation tracking

---

## Benefits

- Accurate inventory tracking
- Clear separation of personal and distribution collections
- Reduced risk of accidental sales
- Audit trail for compliance or personal tracking
- Easier onboarding for new developers
- Faster migration from legacy tooling without re-keying historical inventory

---

## Deliverables

- Database schema with updated transaction and item models
- FastAPI backend with required endpoints
- Web-based UI for inventory management
- Legacy import workflow for Microsoft Access export files (CSV-based)
- Terraform infrastructure scaffold for AWS baseline services
- Documentation: design, architecture, and developer workflow

---

## Developer Guardrails

- Secrets are scanned with the pre-commit framework using `.pre-commit-config.yaml`
- Install once per clone:
  - `./scripts/install-hooks.sh`
- Validate before first commit:
  - `pre-commit run --all-files`
