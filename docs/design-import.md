# Record Ranch – Legacy Import Design

This document covers the legacy Microsoft Access import pipeline and vinyl identifier domain notes. It is a companion to [design.md](design.md).

---

## Legacy Microsoft Access Import Design

### Source Model (Observed)

The legacy Access database centers on an `Albums` table with lookup relationships to:

- `Artists`
- `Labels`
- `Channel`
- `Cover Conditions`
- `Record Conditions`

Observed `Albums` fields include:

- Artist
- ArtistSort
- Title
- Label
- Number (catalog number)
- Discogs#
- Year
- Value
- SortOrder
- LabelDesc
- Channel
- CoverCond
- RecordCond
- CoverStyle
- CutoutMark
- Remarks
- Bonuses
- Country/Club

### Import Goals

- Preserve historical inventory without manual re-entry
- Keep provenance for every imported row
- Normalize into canonical local schema while retaining long-tail legacy attributes
- Produce deterministic, repeatable imports (idempotent by source key)

### Import File Contract

Initial supported import format:

- CSV exports from Access tables
- Required file: `albums.csv`
- Optional lookup files:
  - `artists.csv`
  - `labels.csv`
  - `channel.csv`
  - `cover_conditions.csv`
  - `record_conditions.csv`

### Staging Strategy

- Parse uploads into staging tables keyed by:
  - `import_batch_id`
  - `source_row_number`
  - `source_hash`
- Validate all rows before commit
- No direct writes from uploaded files into canonical inventory tables

### Canonical Mapping Strategy

Use a two-pass mapping process.

Pass A: metadata and pressing resolution

- Prefer `Discogs#` as external identity key when present
- Map metadata into `pressing` (title, artists_sort, year, country)
- Label is stored in `pressing.label` (first label name); sourced from `label[0]` in the Discogs search result and optionally refined from `labels[0].name` via the full release fetch. Catalog number is stored in `pressing.catalog_number`; sourced from `catno` in the search result — the release fetch does not currently backfill `catalog_number`. Both fields are nullable; legacy rows without a Discogs link will have NULL.
- Full artist text is not stored in `pressing`; it is available on demand from the Discogs API for linked releases and is preserved in import metadata for traceability
- Retain legacy-only fields in import metadata for traceability

Pass B: inventory item and transaction creation

- Create `inventory_item` with mapped condition and status fields
- Default `collection_type` to `PERSONAL` unless import options explicitly specify otherwise
- Create one `inventory_transaction` per imported item:
  - `transaction_type = acquisition`
  - notes include import batch id and source reference

### Field Mapping (Initial)

| Access `Albums` field | Local target | Notes |
| ----- | ----------- | ----- |
| Artist | `pressing.artists_sort` (sort key); raw Access Artist text preserved in import metadata | `pressing.artists_sort` is a normalized sort key, not the raw source text; canonical artist normalization is a later phase |
| ArtistSort | `pressing.artists_sort` | preferred sort key |
| Title | `pressing.title` | required for canonical display |
| Label | `pressing.label` (first label name at acquire time) | Populated from Discogs `label[]` (search result) or `labels[].name` (release payload); local value wins on re-acquire conflict |
| Number | `pressing.catalog_number` (catalog number at acquire time) | Populated from Discogs `catno` (search result only); the release fetch does not currently backfill this field; local value wins on re-acquire conflict |
| Discogs# | `pressing.discogs_release_id` | primary external key if valid |
| Year | `pressing.year` | integer coercion with validation |
| Value | import transaction metadata | estimated value, not guaranteed cost basis |
| Channel | imported as legacy attribute initially | candidate enum later |
| CoverCond | `inventory_item.condition_sleeve` | map via condition lookup |
| RecordCond | `inventory_item.condition_media` | map via condition lookup |
| CoverStyle | legacy attributes | preserve until canonicalized |
| CutoutMark | legacy attributes | preserve |
| Remarks | notes/legacy attributes | long text preservation |
| Bonuses | legacy attributes | preserve |
| Country/Club | `pressing.country` plus import flag | may contain combined semantics |

### Validation Rules

- Reject commit when required columns are missing
- Warn (not fail) on optional lookup mismatches
- Fail rows with irrecoverable key problems:
  - empty Title with no Discogs#
  - invalid numeric coercion for Year when provided
- Normalize known text fields before dedupe

### Dedupe Rules

Primary key path:

- `discogs_release_id` when present and valid

Fallback key path:

- normalized `(ArtistSort, Title, Label, Number, Year)` composite

### Auditability Requirements

- Every import run has a durable batch record
- Every created or updated inventory item is traceable to:
  - import batch id
  - source file
  - source row number
- Import summary includes inserted, updated, skipped, and failed counts

### UI Requirements for Import

- Upload step with file-level validation status
- Dry-run preview before commit
- Error export for failed rows
- Commit confirmation with summary report

---

## Vinyl Identifier and Catalog Number Domain Notes

Vinyl record identification has no industry standard. Record companies, labels, and manufacturers each followed their own conventions. The schema must accommodate this variability without enforcing uniformity that does not exist.

### Matrix Numbers

- Almost all vinyl records have matrix numbers, one per side. Not all do.
- Found etched or stamped in the **deadwax** (the silent area between the last groove and the label). Occasionally also printed on the label. Rarely on the cover.
- Identifies the mastering engineer or mastering house responsible for that side.
- May incorporate part or all of the catalog number as a prefix or suffix.
- Because matrix numbers are per-side, a single release has at least two distinct matrix values (Side A, Side B). Box sets may have many more.
- Discogs surfaces matrix numbers via `identifiers[]` in the release payload (type `'Matrix / Runout'`). Matrix is persisted locally in `pressing.matrix` (sides joined with ` / `) at acquire time.

### Catalog Numbers

- Almost all releases have a catalog number, but not all do.
- Typically appears on the cover and/or the record label.
- The "record number" is often the catalog number, but not always — the terms overlap without being interchangeable.
- Box sets frequently carry a separate catalog number for the overall set **and** distinct numbers for each individual disc inside. This relationship is not guaranteed and cannot be assumed.
- Catalog number is persisted locally in `pressing.catalog_number` from the Discogs `catno` field at acquire time. The full `labels[]` array (with all catalog numbers per label) remains available on demand from the proxy endpoint.

### Modeling Rationale

The heterogeneity of real-world vinyl data is why identifier and label data are not forced into a complex normalized local structure. Only the primary display value (first label name, first catalog number, joined matrix) is persisted locally. The full detail — `identifiers[]` and `labels[]` — is available on demand from the proxy endpoint when the user explicitly requests release detail.

Do not attempt to enforce a single canonical "the catalog number" field at the pressing level. The reality is one pressing may have multiple catalog number representations across different labels and formats, and that is correct data.
