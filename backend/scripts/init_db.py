from sqlalchemy import create_engine
from sqlalchemy import text

from backend.app.core.auth import hash_password
from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.services.document_matching import build_document_match_key, normalize_subject_key
from backend.app import models


LEGACY_EMAIL = "legacy@b-snap.local"


def apply_auth_migration(engine) -> None:
    with engine.begin() as connection:
        legacy_user_id = connection.execute(
            text(
                """
                INSERT INTO users (email, name, password_hash)
                VALUES (:email, :name, :password_hash)
                ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                RETURNING id
                """
            ),
            {
                "email": LEGACY_EMAIL,
                "name": "Legacy User",
                "password_hash": hash_password("legacy-password-not-for-login"),
            },
        ).scalar_one()

        connection.execute(text("ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS file_url TEXT"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS thumbnail_url TEXT"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS page_count INTEGER"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS original_filename TEXT"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS file_sha256 VARCHAR(64)"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS subject_match_key VARCHAR(160)"))
        connection.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS document_match_key VARCHAR(260)"))
        connection.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat'"))
        connection.execute(text("ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS rag_scope JSONB"))
        connection.execute(text("ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary TEXT"))
        connection.execute(text("ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summarized_message_id INTEGER"))
        connection.execute(text("ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ADD COLUMN IF NOT EXISTS document_json JSONB"))
        connection.execute(text("UPDATE ai_canvas_notes SET document_json = '{\"type\":\"doc\",\"content\":[]}'::jsonb WHERE document_json IS NULL"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ALTER COLUMN document_json SET DEFAULT '{\"type\":\"doc\",\"content\":[]}'::jsonb"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ALTER COLUMN document_json SET NOT NULL"))
        connection.execute(text("UPDATE folders SET user_id = :user_id WHERE user_id IS NULL"), {"user_id": legacy_user_id})
        connection.execute(text("UPDATE notes SET user_id = folders.user_id FROM folders WHERE notes.folder_id = folders.id AND notes.user_id IS NULL"))
        connection.execute(text("UPDATE notes SET user_id = :user_id WHERE user_id IS NULL"), {"user_id": legacy_user_id})
        rows = connection.execute(
            text(
                """
                SELECT n.id, n.title, n.original_filename, n.page_count, f.name AS folder_name
                FROM notes n
                JOIN folders f ON f.id = n.folder_id
                WHERE n.subject_match_key IS NULL
                   OR n.document_match_key IS NULL
                   OR n.original_filename IS NULL
                """
            )
        ).mappings().all()
        for row in rows:
            original_filename = row["original_filename"] or row["title"]
            connection.execute(
                text(
                    """
                    UPDATE notes
                    SET original_filename = COALESCE(original_filename, :original_filename),
                        subject_match_key = COALESCE(subject_match_key, :subject_match_key),
                        document_match_key = COALESCE(document_match_key, :document_match_key)
                    WHERE id = :id
                    """
                ),
                {
                    "id": row["id"],
                    "original_filename": original_filename,
                    "subject_match_key": normalize_subject_key(row["folder_name"]),
                    "document_match_key": build_document_match_key(original_filename, row["page_count"]),
                },
            )
        connection.execute(text("ALTER TABLE folders ALTER COLUMN user_id SET NOT NULL"))
        connection.execute(text("ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_folders_user_id ON folders(user_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notes_user_id ON notes(user_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notes_subject_match_key ON notes(subject_match_key)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notes_document_match_key ON notes(document_match_key)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_sessions_summarized_message_id ON chat_sessions(summarized_message_id)"))

def apply_document_chunk_migration(engine) -> None:
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id BIGSERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
                        note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
                        source_type VARCHAR(40) NOT NULL,
                        source_id TEXT NOT NULL,
                        page_number INTEGER,
                        chunk_index INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        content_hash VARCHAR(64) NOT NULL,
                        embedding vector(1536) NOT NULL,
                        embedding_model VARCHAR(100) NOT NULL,
                        source_updated_at TIMESTAMPTZ,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        UNIQUE (user_id, source_type, source_id, chunk_index)
                    )
                    """
                )
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_user_note ON document_chunks(user_id, note_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_user_folder ON document_chunks(user_id, folder_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_source ON document_chunks(user_id, source_type, source_id)"))
            connection.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding
                    ON document_chunks
                    USING ivfflat (embedding vector_cosine_ops)
                    WITH (lists = 100)
                    """
                )
            )
    except Exception as exc:
        print({"warning": "pgvector document chunk migration skipped", "detail": str(exc)})


def main() -> None:
    engine = create_engine(get_settings().database_url)
    Base.metadata.create_all(bind=engine)
    apply_auth_migration(engine)
    apply_document_chunk_migration(engine)
    print({"status": "ok", "tables": sorted(Base.metadata.tables.keys())})


if __name__ == "__main__":
    main()
