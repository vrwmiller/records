"""Add catalog_number and matrix columns to pressing

Revision ID: 346f77d5b693
Revises: dcd582777257
Create Date: 2026-04-08

Schema notes:
- catalog_number: the Discogs catalog number (catno) supplied by the label for
  this pressing (e.g. "RCA PB 9693").  Populated from the search-result catno
  field at acquire/re-link time.  Nullable: not all releases carry a catalog
  number, and older bookmarks were created before this column existed.
- matrix: one or more matrix / runout strings, joined by " / " when multiple
  sides are present (e.g. "YEX 773-1 HAGG / YEX 774-1 HAGG").  Populated from
  the Discogs release identifiers array at selection time.  Nullable: matrix is
  a nice-to-have; the field is empty when the detail fetch was skipped or when
  the Discogs release contains no Matrix / Runout identifiers.

Both columns are TEXT NULLABLE with no index — they are display-only fields and
are not filtered or sorted.

Rollback intent:
  Drop both columns.  No data is at risk on downgrade.
"""

from alembic import op
import sqlalchemy as sa


revision = "346f77d5b693"  # pragma: allowlist secret
down_revision = "dcd582777257"  # pragma: allowlist secret
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pressing", sa.Column("catalog_number", sa.Text(), nullable=True))
    op.add_column("pressing", sa.Column("matrix", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("pressing", "matrix")
    op.drop_column("pressing", "catalog_number")
