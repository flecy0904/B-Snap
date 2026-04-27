from collections.abc import Generator

from psycopg import Connection

from backend.app.core.config import get_settings


def get_database_url() -> str:
    return get_settings().database_url.replace("postgresql+psycopg://", "postgresql://", 1)


def get_db_connection() -> Generator[Connection, None, None]:
    with Connection.connect(get_database_url()) as connection:
        yield connection
