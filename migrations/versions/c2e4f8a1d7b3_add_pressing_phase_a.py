"""add Pressing table and Phase A Discogs metadata columns

Revision ID: c2e4f8a1d7b3
Revises: a271049050bc
Create Date: 2026-04-05

Schema notes:
- Creates pressing as the Discogs-linked metadata anchor for inventory_item.
- All Discogs-fetched fields are nullable; pressing rows may exist prior to sync.
- discogs_release_id has a partial UNIQUE index (WHERE NOT NULL) to enforce
  uniqueness among linked pressings while allowing multiple unlinked rows.
- FK from inventory_item.pressing_id to pressing.id uses ON DELETE SET NULL:
  removing a pressing record unlinks items without deleting them.
- is_sealed is BOOLEAN NULL: NULL = not recorded (safe for pre-existing rows).
  TRUE = factory sealed; FALSE = confirmed open.
- Adds inventory_item indexes on pressing_id, status, and collection_type
  to support common filter and list queries.
- Adds composite index on inventory_transaction(inventory_item_id, created_at DESC)
  for per-item history lookups ordered by recency.
- Before adding the FK, any inventory_item rows with a non-NULL pressing_id are
  set to NULL. The AcquireRequest and UpdateRequest schemas accept pressing_id
  from callers, so non-NULL values may already exist in the database. This step
  makes the FK addition unconditionally safe. Affected items remain intact with
  pressing_id = NULL and can be re-linked after Phase A syncing is in place.

Rollback intent:
  Drop new inventory_transaction index, inventory_item new indexes and FK
  constraint, is_sealed column, all pressing indexes, and the pressing table.
  inventory_item rows are preserved; pressing_id reverts to a bare UUID column.
  Items whose pressing_id was cleared by upgrade retain pressing_id = NULL.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c2e4f8a1d7b3"  # pragma: allowlist secret
down_revision = "a271049050bc"  # pragma: allowlist secret
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # pressing: create table with all Phase A columns
    # ------------------------------------------------------------------
    op.create_table(
        "pressing",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Discogs identity and linkage
        sa.Column("discogs_release_id", sa.BigInteger(), nullable=True),
        sa.Column("discogs_master_id", sa.BigInteger(), nullable=True),
        sa.Column("discogs_resource_url", sa.Text(), nullable=True),
        # Core metadata
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("artists_sort", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("country", sa.Text(), nullable=True),
        sa.Column("released_text", sa.Text(), nullable=True),
        sa.Column("released_formatted", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("data_quality", sa.Text(), nullable=True),
        # Market and community signals
        sa.Column("num_for_sale", sa.Integer(), nullable=True),
        sa.Column("lowest_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("community_have", sa.Integer(), nullable=True),
        sa.Column("community_want", sa.Integer(), nullable=True),
        sa.Column("community_rating_avg", sa.Numeric(4, 2), nullable=True),
        sa.Column("community_rating_count", sa.Integer(), nullable=True),
        # Sync and provenance
        sa.Column("source_last_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_status", sa.Text(), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_pressing"),
    )

    # Partial unique index: enforce uniqueness only when discogs_release_id is set
    op.create_index(
        "ux_pressing_discogs_release_id",
        "pressing",
        ["discogs_release_id"],
        unique=True,
        postgresql_where=sa.text("discogs_release_id IS NOT NULL"),
    )
    op.create_index("ix_pressing_discogs_master_id", "pressing", ["discogs_master_id"])
    op.create_index("ix_pressing_title", "pressing", ["title"])
    op.create_index("ix_pressing_artists_sort", "pressing", ["artists_sort"])
    op.create_index("ix_pressing_year", "pressing", ["year"])
    op.create_index("ix_pressing_country", "pressing", ["country"])
    op.create_index("ix_pressing_last_synced_at", "pressing", ["last_synced_at"])

    # ------------------------------------------------------------------
    # inventory_item: add is_sealed, FK to pressing, new query indexes
    # ------------------------------------------------------------------
    op.add_column(
        "inventory_item",
        sa.Column("is_sealed", sa.Boolean(), nullable=True),
    )
    # Null out any existing pressing_id values before adding the FK.
    # AcquireRequest/UpdateRequest accept pressing_id from callers, so non-NULL
    # values may already exist. pressing is a brand-new empty table at this point,
    # so all non-NULL pressing_id values would fail the FK check. Items retain
    # all other fields and can be re-linked once Phase A sync is in place.
    op.execute("UPDATE inventory_item SET pressing_id = NULL WHERE pressing_id IS NOT NULL")
    op.create_foreign_key(
        "fk_inventory_item_pressing",
        "inventory_item",
        "pressing",
        ["pressing_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_inventory_item_pressing_id", "inventory_item", ["pressing_id"])
    op.create_index("ix_inventory_item_status", "inventory_item", ["status"])
    op.create_index(
        "ix_inventory_item_collection_type", "inventory_item", ["collection_type"]
    )

    # ------------------------------------------------------------------
    # inventory_transaction: composite index for per-item history queries
    # ------------------------------------------------------------------
    op.create_index(
        "ix_inventory_transaction_item_created",
        "inventory_transaction",
        ["inventory_item_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inventory_transaction_item_created",
        table_name="inventory_transaction",
    )

    op.drop_index("ix_inventory_item_collection_type", table_name="inventory_item")
    op.drop_index("ix_inventory_item_status", table_name="inventory_item")
    op.drop_index("ix_inventory_item_pressing_id", table_name="inventory_item")
    op.drop_constraint(
        "fk_inventory_item_pressing", "inventory_item", type_="foreignkey"
    )
    op.drop_column("inventory_item", "is_sealed")

    op.drop_index("ix_pressing_last_synced_at", table_name="pressing")
    op.drop_index("ix_pressing_country", table_name="pressing")
    op.drop_index("ix_pressing_year", table_name="pressing")
    op.drop_index("ix_pressing_artists_sort", table_name="pressing")
    op.drop_index("ix_pressing_title", table_name="pressing")
    op.drop_index("ix_pressing_discogs_master_id", table_name="pressing")
    op.drop_index("ux_pressing_discogs_release_id", table_name="pressing")
    op.drop_table("pressing")
