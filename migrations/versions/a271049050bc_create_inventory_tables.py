"""create inventory_item and inventory_transaction tables

Revision ID: a271049050bc
Revises:
Create Date: 2026-04-01

Schema notes:
- collection_type and status are native TEXT with CHECK constraints rather than
  PG enum types so that adding new variants does not require DDL type alteration.
- deleted_at is nullable; NULL means not deleted (soft-delete pattern).
- FK from inventory_transaction to inventory_item uses RESTRICT to preserve
  audit history — transactions cannot be orphaned by a delete.
- Indexes:
  acquisition_batch_id — supports grouping queries for batch-acquired copies.
  inventory_transaction.inventory_item_id — supports per-item history lookups.

Rollback intent:
  Drop both tables in reverse dependency order (transactions first).
  No data-destructive side effects beyond table removal.
"""

from alembic import op
import sqlalchemy as sa

revision = "a271049050bc"  # pragma: allowlist secret
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pressing_id", sa.Uuid(), nullable=True),
        sa.Column("acquisition_batch_id", sa.Uuid(), nullable=True),
        sa.Column("collection_type", sa.Text(), nullable=False),
        sa.Column("condition_media", sa.Text(), nullable=True),
        sa.Column("condition_sleeve", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),

        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_inventory_item"),
        sa.CheckConstraint(
            "collection_type IN ('PERSONAL', 'DISTRIBUTION')",
            name="ck_inventory_item_collection_type",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'sold', 'lost', 'deleted')",
            name="ck_inventory_item_status",
        ),
    )
    op.create_index(
        "ix_inventory_item_acquisition_batch_id",
        "inventory_item",
        ["acquisition_batch_id"],
    )

    op.create_table(
        "inventory_transaction",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("inventory_item_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_type", sa.Text(), nullable=False),
        sa.Column("price", sa.Numeric(10, 2), nullable=True),
        sa.Column("counterparty", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_inventory_transaction"),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"],
            ["inventory_item.id"],
            name="fk_inventory_transaction_item",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "transaction_type IN ('acquisition','sale','transfer_collection','trade','loss','adjustment')",
            name="ck_inventory_transaction_type",
        ),
    )
    op.create_index(
        "ix_inventory_transaction_inventory_item_id",
        "inventory_transaction",
        ["inventory_item_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_transaction_inventory_item_id", table_name="inventory_transaction")
    op.drop_table("inventory_transaction")
    op.drop_index("ix_inventory_item_acquisition_batch_id", table_name="inventory_item")
    op.drop_table("inventory_item")
