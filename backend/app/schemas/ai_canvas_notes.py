from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AiCanvasNoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    markdown: str = ""
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
    source_page_start: int | None = None
    source_page_end: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AiCanvasNoteRead(AiCanvasNoteSummaryRead):
    markdown: str
