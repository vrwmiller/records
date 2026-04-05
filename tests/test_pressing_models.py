"""
Structural tests for the Pressing ORM model and Phase A migration file.

These tests verify schema invariants (table registration, column properties,
constraints, FK behavior, relationship wiring) using SQLAlchemy metadata
inspection only. No database connection is required.
"""

import importlib
import inspect

import pytest
import sqlalchemy as sa

from app.db import Base
import app.models.inventory  # noqa: F401 — registers InventoryItem/Transaction on Base
import app.models.pressing   # noqa: F401 — registers Pressing on Base


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

class TestPressingTableRegistration:
    def test_pressing_registered(self) -> None:
        assert "pressing" in Base.metadata.tables


# ---------------------------------------------------------------------------
# pressing columns
# ---------------------------------------------------------------------------

class TestPressingColumns:
    def setup_method(self) -> None:
        self.t = _table("pressing")

    def test_primary_key_is_id(self) -> None:
        assert self.t.primary_key.columns.keys() == ["id"]

    def test_pk_constraint_named(self) -> None:
        assert self.t.primary_key.name == "pk_pressing"

    def test_id_not_nullable(self) -> None:
        assert not _col(self.t, "id").nullable

    def test_id_has_server_default(self) -> None:
        assert _col(self.t, "id").server_default is not None

    def test_created_at_not_nullable(self) -> None:
        assert not _col(self.t, "created_at").nullable

    def test_created_at_has_server_default(self) -> None:
        assert _col(self.t, "created_at").server_default is not None

    def test_discogs_identity_columns_present(self) -> None:
        for col in ("discogs_release_id", "discogs_resource_url"):
            assert col in self.t.c, f"Missing column: {col}"

    def test_dropped_columns_absent(self) -> None:
        dropped = (
            "discogs_master_id", "released_text", "released_formatted",
            "status", "data_quality", "num_for_sale", "lowest_price",
            "community_have", "community_want", "community_rating_avg",
            "community_rating_count", "source_last_changed_at",
            "last_synced_at", "sync_status", "raw_payload_json",
        )
        for col in dropped:
            assert col not in self.t.c, f"Column should be absent: {col}"

    def test_core_metadata_columns_present(self) -> None:
        for col in ("title", "artists_sort", "year", "country"):
            assert col in self.t.c, f"Missing column: {col}"

    def test_all_lean_columns_nullable(self) -> None:
        nullable_cols = [
            "discogs_release_id", "discogs_resource_url",
            "title", "artists_sort", "year", "country",
        ]
        for col_name in nullable_cols:
            assert _col(self.t, col_name).nullable, f"{col_name} should be nullable"


# ---------------------------------------------------------------------------
# inventory_item Phase A additions
# ---------------------------------------------------------------------------

class TestInventoryItemPhaseA:
    def setup_method(self) -> None:
        self.t = _table("inventory_item")

    def test_is_sealed_column_present(self) -> None:
        assert "is_sealed" in self.t.c

    def test_is_sealed_is_nullable(self) -> None:
        assert _col(self.t, "is_sealed").nullable

    def test_is_sealed_is_boolean(self) -> None:
        assert isinstance(_col(self.t, "is_sealed").type, sa.Boolean)

    def test_pressing_id_fk_exists(self) -> None:
        fk_targets = {
            list(fk.constraint.elements)[0].target_fullname
            for fk in self.t.c["pressing_id"].foreign_keys
        }
        assert "pressing.id" in fk_targets

    def test_pressing_fk_constraint_named(self) -> None:
        for fk_constraint in self.t.foreign_key_constraints:
            col_names = [c.name for c in fk_constraint.columns]
            if "pressing_id" in col_names:
                assert fk_constraint.name == "fk_inventory_item_pressing"
                return
        pytest.fail("FK constraint for pressing_id not found")

    def test_pressing_fk_uses_set_null_on_delete(self) -> None:
        for fk_constraint in self.t.foreign_key_constraints:
            col_names = [c.name for c in fk_constraint.columns]
            if "pressing_id" in col_names:
                assert fk_constraint.ondelete.upper() == "SET NULL"
                return
        pytest.fail("FK constraint for pressing_id not found")


# ---------------------------------------------------------------------------
# Relationship registration
# ---------------------------------------------------------------------------

class TestPressingRelationships:
    def test_pressing_has_items_relationship(self) -> None:
        from app.models.pressing import Pressing
        mapper = sa.inspect(Pressing)
        assert "items" in mapper.relationships.keys()

    def test_inventory_item_has_pressing_relationship(self) -> None:
        from app.models.inventory import InventoryItem
        mapper = sa.inspect(InventoryItem)
        assert "pressing" in mapper.relationships.keys()


# ---------------------------------------------------------------------------
# Phase A migration file structure
# ---------------------------------------------------------------------------

class TestPhaseAMigrationFileStructure:
    def setup_method(self) -> None:
        self.mod = importlib.import_module(
            "migrations.versions.c2e4f8a1d7b3_add_pressing_phase_a"
        )

    def test_revision_id_set(self) -> None:
        assert self.mod.revision == "c2e4f8a1d7b3"  # pragma: allowlist secret

    def test_down_revision_points_to_inventory_tables(self) -> None:
        assert self.mod.down_revision == "a271049050bc"  # pragma: allowlist secret

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


# ---------------------------------------------------------------------------
# Lean schema migration file structure
# ---------------------------------------------------------------------------

class TestLeanSchemaMigrationFileStructure:
    def setup_method(self) -> None:
        self.mod = importlib.import_module(
            "migrations.versions.dcd582777257_trim_pressing_lean_schema"
        )

    def test_revision_id_set(self) -> None:
        assert self.mod.revision == "dcd582777257"  # pragma: allowlist secret

    def test_down_revision_points_to_phase_a(self) -> None:
        assert self.mod.down_revision == "c2e4f8a1d7b3"  # pragma: allowlist secret

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
