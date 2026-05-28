import json
import subprocess
from pathlib import Path

from sqlalchemy import create_engine, text

from backend.app.core.config import get_settings


ROOT_DIR = Path(__file__).resolve().parents[2]
CONVERTER = ROOT_DIR / "frontend" / "scripts" / "convert-ai-canvas-markdown-to-json.mjs"


def convert_markdown_to_document_json(markdown: str) -> dict:
    completed = subprocess.run(
        ["node", str(CONVERTER)],
        input=json.dumps({"markdown": markdown}, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=True,
        cwd=ROOT_DIR / "frontend",
    )
    return json.loads(completed.stdout)


def main() -> None:
    engine = create_engine(get_settings().database_url)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE ai_canvas_notes ADD COLUMN IF NOT EXISTS document_json JSONB"))
        rows = connection.execute(
            text(
                """
                SELECT id, markdown
                FROM ai_canvas_notes
                WHERE document_json IS NULL
                   OR document_json = '{}'::jsonb
                   OR document_json = '{"type":"doc","content":[]}'::jsonb
                ORDER BY id ASC
                """
            )
        ).mappings().all()

        updated_count = 0
        for row in rows:
            markdown = row["markdown"] or ""
            document_json = convert_markdown_to_document_json(markdown)
            connection.execute(
                text(
                    """
                    UPDATE ai_canvas_notes
                    SET document_json = CAST(:document_json AS jsonb)
                    WHERE id = :id
                    """
                ),
                {
                    "id": row["id"],
                    "document_json": json.dumps(document_json, ensure_ascii=False),
                },
            )
            updated_count += 1

        connection.execute(text("UPDATE ai_canvas_notes SET document_json = '{\"type\":\"doc\",\"content\":[]}'::jsonb WHERE document_json IS NULL"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ALTER COLUMN document_json SET DEFAULT '{\"type\":\"doc\",\"content\":[]}'::jsonb"))
        connection.execute(text("ALTER TABLE ai_canvas_notes ALTER COLUMN document_json SET NOT NULL"))

    print({"status": "ok", "updated": updated_count})


if __name__ == "__main__":
    main()
