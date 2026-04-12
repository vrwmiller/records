# Record Ranch – Discogs Integration Design

This document covers the Discogs API integration: client contract, rate limiting, schema strategy, field mapping, and compliance notes. It is a companion to [design.md](design.md).

---

## Design Decision: Lean Schema and On-Demand Fetches

**Context:** An earlier draft proposed storing Discogs payload data locally — market signals, community counts, raw JSON, sync timestamps, and child tables for tracks, images, credits, labels, and identifiers — to work around rate limits.

**Decision (April 2026):** Lean local bookmark only. All detail data is fetched on demand from the Discogs API and never stored locally.

**Rationale:**
- Discogs is an authoritative, reliable read-only source; duplicating its data locally just costs money.
- Storage costs money. Fields like market signals, community counts, tracks, and images can be large and change frequently, making local copies both expensive and stale.
- At human interaction pace, 60 authenticated requests per minute is ample; rate limits are not a practical constraint.
- On-demand fetches eliminate the need for background sync jobs, stale-data detection, and sync-status bookkeeping.

**Consequences:**
- `pressing` stores eight columns: `id`, `created_at`, `discogs_release_id`, `discogs_resource_url`, `title`, `artists_sort`, `year`, `country`.
- No market signal columns, no JSONB payload, no sync timestamps.
- Phase B child tables (`pressing_track`, `pressing_identifier`, `pressing_image`, `pressing_video`, `pressing_credit`, `pressing_company`, `pressing_label`) are cancelled.
- Phase C background sync is cancelled.
- The Discogs API is called only on explicit user action: search, release detail, or image load.

---

## Discogs Integration Design

### Implementation Reference

