"""Trim pressing to lean bookmark schema — drop sync and market columns

Revision ID: dcd582777257
Revises: c2e4f8a1d7b3
Create Date: 2026-04-05

Schema notes:
- Reduces pressing to a lean bookmark: only the fields needed to anchor an
  inventory_item to a Discogs release and render a list-view row.
- All detail data (tracks, images, credits, labels, market signals, community
  signals, raw payload) is fetched on demand from the Discogs API via a proxy
  endpoint and is never stored locally. This decision was made to control
  storage costs; the Discogs API is a reliable read-only source and rate limits
  are not a concern at human interaction pace (60 req/min authenticated).
- Phase B child tables (pressing_track, pressing_identifier, pressing_image,
  pressing_video, pressing_credit, pressing_company, pressing_label) and Phase C
  background sync are cancelled. No background sync job will exist.
- Columns dropped from pressing: discogs_master_id, released_text,
  released_formatted, status, data_quality, num_for_sale, lowest_price,
  community_have, community_want, community_rating_avg, community_rating_count,
  source_last_changed_at, last_synced_at, sync_status, raw_payload_json.
- Indexes dropped: ix_pressing_discogs_master_id, ix_pressing_last_synced_at.
- Columns and indexes retained: id, created_at, discogs_release_id,
  discogs_resource_url, title, artists_sort, year, country; indexes
  ux_pressing_discogs_release_id, ix_pressing_title, ix_pressing_artists_sort,
  ix_pressing_year, ix_pressing_country.

Rollback intent:
  Re-add all fifteen dropped columns (all nullable, zero data loss) and
  restore the two dropped indexes. No data recovery is needed; columns were
  empty at time of drop.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "dcd582777257"  # pragma: allowlist secret
down_revision = "c2e4f8a1d7b3"  # pragma: allowlist secret
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop indexes on columns being removed before dropping the columns.
    op.drop_index("ix_pressing_discogs_master_id", table_name="pressing")
    op.drop_index("ix_pressing_last_synced_at", table_name="pressing")

    # Drop sync and provenance columns
    op.drop_column("pressing", "source_last_changed_at")
    op.drop_column("pressing", "last_synced_at")
    op.drop_column("pressing", "sync_status")
    op.drop_column("pressing", "raw_payload_json")

    # Drop market and community signal columns
    op.drop_column("pressing", "num_for_sale")
    op.drop_column("pressing", "lowest_price")
    op.drop_column("pressing", "community_have")
    op.drop_column("pressing", "community_want")
    op.drop_column("pressing", "community_rating_avg")
    op.drop_column("pressing", "community_rating_count")

    # Drop extended metadata columns not needed for list views
    op.drop_column("pressing", "discogs_master_id")
    op.drop_column("pressing", "released_text")
    op.drop_column("pressing", "released_formatted")
    op.drop_column("pressing", "status")
    op.drop_column("pressing", "data_quality")


def downgrade() -> None:
    # Re-add extended metadata columns
    op.add_column("pressing", sa.Column("data_quality", sa.Text(), nullable=True))
    op.add_column("pressing", sa.Column("status", sa.Text(), nullable=True))
    op.add_column("pressing", sa.Column("released_formatted", sa.Text(), nullable=True))
    op.add_column("pressing", sa.Column("released_text", sa.Text(), nullable=True))
    op.add_column("pressing", sa.Column("discogs_master_id", sa.BigInteger(), nullable=True))

    # Re-add market and community signal columns
    op.add_column(
        "pressing", sa.Column("community_rating_count", sa.Integer(), nullable=True)
    )
    op.add_column(
        "pressing",
        sa.Column("community_rating_avg", sa.Numeric(precision=4, scale=2), nullable=True),
    )
    op.add_column("pressing", sa.Column("community_want", sa.Integer(), nullable=True))
    op.add_column("pressing", sa.Column("community_have", sa.Integer(), nullable=True))
    op.add_column(
        "pressing",
        sa.Column("lowest_price", sa.Numeric(precision=12, scale=2), nullable=True),
    )
    op.add_column("pressing", sa.Column("num_for_sale", sa.Integer(), nullable=True))

    # Re-add sync and provenance columns
    op.add_column(
        "pressing",
        sa.Column("raw_payload_json", postgresql.JSONB(), nullable=True),
    )
    op.add_column("pressing", sa.Column("sync_status", sa.Text(), nullable=True))
    op.add_column(
        "pressing",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "pressing",
        sa.Column("source_last_changed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Restore indexes
    op.create_index("ix_pressing_discogs_master_id", "pressing", ["discogs_master_id"])
    op.create_index("ix_pressing_last_synced_at", "pressing", ["last_synced_at"])
