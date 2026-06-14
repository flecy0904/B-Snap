import unittest

from backend.app.services.openai_service import _validate_canvas_operations


class OpenAiCanvasOperationTests(unittest.TestCase):
    def test_insert_after_string_null_target_is_normalized_to_none(self):
        operations = _validate_canvas_operations({
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": "null",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "new_block"},
                        "content": [{"type": "text", "text": "새 Canvas 내용"}],
                    },
                },
            ],
        })

        self.assertEqual(operations[0]["targetBlockId"], None)


if __name__ == "__main__":
    unittest.main()
