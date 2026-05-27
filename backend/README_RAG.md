# B-Snap Backend RAG

이 작업은 기존 노트/페이지/채팅 API 구조를 유지하면서, 저장된 `notes.summary`, `note_pages.content`의 AI용 텍스트, AI 캔버스 정리본을 기반으로 keyword retrieval을 수행하는 RAG 어시스턴트 레이어입니다.

## Endpoints

- `POST /ai/rag/ask`
- `POST /ai/rag/summary`
- `POST /ai/rag/quiz`

현재 DB에는 별도 `subjects` 테이블이 없으므로 `subject_id`는 기존 `notes.folder_id` 필터와 같은 의미로 처리합니다. 추후 subject/lecture schema가 생기면 `load_note_documents`의 필터만 바꾸면 됩니다.

기존 `POST /chat-sessions/{session_id}/ai-messages` 흐름도 같은 retriever를 사용합니다. `use_rag: true`를 보내면 RAG 답변을 직접 생성하고, 기본 채팅 흐름에서는 검색된 context를 내부 hint로 붙여 기존 AI 채팅 품질을 보강합니다.

RAG 검색 대상:

- `notes.summary`
- `note_pages.content`에서 추출한 `pdfText`
- `note_pages.content`의 사용자 텍스트 메모
- `ai_canvas_notes.markdown`

## Run

```bash
uvicorn backend.app.main:app --reload
```

## Curl examples

```bash
curl -X POST http://localhost:8000/ai/rag/ask \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "이 노트에서 시험에 나올 만한 개념 정리해줘",
    "subject_id": 1,
    "note_ids": [1],
    "top_k": 5
  }'
```

```bash
curl -X POST http://localhost:8000/ai/rag/summary \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "note_ids": [1],
    "mode": "exam",
    "top_k": 5
  }'
```

```bash
curl -X POST http://localhost:8000/ai/rag/quiz \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "note_ids": [1],
    "count": 5,
    "top_k": 5
  }'
```

`OPENAI_API_KEY` 또는 `GEMINI_API_KEY`가 설정되어 있지 않으면 RAG endpoint는 수동 검증을 위해 mock LLM 응답을 반환합니다. 일반 AI 채팅은 선택한 `AI_PROVIDER`에 맞는 API key가 필요합니다.

## Test

```bash
python3 -m unittest backend.tests.test_rag_retriever
```

## Vector DB migration point

나중에 vector DB를 붙일 때는 `backend/app/services/rag_retriever.py`의 `retrieve_relevant_contexts` 구현을 embedding/vector search adapter로 교체하면 됩니다. 라우터와 RAG service는 `RetrievedContext` 인터페이스를 유지하도록 구성되어 있습니다.
