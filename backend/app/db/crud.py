from typing import Any

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import dict_row


Row = dict[str, Any]


def fetch_one(connection: Connection, query: str, params: tuple[Any, ...] = ()) -> Row | None:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(query, params)
        return cursor.fetchone()


def fetch_all(connection: Connection, query: str, params: tuple[Any, ...] = ()) -> list[Row]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(query, params)
        return list(cursor.fetchall())


def execute_returning(connection: Connection, query: str, params: tuple[Any, ...] = ()) -> Row:
    row = fetch_one(connection, query, params)
    connection.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="resource not found")
    return row


def execute_commit(connection: Connection, query: str, params: tuple[Any, ...] = ()) -> None:
    with connection.cursor() as cursor:
        cursor.execute(query, params)
    connection.commit()


def require_row(row: Row | None, detail: str = "resource not found") -> Row:
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    return row
