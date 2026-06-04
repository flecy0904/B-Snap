import unittest

from backend.app.services.document_matching import (
    build_document_match_key,
    documents_match,
    normalize_file_name_key,
    normalize_subject_key,
    subjects_match,
)


class DocumentMatchingTest(unittest.TestCase):
    def test_normalized_file_name_ignores_separators_and_case(self):
        self.assertEqual(
            normalize_file_name_key("[Lecture Note] Chapter 1. Computer Networks (wide).pdf"),
            normalize_file_name_key("lecture_note_chapter-1 computer networks wide.PDF"),
        )

    def test_same_filename_and_page_count_match_pdf(self):
        current = {
            "title": "[Lecture Note] Chapter 1. Computer Networks (wide)",
            "original_filename": "[Lecture Note] Chapter 1. Computer Networks (wide).pdf",
            "page_count": 93,
            "file_size_bytes": 4_000_000,
            "document_match_key": build_document_match_key("[Lecture Note] Chapter 1. Computer Networks (wide).pdf", 93),
        }
        candidate = {
            "title": "renamed by user",
            "original_filename": "[Lecture Note] Chapter 1. Computer Networks (wide).pdf",
            "page_count": 93,
            "file_size_bytes": 4_050_000,
            "document_match_key": build_document_match_key("[Lecture Note] Chapter 1. Computer Networks (wide).pdf", 93),
        }

        self.assertTrue(documents_match(current, candidate))

    def test_same_filename_with_different_page_count_does_not_match_pdf(self):
        current = {"original_filename": "강화학습_#9-2_(260430).pdf", "page_count": 31}
        candidate = {"original_filename": "강화학습_#9-2_(260430).pdf", "page_count": 42}

        self.assertFalse(documents_match(current, candidate))

    def test_same_filename_and_page_count_reject_large_file_size_gap(self):
        current = {
            "original_filename": "lecture1.pdf",
            "page_count": 20,
            "file_size_bytes": 1_000_000,
            "document_match_key": build_document_match_key("lecture1.pdf", 20),
        }
        candidate = {
            "original_filename": "lecture1.pdf",
            "page_count": 20,
            "file_size_bytes": 1_300_000,
            "document_match_key": build_document_match_key("lecture1.pdf", 20),
        }

        self.assertFalse(documents_match(current, candidate))

    def test_subject_alias_and_spacing_match(self):
        self.assertEqual(normalize_subject_key("1. 컴퓨터 네트워크"), "컴퓨터네트워크")
        self.assertTrue(subjects_match("컴네", "컴퓨터 네트워크"))
        self.assertTrue(subjects_match("강화", "강화학습2"))


if __name__ == "__main__":
    unittest.main()
