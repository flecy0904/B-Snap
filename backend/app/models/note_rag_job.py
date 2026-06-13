from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.base import Base


class NoteRagJob(Base):
    __tablename__ = "note_rag_jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "note_id", name="uq_note_rag_jobs_user_note"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), nullable=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=True)
    parser: Mapped[str] = mapped_column(String(40), nullable=False, default="docling")
    parser_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    text_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    image_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    overall_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_batches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_batches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_candidate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_completed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_indexed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    text_ready_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    image_ready_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
