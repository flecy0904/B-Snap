from pydantic import BaseModel, Field


class ClassInsightPageSignalRead(BaseModel):
    page_number: int
    importance_score: int = Field(ge=0, le=100)
    priority: str
    reason_tags: list[str] = Field(default_factory=list)
    content_hint: str | None = None
    signal_count: int = Field(default=0, ge=0)
    bookmark_count: int = Field(default=0, ge=0)
    highlight_count: int = Field(default=0, ge=0)
    keyword_hits: int = Field(default=0, ge=0)
    photo_reference_count: int = Field(default=0, ge=0)
    ai_question_count: int = Field(default=0, ge=0)
    memo_page_count: int = Field(default=0, ge=0)
    handwriting_keyword_hits: int = Field(default=0, ge=0)
    handwriting_symbol_count: int = Field(default=0, ge=0)
    semantic_keywords: list[str] = Field(default_factory=list)
    semantic_symbols: list[str] = Field(default_factory=list)


class ClassInsightRead(BaseModel):
    note_id: int
    matched_note_count: int = Field(default=0, ge=0)
    participant_count: int = Field(default=0, ge=0)
    pages: list[ClassInsightPageSignalRead] = Field(default_factory=list)
