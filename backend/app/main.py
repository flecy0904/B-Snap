from fastapi import FastAPI

from backend.app.core.config import get_settings
from backend.app.routes.chats import router as chats_router
from backend.app.routes.folders import router as folders_router
from backend.app.routes.health import router as health_router
from backend.app.routes.notes import router as notes_router


settings = get_settings()

app = FastAPI(title=settings.app_name)
app.include_router(health_router)
app.include_router(folders_router)
app.include_router(notes_router)
app.include_router(chats_router)
