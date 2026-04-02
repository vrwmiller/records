from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryItem, InventoryTransaction
from app.schemas.inventory import AcquireRequest, UpdateRequest


class NotFoundError(Exception):
    pass


def acquire(db: Session, request: AcquireRequest) -> list[InventoryItem]:
    """Create request.quantity inventory items and one acquisition transaction per item.

    All rows share a single acquisition_batch_id. The entire operation is atomic —
    if any row fails, the full request is rolled back.
    """
    batch_id = uuid.uuid4()
    items: list[InventoryItem] = []

    for _ in range(request.quantity):
        item = InventoryItem(
            id=uuid.uuid4(),
            acquisition_batch_id=batch_id,
            pressing_id=request.pressing_id,
            collection_type=request.collection_type,
            condition_media=request.condition_media,
            condition_sleeve=request.condition_sleeve,
            notes=request.notes,
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
    return items


def list_items(
    db: Session,
    collection: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[InventoryItem]:
    """Return non-deleted inventory items, optionally filtered by collection_type."""
    q = (
        select(InventoryItem)
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
    personal = counts.get("PERSONAL", 0)
    distribution = counts.get("DISTRIBUTION", 0)
    return {
        "personal": personal,
        "distribution": distribution,
        "total": personal + distribution,
    }


def update_item(db: Session, item_id: uuid.UUID, request: UpdateRequest) -> InventoryItem:
    """Apply allowed field updates to an active inventory item."""
    item = db.get(InventoryItem, item_id)
    if item is None or item.deleted_at is not None:
        raise NotFoundError(item_id)
    for field, value in request.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
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
