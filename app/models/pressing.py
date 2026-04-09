import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Text,
    Uuid,
    func,
    text,
)
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

    # Discogs identity and linkage — lean bookmark only.
    # Heavyweight detail (tracks, images, credits, market signals) is fetched
    # on demand and not stored. Lightweight pressing-level detail that aids
    # identification (catalog_number, matrix) is persisted locally.
    discogs_release_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    discogs_resource_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Core metadata for list views
    title: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    artists_sort: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    country: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    catalog_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    matrix: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    items: Mapped[list["InventoryItem"]] = relationship(back_populates="pressing")
