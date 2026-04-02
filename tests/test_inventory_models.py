"""
Structural tests for the inventory ORM models and migration file.

These tests verify schema invariants (table registration, column properties,
constraints, FK behavior) using SQLAlchemy metadata inspection only.
No database connection is required.
"""

import importlib
import inspect

import pytest
import sqlalchemy as sa

from app.db import Base
import app.models.inventory  # noqa: F401 — registers models on Base


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _table(name: str) -> sa.Table:
    return Base.metadata.tables[name]


def _col(table: sa.Table, col_name: str) -> sa.Column:
    return table.c[col_name]


def _check_names(table: sa.Table) -> set[str]:
    return {
        c.name
        for c in table.constraints
        if isinstance(c, sa.CheckConstraint) and c.name
    }


# ---------------------------------------------------------------------------
# Table registration
# ---------------------------------------------------------------------------

class TestTableRegistration:
    def test_inventory_item_registered(self) -> None:
        assert "inventory_item" in Base.metadata.tables

    def test_inventory_transaction_registered(self) -> None:
        assert "inventory_transaction" in Base.metadata.tables


# ---------------------------------------------------------------------------
# inventory_item columns
# ---------------------------------------------------------------------------

class TestInventoryItemColumns:
    def setup_method(self) -> None:
        self.t = _table("inventory_item")

    def test_primary_key_is_id(self) -> None:
        assert self.t.primary_key.columns.keys() == ["id"]

    def test_required_columns_present(self) -> None:
        required = {
            "id", "pressing_id", "acquisition_batch_id",
            "collection_type", "condition_media", "condition_sleeve",
            "status", "notes", "created_at", "deleted_at",
        }
        assert required.issubset(set(self.t.c.keys()))

    def test_collection_type_not_nullable(self) -> None:
        assert not _col(self.t, "collection_type").nullable

    def test_status_not_nullable(self) -> None:
        assert not _col(self.t, "status").nullable

    def test_status_has_server_default(self) -> None:
        col = _col(self.t, "status")
        assert col.server_default is not None

    def test_deleted_at_is_nullable(self) -> None:
        assert _col(self.t, "deleted_at").nullable

    def test_pressing_id_is_nullable(self) -> None:
        assert _col(self.t, "pressing_id").nullable

    def test_acquisition_batch_id_is_nullable(self) -> None:
        assert _col(self.t, "acquisition_batch_id").nullable

    def test_notes_is_nullable(self) -> None:
        assert _col(self.t, "notes").nullable


# ---------------------------------------------------------------------------
# inventory_item constraints
# ---------------------------------------------------------------------------

class TestInventoryItemConstraints:
    def setup_method(self) -> None:
        self.t = _table("inventory_item")

    def test_collection_type_check_present(self) -> None:
        assert "ck_inventory_item_collection_type" in _check_names(self.t)

    def test_status_check_present(self) -> None:
        assert "ck_inventory_item_status" in _check_names(self.t)


# ---------------------------------------------------------------------------
# inventory_transaction columns
# ---------------------------------------------------------------------------

class TestInventoryTransactionColumns:
    def setup_method(self) -> None:
        self.t = _table("inventory_transaction")

    def test_primary_key_is_id(self) -> None:
        assert self.t.primary_key.columns.keys() == ["id"]

    def test_required_columns_present(self) -> None:
        required = {
            "id", "inventory_item_id", "transaction_type",
            "price", "counterparty", "notes", "created_at",
        }
        assert required.issubset(set(self.t.c.keys()))

    def test_inventory_item_id_not_nullable(self) -> None:
        assert not _col(self.t, "inventory_item_id").nullable

    def test_transaction_type_not_nullable(self) -> None:
        assert not _col(self.t, "transaction_type").nullable

    def test_price_is_nullable(self) -> None:
        assert _col(self.t, "price").nullable

    def test_counterparty_is_nullable(self) -> None:
        assert _col(self.t, "counterparty").nullable


# ---------------------------------------------------------------------------
# inventory_transaction constraints and FK
# ---------------------------------------------------------------------------

class TestInventoryTransactionConstraints:
    def setup_method(self) -> None:
        self.t = _table("inventory_transaction")

    def test_transaction_type_check_present(self) -> None:
        assert "ck_inventory_transaction_type" in _check_names(self.t)

    def test_fk_to_inventory_item_exists(self) -> None:
        fk_targets = {
            list(fk.constraint.elements)[0].target_fullname
            for fk in self.t.c["inventory_item_id"].foreign_keys
        }
        assert "inventory_item.id" in fk_targets

    def test_fk_uses_restrict_on_delete(self) -> None:
        for fk_constraint in self.t.foreign_key_constraints:
            col_names = [c.name for c in fk_constraint.columns]
            if "inventory_item_id" in col_names:
                assert fk_constraint.ondelete.upper() == "RESTRICT"
                return
        pytest.fail("FK constraint for inventory_item_id not found")


# ---------------------------------------------------------------------------
# Relationship registration
# ---------------------------------------------------------------------------

class TestRelationships:
    def test_item_has_transactions_relationship(self) -> None:
        from app.models.inventory import InventoryItem
        mapper = sa.inspect(InventoryItem)
        assert "transactions" in mapper.relationships.keys()

    def test_transaction_has_item_relationship(self) -> None:
        from app.models.inventory import InventoryTransaction
        mapper = sa.inspect(InventoryTransaction)
        assert "item" in mapper.relationships.keys()


# ---------------------------------------------------------------------------
# Migration file structure
# ---------------------------------------------------------------------------

class TestMigrationFileStructure:
    def setup_method(self) -> None:
        self.mod = importlib.import_module(
            "migrations.versions.a271049050bc_create_inventory_tables"
        )

    def test_revision_id_set(self) -> None:
        assert self.mod.revision == "a271049050bc"  # pragma: allowlist secret

    def test_down_revision_is_none(self) -> None:
        assert self.mod.down_revision is None

    def test_upgrade_is_callable(self) -> None:
        assert callable(self.mod.upgrade)

    def test_downgrade_is_callable(self) -> None:
        assert callable(self.mod.downgrade)

    def test_upgrade_accepts_no_args(self) -> None:
        sig = inspect.signature(self.mod.upgrade)
        assert len(sig.parameters) == 0

    def test_downgrade_accepts_no_args(self) -> None:
        sig = inspect.signature(self.mod.downgrade)
        assert len(sig.parameters) == 0
