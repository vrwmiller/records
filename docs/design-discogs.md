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
  country              TEXT
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

All other Discogs fields (including `master_id`, `released`, `released_formatted`, `status`, `data_quality`, market signals, community signals, tracks, images, credits, labels, identifiers) are fetched on demand and returned to the client without local persistence.

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
5. Upsert `pressing` by `discogs_release_id`, persisting only the eight lean columns.
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

### Pagination Rules

- Default page size is 50
- Max page size is 100
- Sync jobs must follow both:
  - `Link` response header relations (`next`, `prev`, `first`, `last`)
  - Response body `pagination` object

### Schema Extension Strategy

Hybrid storage is required to support Discogs payload breadth without over-normalizing early.

- Keep `inventory_item` focused on local ownership/lifecycle state
- Expand `pressing` as the Discogs-linked metadata anchor
- Add a raw payload field for long-tail attributes
- Normalize selected arrays into child tables where queryability is needed

Recommended `pressing` extension fields:

- identity and linkage:
  - `discogs_release_id` (unique)
  - `discogs_master_id` (nullable)
  - `discogs_resource_url`
- core metadata:
  - `title`, `artists_sort`, `year`, `country`, `released`, `released_formatted`
  - `data_quality`, `status`
- market and community signals:
  - `num_for_sale`, `lowest_price`
  - `community_have`, `community_want`, `community_rating_avg`, `community_rating_count`
- sync and provenance:
  - `source_last_changed_at` (from Discogs)
  - `last_synced_at`
  - `sync_status`
  - `raw_payload_json`

Recommended child tables (phaseable):

- `pressing_identifier` (type, value, description)
- `pressing_track` (position, title, duration, type)
- `pressing_image` (type, uri, uri150, width, height)
- `pressing_video` (uri, title, duration, embed)
- `pressing_credit` (name, role, anv, discogs_artist_id)
- `pressing_company` (name, role/entity type, discogs_label_id)
- `pressing_label` (name, catno, discogs_label_id)

### Proposed SQL Schema (Concrete Target)

The following target schema is intended for PostgreSQL and can be implemented with Alembic migrations.

