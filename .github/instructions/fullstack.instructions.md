---
description: "Implementation standards for fullstack work across API, UI, and integration layers in Record Ranch."
applyTo: "**/*.py, **/*.ts, **/*.tsx, **/*.js, **/*.jsx, requirements.txt"
---

# Fullstack Implementation Standards - Record Ranch

## Backend

- Keep FastAPI routes thin; domain rules belong in service layer logic.
- Validate request payloads strictly and return deterministic error shapes.
- Use transaction-safe writes for inventory mutations.
- Preserve audit trail behavior for acquire, sell, and transfer flows.

## Frontend

- Make PERSONAL vs DISTRIBUTION distinctions clear in UI behavior and labels.
- Require explicit sale confirmation for PERSONAL items.
- Avoid exposing dangerous actions without clear user intent.

## Discogs Integration

- Use stable Discogs IDs for upsert keys.
- Respect rate limits, pagination, and retries with backoff.
- Persist raw payload plus normalized fields as defined in design docs.

## Testing Expectations

- Add unit tests for changed business rules.
- Add integration tests for API contract changes when possible.
- Update docs if request/response or workflow behavior changes.
