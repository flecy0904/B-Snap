from datetime import datetime

from pydantic import BaseModel, ConfigDict


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
