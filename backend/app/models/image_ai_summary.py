from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.base import Base


class ImageAiSummary(Base):
    __tablename__ = "image_ai_summaries"
    __table_args__ = (
        UniqueConstraint("user_id", "note_id", "page_number", "crop_hash", name="uq_image_ai_summaries_user_note_page_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer, index=True)
    candidate_type: Mapped[str] = mapped_column(String(40), nullable=False)
    docling_ref: Mapped[str] = mapped_column(Text, nullable=True)
    crop_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    image_hash: Mapped[str] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    skipped_reason: Mapped[str] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=True)
    ocr_text: Mapped[str] = mapped_column(Text, nullable=True)
    confidence: Mapped[str] = mapped_column(String(16), nullable=True)
    importance: Mapped[str] = mapped_column(String(16), nullable=True)
    confidence_reason: Mapped[str] = mapped_column(Text, nullable=True)
    importance_reason: Mapped[str] = mapped_column(Text, nullable=True)
    indexed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    summary_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, server_default="{}")
    analyzed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    indexed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
