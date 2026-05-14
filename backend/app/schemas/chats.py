from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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


class ChatAiMessageCreate(BaseModel):
    content: str
    model: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    selection_image_url: str | None = None
    use_rag: bool = False
    top_k: int = Field(default=5, ge=1, le=20)


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


class ChatAiMessageRead(BaseModel):
    model: str
    user_message: ChatMessageRead
    assistant_message: ChatMessageRead
    chat_session: ChatSessionRead | None = None
