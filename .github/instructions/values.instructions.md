---
description: "Engineering values that govern all design, implementation, and review work in Record Ranch."
applyTo: "**"
---

# Engineering Values - Record Ranch

## Correctness over Convenience

- Validate assumptions against code and docs before changing behavior.
- Prefer explicit invariants and constraints over implicit behavior.
- Reject shortcuts that weaken data integrity.

## Security by Default

- Treat all external input as untrusted.
- Never store plaintext credentials, API tokens, or secrets in repo files.
- Keep least-privilege boundaries across API, DB, and storage.

## Auditability First

- Inventory lifecycle actions must be traceable.
- Any change to collection_type, status, or transaction history must be explicit and logged.
- No hidden side effects.

## Explicit Failure Modes

- Define what happens on failure at each boundary.
- Return deterministic API error behavior.
- Log failures with enough context for diagnosis.

## Bounded Resource Usage

- Use pagination for external API reads.
- Bound retries and add backoff on rate-limited calls.
- Avoid unbounded scans when indexed queries are available.

## Documentation as Contract

- Design doc defines technical behavior.
- Architecture doc stays high-level and non-duplicative.
- Keep docs aligned with implemented contracts and schema.
