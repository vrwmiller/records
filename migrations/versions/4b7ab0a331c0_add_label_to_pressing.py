"""Add label column to pressing

Revision ID: 4b7ab0a331c0
Revises: 346f77d5b693
Create Date: 2026-04-12

Schema notes:
- label: the primary record label name for this pressing, sourced from the
  Discogs search result (labels[].name) or the full release response
  (labels[].name) at acquire time.  Stored as a single TEXT value; where a
  pressing carries multiple labels only the first is persisted, which covers
  the primary attribution for display purposes.  Nullable: not all releases
  carry explicit label data, and legacy pressing rows pre-date this column.

Column is TEXT NULLABLE with no index — display-only field, not filtered or
sorted.

Rollback intent:
  Drop the column.  Any label values written after this migration will be lost
  on downgrade; pre-existing pressing data is unaffected.
"""

from alembic import op
import sqlalchemy as sa


revision = "4b7ab0a331c0"  # pragma: allowlist secret
down_revision = "346f77d5b693"  # pragma: allowlist secret
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pressing", sa.Column("label", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("pressing", "label")
