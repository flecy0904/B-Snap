import argparse
import logging

import psycopg
from psycopg.rows import dict_row

from backend.app.db.crud import fetch_all
from backend.app.db.session import get_database_url
from backend.app.services.document_chunk_index import replace_note_chunks


logger = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill pgvector document chunks for existing notes.")
    parser.add_argument("--user-id", type=int, default=None, help="Limit backfill to one user.")
    parser.add_argument("--folder-id", type=int, default=None, help="Limit backfill to one folder.")
    parser.add_argument("--note-id", type=int, default=None, help="Limit backfill to one note.")
    return parser.parse_args()


def _load_targets(connection, *, user_id: int | None, folder_id: int | None, note_id: int | None) -> list[dict]:
    filters = []
    params = []
    if user_id is not None:
        filters.append("user_id = %s")
        params.append(user_id)
    if folder_id is not None:
        filters.append("folder_id = %s")
        params.append(folder_id)
    if note_id is not None:
        filters.append("id = %s")
        params.append(note_id)

    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
    return fetch_all(
        connection,
        f"""
        SELECT id, user_id
        FROM notes
        {where_sql}
        ORDER BY user_id ASC, folder_id ASC, id ASC
        """,
        tuple(params),
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = _parse_args()

    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        targets = _load_targets(
            connection,
            user_id=args.user_id,
            folder_id=args.folder_id,
            note_id=args.note_id,
        )
        logger.info("Backfilling %s notes", len(targets))
        for target in targets:
            chunk_count = replace_note_chunks(
                connection,
                note_id=int(target["id"]),
                user_id=int(target["user_id"]),
            )
            logger.info("note_id=%s chunks=%s", target["id"], chunk_count)


if __name__ == "__main__":
    main()
