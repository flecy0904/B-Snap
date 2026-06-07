import argparse

from psycopg import Connection

from backend.app.db.crud import fetch_all
from backend.app.db.session import get_database_url
from backend.app.services.document_chunk_index import index_note_documents


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill pgvector document chunks for RAG retrieval.")
    parser.add_argument("--user-id", type=int, default=None, help="Index notes for one user only.")
    parser.add_argument("--note-id", type=int, default=None, help="Index one note only.")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of notes to index.")
    return parser.parse_args()


def load_notes(connection: Connection, *, user_id: int | None, note_id: int | None, limit: int | None) -> list[dict]:
    filters = []
    params = []
    if user_id is not None:
        filters.append("user_id = %s")
        params.append(user_id)
    if note_id is not None:
        filters.append("id = %s")
        params.append(note_id)

    where_clause = "WHERE " + " AND ".join(filters) if filters else ""
    limit_clause = "LIMIT %s" if limit is not None else ""
    if limit is not None:
        params.append(limit)

    return fetch_all(
        connection,
        f"""
        SELECT id, user_id, title
        FROM notes
        {where_clause}
        ORDER BY updated_at DESC, id DESC
        {limit_clause}
        """,
        tuple(params),
    )


def main() -> None:
    args = parse_args()
    total_indexed = 0
    with Connection.connect(get_database_url()) as connection:
        notes = load_notes(connection, user_id=args.user_id, note_id=args.note_id, limit=args.limit)
        for note in notes:
            indexed_count = index_note_documents(connection, note_id=int(note["id"]), user_id=int(note["user_id"]))
            total_indexed += indexed_count
            print({"note_id": note["id"], "title": note["title"], "indexed_chunks": indexed_count})

    print({"status": "ok", "notes": len(notes), "indexed_chunks": total_indexed})


if __name__ == "__main__":
    main()
