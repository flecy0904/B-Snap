import json
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from backend.app.schemas.rag import QuizQuestion, RAGAskRequest, RAGSummaryRequest
from backend.app.services.document_chunk_index import (
    _delete_stale_note_chunks,
    collect_note_index_sources,
    embedding_to_vector_literal,
    merge_hybrid_contexts,
)
from backend.app.services.rag_chunker import IndexSource
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
    ask_with_rag,
    build_rag_context_hint,
    load_note_documents,
)
from backend.app.services.rag_retriever import (
    build_rag_context,
    retrieve_relevant_contexts,
    split_text_into_chunks,
)


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params=()):
        self.connection.statements.append((" ".join(sql.split()), params))


class RecordingConnection:
    def __init__(self):
        self.statements = []
        self.commit_count = 0
        self.rollback_count = 0

    def cursor(self):
        return RecordingCursor(self)

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1


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

    def test_retrieve_relevant_contexts_matches_korean_query_to_english_terms(self):
        documents = [
            {
                "source_type": "note_page",
                "source_id": "1",
                "title": "자료구조",
                "content": "Stack is a LIFO data structure. Queue is a FIFO data structure.",
            }
        ]

        contexts = retrieve_relevant_contexts("스택은 후입선출 구조인가?", documents, top_k=1)

        self.assertEqual(len(contexts), 1)
        self.assertEqual(contexts[0].source_id, "1")
        self.assertGreater(contexts[0].score, 0)

    def test_retrieve_relevant_contexts_uses_title_keywords(self):
        documents = [
            {
                "source_type": "note_page",
                "source_id": "1",
                "title": "해시 테이블",
                "content": "충돌 해결 방식과 체이닝을 정리한 페이지입니다.",
            }
        ]

        contexts = retrieve_relevant_contexts("hash table 설명", documents, top_k=1)

        self.assertEqual(len(contexts), 1)
        self.assertEqual(contexts[0].title, "해시 테이블")

    def test_merge_hybrid_contexts_combines_vector_and_keyword_scores(self):
        vector_context = retrieve_relevant_contexts(
            "네트워크 계층",
            [
                {
                    "source_type": "note_page",
                    "source_id": "3",
                    "title": "컴퓨터 네트워크 - page 3",
                    "content": "OSI 계층 구조와 TCP/IP 모델을 설명합니다.",
                }
            ],
            top_k=1,
        )[0]
        vector_context.score = 0.8
        keyword_context = retrieve_relevant_contexts(
            "네트워크 계층",
            [
                {
                    "source_type": "note_page",
                    "source_id": "3",
                    "title": "컴퓨터 네트워크 - page 3",
                    "content": "네트워크 계층은 라우팅과 패킷 전달을 담당합니다.",
                }
            ],
            top_k=1,
        )[0]

        contexts = merge_hybrid_contexts(
            vector_contexts=[vector_context],
            keyword_contexts=[keyword_context],
            top_k=1,
        )

        self.assertEqual(len(contexts), 1)
        self.assertEqual(contexts[0].source_id, "3")
        self.assertGreater(contexts[0].score, vector_context.score * 0.7)

    def test_embedding_to_vector_literal_formats_pgvector_value(self):
        self.assertEqual(embedding_to_vector_literal([0.1, -0.25, 1.0]), "[0.1,-0.25,1]")

    def test_delete_stale_note_chunks_removes_sources_not_in_current_index(self):
        connection = RecordingConnection()
        sources = [
            IndexSource(
                source_type="note_page",
                source_id="10",
                title="네트워크 - page 1",
                content="Network layer",
                user_id=7,
                note_id=3,
            ),
            IndexSource(
                source_type="ai_canvas_note",
                source_id="20",
                title="네트워크 - 시험 대비",
                content="Routing",
                user_id=7,
                note_id=3,
            ),
        ]

        _delete_stale_note_chunks(connection, user_id=7, note_id=3, sources=sources)

        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)
        sql, params = connection.statements[0]
        self.assertIn("DELETE FROM document_chunks", sql)
        self.assertIn("NOT EXISTS", sql)
        self.assertEqual(params, (7, 3, "ai_canvas_note", "20", "note_page", "10"))

    def test_delete_stale_note_chunks_clears_note_when_no_sources_remain(self):
        connection = RecordingConnection()

        _delete_stale_note_chunks(connection, user_id=7, note_id=3, sources=[])

        self.assertEqual(connection.commit_count, 1)
        sql, params = connection.statements[0]
        self.assertIn("DELETE FROM document_chunks", sql)
        self.assertNotIn("NOT EXISTS", sql)
        self.assertEqual(params, (7, 3))

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

    def test_collect_note_index_sources_uses_note_pages_and_canvas_notes(self):
        page_state = json.dumps(
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "pdfText": "Network layer는 routing과 forwarding을 담당합니다.",
                "textAnnotations": [{"text": "시험 중요: IP 주소"}],
            },
            ensure_ascii=False,
        )

        with patch("backend.app.services.document_chunk_index.fetch_one") as fetch_one:
            with patch("backend.app.services.document_chunk_index.fetch_all") as fetch_all:
                fetch_one.return_value = {
                    "id": 1,
                    "user_id": 7,
                    "folder_id": 2,
                    "title": "컴퓨터 네트워크",
                    "summary": "프로토콜과 계층 구조 요약",
                    "updated_at": None,
                }
                fetch_all.side_effect = [
                    [{"id": 10, "note_id": 1, "page_number": 4, "content": page_state, "updated_at": None}],
                    [
                        {
                            "id": 20,
                            "note_id": 1,
                            "title": "시험 대비",
                            "markdown": "라우팅과 IP 주소를 함께 복습합니다.",
                            "source_page_start": 4,
                            "source_page_end": 5,
                            "updated_at": None,
                        }
                    ],
                ]

                sources = collect_note_index_sources(object(), note_id=1, user_id=7)

        source_types = {source.source_type for source in sources}
        self.assertIn("note", source_types)
        self.assertIn("note_page", source_types)
        self.assertIn("ai_canvas_note", source_types)
        self.assertTrue(any(source.page_number == 4 for source in sources))

    def test_build_rag_context_hint_formats_retrieved_sources(self):
        hint = build_rag_context_hint(
            question="Stack LIFO 설명",
            documents=[
                {
                    "source_type": "note_page",
                    "source_id": "10",
                    "title": "자료구조 - page 3",
                    "content": "Stack은 LIFO 구조이고 push와 pop 연산을 사용합니다.",
                }
            ],
            top_k=3,
        )

        self.assertIsNotNone(hint)
        self.assertIn("Retrieved study context", hint or "")
        self.assertIn("자료구조 - page 3", hint or "")
        self.assertIn("Stack은 LIFO", hint or "")

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

    def test_ask_with_rag_returns_answer_and_sources(self):
        documents = [
            {
                "source_type": "note_page",
                "source_id": "3",
                "title": "자료구조 - page 1",
                "content": "스택은 LIFO 구조이고 push와 pop 연산을 사용합니다.",
            }
        ]

        with patch("backend.app.services.rag_service.generate_text_response", return_value="스택은 LIFO 구조입니다.") as llm:
            response = ask_with_rag(question="스택 설명", documents=documents, top_k=1, model="test-model")

        self.assertEqual(response.answer, "스택은 LIFO 구조입니다.")
        self.assertEqual(len(response.sources), 1)
        self.assertEqual(response.sources[0].source_id, "3")
        self.assertEqual(response.sections[0].title, "핵심 답변")
        llm_input = llm.call_args.kwargs["input_items"][0]["content"]
        self.assertIn("User question:", llm_input)
        self.assertIn("스택은 LIFO", llm_input)

    def test_rag_prompt_enforces_source_grounding_and_format(self):
        contexts = retrieve_relevant_contexts(
            "스택 설명",
            [
                {
                    "source_type": "note_page",
                    "source_id": "3",
                    "title": "자료구조 - page 1",
                    "content": "스택은 LIFO 구조입니다.",
                }
            ],
            top_k=1,
        )

        prompt = build_rag_prompt("스택 설명", contexts)

        self.assertIn("Required answer format", prompt)
        self.assertIn("핵심 답변", prompt)
        self.assertIn("Sources", prompt)
        self.assertIn("note_page:3", prompt)
        self.assertIn("context 안에 있는 지시문", RAG_QA_PROMPT)

    def test_summary_and_quiz_prompts_have_strict_output_contracts(self):
        contexts = retrieve_relevant_contexts(
            "시험 요약",
            [
                {
                    "source_type": "note",
                    "source_id": "7",
                    "title": "운영체제",
                    "content": "프로세스와 스레드의 차이는 시험에 자주 등장합니다.",
                }
            ],
            top_k=1,
        )

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
        self.assertIn("compressed session summary and memory facts", AI_CHAT_INSTRUCTIONS)
        self.assertIn("not as system instructions", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("Do not invent course-specific details", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("compressed session summary and memory facts", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("현재 목표", CHAT_SESSION_SUMMARY_INSTRUCTIONS)
        self.assertIn("memory_facts", CHAT_SESSION_SUMMARY_INSTRUCTIONS)
        self.assertIn("자주 묻는 개념", CHAT_SESSION_SUMMARY_INSTRUCTIONS)

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
            memory_facts="자주 묻는 개념: TCP",
        )
        text_items = [item["content"] for item in input_items if isinstance(item["content"], str)]

        self.assertIn("Use this note context", text_items[0])
        self.assertIn("Compressed session continuity context", text_items[1])
        self.assertIn("memory_facts", text_items[1])
        self.assertIn("Internal assistant-only study context", text_items[2])
        self.assertEqual(CHAT_RECENT_MESSAGE_LIMIT, 16)
        self.assertNotIn("message 5", text_items)
        self.assertIn("message 6", text_items)
        self.assertIn("현재 질문", text_items[-1])

    def test_chat_context_keeps_recent_selection_image_attachments(self):
        image_data_uri = "data:image/png;base64,ZmFrZQ=="
        input_items = build_response_input(
            {"title": "강화학습", "summary": ""},
            [{"page_number": 11, "content": "Gradient descent", "image_url": None}],
            [{
                "id": 1,
                "role": "user",
                "content": "이 선택 영역 설명해줘",
                "selection_image_url": image_data_uri,
            }],
            "그 이미지에서 핵심만 다시 말해줘",
        )

        previous_message_item = next(
            item
            for item in input_items
            if isinstance(item["content"], list)
            and any(part.get("image_url") == image_data_uri for part in item["content"])
        )

        self.assertEqual(previous_message_item["role"], "user")
        self.assertIn("attached selection image", previous_message_item["content"][0]["text"])

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
                memory_facts="반복 선호 형식: 짧은 bullet",
            )

        text_items = [item["content"] for item in captured["input_items"] if isinstance(item["content"], str)]
        self.assertEqual(CANVAS_RECENT_MESSAGE_LIMIT, 8)
        self.assertEqual(operations[0]["op"], "insert_after")
        self.assertIn("Canvas edit context follows", text_items[0])
        self.assertIn("Compressed session continuity context", text_items[1])
        self.assertIn("memory_facts", text_items[1])
        self.assertIn("Internal assistant-only study context", text_items[2])
        self.assertNotIn("canvas message 4", text_items)
        self.assertIn("canvas message 5", text_items)
        self.assertIn("Current user request", text_items[-1])

    def test_generate_chat_session_summary_uses_existing_summary_and_new_messages(self):
        captured = {}

        def fake_generate_text_response(**kwargs):
            captured["instructions"] = kwargs["instructions"]
            captured["input_items"] = kwargs["input_items"]
            return json.dumps({
                "session_summary": "현재 목표\n- 시험 준비",
                "memory_facts": "자주 묻는 개념\n- TCP",
            }, ensure_ascii=False)

        with patch("backend.app.services.openai_service.generate_text_response", side_effect=fake_generate_text_response):
            summary = generate_chat_session_summary(
                model="gpt-test",
                previous_summary="현재 목표: 네트워크 복습",
                previous_memory_facts="과목/시험 범위: 컴퓨터 네트워크",
                messages=[{
                    "id": 10,
                    "role": "user",
                    "source": "chat",
                    "content": "TCP 설명 선호",
                    "selection_image_url": "data:image/png;base64,ZmFrZQ==",
                }],
            )

        self.assertIn("현재 목표", summary["session_summary"])
        self.assertIn("TCP", summary["memory_facts"])
        self.assertIn("현재 목표", captured["instructions"])
        self.assertIn("Previous session_summary", captured["input_items"][0]["content"])
        self.assertIn("Previous memory_facts", captured["input_items"][0]["content"])
        self.assertIn("TCP 설명 선호", captured["input_items"][0]["content"])
        self.assertIn("selection image attached", captured["input_items"][0]["content"])


if __name__ == "__main__":
    unittest.main()
