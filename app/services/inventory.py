from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.inventory import InventoryItem, InventoryTransaction
from app.models.pressing import Pressing
from app.schemas.inventory import AcquireRequest, TransferRequest, UpdateRequest
from app.services.pressing import upsert_pressing


class NotFoundError(Exception):
    pass


def acquire(db: Session, request: AcquireRequest) -> list[InventoryItem]:
    """Create request.quantity inventory items and one acquisition transaction per item.

    All rows share a single acquisition_batch_id. The entire operation is atomic —
    if any row fails, the full request is rolled back.

    When ``request.pressing`` is provided, the pressing is upserted by
    ``discogs_release_id`` and the resulting UUID is used as ``pressing_id``.
    When only ``request.pressing_id`` is provided it is used directly.
    """
    batch_id = uuid.uuid4()
    items: list[InventoryItem] = []

    # Resolve pressing_id — upsert takes precedence over a raw UUID.
    pressing_id = request.pressing_id
    if request.pressing is not None:
        pressing_id = upsert_pressing(db, request.pressing)

    for _ in range(request.quantity):
        item = InventoryItem(
            id=uuid.uuid4(),
            acquisition_batch_id=batch_id,
            pressing_id=pressing_id,
            collection_type=request.collection_type,
            condition_media=request.condition_media,
            condition_sleeve=request.condition_sleeve,
            notes=request.notes,
            is_sealed=request.is_sealed,
        )
        db.add(item)
        db.flush()

        tx = InventoryTransaction(
            id=uuid.uuid4(),
            inventory_item_id=item.id,
            transaction_type="acquisition",
            price=request.price,
            counterparty=request.counterparty,
        )
        db.add(tx)
        items.append(item)

    db.commit()
    for item in items:
        db.refresh(item)
    # Assign the pressing object once rather than relying on lazy-loads, which
    # would trigger one extra SELECT per item when Pydantic serialises the response.
    if pressing_id is not None:
        pressing_obj = db.get(Pressing, pressing_id)
        for item in items:
            item.pressing = pressing_obj
    return items


def list_items(
    db: Session,
    collection: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[InventoryItem]:
    """Return non-deleted inventory items, optionally filtered by collection_type.

    Pressing is eager-loaded so callers can access ``item.pressing`` without a
    separate query.
    """
    q = (
        select(InventoryItem)
        .options(joinedload(InventoryItem.pressing))
        .where(InventoryItem.deleted_at.is_(None))
        .order_by(InventoryItem.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if collection is not None:
        q = q.where(InventoryItem.collection_type == collection)
    return list(db.scalars(q))


def get_summary(db: Session) -> dict[str, int]:
    """Return active item counts grouped by collection_type, plus total."""
    rows = db.execute(
        select(InventoryItem.collection_type, func.count())
        .where(InventoryItem.deleted_at.is_(None))
        .group_by(InventoryItem.collection_type)
    ).all()
    counts = {r[0]: r[1] for r in rows}
    private = counts.get("PRIVATE", 0)
    public = counts.get("PUBLIC", 0)
    return {
        "private": private,
        "public": public,
        "total": private + public,
    }


def update_item(db: Session, item_id: uuid.UUID, request: UpdateRequest) -> InventoryItem:
    """Apply allowed field updates to an active inventory item.

    When ``request.pressing`` is provided, the pressing is upserted by
    ``discogs_release_id`` and the resulting UUID replaces ``pressing_id``.
    """
    item = db.get(InventoryItem, item_id)
    if item is None or item.deleted_at is not None:
        raise NotFoundError(item_id)

    exclude_fields = {"pressing"}
    if request.pressing is not None:
        item.pressing_id = upsert_pressing(db, request.pressing)
        # exclude pressing_id from the setattr loop: the upserted UUID takes
        # precedence; a raw pressing_id in the request must not overwrite it.
        exclude_fields.add("pressing_id")

    for field, value in request.model_dump(exclude_unset=True, exclude=exclude_fields).items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return item


def transfer_item(db: Session, item_id: uuid.UUID, request: TransferRequest) -> InventoryItem:
    """Move an item to a different collection and record a transfer_collection transaction.

    Raises ValueError if the item is already in target_collection.
    """
    item = db.get(InventoryItem, item_id)
    if item is None or item.deleted_at is not None:
        raise NotFoundError(item_id)
    if item.collection_type == request.target_collection:
        raise ValueError(f"Item is already in {request.target_collection}")

    item.collection_type = request.target_collection
    tx = InventoryTransaction(
        id=uuid.uuid4(),
        inventory_item_id=item.id,
        transaction_type="transfer_collection",
    )
    db.add(tx)
    db.commit()
    db.refresh(item)
    return item


def soft_delete(db: Session, item_id: uuid.UUID) -> None:
    """Logical delete: set deleted_at and status='deleted'. Row is never physically removed."""
    item = db.get(InventoryItem, item_id)
    if item is None or item.deleted_at is not None:
        raise NotFoundError(item_id)
    item.deleted_at = datetime.now(timezone.utc)
    item.status = "deleted"
    db.commit()
