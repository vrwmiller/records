from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DiscogsPressingIn(BaseModel):
    """Lean pressing fields supplied by the client when acquiring with a Discogs release.

    The client obtains these values from a prior call to GET /discogs/releases?q=...
    or GET /discogs/releases/{id}.  The service upserts a ``pressing`` row using
    ``discogs_release_id`` as the conflict key and links the resulting UUID to the
    new inventory item.
    """

    model_config = ConfigDict(extra="forbid")

    discogs_release_id: int
    discogs_resource_url: str | None = None
    title: str | None = None
    artists_sort: str | None = None
    year: int | None = None
    country: str | None = None
