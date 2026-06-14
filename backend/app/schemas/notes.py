from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NoteCreate(BaseModel):
    folder_id: int
    title: str
    summary: str | None = None


class NoteUpdate(BaseModel):
    folder_id: int | None = None
    title: str | None = None
    summary: str | None = None


class NoteRead(BaseModel):
    id: int
    folder_id: int
    title: str
    summary: str | None = None
    file_url: str | None = None
    thumbnail_url: str | None = None
    page_count: int | None = None
    original_filename: str | None = None
    file_size_bytes: int | None = None
    file_sha256: str | None = None
    subject_match_key: str | None = None
    document_match_key: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotePageCreate(BaseModel):
    page_number: int
    content: str | None = None
    image_url: str | None = None


class NotePageUpdate(BaseModel):
    page_number: int | None = None
    content: str | None = None
    image_url: str | None = None


class RecognitionCandidateWrite(BaseModel):
    text: str
    confidence: float | None = None


class RecognizedClusterWrite(BaseModel):
    id: str | None = None
    pageNumber: int | None = None
    bbox: dict[str, Any] | None = None
    text: str = ""
    candidates: list[RecognitionCandidateWrite] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    symbols: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    source: str = "mlkit-digital-ink"


class HandwritingRecognitionWrite(BaseModel):
    stroke_hash: str | None = None
    engine: str = "mlkit-digital-ink"
    text: str = ""
    keywords: list[str] = Field(default_factory=list)
    symbols: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    clusters: list[RecognizedClusterWrite] = Field(default_factory=list)
    force: bool = False


class PdfTextExtractionCreate(BaseModel):
    pdf_data: str | None = None


class NotePageRead(BaseModel):
    id: int
    note_id: int
    page_number: int
    content: str | None = None
    image_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NoteRagJobStatusRead(BaseModel):
    text_status: str | None = None
    image_status: str | None = None
    overall_status: str | None = None
    page_count: int = 0
    processed_page_count: int = 0
    total_batches: int = 0
    completed_batches: int = 0
    text_chunk_count: int = 0
    image_candidate_count: int = 0
    image_processed_count: int = 0
    image_completed_count: int = 0
    image_indexed_count: int = 0
    last_error: str | None = None
    started_at: datetime | None = None
    text_ready_at: datetime | None = None
    image_ready_at: datetime | None = None
    updated_at: datetime | None = None


class NoteRagStatusRead(BaseModel):
    rag_job: NoteRagJobStatusRead | None = None
    current_note_chunk_count: int = 0
    image_summary_error: str | None = None


class PdfTextExtractionRead(BaseModel):
    note_id: int
    pages_extracted: int
    pages: list[NotePageRead]


class HandwritingAnalysisRead(BaseModel):
    note_id: int
    pages_analyzed: int = 0
    pages_skipped: int = 0
    pages_failed: int = 0
    vision_pages_used: int = 0
    vision_clusters_analyzed: int = 0
