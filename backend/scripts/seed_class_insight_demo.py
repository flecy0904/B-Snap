import json
import sys
from pathlib import Path
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.core.auth import hash_password
from backend.app.core.config import get_settings
from backend.app.db.session import get_database_url


SUBJECT_NAME = "컴퓨터네트워크"
DOCUMENT_TITLE = "computer-networks-ch1-wide.pdf"
PAGE_COUNT = 93
DEMO_PASSWORD = "bsnap-demo1234"

DEMO_USERS = [
    ("student1@class-demo.local", "컴퓨터네트워크 데모 1"),
    ("student2@class-demo.local", "컴퓨터네트워크 데모 2"),
    ("student3@class-demo.local", "컴퓨터네트워크 데모 3"),
    ("student4@class-demo.local", "컴퓨터네트워크 데모 4"),
]

PAGE_PLANS: list[dict[int, dict[str, Any]]] = [
    {
        13: {"strokes": 10, "highlights": 4, "text": "시험 중요. network core 개념 암기"},
        21: {"strokes": 5, "highlights": 2, "text": "퀴즈 가능성 있음"},
        32: {"strokes": 4, "highlights": 1, "text": "교수님 추가 설명"},
    },
    {
        5: {"strokes": 5, "highlights": 2, "text": "초반 핵심 정의"},
        13: {"strokes": 8, "highlights": 5, "text": "중요 별표. 시험에 나올 듯"},
        21: {"strokes": 7, "highlights": 3, "text": "중간 대비 복습"},
    },
    {
        13: {"strokes": 6, "highlights": 3, "text": "암기 필수"},
        32: {"strokes": 9, "highlights": 4, "text": "기말 중요. packet loss 설명"},
        41: {"strokes": 3, "highlights": 1, "text": "예시 확인"},
    },
    {
        21: {"strokes": 4, "highlights": 2, "text": "중요 개념 연결"},
        32: {"strokes": 6, "highlights": 3, "text": "시험에 나올만한 그래프"},
    },
]


def _first_uploaded_pdf_url() -> str | None:
    upload_root = get_settings().upload_path
    matches = sorted(upload_root.glob("*computer-networks-ch1-wide.pdf"))
    if not matches:
        return None
    return f"/uploads/{matches[0].name}"


def _make_points(page_number: int, seed: int, count: int) -> list[dict[str, float | int]]:
    base_x = 120 + (seed * 17)
    base_y = 180 + (seed * 23)
    return [
        {
            "x": base_x + index * 18,
            "y": base_y + ((index % 3) * 6),
            "pageNumber": page_number,
            "pageWidth": 1180,
            "pageHeight": 664,
        }
        for index in range(max(2, count))
    ]


def _make_page_state(page_number: int, plan: dict[str, Any], user_index: int) -> str:
    strokes: list[dict[str, Any]] = []
    for index in range(plan.get("strokes", 0)):
        strokes.append({
            "id": f"demo-{user_index}-{page_number}-pen-{index}",
            "points": _make_points(page_number, user_index + index, 7),
            "color": "#1F2937",
            "width": 3,
            "style": "pen",
            "brush": "ballpoint",
            "linePattern": "solid",
            "pageNumber": page_number,
            "pageWidth": 1180,
            "pageHeight": 664,
        })

    for index in range(plan.get("highlights", 0)):
        strokes.append({
            "id": f"demo-{user_index}-{page_number}-highlight-{index}",
            "points": _make_points(page_number, user_index + index + 20, 9),
            "color": "#FDE047",
            "width": 14,
            "style": "highlight",
            "brush": "highlighter",
            "linePattern": "solid",
            "pageNumber": page_number,
            "pageWidth": 1180,
            "pageHeight": 664,
        })

    text_annotations = []
    if plan.get("text"):
        text_annotations.append({
            "id": f"demo-{user_index}-{page_number}-text",
            "pageNumber": page_number,
            "x": 190,
            "y": 120 + user_index * 34,
            "width": 260,
            "text": plan["text"],
            "pageWidth": 1180,
            "pageHeight": 664,
        })

    return json.dumps({
        "kind": "bsnap-page-state",
        "version": 1,
        "inkStrokes": strokes,
        "textAnnotations": text_annotations,
    }, ensure_ascii=False, separators=(",", ":"))


