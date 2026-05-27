from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.schemas.ai_canvas_notes import AiCanvasNoteRead


class ChatSessionCreate(BaseModel):
    title: str
    model: str | None = None


class ChatSessionUpdate(BaseModel):
    title: str | None = None
    model: str | None = None


class ChatSessionRead(BaseModel):
    id: int
    note_id: int
    title: str
    model: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatMessageCreate(BaseModel):
    role: str
    content: str
    model: str | None = None


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
    page_number: int | None = Field(default=None, ge=1)
    selection_image_url: str | None = None
    context_hint: str | None = Field(default=None, max_length=4000)
    canvas_note_id: int | None = Field(default=None, ge=1)
    canvas_action: Literal["auto", "chat_only", "canvas_edit", "canvas_create"] = "auto"
    canvas_note_needs_title: bool = False
    use_rag: bool = False
    top_k: int = Field(default=5, ge=1, le=20)
    selection_image: str | None = None
    selection_rect: SelectionRectPayload | None = None


class ChatMessageRead(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    model: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatSessionDetail(ChatSessionRead):
    messages: list[ChatMessageRead]


class ChatCanvasEditRead(BaseModel):
    action: Literal["canvas_edit", "canvas_create"]
    canvas_note_id: int
    markdown: str
    title: str
    canvas_note: AiCanvasNoteRead


class ChatAiMessageRead(BaseModel):
    model: str
    user_message: ChatMessageRead
    assistant_message: ChatMessageRead
    chat_session: ChatSessionRead | None = None
    canvas_edit: ChatCanvasEditRead | None = None
