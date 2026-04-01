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

## Developer Setup

All setup commands must be run from the repository root.

Before running any tooling, activate the Python virtual environment:

```bash
source ./env.sh
```

This creates the venv if it does not exist, activates it, and sets required environment variables.

To install git hooks (runs markdownlint, secret scanning, and Terraform secret-safety checks on every commit):

```bash
bash scripts/install-hooks.sh
```

## Notes

When implementation begins, this README should be expanded with full setup, local run instructions, testing commands, and deployment guidance.
