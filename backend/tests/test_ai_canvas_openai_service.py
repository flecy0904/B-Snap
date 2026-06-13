import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.routes.chats import select_ai_canvas_context_pages
from backend.app.services.openai_service import generate_ai_canvas_operations_from_chat


class AiCanvasOpenAIServiceTests(unittest.TestCase):
    def run_canvas_operation_request_with_mode(self, mode: str):
        response_payload = {
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": None,
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_new"},
                        "content": [{"type": "text", "text": "정리된 내용"}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "통계학", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown="- 평균",
                canvas_document_json={"type": "doc", "content": []},
                canvas_recommendation_mode=mode,
            )

        self.assertEqual(operations[0]["op"], "insert_after")
        input_items = generate_text_response.call_args.kwargs["input_items"]
        return input_items[0]["content"]

    def test_generate_ai_canvas_operations_includes_recommendation_mode_context(self):
        first_content = self.run_canvas_operation_request_with_mode("polish")

        self.assertIn("Canvas recommendation mode:", first_content)
        self.assertIn("polish", first_content)
        self.assertIn("- polish = 마무리 다듬기", first_content)

    def test_generate_ai_canvas_operations_includes_mark_uncertain_mode_context(self):
        first_content = self.run_canvas_operation_request_with_mode("mark_uncertain")

        self.assertIn("Canvas recommendation mode:", first_content)
        self.assertIn("mark_uncertain", first_content)
        self.assertIn("- mark_uncertain = 정리 보강 - 오류 의심 표시", first_content)

    def test_generate_ai_canvas_operations_allows_noop_result_for_all_recommendation_modes(self):
        response_payload = {"operations": []}
        modes = [
            "polish",
            "simplify",
            "professionalize",
            "shorten",
            "expand",
            "restructure",
            "extract_key_points",
            "mark_uncertain",
        ]

        for mode in modes:
            with self.subTest(mode=mode):
                with patch(
                    "backend.app.services.openai_service.generate_text_response",
                    return_value=json.dumps(response_payload, ensure_ascii=False),
                ) as generate_text_response:
                    operations = generate_ai_canvas_operations_from_chat(
                        model="test-model",
                        note={"title": "컴퓨터네트워크", "summary": ""},
                        pages=[],
                        messages=[],
                        user_content=mode,
                        canvas_title="Canvas Note",
                        canvas_markdown="## DNS\nDNS는 도메인 이름을 IP 주소로 변환한다.",
                        canvas_document_json={
                            "type": "doc",
                            "content": [
                                {
                                    "type": "heading",
                                    "attrs": {"blockId": "heading_1", "level": 2},
                                    "content": [{"type": "text", "text": "DNS"}],
                                },
                                {
                                    "type": "paragraph",
                                    "attrs": {"blockId": "body_1"},
                                    "content": [{"type": "text", "text": "DNS는 도메인 이름을 IP 주소로 변환한다."}],
                                },
                            ],
                        },
                        canvas_recommendation_mode=mode,
                    )

                self.assertEqual(operations, [])
                self.assertEqual(generate_text_response.call_count, 1)

    def test_generate_ai_canvas_operations_skips_restructure_when_canvas_is_already_structured(self):
        document_json = {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"blockId": "protocol_heading", "level": 2},
                    "content": [{"type": "text", "text": "프로토콜"}],
                },
                {
                    "type": "bulletList",
                    "attrs": {"blockId": "protocol_list"},
                    "content": [
                        {
                            "type": "listItem",
                            "attrs": {"blockId": "protocol_item_1"},
                            "content": [
                                {
                                    "type": "paragraph",
                                    "attrs": {"blockId": "protocol_item_1_text"},
                                    "content": [{"type": "text", "text": "데이터 통신 규칙과 절차"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "heading",
                    "attrs": {"blockId": "edge_heading", "level": 2},
                    "content": [{"type": "text", "text": "네트워크 edge"}],
                },
                {
                    "type": "bulletList",
                    "attrs": {"blockId": "edge_list"},
                    "content": [
                        {
                            "type": "listItem",
                            "attrs": {"blockId": "edge_item_1"},
                            "content": [
                                {
                                    "type": "paragraph",
                                    "attrs": {"blockId": "edge_item_1_text"},
                                    "content": [{"type": "text", "text": "사용자와 가까운 end system 영역"}],
                                }
                            ],
                        }
                    ],
                },
            ],
        }

        with patch("backend.app.services.openai_service.generate_text_response") as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 구조화",
                canvas_title="Canvas Note",
                canvas_markdown="## 프로토콜\n- 데이터 통신 규칙과 절차\n\n## 네트워크 edge\n- 사용자와 가까운 end system 영역",
                canvas_document_json=document_json,
                canvas_recommendation_mode="restructure",
            )

        self.assertEqual(operations, [])
        generate_text_response.assert_not_called()

    def test_generate_ai_canvas_operations_drops_semantically_identical_replacements(self):
        response_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "heading_1",
                    "node": {
                        "type": "heading",
                        "attrs": {"blockId": "ai_heading_1", "level": 2},
                        "content": [{"type": "text", "text": "DNS"}],
                    },
                },
                {
                    "op": "replace",
                    "targetBlockId": "body_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "ai_body_1"},
                        "content": [{"type": "text", "text": "DNS는 도메인 이름을 IP 주소로 변환한다."}],
                    },
                },
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown="## DNS\nDNS는 도메인 이름을 IP 주소로 변환한다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "heading",
                            "attrs": {"blockId": "heading_1", "level": 2},
                            "content": [{"type": "text", "text": "DNS"}],
                        },
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "body_1"},
                            "content": [{"type": "text", "text": "DNS는 도메인 이름을 IP 주소로 변환한다."}],
                        },
                    ],
                },
                canvas_recommendation_mode="polish",
            )

        self.assertEqual(operations, [])

    def test_generate_ai_canvas_operations_compacts_selection_recommendation_context(self):
        response_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "selected_block",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "selected_block"},
                        "content": [{"type": "text", "text": "혼잡 제어 핵심 정리"}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[
                    {"role": "user", "content": "이전 채팅 히스토리는 추천 버튼에는 필요하지 않다."}
                ],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown=(
                    "최신모바일 - Edge Computing\n"
                    "Edge computing은 사용자 가까운 곳에서 일부 계산을 처리한다.\n\n"
                    "컴퓨터 네트워크 - 혼잡 제어\n"
                    "혼잡 제어는 라우터 큐가 가득 차지 않도록 전송량을 조절한다."
                ),
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "unselected_block"},
                            "content": [{"type": "text", "text": "Edge computing은 선택하지 않은 내용이다."}],
                        },
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "selected_block"},
                            "content": [{"type": "text", "text": "혼잡 제어는 선택한 내용이다."}],
                        },
                    ],
                },
                canvas_block_context={
                    "scope": "selection",
                    "selectedBlockIds": ["selected_block"],
                    "markdown": "컴퓨터 네트워크 - 혼잡 제어\n혼잡 제어는 선택한 내용이다.",
                },
                canvas_recommendation_mode="extract_key_points",
            )

        self.assertEqual(operations[0]["targetBlockId"], "selected_block")
        input_items = generate_text_response.call_args.kwargs["input_items"]
        combined_prompt = "\n\n".join(
            item["content"] for item in input_items if isinstance(item.get("content"), str)
        )
        self.assertIn("혼잡 제어는 선택한 내용이다.", combined_prompt)
        self.assertNotIn("Edge computing은 선택하지 않은 내용이다.", combined_prompt)
        self.assertNotIn("최신모바일 - Edge Computing", combined_prompt)
        self.assertNotIn("이전 채팅 히스토리는 추천 버튼에는 필요하지 않다.", combined_prompt)

    def test_generate_ai_canvas_operations_uses_compact_document_map_for_recommendations(self):
        response_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "body_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "body_1"},
                        "content": [{"type": "text", "text": "Transport layer는 프로세스 간 통신을 담당한다."}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ) as generate_text_response:
            generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown="## Transport Layer\nTransport layer는 프로세스 간 통신을 담당한다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "heading",
                            "attrs": {"blockId": "heading_1", "level": 2, "data-extra": "unused"},
                            "content": [{"type": "text", "text": "Transport Layer"}],
                        },
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "body_1"},
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Transport layer는 프로세스 간 통신을 담당한다.",
                                    "marks": [{"type": "bold"}],
                                }
                            ],
                        },
                    ],
                },
                canvas_recommendation_mode="polish",
            )

        prompt = generate_text_response.call_args.kwargs["input_items"][0]["content"]
        self.assertIn("Current Canvas compact block map JSON:", prompt)
        self.assertIn('"blockId": "heading_1"', prompt)
        self.assertIn('"level": 2', prompt)
        self.assertIn('"text": "Transport Layer"', prompt)
        self.assertIn('"section": "Transport Layer"', prompt)
        self.assertIn('"blockId": "body_1"', prompt)
        self.assertIn('"text": "Transport layer는 프로세스 간 통신을 담당한다."', prompt)
        self.assertNotIn('"data-extra"', prompt)
        self.assertNotIn('"marks": [{"type": "bold"}]', prompt)
        self.assertNotIn('"content": [{"type": "text"', prompt)

    def test_generate_ai_canvas_operations_preserves_ordered_list_item_shape(self):
        response_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "dns_function_2",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "dns_function_2"},
                        "content": [{"type": "text", "text": "host aliasing: 하나의 실제 host에 여러 별명 사용"}],
                    },
                },
                {
                    "op": "insert_after",
                    "targetBlockId": "dns_function_3",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "dns_function_4"},
                        "content": [{"type": "text", "text": "load distribution: 여러 IP로 트래픽 분산"}],
                    },
                },
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown=(
                    "4. DNS의 주요 기능\n"
                    "1. hostname -> IP address 변환\n"
                    "2. host aliasing\n"
                    "3. mail server aliasing"
                ),
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "heading",
                            "attrs": {"blockId": "dns_heading", "level": 2},
                            "content": [{"type": "text", "text": "4. DNS의 주요 기능"}],
                        },
                        {
                            "type": "orderedList",
                            "attrs": {"blockId": "dns_functions", "start": 1},
                            "content": [
                                {
                                    "type": "listItem",
                                    "attrs": {"blockId": "dns_function_1"},
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hostname -> IP address 변환"}]}],
                                },
                                {
                                    "type": "listItem",
                                    "attrs": {"blockId": "dns_function_2"},
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "host aliasing"}]}],
                                },
                                {
                                    "type": "listItem",
                                    "attrs": {"blockId": "dns_function_3"},
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "mail server aliasing"}]}],
                                },
                            ],
                        },
                    ],
                },
                canvas_recommendation_mode="polish",
            )

        self.assertEqual(operations[0]["node"]["type"], "listItem")
        self.assertEqual(operations[0]["node"]["attrs"]["blockId"], "dns_function_2")
        self.assertEqual(operations[0]["node"]["content"][0]["type"], "paragraph")
        self.assertNotEqual(operations[0]["node"]["content"][0]["attrs"]["blockId"], "dns_function_2")
        self.assertEqual(operations[1]["node"]["type"], "listItem")
        self.assertEqual(operations[1]["node"]["content"][0]["content"][0]["text"], "load distribution: 여러 IP로 트래픽 분산")

    def test_generate_ai_canvas_operations_preserves_paragraph_inside_list_item_shape(self):
        response_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "dns_function_2_text",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "ai_wrong_list"},
                        "content": [
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "ai_wrong_item_1"},
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "attrs": {"blockId": "ai_wrong_item_1_text"},
                                        "content": [{"type": "text", "text": "host aliasing"}],
                                    }
                                ],
                            },
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "ai_wrong_item_2"},
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "attrs": {"blockId": "ai_wrong_item_2_text"},
                                        "content": [{"type": "text", "text": "하나의 실제 host에 여러 별명 사용"}],
                                    }
                                ],
                            },
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown="1. hostname -> IP address 변환\n2. host aliasing",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "orderedList",
                            "attrs": {"blockId": "dns_functions", "start": 1},
                            "content": [
                                {
                                    "type": "listItem",
                                    "attrs": {"blockId": "dns_function_1"},
                                    "content": [
                                        {
                                            "type": "paragraph",
                                            "attrs": {"blockId": "dns_function_1_text"},
                                            "content": [{"type": "text", "text": "hostname -> IP address 변환"}],
                                        }
                                    ],
                                },
                                {
                                    "type": "listItem",
                                    "attrs": {"blockId": "dns_function_2"},
                                    "content": [
                                        {
                                            "type": "paragraph",
                                            "attrs": {"blockId": "dns_function_2_text"},
                                            "content": [{"type": "text", "text": "host aliasing"}],
                                        }
                                    ],
                                },
                            ],
                        }
                    ],
                },
                canvas_recommendation_mode="polish",
            )

        self.assertEqual(operations[0]["node"]["type"], "paragraph")
        self.assertEqual(operations[0]["node"]["attrs"]["blockId"], "dns_function_2_text")
        self.assertIn("host aliasing", operations[0]["node"]["content"][0]["text"])
        self.assertNotEqual(operations[0]["node"]["type"], "bulletList")

    def test_generate_ai_canvas_operations_retries_restructure_that_collapses_sections(self):
        collapsed_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "protocol_body",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "protocol_body"},
                        "content": [
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "protocol_item_1"},
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "attrs": {"blockId": "protocol_item_1_text"},
                                        "content": [{"type": "text", "text": "프로토콜: 데이터 통신 규칙과 절차"}],
                                    }
                                ],
                            },
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "protocol_item_2"},
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "attrs": {"blockId": "protocol_item_2_text"},
                                        "content": [{"type": "text", "text": "네트워크 edge: 사용자와 가까운 end system 위치"}],
                                    }
                                ],
                            },
                        ],
                    },
                }
            ]
        }
        section_preserving_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "protocol_body",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "protocol_body"},
                        "content": [
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "protocol_item_1"},
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "attrs": {"blockId": "protocol_item_1_text"},
                                        "content": [{"type": "text", "text": "데이터 통신의 규칙과 절차"}],
                                    }
                                ],
                            }
                        ],
                    },
                },
                {
                    "op": "replace",
                    "targetBlockId": "edge_body",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "edge_body"},
                        "content": [
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "edge_item_1"},
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "attrs": {"blockId": "edge_item_1_text"},
                                        "content": [{"type": "text", "text": "사용자와 가까운 end system 영역"}],
                                    }
                                ],
                            }
                        ],
                    },
                },
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(collapsed_payload, ensure_ascii=False),
                json.dumps(section_preserving_payload, ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 구조화",
                canvas_title="Canvas Note",
                canvas_markdown=(
                    "## 프로토콜\n"
                    "프로토콜은 데이터 통신의 규칙과 절차를 의미한다. 메시지 형식, 순서, 응답 시기, 오류 처리 방법이 포함된다.\n\n"
                    "## 네트워크 edge\n"
                    "Network edge는 사용자와 가까운 부분이다. client, server, peer 같은 end system이 있으며 client-server와 P2P 구조가 있다."
                ),
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "heading",
                            "attrs": {"blockId": "protocol_heading", "level": 2},
                            "content": [{"type": "text", "text": "프로토콜"}],
                        },
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "protocol_body"},
                            "content": [{"type": "text", "text": "프로토콜은 데이터 통신의 규칙과 절차를 의미한다."}],
                        },
                        {
                            "type": "heading",
                            "attrs": {"blockId": "edge_heading", "level": 2},
                            "content": [{"type": "text", "text": "네트워크 edge"}],
                        },
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "edge_body"},
                            "content": [{"type": "text", "text": "Network edge는 사용자와 가까운 부분이다."}],
                        },
                    ],
                },
                canvas_recommendation_mode="restructure",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        self.assertEqual([operation["targetBlockId"] for operation in operations], ["protocol_body", "edge_body"])
        self.assertTrue(all(operation["node"]["type"] == "bulletList" for operation in operations))
        retry_prompt = generate_text_response.call_args.kwargs["input_items"][-1]["content"]
        self.assertIn("restructure", retry_prompt)
        self.assertIn("section", retry_prompt)

    def test_select_ai_canvas_context_pages_uses_fast_recommendation_policy(self):
        pages = [
            {"page_number": 1, "content": {"text": "p1"}},
            {"page_number": 2, "content": {"text": "p2"}},
            {"page_number": 3, "content": {"text": "p3"}},
        ]
        document_json = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "Canvas 내용"}]}
            ],
        }

        self.assertEqual(
            select_ai_canvas_context_pages(
                pages,
                2,
                canvas_markdown="Canvas 내용",
                canvas_document_json=document_json,
                canvas_recommendation_mode="polish",
            ),
            [],
        )
        self.assertEqual(
            [page["page_number"] for page in select_ai_canvas_context_pages(
                pages,
                2,
                canvas_markdown="Canvas 내용",
                canvas_document_json=document_json,
                canvas_recommendation_mode="expand",
            )],
            [2],
        )
        self.assertEqual(
            [page["page_number"] for page in select_ai_canvas_context_pages(
                pages,
                2,
                canvas_markdown="",
                canvas_document_json={"type": "doc", "content": []},
                canvas_recommendation_mode="polish",
            )],
            [2],
        )

    def test_generate_ai_canvas_operations_preserves_uncertain_mark(self):
        response_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "text",
                                "text": "확인 필요: UDP는 항상 TCP보다 빠르다.",
                                "marks": [{"type": "aiCanvasUncertain"}],
                            }
                        ],
                    },
                },
                {"op": "delete", "targetBlockId": "block_2"},
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(response_payload, ensure_ascii=False),
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown="UDP는 항상 TCP보다 빠르다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "attrs": {"blockId": "block_1"},
                            "content": [{"type": "text", "text": "UDP는 항상 TCP보다 빠르다."}],
                        }
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        result_text = json.dumps(operations, ensure_ascii=False)
        self.assertNotIn('"op": "delete"', result_text)
        self.assertIn("확인 필요", result_text)
        self.assertIn('"type": "aiCanvasUncertain"', result_text)

    def test_generate_ai_canvas_operations_retries_invalid_json_once(self):
        response_payload = {
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": None,
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_retry"},
                        "content": [{"type": "text", "text": "재시도 성공"}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=["not valid json", json.dumps(response_payload, ensure_ascii=False)],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown="Network core",
                canvas_document_json={"type": "doc", "content": []},
                canvas_recommendation_mode="extract_key_points",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        retry_input_items = generate_text_response.call_args.kwargs["input_items"]
        self.assertIn("previous Canvas edit response was not valid", retry_input_items[-1]["content"])
        self.assertEqual(operations[0]["node"]["content"][0]["text"], "재시도 성공")

    def test_generate_ai_canvas_operations_retries_overexpanded_expand_result(self):
        source = (
            "Page replacement는 page fault가 발생했을 때 메모리에 빈 frame이 없으면 어떤 page를 내보낼지 정하는 방법이다. "
            "FIFO는 가장 오래된 page를 제거하고, LRU는 가장 오랫동안 사용되지 않은 page를 제거한다. "
            "좋은 replacement algorithm은 page fault를 줄여야 하지만 실제 구현 비용도 고려해야 한다."
        )
        first_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [{"type": "text", "text": "너무 긴 확장 " * 80}],
                    },
                }
            ]
        }
        retry_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [{"type": "text", "text": "Page replacement는 교체 대상 선택 기준과 구현 비용을 함께 봐야 한다."}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(first_payload, ensure_ascii=False),
                json.dumps(retry_payload, ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "운영체제", "summary": ""},
                pages=[],
                messages=[],
                user_content="길이 조절 - 길게",
                canvas_title="Canvas Note",
                canvas_markdown=source,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": source}]}
                    ],
                },
                canvas_recommendation_mode="expand",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        retry_input_items = generate_text_response.call_args.kwargs["input_items"]
        self.assertIn("expand added too much content", retry_input_items[-1]["content"])
        self.assertEqual(operations[0]["node"]["content"][0]["text"], "Page replacement는 교체 대상 선택 기준과 구현 비용을 함께 봐야 한다.")

    def test_generate_ai_canvas_operations_retries_key_points_quality_issue(self):
        noisy_items = [
            {
                "type": "listItem",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"핵심 {index}"}]}],
            }
            for index in range(9)
        ]
        first_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "block_1"},
                        "content": noisy_items,
                    },
                }
            ]
        }
        retry_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "listItem",
                                "content": [{"type": "paragraph", "content": [{"type": "text", "text": "핵심만 정리"}]}],
                            }
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(first_payload, ensure_ascii=False),
                json.dumps(retry_payload, ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown="Network core " * 30,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "heading", "attrs": {"blockId": "heading_1"}, "content": [{"type": "text", "text": "Network Core"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "본문 1"}]},
                    ],
                },
                canvas_recommendation_mode="extract_key_points",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        retry_input_items = generate_text_response.call_args.kwargs["input_items"]
        self.assertIn("failed the Canvas recommendation quality check", retry_input_items[-1]["content"])
        self.assertEqual(operations[0]["node"]["content"][0]["content"][0]["content"][0]["text"], "핵심만 정리")

    def test_generate_ai_canvas_operations_retries_mark_uncertain_without_marker(self):
        first_payload = {
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_2"},
                        "content": [{"type": "text", "text": "이 주장은 다시 검토해야 한다."}],
                    },
                }
            ]
        }
        retry_payload = {
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_2"},
                        "content": [{"type": "text", "text": "확인 필요: 이 주장은 근거 확인이 필요하다."}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(first_payload, ensure_ascii=False),
                json.dumps(retry_payload, ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown="UDP는 항상 TCP보다 빠르다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "UDP는 항상 TCP보다 빠르다."}]}
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        self.assertIn("확인 필요", operations[0]["node"]["content"][0]["text"])

    def test_generate_ai_canvas_operations_normalizes_mark_uncertain_marker_after_retries(self):
        payload_without_marker = {
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_2"},
                        "content": [{"type": "text", "text": "UDP는 항상 TCP보다 빠르다는 주장"}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(payload_without_marker, ensure_ascii=False)] * 3,
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown="UDP는 항상 TCP보다 빠르다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "UDP는 항상 TCP보다 빠르다."}]}
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        text_node = operations[0]["node"]["content"][0]
        self.assertEqual(generate_text_response.call_count, 3)
        self.assertTrue(text_node["text"].startswith("확인 필요:"))
        self.assertEqual(text_node["marks"], [{"type": "aiCanvasUncertain"}])

    def test_generate_ai_canvas_operations_normalizes_marked_text_without_visible_label(self):
        payload_with_uncertain_mark_only = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {"type": "text", "text": "5G를 사용하면 지연 시간이 절대 발생하지 않는다."},
                            {
                                "type": "text",
                                "text": "5G도 환경에 따라 지연 시간이 발생할 수 있다.",
                                "marks": [{"type": "aiCanvasUncertain"}],
                            },
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(payload_with_uncertain_mark_only, ensure_ascii=False)] * 3,
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "최신모바일", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown="5G를 사용하면 지연 시간이 절대 발생하지 않는다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "5G를 사용하면 지연 시간이 절대 발생하지 않는다."}]}
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        content = operations[0]["node"]["content"]
        self.assertEqual(generate_text_response.call_count, 3)
        self.assertEqual(content[0]["text"], "5G를 사용하면 지연 시간이 절대 발생하지 않는다.")
        self.assertTrue(content[1]["text"].startswith("확인 필요:"))
        self.assertEqual(content[1]["marks"], [{"type": "aiCanvasUncertain"}])

    def test_generate_ai_canvas_operations_normalizes_mark_uncertain_when_quality_retry_fails(self):
        payload_without_marker = {
            "operations": [
                {
                    "op": "insert_after",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_2"},
                        "content": [{"type": "text", "text": "DNS가 모든 경우에 UDP만 사용한다는 주장"}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(payload_without_marker, ensure_ascii=False),
                HTTPException(status_code=502, detail="retry failed"),
            ],
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown="DNS는 모든 경우에 UDP만 사용한다.",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "DNS는 모든 경우에 UDP만 사용한다."}]}
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        self.assertTrue(operations[0]["node"]["content"][0]["text"].startswith("확인 필요:"))

    def test_generate_ai_canvas_operations_preserves_uncertain_source_when_replace_drops_claims(self):
        payload_that_drops_claims = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {"type": "text", "text": "5G를 사용하면 지연 시간이 절대 발생하지 않는다."},
                            {
                                "type": "text",
                                "text": " 확인 필요: 5G도 지연이 발생할 수 있다.",
                                "marks": [{"type": "aiCanvasUncertain"}],
                            },
                        ],
                    },
                }
            ]
        }

        source = (
            "5G를 사용하면 지연 시간이 절대 발생하지 않는다. "
            "GPS는 실내에서도 항상 1cm 단위로 정확하다. "
            "Edge computing은 어떤 상황에서도 cloud보다 반드시 빠르다."
        )
        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(payload_that_drops_claims, ensure_ascii=False)] * 3,
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "최신모바일", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown=source,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": source}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_2"}, "content": [{"type": "text", "text": "통계 해석은 가정도 같이 봐야 한다."}]},
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        result_text = json.dumps(operations, ensure_ascii=False)
        self.assertEqual(generate_text_response.call_count, 3)
        self.assertEqual(operations[0]["op"], "insert_after")
        self.assertNotIn('"op": "delete"', result_text)
        self.assertIn("GPS는 실내에서도 항상 1cm 단위로 정확하다.", result_text)
        self.assertIn("Edge computing은 어떤 상황에서도 cloud보다 반드시 빠르다.", result_text)
        self.assertNotIn("5G도 지연이 발생할 수 있다.", result_text)
        self.assertIn("확인 필요", result_text)

    def test_generate_ai_canvas_operations_drops_corrective_insert_when_preserving_uncertain_source(self):
        source = (
            "Page fault는 항상 시스템 오류를 의미한다. "
            "가상 메모리를 사용하면 물리 메모리는 절대 부족하지 않다."
        )
        payload_with_correction = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "text",
                                "text": "확인 필요: Page fault는 항상 시스템 오류를 의미하지 않는다. 가상 메모리를 사용해도 물리 메모리가 부족할 수 있다.",
                                "marks": [{"type": "aiCanvasUncertain"}],
                            }
                        ],
                    },
                },
                {
                    "op": "insert_after",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_2"},
                        "content": [{"type": "text", "text": "확인 필요: 교정된 설명을 추가한다."}],
                    },
                },
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(payload_with_correction, ensure_ascii=False)] * 3,
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "운영체제", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 오류 의심 표시",
                canvas_title="Canvas Note",
                canvas_markdown=source,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": source}]}
                    ],
                },
                canvas_recommendation_mode="mark_uncertain",
            )

        result_text = json.dumps(operations, ensure_ascii=False)
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0]["op"], "insert_after")
        self.assertIn("Page fault는 항상 시스템 오류를 의미한다.", result_text)
        self.assertIn("물리 메모리는 절대 부족하지 않다.", result_text)
        self.assertNotIn("교정된 설명", result_text)
        self.assertNotIn('"op": "replace"', result_text)

    def test_generate_ai_canvas_operations_allows_second_quality_retry(self):
        def payload_with_items(count: int, text_prefix: str):
            return {
                "operations": [
                    {
                        "op": "replace",
                        "targetBlockId": "block_1",
                        "node": {
                            "type": "bulletList",
                            "attrs": {"blockId": "block_1"},
                            "content": [
                                {
                                    "type": "listItem",
                                    "content": [
                                        {
                                            "type": "paragraph",
                                            "content": [{"type": "text", "text": f"{text_prefix} {index}"}],
                                        }
                                    ],
                                }
                                for index in range(count)
                            ],
                        },
                    }
                ]
            }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(payload_with_items(9, "첫 응답"), ensure_ascii=False),
                json.dumps(payload_with_items(8, "첫 재시도"), ensure_ascii=False),
                json.dumps(payload_with_items(4, "둘째 재시도"), ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown="Network core " * 30,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "heading", "attrs": {"blockId": "heading_1"}, "content": [{"type": "text", "text": "Network Core"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "본문 1"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_2"}, "content": [{"type": "text", "text": "본문 2"}]},
                    ],
                },
                canvas_recommendation_mode="extract_key_points",
            )

        self.assertEqual(generate_text_response.call_count, 3)
        self.assertEqual(len(operations[0]["node"]["content"]), 4)

    def test_generate_ai_canvas_operations_normalizes_key_points_after_failed_quality_retries(self):
        def split_payload():
            return {
                "operations": [
                    {
                        "op": "replace",
                        "targetBlockId": "block_1",
                        "node": {
                            "type": "bulletList",
                            "attrs": {"blockId": "block_1"},
                            "content": [
                                {
                                    "type": "listItem",
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"A{index}"}]}],
                                }
                                for index in range(4)
                            ],
                        },
                    },
                    {
                        "op": "replace",
                        "targetBlockId": "block_2",
                        "node": {
                            "type": "bulletList",
                            "attrs": {"blockId": "block_2"},
                            "content": [
                                {
                                    "type": "listItem",
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"B{index}"}]}],
                                }
                                for index in range(4)
                            ],
                        },
                    },
                ]
            }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(split_payload(), ensure_ascii=False)] * 3,
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown="Network core " * 30,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "heading", "attrs": {"blockId": "heading_1"}, "content": [{"type": "text", "text": "Network Core"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "본문 1"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_2"}, "content": [{"type": "text", "text": "본문 2"}]},
                    ],
                },
                canvas_recommendation_mode="extract_key_points",
            )

        self.assertEqual(operations[0]["op"], "replace")
        self.assertEqual(operations[0]["targetBlockId"], "block_1")
        self.assertEqual(operations[0]["node"]["type"], "bulletList")
        self.assertLessEqual(len(operations[0]["node"]["content"]), 6)
        self.assertEqual(operations[1], {"op": "delete", "targetBlockId": "block_2"})

    def test_generate_ai_canvas_operations_normalizes_key_points_inside_selection_only(self):
        def split_selected_payload():
            return {
                "operations": [
                    {
                        "op": "replace",
                        "targetBlockId": "congestion_1",
                        "node": {
                            "type": "bulletList",
                            "attrs": {"blockId": "congestion_1"},
                            "content": [
                                {
                                    "type": "listItem",
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"A{index}"}]}],
                                }
                                for index in range(4)
                            ],
                        },
                    },
                    {
                        "op": "replace",
                        "targetBlockId": "congestion_2",
                        "node": {
                            "type": "bulletList",
                            "attrs": {"blockId": "congestion_2"},
                            "content": [
                                {
                                    "type": "listItem",
                                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"B{index}"}]}],
                                }
                                for index in range(4)
                            ],
                        },
                    },
                ]
            }

        document_json = {
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"blockId": "edge_heading"}, "content": [{"type": "text", "text": "Edge Computing"}]},
                {"type": "paragraph", "attrs": {"blockId": "edge_1"}, "content": [{"type": "text", "text": "Edge 본문 1"}]},
                {"type": "paragraph", "attrs": {"blockId": "edge_2"}, "content": [{"type": "text", "text": "Edge 본문 2"}]},
                {"type": "heading", "attrs": {"blockId": "congestion_heading"}, "content": [{"type": "text", "text": "Congestion Control"}]},
                {"type": "paragraph", "attrs": {"blockId": "congestion_1"}, "content": [{"type": "text", "text": "혼잡 제어 본문 1"}]},
                {"type": "paragraph", "attrs": {"blockId": "congestion_2"}, "content": [{"type": "text", "text": "혼잡 제어 본문 2"}]},
                {"type": "paragraph", "attrs": {"blockId": "congestion_3"}, "content": [{"type": "text", "text": "혼잡 제어 본문 3"}]},
            ],
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(split_selected_payload(), ensure_ascii=False)] * 3,
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown="Edge Computing\n\nEdge 본문 1\n\nEdge 본문 2\n\nCongestion Control\n\n혼잡 제어 본문 1\n\n혼잡 제어 본문 2\n\n혼잡 제어 본문 3",
                canvas_document_json=document_json,
                canvas_block_context={
                    "scope": "selection",
                    "selectedBlockIds": ["congestion_heading", "congestion_1", "congestion_2", "congestion_3"],
                    "text": "Congestion Control\n혼잡 제어 본문 1\n혼잡 제어 본문 2\n혼잡 제어 본문 3",
                    "markdown": "Congestion Control\n혼잡 제어 본문 1\n혼잡 제어 본문 2\n혼잡 제어 본문 3",
                },
                canvas_recommendation_mode="extract_key_points",
            )

        targets = [operation.get("targetBlockId") for operation in operations]
        self.assertEqual(operations[0]["op"], "replace")
        self.assertEqual(operations[0]["targetBlockId"], "congestion_1")
        self.assertIn("congestion_2", targets)
        self.assertIn("congestion_3", targets)
        self.assertNotIn("edge_1", targets)
        self.assertNotIn("edge_2", targets)
        self.assertTrue(all(target in {"congestion_1", "congestion_2", "congestion_3"} for target in targets))

    def test_generate_ai_canvas_operations_retries_selection_scope_leak(self):
        leaked_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "edge_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "edge_1"},
                        "content": [{"type": "text", "text": "잘못 수정된 Edge"}],
                    },
                }
            ]
        }
        scoped_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "congestion_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "congestion_1"},
                        "content": [{"type": "text", "text": "선택 범위만 수정"}],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(leaked_payload, ensure_ascii=False),
                json.dumps(scoped_payload, ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown="Edge\n\nCongestion",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "edge_1"}, "content": [{"type": "text", "text": "Edge"}]},
                        {"type": "paragraph", "attrs": {"blockId": "congestion_1"}, "content": [{"type": "text", "text": "Congestion"}]},
                    ],
                },
                canvas_block_context={
                    "scope": "selection",
                    "selectedBlockIds": ["congestion_1"],
                    "text": "Congestion",
                    "markdown": "Congestion",
                },
                canvas_recommendation_mode="polish",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        retry_input_items = generate_text_response.call_args.kwargs["input_items"]
        self.assertIn("selection scope operation targeted an unselected block", retry_input_items[-1]["content"])
        self.assertEqual(operations[0]["targetBlockId"], "congestion_1")

    def test_generate_ai_canvas_operations_normalizes_nested_key_points_to_flat_list(self):
        nested_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "listItem",
                                "content": [
                                    {"type": "paragraph", "content": [{"type": "text", "text": "주요 기술"}]},
                                    {
                                        "type": "bulletList",
                                        "content": [
                                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "GPS"}]}]},
                                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Wi-Fi"}]}]},
                                        ],
                                    },
                                ],
                            },
                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "GPS"}]}]},
                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Wi-Fi"}]}]},
                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Bluetooth"}]}]},
                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Cellular"}]}]},
                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Dead reckoning"}]}]},
                            {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Sensor fusion"}]}]},
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[json.dumps(nested_payload, ensure_ascii=False)] * 3,
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "최신모바일", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 핵심만",
                canvas_title="Canvas Note",
                canvas_markdown="모바일 위치 추정 " * 40,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "heading", "attrs": {"blockId": "heading_1"}, "content": [{"type": "text", "text": "모바일 위치 추정"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "본문 1"}]},
                        {"type": "paragraph", "attrs": {"blockId": "block_2"}, "content": [{"type": "text", "text": "본문 2"}]},
                    ],
                },
                canvas_recommendation_mode="extract_key_points",
            )

        node = operations[0]["node"]
        result_text = json.dumps(node, ensure_ascii=False)
        self.assertEqual(node["type"], "bulletList")
        self.assertLessEqual(len(node["content"]), 6)
        self.assertEqual(result_text.count('"type": "bulletList"'), 1)
        self.assertEqual(result_text.count("GPS"), 1)

    def test_generate_ai_canvas_operations_retries_shorten_when_not_reduced_enough(self):
        first_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "paragraph",
                        "attrs": {"blockId": "block_1"},
                        "content": [{"type": "text", "text": "긴 문장 " * 80}],
                    },
                }
            ]
        }
        retry_payload = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "listItem",
                                "content": [{"type": "paragraph", "content": [{"type": "text", "text": "짧은 핵심"}]}],
                            }
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            side_effect=[
                json.dumps(first_payload, ensure_ascii=False),
                json.dumps(retry_payload, ensure_ascii=False),
            ],
        ) as generate_text_response:
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "운영체제", "summary": ""},
                pages=[],
                messages=[],
                user_content="길이 조절 - 짧게",
                canvas_title="Canvas Note",
                canvas_markdown="긴 원문 " * 100,
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "본문"}]}
                    ],
                },
                canvas_recommendation_mode="shorten",
            )

        self.assertEqual(generate_text_response.call_count, 2)
        self.assertEqual(operations[0]["node"]["type"], "bulletList")

    def test_generate_ai_canvas_operations_prunes_empty_list_items(self):
        payload_with_blank_bullets = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "empty_item"},
                                "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}],
                            },
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "valid_item"},
                                "content": [{"type": "paragraph", "content": [{"type": "text", "text": "HTTP는 요청/응답 구조를 사용한다."}]}],
                            },
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(payload_with_blank_bullets, ensure_ascii=False),
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="마무리 다듬기",
                canvas_title="Canvas Note",
                canvas_markdown="- HTTP",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "HTTP"}]}
                    ],
                },
                canvas_recommendation_mode="polish",
            )

        list_items = operations[0]["node"]["content"]
        result_text = json.dumps(operations, ensure_ascii=False)
        self.assertEqual(len(list_items), 1)
        self.assertIn("HTTP는 요청/응답 구조를 사용한다.", result_text)
        self.assertNotIn("empty_item", result_text)

    def test_generate_ai_canvas_operations_flattens_empty_parent_list_item(self):
        payload_with_empty_parent = {
            "operations": [
                {
                    "op": "replace",
                    "targetBlockId": "block_1",
                    "node": {
                        "type": "bulletList",
                        "attrs": {"blockId": "block_1"},
                        "content": [
                            {
                                "type": "listItem",
                                "attrs": {"blockId": "empty_parent"},
                                "content": [
                                    {"type": "paragraph", "content": [{"type": "text", "text": ""}]},
                                    {
                                        "type": "bulletList",
                                        "content": [
                                            {
                                                "type": "listItem",
                                                "attrs": {"blockId": "nested_1"},
                                                "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Non-persistent HTTP는 연결을 반복 생성한다."}]}],
                                            },
                                            {
                                                "type": "listItem",
                                                "attrs": {"blockId": "nested_2"},
                                                "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Persistent HTTP는 같은 연결로 여러 객체를 받을 수 있다."}]}],
                                            },
                                        ],
                                    },
                                ],
                            }
                        ],
                    },
                }
            ]
        }

        with patch(
            "backend.app.services.openai_service.generate_text_response",
            return_value=json.dumps(payload_with_empty_parent, ensure_ascii=False),
        ):
            operations = generate_ai_canvas_operations_from_chat(
                model="test-model",
                note={"title": "컴퓨터네트워크", "summary": ""},
                pages=[],
                messages=[],
                user_content="정리 보강 - 구조화",
                canvas_title="Canvas Note",
                canvas_markdown="- Non-persistent HTTP\n- Persistent HTTP",
                canvas_document_json={
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "attrs": {"blockId": "block_1"}, "content": [{"type": "text", "text": "HTTP"}]}
                    ],
                },
                canvas_recommendation_mode="restructure",
            )

        list_items = operations[0]["node"]["content"]
        result_text = json.dumps(operations, ensure_ascii=False)
        self.assertEqual(len(list_items), 2)
        self.assertNotIn("empty_parent", result_text)
        self.assertIn("Non-persistent HTTP는 연결을 반복 생성한다.", result_text)
        self.assertIn("Persistent HTTP는 같은 연결로 여러 객체를 받을 수 있다.", result_text)


if __name__ == "__main__":
    unittest.main()
