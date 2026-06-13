import unittest

from backend.app.routes.chats import (
    extract_canvas_operations_text,
    is_default_canvas_title,
    normalize_generated_canvas_title,
)


class AiCanvasTitlePolicyTests(unittest.TestCase):
    def test_extract_canvas_operations_text_uses_inserted_node_text(self):
        operations = [
            {
                "op": "insert_after",
                "targetBlockId": None,
                "node": {
                    "type": "heading",
                    "attrs": {"blockId": "block_new"},
                    "content": [{"type": "text", "text": "TD vs MC"}],
                },
            },
            {
                "op": "insert_after",
                "targetBlockId": "block_new",
                "node": {
                    "type": "paragraph",
                    "attrs": {"blockId": "block_body"},
                    "content": [{"type": "text", "text": "강화학습 비교 메모"}],
                },
            },
        ]

        text = extract_canvas_operations_text(operations)

        self.assertIn("TD vs MC", text)
        self.assertIn("강화학습 비교 메모", text)

    def test_default_canvas_title_detection_includes_page_fallback_title(self):
        self.assertTrue(is_default_canvas_title("Canvas Note"))
        self.assertTrue(is_default_canvas_title("Canvas Note 1"))
        self.assertTrue(is_default_canvas_title("p.3 메모"))
        self.assertFalse(is_default_canvas_title("TD vs MC"))

    def test_generic_generated_title_falls_back_to_default_canvas_title(self):
        self.assertEqual(
            normalize_generated_canvas_title("정리 보강", "Canvas Note 2"),
            "Canvas Note 2",
        )

    def test_legacy_page_fallback_title_is_not_reused(self):
        self.assertEqual(
            normalize_generated_canvas_title("정리 보강", "p.3 메모"),
            "Canvas Note",
        )

    def test_topic_generated_title_is_preserved(self):
        self.assertEqual(
            normalize_generated_canvas_title("TD vs MC", "Canvas Note 2"),
            "TD vs MC",
        )


if __name__ == "__main__":
    unittest.main()
