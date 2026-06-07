# B-Snap Backend RAG

이 작업은 기존 노트/페이지/채팅 API 구조를 유지하면서, 저장된 `notes.summary`, `note_pages.content`의 AI용 텍스트, AI 캔버스 정리본을 기반으로 답변하는 RAG 어시스턴트 레이어입니다.

현재 retriever는 pgvector 색인이 있으면 vector retrieval과 keyword retrieval을 함께 사용하는 hybrid RAG로 동작합니다. pgvector 색인, embedding API key, `document_chunks` 테이블이 준비되지 않은 로컬 환경에서는 기존 keyword retrieval로 자동 fallback합니다. keyword retrieval은 질문과 문서 chunk의 키워드 겹침을 계산하되, 한국어 조사(`스택은`, `큐를` 등)를 단순 정규화하고 `스택`/`stack`, `큐`/`queue`, `후입선출`/`LIFO` 같은 자주 쓰는 학습 용어 alias를 함께 검색합니다.

즉 GitHub에는 API key를 올리지 않고 코드만 올려두면 됩니다. 시연자가 `backend/.env`에 본인의 `OPENAI_API_KEY`를 넣고 vector 색인 스크립트를 실행하면 `document_chunks`에 embedding이 저장되고 hybrid RAG가 활성화됩니다.

## Endpoints

- `POST /ai/rag/ask`
- `POST /ai/rag/summary`
- `POST /ai/rag/quiz`

현재 DB에는 별도 `subjects` 테이블이 없으므로 `subject_id`는 기존 `notes.folder_id` 필터와 같은 의미로 처리합니다. 추후 subject/lecture schema가 생기면 `load_note_documents`와 `document_chunks` 필터만 바꾸면 됩니다.

기존 `POST /chat-sessions/{session_id}/ai-messages` 흐름도 같은 retriever를 사용합니다. `use_rag: true`를 보내면 RAG 답변을 직접 생성하고, 기본 채팅 흐름에서는 검색된 context를 내부 hint로 붙여 기존 AI 채팅 품질을 보강합니다.

RAG 검색 대상:

- `notes.summary`
- `note_pages.content`에서 추출한 `pdfText`
- `note_pages.content`의 사용자 텍스트 메모
- `ai_canvas_notes.markdown`

RAG 응답은 `answer`, `sections`, `sources`를 반환합니다. `sources`에는 `source_type`, `source_id`, `title`, `content`, `score`가 포함되어 프론트에서 참고 자료 표시나 디버깅에 사용할 수 있습니다. 퀴즈 응답은 모델이 JSON을 markdown 코드블록으로 감싸더라도 `questions` 배열을 파싱하도록 처리합니다.

## Vector index

pgvector를 사용할 수 있는 PostgreSQL 환경에서는 DB 초기화 시 `document_chunks` 테이블이 생성됩니다. 먼저 `backend/.env`에 OpenAI API key와 embedding 모델을 설정합니다.

```env
OPENAI_API_KEY=<your_openai_api_key>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

DB 테이블 생성:

```bash
python3 -m backend.scripts.init_db
```

기존 노트/페이지/AI Canvas 내용을 vector 검색 대상으로 색인하려면 다음 스크립트를 실행합니다.

```bash
python3 -m backend.scripts.backfill_document_chunks
```

일부 데이터만 색인할 수도 있습니다.

```bash
python3 -m backend.scripts.backfill_document_chunks --user-id 1 --note-id 3
```

색인이 없거나 embedding 호출이 실패하면 `/ai/rag/*`와 기존 채팅 RAG hint는 keyword retrieval 결과를 사용합니다.
`backfill_document_chunks` 또는 note 단위 재색인을 실행하면 현재 노트/페이지/AI Canvas source 목록을 기준으로 더 이상 존재하지 않는 오래된 chunk도 함께 정리합니다.

## Run

```bash
uvicorn backend.app.main:app --reload
```

frontend 스크립트를 사용할 수도 있습니다.

```bash
cd frontend
npm run backend:dev
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

`OPENAI_API_KEY` 또는 `GEMINI_API_KEY`가 설정되어 있지 않으면 RAG endpoint는 수동 검증을 위해 mock LLM 응답을 반환합니다. vector 색인은 `OPENAI_API_KEY`가 있을 때만 생성할 수 있습니다. 일반 AI 채팅은 선택한 `AI_PROVIDER`에 맞는 API key가 필요합니다.

## Demo checklist

최종 보고서/시연 환경에서 vector RAG까지 확인하려면 다음 순서로 준비합니다.

1. PostgreSQL에 pgvector extension을 사용할 수 있게 준비합니다.
2. `backend/.env`에 `OPENAI_API_KEY`를 넣습니다.
3. `python3 -m backend.scripts.init_db`를 실행합니다.
4. 노트/PDF/AI Canvas 데이터를 만든 뒤 `python3 -m backend.scripts.backfill_document_chunks`를 실행합니다.
5. `/ai/rag/ask`, `/ai/rag/summary`, `/ai/rag/quiz` 또는 기존 AI chat에서 질문합니다.

위 조건 중 일부가 준비되지 않아도 앱은 keyword retrieval fallback으로 동작합니다.

## Test

```bash
python3 -m unittest backend.tests.test_rag_retriever
```

## Vector DB migration point

vector DB 검색 구현은 `backend/app/services/document_chunk_index.py`의 `retrieve_vector_contexts`에 있습니다. keyword fallback은 `backend/app/services/rag_retriever.py`의 `retrieve_relevant_contexts`가 담당하고, 최종 hybrid score 병합은 `merge_hybrid_contexts`에서 처리합니다.

나중에 Pinecone, Weaviate, Qdrant 같은 외부 vector DB로 바꿀 때 유지하면 좋은 인터페이스:

- 입력: `query`, `documents`, `top_k`
- 출력: `list[RetrievedContext]`
- 각 source는 `source_type`, `source_id`, `title`, `content`, `score`를 포함
