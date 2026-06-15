import unittest
from unittest.mock import patch

from backend.app.services.docling_batch_pipeline import note_rag_text_ready


class RagReadinessTests(unittest.TestCase):
    def test_page_based_note_without_job_is_ready(self):
        with patch(
            "backend.app.services.docling_batch_pipeline.fetch_all",
            side_effect=[
                [],
                [{"id": 7, "file_url": None}],
            ],
        ):
            ready, pending = note_rag_text_ready(object(), note_ids=[7], user_id=1)

        self.assertTrue(ready)
        self.assertIsNone(pending)

    def test_file_based_note_without_job_is_not_ready(self):
        with patch(
            "backend.app.services.docling_batch_pipeline.fetch_all",
            side_effect=[
                [],
                [{"id": 7, "file_url": "/uploads/lecture.pdf"}],
            ],
        ):
            ready, pending = note_rag_text_ready(object(), note_ids=[7], user_id=1)

        self.assertFalse(ready)
        self.assertEqual(pending, {"note_id": 7, "reason": "missing_job"})

    def test_page_based_note_with_processing_job_is_ready(self):
        with patch(
            "backend.app.services.docling_batch_pipeline.fetch_all",
            side_effect=[
                [
                    {
                        "note_id": 7,
                        "parser": "note_page",
                        "text_status": "processing",
                        "image_status": "processing",
                        "overall_status": "processing",
                        "last_error": None,
                    }
                ],
                [{"id": 7, "file_url": ""}],
            ],
        ):
            ready, pending = note_rag_text_ready(object(), note_ids=[7], user_id=1)

        self.assertTrue(ready)
        self.assertIsNone(pending)

    def test_file_based_processing_job_is_not_ready(self):
        job = {
            "note_id": 7,
            "parser": "docling",
            "text_status": "processing",
            "image_status": "processing",
            "overall_status": "processing",
            "last_error": None,
        }
        with patch(
            "backend.app.services.docling_batch_pipeline.fetch_all",
            side_effect=[
                [job],
                [{"id": 7, "file_url": "/uploads/lecture.pdf"}],
            ],
        ):
            ready, pending = note_rag_text_ready(object(), note_ids=[7], user_id=1)

        self.assertFalse(ready)
        self.assertEqual(pending, job)


if __name__ == "__main__":
    unittest.main()
