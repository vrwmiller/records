# Discogs API Reference

**Source:** <https://www.discogs.com/developers/#>  
**API version:** v2 (only version supported)  
**Base URL:** `https://api.discogs.com`

---

## Authentication

Record Ranch uses **Discogs token auth** (not OAuth). Every request must include:

```bash
Authorization: Discogs token={DISCOGS_TOKEN}
User-Agent: RecordRanch/1.0 +https://github.com/vrwmiller/records
Accept: application/vnd.discogs.v2.discogs+json
```

The `User-Agent` header is required — requests without it return an empty response (see FAQ below).

Token is resolved at runtime by `app/services/discogs._get_token()` in priority order:

1. **Local dev:** `DISCOGS_TOKEN` environment variable (set in `env.sh`, gitignored).
2. **Production:** `DISCOGS_TOKEN_SSM_NAME` environment variable holds the SSM parameter name. On the first Discogs request in a fresh Lambda execution environment, the token is fetched from SSM SecureString (`WithDecryption=True`) and cached for the lifetime of that environment. The token value never enters Terraform state.

The SSM parameter must be created out-of-band before `terraform apply`:

```bash
aws ssm put-parameter \
  --name "/records/prod/discogs-token" \
  --value "<your_token>" \
  --type SecureString \
  --profile records
```

---

## Rate Limiting

| Auth state       | Limit           |
|------------------|-----------------|
| Authenticated    | 60 req / minute |
| Unauthenticated  | 25 req / minute |

Rate limit uses a **moving average over a 60-second window**. Window resets if no requests are made for 60 seconds.

Response headers to monitor:

| Header                          | Meaning                                      |
|---------------------------------|----------------------------------------------|
| `X-Discogs-Ratelimit`           | Total requests allowed per minute            |
| `X-Discogs-Ratelimit-Used`      | Requests used in current window              |
| `X-Discogs-Ratelimit-Remaining` | Requests remaining in current window         |

---

## Pagination

Default page size: **50 items**. Max per page: **100**.

Query params: `page` (1-based), `per_page`.

```bash
GET https://api.discogs.com/database/search?q=nirvana&page=2&per_page=25
```

Response body includes a `pagination` object:

```json
{
  "pagination": {
    "page": 2,
    "pages": 30,
    "per_page": 25,
    "items": 750,
    "urls": {
      "first": "...",
      "prev": "...",
      "next": "...",
      "last": "..."
    }
  }
}
```

---

## Versioning and Media Types

Specify version and format via `Accept` header:

```bash
application/vnd.discogs.v2.discogs+json   ← default (Discogs markup)
application/vnd.discogs.v2.plaintext+json
application/vnd.discogs.v2.html+json
```

If no `Accept` header is supplied, defaults to `discogs+json`.

---

## Endpoints Used by Record Ranch

### Search Releases

```bash
GET /database/search?q={query}&type=release&page={page}&per_page={per_page}
```

Authentication required.

**Key query parameters:**

| Param           | Description                                      |
|-----------------|--------------------------------------------------|
| `q`             | General search query                             |
| `type`          | `release`, `master`, `artist`, or `label`        |
| `title`         | Combined "Artist Name - Release Title" search    |
| `release_title` | Release title only                               |
| `artist`        | Artist name                                      |
| `label`         | Label name                                       |
| `genre`         | Genre (e.g. `Rock`)                              |
| `style`         | Style (e.g. `Grunge`)                            |
| `country`       | Release country (e.g. `canada`)                  |
| `year`          | Release year (e.g. `1991`)                       |
| `format`        | Format (e.g. `album`, `Vinyl`)                   |
| `catno`         | Catalog number                                   |
| `barcode`       | Barcode                                          |

**Response shape (200):**

```json
{
  "pagination": { "page": 1, "pages": 66, "per_page": 3, "items": 198, "urls": { ... } },
  "results": [
    {
      "id": 2028757,
      "type": "release",
      "title": "Nirvana - Nevermind",
      "resource_url": "https://api.discogs.com/releases/2028757",
      "uri": "/Nirvana-Nevermind-Classic-Albums/release/2028757",
      "thumb": "",
      "country": "Australia",
      "year": "2005",
      "genre": ["Rock"],
      "style": ["Grunge"],
      "format": ["DVD", "PAL"],
      "label": ["Eagle Vision"],
      "catno": "RV0296",
      "community": { "want": 1, "have": 5 }
    }
  ]
}
```

**Error responses:**

