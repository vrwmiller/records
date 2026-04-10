"""rename collection_type values PERSONAL/DISTRIBUTION -> PRIVATE/PUBLIC

Revision ID: e3b7a91f2c84
Revises: 346f77d5b693
Create Date: 2026-04-10

Schema notes:
- Drops the old check constraint, renames all existing values atomically,
  then re-creates the constraint with the new allowed set.
- UPDATE statements run inside the same transaction as the DDL (Alembic
  default for non-transactional DB dialects; PostgreSQL supports this).
- NULL collection_type rows cannot exist (NOT NULL constraint), so no
  special handling is needed for absent values.

Rollback intent:
  Reverse the value rename and re-create the old constraint.
  No data is destroyed by upgrade or downgrade.
"""

from alembic import op

revision = "e3b7a91f2c84"  # pragma: allowlist secret
down_revision = "346f77d5b693"  # pragma: allowlist secret
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_inventory_item_collection_type",
        "inventory_item",
        type_="check",
    )
    op.execute(
        "UPDATE inventory_item SET collection_type = 'PRIVATE' WHERE collection_type = 'PERSONAL'"
    )
    op.execute(
        "UPDATE inventory_item SET collection_type = 'PUBLIC' WHERE collection_type = 'DISTRIBUTION'"
    )
    op.create_check_constraint(
        "ck_inventory_item_collection_type",
        "inventory_item",
        "collection_type IN ('PRIVATE', 'PUBLIC')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_inventory_item_collection_type",
        "inventory_item",
        type_="check",
    )
    op.execute(
        "UPDATE inventory_item SET collection_type = 'PERSONAL' WHERE collection_type = 'PRIVATE'"
    )
    op.execute(
        "UPDATE inventory_item SET collection_type = 'DISTRIBUTION' WHERE collection_type = 'PUBLIC'"
    )
    op.create_check_constraint(
        "ck_inventory_item_collection_type",
        "inventory_item",
        "collection_type IN ('PERSONAL', 'DISTRIBUTION')",
    )
