import unittest

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


if __name__ == "__main__":
    unittest.main()