```sql
-- Existing inventory tables remain system-of-record for ownership state.

-- pressing is the local metadata anchor for a Discogs release.
-- pressing_id in inventory_item is UUID (see design.md); pressing.id must match.
CREATE TABLE IF NOT EXISTS pressing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pressing
  ADD COLUMN discogs_release_id BIGINT,
  ADD COLUMN discogs_master_id BIGINT,
  ADD COLUMN discogs_resource_url TEXT,
  ADD COLUMN title TEXT,
  ADD COLUMN artists_sort TEXT,
  ADD COLUMN year INTEGER,
  ADD COLUMN country TEXT,
  ADD COLUMN released_text TEXT,
  ADD COLUMN released_formatted TEXT,
  ADD COLUMN status TEXT,
  ADD COLUMN data_quality TEXT,
  ADD COLUMN num_for_sale INTEGER,
  ADD COLUMN lowest_price NUMERIC(12,2),
  ADD COLUMN community_have INTEGER,
  ADD COLUMN community_want INTEGER,
  ADD COLUMN community_rating_avg NUMERIC(4,2),
  ADD COLUMN community_rating_count INTEGER,
  ADD COLUMN source_last_changed_at TIMESTAMPTZ,
  ADD COLUMN last_synced_at TIMESTAMPTZ,
  ADD COLUMN sync_status TEXT,
  ADD COLUMN raw_payload_json JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pressing_discogs_release_id
  ON pressing (discogs_release_id)
  WHERE discogs_release_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_pressing_discogs_master_id ON pressing (discogs_master_id);
CREATE INDEX IF NOT EXISTS ix_pressing_title ON pressing (title);
CREATE INDEX IF NOT EXISTS ix_pressing_artists_sort ON pressing (artists_sort);
CREATE INDEX IF NOT EXISTS ix_pressing_year ON pressing (year);
CREATE INDEX IF NOT EXISTS ix_pressing_country ON pressing (country);
CREATE INDEX IF NOT EXISTS ix_pressing_last_synced_at ON pressing (last_synced_at);

CREATE TABLE IF NOT EXISTS pressing_identifier (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pressing_identifier_key
  ON pressing_identifier (pressing_id, identifier_type, value, COALESCE(description, ''));

CREATE TABLE IF NOT EXISTS pressing_track (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  position TEXT,
  track_type TEXT,
  title TEXT NOT NULL,
  duration_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pressing_track_pressing_id ON pressing_track (pressing_id);

CREATE TABLE IF NOT EXISTS pressing_image (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  image_type TEXT,
  uri TEXT NOT NULL,
  uri150 TEXT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pressing_image_uri
  ON pressing_image (pressing_id, uri);

CREATE TABLE IF NOT EXISTS pressing_video (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  title TEXT,
  description TEXT,
  duration_seconds INTEGER,
  embed BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pressing_video_uri
  ON pressing_video (pressing_id, uri);

CREATE TABLE IF NOT EXISTS pressing_credit (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  discogs_artist_id BIGINT,
  name TEXT NOT NULL,
  anv TEXT,
  role TEXT,
  tracks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pressing_credit_pressing_id ON pressing_credit (pressing_id);
CREATE INDEX IF NOT EXISTS ix_pressing_credit_artist_id ON pressing_credit (discogs_artist_id);

CREATE TABLE IF NOT EXISTS pressing_company (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  discogs_label_id BIGINT,
  name TEXT NOT NULL,
  entity_type_code TEXT,
  entity_type_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pressing_company_pressing_id ON pressing_company (pressing_id);
CREATE INDEX IF NOT EXISTS ix_pressing_company_label_id ON pressing_company (discogs_label_id);

CREATE TABLE IF NOT EXISTS pressing_label (
  id BIGSERIAL PRIMARY KEY,
  pressing_id UUID NOT NULL REFERENCES pressing(id) ON DELETE CASCADE,
  discogs_label_id BIGINT,
  name TEXT NOT NULL,
  catno TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pressing_label_pressing_id ON pressing_label (pressing_id);
CREATE INDEX IF NOT EXISTS ix_pressing_label_label_id ON pressing_label (discogs_label_id);

ALTER TABLE inventory_item
  ADD COLUMN IF NOT EXISTS acquisition_batch_id UUID;

ALTER TABLE inventory_item
  ADD COLUMN IF NOT EXISTS is_sealed BOOLEAN NULL;
  -- NULL = not recorded (safe default for legacy imports)
  -- TRUE  = factory sealed
  -- FALSE = confirmed open

-- Inventory-focused indexes for query and event retrieval patterns.
CREATE INDEX IF NOT EXISTS ix_inventory_item_collection_type ON inventory_item (collection_type);
CREATE INDEX IF NOT EXISTS ix_inventory_item_status ON inventory_item (status);
CREATE INDEX IF NOT EXISTS ix_inventory_item_pressing_id ON inventory_item (pressing_id);
CREATE INDEX IF NOT EXISTS ix_inventory_item_acquisition_batch_id ON inventory_item (acquisition_batch_id);
CREATE INDEX IF NOT EXISTS ix_inventory_transaction_item_created
  ON inventory_transaction (inventory_item_id, created_at DESC);
```

### Migration Plan (Phased)

Phase A: core Discogs linkage

- Add core columns to `pressing`
- Add `acquisition_batch_id` to `inventory_item` for quantity-assisted acquisition grouping
- Add unique/indexed keys for `discogs_release_id` and common filters
- Start storing `raw_payload_json`, `last_synced_at`, and `sync_status`

Phase B: queryable detail tables

- Create `pressing_identifier`, `pressing_track`, `pressing_image`, `pressing_video`
- Create `pressing_credit`, `pressing_company`, `pressing_label`
- Implement idempotent upsert logic and release-scoped replace behavior

Phase C: performance hardening

- Add additional indexes based on observed query plans
- Add optional GIN index on `raw_payload_json` if ad hoc JSON queries are needed
- Add background sync metrics and stale-data re-sync jobs

### Discogs-to-Local Field Mapping (Initial)

