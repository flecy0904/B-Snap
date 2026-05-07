# B-Snap Backend RAG

이 작업은 기존 노트/페이지/채팅 API 구조를 유지하면서, 저장된 `notes.summary`와 `note_pages.content`를 기반으로 keyword retrieval을 수행하는 RAG 어시스턴트 레이어를 추가합니다.

## Endpoints

- `POST /ai/rag/ask`
- `POST /ai/rag/summary`
- `POST /ai/rag/quiz`

현재 DB에는 별도 `subjects` 테이블이 없으므로 `subject_id`는 기존 `notes.folder_id` 필터와 같은 의미로 처리합니다. 추후 subject/lecture schema가 생기면 `load_note_documents`의 필터만 바꾸면 됩니다.

## Run

```bash
uvicorn backend.app.main:app --reload
```

## Curl examples

```bash
curl -X POST http://localhost:8000/ai/rag/ask \
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
  -H "Content-Type: application/json" \
  -d '{
    "note_ids": [1],
    "mode": "exam",
    "top_k": 5
  }'
```

```bash
curl -X POST http://localhost:8000/ai/rag/quiz \
  -H "Content-Type: application/json" \
  -d '{
    "note_ids": [1],
    "count": 5,
    "top_k": 5
  }'
```

`OPENAI_API_KEY`가 설정되어 있지 않으면 RAG endpoint는 수동 검증을 위해 mock LLM 응답을 반환합니다. 기존 `/chat-sessions/{session_id}/ai-messages` API는 기존처럼 API key가 필요합니다.

## Test

```bash
python3 -m unittest backend.tests.test_rag_retriever
```

## Vector DB migration point

나중에 vector DB를 붙일 때는 `backend/app/services/rag_retriever.py`의 `retrieve_relevant_contexts` 구현을 embedding/vector search adapter로 교체하면 됩니다. 라우터와 RAG service는 `RetrievedContext` 인터페이스를 유지하도록 구성되어 있습니다.
