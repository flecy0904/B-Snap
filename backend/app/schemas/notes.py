from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NoteCreate(BaseModel):
    folder_id: int
    title: str
    summary: str | None = None


class NoteUpdate(BaseModel):
    folder_id: int | None = None
    title: str | None = None
    summary: str | None = None


class NoteRead(BaseModel):
    id: int
    folder_id: int
    title: str
    summary: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotePageCreate(BaseModel):
    page_number: int
    content: str | None = None
    image_url: str | None = None


class NotePageUpdate(BaseModel):
    page_number: int | None = None
    content: str | None = None
    image_url: str | None = None


class NotePageRead(BaseModel):
    id: int
    note_id: int
    page_number: int
    content: str | None = None
    image_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
