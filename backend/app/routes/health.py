from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from backend.app.core.config import get_settings
from backend.app.db.health import check_database
from backend.app.db.session import get_db_connection


router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "env": settings.app_env,
    }


@router.get("/health/db")
def database_health_check(
    connection: Connection = Depends(get_db_connection),
) -> dict[str, str]:
    try:
        return check_database(connection)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
