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
- Map metadata into `pressing` (title, artist sort, label, catalog number, year, country)
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
| Artist | `pressing.raw_payload_json` and/or `pressing_credit.name` | retain exact source artist text; canonical artist normalization is a later phase |
| ArtistSort | `pressing.artists_sort` | preferred sort key |
| Title | `pressing.title` | required for canonical display |
| Label | `pressing_label.name` | normalize against lookup |
| Number | `pressing_label.catno` | source says include prefix |
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
- The `pressing_identifier` table models this directly: `identifier_type = 'Matrix / Runout'`, `value = <etched string>`, `description = <side or location note>`. Discogs surfaces these via `identifiers[]` in the release payload.

### Catalog Numbers

- Almost all releases have a catalog number, but not all do.
- Typically appears on the cover and/or the record label.
- The "record number" is often the catalog number, but not always — the terms overlap without being interchangeable.
- Box sets frequently carry a separate catalog number for the overall set **and** distinct numbers for each individual disc inside. This relationship is not guaranteed and cannot be assumed.
- Captured in the schema via `pressing_label.catno` (per-label catalog number as Discogs reports it) and optionally as a `pressing_identifier` row with `identifier_type = 'Catalog'`.

### Modeling Rationale

The heterogeneity of real-world vinyl data is the reason the schema uses:

- `pressing_identifier` as an open-typed one-to-many table keyed by `(pressing_id, identifier_type, value, description)` — handles matrix numbers, catalog numbers, barcodes, label codes, and any other identifiers Discogs or future sources expose.
- `pressing_label.catno` as the canonical per-label catalog number field, sourced from Discogs `labels[]`.
- `pressing.raw_payload_json` as the unbounded safety net for long-tail or future identifier types not yet normalized.

Do not attempt to enforce a single canonical "the catalog number" field at the pressing level. The reality is one pressing may have multiple catalog number representations across different labels and formats, and that is correct data.
