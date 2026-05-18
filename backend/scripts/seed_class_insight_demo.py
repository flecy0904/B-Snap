import argparse
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
    ("student5@class-demo.local", "컴퓨터네트워크 데모 5"),
    ("student6@class-demo.local", "컴퓨터네트워크 데모 6"),
    ("student7@class-demo.local", "컴퓨터네트워크 데모 7"),
    ("student8@class-demo.local", "컴퓨터네트워크 데모 8"),
]

PAGE_PLANS: list[dict[int, dict[str, Any]]] = [
    {
        13: {"strokes": 10, "highlights": 4, "bookmarks": 1, "memos": 1, "text": "시험 중요. network core 개념 암기"},
        21: {"strokes": 5, "highlights": 2, "text": "퀴즈 가능성 있음"},
        32: {"strokes": 4, "highlights": 1, "photos": 1, "text": "교수님 추가 설명"},
    },
    {
        5: {"strokes": 5, "highlights": 2, "text": "초반 핵심 정의"},
        13: {"strokes": 8, "highlights": 5, "bookmarks": 1, "text": "중요 별표. 시험에 나올 듯"},
        21: {"strokes": 7, "highlights": 3, "memos": 1, "text": "중간 대비 복습"},
    },
    {
        13: {"strokes": 6, "highlights": 3, "bookmarks": 1, "text": "암기 필수"},
        32: {"strokes": 9, "highlights": 4, "photos": 2, "memos": 1, "text": "기말 중요. packet loss 설명"},
        41: {"strokes": 3, "highlights": 1, "text": "예시 확인"},
    },
    {
        21: {"strokes": 4, "highlights": 2, "text": "중요 개념 연결"},
        32: {"strokes": 6, "highlights": 3, "bookmarks": 1, "photos": 1, "text": "시험에 나올만한 그래프"},
    },
    {
        13: {"strokes": 7, "highlights": 4, "bookmarks": 1, "text": "강조. network core 복습 필수"},
        21: {"strokes": 5, "highlights": 2, "text": "체크. protocol layer 정리"},
        75: {"strokes": 4, "highlights": 1, "photos": 1, "text": "기말 대비 예시"},
    },
    {
        8: {"strokes": 3, "highlights": 1, "text": "정의 확인"},
        13: {"strokes": 9, "highlights": 5, "bookmarks": 1, "memos": 1, "text": "별표. 시험 중요 개념"},
        32: {"strokes": 6, "highlights": 3, "photos": 1, "text": "queueing delay 주의"},
    },
    {
        21: {"strokes": 8, "highlights": 4, "bookmarks": 1, "text": "퀴즈 가능. 공식 정리"},
        32: {"strokes": 5, "highlights": 2, "text": "기말 중요"},
        75: {"strokes": 6, "highlights": 2, "bookmarks": 1, "text": "암기할 예시"},
    },
    {
        13: {"strokes": 5, "highlights": 3, "text": "중간 시험 대비"},
        41: {"strokes": 4, "highlights": 1, "photos": 1, "text": "교수님 추가 설명"},
        75: {"strokes": 7, "highlights": 3, "memos": 1, "text": "복습 필수"},
    },
]

AI_CANVAS_PLANS: list[list[dict[str, Any]]] = [
    [
        {"title": "[데모] 13페이지 시험 대비 정리", "source_page_start": 13, "source_page_end": 13},
    ],
    [
        {"title": "[데모] 21페이지 중간 대비 정리", "source_page_start": 21, "source_page_end": 21},
    ],
    [
        {"title": "[데모] 32페이지 기말 대비 정리", "source_page_start": 32, "source_page_end": 32},
    ],
    [],
    [
        {"title": "[데모] 13페이지 핵심 개념 정리", "source_page_start": 13, "source_page_end": 13},
    ],
    [
        {"title": "[데모] 32페이지 지연/손실 정리", "source_page_start": 32, "source_page_end": 32},
    ],
    [
        {"title": "[데모] 21페이지 계층 구조 정리", "source_page_start": 21, "source_page_end": 21},
    ],
    [
        {"title": "[데모] 75페이지 예시 복습", "source_page_start": 75, "source_page_end": 75},
    ],
]

