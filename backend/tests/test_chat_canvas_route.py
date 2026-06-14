from queue import Queue
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.app.routes import chats
from backend.app.schemas.chats import ChatAiMessageCreate
from backend.app.services.ai_context_router import AiContextRoute


class ChatCanvasRouteTests(unittest.TestCase):
    def test_internal_ai_model_follows_selected_provider(self):
        settings = SimpleNamespace(
            ai_provider="openai",
            openai_default_model="gpt-4.1-mini",
            gemini_default_model="gemini-2.5-flash",
            default_ai_model="gpt-4.1-mini",
        )
        with patch.object(chats, "get_settings", return_value=settings):
            self.assertEqual(chats.get_internal_ai_model("gpt-5.5"), "gpt-4.1-mini")
            self.assertEqual(chats.get_internal_ai_model("gemini-3.1-pro"), "gemini-2.5-flash")
            self.assertEqual(chats.get_internal_ai_model(None), "gpt-4.1-mini")

    def test_resolve_ai_chat_execution_plan_handles_mixed_requests(self):
        cases = [
            ("TCP 설명해줘", "chat", True, "chat_only"),
            ("TCP 캔버스에 정리해줘", "chat", False, "canvas_edit"),
            ("TCP 설명해주고 캔버스에 정리해줘", "chat", True, "canvas_edit"),
            ("요약해줘", "chat", True, "chat_only"),
            ("요약해주고 캔버스에도 추가해줘", "chat", True, "canvas_edit"),
            ("새 정리본 만들고 핵심도 알려줘", "chat", True, "canvas_create"),
            ("요약해줘", "canvas-mini", False, "canvas_edit"),
            ("이게 무슨 뜻이야?", "canvas-block", True, "chat_only"),
            ("이 문장 쉽게 이해돼?", "canvas-block", True, "chat_only"),
            ("이게 무슨 뜻인지 설명하고 문장도 쉽게 바꿔줘", "canvas-block", True, "canvas_edit"),
            ("삭제해줘", "chat", True, "chat_only"),
            ("삭제해줘", "canvas-block", False, "canvas_edit"),
        ]

        with patch.object(chats, "generate_ai_canvas_intent", side_effect=AssertionError("fallback should not run")):
            for content, source, chat_answer_needed, canvas_action in cases:
                with self.subTest(content=content, source=source):
                    plan = chats.resolve_ai_chat_execution_plan(
                        content,
                        "auto",
                        "gpt-test",
                        canvas_origin_request=source in {"canvas-mini", "canvas-block"},
                    )
                    self.assertEqual(plan["chat_answer_needed"], chat_answer_needed)
                    self.assertEqual(plan["canvas_action"], canvas_action)

    def test_resolve_canvas_action_separates_chat_and_canvas_intent(self):
        cases = [
            ("요약해줘", False, "chat_only"),
            ("정리해줘", False, "chat_only"),
            ("삭제해줘", False, "chat_only"),
            ("캔버스에 요약해줘", False, "canvas_edit"),
            ("정리 노트에 추가해줘", False, "canvas_edit"),
            ("캔버스 내용 설명해줘", False, "chat_only"),
            ("새 노트북 추천해줘", False, "chat_only"),
            ("새 캔버스 기능 설명해줘", False, "chat_only"),
            ("새 노트 만드는 방법 알려줘", False, "chat_only"),
            ("새 캔버스 만들어줘", False, "canvas_create"),
            ("새 정리본 만들어줘", False, "canvas_create"),
            ("캔버스 만들어줘", False, "canvas_create"),
            ("정리본 만들어줘", False, "canvas_create"),
            ("요약본 만들어줘", False, "canvas_create"),
            ("캔버스에 정리해줘", False, "canvas_edit"),
            ("캔버스 내용 설명해줘", False, "chat_only"),
            ("요약해줘", True, "canvas_edit"),
            ("이 문장 맞아?", True, "chat_only"),
            ("이 문장 고쳐줘", True, "canvas_edit"),
            ("삭제해줘", True, "canvas_edit"),
            ("왜 이렇게 되는 거야?", True, "chat_only"),
            ("이 문장 쉽게 이해돼?", True, "chat_only"),
        ]

        with patch.object(chats, "generate_ai_canvas_intent", side_effect=AssertionError("fallback should not run")):
            for content, canvas_origin_request, expected in cases:
                with self.subTest(content=content, canvas_origin_request=canvas_origin_request):
                    self.assertEqual(
                        chats.resolve_canvas_action(
                            content,
                            "auto",
                            "gpt-test",
                            canvas_origin_request=canvas_origin_request,
                        ),
                        expected,
                    )

    def test_noop_canvas_create_deletes_created_canvas_note(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "새 채팅",
            "model": "gpt-test",
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "컴퓨터네트워크"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO ai_canvas_notes" in normalized_query:
                return canvas_note
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 101 if role == "user" else 102,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        execute_commit = MagicMock()
        payload = ChatAiMessageCreate(
            content="Canvas edit: 마무리 다듬기",
            canvas_action="canvas_create",
            canvas_recommendation_mode="polish",
        )

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "이전 질문"}]]),
            patch.object(chats, "fetch_one", return_value={"count": 0}),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit", execute_commit),
            patch.object(chats, "route_ai_context", return_value=AiContextRoute(mode="general", rewritten_query="", reason="llm")),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", return_value=[]),
            patch.object(chats, "generate_ai_canvas_title") as generate_title,
        ):
            result = chats.create_ai_chat_message(
                session_id=session["id"],
                payload=payload,
                connection=object(),
                current_user={"id": 7},
            )

        self.assertIsNone(result["canvas_edit"])
        self.assertIn("새 Canvas를 만들지 않았습니다", result["assistant_message"]["content"])
        generate_title.assert_not_called()
        delete_calls = [
            args
            for args, _kwargs in execute_commit.call_args_list
            if "DELETE FROM ai_canvas_notes" in args[1]
        ]
        self.assertEqual(len(delete_calls), 1)
        self.assertEqual(delete_calls[0][2], (canvas_note["id"],))

    def test_mixed_chat_and_canvas_request_generates_both_outputs(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "새 채팅",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": [], "sources": []},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "컴퓨터네트워크"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "기존 Canvas",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }
        operations = [
            {
                "op": "insert_after",
                "targetBlockId": None,
                "node": {"type": "paragraph", "attrs": {"blockId": "b1"}, "content": [{"type": "text", "text": "TCP 정리"}]},
            }
        ]

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 201 if role == "user" else 202,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        generate_chat_answer = MagicMock(
            return_value=(
                "TCP 흐름제어 답변\n\n"
                "필요하면 이 내용을 Canvas에 바로 반영해 드리겠습니다."
            )
        )
        generate_canvas_operations = MagicMock(return_value=operations)

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "이전 질문"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "get_internal_ai_model", return_value="gpt-4.1-mini"),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer", generate_chat_answer),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", generate_canvas_operations),
            patch.object(chats, "generate_chat_title", return_value="AI chat"),
        ):
            result = chats.create_ai_chat_message(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="TCP 설명해주고 캔버스에 정리해줘",
                    canvas_note_id=canvas_note["id"],
                    model="gpt-5.5",
                    rag_scope={"sourceIds": [], "sources": []},
                ),
                connection=object(),
                current_user={"id": 7},
            )

        self.assertIn("TCP 흐름제어 답변", result["assistant_message"]["content"])
        self.assertNotIn("필요하면 이 내용을 Canvas에 바로 반영해 드리겠습니다", result["assistant_message"]["content"])
        self.assertIn("‘Canvas Note 1’ Canvas에도 반영했습니다", result["assistant_message"]["content"])
        self.assertEqual(result["canvas_edit"]["operations"], operations)
        generate_chat_answer.assert_called_once()
        generate_canvas_operations.assert_called_once()
        self.assertEqual(generate_chat_answer.call_args.kwargs["model"], "gpt-5.5")
        self.assertEqual(generate_canvas_operations.call_args.kwargs["model"], "gpt-5.5")
        self.assertIn("will apply a Canvas edit", generate_chat_answer.call_args.kwargs["response_guidance"])
        self.assertIn("Do not promise, offer, or suggest", generate_chat_answer.call_args.kwargs["response_guidance"])
        self.assertEqual(
            generate_chat_answer.call_args.kwargs["context_hint"],
            generate_canvas_operations.call_args.kwargs["context_hint"],
        )

    def test_mixed_request_keeps_chat_answer_when_canvas_fails(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "새 채팅",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": [], "sources": []},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "컴퓨터네트워크"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "기존 Canvas",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 201 if role == "user" else 202,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "이전 질문"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer", return_value="TCP 흐름제어 답변"),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", side_effect=RuntimeError("canvas failed")),
        ):
            result = chats.create_ai_chat_message(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="TCP 설명해주고 캔버스에 정리해줘",
                    canvas_note_id=canvas_note["id"],
                    rag_scope={"sourceIds": [], "sources": []},
                ),
                connection=object(),
                current_user={"id": 7},
            )

        self.assertIsNone(result["canvas_edit"])
        self.assertIn("TCP 흐름제어 답변", result["assistant_message"]["content"])
        self.assertIn("다만 Canvas 반영에는 실패했습니다", result["assistant_message"]["content"])

    def test_mixed_request_with_no_canvas_operations_does_not_apply_canvas_edit(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "새 채팅",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": [], "sources": []},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "컴퓨터네트워크"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "기존 Canvas",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 201 if role == "user" else 202,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "이전 질문"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer", return_value="TCP 흐름제어 답변"),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", return_value=[]),
        ):
            result = chats.create_ai_chat_message(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="TCP 설명해주고 캔버스에 정리해줘",
                    canvas_note_id=canvas_note["id"],
                    rag_scope={"sourceIds": [], "sources": []},
                ),
                connection=object(),
                current_user={"id": 7},
            )

        self.assertIsNone(result["canvas_edit"])
        self.assertIn("TCP 흐름제어 답변", result["assistant_message"]["content"])
        self.assertIn("현재 Canvas 내용을 유지했습니다", result["assistant_message"]["content"])


    def test_canvas_visual_request_rechecks_pdf_images_without_chat_answer(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "AI chat",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": ["note:10"], "sources": [{"id": "10", "type": "note", "title": "Network"}]},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "Network"}
        pages = [
            {
                "id": 1,
                "note_id": 10,
                "page_number": 1,
                "content": "graph page",
                "image_url": None,
                "created_at": None,
                "updated_at": None,
            }
        ]
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }
        operations = [
            {
                "op": "insert_after",
                "targetBlockId": None,
                "node": {"type": "paragraph", "attrs": {"blockId": "b1"}, "content": [{"type": "text", "text": "graph summary"}]},
            }
        ]

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 301 if role == "user" else 302,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        def fake_build_ai_context(**kwargs):
            self.assertEqual(kwargs["priority_context_hints"], ["VISION_HINT"])
            return SimpleNamespace(
                context_pages=[],
                context_hint="CTX\nVISION_HINT",
                debug={},
                answer_sources_text=None,
            )

        generate_chat_answer = MagicMock(return_value="unused")
        generate_canvas_operations = MagicMock(return_value=operations)
        recheck_images = MagicMock(return_value=chats.ImageRecheckResult(context_hint="VISION_HINT"))

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[pages, [{"id": 1, "role": "user", "content": "previous"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "normalize_rag_scope", return_value=session["rag_scope"]),
            patch.object(chats, "route_ai_context", return_value=AiContextRoute(mode="rag", rewritten_query="이 그래프", reason="llm")),
            patch.object(chats, "rag_scope_search_targets", return_value=([10], [])),
            patch.object(chats, "note_rag_text_ready", return_value=(True, None)),
            patch.object(chats, "retrieve_rag_contexts_with_debug", return_value=([], {"retrieved_source_count": 0})),
            patch.object(chats, "maybe_recheck_pdf_images_for_chat", recheck_images),
            patch.object(chats, "build_ai_context", side_effect=fake_build_ai_context),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer", generate_chat_answer),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", generate_canvas_operations),
        ):
            result = chats.create_ai_chat_message(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="이 그래프를 캔버스에 정리해줘",
                    canvas_note_id=canvas_note["id"],
                    rag_scope=session["rag_scope"],
                ),
                connection=object(),
                current_user={"id": 7},
            )

        self.assertEqual(result["canvas_edit"]["operations"], operations)
        generate_chat_answer.assert_not_called()
        recheck_images.assert_called_once()
        generate_canvas_operations.assert_called_once()
        self.assertIn("VISION_HINT", generate_canvas_operations.call_args.kwargs["context_hint"])

    def test_chat_answer_dependent_canvas_request_uses_chat_answer_as_canvas_context(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "AI chat",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": [], "sources": []},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "Network"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }
        operations = [
            {
                "op": "insert_after",
                "targetBlockId": None,
                "node": {"type": "paragraph", "attrs": {"blockId": "b1"}, "content": [{"type": "text", "text": "TCP explanation"}]},
            }
        ]

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 401 if role == "user" else 402,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        generate_canvas_operations = MagicMock(return_value=operations)

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "previous"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(
                chats,
                "build_ai_context",
                return_value=SimpleNamespace(
                    context_pages=[],
                    context_hint="CTX",
                    debug={},
                    answer_sources_text="SOURCES FOOTER",
                ),
            ),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer", return_value="CHAT ANSWER SOURCE"),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", generate_canvas_operations),
            patch.object(chats, "generate_chat_title", return_value="AI chat"),
        ):
            result = chats.create_ai_chat_message(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="TCP 설명해주고 그 설명을 캔버스에 넣어줘",
                    canvas_note_id=canvas_note["id"],
                    rag_scope={"sourceIds": [], "sources": []},
                ),
                connection=object(),
                current_user={"id": 7},
            )

        self.assertEqual(result["canvas_edit"]["operations"], operations)
        self.assertIn("SOURCES FOOTER", result["assistant_message"]["content"])
        canvas_context_hint = generate_canvas_operations.call_args.kwargs["context_hint"]
        self.assertIn("Generated chat answer", canvas_context_hint)
        self.assertIn("CHAT ANSWER SOURCE", canvas_context_hint)
        self.assertNotIn("SOURCES FOOTER", canvas_context_hint)

    def test_chat_answer_dependent_canvas_request_stops_canvas_when_chat_fails(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "AI chat",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": [], "sources": []},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "Network"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }
        generate_canvas_operations = MagicMock(return_value=[])

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "previous"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer", side_effect=RuntimeError("chat failed")),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", generate_canvas_operations),
            patch.object(chats, "generate_chat_title", return_value="AI chat"),
        ):
            with self.assertRaises(RuntimeError):
                chats.create_ai_chat_message(
                    session_id=session["id"],
                    payload=ChatAiMessageCreate(
                        content="TCP 설명해주고 그 설명을 캔버스에 넣어줘",
                        canvas_note_id=canvas_note["id"],
                        rag_scope={"sourceIds": [], "sources": []},
                    ),
                    connection=object(),
                    current_user={"id": 7},
                )

        generate_canvas_operations.assert_not_called()

    def test_stream_impl_emits_answer_delta_and_canvas_status(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "AI chat",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": [], "sources": []},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "Network"}
        canvas_note = {
            "id": 99,
            "folder_id": 20,
            "note_id": 10,
            "title": "Canvas Note 1",
            "markdown": "",
            "document_json": {"type": "doc", "content": []},
            "revision": 1,
            "source_page_start": None,
            "source_page_end": None,
            "created_at": None,
            "updated_at": None,
        }
        operations = [
            {
                "op": "insert_after",
                "targetBlockId": None,
                "node": {"type": "paragraph", "attrs": {"blockId": "b1"}, "content": [{"type": "text", "text": "TCP"}]},
            }
        ]
        events = []

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 501 if role == "user" else 502,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        def fake_stream_answer(**kwargs):
            answer = "TCP answer\n필요하면 이 내용을 Canvas에 바로 반영해 드리겠습니다."
            kwargs["on_delta"]("TCP ")
            kwargs["on_delta"]("answer\n")
            kwargs["on_delta"]("필요하면 이 내용을 ")
            kwargs["on_delta"]("Canvas에 바로 반영해 드리겠습니다.")
            return answer

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[[], [{"id": 1, "role": "user", "content": "previous"}]]),
            patch.object(chats, "fetch_one", return_value=canvas_note),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer_stream", side_effect=fake_stream_answer),
            patch.object(chats, "generate_note_chat_answer", side_effect=AssertionError("non-stream answer should not run")),
            patch.object(chats, "generate_ai_canvas_operations_from_chat", return_value=operations),
        ):
            result = chats._create_ai_chat_message_impl(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="TCP 설명해주고 캔버스에 정리해줘",
                    canvas_note_id=canvas_note["id"],
                    rag_scope={"sourceIds": [], "sources": []},
                ),
                connection=object(),
                current_user={"id": 7},
                emit_event=lambda event, data: events.append((event, data)),
                stream_chat_answer=True,
            )

        self.assertEqual(result["canvas_edit"]["operations"], operations)
        answer_deltas = [data["delta"] for event, data in events if event == "answer_delta"]
        self.assertEqual(answer_deltas, ["TCP answer\n"])
        self.assertIn("TCP answer", result["assistant_message"]["content"])
        self.assertNotIn("필요하면 이 내용을 Canvas에 바로 반영해 드리겠습니다", result["assistant_message"]["content"])
        self.assertFalse(any(event == "canvas_done" for event, _data in events))
        self.assertEqual([data["message"] for event, data in events if event == "status"][0], "질문 이해 중...")
        self.assertIn("Canvas 반영 중...", [data["message"] for event, data in events if event == "status"])

    def test_stream_queue_emits_canvas_done_after_request_result(self):
        events: Queue[tuple[str, dict] | None] = Queue()
        canvas_edit = {
            "action": "canvas_edit",
            "canvas_note_id": 99,
            "title": "Canvas Note 1",
            "canvas_note": {"id": 99, "title": "Canvas Note 1"},
            "operations": [{"op": "insert_after"}],
        }
        result = {
            "model": "gpt-test",
            "user_message": {"id": 1, "session_id": 5, "role": "user", "content": "q", "source": "chat", "model": "gpt-test", "created_at": None},
            "assistant_message": {"id": 2, "session_id": 5, "role": "assistant", "content": "a", "source": "chat", "model": "gpt-test", "created_at": None},
            "canvas_edit": canvas_edit,
        }

        class FakeConnection:
            def __enter__(self):
                return object()

            def __exit__(self, _exc_type, _exc, _tb):
                return False

        with (
            patch.object(chats.Connection, "connect", return_value=FakeConnection()),
            patch.object(chats, "_create_ai_chat_message_impl", return_value=result),
        ):
            chats.enqueue_ai_chat_stream_events(
                events=events,
                session_id=5,
                payload=ChatAiMessageCreate(content="캔버스에 정리해줘"),
                current_user={"id": 7},
            )

        drained = []
        while True:
            item = events.get_nowait()
            if item is None:
                break
            drained.append(item)

        self.assertEqual([event for event, _data in drained], ["canvas_done", "final"])
        self.assertEqual(drained[0][1]["canvas_edit"], canvas_edit)
        self.assertEqual(drained[1][1], result)

    def test_stream_impl_emits_rag_and_image_statuses(self):
        session = {
            "id": 5,
            "note_id": 10,
            "title": "AI chat",
            "model": "gpt-test",
            "rag_scope": {"sourceIds": ["note:10"], "sources": [{"id": "10", "type": "note", "title": "Network"}]},
            "created_at": None,
            "updated_at": None,
            "summary": None,
            "summarized_message_id": None,
        }
        note = {"id": 10, "folder_id": 20, "title": "Network"}
        pages = [{"id": 1, "note_id": 10, "page_number": 1, "content": "TCP", "image_url": None, "created_at": None, "updated_at": None}]
        events = []

        def fake_execute_returning(_connection, query, params=()):
            normalized_query = " ".join(query.split())
            if "INSERT INTO chat_messages" in normalized_query:
                role = "user" if "'user'" in normalized_query else "assistant"
                return {
                    "id": 601 if role == "user" else 602,
                    "session_id": params[0],
                    "role": role,
                    "content": params[1],
                    "source": params[2],
                    "model": params[3],
                    "created_at": None,
                }
            raise AssertionError(f"Unexpected execute_returning query: {normalized_query}")

        def fake_stream_answer(**kwargs):
            kwargs["on_delta"]("RAG answer")
            return "RAG answer"

        with (
            patch.object(chats, "get_chat_session", return_value=session),
            patch.object(chats, "get_note_for_user", return_value=note),
            patch.object(chats, "fetch_all", side_effect=[pages, []]),
            patch.object(chats, "execute_returning", side_effect=fake_execute_returning),
            patch.object(chats, "execute_commit"),
            patch.object(chats, "get_note_course_name", return_value="Network"),
            patch.object(chats, "normalize_rag_scope", return_value=session["rag_scope"]),
            patch.object(chats, "route_ai_context", return_value=AiContextRoute(mode="rag", rewritten_query="TCP", reason="llm")),
            patch.object(chats, "rag_scope_search_targets", return_value=([10], [])),
            patch.object(chats, "note_rag_text_ready", return_value=(True, None)),
            patch.object(chats, "retrieve_rag_contexts_with_debug", return_value=([SimpleNamespace()], {"retrieved_source_count": 1})),
            patch.object(chats, "maybe_recheck_pdf_images_for_chat", return_value=chats.ImageRecheckResult()),
            patch.object(
                chats,
                "build_ai_context",
                return_value=SimpleNamespace(
                    context_pages=pages,
                    context_hint="CTX",
                    debug={},
                    answer_sources_text=None,
                ),
            ),
            patch.object(chats, "maybe_update_chat_session_summary", return_value=None),
            patch.object(chats, "generate_note_chat_answer_stream", side_effect=fake_stream_answer),
            patch.object(chats, "generate_chat_title", return_value=None),
        ):
            chats._create_ai_chat_message_impl(
                session_id=session["id"],
                payload=ChatAiMessageCreate(
                    content="TCP 설명해줘",
                    rag_scope=session["rag_scope"],
                ),
                connection=object(),
                current_user={"id": 7},
                emit_event=lambda event, data: events.append((event, data)),
                stream_chat_answer=True,
            )

        status_messages = [data["message"] for event, data in events if event == "status"]
        self.assertIn("질문 이해 중...", status_messages)
        self.assertIn("노트 참고 중...", status_messages)
        self.assertIn("이미지 분석 중...", status_messages)
        self.assertIn(("answer_delta", {"delta": "RAG answer"}), events)


if __name__ == "__main__":
    unittest.main()
