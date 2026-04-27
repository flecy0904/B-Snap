from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import get_settings
from backend.app.routes.chats import router as chats_router
from backend.app.routes.folders import router as folders_router
from backend.app.routes.health import router as health_router
from backend.app.routes.notes import router as notes_router


settings = get_settings()

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(folders_router)
app.include_router(notes_router)
app.include_router(chats_router)
