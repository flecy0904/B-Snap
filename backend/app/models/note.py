from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.base import Base


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    folder = relationship("Folder", back_populates="notes")
    pages = relationship("NotePage", back_populates="note", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="note", cascade="all, delete-orphan")
