import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from backend.app.core.config import Settings
from backend.app.routes.rag_debug import (
    RagDebugEvaluateCreate,
    _ensure_rag_debug_enabled,
    evaluate_chat_session_rag_debug,
    get_note_rag_debug_index,
)
from backend.app.routes.ai_canvas_notes import delete_ai_canvas_note
from backend.app.routes.rag import ask_rag
from backend.app.schemas.rag import QuizQuestion, RAGAskRequest, RAGSummaryRequest, RetrievedContext
from backend.app.routes.chats import normalize_rag_scope, rag_scope_search_targets
from backend.app.schemas.chats import RagScope, RagScopeSource
from backend.app.services.ai_context_builder import build_ai_context, format_answer_sources, select_rag_context_pages
from backend.app.services.ai_context_router import AiContextRoute, route_ai_context
from backend.app.services.document_chunk_index import (
    collect_canvas_index_sources,
    collect_note_index_sources,
    content_hash,
    replace_canvas_chunks,
    replace_note_page_chunks,
    replace_note_chunks,
    retrieve_chunk_contexts,
)
from backend.app.services.rag_chunker import IndexSource, build_text_chunks, split_text_into_chunks
from backend.app.services.prompts.ai_canvas import AI_CANVAS_EDIT_INSTRUCTIONS
from backend.app.services.prompts.ai_chat import AI_CHAT_INSTRUCTIONS
from backend.app.services.prompts.chat_session_summary import CHAT_SESSION_SUMMARY_INSTRUCTIONS
from backend.app.services.prompts.rag import (
    QUIZ_GENERATION_PROMPT,
    RAG_QA_PROMPT,
    build_quiz_prompt,
    build_rag_prompt,
    build_summary_prompt,
)
from backend.app.services.openai_service import (
    CANVAS_RECENT_MESSAGE_LIMIT,
    CHAT_RECENT_MESSAGE_LIMIT,
    build_response_input,
    generate_ai_canvas_operations_from_chat,
    generate_chat_session_summary,
)
from backend.app.services.rag_service import (
    _parse_quiz_questions,
    load_canvas_documents,
    load_note_documents,
    retrieve_rag_contexts_with_debug,
)


