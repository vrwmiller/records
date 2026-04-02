import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class CollectionType(str, enum.Enum):
    PERSONAL = "PERSONAL"
    DISTRIBUTION = "DISTRIBUTION"


class ItemStatus(str, enum.Enum):
    ACTIVE = "active"
    SOLD = "sold"
    LOST = "lost"
    DELETED = "deleted"


class TransactionType(str, enum.Enum):
    ACQUISITION = "acquisition"
    SALE = "sale"
    TRANSFER_COLLECTION = "transfer_collection"
    TRADE = "trade"
    LOSS = "loss"
    ADJUSTMENT = "adjustment"


class InventoryItem(Base):
    __tablename__ = "inventory_item"
    __table_args__ = (
        CheckConstraint(
            "collection_type IN ('PERSONAL', 'DISTRIBUTION')",
            name="ck_inventory_item_collection_type",
        ),
        CheckConstraint(
            "status IN ('active', 'sold', 'lost', 'deleted')",
            name="ck_inventory_item_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    pressing_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    acquisition_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    collection_type: Mapped[str] = mapped_column(
        Enum(CollectionType, name="collection_type_enum", create_type=False),
        nullable=False,
    )
    condition_media: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_sleeve: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Enum(ItemStatus, name="item_status_enum", create_type=False),
        nullable=False,
        default=ItemStatus.ACTIVE,
        server_default="active",
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    transactions: Mapped[list["InventoryTransaction"]] = relationship(
        back_populates="item", order_by="InventoryTransaction.created_at"
    )


class InventoryTransaction(Base):
    __tablename__ = "inventory_transaction"
    __table_args__ = (
        CheckConstraint(
            "transaction_type IN ('acquisition','sale','transfer_collection','trade','loss','adjustment')",
            name="ck_inventory_transaction_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    inventory_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("inventory_item.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    transaction_type: Mapped[str] = mapped_column(
        Enum(TransactionType, name="transaction_type_enum", create_type=False),
        nullable=False,
    )
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    counterparty: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    item: Mapped["InventoryItem"] = relationship(back_populates="transactions")
