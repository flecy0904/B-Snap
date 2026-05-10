from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FolderCreate(BaseModel):
    name: str
    color: str | None = None


class FolderUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class FolderRead(BaseModel):
    id: int
    name: str
    color: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
