"""Unit tests for the inventory API — schemas, router, and service layer.

Router tests use FastAPI TestClient with dependency overrides for auth and DB.
Service tests call functions directly with a mocked SQLAlchemy Session.
No live database connection is required.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.models.inventory  # noqa: F401 — registers models on Base
from app.auth import get_current_user
from app.db import get_db
from app.main import app
from app.models.inventory import InventoryItem, InventoryTransaction
from app.schemas.inventory import AcquireRequest, UpdateRequest
from app.services.inventory import (
    NotFoundError,
    acquire,
    get_summary,
    list_items,
    soft_delete,
    update_item,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_USER = {"sub": "user-001", "email": "test@example.com", "cognito:groups": ["admin"]}
_FAKE_USER_NO_ROLE = {"sub": "user-002", "email": "readonly@example.com"}


def _fake_user() -> dict:
    return _FAKE_USER


def _make_item(**overrides: object) -> MagicMock:
    """Build a MagicMock with all InventoryItemResponse-compatible attributes."""
    item = MagicMock()
    item.id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    item.pressing_id = None
    item.pressing = None
    item.acquisition_batch_id = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    item.collection_type = "PERSONAL"
    item.condition_media = None
    item.condition_sleeve = None
    item.status = "active"
    item.notes = None
    item.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    item.deleted_at = None
    for k, v in overrides.items():
        setattr(item, k, v)
    return item


# ---------------------------------------------------------------------------
# Schema tests
# ---------------------------------------------------------------------------

class TestAcquireRequest:
    def test_personal_collection_accepted(self) -> None:
        r = AcquireRequest(collection_type="PERSONAL")
        assert r.collection_type == "PERSONAL"
        assert r.quantity == 1

    def test_distribution_collection_accepted(self) -> None:
        r = AcquireRequest(collection_type="DISTRIBUTION")
        assert r.collection_type == "DISTRIBUTION"

    def test_invalid_collection_type_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AcquireRequest(collection_type="OTHER")

    def test_quantity_zero_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AcquireRequest(collection_type="PERSONAL", quantity=0)

    def test_quantity_101_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AcquireRequest(collection_type="PERSONAL", quantity=101)

    def test_extra_field_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AcquireRequest(collection_type="PERSONAL", unknown_field="oops")

    def test_quantity_100_accepted(self) -> None:
        r = AcquireRequest(collection_type="PERSONAL", quantity=100)
        assert r.quantity == 100

    def test_optional_fields_default_none(self) -> None:
        r = AcquireRequest(collection_type="PERSONAL")
        assert r.pressing_id is None
        assert r.price is None
        assert r.notes is None


class TestUpdateRequest:
    def test_extra_fields_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UpdateRequest(status="sold")  # status is not patchable via this endpoint

    def test_empty_request_accepted(self) -> None:
        r = UpdateRequest()
        assert r.model_dump(exclude_unset=True) == {}


# ---------------------------------------------------------------------------
# Router fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def mock_db() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def client(mock_db: MagicMock):  # type: ignore[no-untyped-def]
    app.dependency_overrides[get_current_user] = _fake_user
    app.dependency_overrides[get_db] = lambda: mock_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def client_no_role(mock_db: MagicMock):  # type: ignore[no-untyped-def]
    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER_NO_ROLE
    app.dependency_overrides[get_db] = lambda: mock_db
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Router tests
# ---------------------------------------------------------------------------

class TestAcquireRoute:
    def test_returns_201_with_single_item(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.acquire") as mock_acquire:
            mock_acquire.return_value = [_make_item()]
            response = client.post(
                "/api/inventory/acquire",
                json={"collection_type": "PERSONAL"},
            )
        assert response.status_code == 201
        assert len(response.json()) == 1

    def test_quantity_five_returns_five_items(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.acquire") as mock_acquire:
            mock_acquire.return_value = [_make_item() for _ in range(5)]
            response = client.post(
                "/api/inventory/acquire",
                json={"collection_type": "DISTRIBUTION", "quantity": 5},
            )
        assert response.status_code == 201
        assert len(response.json()) == 5

    def test_quantity_101_rejected_before_service(self, client: TestClient) -> None:
        response = client.post(
            "/api/inventory/acquire",
            json={"collection_type": "PERSONAL", "quantity": 101},
        )
        assert response.status_code == 422

    def test_invalid_collection_type_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/inventory/acquire",
            json={"collection_type": "INVALID"},
        )
        assert response.status_code == 422


class TestListRoute:
    def test_returns_200_with_items(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.list_items") as mock_list:
            mock_list.return_value = [_make_item()]
            response = client.get("/api/inventory")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_collection_filter_passed_to_service(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.list_items") as mock_list:
            mock_list.return_value = []
            response = client.get("/api/inventory?collection=PERSONAL")
        assert response.status_code == 200
        mock_list.assert_called_once()
        assert mock_list.call_args.kwargs["collection"] == "PERSONAL"

    def test_invalid_collection_param_rejected(self, client: TestClient) -> None:
        response = client.get("/api/inventory?collection=BADVALUE")
        assert response.status_code == 422


class TestSummaryRoute:
    def test_returns_200_with_counts(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.get_summary") as mock_summary:
            mock_summary.return_value = {"personal": 3, "distribution": 2, "total": 5}
            response = client.get("/api/inventory/summary")
        assert response.status_code == 200
        body = response.json()
        assert body["personal"] == 3
        assert body["distribution"] == 2
        assert body["total"] == 5


class TestUpdateRoute:
    def test_returns_200_with_updated_item(self, client: TestClient) -> None:
        item_id = uuid.uuid4()
        with patch("app.routers.inventory.svc.update_item") as mock_update:
            mock_update.return_value = _make_item(id=item_id, condition_media="VG+")
            response = client.patch(
                f"/api/inventory/{item_id}",
                json={"condition_media": "VG+"},
            )
        assert response.status_code == 200
        assert response.json()["condition_media"] == "VG+"

    def test_not_found_returns_404(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.update_item", side_effect=NotFoundError):
            response = client.patch(
                f"/api/inventory/{uuid.uuid4()}",
                json={"condition_media": "VG+"},
            )
        assert response.status_code == 404

    def test_extra_field_in_body_rejected(self, client: TestClient) -> None:
        response = client.patch(
            f"/api/inventory/{uuid.uuid4()}",
            json={"status": "sold"},  # status not patchable via this endpoint
        )
        assert response.status_code == 422


class TestDeleteRoute:
    def test_returns_204(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.soft_delete") as mock_delete:
            mock_delete.return_value = None
            response = client.delete(f"/api/inventory/{uuid.uuid4()}")
        assert response.status_code == 204

    def test_not_found_returns_404(self, client: TestClient) -> None:
        with patch("app.routers.inventory.svc.soft_delete", side_effect=NotFoundError):
            response = client.delete(f"/api/inventory/{uuid.uuid4()}")
        assert response.status_code == 404


class TestAuthRequired:
    def test_missing_auth_header_returns_403(self) -> None:
        saved = dict(app.dependency_overrides)
        app.dependency_overrides.clear()
        try:
            c = TestClient(app)
            response = c.get("/api/inventory")
            assert response.status_code == 403
        finally:
            app.dependency_overrides.update(saved)


class TestRoleEnforcement:
    """Authenticated users without the admin role receive 403 on state-changing endpoints."""

    def test_acquire_returns_403_without_admin_role(
        self, client_no_role: TestClient
    ) -> None:
        response = client_no_role.post(
            "/api/inventory/acquire",
            json={"collection_type": "PERSONAL"},
        )
        assert response.status_code == 403

    def test_update_returns_403_without_admin_role(
        self, client_no_role: TestClient
    ) -> None:
        response = client_no_role.patch(
            f"/api/inventory/{uuid.uuid4()}",
            json={"condition_media": "VG+"},
        )
        assert response.status_code == 403

    def test_delete_returns_403_without_admin_role(
        self, client_no_role: TestClient
    ) -> None:
        response = client_no_role.delete(f"/api/inventory/{uuid.uuid4()}")
        assert response.status_code == 403

    def test_list_returns_200_without_admin_role(
        self, client_no_role: TestClient
    ) -> None:
        with patch("app.routers.inventory.svc.list_items") as mock_list:
            mock_list.return_value = []
            response = client_no_role.get("/api/inventory")
        assert response.status_code == 200

    def test_summary_returns_200_without_admin_role(
        self, client_no_role: TestClient
    ) -> None:
        with patch("app.routers.inventory.svc.get_summary") as mock_summary:
            mock_summary.return_value = {"personal": 0, "distribution": 0, "total": 0}
            response = client_no_role.get("/api/inventory/summary")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Service tests — acquire
# ---------------------------------------------------------------------------

class TestAcquireService:
    def test_single_item_creates_one_item_and_one_transaction(self) -> None:
        db = MagicMock()
        acquire(db, AcquireRequest(collection_type="PERSONAL"))
        assert db.add.call_count == 2  # 1 item + 1 transaction
        assert db.flush.call_count == 1
        assert db.commit.call_count == 1

    def test_quantity_three_creates_six_db_adds(self) -> None:
        db = MagicMock()
        acquire(db, AcquireRequest(collection_type="DISTRIBUTION", quantity=3))
        assert db.add.call_count == 6  # 3 items + 3 transactions
        assert db.flush.call_count == 3
        assert db.commit.call_count == 1

    def test_all_items_share_acquisition_batch_id(self) -> None:
        db = MagicMock()
        items = acquire(db, AcquireRequest(collection_type="PERSONAL", quantity=3))
        batch_ids = {item.acquisition_batch_id for item in items}
        assert len(batch_ids) == 1

    def test_returns_list_of_correct_length(self) -> None:
        db = MagicMock()
        result = acquire(db, AcquireRequest(collection_type="PERSONAL", quantity=4))
        assert len(result) == 4

    def test_transaction_references_item_id_and_type(self) -> None:
        db = MagicMock()
        acquire(db, AcquireRequest(collection_type="PERSONAL"))
        added = [c.args[0] for c in db.add.call_args_list]
        item_obj, tx_obj = added[0], added[1]
        assert isinstance(item_obj, InventoryItem)
        assert isinstance(tx_obj, InventoryTransaction)
        assert tx_obj.inventory_item_id == item_obj.id
        assert tx_obj.transaction_type == "acquisition"

    def test_item_ids_are_set_explicitly(self) -> None:
        db = MagicMock()
        items = acquire(db, AcquireRequest(collection_type="PERSONAL", quantity=2))
        assert all(isinstance(i.id, uuid.UUID) for i in items)
        assert items[0].id != items[1].id

    def test_pressing_upsert_called_when_pressing_provided(self) -> None:
        """When AcquireRequest.pressing is set, upsert_pressing is called and the
        resulting UUID is used as pressing_id on each created item."""
        from app.schemas.discogs import DiscogsPressingIn

        db = MagicMock()
        pressing_uuid = uuid.uuid4()
        pressing_in = DiscogsPressingIn(
            discogs_release_id=12345,
            discogs_resource_url="https://api.discogs.com/releases/12345",
            title="OK Computer",
            artists_sort="Radiohead",
            year=1997,
            country="UK",
        )
        with patch("app.services.inventory.upsert_pressing", return_value=pressing_uuid) as mock_upsert:
            items = acquire(db, AcquireRequest(collection_type="PERSONAL", pressing=pressing_in))

        mock_upsert.assert_called_once_with(db, pressing_in)
        assert items[0].pressing_id == pressing_uuid

    def test_pressing_upsert_not_called_without_pressing(self) -> None:
        db = MagicMock()
        with patch("app.services.inventory.upsert_pressing") as mock_upsert:
            acquire(db, AcquireRequest(collection_type="PERSONAL"))
        mock_upsert.assert_not_called()


# ---------------------------------------------------------------------------
# Service tests — soft_delete
# ---------------------------------------------------------------------------

class TestSoftDeleteService:
    def test_raises_not_found_when_item_missing(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        with pytest.raises(NotFoundError):
            soft_delete(db, uuid.uuid4())

    def test_raises_not_found_when_already_deleted(self) -> None:
        db = MagicMock()
        item = MagicMock()
        item.deleted_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.get.return_value = item
        with pytest.raises(NotFoundError):
            soft_delete(db, uuid.uuid4())

    def test_sets_deleted_at_and_status(self) -> None:
        db = MagicMock()
        item = MagicMock()
        item.deleted_at = None
        db.get.return_value = item
        soft_delete(db, uuid.uuid4())
        assert item.deleted_at is not None
        assert item.status == "deleted"
        db.commit.assert_called_once()


# ---------------------------------------------------------------------------
# Service tests — update_item
# ---------------------------------------------------------------------------

class TestUpdateItemService:
    def test_raises_not_found_when_item_missing(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        with pytest.raises(NotFoundError):
            update_item(db, uuid.uuid4(), UpdateRequest())

    def test_raises_not_found_when_item_deleted(self) -> None:
        db = MagicMock()
        item = MagicMock()
        item.deleted_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.get.return_value = item
        with pytest.raises(NotFoundError):
            update_item(db, uuid.uuid4(), UpdateRequest())

    def test_updates_provided_fields(self) -> None:
        db = MagicMock()
        item = MagicMock()
        item.deleted_at = None
        db.get.return_value = item
        update_item(db, uuid.uuid4(), UpdateRequest(condition_media="VG+", notes="Nice copy"))
        assert item.condition_media == "VG+"
        assert item.notes == "Nice copy"
        db.commit.assert_called_once()
        db.refresh.assert_called_once_with(item)

    def test_unset_fields_not_applied(self) -> None:
        # Verify the schema excludes unset fields correctly — the service loop
        # only calls setattr for keys present in this dict.
        request = UpdateRequest(condition_media="M")
        partial = request.model_dump(exclude_unset=True, exclude={"pressing"})
        assert partial == {"condition_media": "M"}
        assert "notes" not in partial
        assert "condition_sleeve" not in partial
        assert "pressing_id" not in partial

    def test_pressing_upsert_called_and_sets_pressing_id(self) -> None:
        """update_item() calls upsert_pressing when pressing is provided,
        and the returned UUID replaces pressing_id on the item."""
        from app.schemas.discogs import DiscogsPressingIn

        db = MagicMock()
        item = MagicMock()
        item.deleted_at = None
        db.get.return_value = item
        pressing_uuid = uuid.uuid4()
        pressing_in = DiscogsPressingIn(
            discogs_release_id=99911,
            title="Kid A",
            artists_sort="Radiohead",
            year=2000,
            country="UK",
        )

        with patch("app.services.inventory.upsert_pressing", return_value=pressing_uuid) as mock_upsert:
            update_item(db, uuid.uuid4(), UpdateRequest(pressing=pressing_in))

        mock_upsert.assert_called_once_with(db, pressing_in)
        assert item.pressing_id == pressing_uuid

    def test_pressing_upsert_excludes_raw_pressing_id_from_loop(self) -> None:
        """When pressing is provided, a simultaneous pressing_id in the request
        must not overwrite the upserted UUID via the setattr loop."""
        from app.schemas.discogs import DiscogsPressingIn

        db = MagicMock()
        item = MagicMock()
        item.deleted_at = None
        db.get.return_value = item
        upserted_uuid = uuid.uuid4()
        raw_uuid = uuid.uuid4()
        pressing_in = DiscogsPressingIn(
            discogs_release_id=12345,
            title="OK Computer",
        )

        with patch("app.services.inventory.upsert_pressing", return_value=upserted_uuid):
            update_item(
                db,
                uuid.uuid4(),
                UpdateRequest(pressing=pressing_in, pressing_id=raw_uuid),
            )

        # The upserted UUID must win — the raw pressing_id must not be applied.
        assert item.pressing_id == upserted_uuid

    def test_pressing_upsert_not_called_without_pressing(self) -> None:
        db = MagicMock()
        item = MagicMock()
        item.deleted_at = None
        db.get.return_value = item

        with patch("app.services.inventory.upsert_pressing") as mock_upsert:
            update_item(db, uuid.uuid4(), UpdateRequest(condition_media="VG"))

        mock_upsert.assert_not_called()


# ---------------------------------------------------------------------------
# Service tests — get_summary
# ---------------------------------------------------------------------------

class TestGetSummaryService:
    def test_returns_correct_counts(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = [
            ("PERSONAL", 4),
            ("DISTRIBUTION", 7),
        ]
        result = get_summary(db)
        assert result == {"personal": 4, "distribution": 7, "total": 11}

    def test_returns_zeros_when_empty(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        result = get_summary(db)
        assert result == {"personal": 0, "distribution": 0, "total": 0}

    def test_handles_single_collection(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = [("PERSONAL", 3)]
        result = get_summary(db)
        assert result["personal"] == 3
        assert result["distribution"] == 0
        assert result["total"] == 3


# ---------------------------------------------------------------------------
# Auth unit tests — JWKS error handling and token_use validation
# ---------------------------------------------------------------------------

class TestGetJwksError:
    def test_httpx_error_raises_503(self) -> None:
        from app import auth as _auth

        _auth._get_jwks.cache_clear()
        with patch("app.auth.httpx.get", side_effect=httpx.RequestError("timeout")):
            with pytest.raises(HTTPException) as exc_info:
                _auth._get_jwks()
        assert exc_info.value.status_code == 503
        _auth._get_jwks.cache_clear()

    def test_http_status_error_raises_503(self) -> None:
        from app import auth as _auth

        _auth._get_jwks.cache_clear()
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=MagicMock()
        )
        with patch("app.auth.httpx.get", return_value=mock_response):
            with pytest.raises(HTTPException) as exc_info:
                _auth._get_jwks()
        assert exc_info.value.status_code == 503
        _auth._get_jwks.cache_clear()


# ---------------------------------------------------------------------------
# Pressing upsert service (direct SQL tests)
# ---------------------------------------------------------------------------


class TestPressingService:
    """Direct unit tests for app.services.pressing.upsert_pressing().

    Uses a mocked SQLAlchemy Session so no live database is required.
    """

    def _make_pressing_in(self) -> "DiscogsPressingIn":
        from app.schemas.discogs import DiscogsPressingIn

        return DiscogsPressingIn(
            discogs_release_id=249504,
            discogs_resource_url="https://api.discogs.com/releases/249504",
            title="Never Gonna Give You Up",
            artists_sort="Astley, Rick",
            year=1987,
            country="UK",
        )

    def test_upsert_pressing_executes_insert_on_conflict(self) -> None:
        """upsert_pressing() calls db.execute with a statement containing
        INSERT … ON CONFLICT … RETURNING."""
        from app.services.pressing import upsert_pressing

        pressing_uuid = uuid.uuid4()
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = pressing_uuid

        result = upsert_pressing(db, self._make_pressing_in())

        assert result == pressing_uuid
        db.execute.assert_called_once()
        stmt_text = str(db.execute.call_args.args[0])
        assert "ON CONFLICT" in stmt_text
        assert "RETURNING" in stmt_text

    def test_upsert_pressing_passes_all_parameters(self) -> None:
        """upsert_pressing() forwards every field from DiscogsPressingIn as
        bind parameters to the SQL statement."""
        from app.services.pressing import upsert_pressing

        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = uuid.uuid4()

        pressing_in = self._make_pressing_in()
        upsert_pressing(db, pressing_in)

        params = db.execute.call_args.args[1]
        assert params["discogs_release_id"] == pressing_in.discogs_release_id
        assert params["discogs_resource_url"] == pressing_in.discogs_resource_url
        assert params["title"] == pressing_in.title
        assert params["artists_sort"] == pressing_in.artists_sort
        assert params["year"] == pressing_in.year
        assert params["country"] == pressing_in.country

    def test_upsert_pressing_returns_scalar_uuid(self) -> None:
        """upsert_pressing() propagates scalar_one() directly to the caller."""
        from app.services.pressing import upsert_pressing

        expected = uuid.uuid4()
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = expected

        result = upsert_pressing(db, self._make_pressing_in())

        assert result is expected
        db.execute.return_value.scalar_one.assert_called_once()


class TestVerifyTokenUse:
    def test_access_token_rejected_with_401(self) -> None:
        from app.auth import _verify_token

        with patch("app.auth.jwt.get_unverified_header", return_value={"kid": "k1"}):
            with patch("app.auth._get_jwks", return_value={"keys": [{"kid": "k1"}]}):
                with patch("app.auth.jwk.construct", return_value=MagicMock()):
                    with patch(
                        "app.auth.jwt.decode",
                        return_value={"token_use": "access", "sub": "u1"},
                    ):
                        with pytest.raises(HTTPException) as exc_info:
                            _verify_token("fake.token.value")
        assert exc_info.value.status_code == 401
        assert "ID token required" in exc_info.value.detail

    def test_id_token_accepted(self) -> None:
        from app.auth import _verify_token

        claims = {"token_use": "id", "sub": "u1", "email": "a@b.com"}
        with patch("app.auth.jwt.get_unverified_header", return_value={"kid": "k1"}):
            with patch("app.auth._get_jwks", return_value={"keys": [{"kid": "k1"}]}):
                with patch("app.auth.jwk.construct", return_value=MagicMock()):
                    with patch("app.auth.jwt.decode", return_value=claims):
                        result = _verify_token("fake.token.value")
        assert result == claims

