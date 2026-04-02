from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AcquireRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    collection_type: str
    quantity: int = Field(default=1, ge=1, le=100)
    pressing_id: uuid.UUID | None = None
    condition_media: str | None = None
    condition_sleeve: str | None = None
    notes: str | None = None
    price: Decimal | None = None
    counterparty: str | None = None

    @field_validator("collection_type")
    @classmethod
    def validate_collection_type(cls, v: str) -> str:
        if v not in ("PERSONAL", "DISTRIBUTION"):
            raise ValueError("collection_type must be PERSONAL or DISTRIBUTION")
        return v


class InventoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pressing_id: uuid.UUID | None
    acquisition_batch_id: uuid.UUID | None
    collection_type: str
    condition_media: str | None
    condition_sleeve: str | None
    status: str
    notes: str | None
    created_at: datetime
    deleted_at: datetime | None


class UpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    condition_media: str | None = None
    condition_sleeve: str | None = None
    notes: str | None = None
    pressing_id: uuid.UUID | None = None


class SummaryResponse(BaseModel):
    personal: int
    distribution: int
    total: int