| Status | Meaning                                |
|--------|----------------------------------------|
| 500    | Query time exceeded or malformed query |

---

### Get Release

```bash
GET /releases/{release_id}
```

Optional: `?curr_abbr=USD` for marketplace pricing in a specific currency.

**Key response fields:**

| Field              | Type     | Description                                        |
|--------------------|----------|----------------------------------------------------|
| `id`               | int      | Discogs release ID                                 |
| `title`            | string   | Release title                                      |
| `artists`          | array    | Artist objects with `name`, `id`, `resource_url`   |
| `artists_sort`     | string   | Canonical "Artist Name" for sorting                |
| `year`             | int      | Release year                                       |
| `country`          | string   | Country of release                                 |
| `labels`           | array    | Label objects with `name`, `catno`, `id`           |
| `formats`          | array    | Format objects with `name`, `descriptions`, `qty`  |
| `genres`           | array    | Genre strings                                      |
| `styles`           | array    | Style strings                                      |
| `tracklist`        | array    | Track objects with `position`, `title`, `duration` |
| `images`           | array    | Image objects (see Images section)                 |
| `thumb`            | string   | Thumbnail URL (300x300)                            |
| `resource_url`     | string   | Canonical API URL for this release                 |
| `uri`              | string   | Discogs web URL                                    |
| `master_id`        | int      | Master release ID (if applicable)                  |
| `master_url`       | string   | API URL for the master release                     |
| `lowest_price`     | float    | Lowest marketplace listing price                   |
| `num_for_sale`     | int      | Number of marketplace listings                     |
| `community.have`   | int      | Number of users who have this release              |
| `community.want`   | int      | Number of users who want this release              |
| `community.rating` | object   | `{ "average": float, "count": int }`               |
| `released`         | string   | Release date string (may be just a year)           |

**Error responses:**

| Status | Body                                  |
|--------|---------------------------------------|
| 404    | `{ "message": "Release not found." }` |

---

### Get Master Release

```bash
GET /masters/{master_id}
```

A master groups all pressings/versions of the same recording. The `main_release` field points to the chronologically earliest release.

**Key additional fields vs. Release:**

| Field             | Description                              |
|-------------------|------------------------------------------|
| `main_release`    | ID of the canonical release              |
| `main_release_url`| API URL for the main release             |
| `versions_url`    | API URL to list all versions             |

---

### Get Master Release Versions

```bash
GET /masters/{master_id}/versions?page={page}&per_page={per_page}
```

Optional filter params: `format`, `label`, `released`, `country`.  
Sort params: `sort` (one of `released`, `title`, `format`, `label`, `catno`, `country`), `sort_order` (`asc` or `desc`).

---

### Release Stats

```bash
GET /releases/{release_id}/stats
```

Returns community have/want counts without the full release payload. Useful for lightweight market signal updates.

```json
{ "num_have": 2315, "num_want": 467 }
```

---

## Images

Image objects returned within releases have this shape:

```json
{
  "type": "primary",
  "resource_url": "https://api-img.discogs.com/...600x600...",
  "uri": "https://api-img.discogs.com/...600x600...",
  "uri150": "https://api-img.discogs.com/...150x150...",
  "height": 600,
  "width": 600
}
```

`type` is `"primary"` or `"secondary"`. `uri150` is the thumbnail-sized variant.

**Image URLs are signed.** Do not modify any part of the URL — doing so will return a 404.

Image endpoints require authentication. See <https://www.discogs.com/developers/#page:images> for details.

---

## HTTP Status Codes

| Code | Meaning                                                                  |
|------|--------------------------------------------------------------------------|
| 200  | Success                                                                  |
| 201  | Created (POST to a collection — new resource ID in body)                 |
| 204  | No content (success, empty body)                                         |
| 401  | Unauthorized — authentication required                                   |
| 403  | Forbidden — authenticated but not permitted                              |
| 404  | Resource not found                                                       |
| 405  | Method not allowed (e.g. PUT on a read-only endpoint)                    |
| 422  | Unprocessable entity — missing/wrong param, malformed JSON               |
| 500  | Internal server error — check `message` field; report to Discogs Support |

---

## FAQ

**Why am I getting an empty response?**  
You forgot to include a `User-Agent` header.

**Why is a signed image URL returning 404?**  
Image URLs are signed — any modification (including changing the release ID in the path) invalidates the signature.

**Where do I subscribe to API change announcements?**  
<https://www.discogs.com/forum/thread/521520689469733cfcfd2089>

**Where do I register an application?**  
<https://www.discogs.com/settings/developers>
