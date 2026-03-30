---
description: "Use when creating or editing agent and instruction files for this repository. Defines agent file conventions, cross-cutting architecture invariants, and instruction coverage."
applyTo: ".github/agents/**/*.md, .github/instructions/**/*.md, .github/prompts/**/*.md"
---

# Architect and Agent File Standards - Record Ranch

## Agent File Conventions

Every agent file in .github/agents must include:

1. YAML frontmatter with:
- description: single-line sentence used for agent selection
- tools: include read, search, edit

2. Body sections in this order:
- Role statement
- Stack and Context
- Instructions
- Scope
- Responsibilities
- Constraints
- Coordinates with
- Approach

3. Required instruction references:
- .github/instructions/values.instructions.md
- .github/instructions/pr.instructions.md
- role-specific instruction file

## Cross-Cutting Invariants

These rules apply across all agents and all files unless explicitly overridden by a documented design decision.

- Inventory ownership state is local truth. Discogs is metadata enrichment, not ownership authority.
- Every inventory state transition must be auditable via inventory_transaction.
- No silent PERSONAL/DISTRIBUTION reclassification.
- Schema changes must be backward-compatible and migration-safe.
- Secrets are never committed to source control.
- API contracts must be documented before implementation.

## Instruction Coverage

- .github/instructions/fullstack.instructions.md: backend and frontend implementation files
- .github/instructions/database.instructions.md: schema, migrations, and DB model decisions
- .github/instructions/docs-qa.instructions.md: docs, linting, and test requirements
- .github/instructions/security.instructions.md: secure coding and threat checks
- .github/instructions/pr.instructions.md: branch, commit, and PR workflow
- .github/instructions/values.instructions.md: global engineering values
