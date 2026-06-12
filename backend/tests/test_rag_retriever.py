import json
import tempfile
import unittest
from pathlib import Path
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
from backend.app.routes.rag import ask_rag
from backend.app.schemas.rag import QuizQuestion, RAGAskRequest, RAGSummaryRequest, RetrievedContext
from backend.app.routes.chats import normalize_rag_scope, rag_scope_search_targets
from backend.app.schemas.chats import RagScope, RagScopeSource
from backend.app.services.ai_context_builder import build_ai_context, format_answer_sources, select_rag_context_pages
from backend.app.services.ai_context_router import AiContextRoute, route_ai_context
from backend.app.services.docling_crop_debug import _should_use_full_page_context
from backend.app.services.pdf_image_recheck import _image_recheck_candidates, _selected_recheck_contexts, _server_image_mode
from backend.app.services.pdf_image_recheck import maybe_recheck_pdf_images_for_chat
from backend.app.services.document_chunk_index import (
    collect_canvas_index_sources,
    collect_note_index_sources,
    content_hash,
    replace_image_summary_chunks,
    replace_note_page_chunks,
    replace_note_pages_chunks,
    replace_note_chunks,
    retrieve_chunk_contexts,
)
from backend.app.services.rag_chunker import IndexSource, build_text_chunks, split_text_into_chunks
from backend.app.services.rag_service import (
    _parse_quiz_questions,
    load_canvas_documents,
    load_note_documents,
    retrieve_rag_contexts_with_debug,
)
from backend.app.services.openai_service import build_response_input, judge_pdf_image_recheck


