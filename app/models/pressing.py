import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    Index,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Pressing(Base):
    __tablename__ = "pressing"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_pressing"),
        # Partial unique index: unique only when discogs_release_id is set.
        # Matches migration DDL: CREATE UNIQUE INDEX ux_pressing_discogs_release_id
        # ON pressing (discogs_release_id) WHERE discogs_release_id IS NOT NULL
        Index(
            "ux_pressing_discogs_release_id",
            "discogs_release_id",
            unique=True,
            postgresql_where=text("discogs_release_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Discogs identity and linkage
    discogs_release_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    discogs_master_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    discogs_resource_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Core metadata
    title: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    artists_sort: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    country: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    released_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    released_formatted: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_quality: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Market and community signals
    num_for_sale: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lowest_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    community_have: Mapped[int | None] = mapped_column(Integer, nullable=True)
    community_want: Mapped[int | None] = mapped_column(Integer, nullable=True)
    community_rating_avg: Mapped[Decimal | None] = mapped_column(
        Numeric(4, 2), nullable=True
    )
    community_rating_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Sync and provenance
    source_last_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    sync_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_payload_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Relationships
    items: Mapped[list["InventoryItem"]] = relationship(back_populates="pressing")