CHAT_QUESTION_PLANS: list[list[str]] = [
    ["13페이지 network core가 시험에 나올만한가요?", "32페이지 packet loss 설명을 복습해야 하나요?"],
    ["13페이지랑 21페이지 중 어디를 먼저 봐야 하나요?"],
    ["32페이지 그래프가 기말에 중요한 부분인가요?", "13페이지 암기 포인트 알려줘"],
    ["21페이지, 32페이지가 시험 대비에 중요한가요?"],
    ["13페이지와 75페이지 중 시험에 더 중요한 쪽은 어디인가요?"],
    ["13페이지 network core랑 32페이지 지연 개념 같이 봐야 하나요?"],
    ["21페이지 protocol layer가 퀴즈에 나올까요?"],
    ["75페이지 예시가 기말에 중요한가요?", "41페이지 사진 설명도 복습해야 하나요?"],
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
        "bookmarkCount": int(plan.get("bookmarks", 0)),
        "photoReferenceCount": int(plan.get("photos", 0)),
        "memoPageCount": int(plan.get("memos", 0)),
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


def _upsert_note(cursor, user_id: int, folder_id: int, *, with_demo_signals: bool) -> int:
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
    summary = (
        "발표용 컴퓨터네트워크 수업 집단 인사이트 데모 PDF입니다."
        if with_demo_signals
        else "컴퓨터네트워크 수업 PDF 데모 계정용 빈 노트입니다."
    )
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


def _table_exists(cursor, table_name: str) -> bool:
    cursor.execute("SELECT to_regclass(%s) AS table_name", (table_name,))
    row = cursor.fetchone()
    return bool(row and row["table_name"])


def _seed_ai_canvas_notes(cursor, note_id: int, folder_id: int, user_index: int, *, with_demo_signals: bool) -> None:
    if not _table_exists(cursor, "ai_canvas_notes"):
        return
    cursor.execute("DELETE FROM ai_canvas_notes WHERE note_id = %s", (note_id,))
    if not with_demo_signals:
        return

    for plan in AI_CANVAS_PLANS[user_index - 1]:
        page_range = (
            f"{plan['source_page_start']}페이지"
            if plan["source_page_start"] == plan["source_page_end"]
            else f"{plan['source_page_start']}-{plan['source_page_end']}페이지"
        )
        cursor.execute(
            """
            INSERT INTO ai_canvas_notes (folder_id, note_id, title, markdown, source_page_start, source_page_end)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                folder_id,
                note_id,
                plan["title"],
                f"# {plan['title']}\n\n{page_range} 수업 필기와 하이라이트를 바탕으로 만든 발표용 데모 정리입니다.",
                plan["source_page_start"],
                plan["source_page_end"],
            ),
        )


def _seed_chat_questions(cursor, note_id: int, user_index: int, *, with_demo_signals: bool) -> None:
    if not (_table_exists(cursor, "chat_sessions") and _table_exists(cursor, "chat_messages")):
        return
    cursor.execute("DELETE FROM chat_sessions WHERE note_id = %s", (note_id,))
    if not with_demo_signals:
        return

    questions = CHAT_QUESTION_PLANS[user_index - 1]
    if not questions:
        return

    cursor.execute(
        """
        INSERT INTO chat_sessions (note_id, title, model)
        VALUES (%s, %s, %s)
        RETURNING id
        """,
        (note_id, "[데모] 시험 대비 질문", "demo-class-insight"),
    )
    session_id = int(cursor.fetchone()["id"])
    for question in questions:
        cursor.execute(
            """
            INSERT INTO chat_messages (session_id, role, content, model)
            VALUES (%s, 'user', %s, %s)
            """,
            (session_id, question, "demo-class-insight"),
        )
        cursor.execute(
            """
            INSERT INTO chat_messages (session_id, role, content, model)
            VALUES (%s, 'assistant', %s, %s)
            """,
            (session_id, "해당 페이지를 중심으로 복습하면 좋습니다.", "demo-class-insight"),
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create class insight demo accounts for the computer networks PDF.",
    )
    parser.add_argument(
        "--with-demo-signals",
        action="store_true",
        help="Also seed synthetic ink/highlight/bookmark/photo/AI signals. Default creates clean accounts and empty pages.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    with_demo_signals = bool(args.with_demo_signals)
    pdf_url = _first_uploaded_pdf_url()
    seeded_notes: list[int] = []

    with Connection.connect(get_database_url(), row_factory=dict_row) as connection:
        try:
            with connection.cursor() as cursor:
                for user_index, (email, name) in enumerate(DEMO_USERS, start=1):
                    user_id = _upsert_user(cursor, email, name)
                    folder_id = _upsert_folder(cursor, user_id)
                    note_id = _upsert_note(cursor, user_id, folder_id, with_demo_signals=with_demo_signals)
                    seeded_notes.append(note_id)

                    cursor.execute("DELETE FROM note_pages WHERE note_id = %s", (note_id,))
                    page_plan = PAGE_PLANS[user_index - 1]
                    for page_number in range(1, PAGE_COUNT + 1):
                        content = (
                            _make_page_state(page_number, page_plan[page_number], user_index)
                            if with_demo_signals and page_number in page_plan
                            else _empty_page_state()
                        )
                        image_url = pdf_url if page_number == 1 else None
                        cursor.execute(
                            """
                            INSERT INTO note_pages (note_id, page_number, content, image_url)
                            VALUES (%s, %s, %s, %s)
                            """,
                            (note_id, page_number, content, image_url),
                        )
                    _seed_ai_canvas_notes(cursor, note_id, folder_id, user_index, with_demo_signals=with_demo_signals)
                    _seed_chat_questions(cursor, note_id, user_index, with_demo_signals=with_demo_signals)
            connection.commit()
        except Exception:
            connection.rollback()
            raise

    print({
        "status": "ok",
        "mode": "with-demo-signals" if with_demo_signals else "clean-accounts",
        "users": [email for email, _ in DEMO_USERS],
        "password": DEMO_PASSWORD,
        "note_ids": seeded_notes,
        "pdf_url": pdf_url,
    })


if __name__ == "__main__":
    main()
