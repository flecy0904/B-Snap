import json
import unittest
from unittest.mock import patch

from backend.app.services.rag_service import build_rag_context_hint, load_note_documents
from backend.app.services.rag_retriever import (
    build_rag_context,
    retrieve_relevant_contexts,
    split_text_into_chunks,
)


class RAGRetrieverTest(unittest.TestCase):
    def test_split_text_into_chunks_uses_overlap(self):
        chunks = split_text_into_chunks("abcdefghijklmnopqrstuvwxyz", chunk_size=10, overlap=2)

        self.assertEqual(chunks[0], "abcdefghij")
        self.assertEqual(chunks[1], "ijklmnopqr")

    def test_retrieve_relevant_contexts_orders_by_keyword_overlap(self):
        documents = [
            {
                "source_type": "note_page",
                "source_id": "1",
                "title": "Stack",
                "content": "Stack is a LIFO data structure. push and pop are key operations.",
            },
            {
                "source_type": "note_page",
                "source_id": "2",
                "title": "Queue",
                "content": "Queue is a FIFO data structure.",
            },
        ]

        contexts = retrieve_relevant_contexts("LIFO stack pop", documents, top_k=1)

        self.assertEqual(len(contexts), 1)
        self.assertEqual(contexts[0].title, "Stack")
        self.assertGreater(contexts[0].score, 0)

    def test_build_rag_context_includes_sources(self):
        documents = [
            {
                "source_type": "note",
                "source_id": "7",
                "title": "자료구조",
                "content": "Stack은 LIFO 구조입니다.",
            }
        ]
        contexts = retrieve_relevant_contexts("Stack LIFO", documents, top_k=1)

        rag_context = build_rag_context(contexts)

        self.assertIn("자료구조", rag_context)
        self.assertIn("note:7", rag_context)

    def test_load_note_documents_extracts_page_state_text_and_canvas_notes(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "Stack은 LIFO 구조이고 push와 pop 연산을 사용합니다.",
                "textAnnotations": [{"text": "시험 중요: pop 동작 순서"}],
                "inkStrokes": [],
            },
            ensure_ascii=False,
        )

        with patch("backend.app.services.rag_service.fetch_all") as fetch_all:
            fetch_all.side_effect = [
                [{"id": 1, "title": "자료구조", "summary": "스택과 큐 요약"}],
                [{"id": 10, "note_id": 1, "page_number": 3, "content": page_state, "note_title": "자료구조"}],
                [
                    {
                        "id": 20,
                        "note_id": 1,
                        "title": "시험 대비 메모",
                        "markdown": "## 시험 포인트\n- Stack LIFO\n- Queue FIFO",
                        "source_page_start": 3,
                        "source_page_end": 4,
                        "note_title": "자료구조",
                    }
                ],
            ]

            documents = load_note_documents(object(), note_ids=[1], user_id=7)

        contents = "\n".join(document["content"] for document in documents)
        self.assertIn("PDF text:", contents)
        self.assertIn("Stack은 LIFO", contents)
        self.assertIn("User text notes:", contents)
        self.assertIn("시험 중요", contents)
        self.assertIn("Source pages: 3-4", contents)
        self.assertTrue(any(document["source_type"] == "ai_canvas_note" for document in documents))
        self.assertNotIn('"kind": "bsnap-page-state"', contents)

    def test_build_rag_context_hint_formats_retrieved_sources(self):
        hint = build_rag_context_hint(
            question="Stack LIFO 설명",
            documents=[
                {
                    "source_type": "note_page",
                    "source_id": "10",
                    "title": "자료구조 - page 3",
                    "content": "Stack은 LIFO 구조이고 push와 pop 연산을 사용합니다.",
                }
            ],
            top_k=3,
        )

        self.assertIsNotNone(hint)
        self.assertIn("Retrieved study context", hint or "")
        self.assertIn("자료구조 - page 3", hint or "")
        self.assertIn("Stack은 LIFO", hint or "")


if __name__ == "__main__":
    unittest.main()
