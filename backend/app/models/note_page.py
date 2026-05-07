from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.base import Base


class NotePage(Base):
    __tablename__ = "note_pages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text, nullable=True)
    image_url: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    note = relationship("Note", back_populates="pages")
