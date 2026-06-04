from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


def empty_ai_canvas_document() -> dict[str, Any]:
    return {"type": "doc", "content": []}


class AiCanvasNoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    markdown: str = ""
    document_json: dict[str, Any] = Field(default_factory=empty_ai_canvas_document)
    source_page_start: int | None = Field(default=None, ge=1)
    source_page_end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_page_range(self):
        if (
            self.source_page_start is not None
            and self.source_page_end is not None
            and self.source_page_end < self.source_page_start
        ):
            raise ValueError("source_page_end must be greater than or equal to source_page_start")
        return self


class AiCanvasNoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    markdown: str | None = None
    document_json: dict[str, Any] | None = None
    expected_revision: int | None = Field(default=None, ge=0)
    source_page_start: int | None = Field(default=None, ge=1)
    source_page_end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_page_range(self):
        if (
            self.source_page_start is not None
            and self.source_page_end is not None
            and self.source_page_end < self.source_page_start
        ):
            raise ValueError("source_page_end must be greater than or equal to source_page_start")
        return self


class AiCanvasNoteSummaryRead(BaseModel):
    id: int
    folder_id: int
    note_id: int
    title: str
    revision: int = 0
    source_page_start: int | None = None
    source_page_end: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AiCanvasNoteRead(AiCanvasNoteSummaryRead):
    markdown: str
    document_json: dict[str, Any] = Field(default_factory=empty_ai_canvas_document)
