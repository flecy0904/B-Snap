import unittest

from pydantic import ValidationError

from backend.app.schemas.chats import ChatAiMessageCreate


class ChatSchemaTests(unittest.TestCase):
    def test_chat_ai_message_accepts_canvas_recommendation_modes(self):
        for mode in [
            "polish",
            "simplify",
            "professionalize",
            "shorten",
            "expand",
            "restructure",
            "extract_key_points",
            "mark_uncertain",
        ]:
            payload = ChatAiMessageCreate(content="Canvas edit", canvas_recommendation_mode=mode)
            self.assertEqual(payload.canvas_recommendation_mode, mode)

    def test_chat_ai_message_rejects_removed_current_page_recommendation_mode(self):
        with self.assertRaises(ValidationError):
            ChatAiMessageCreate(content="Canvas edit", canvas_recommendation_mode="enrich_from_current_context")

    def test_chat_ai_message_rejects_invalid_canvas_recommendation_mode(self):
        with self.assertRaises(ValidationError):
            ChatAiMessageCreate(content="Canvas edit", canvas_recommendation_mode="longer")


if __name__ == "__main__":
    unittest.main()
