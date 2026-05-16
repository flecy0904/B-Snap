from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app.core.config import get_settings
from backend.app.routes.ai_canvas_notes import router as ai_canvas_notes_router
from backend.app.routes.auth import router as auth_router
from backend.app.routes.chats import router as chats_router
from backend.app.routes.class_insights import router as class_insights_router
from backend.app.routes.folders import router as folders_router
from backend.app.routes.health import router as health_router
from backend.app.routes.notes import router as notes_router
from backend.app.routes.rag import router as rag_router
from backend.app.routes.uploads import router as uploads_router
from backend.app.routes.ws import router as ws_router

settings = get_settings()
settings.upload_path.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(folders_router)
app.include_router(notes_router)
app.include_router(chats_router)
app.include_router(class_insights_router)
app.include_router(ai_canvas_notes_router)
app.include_router(rag_router)
app.include_router(uploads_router)
app.include_router(ws_router)
app.mount("/uploads", StaticFiles(directory=settings.upload_path), name="uploads")
