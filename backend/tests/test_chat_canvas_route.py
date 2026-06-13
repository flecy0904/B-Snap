import unittest
from unittest.mock import MagicMock, patch

from backend.app.routes import chats
from backend.app.schemas.chats import ChatAiMessageCreate
from backend.app.services.ai_context_router import AiContextRoute


class ChatCanvasRouteTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
