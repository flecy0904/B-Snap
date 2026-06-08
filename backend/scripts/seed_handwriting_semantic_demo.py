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
from backend.app.db.session import get_database_url
from backend.app.services.document_matching import build_document_match_key, normalize_subject_key
from backend.app.services.handwriting_signals import stable_stroke_hash


SUBJECT_NAME = "손필기 시맨틱 인사이트 데모"
DOCUMENT_TITLE = "semantic-handwriting-demo.pdf"
PAGE_COUNT = 80
DEMO_PASSWORD = "bsnap-demo1234"
DEMO_USERS = [
    ("semantic-student1@class-demo.local", "손필기 시맨틱 데모 1"),
    ("semantic-student2@class-demo.local", "손필기 시맨틱 데모 2"),
    ("semantic-student3@class-demo.local", "손필기 시맨틱 데모 3"),
    ("semantic-student4@class-demo.local", "손필기 시맨틱 데모 4"),
]


def _point(x: float, y: float, page_number: int) -> dict[str, float | int]:
    return {
        "x": x,
        "y": y,
        "pageNumber": page_number,
        "pageWidth": 1180,
        "pageHeight": 664,
    }


def _stroke(stroke_id: str, page_number: int, points: list[tuple[float, float]], **extra: Any) -> dict[str, Any]:
    return {
        "id": stroke_id,
        "points": [_point(x, y, page_number) for x, y in points],
        "color": extra.pop("color", "#1F2937"),
        "width": extra.pop("width", 3),
        "style": extra.pop("style", "pen"),
        "brush": extra.pop("brush", "ballpoint"),
        "linePattern": extra.pop("linePattern", "solid"),
        "pageNumber": page_number,
        "pageWidth": 1180,
        "pageHeight": 664,
        **extra,
    }


def _star_strokes(page_number: int, participant_index: int) -> list[dict[str, Any]]:
    x = 120 + participant_index * 18
    y = 84 + participant_index * 12
    return [
        _stroke(f"semantic-{participant_index}-{page_number}-star-a", page_number, [(x, y + 34), (x + 48, y + 34)], shape="line", style="shape"),
        _stroke(f"semantic-{participant_index}-{page_number}-star-b", page_number, [(x + 24, y + 4), (x + 24, y + 64)], shape="line", style="shape"),
        _stroke(f"semantic-{participant_index}-{page_number}-star-c", page_number, [(x + 3, y + 10), (x + 45, y + 58)], shape="line", style="shape"),
        _stroke(f"semantic-{participant_index}-{page_number}-star-d", page_number, [(x + 45, y + 10), (x + 3, y + 58)], shape="line", style="shape"),
    ]


def _check_strokes(page_number: int, participant_index: int) -> list[dict[str, Any]]:
    x = 150 + participant_index * 18
    y = 110 + participant_index * 18
    return [
        _stroke(f"semantic-{participant_index}-{page_number}-check", page_number, [(x, y + 32), (x + 24, y + 55), (x + 72, y)], width=4),
    ]


def _circle_strokes(page_number: int, participant_index: int) -> list[dict[str, Any]]:
    x = 170 + participant_index * 22
    y = 140 + participant_index * 16
    return [
        _stroke(
            f"semantic-{participant_index}-{page_number}-circle",
            page_number,
            [(x + 36, y), (x + 72, y + 30), (x + 58, y + 70), (x + 16, y + 70), (x, y + 30), (x + 36, y)],
            width=4,
        ),
    ]


def _random_strokes(page_number: int, participant_index: int, count: int = 70) -> list[dict[str, Any]]:
    strokes: list[dict[str, Any]] = []
    for index in range(count):
        x = 60 + (index * 37) % 980
        y = 80 + (index * 53 + participant_index * 17) % 500
        strokes.append(
            _stroke(
                f"semantic-{participant_index}-{page_number}-random-{index}",
                page_number,
                [(x, y), (x + 12, y + 5), (x + 28, y - 2)],
                color="#374151",
                width=2,
            )
        )
    return strokes


def _recognition(
    *,
    page_number: int,
    strokes: list[dict[str, Any]],
    text: str,
    keywords: list[str],
    symbols: list[str],
    confidence: float,
    source: str = "geometry",
) -> dict[str, Any]:
    bbox = {"x": 80, "y": 70, "width": 260, "height": 120}
    return {
        "status": "ready",
        "strokeHash": stable_stroke_hash(strokes),
        "engine": "geometry",
        "text": text,
        "keywords": keywords,
        "symbols": symbols,
        "confidence": confidence,
        "clusters": [
            {
                "id": f"demo-cluster-{page_number}",
                "pageNumber": page_number,
                "bbox": bbox,
                "text": text,
                "candidates": [{"text": text, "confidence": confidence}] if text else [],
                "keywords": keywords,
                "symbols": symbols,
                "confidence": confidence,
                "source": source,
            }
        ],
        "visionFallbackUsed": False,
        "analyzedClusterCount": 1,
        "visionAnalyzedClusterCount": 0,
        "cached": False,
        "stale": False,
    }


