from sqlalchemy import create_engine
from sqlalchemy import text

from backend.app.core.auth import hash_password
from backend.app.core.config import get_settings
from backend.app.db.base import Base
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
        connection.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat'"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ADD COLUMN IF NOT EXISTS document_json JSONB"))
        connection.execute(text("UPDATE ai_canvas_notes SET document_json = '{\"type\":\"doc\",\"content\":[]}'::jsonb WHERE document_json IS NULL"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ALTER COLUMN document_json SET DEFAULT '{\"type\":\"doc\",\"content\":[]}'::jsonb"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ALTER COLUMN document_json SET NOT NULL"))
        connection.execute(text("UPDATE folders SET user_id = :user_id WHERE user_id IS NULL"), {"user_id": legacy_user_id})
        connection.execute(text("UPDATE notes SET user_id = folders.user_id FROM folders WHERE notes.folder_id = folders.id AND notes.user_id IS NULL"))
        connection.execute(text("UPDATE notes SET user_id = :user_id WHERE user_id IS NULL"), {"user_id": legacy_user_id})
        connection.execute(text("ALTER TABLE folders ALTER COLUMN user_id SET NOT NULL"))
        connection.execute(text("ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_folders_user_id ON folders(user_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notes_user_id ON notes(user_id)"))


def main() -> None:
    engine = create_engine(get_settings().database_url)
    Base.metadata.create_all(bind=engine)
    apply_auth_migration(engine)
    print({"status": "ok", "tables": sorted(Base.metadata.tables.keys())})


if __name__ == "__main__":
    main()
