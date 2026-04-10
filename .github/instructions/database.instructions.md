---
description: "Database schema and migration standards for Record Ranch inventory and Discogs metadata integration."
applyTo: "db/**/*.sql, migrations/**/*.sql, **/*alembic*.py, **/*models*.py, docs/design.md"
---

# Database Standards - Record Ranch

## Source of Truth

- Keep inventory state in local tables.
- Treat Discogs metadata as external enrichment data.

## Schema Rules

- Prefer additive, backward-compatible migrations.
- Avoid destructive forward migrations without explicit approval.
- Use constraints and indexes that enforce domain invariants.

## Inventory Integrity

- collection_type must stay constrained to PRIVATE or PUBLIC.
- inventory_transaction must capture all state-changing operations.
- No schema shape that allows silent reclassification.

## Discogs Modeling

- Keep stable key fields (discogs_release_id, master_id).
- Keep normalized child tables for queryable arrays.
- Keep raw JSON payload for long-tail attributes and future-proofing.

## Migration Discipline

- Include rollback intent and data safety notes.
- Add indexes with clear query rationale.
- Document schema deltas in docs/design.md.
