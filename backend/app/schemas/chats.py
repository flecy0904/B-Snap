from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.schemas.ai_canvas_notes import AiCanvasNoteRead
from backend.app.schemas.rag import RetrievedContext

ChatMessageSource = Literal["chat", "canvas-mini", "canvas-block"]
AiContextMode = Literal["general", "rag"]
# RAG v1 only supports pinned notes and explicit Canvas notes.
RagScopeSourceType = Literal["note", "canvas_note"]


class RagScopeSource(BaseModel):
    id: str
    type: RagScopeSourceType
    title: str


class RagScope(BaseModel):
    sourceIds: list[str] = Field(default_factory=list)
    sources: list[RagScopeSource] = Field(default_factory=list)

CanvasRecommendationMode = Literal[
    "polish",
    "simplify",
    "professionalize",
    "shorten",
    "expand",
    "restructure",
    "extract_key_points",
    "mark_uncertain",
]


class ChatSessionCreate(BaseModel):
    title: str
    model: str | None = None
    rag_scope: RagScope | None = None


class ChatSessionUpdate(BaseModel):
    title: str | None = None
    model: str | None = None
    rag_scope: RagScope | None = None


class ChatSessionRead(BaseModel):
    id: int
    note_id: int
    title: str
    model: str | None = None
    rag_scope: RagScope | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatMessageCreate(BaseModel):
    role: str
    content: str
    model: str | None = None
    source: ChatMessageSource = "chat"


class SelectionRectPayload(BaseModel):
    x: float
    y: float
    width: float
    height: float
    mode: str | None = None
    pageWidth: float | None = None
    pageHeight: float | None = None


class ChatAiMessageCreate(BaseModel):
    content: str
    model: str | None = None
    source: ChatMessageSource = "chat"
    page_number: int | None = Field(default=None, ge=1)
    selection_image_url: str | None = None
    context_hint: str | None = Field(default=None, max_length=4000)
    canvas_note_id: int | None = Field(default=None, ge=1)
    canvas_action: Literal["auto", "chat_only", "canvas_edit", "canvas_create"] = "auto"
    canvas_note_needs_title: bool = False
    canvas_markdown: str | None = None
    canvas_document_json: dict[str, Any] | None = None
    canvas_block_context: dict[str, Any] | None = None
    rag_scope: RagScope | None = None
    canvas_recommendation_mode: CanvasRecommendationMode | None = None
    use_rag: bool = False
    top_k: int = Field(default=5, ge=1, le=20)
    selection_image: str | None = None
    selection_rect: SelectionRectPayload | None = None


class ChatMessageRead(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    source: str = "chat"
    model: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatSessionDetail(ChatSessionRead):
    messages: list[ChatMessageRead]


class ChatCanvasEditRead(BaseModel):
    action: Literal["canvas_edit", "canvas_create"]
    canvas_note_id: int
    title: str
    canvas_note: AiCanvasNoteRead
    operations: list[dict[str, Any]]


class ChatAiMessageRead(BaseModel):
    model: str
    user_message: ChatMessageRead
    assistant_message: ChatMessageRead
    chat_session: ChatSessionRead | None = None
    canvas_edit: ChatCanvasEditRead | None = None
    context_mode: AiContextMode | None = None
    rewritten_query: str | None = None
    rag_scope: RagScope | None = None
    sources: list[RetrievedContext] = Field(default_factory=list)
    debug: dict[str, Any] | None = None
