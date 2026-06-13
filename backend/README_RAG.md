# B-Snap Backend RAG

이 문서는 현재 backend RAG 동작 기준을 정리합니다.

## 방향

- RAG 검색은 `pgvector` 기반 vector 검색만 사용합니다.
- keyword 검색, hybrid score 병합, keyword fallback은 사용하지 않습니다.
- `pgvector`, `document_chunks`, embedding API key가 준비되지 않으면 RAG만 사용할 수 없습니다.
- 이 경우 앱이나 서버 전체가 죽으면 안 되며, RAG 요청만 상태에 맞는 실패 안내를 반환해야 합니다.

## 검색 대상

현재 v1에서 index하는 자료는 다음입니다.

- `pdf_page`: PDF에서 추출한 페이지 텍스트
- `canvas_note`: AI Canvas Markdown 본문
- `image_ai_summary`: 이미지 AI 분석 요약이 저장된 경우

`pdf_text_box`, `image_ocr`, 원본 이미지, 임시 Canvas draft, 펜 stroke OCR은 v1 검색 대상에서 제외합니다.

## Vector Index

로컬 또는 배포 DB는 pgvector를 사용할 수 있어야 합니다.

```env
OPENAI_API_KEY=<your_openai_api_key>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

DB 테이블 생성:

```bash
python -m backend.scripts.init_db
```

기존 데이터 backfill:

```bash
python -m backend.scripts.backfill_document_chunks
```

특정 사용자/노트만 다시 index:

```bash
python -m backend.scripts.backfill_document_chunks --user-id 1 --note-id 3
```

`reindex`는 단순 정렬이 아니라 검색용 index를 최신 상태로 맞추는 작업입니다. 같은 content hash는 다시 embedding하지 않고, 내용이 바뀐 chunk만 갱신하는 방향을 유지합니다.

## Endpoints

- `POST /ai/rag/ask`
- `POST /ai/rag/summary`
- `POST /ai/rag/quiz`
- `POST /ai/rag/reindex/notes/{note_id}`
- `POST /ai/rag/reindex/folders/{folder_id}`

AI Chat은 `general | rag` router를 사용합니다.

- `general`: PDF/Canvas/노트 자료와 무관한 일반 질문입니다. 자료 검색을 사용하지 않습니다.
- `rag`: 현재 페이지/선택 영역/Canvas context를 우선 사용하고, chat session의 `rag_scope` 안에서 vector 검색 결과를 보조 context로 사용합니다.

## Failure Policy

RAG는 keyword fallback으로 몰래 대체하지 않습니다.

- vector 검색 시스템 문제: "지금은 자료 검색을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
- 검색 성공했지만 관련 자료 없음: "관련된 자료를 찾지 못했습니다."
- 자료 처리 중이거나 index가 아직 없는 경우: index 완료 후 다시 질문해야 합니다.

현재 페이지, 선택 영역, Canvas block 같은 local context가 있으면 이 context를 우선 사용합니다. RAG 결과는 항상 보조 자료입니다.

## Debug

개발 환경에서는 웹 AI Chat의 `RAG Dev` 패널과 backend debug API로 다음을 확인할 수 있습니다.

- router mode
- 현재 scope
- 검색된 chunk와 score
- 현재 note index 상태
- pgvector/index 상태

## Test

```bash
python -m unittest backend.tests.test_rag_retriever
```