class RAGRetrieverTest(unittest.TestCase):
    def test_router_uses_rules_before_llm(self):
        general = route_ai_context(question="스택이 뭐야?", model="test-model")
        current_page = route_ai_context(question="이 페이지 설명해줘", model="test-model", current_page_number=3)
        current_pdf = route_ai_context(question="이 PDF 전체에서 큐를 찾아줘", model="test-model")
        subject = route_ai_context(question="이 과목 전체 시험 포인트 찾아줘", model="test-model")

        self.assertEqual(general.mode, "general")
        self.assertEqual(current_page.mode, "rag")
        self.assertEqual(current_pdf.mode, "rag")
        self.assertEqual(subject.mode, "rag")

    def test_router_can_use_llm_for_ambiguous_note_question(self):
        with patch(
            "backend.app.services.ai_context_router.generate_text_response",
            return_value='{"mode":"rag","rewritten_query":"큐 설명"}',
        ):
            route = route_ai_context(question="노트에 있는 큐 설명해줘", model="test-model")

        self.assertEqual(route.mode, "rag")
        self.assertEqual(route.rewritten_query, "큐 설명")
        self.assertEqual(route.reason, "llm")

    def test_router_falls_back_to_rag_when_note_router_fails(self):
        with patch(
            "backend.app.services.ai_context_router.generate_text_response",
            side_effect=RuntimeError("router unavailable"),
        ):
            route = route_ai_context(question="노트에 있는 큐 설명해줘", model="test-model")

        self.assertEqual(route.mode, "rag")
        self.assertEqual(route.reason, "fallback")

    def test_rag_context_pages_prioritize_current_then_neighbors(self):
        pages = [
            {"id": 1, "page_number": 1},
            {"id": 2, "page_number": 2},
            {"id": 3, "page_number": 3},
            {"id": 4, "page_number": 4},
        ]

        selected = select_rag_context_pages(pages, 3)

        self.assertEqual([page["page_number"] for page in selected], [3, 2, 4])

    def test_build_ai_context_general_drops_page_and_rag_context(self):
        context = build_ai_context(
            mode="general",
            pages=[{"id": 1, "page_number": 1}],
            page_number=1,
            base_context_hints=["mode instruction", "note hint should be omitted by caller"],
            rag_sources=[RetrievedContext(source_type="pdf_page", source_id="1", title="Page 1", content="text")],
        )

        self.assertEqual(context.context_pages, [])
        self.assertNotIn("RAG support context", context.context_hint or "")
        self.assertIsNone(context.answer_sources_text)

    def test_retrieve_rag_contexts_with_debug_does_not_keyword_fallback_on_empty_vector_results(self):
        with patch("backend.app.services.rag_service.retrieve_chunk_contexts", return_value=[]):
            contexts, debug = retrieve_rag_contexts_with_debug(object(), user_id=7, question="TCP", documents=[])

        self.assertEqual(contexts, [])
        self.assertFalse(debug["fallback"])
        self.assertEqual(debug["fallback_reason"], "vector_empty")
        self.assertTrue(debug["no_results"])
        self.assertEqual(debug["retrieved_chunk_count"], 0)

    def test_retrieve_rag_contexts_rolls_back_after_vector_error(self):
        class FakeConnection:
            def __init__(self):
                self.rollback_count = 0

            def rollback(self):
                self.rollback_count += 1

        connection = FakeConnection()
        with patch("backend.app.services.rag_service.retrieve_chunk_contexts", side_effect=RuntimeError("vector failed")):
            contexts, debug = retrieve_rag_contexts_with_debug(connection, user_id=7, question="TCP")

        self.assertEqual(contexts, [])
        self.assertEqual(connection.rollback_count, 1)
        self.assertTrue(debug["rag_unavailable"])
        self.assertEqual(debug["fallback_reason"], "vector_error")

    def test_rag_ask_returns_status_message_without_llm_when_vector_search_is_unavailable(self):
        with patch(
            "backend.app.routes.rag.retrieve_rag_contexts_with_debug",
            return_value=([], {"fallback": True, "fallback_reason": "vector_error", "rag_unavailable": True}),
        ), patch("backend.app.routes.rag.answer_with_retrieved_contexts") as answer_with_retrieved_contexts:
            response = ask_rag(
                RAGAskRequest(question="이 PDF에서 TCP 설명해줘"),
                connection=object(),
                current_user={"id": 7},
            )

        self.assertEqual(response.answer, "지금은 자료 검색을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.")
        self.assertEqual(response.sources, [])
        answer_with_retrieved_contexts.assert_not_called()

    def test_rag_debug_is_disabled_outside_development_envs(self):
        with self.assertRaises(HTTPException) as raised:
            _ensure_rag_debug_enabled(SimpleNamespace(app_env="production"))

        self.assertEqual(raised.exception.status_code, 404)

    def test_rag_debug_index_returns_page_text_and_chunk_snippets(self):
        page_state = json.dumps({"kind": "bsnap-page-state", "version": 1, "pdfText": "TCP congestion control text."})
        with patch("backend.app.routes.rag_debug.fetch_one") as fetch_one, patch("backend.app.routes.rag_debug.fetch_all") as fetch_all:
            fetch_one.return_value = {"id": 3, "folder_id": 2, "title": "Network"}
            fetch_all.side_effect = [
                [{"id": 10, "page_number": 1, "content": page_state, "updated_at": None}],
                [{"source_type": "pdf_page", "count": 1}],
                [{
                    "source_type": "pdf_page",
                    "source_id": "10",
                    "title": "Network - 1페이지",
                    "content": "TCP congestion control text.",
                    "folder_id": 2,
                    "note_id": 3,
                    "page_number": 1,
                    "chunk_index": 1,
                    "metadata": {"page_label": "1페이지"},
                    "indexed_at": None,
                    "updated_at": None,
                }],
            ]

            result = get_note_rag_debug_index(
                3,
                connection=object(),
                current_user={"id": 7},
                settings=Settings(app_env="local"),
            )

        self.assertEqual(result["summary"]["chunk_count"], 1)
        self.assertEqual(result["summary"]["chunks_returned"], 1)
        self.assertEqual(result["summary"]["source_counts"], {"pdf_page": 1})
        self.assertEqual(result["pages"][0]["text_length"], len("TCP congestion control text."))
        self.assertEqual(result["pages"][0]["text"], "TCP congestion control text.")
        self.assertIn("TCP congestion", result["chunks"][0]["content_snippet"])
        self.assertEqual(result["chunks"][0]["content"], "TCP congestion control text.")

    def test_rag_debug_evaluate_uses_router_scope_and_retrieval_without_saving_messages(self):
        retrieved = RetrievedContext(
            source_type="pdf_page",
            source_id="10",
            title="Network - 1페이지",
            content="TCP congestion control text.",
            score=0.82,
            note_id=3,
            page_number=1,
            chunk_index=1,
        )
        with patch("backend.app.routes.rag_debug.fetch_one") as fetch_one, patch("backend.app.routes.rag_debug.fetch_all") as debug_fetch_all, patch(
            "backend.app.routes.chats.fetch_all",
        ) as chats_fetch_all, patch(
            "backend.app.routes.rag_debug.route_ai_context",
            return_value=AiContextRoute(mode="rag", rewritten_query="TCP congestion", reason="rule"),
        ), patch(
            "backend.app.routes.rag_debug.retrieve_rag_contexts_with_debug",
            return_value=([retrieved], {"fallback": False, "fallback_reason": None, "retrieved_source_count": 1, "retrieved_chunk_count": 1}),
        ) as retrieve:
            fetch_one.return_value = {
                "id": 2,
                "note_id": 3,
                "title": "Chat",
                "model": None,
                "rag_scope": None,
                "folder_id": 2,
                "note_title": "Network",
            }
            debug_fetch_all.return_value = [
                {"id": 30, "page_number": 1, "content": {"pdfText": "TCP congestion control text."}, "updated_at": None},
            ]
            chats_fetch_all.side_effect = [[{"id": 3, "title": "Network"}], []]

            result = evaluate_chat_session_rag_debug(
                2,
                RagDebugEvaluateCreate(
                    content="이 페이지 설명해줘",
                    rag_scope=RagScope(sources=[RagScopeSource(id="3", type="note", title="Network")]),
                ),
                connection=object(),
                current_user={"id": 7},
                settings=Settings(app_env="local"),
            )

        retrieve.assert_called_once()
        self.assertEqual(result["mode"], "rag")
        self.assertEqual(result["search_targets"], {"note_ids": [3], "canvas_note_ids": []})
        self.assertEqual(result["debug"]["retrieved_chunk_count"], 1)
        self.assertEqual(result["context"]["retrieved_chunk_count"], 1)
        self.assertTrue(result["context"]["current_page_included"] is False)
        self.assertEqual(result["results"][0]["score"], 0.82)
        self.assertEqual(result["results"][0]["content"], "TCP congestion control text.")

    def test_normalize_rag_scope_keeps_current_folder_sources_only(self):
        with patch("backend.app.routes.chats.fetch_all") as fetch_all:
            fetch_all.side_effect = [
                [{"id": 3, "title": "Chapter 3"}],
                [{"id": 9, "title": "Canvas", "note_title": "Chapter 3"}],
            ]

            scope = normalize_rag_scope(
                object(),
                requested_scope={
                    "sources": [
                        {"id": "3", "type": "note", "title": "old"},
                        {"id": "999", "type": "note", "title": "other folder"},
                        {"id": "9", "type": "canvas_note", "title": "old canvas"},
                    ]
                },
                default_note={"id": 3, "folder_id": 2, "title": "Chapter 3"},
                user_id=7,
            )

        self.assertEqual(scope["sourceIds"], ["note:3", "canvas_note:9"])
        self.assertEqual(scope["sources"][0]["title"], "Chapter 3")
        self.assertEqual(scope["sources"][1]["title"], "Chapter 3 - Canvas")
        self.assertEqual(rag_scope_search_targets(scope), ([3], [9]))

    def test_normalize_rag_scope_falls_back_to_current_note_when_empty(self):
        with patch("backend.app.routes.chats.fetch_all") as fetch_all:
            fetch_all.side_effect = [[], []]

            scope = normalize_rag_scope(
                object(),
                requested_scope={"sources": []},
                default_note={"id": 3, "folder_id": 2, "title": "Chapter 3"},
                user_id=7,
            )

        self.assertEqual(scope["sourceIds"], ["note:3"])

    def test_retrieve_chunk_contexts_excludes_canvas_for_note_scope(self):
        captured = {}

        def fake_fetch_all(connection, query, params):
            captured["query"] = query
            captured["params"] = params
            return []

        with patch("backend.app.services.document_chunk_index.generate_embedding", return_value=[0.0] * 1536), patch(
            "backend.app.services.document_chunk_index.fetch_all",
            side_effect=fake_fetch_all,
        ):
            retrieve_chunk_contexts(
                object(),
                user_id=7,
                query="TCP",
                note_ids=[3],
                canvas_note_ids=[9],
                exclude_canvas_for_notes=True,
            )

        self.assertIn("source_type <> 'canvas_note'", captured["query"])
        self.assertIn("source_type = 'canvas_note'", captured["query"])
        self.assertIn(" OR ", captured["query"])

    def test_answer_sources_do_not_duplicate_page_label(self):
        source_text = format_answer_sources([
            RetrievedContext(
                source_type="pdf_page",
                source_id="10",
                title="자료구조 - 3페이지",
                content="Stack",
                page_number=3,
            )
        ])

        self.assertEqual(source_text, "참고 자료\n- 자료구조 - 3페이지")

    def test_chunker_uses_default_metadata_and_chunk_index(self):
        source = IndexSource(
            source_type="pdf_page",
            source_id="10",
            title="자료구조 - page 1",
            content="Stack is a LIFO data structure. " * 40,
            user_id=7,
            folder_id=2,
            note_id=3,
            page_number=1,
            metadata={"page_label": "1페이지"},
        )

        chunks = build_text_chunks(source)

        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0].chunk_index, 1)
        self.assertEqual(chunks[0].source.metadata["page_label"], "1페이지")

    def test_collect_note_index_sources_keeps_supported_source_types(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "PDF page text about stack push pop operations.",
                "textAnnotations": [{"id": "box-1", "text": "User text box about queue FIFO operations."}],
                "imageAnnotations": [
                    {
                        "id": "image-1",
                        "ocrText": "OCR text from a captured slide about algorithms.",
                        "analysisSummary": "AI summary of the captured diagram about data structures.",
                    }
                ],
            },
            ensure_ascii=False,
        )

        with patch("backend.app.services.document_chunk_index.fetch_one") as fetch_one, patch(
            "backend.app.services.document_chunk_index.fetch_all"
        ) as fetch_all:
            fetch_one.return_value = {
                "id": 3,
                "user_id": 7,
                "folder_id": 2,
                "title": "자료구조",
                "summary": "",
                "updated_at": None,
            }
            fetch_all.side_effect = [
                [{"id": 10, "note_id": 3, "page_number": 1, "content": page_state, "image_url": None, "updated_at": None}],
                [
                    {
                        "id": 20,
                        "note_id": 3,
                        "title": "Canvas",
                        "markdown": "Canvas note text about stack and queue operations.",
                        "document_json": {"type": "doc", "content": [{"type": "paragraph", "attrs": {"blockId": "b1"}}]},
                        "source_page_start": 1,
                        "source_page_end": 1,
                        "updated_at": None,
                    }
                ],
            ]

            sources = collect_note_index_sources(object(), note_id=3, user_id=7)

        self.assertEqual(
            {source.source_type for source in sources},
            {"pdf_page", "image_ai_summary", "canvas_note"},
        )
        canvas_source = next(source for source in sources if source.source_type == "canvas_note")
        self.assertEqual(canvas_source.metadata["block_ids"], ["b1"])

    def test_replace_note_page_chunks_deletes_legacy_page_sources_before_insert(self):
        executed = []

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, query, params=None):
                executed.append((query, params))

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                executed.append(("COMMIT", None))

            def rollback(self):
                executed.append(("ROLLBACK", None))

        with patch("backend.app.services.document_chunk_index.collect_note_page_index_sources", return_value=[]):
            count = replace_note_page_chunks(FakeConnection(), page_id=10, user_id=7)

        self.assertEqual(count, 0)
        delete_query, delete_params = executed[0]
        self.assertIn("DELETE FROM document_chunks", delete_query)
        self.assertEqual(delete_params[0], 7)
        self.assertIn("pdf_text_box", delete_params[1])
        self.assertIn("image_ocr", delete_params[1])
        self.assertIn("note_page", delete_params[1])
        self.assertEqual(delete_params[2], "10")
        self.assertEqual(delete_params[3], "10:%")

    def test_replace_canvas_chunks_deletes_legacy_canvas_sources_before_insert(self):
        executed = []

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, query, params=None):
                executed.append((query, params))

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                executed.append(("COMMIT", None))

            def rollback(self):
                executed.append(("ROLLBACK", None))

        with patch("backend.app.services.document_chunk_index.collect_canvas_index_sources", return_value=[]):
            count = replace_canvas_chunks(FakeConnection(), canvas_note_id=20, user_id=7)

        self.assertEqual(count, 0)
        delete_query, delete_params = executed[0]
        self.assertIn("DELETE FROM document_chunks", delete_query)
        self.assertEqual(delete_params[0], 7)
        self.assertIn("canvas_note", delete_params[1])
        self.assertIn("ai_canvas_note", delete_params[1])
        self.assertEqual(delete_params[2], "20")

    def test_replace_canvas_chunks_removes_legacy_canvas_type_when_new_chunks_remain(self):
        executed = []
        source = IndexSource(
            source_type="canvas_note",
            source_id="20",
            title="자료구조 - Canvas",
            content="Canvas note text about stack and queue operations.",
            user_id=7,
            folder_id=2,
            note_id=3,
        )

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, query, params=None):
                executed.append((query, params))

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                executed.append(("COMMIT", None))

            def rollback(self):
                executed.append(("ROLLBACK", None))

        with patch("backend.app.services.document_chunk_index.collect_canvas_index_sources", return_value=[source]), patch(
            "backend.app.services.document_chunk_index.get_settings",
            return_value=SimpleNamespace(openai_embedding_model="test-embedding-model"),
        ), patch(
            "backend.app.services.document_chunk_index.fetch_all",
            return_value=[{
                "user_id": 7,
                "source_type": "canvas_note",
                "source_id": "20",
                "chunk_index": 1,
                "content_hash": content_hash(source.content),
                "embedding_model": "test-embedding-model",
            }],
        ), patch("backend.app.services.document_chunk_index.generate_embedding") as generate_embedding:
            count = replace_canvas_chunks(FakeConnection(), canvas_note_id=20, user_id=7)

        self.assertEqual(count, 1)
        generate_embedding.assert_not_called()
        delete_query, delete_params = executed[0]
        self.assertIn("source_type <> 'canvas_note'", delete_query)
        self.assertIn("ai_canvas_note", delete_params[1])
        self.assertEqual(delete_params[2], "20")

    def test_delete_canvas_note_continues_when_rag_cleanup_fails(self):
        executed = []

        class FakeCursor:
            def __init__(self, fail_cleanup: bool = False):
                self.fail_cleanup = fail_cleanup

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, query, params=None):
                executed.append((query, params))
                if self.fail_cleanup and "document_chunks" in query:
                    raise RuntimeError("document_chunks missing")

        class FakeConnection:
            def __init__(self):
                self.cursor_count = 0
                self.rollback_count = 0
                self.commit_count = 0

            def cursor(self):
                self.cursor_count += 1
                return FakeCursor(fail_cleanup=self.cursor_count == 1)

            def rollback(self):
                self.rollback_count += 1
                executed.append(("ROLLBACK", None))

            def commit(self):
                self.commit_count += 1
                executed.append(("COMMIT", None))

        connection = FakeConnection()
        with patch("backend.app.routes.ai_canvas_notes.get_ai_canvas_note", return_value={"id": 20}):
            delete_ai_canvas_note(20, connection=connection, current_user={"id": 7})

        self.assertEqual(connection.rollback_count, 1)
        self.assertEqual(connection.commit_count, 1)
        self.assertTrue(any("DELETE FROM ai_canvas_notes" in query for query, _params in executed))

    def test_replace_note_chunks_skips_embedding_when_content_hash_is_unchanged(self):
        executed = []
        source = IndexSource(
            source_type="pdf_page",
            source_id="10",
            title="Network - page 1",
            content="TCP congestion control keeps the network stable.",
            user_id=7,
            folder_id=2,
            note_id=3,
            page_number=1,
            metadata={"page_label": "1"},
        )

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, query, params=None):
                executed.append((query, params))

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                executed.append(("COMMIT", None))

            def rollback(self):
                executed.append(("ROLLBACK", None))

        with patch("backend.app.services.document_chunk_index.collect_note_index_sources", return_value=[source]), patch(
            "backend.app.services.document_chunk_index.get_settings",
            return_value=SimpleNamespace(openai_embedding_model="test-embedding-model"),
        ), patch(
            "backend.app.services.document_chunk_index.fetch_all",
            return_value=[{
                "user_id": 7,
                "source_type": "pdf_page",
                "source_id": "10",
                "chunk_index": 1,
                "content_hash": content_hash(source.content),
                "embedding_model": "test-embedding-model",
            }],
        ), patch("backend.app.services.document_chunk_index.generate_embedding") as generate_embedding:
            count = replace_note_chunks(FakeConnection(), note_id=3, user_id=7)

        self.assertEqual(count, 1)
        generate_embedding.assert_not_called()
        self.assertTrue(any("UPDATE document_chunks" in query for query, _params in executed))

    def test_collect_canvas_index_sources_targets_one_canvas_note(self):
        with patch("backend.app.services.document_chunk_index.fetch_one") as fetch_one:
            fetch_one.return_value = {
                "id": 20,
                "note_id": 3,
                "title": "Canvas",
                "markdown": "Canvas note text about stack and queue operations.",
                "document_json": {"type": "doc", "content": [{"type": "paragraph", "attrs": {"blockId": "b1"}}]},
                "source_page_start": 1,
                "source_page_end": 2,
                "updated_at": None,
                "folder_id": 2,
                "note_title": "자료구조",
            }

            sources = collect_canvas_index_sources(object(), canvas_note_id=20, user_id=7)

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].source_type, "canvas_note")
        self.assertEqual(sources[0].source_id, "20")
        self.assertEqual(sources[0].metadata["block_ids"], ["b1"])

    def test_split_text_into_chunks_uses_overlap(self):
        chunks = split_text_into_chunks("abcdefghijklmnopqrstuvwxyz", chunk_size=10, overlap=2)

        self.assertEqual(chunks[0], "abcdefghij")
        self.assertEqual(chunks[1], "ijklmnopqr")

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

    def test_load_canvas_documents_targets_selected_canvas_notes(self):
        with patch("backend.app.services.rag_service.fetch_all") as fetch_all:
            fetch_all.return_value = [
                {
                    "id": 20,
                    "note_id": 1,
                    "title": "시험 대비 메모",
                    "markdown": "## 시험 포인트\n- Stack LIFO",
                    "source_page_start": 3,
                    "source_page_end": 4,
                    "note_title": "자료구조",
                }
            ]

            documents = load_canvas_documents(object(), canvas_note_ids=[20], user_id=7)

        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["source_type"], "canvas_note")
        self.assertEqual(documents[0]["source_id"], "20")
        self.assertIn("Stack LIFO", documents[0]["content"])

    def test_retrieve_rag_contexts_does_not_keyword_fallback_on_vector_error(self):
        with patch("backend.app.services.rag_service.retrieve_chunk_contexts", side_effect=RuntimeError("vector failed")), patch(
            "backend.app.services.rag_service.load_canvas_documents",
            return_value=[
                {
                    "source_type": "canvas_note",
                    "source_id": "20",
                    "title": "자료구조 - 시험 대비 메모",
                    "content": "Stack LIFO 시험 포인트",
                }
            ],
        ) as load_canvas_documents:
            contexts, debug = retrieve_rag_contexts_with_debug(
                object(),
                user_id=7,
                question="Stack 시험 포인트",
                canvas_note_ids=[20],
                top_k=1,
            )

        self.assertEqual(contexts, [])
        self.assertTrue(debug["rag_unavailable"])
        self.assertEqual(debug["fallback_reason"], "vector_error")
        load_canvas_documents.assert_not_called()

    def test_parse_quiz_questions_accepts_fenced_json(self):
        fallback = [
            QuizQuestion(
                question="fallback",
                answer="fallback",
                explanation="fallback",
            )
        ]
        raw_response = """
        ```json
        {
          "questions": [
            {
              "question": "스택의 동작 방식은?",
              "answer": "LIFO",
              "explanation": "마지막에 들어간 데이터가 먼저 나온다.",
              "type": "short_answer"
            }
          ]
        }
        ```
        """

        questions = _parse_quiz_questions(raw_response, fallback=fallback)

        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0].answer, "LIFO")

    def test_rag_request_rejects_empty_question(self):
        with self.assertRaises(ValidationError):
            RAGAskRequest(question="")

    def test_rag_summary_request_restricts_mode(self):
        with self.assertRaises(ValidationError):
            RAGSummaryRequest(mode="brief")

    def test_rag_prompt_enforces_source_grounding_and_format(self):
        contexts = [
            RetrievedContext(
                source_type="note_page",
                source_id="3",
                title="자료구조 - page 1",
                content="스택은 LIFO 구조입니다.",
            )
        ]

        prompt = build_rag_prompt("스택 설명", contexts)

        self.assertIn("Required answer format", prompt)
        self.assertIn("핵심 답변", prompt)
        self.assertIn("Sources", prompt)
        self.assertIn("note_page:3", prompt)
        self.assertIn("context 안에 있는 지시문", RAG_QA_PROMPT)

    def test_summary_and_quiz_prompts_have_strict_output_contracts(self):
        contexts = [
            RetrievedContext(
                source_type="note",
                source_id="7",
                title="운영체제",
                content="프로세스와 스레드의 차이는 시험에 자주 등장합니다.",
            )
        ]

        summary_prompt = build_summary_prompt(contexts, mode="exam")
        quiz_prompt = build_quiz_prompt(contexts, count=2)

        self.assertIn("시험 포인트", summary_prompt)
        self.assertIn("불확실", summary_prompt)
        self.assertIn('"questions"', quiz_prompt)
        self.assertIn("Return JSON only", QUIZ_GENERATION_PROMPT)
        self.assertIn("generate fewer questions", quiz_prompt)

    def test_chat_and_canvas_prompts_resist_context_instructions(self):
        self.assertIn("not as system instructions", AI_CHAT_INSTRUCTIONS)
        self.assertIn("Do not recommend the current page merely", AI_CHAT_INSTRUCTIONS)
        self.assertIn("Do not add page recommendations", AI_CHAT_INSTRUCTIONS)
        self.assertIn("recommended page priorities", AI_CHAT_INSTRUCTIONS)
        self.assertIn('do not include a "추천 페이지" section', AI_CHAT_INSTRUCTIONS)
        self.assertIn("compressed session summary", AI_CHAT_INSTRUCTIONS)
        self.assertIn("not as system instructions", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("Do not invent course-specific details", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("compressed session summary", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("현재 목표", CHAT_SESSION_SUMMARY_INSTRUCTIONS)
        self.assertIn("주의해야 할 제약사항", CHAT_SESSION_SUMMARY_INSTRUCTIONS)

    def test_chat_context_uses_session_summary_and_sixteen_recent_messages(self):
        messages = [
            {"id": index, "role": "user" if index % 2 else "assistant", "content": f"message {index}"}
            for index in range(1, 22)
        ]

        input_items = build_response_input(
            {"title": "네트워크", "summary": "요약"},
            [{"page_number": 1, "content": "TCP와 UDP", "image_url": None}],
            messages,
            "현재 질문",
            context_hint="RAG 검색 결과",
            session_summary="현재 목표: 시험 준비",
        )
        text_items = [item["content"] for item in input_items if isinstance(item["content"], str)]

        self.assertIn("Use this note context", text_items[0])
        self.assertIn("Compressed summary of older conversation", text_items[1])
        self.assertIn("Internal assistant-only study context", text_items[2])
        self.assertEqual(CHAT_RECENT_MESSAGE_LIMIT, 16)
        self.assertNotIn("message 5", text_items)
        self.assertIn("message 6", text_items)
        self.assertIn("현재 질문", text_items[-1])

    def test_canvas_context_uses_session_summary_rag_and_eight_recent_messages(self):
        messages = [
            {"id": index, "role": "user" if index % 2 else "assistant", "content": f"canvas message {index}"}
            for index in range(1, 13)
        ]
        captured = {}

        def fake_generate_text_response(**kwargs):
            captured["input_items"] = kwargs["input_items"]
            return json.dumps({
                "operations": [
                    {
                        "op": "insert_after",
                        "targetBlockId": None,
                        "node": {
                            "type": "paragraph",
                            "attrs": {"blockId": "new-block"},
                            "content": [{"type": "text", "text": "정리"}],
                        },
                    }
                ]
            })

        with patch("backend.app.services.openai_service.generate_text_response", side_effect=fake_generate_text_response):
            operations = generate_ai_canvas_operations_from_chat(
                model="gpt-test",
                note={"title": "운영체제", "summary": ""},
                pages=[{"page_number": 2, "content": "프로세스", "image_url": None}],
                messages=messages,
                user_content="캔버스에 정리해줘",
                canvas_title="Canvas Note",
                canvas_markdown="기존 정리",
                canvas_document_json={"type": "doc", "content": []},
                context_hint="RAG 검색 결과",
                session_summary="현재 목표: 중간고사 대비",
            )

        text_items = [item["content"] for item in captured["input_items"] if isinstance(item["content"], str)]
        self.assertEqual(CANVAS_RECENT_MESSAGE_LIMIT, 8)
        self.assertEqual(operations[0]["op"], "insert_after")
        self.assertIn("Canvas edit context follows", text_items[0])
        self.assertIn("Compressed summary of older conversation", text_items[1])
        self.assertIn("Internal assistant-only study context", text_items[2])
        self.assertNotIn("canvas message 4", text_items)
        self.assertIn("canvas message 5", text_items)
        self.assertIn("Current user request", text_items[-1])

    def test_generate_chat_session_summary_uses_existing_summary_and_new_messages(self):
        captured = {}

        def fake_generate_text_response(**kwargs):
            captured["instructions"] = kwargs["instructions"]
            captured["input_items"] = kwargs["input_items"]
            return "현재 목표\n- 시험 준비"

        with patch("backend.app.services.openai_service.generate_text_response", side_effect=fake_generate_text_response):
            summary = generate_chat_session_summary(
                model="gpt-test",
                previous_summary="현재 목표: 네트워크 복습",
                messages=[{"id": 10, "role": "user", "source": "chat", "content": "TCP 설명 선호"}],
            )

        self.assertIn("현재 목표", summary)
        self.assertIn("현재 목표", captured["instructions"])
        self.assertIn("Previous session summary", captured["input_items"][0]["content"])
        self.assertIn("TCP 설명 선호", captured["input_items"][0]["content"])
if __name__ == "__main__":
    unittest.main()