def build_demo_page_state(page_number: int, participant_index: int) -> str:
    if page_number == 13:
        strokes = [
            *_star_strokes(page_number, participant_index),
            _stroke(f"semantic-{participant_index}-13-important", page_number, [(220, 112), (260, 116), (300, 111)], width=4),
        ]
        recognition = _recognition(
            page_number=page_number,
            strokes=strokes,
            text="중요 시험",
            keywords=["중요", "시험"],
            symbols=["star"],
            confidence=0.93,
        )
    elif page_number == 21:
        strokes = _check_strokes(page_number, participant_index)
        recognition = _recognition(
            page_number=page_number,
            strokes=strokes,
            text="기말 중간",
            keywords=["기말", "중간"],
            symbols=["check"],
            confidence=0.86,
        )
    elif page_number == 32:
        strokes = _circle_strokes(page_number, participant_index)
        recognition = _recognition(
            page_number=page_number,
            strokes=strokes,
            text="암기 필수",
            keywords=["암기", "필수"],
            symbols=["circle"],
            confidence=0.84,
        )
    elif page_number == 75:
        strokes = _random_strokes(page_number, participant_index)
        recognition = _recognition(
            page_number=page_number,
            strokes=strokes,
            text="",
            keywords=[],
            symbols=[],
            confidence=0.0,
        )
        recognition["status"] = "unavailable"
        recognition["clusters"] = []
        recognition["analyzedClusterCount"] = 0
    else:
        strokes = []
        recognition = None

    return json.dumps(
        {
            "kind": "bsnap-page-state",
            "version": 1,
            "inkStrokes": strokes,
            "textAnnotations": [],
            "imageAnnotations": [],
            "bookmarked": page_number in {13, 21},
            "photoReferenceCount": 0,
            "memoPageCount": 1 if page_number in {13, 32} else 0,
            **({"handwritingRecognition": recognition} if recognition else {}),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _empty_page_state() -> str:
    return json.dumps(
        {
            "kind": "bsnap-page-state",
            "version": 1,
            "inkStrokes": [],
            "textAnnotations": [],
            "imageAnnotations": [],
            "bookmarked": False,
            "photoReferenceCount": 0,
            "memoPageCount": 0,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


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
    cursor.execute("SELECT id FROM folders WHERE user_id = %s AND name = %s ORDER BY id ASC LIMIT 1", (user_id, SUBJECT_NAME))
    row = cursor.fetchone()
    if row:
        return int(row["id"])
    cursor.execute("INSERT INTO folders (user_id, name, color) VALUES (%s, %s, %s) RETURNING id", (user_id, SUBJECT_NAME, "#7C9AFF"))
    return int(cursor.fetchone()["id"])


def _upsert_note(cursor, user_id: int, folder_id: int) -> int:
    cursor.execute(
        """
        SELECT id FROM notes
        WHERE user_id = %s AND folder_id = %s AND title = %s
        ORDER BY id ASC
        LIMIT 1
        """,
        (user_id, folder_id, DOCUMENT_TITLE),
    )
    row = cursor.fetchone()
    subject_key = normalize_subject_key(SUBJECT_NAME)
    document_key = build_document_match_key(DOCUMENT_TITLE, PAGE_COUNT)
    if row:
        note_id = int(row["id"])
        cursor.execute(
            """
            UPDATE notes
            SET summary = %s,
                page_count = %s,
                original_filename = %s,
                subject_match_key = %s,
                document_match_key = %s,
                updated_at = now()
            WHERE id = %s
            """,
            ("손필기 의미 신호 기반 class-insight 발표용 데모 노트입니다.", PAGE_COUNT, DOCUMENT_TITLE, subject_key, document_key, note_id),
        )
        return note_id
    cursor.execute(
        """
        INSERT INTO notes (user_id, folder_id, title, summary, page_count, original_filename, subject_match_key, document_match_key)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (user_id, folder_id, DOCUMENT_TITLE, "손필기 의미 신호 기반 class-insight 발표용 데모 노트입니다.", PAGE_COUNT, DOCUMENT_TITLE, subject_key, document_key),
    )
    return int(cursor.fetchone()["id"])


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed semantic handwriting class-insight demo data.")
    parser.add_argument("--pages", type=int, default=PAGE_COUNT, help="Number of note pages to seed.")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    page_count = max(75, int(args.pages))
    seeded_notes: list[int] = []

    with Connection.connect(get_database_url(), row_factory=dict_row) as connection:
        try:
            with connection.cursor() as cursor:
                for participant_index, (email, name) in enumerate(DEMO_USERS, start=1):
                    user_id = _upsert_user(cursor, email, name)
                    folder_id = _upsert_folder(cursor, user_id)
                    note_id = _upsert_note(cursor, user_id, folder_id)
                    seeded_notes.append(note_id)
                    cursor.execute("DELETE FROM note_pages WHERE note_id = %s", (note_id,))
                    for page_number in range(1, page_count + 1):
                        content = build_demo_page_state(page_number, participant_index) if page_number in {13, 21, 32, 75} else _empty_page_state()
                        cursor.execute(
                            "INSERT INTO note_pages (note_id, page_number, content) VALUES (%s, %s, %s)",
                            (note_id, page_number, content),
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
        "semantic_pages": [13, 21, 32, 75],
    })


if __name__ == "__main__":
    main()