| Discogs field | Local target | Notes |
| ----- | ----------- | ----- |
| `id` | `pressing.discogs_release_id` | Unique upsert key |
| `master_id` | `pressing.discogs_master_id` | Nullable |
| `resource_url` | `pressing.discogs_resource_url` | Source pointer |
| `title` | `pressing.title` | Core display/search |
| `artists_sort` | `pressing.artists_sort` | Search/sort |
| `year` | `pressing.year` | Numeric year |
| `country` | `pressing.country` | Country facet |
| `released` | `pressing.released_text` | Preserve partial dates |
| `released_formatted` | `pressing.released_formatted` | Display-friendly |
| `status` | `pressing.status` | Discogs entry status |
| `data_quality` | `pressing.data_quality` | Quality signal |
| `num_for_sale` | `pressing.num_for_sale` | Market signal |
| `lowest_price` | `pressing.lowest_price` | Market signal |
| `community.have` | `pressing.community_have` | Demand/supply proxy |
| `community.want` | `pressing.community_want` | Demand/supply proxy |
| `community.rating.average` | `pressing.community_rating_avg` | Rating summary |
| `community.rating.count` | `pressing.community_rating_count` | Rating sample size |
| `date_changed` | `pressing.source_last_changed_at` | Source freshness |
| `identifiers[]` | `pressing_identifier` rows | One-to-many |
| `tracklist[]` | `pressing_track` rows | One-to-many |
| `images[]` | `pressing_image` rows | One-to-many |
| `videos[]` | `pressing_video` rows | One-to-many |
| `extraartists[]` | `pressing_credit` rows | One-to-many |
| `companies[]` | `pressing_company` rows | Role-aware |
| `labels[]` | `pressing_label` rows | One-to-many |
| full response JSON | `pressing.raw_payload_json` | Long-tail and audit |

### Data Quality and Normalization Notes

- Partial dates may appear (example pattern: `YYYY-MM-00`)
- Repeated entities may appear with different roles; dedupe must include role context
- Long text fields (for example notes) require unbounded text storage
- Arrays can be empty or omitted; parsers must tolerate null/empty cases

### Image Handling

- Treat image URLs as opaque values and store exactly as returned
- Do not infer or mutate URL segments
- Optional later phase:
  - local image caching with integrity and refresh policy

### Interactive Release Search (Acquire and Edit Flows)

This is the primary integration path. It is user-triggered and synchronous.

1. User enters search text in the acquire or edit UI
2. The backend calls the Discogs release search API and returns paginated candidate pressings (`GET /discogs/releases?q=...`)
3. User selects a pressing from the results
4. The backend fetches the full release payload for the selected `discogs_release_id` from Discogs
5. Upsert `pressing` by `discogs_release_id`
6. Persist raw payload snapshot and sync metadata (`raw_payload_json`, `last_synced_at`, `sync_status`)
7. Link the upserted `pressing_id` to the `inventory_item` on acquire or patch

**Fallback — No Discogs Match:**

- If the release is not found in Discogs, the user may proceed with manual entry
- `pressing_id` on `inventory_item` is nullable; Discogs linkage is never required to complete an acquire or edit
- In this fallback path, no `pressing` row is created or upserted; the `inventory_item` is created with `pressing_id = null`

### Background Sync (Future Phase)

Background sync refreshes market signals and metadata for already-linked pressings. It is not triggered by user action.

1. Resolve `discogs_release_id` for pressings with `last_synced_at` older than threshold or `sync_status = stale`
2. Fetch release payload from Discogs API
3. Upsert `pressing` by `discogs_release_id`
4. Replace/upsert selected child-table rows for the release
5. Persist raw payload snapshot and sync metadata

Background sync is a Phase C concern and should not be conflated with the interactive search flow.

### Out of Scope (Current Phase): Writing to Discogs

- Creating or updating Discogs database entries from the web app requires Discogs OAuth and write-endpoint access
- This is a natural follow-on once the interactive read/search integration is stable
- It is explicitly deferred; no write-path implementation should be included in Phase A or B work

### Compliance and Licensing

- Discogs data includes both open and restricted categories depending on terms
- Integration must follow Discogs API terms and application naming/description policy
- Internal usage policy should define what fields are stored, surfaced, and redistributed