def _empty_page_state() -> str:
    return json.dumps({
        "kind": "bsnap-page-state",
        "version": 1,
        "inkStrokes": [],
        "textAnnotations": [],
    }, ensure_ascii=False, separators=(",", ":"))


def _upsert_user(cursor, email: str, name: str) -> int:
    cursor.execute(
        """
        INSERT INTO users (email, name, password_hash)
        VALUES (%s, %s, %s)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        (email, name, hash_password(DEMO_PASSWORD)),
    )
    return int(cursor.fetchone()["id"])


def _upsert_folder(cursor, user_id: int) -> int:
    cursor.execute(
        "SELECT id FROM folders WHERE user_id = %s AND name = %s ORDER BY id ASC LIMIT 1",
        (user_id, SUBJECT_NAME),
    )
    row = cursor.fetchone()
    if row:
        return int(row["id"])

    cursor.execute(
        """
        INSERT INTO folders (user_id, name, color)
        VALUES (%s, %s, %s)
        RETURNING id
        """,
        (user_id, SUBJECT_NAME, "#D8C05F"),
    )
    return int(cursor.fetchone()["id"])


def _upsert_note(cursor, user_id: int, folder_id: int) -> int:
    cursor.execute(
        """
        SELECT id
        FROM notes
        WHERE user_id = %s AND folder_id = %s AND title = %s
        ORDER BY id ASC
        LIMIT 1
        """,
        (user_id, folder_id, DOCUMENT_TITLE),
    )
    row = cursor.fetchone()
    summary = "발표용 컴퓨터네트워크 수업 집단 인사이트 데모 PDF입니다."
    if row:
        note_id = int(row["id"])
        cursor.execute(
            "UPDATE notes SET summary = %s, updated_at = now() WHERE id = %s",
            (summary, note_id),
        )
        return note_id

    cursor.execute(
        """
        INSERT INTO notes (user_id, folder_id, title, summary)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (user_id, folder_id, DOCUMENT_TITLE, summary),
    )
    return int(cursor.fetchone()["id"])


def main() -> None:
    pdf_url = _first_uploaded_pdf_url()
    seeded_notes: list[int] = []

    with Connection.connect(get_database_url(), row_factory=dict_row) as connection:
        try:
            with connection.cursor() as cursor:
                for user_index, (email, name) in enumerate(DEMO_USERS, start=1):
                    user_id = _upsert_user(cursor, email, name)
                    folder_id = _upsert_folder(cursor, user_id)
                    note_id = _upsert_note(cursor, user_id, folder_id)
                    seeded_notes.append(note_id)

                    cursor.execute("DELETE FROM note_pages WHERE note_id = %s", (note_id,))
                    page_plan = PAGE_PLANS[user_index - 1]
                    for page_number in range(1, PAGE_COUNT + 1):
                        content = _make_page_state(page_number, page_plan[page_number], user_index) if page_number in page_plan else _empty_page_state()
                        image_url = pdf_url if page_number == 1 else None
                        cursor.execute(
                            """
                            INSERT INTO note_pages (note_id, page_number, content, image_url)
                            VALUES (%s, %s, %s, %s)
                            """,
                            (note_id, page_number, content, image_url),
                        )
            connection.commit()
        except Exception:
            connection.rollback()
            raise

    print({
        "status": "ok",
        "users": [email for email, _ in DEMO_USERS],
        "password": DEMO_PASSWORD,
        "note_ids": seeded_notes,
        "pdf_url": pdf_url,
    })


if __name__ == "__main__":
    main()
