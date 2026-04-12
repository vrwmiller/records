"""Pressing upsert service.

A ``pressing`` row is a lean bookmark that anchors an ``inventory_item`` to a
Discogs release.  The partial unique index on ``discogs_release_id``
(WHERE discogs_release_id IS NOT NULL) is the conflict target; any duplicate
Discogs release ID resolves to the same pressing row, keeping the local table
normalised.
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.discogs import DiscogsPressingIn


def upsert_pressing(db: Session, pressing_in: DiscogsPressingIn) -> uuid.UUID:
    """Insert or update a pressing row keyed on *discogs_release_id*.

    Uses a PostgreSQL ``INSERT … ON CONFLICT … DO UPDATE`` against the partial
    unique index ``ux_pressing_discogs_release_id``.  Returns the pressing UUID
    that should be linked to the new or updated ``inventory_item``.
    """
    stmt = text(
        """
        INSERT INTO pressing
            (discogs_release_id, discogs_resource_url, title, artists_sort, year, country,
             catalog_number, matrix, label)
        VALUES
            (:discogs_release_id, :discogs_resource_url, :title, :artists_sort, :year, :country,
             :catalog_number, :matrix, :label)
        ON CONFLICT (discogs_release_id)
        WHERE discogs_release_id IS NOT NULL
        DO UPDATE SET
            discogs_resource_url = EXCLUDED.discogs_resource_url,
            title                = EXCLUDED.title,
            artists_sort         = EXCLUDED.artists_sort,
            year                 = EXCLUDED.year,
            country              = EXCLUDED.country,
            catalog_number       = COALESCE(EXCLUDED.catalog_number, pressing.catalog_number),
            matrix               = COALESCE(EXCLUDED.matrix, pressing.matrix),
            label                = COALESCE(EXCLUDED.label, pressing.label)
        RETURNING id
        """
    )
    row = db.execute(
        stmt,
        {
            "discogs_release_id": pressing_in.discogs_release_id,
            "discogs_resource_url": pressing_in.discogs_resource_url,
            "title": pressing_in.title,
            "artists_sort": pressing_in.artists_sort,
            "year": pressing_in.year,
            "country": pressing_in.country,
            "catalog_number": pressing_in.catalog_number,
            "matrix": pressing_in.matrix,
            "label": pressing_in.label,
        },
    )
    return row.scalar_one()
