# Notes Data Contract Draft

이 문서는 현재 앱 구현 기준의 초안입니다. OCR/RAG 구현 방식에 따라 필드명, 테이블, API는 조정 가능합니다.

목적은 OCR/RAG 팀에게 "현재 앱이 어떤 입력 데이터를 만들어두는지"를 공유하고, 확정 전 조율 지점을 명확히 하는 것입니다.

## Current Entities

### folders

과목 또는 문서 그룹에 가까운 단위입니다.

- `id`: folder ID
- `name`: 과목/그룹 이름
- `color`: UI 표시 색상

현재 프론트는 과목명과 같은 folder를 찾아 노트를 연결합니다.

### notes

문서 단위 엔티티입니다. PDF, 이미지 노트, 빈 노트가 모두 하나의 `notes` row로 표현됩니다.

- `id`: note ID
- `folder_id`: 소속 folder ID
- `title`: 문서 제목
- `summary`: 문서 요약 또는 프리뷰 텍스트
- `created_at`, `updated_at`: 생성/수정 시각

### note_pages

문서의 페이지 단위 엔티티입니다. OCR/RAG가 페이지 단위로 원본 파일과 필기 상태를 찾을 때 이 테이블을 기준으로 보면 됩니다.

- `id`: page ID
- `note_id`: 소속 note ID
- `page_number`: 문서 안의 1-based 페이지 번호
- `image_url`: 원본 파일 URL
- `content`: 프론트 필기 상태 JSON
- `created_at`, `updated_at`: 생성/수정 시각

`image_url`의 현재 의미:

- PDF 문서: 모든 페이지가 같은 PDF 파일 URL을 가질 수 있습니다.
- 이미지 노트: 해당 이미지 파일 URL을 가집니다.
- 빈 노트: `null`일 수 있습니다.

## Current Page Content JSON

`note_pages.content`는 현재 OCR 텍스트가 아닙니다. 프론트 필기 상태입니다.

```json
{
  "kind": "bsnap-page-state",
  "version": 1,
  "inkStrokes": [],
  "textAnnotations": []
}
```

- `inkStrokes`: 손글씨/형광펜 stroke 데이터
- `textAnnotations`: 사용자가 직접 추가한 텍스트 주석

OCR 결과를 여기에 섞는 것은 아직 권장하지 않습니다. OCR/RAG 팀과 별도 저장 위치를 합의하는 것이 좋습니다.

## Upload APIs

### POST /uploads

파일만 업로드합니다.

현재 허용 타입:

- PDF
- JPEG
- PNG
- HEIC/HEIF

응답 예시:

```json
{
  "filename": "lecture.pdf",
  "stored_filename": "uuid-lecture.pdf",
  "content_type": "application/pdf",
  "size_bytes": 12345,
  "page_count": 10,
  "page_numbers": [1, 2, 3],
  "url": "/uploads/uuid-lecture.pdf"
}
```

프론트는 상대 URL을 backend base URL과 합쳐 사용합니다.

### POST /uploads/pdf-note

PDF 업로드, note 생성, note_pages 일괄 생성을 한 번에 처리합니다.

입력:

- `folder_id`
- `title`
- `summary`
- `file`

응답:

```json
{
  "upload": {
    "url": "/uploads/uuid-lecture.pdf",
    "page_count": 10,
    "page_numbers": [1, 2, 3]
  },
  "note": {
    "id": 1,
    "folder_id": 1,
    "title": "lecture.pdf",
    "summary": "업로드한 PDF 문서"
  },
  "pages": [
    {
      "id": 1,
      "note_id": 1,
      "page_number": 1,
      "image_url": "/uploads/uuid-lecture.pdf",
      "content": "{\"kind\":\"bsnap-page-state\",...}"
    }
  ]
}
```

## Frontend Behavior

현재 프론트는 다음 흐름을 만듭니다.

- PDF 업로드: `/uploads/pdf-note` 호출 후 실제 페이지 수만큼 `note_pages` 생성
- 이미지 캡처/사진첩: `/uploads` 호출 후 `note_pages.image_url`에 이미지 URL 저장
- 필기/텍스트 주석: `note_pages.content`에 저장
- 필기 저장 실패: 페이지 단위 queue에서 자동 재시도

## Suggested OCR/RAG Integration Points

현재 구현 기준으로 OCR/RAG가 사용할 수 있는 입력은 다음입니다.

- `note_pages.id`: 페이지 고유 ID
- `note_pages.note_id`: 문서 고유 ID
- `note_pages.page_number`: 원본 문서 내 페이지 번호
- `note_pages.image_url`: PDF 또는 이미지 원본 파일 URL
- `note_pages.content`: 사용자 필기/텍스트 주석 JSON

추천 방향:

- OCR 원문은 `note_pages.content`에 섞지 않습니다.
- OCR 결과는 별도 테이블 또는 별도 컬럼으로 둡니다.
- RAG chunk는 `note_id`, `page_id`, `page_number`를 반드시 보존합니다.

## Open Questions For OCR/RAG Team

아래는 확정 전 팀원들과 합의해야 할 질문입니다.

- OCR 결과를 페이지 단위로 저장할지, 블록/라인 단위로 저장할지
- PDF 텍스트 추출과 이미지 OCR 결과를 같은 구조로 다룰지
- OCR status가 필요한지: `pending`, `processing`, `ready`, `failed`
- OCR provider 정보를 저장할지: Tesseract, PaddleOCR, Google Vision 등
- RAG chunk를 PostgreSQL에 저장할지, vector DB에 저장할지
- RAG chunk가 `note_pages.id`와 어떻게 연결될지
- 사용자가 추가한 `textAnnotations`를 OCR 텍스트와 같이 검색할지

## Candidate Schema, Not Yet Implemented

아래는 후보입니다. 아직 확정/구현하지 않습니다.

```text
note_page_ocr_results
- id
- note_page_id
- status
- provider
- extracted_text
- blocks_json
- created_at
- updated_at
```

```text
rag_chunks
- id
- note_id
- note_page_id
- page_number
- chunk_text
- embedding_ref
- source_type
- created_at
```

`source_type` 후보:

- `pdf_text`
- `image_ocr`
- `user_text_annotation`
- `manual_summary`