- Python client reference: [joalla/discogs_client](https://github.com/joalla/discogs_client)
- Use as an optional integration accelerator; keep local API/domain contracts authoritative per this design.

### API Contract

- Required headers:
  - `User-Agent` must be unique to this application
  - `Accept` should target Discogs v2 media type for predictable responses
- Access model:
  - Public database reads can be unauthenticated
  - User-specific collection, wantlist, and marketplace actions require authenticated access
- Error handling:
  - Handle `401`, `403`, `404`, `405`, `422`, and `5xx` responses explicitly

### Rate Limiting and Throttling

- Design assumptions:
  - Authenticated requests: ~60/minute
  - Unauthenticated requests: ~25/minute
- Client behavior:
  - Read and respect `X-Discogs-Ratelimit`, `X-Discogs-Ratelimit-Used`, and `X-Discogs-Ratelimit-Remaining`
  - Use local request throttling and bounded retry backoff
- At human interaction pace, rate limits are not a practical concern. On-demand fetches are user-triggered; the backend never polls Discogs autonomously.

### Pagination Rules

- Default page size is 50
- Max page size is 100
- Search result pages must follow:
  - `Link` response header relations (`next`, `prev`, `first`, `last`)
  - Response body `pagination` object

### Schema Strategy: Lean Bookmark

`pressing` is a lean bookmark that anchors an `inventory_item` to a Discogs release and supplies the fields needed to render a list-view row.

All detail data — tracks, images, credits, labels, identifiers, market signals, community signals — is fetched on demand from the Discogs API via the `/discogs/releases/{id}` proxy endpoint. Detail data is never stored locally.

**`pressing` columns (complete set):**

```sql
CREATE TABLE pressing (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discogs_release_id   BIGINT,
  discogs_resource_url TEXT,
  title                TEXT,
  artists_sort         TEXT,
  year                 INTEGER,
  country              TEXT,
  catalog_number       TEXT,   -- added migration 346f77d5b693
  matrix               TEXT,   -- added migration 346f77d5b693
  label                TEXT    -- added migration 4b7ab0a331c0
);

-- Partial unique index: enforce uniqueness only when discogs_release_id is set
CREATE UNIQUE INDEX ux_pressing_discogs_release_id
  ON pressing (discogs_release_id)
  WHERE discogs_release_id IS NOT NULL;

CREATE INDEX ix_pressing_title       ON pressing (title);
CREATE INDEX ix_pressing_artists_sort ON pressing (artists_sort);
CREATE INDEX ix_pressing_year         ON pressing (year);
CREATE INDEX ix_pressing_country      ON pressing (country);
```

All Discogs-sourced columns are nullable. A `pressing` row may exist before a Discogs release is selected.

**FK from `inventory_item`:**

```sql
ALTER TABLE inventory_item
  ADD CONSTRAINT fk_inventory_item_pressing
    FOREIGN KEY (pressing_id) REFERENCES pressing(id) ON DELETE SET NULL;
```

`pressing_id` is nullable: Discogs linkage is never required to complete an acquire or edit.

### Discogs-to-Local Field Mapping

Only the fields stored in the lean `pressing` bookmark are listed. All other Discogs fields are available on demand via the proxy endpoint and are never written to the local database.

| Discogs field      | Local target                  | Notes                          |
| ------------------ | ----------------------------- | ------------------------------ |
| `id`               | `pressing.discogs_release_id` | Unique upsert key              |
| `resource_url`     | `pressing.discogs_resource_url` | Source pointer for proxy calls |
| `title`            | `pressing.title`              | Core display/search            |
| `artists_sort`     | `pressing.artists_sort`       | Search/sort                    |
| `year`             | `pressing.year`               | Numeric year                   |
| `country`          | `pressing.country`            | Country facet                  |
| `catno` (search result) / `labels[].catno` (release) | `pressing.catalog_number` | First catalog number; local wins on conflict |
| `identifiers[]` where `type = 'Matrix / Runout'` | `pressing.matrix` | Sides joined with ` / `; local wins on conflict |
| `label[]` (search result) / `labels[].name` (release) | `pressing.label` | First label name; local wins on conflict |

All other Discogs fields (including `master_id`, `released`, `released_formatted`, `status`, `data_quality`, market signals, community signals, tracks, images, credits, full labels array, full identifiers array) are fetched on demand and returned to the client without local persistence.

**Local database precedence:** When a local `pressing` row already holds a non-null value for any field, a re-acquire supplying a different Discogs value does not overwrite it. The upsert uses `COALESCE(pressing.<col>, EXCLUDED.<col>)` so only NULL fields are filled in. See [design.md](design.md) for the full decision record.

### Data Quality and Normalization Notes

- Partial dates may appear in Discogs responses (example pattern: `YYYY-MM-00`); these are surfaced as-is to the client from on-demand fetches and are not normalized locally.
- On-demand responses may contain empty or omitted arrays; API clients and the proxy must tolerate null/empty cases.

### Image Handling

- Images are never stored locally.
- The proxy endpoint surfaces Discogs image URLs as opaque values exactly as returned by the Discogs API.
- The UI must not request image data until the user explicitly requests it (for example, clicking a link or expanding a detail panel). This keeps API calls user-triggered.

### Interactive Release Search (Acquire and Edit Flows)

This is the primary integration path. It is user-triggered and synchronous.

1. User enters search text in the acquire or edit UI.
2. The backend calls the Discogs release search API and returns paginated candidate pressings (`GET /discogs/releases?q=...`).
3. User selects a pressing from the results.
4. The backend fetches the full release payload for the selected `discogs_release_id` from Discogs, using `discogs_resource_url` as the source pointer.
5. Upsert `pressing` by `discogs_release_id`, persisting the lean bookmark columns. Existing non-null values are never overwritten (local database precedence).
6. Link the upserted `pressing_id` to the `inventory_item` on acquire or patch.
7. Detailed release data (tracks, images, credits, market signals, etc.) is returned to the client for display only and is not written to the database.

**Fallback — No Discogs Match:**

- If the release is not found in Discogs, the user may proceed with manual entry.
- `pressing_id` on `inventory_item` is nullable; Discogs linkage is never required to complete an acquire or edit.
- In this fallback path, no `pressing` row is created or upserted; the `inventory_item` is created with `pressing_id = null`.

### On-Demand Detail Proxy

`GET /discogs/releases/{discogs_release_id}` proxies the Discogs release detail endpoint and returns the full Discogs payload to the client. The backend does not persist any detail data from this call.

Use cases:
- Displaying tracks, credits, labels, and identifiers in the release detail panel.
- Surfacing market signals (lowest price, num_for_sale, community have/want/rating) in the UI.
- Loading images when the user explicitly expands the image view.

Authentication: Cognito JWT required. The upstream Discogs call uses public database read access (no Discogs user auth required).

### Out of Scope (Current Phase): Writing to Discogs

- Creating or updating Discogs database entries from the web app requires Discogs OAuth and write-endpoint access.
- This is a natural follow-on once the interactive read/search integration is stable.
- It is explicitly deferred; no write-path implementation should be included in current work.

### Compliance and Licensing

- Discogs data includes both open and restricted categories depending on terms.
- Integration must follow Discogs API terms and application naming/description policy.
- Internal usage policy should define what fields are surfaced and redistributed.
- No Discogs payload data is stored persistently, which limits redistribution exposure.