class RAGRetrieverTest(unittest.TestCase):
    def test_full_page_context_ignores_tiny_far_apart_visual_candidate(self):
        page = SimpleNamespace(
            page_width=960.0,
            page_height=540.0,
            visual_candidates=[
                SimpleNamespace(bbox=(853.7681, 487.252, 954.5335, 523.1219)),
                SimpleNamespace(bbox=(282.7802, 82.7839, 670.6622, 211.073)),
            ],
        )

        self.assertFalse(_should_use_full_page_context(page))

    def test_full_page_context_uses_multiple_significant_visual_candidates(self):
        page = SimpleNamespace(
            page_width=1000.0,
            page_height=1000.0,
            visual_candidates=[
                SimpleNamespace(bbox=(10.0, 10.0, 210.0, 210.0)),
                SimpleNamespace(bbox=(240.0, 10.0, 440.0, 210.0)),
                SimpleNamespace(bbox=(470.0, 10.0, 670.0, 210.0)),
            ],
        )

        self.assertFalse(_should_use_full_page_context(page))

        page.visual_candidates.append(SimpleNamespace(bbox=(700.0, 10.0, 900.0, 210.0)))

        self.assertTrue(_should_use_full_page_context(page))

    def test_full_page_context_uses_one_large_visual_candidate(self):
        page = SimpleNamespace(
            page_width=1000.0,
            page_height=1000.0,
            visual_candidates=[
                SimpleNamespace(bbox=(50.0, 50.0, 750.0, 750.0)),
            ],
        )

        self.assertTrue(_should_use_full_page_context(page))

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

    def test_rag_context_pages_prioritize_current_then_neighbors(self):
        pages = [
            {"id": 1, "page_number": 1},
            {"id": 2, "page_number": 2},
            {"id": 3, "page_number": 3},
            {"id": 4, "page_number": 4},
        ]

        selected = select_rag_context_pages(pages, 3)

        self.assertEqual([page["page_number"] for page in selected], [3, 2, 4])

    def test_image_recheck_candidates_exclude_low_importance_summaries(self):
        contexts = [
            RetrievedContext(
                source_type="image_ai_summary",
                source_id="10",
                title="low image",
                content="low value image",
                metadata={"importance": "low"},
            ),
            RetrievedContext(
                source_type="image_ai_summary",
                source_id="11",
                title="medium image",
                content="useful image",
                metadata={"importance": "medium"},
            ),
            RetrievedContext(source_type="pdf_page", source_id="1", title="page", content="text"),
        ]

        candidates = _image_recheck_candidates(contexts, top_k=3)

        self.assertEqual([candidate.source_id for candidate in candidates], ["11"])

    def test_image_recheck_candidates_require_persisted_image_summary_id(self):
        contexts = [
            RetrievedContext(
                source_type="image_ai_summary",
                source_id="10:image-a:summary",
                title="annotation image",
                content="old annotation summary",
                metadata={"importance": "high"},
            ),
            RetrievedContext(
                source_type="image_ai_summary",
                source_id="chunk-derived-id",
                title="persisted image",
                content="stored image summary",
                metadata={"importance": "high", "image_ai_summary_id": 88},
            ),
        ]

        candidates = _image_recheck_candidates(contexts, top_k=3)

        self.assertEqual([candidate.title for candidate in candidates], ["persisted image"])

    def test_image_recheck_selection_defaults_to_one_image(self):
        first = RetrievedContext(source_type="image_ai_summary", source_id="10", title="first", content="first")
        second = RetrievedContext(source_type="image_ai_summary", source_id="11", title="second", content="second")

        selected = _selected_recheck_contexts(
            [first, second],
            selected_ids=["10", "11"],
            allow_multiple=False,
            max_images=2,
        )

        self.assertEqual([context.source_id for context in selected], ["10"])

    def test_image_recheck_selection_allows_two_images_when_judge_allows_multiple(self):
        first = RetrievedContext(source_type="image_ai_summary", source_id="10", title="first", content="first")
        second = RetrievedContext(source_type="image_ai_summary", source_id="11", title="second", content="second")

        selected = _selected_recheck_contexts(
            [first, second],
            selected_ids=["10", "11"],
            allow_multiple=True,
            max_images=2,
        )

        self.assertEqual([context.source_id for context in selected], ["10", "11"])

    def test_image_recheck_selection_does_not_fallback_when_judge_returns_unknown_id(self):
        first = RetrievedContext(source_type="image_ai_summary", source_id="10", title="first", content="first")

        selected = _selected_recheck_contexts(
            [first],
            selected_ids=["999"],
            allow_multiple=False,
            max_images=2,
        )

        self.assertEqual(selected, [])

    def test_image_recheck_selection_accepts_metadata_image_summary_id(self):
        first = RetrievedContext(
            source_type="image_ai_summary",
            source_id="chunk-derived-id",
            title="first",
            content="first",
            metadata={"image_ai_summary_id": 88},
        )

        selected = _selected_recheck_contexts(
            [first],
            selected_ids=["88"],
            allow_multiple=False,
            max_images=2,
        )

        self.assertEqual(selected, [first])

    def test_image_recheck_server_uses_full_page_only_for_allowed_conditions(self):
        self.assertEqual(
            _server_image_mode(
                preferred_mode="page_image",
                metadata={"context_bbox": [1, 2, 100, 120], "crop_mode": "image_with_context"},
                same_page_multiple=False,
            ),
            "context_crop",
        )
        self.assertEqual(
            _server_image_mode(
                preferred_mode="context_crop",
                metadata={"context_bbox": [1, 2, 100, 120], "crop_mode": "full_page_context"},
                same_page_multiple=False,
            ),
            "page_image",
        )
        self.assertEqual(
            _server_image_mode(
                preferred_mode="context_crop",
                metadata={"crop_mode": "image_with_context"},
                same_page_multiple=False,
            ),
            "page_image",
        )

    def test_image_recheck_multiple_selected_pages_are_scoped_by_note(self):
        from backend.app.services.pdf_image_recheck import _has_multiple_selected_on_same_page

        first = RetrievedContext(source_type="image_ai_summary", source_id="10", title="first", content="first", note_id=3, page_number=5)
        second = RetrievedContext(source_type="image_ai_summary", source_id="11", title="second", content="second", note_id=4, page_number=5)
        third = RetrievedContext(source_type="image_ai_summary", source_id="12", title="third", content="third", note_id=3, page_number=5)

        self.assertFalse(_has_multiple_selected_on_same_page([first, second]))
        self.assertTrue(_has_multiple_selected_on_same_page([first, third]))

    def test_image_recheck_skips_judge_when_no_image_summary_candidate_exists(self):
        with patch("backend.app.services.pdf_image_recheck.judge_pdf_image_recheck") as judge:
            result = maybe_recheck_pdf_images_for_chat(
                object(),
                note={"id": 3, "title": "Network", "file_url": "/uploads/network.pdf"},
                user_id=7,
                model="test-model",
                user_question="TCP 설명해줘",
                rag_sources=[RetrievedContext(source_type="pdf_page", source_id="1", title="page", content="text")],
                settings=Settings(rag_image_recheck_enabled=True),
            )

        judge.assert_not_called()
        self.assertEqual(result.debug["candidate_count"], 0)
        self.assertFalse(result.debug["judge_called"])

    def test_image_recheck_passes_current_page_to_judge(self):
        image_context = RetrievedContext(
            source_type="image_ai_summary",
            source_id="88",
            title="Image",
            content="diagram summary",
            page_number=51,
            metadata={"importance": "high", "context_bbox": [1, 2, 100, 120]},
        )
        with patch(
            "backend.app.services.pdf_image_recheck.judge_pdf_image_recheck",
            return_value={"needs_image_recheck": False, "image_ai_summary_ids": []},
        ) as judge:
            maybe_recheck_pdf_images_for_chat(
                object(),
                note={"id": 3, "title": "Current Note", "file_url": "/uploads/current.pdf"},
                user_id=7,
                model="test-model",
                user_question="지금 페이지는 어떻게 설명하고 있어?",
                current_page_number=64,
                rag_sources=[image_context],
                settings=Settings(rag_image_recheck_enabled=True),
            )

        self.assertEqual(judge.call_args.kwargs["current_page_number"], 64)

    def test_image_recheck_judge_input_includes_current_visible_page(self):
        captured = {}

        def fake_generate_text_response(**kwargs):
            captured["input_items"] = kwargs["input_items"]
            return '{"needs_image_recheck": false, "image_ai_summary_ids": [], "allow_multiple": false, "preferred_image_mode": "context_crop", "reason": "현재 페이지 후보가 아님"}'

        with patch("backend.app.services.openai_service.generate_text_response", side_effect=fake_generate_text_response):
            result = judge_pdf_image_recheck(
                model="test-model",
                user_question="지금 페이지는 어떻게 설명하고 있어?",
                current_page_number=64,
                text_contexts=[],
                image_candidates=[{"image_ai_summary_id": "88", "page_number": 51, "summary": "old page image"}],
            )

        self.assertFalse(result["needs_image_recheck"])
        self.assertIn("Current visible PDF page: 64", captured["input_items"][0]["content"])

    def test_image_recheck_uses_source_note_pdf_for_selected_summary(self):
        image_context = RetrievedContext(
            source_type="image_ai_summary",
            source_id="88",
            title="Other note image",
            content="diagram summary",
            note_id=9,
            page_number=2,
            metadata={"importance": "high", "context_bbox": [1, 2, 100, 120]},
        )
        captured = {}

        def fake_stored_note_pdf_path(note, settings=None):
            captured["note"] = note
            return Path("other-note.pdf")

        with patch(
            "backend.app.services.pdf_image_recheck.judge_pdf_image_recheck",
            return_value={
                "needs_image_recheck": True,
                "image_ai_summary_ids": ["88"],
                "allow_multiple": False,
                "preferred_image_mode": "context_crop",
                "reason": "needs visual check",
            },
        ), patch("backend.app.services.pdf_image_recheck.fetch_all", return_value=[{
            "id": 88,
            "folder_id": 2,
            "note_id": 9,
            "page_number": 2,
            "metadata": {"context_bbox": [1, 2, 100, 120], "crop_mode": "image_with_context"},
            "confidence": "high",
            "importance": "high",
            "crop_hash": "crop",
            "image_hash": "image",
            "note_title": "Other Note",
            "file_url": "/uploads/other.pdf",
        }]), patch(
            "backend.app.services.pdf_image_recheck.stored_note_pdf_path",
            side_effect=fake_stored_note_pdf_path,
        ), patch(
            "backend.app.services.pdf_image_recheck._render_recheck_image",
            return_value="data:image/png;base64,AA==",
        ):
            result = maybe_recheck_pdf_images_for_chat(
                object(),
                note={"id": 3, "title": "Current Note", "file_url": "/uploads/current.pdf"},
                user_id=7,
                model="test-model",
                user_question="이미지 확인해줘",
                rag_sources=[image_context],
                settings=Settings(rag_image_recheck_enabled=True),
            )

        self.assertEqual(captured["note"]["id"], 9)
        self.assertEqual(captured["note"]["file_url"], "/uploads/other.pdf")
        self.assertEqual(result.debug["rechecked_count"], 1)
        self.assertEqual(result.image_inputs[0]["image_data_uri"], "data:image/png;base64,AA==")

    def test_image_recheck_loads_row_by_metadata_image_summary_id(self):
        image_context = RetrievedContext(
            source_type="image_ai_summary",
            source_id="chunk-derived-id",
            title="Persisted image",
            content="diagram summary",
            note_id=9,
            page_number=2,
            metadata={"importance": "high", "image_ai_summary_id": 88, "context_bbox": [1, 2, 100, 120]},
        )

        with patch(
            "backend.app.services.pdf_image_recheck.judge_pdf_image_recheck",
            return_value={
                "needs_image_recheck": True,
                "image_ai_summary_ids": ["88"],
                "allow_multiple": False,
                "preferred_image_mode": "context_crop",
                "reason": "needs visual check",
            },
        ), patch("backend.app.services.pdf_image_recheck.fetch_all", return_value=[{
            "id": 88,
            "folder_id": 2,
            "note_id": 9,
            "page_number": 2,
            "metadata": {"context_bbox": [1, 2, 100, 120], "crop_mode": "image_with_context"},
            "confidence": "high",
            "importance": "high",
            "crop_hash": "crop",
            "image_hash": "image",
            "note_title": "Other Note",
            "file_url": "/uploads/other.pdf",
        }]), patch(
            "backend.app.services.pdf_image_recheck.stored_note_pdf_path",
            return_value=Path("other-note.pdf"),
        ), patch(
            "backend.app.services.pdf_image_recheck._render_recheck_image",
            return_value="data:image/png;base64,AA==",
        ):
            result = maybe_recheck_pdf_images_for_chat(
                object(),
                note={"id": 3, "title": "Current Note", "file_url": "/uploads/current.pdf"},
                user_id=7,
                model="test-model",
                user_question="이미지 확인해줘",
                rag_sources=[image_context],
                settings=Settings(rag_image_recheck_enabled=True),
            )

        self.assertEqual(result.debug["selected_ids"], ["88"])
        self.assertEqual(result.debug["rechecked_count"], 1)
        self.assertEqual(result.image_inputs[0]["image_ai_summary_id"], "88")

    def test_build_response_input_attaches_rag_recheck_images_to_final_answer_model(self):
        input_items = build_response_input(
            {"title": "Network", "summary": ""},
            [],
            [],
            "이 도표 설명해줘",
            context_hint="RAG context",
            rag_image_inputs=[{
                "image_ai_summary_id": "88",
                "page_number": 2,
                "title": "Network - page 2 image summary",
                "image_mode": "context_crop",
                "image_data_uri": "data:image/png;base64,AA==",
                "image_summary": "TCP diagram summary.",
            }],
        )

        final_item = input_items[-1]
        self.assertIsInstance(final_item["content"], list)
        self.assertTrue(any(part.get("type") == "input_image" for part in final_item["content"]))
        self.assertTrue(any("Original PDF image recheck source" in part.get("text", "") for part in final_item["content"]))

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

    def test_build_ai_context_places_image_recheck_before_rag_support(self):
        context = build_ai_context(
            mode="rag",
            pages=[],
            page_number=None,
            base_context_hints=["mode instruction"],
            priority_context_hints=["Vision Recheck Result\nverified visual evidence"],
            rag_sources=[RetrievedContext(source_type="image_ai_summary", source_id="1", title="Image", content="summary")],
        )

        self.assertLess(
            (context.context_hint or "").find("Vision Recheck Result"),
            (context.context_hint or "").find("RAG support context"),
        )

    def test_retrieve_rag_contexts_with_debug_does_not_keyword_fallback_on_empty_vector_results(self):
        with patch("backend.app.services.rag_service.retrieve_chunk_contexts", return_value=[]):
            contexts, debug = retrieve_rag_contexts_with_debug(object(), user_id=7, question="TCP", documents=[])

        self.assertEqual(contexts, [])
        self.assertFalse(debug["fallback"])
        self.assertEqual(debug["fallback_reason"], "vector_empty")
        self.assertTrue(debug["no_results"])
        self.assertEqual(debug["retrieved_chunk_count"], 0)

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
                [],
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
                [],
            ]

            sources = collect_note_index_sources(object(), note_id=3, user_id=7)

        self.assertEqual(
            {source.source_type for source in sources},
            {"pdf_page", "image_ai_summary", "canvas_note"},
        )
        canvas_source = next(source for source in sources if source.source_type == "canvas_note")
        self.assertEqual(canvas_source.metadata["block_ids"], ["b1"])

    def test_collect_note_index_sources_includes_completed_pdf_image_summary(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "PDF page text about TCP congestion control.",
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
                "title": "Network",
                "summary": "",
                "updated_at": None,
            }
            fetch_all.side_effect = [
                [{"id": 10, "note_id": 3, "page_number": 4, "content": page_state, "image_url": None, "updated_at": None}],
                [],
                [
                    {
                        "id": 99,
                        "folder_id": 2,
                        "note_id": 3,
                        "page_number": 4,
                        "candidate_type": "picture",
                        "crop_hash": "hash-context",
                        "image_hash": "hash-image",
                        "summary": "TCP congestion window graph summary.",
                        "ocr_text": "cwnd RTT",
                        "confidence": "high",
                        "importance": "medium",
                        "confidence_reason": "clear labels",
                        "importance_reason": "core diagram",
                        "metadata": {"context_bbox": [1, 2, 3, 4]},
                        "analyzed_at": None,
                        "updated_at": None,
                    }
                ],
            ]

            sources = collect_note_index_sources(object(), note_id=3, user_id=7)

        image_source = next(source for source in sources if source.source_type == "image_ai_summary")
        self.assertEqual(image_source.source_id, "99")
        self.assertEqual(image_source.page_number, 4)
        self.assertIn("TCP congestion", image_source.content)
        self.assertIn("cwnd RTT", image_source.content)
        self.assertEqual(image_source.metadata["importance"], "medium")
        self.assertEqual(image_source.metadata["context_bbox"], [1, 2, 3, 4])

    def test_cached_completed_image_summary_counts_toward_duplicate_filter(self):
        from backend.app.services.pdf_image_summary_index import refresh_note_image_ai_summaries

        class Candidate:
            page_number = 1
            crop_hash = "same-context-hash"
            image_crop_hash = "same-image-hash"
            candidate_type = "picture"
            self_ref = "#/pictures/1"
            docling_bbox = (1.0, 2.0, 3.0, 4.0)
            docling_coord_origin = "BOTTOMLEFT"
            pdf_bbox = (1.0, 2.0, 3.0, 4.0)
            image_bbox = (1.0, 2.0, 3.0, 4.0)
            context_bbox = (0.0, 1.0, 4.0, 5.0)
            crop_mode = "image_with_context"
            page_width = 100.0
            page_height = 100.0
            area_ratio = 0.2
            image_crop_width = 100
            image_crop_height = 100
            context_crop_width = 120
            context_crop_height = 120
            context_crop_data_uri = "data:image/png;base64,AA=="

        with patch("backend.app.services.pdf_image_summary_index.fetch_one") as fetch_one, patch(
            "backend.app.services.pdf_image_summary_index.fetch_all"
        ) as fetch_all, patch(
            "backend.app.services.pdf_image_summary_index.parse_and_cache_docling_batches"
        ) as parse_batches, patch(
            "backend.app.services.pdf_image_summary_index.cached_pages_from_batches"
        ) as cached_pages, patch(
            "backend.app.services.pdf_image_summary_index.extract_docling_crop_candidates_from_cached_pages"
        ) as extract_candidates, patch("backend.app.services.pdf_image_summary_index.generate_pdf_image_rag_summary") as generate_summary:
            fetch_one.return_value = {
                "id": 3,
                "user_id": 7,
                "folder_id": 2,
                "title": "Network",
                "file_url": "/uploads/test.pdf",
            }
            fetch_all.return_value = [{"id": 99, "page_number": 1, "crop_hash": "same-context-hash", "status": "completed"}]
            parse_batches.return_value = [object()]
            cached_pages.return_value = [object()]
            extract_candidates.return_value = type("Result", (), {"candidates": [Candidate(), Candidate()]})()

            with tempfile.TemporaryDirectory() as temp_dir:
                pdf_path = Path(temp_dir) / "test.pdf"
                pdf_path.write_bytes(b"%PDF-1.4\n")
                stats = refresh_note_image_ai_summaries(object(), note_id=3, user_id=7, pdf_path=pdf_path)

        self.assertEqual(stats["cached"], 2)
        generate_summary.assert_not_called()

    def test_image_summary_refresh_marks_old_page_candidates_stale(self):
        from backend.app.services.pdf_image_summary_index import refresh_note_image_ai_summaries

        class FakeCursor:
            def __init__(self, connection):
                self.connection = connection
                self.last_query = ""

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, query, params=None):
                self.last_query = query
                self.connection.executed.append((query, params))

            def fetchall(self):
                if "RETURNING id" in self.last_query:
                    return [{"id": 11}]
                return []

        class FakeConnection:
            def __init__(self):
                self.executed = []
                self.commits = 0

            def cursor(self):
                return FakeCursor(self)

            def commit(self):
                self.commits += 1

        class Candidate:
            page_number = 17
            crop_hash = "current-full-page-hash"
            image_crop_hash = "current-full-page-hash"
            candidate_type = "full_page"
            self_ref = None
            docling_bbox = (0.0, 0.0, 960.0, 540.0)
            docling_coord_origin = "TOPLEFT"
            pdf_bbox = (0.0, 0.0, 960.0, 540.0)
            image_bbox = (0.0, 0.0, 960.0, 540.0)
            context_bbox = (0.0, 0.0, 960.0, 540.0)
            crop_mode = "full_page_context"
            page_width = 960.0
            page_height = 540.0
            area_ratio = 1.0
            image_crop_width = 960
            image_crop_height = 540
            context_crop_width = 960
            context_crop_height = 540
            context_crop_data_uri = "data:image/png;base64,AA=="
            nearby_text = None

        connection = FakeConnection()
        with patch("backend.app.services.pdf_image_summary_index.fetch_one") as fetch_one, patch(
            "backend.app.services.pdf_image_summary_index.fetch_all"
        ) as fetch_all, patch(
            "backend.app.services.pdf_image_summary_index.parse_and_cache_docling_batches"
        ) as parse_batches, patch(
            "backend.app.services.pdf_image_summary_index.cached_pages_from_batches"
        ) as cached_pages, patch(
            "backend.app.services.pdf_image_summary_index.extract_docling_crop_candidates_from_cached_pages"
        ) as extract_candidates, patch("backend.app.services.pdf_image_summary_index.generate_pdf_image_rag_summary") as generate_summary:
            fetch_one.return_value = {
                "id": 3,
                "user_id": 7,
                "folder_id": 2,
                "title": "Network",
                "file_url": "/uploads/test.pdf",
            }
            fetch_all.return_value = [
                {"id": 11, "page_number": 17, "crop_hash": "old-picture-hash", "status": "completed"},
                {"id": 12, "page_number": 17, "crop_hash": "current-full-page-hash", "status": "completed"},
            ]
            parse_batches.return_value = [object()]
            cached_pages.return_value = [object()]
            extract_candidates.return_value = type("Result", (), {"candidates": [Candidate()]})()

            with tempfile.TemporaryDirectory() as temp_dir:
                pdf_path = Path(temp_dir) / "test.pdf"
                pdf_path.write_bytes(b"%PDF-1.4\n")
                stats = refresh_note_image_ai_summaries(connection, note_id=3, user_id=7, pdf_path=pdf_path)

        self.assertEqual(stats["stale"], 1)
        self.assertEqual(stats["cached"], 1)
        self.assertGreaterEqual(connection.commits, 1)
        executed_sql = "\n".join(query for query, _params in connection.executed)
        self.assertIn("skipped_reason = 'stale_candidate'", executed_sql)
        self.assertIn("DELETE FROM document_chunks", executed_sql)
        generate_summary.assert_not_called()

    def test_stale_image_summary_candidate_can_be_reprocessed_when_current_again(self):
        from backend.app.services.pdf_image_summary_index import refresh_note_image_ai_summaries

        class FakeCursor:
            def __init__(self, connection):
                self.connection = connection
                self.last_query = ""

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, query, params=None):
                self.last_query = query
                self.connection.executed.append((query, params))

            def fetchall(self):
                return []

        class FakeConnection:
            def __init__(self):
                self.executed = []

            def cursor(self):
                return FakeCursor(self)

            def commit(self):
                pass

        class Candidate:
            page_number = 17
            crop_hash = "revived-hash"
            image_crop_hash = "revived-image-hash"
            candidate_type = "picture"
            self_ref = "#/pictures/0"
            docling_bbox = (10.0, 20.0, 300.0, 400.0)
            docling_coord_origin = "TOPLEFT"
            pdf_bbox = (10.0, 20.0, 300.0, 400.0)
            image_bbox = (10.0, 20.0, 300.0, 400.0)
            context_bbox = (0.0, 10.0, 320.0, 420.0)
            crop_mode = "image_with_context"
            page_width = 960.0
            page_height = 540.0
            area_ratio = 0.2
            image_crop_width = 400
            image_crop_height = 300
            context_crop_width = 450
            context_crop_height = 340
            context_crop_data_uri = "data:image/png;base64,AA=="
            nearby_text = None

        with patch("backend.app.services.pdf_image_summary_index.fetch_one") as fetch_one, patch(
            "backend.app.services.pdf_image_summary_index.fetch_all"
        ) as fetch_all, patch(
            "backend.app.services.pdf_image_summary_index.parse_and_cache_docling_batches"
        ) as parse_batches, patch(
            "backend.app.services.pdf_image_summary_index.cached_pages_from_batches"
        ) as cached_pages, patch(
            "backend.app.services.pdf_image_summary_index.extract_docling_crop_candidates_from_cached_pages"
        ) as extract_candidates, patch("backend.app.services.pdf_image_summary_index.generate_pdf_image_rag_summary") as generate_summary:
            fetch_one.return_value = {
                "id": 3,
                "user_id": 7,
                "folder_id": 2,
                "title": "Network",
                "file_url": "/uploads/test.pdf",
            }
            fetch_all.return_value = [
                {
                    "id": 12,
                    "page_number": 17,
                    "crop_hash": "revived-hash",
                    "status": "skipped",
                    "skipped_reason": "stale_candidate",
                }
            ]
            parse_batches.return_value = [object()]
            cached_pages.return_value = [object()]
            extract_candidates.return_value = type("Result", (), {"candidates": [Candidate()]})()
            generate_summary.return_value = {
                "summary": "Recovered image summary",
                "ocr_text": "",
                "confidence": "high",
                "importance": "medium",
                "confidence_reason": "clear",
                "importance_reason": "useful",
            }

            with tempfile.TemporaryDirectory() as temp_dir:
                pdf_path = Path(temp_dir) / "test.pdf"
                pdf_path.write_bytes(b"%PDF-1.4\n")
                stats = refresh_note_image_ai_summaries(FakeConnection(), note_id=3, user_id=7, pdf_path=pdf_path)

        self.assertEqual(stats["cached"], 0)
        self.assertEqual(stats["completed"], 1)
        generate_summary.assert_called_once()

    def test_collect_note_index_sources_preserves_layout_blocks_for_pdf_pages(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "Main block text.\n\n[Figure labels]\nACK=100",
                "ragExtraction": {
                    "parser": "pymupdf",
                    "extractionStrategy": "pymupdf_layout_blocks_v2",
                    "readingOrderStrategy": "y_x_fallback",
                    "textBlockCount": 2,
                    "imageBlockCount": 0,
                    "headerFooterCandidates": [{"textPreview": "Transport Layer3-8"}],
                    "sideLabelCandidates": [{"textPreview": "ACK=100"}],
                    "textBlocks": [
                        {
                            "type": "text",
                            "role": "main_text",
                            "readingOrder": 0,
                            "blockIndex": 0,
                            "bbox": [10, 10, 200, 40],
                            "text": "Main block text.",
                        },
                        {
                            "type": "text",
                            "role": "side_label_candidate",
                            "readingOrder": 1,
                            "blockIndex": 1,
                            "bbox": [250, 80, 320, 100],
                            "text": "ACK=100",
                        },
                    ],
                },
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
                "title": "Network",
                "summary": "",
                "updated_at": None,
            }
            fetch_all.side_effect = [
                [{"id": 10, "note_id": 3, "page_number": 1, "content": page_state, "image_url": None, "updated_at": None}],
                [],
                [],
            ]

            sources = collect_note_index_sources(object(), note_id=3, user_id=7)

        pdf_source = sources[0]
        self.assertEqual(pdf_source.source_type, "pdf_page")
        self.assertEqual(pdf_source.metadata["extraction_strategy"], "pymupdf_layout_blocks_v2")
        self.assertEqual(pdf_source.metadata["header_footer_candidate_count"], 1)
        self.assertEqual(pdf_source.metadata["side_label_candidate_count"], 1)
        self.assertEqual(len(pdf_source.layout_blocks), 2)

    def test_collect_note_index_sources_uses_native_text_without_layout_block_chunking(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "Native text order should remain the chunk input.",
                "ragExtraction": {
                    "parser": "pymupdf",
                    "extractionStrategy": "pymupdf_native_text_with_blocks_v2",
                    "readingOrderStrategy": "pymupdf_native_text",
                    "textBlockCount": 1,
                    "imageBlockCount": 0,
                    "textBlocks": [
                        {
                            "type": "text",
                            "role": "main_text",
                            "readingOrder": 0,
                            "blockIndex": 0,
                            "bbox": [10, 10, 200, 40],
                            "text": "Block order metadata should not override native text.",
                        },
                    ],
                },
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
                "title": "Network",
                "summary": "",
                "updated_at": None,
            }
            fetch_all.side_effect = [
                [{"id": 10, "note_id": 3, "page_number": 1, "content": page_state, "image_url": None, "updated_at": None}],
                [],
                [],
            ]

            sources = collect_note_index_sources(object(), note_id=3, user_id=7)

        pdf_source = sources[0]
        self.assertEqual(pdf_source.source_type, "pdf_page")
        self.assertEqual(pdf_source.metadata["reading_order_strategy"], "pymupdf_native_text")
        self.assertEqual(pdf_source.layout_blocks, [])

    def test_collect_note_index_sources_prefers_visual_blocks_for_pdf_pages(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "[Title]\nNetwork\n\n[Content]\nTCP congestion control.",
                "ragExtraction": {
                    "parser": "pymupdf",
                    "extractionStrategy": "pymupdf_visual_blocks_v3",
                    "readingOrderStrategy": "visual_block_groups",
                    "visualBlocks": [
                        {
                            "role": "title",
                            "readingOrder": 0,
                            "blockIndex": 0,
                            "bbox": [10, 10, 300, 40],
                            "text": "Network",
                        },
                        {
                            "role": "content",
                            "readingOrder": 1,
                            "blockIndex": 1,
                            "bbox": [10, 80, 300, 120],
                            "text": "TCP congestion control.",
                        },
                    ],
                },
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
                "title": "Network",
                "summary": "",
                "updated_at": None,
            }
            fetch_all.side_effect = [
                [{"id": 10, "note_id": 3, "page_number": 1, "content": page_state, "image_url": None, "updated_at": None}],
                [],
                [],
            ]

            sources = collect_note_index_sources(object(), note_id=3, user_id=7)

        pdf_source = sources[0]
        self.assertEqual(pdf_source.metadata["reading_order_strategy"], "visual_block_groups")
        self.assertEqual(len(pdf_source.layout_blocks), 2)
        chunks = build_text_chunks(pdf_source)
        self.assertTrue(chunks[0].content.startswith("[Title]\nNetwork"))

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
        self.assertEqual(delete_params[2], "10")
        self.assertEqual(delete_params[3], "10:%")

    def test_replace_note_pages_chunks_updates_only_requested_pages(self):
        executed = []
        deleted_page_ids = []
        inserted_chunks = []
        source_one = IndexSource(
            source_type="pdf_page",
            source_id="10",
            title="Network - page 1",
            content="TCP congestion control keeps the network stable.",
            user_id=7,
            folder_id=2,
            note_id=3,
            page_number=1,
            metadata={"note_page_id": 10, "page_label": "1"},
        )
        source_two = IndexSource(
            source_type="pdf_page",
            source_id="11",
            title="Network - page 2",
            content="UDP multiplexing uses port numbers.",
            user_id=7,
            folder_id=2,
            note_id=3,
            page_number=2,
            metadata={"note_page_id": 11, "page_label": "2"},
        )

        class FakeConnection:
            def commit(self):
                executed.append(("COMMIT", None))

            def rollback(self):
                executed.append(("ROLLBACK", None))

        with patch("backend.app.services.document_chunk_index.fetch_one", return_value={
            "id": 3,
            "user_id": 7,
            "folder_id": 2,
            "title": "Network",
            "summary": "",
            "updated_at": None,
        }), patch("backend.app.services.document_chunk_index.fetch_all", return_value=[
            {"id": 10, "note_id": 3, "page_number": 1, "content": "", "image_url": None, "updated_at": None},
            {"id": 11, "note_id": 3, "page_number": 2, "content": "", "image_url": None, "updated_at": None},
        ]), patch(
            "backend.app.services.document_chunk_index._collect_page_index_sources",
            side_effect=[[source_one], [source_two]],
        ), patch(
            "backend.app.services.document_chunk_index._delete_obsolete_chunks_for_page",
            side_effect=lambda _connection, page_id, user_id, chunks: deleted_page_ids.append(page_id),
        ), patch(
            "backend.app.services.document_chunk_index._insert_chunks",
            side_effect=lambda _connection, chunks, embedding_model: inserted_chunks.extend(chunks),
        ), patch(
            "backend.app.services.document_chunk_index.get_settings",
            return_value=SimpleNamespace(openai_embedding_model="test-embedding-model"),
        ):
            count = replace_note_pages_chunks(FakeConnection(), note_id=3, user_id=7, page_numbers=[1, 2])

        self.assertEqual(count, 2)
        self.assertEqual(deleted_page_ids, [10, 11])
        self.assertEqual([chunk.source.source_id for chunk in inserted_chunks], ["10", "11"])
        self.assertEqual(executed, [("COMMIT", None)])

    def test_replace_image_summary_chunks_updates_single_summary_index(self):
        executed = []
        inserted_chunks = []
        deleted_summary_ids = []

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

        row = {
            "id": 88,
            "folder_id": 2,
            "note_id": 3,
            "page_number": 4,
            "candidate_type": "picture",
            "crop_hash": "crop-a",
            "image_hash": "image-a",
            "summary": "This image explains TCP congestion window growth.",
            "ocr_text": "cwnd",
            "confidence": "medium",
            "importance": "high",
            "confidence_reason": "Readable labels.",
            "importance_reason": "Central lecture diagram.",
            "metadata": {"crop_mode": "image_with_context"},
            "analyzed_at": None,
            "updated_at": None,
            "title": "Network",
            "note_folder_id": 2,
        }

        with patch("backend.app.services.document_chunk_index.fetch_one", return_value=row), patch(
            "backend.app.services.document_chunk_index._delete_obsolete_chunks_for_image_summary",
            side_effect=lambda _connection, image_summary_id, user_id, chunks: deleted_summary_ids.append(image_summary_id),
        ), patch(
            "backend.app.services.document_chunk_index._insert_chunks",
            side_effect=lambda _connection, chunks, embedding_model: inserted_chunks.extend(chunks),
        ), patch(
            "backend.app.services.document_chunk_index.get_settings",
            return_value=SimpleNamespace(openai_embedding_model="test-embedding-model"),
        ):
            count = replace_image_summary_chunks(FakeConnection(), image_summary_id=88, user_id=7)

        self.assertEqual(count, 1)
        self.assertEqual(deleted_summary_ids, [88])
        self.assertEqual(inserted_chunks[0].source.source_type, "image_ai_summary")
        self.assertEqual(inserted_chunks[0].source.source_id, "88")
        update_query, update_params = executed[0]
        self.assertIn("UPDATE image_ai_summaries", update_query)
        self.assertEqual(update_params, (True, True, 88, 7))
        self.assertEqual(executed[-1], ("COMMIT", None))

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
        chunks = split_text_into_chunks("alpha beta gamma delta epsilon zeta", chunk_size=18, overlap=6)

        self.assertEqual(chunks[0], "alpha beta gamma")
        self.assertTrue(chunks[1].startswith("gamma"))

    def test_split_text_into_chunks_does_not_split_single_long_token(self):
        chunks = split_text_into_chunks("abcdefghijklmnopqrstuvwxyz", chunk_size=10, overlap=2)

        self.assertEqual(chunks, ["abcdefghijklmnopqrstuvwxyz"])

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

if __name__ == "__main__":
    unittest.main()
