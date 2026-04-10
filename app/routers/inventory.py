from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_role
from app.db import get_db
from app.schemas.inventory import (
    AcquireRequest,
    InventoryItemResponse,
    SummaryResponse,
    TransferRequest,
    UpdateRequest,
)
from app.services import inventory as svc

router = APIRouter(prefix="/inventory", tags=["inventory"])

_Auth = Annotated[dict[str, Any], Depends(get_current_user)]
_AdminAuth = Annotated[dict[str, Any], require_role("admin")]
_DB = Annotated[Session, Depends(get_db)]


@router.post(
    "/acquire",
    response_model=list[InventoryItemResponse],
    status_code=status.HTTP_201_CREATED,
)
def acquire(body: AcquireRequest, db: _DB, _: _AdminAuth) -> list[InventoryItemResponse]:
    items = svc.acquire(db, body)
    return [InventoryItemResponse.model_validate(i) for i in items]


@router.get("/summary", response_model=SummaryResponse)
def summary(db: _DB, _: _Auth) -> SummaryResponse:
    return SummaryResponse(**svc.get_summary(db))


@router.get("", response_model=list[InventoryItemResponse])
def list_items(
    db: _DB,
    _: _Auth,
    collection: Annotated[
        str | None, Query(pattern="^(PRIVATE|PUBLIC)$")
    ] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[InventoryItemResponse]:
    items = svc.list_items(db, collection=collection, offset=offset, limit=limit)
    return [InventoryItemResponse.model_validate(i) for i in items]


@router.post("/{item_id}/transfer", response_model=InventoryItemResponse)
def transfer_item(
    item_id: uuid.UUID,
    body: TransferRequest,
    db: _DB,
    _: _AdminAuth,
) -> InventoryItemResponse:
    try:
        item = svc.transfer_item(db, item_id, body)
    except svc.NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return InventoryItemResponse.model_validate(item)


@router.patch("/{item_id}", response_model=InventoryItemResponse)
def update_item(
    item_id: uuid.UUID,
    body: UpdateRequest,
    db: _DB,
    _: _AdminAuth,
) -> InventoryItemResponse:
    try:
        item = svc.update_item(db, item_id, body)
    except svc.NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return InventoryItemResponse.model_validate(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_item(item_id: uuid.UUID, db: _DB, _: _AdminAuth) -> None:
    try:
        svc.soft_delete(db, item_id)
    except svc.NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
