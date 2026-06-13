from functools import lru_cache
from pathlib import Path
from secrets import token_urlsafe

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = Field(default="local", validation_alias="APP_ENV")
    app_name: str = Field(default="B-Snap API", validation_alias="APP_NAME")
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/bsnap",
        validation_alias="DATABASE_URL",
    )
    ai_provider: str = Field(default="openai", validation_alias="AI_PROVIDER")
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_default_model: str = Field(default="gpt-4.1-mini", validation_alias="OPENAI_DEFAULT_MODEL")
    openai_embedding_model: str = Field(default="text-embedding-3-small", validation_alias="OPENAI_EMBEDDING_MODEL")
    handwriting_vision_fallback_enabled: bool = Field(default=False, validation_alias="HANDWRITING_VISION_FALLBACK_ENABLED")
    handwriting_vision_max_clusters_per_page: int = Field(default=6, validation_alias="HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE")
    handwriting_vision_max_pages_per_note: int = Field(default=8, validation_alias="HANDWRITING_VISION_MAX_PAGES_PER_NOTE")
    handwriting_vision_min_cluster_strokes: int = Field(default=2, validation_alias="HANDWRITING_VISION_MIN_CLUSTER_STROKES")
    handwriting_vision_cache_ttl_days: int = Field(default=14, validation_alias="HANDWRITING_VISION_CACHE_TTL_DAYS")
    gemini_api_key: str | None = Field(default=None, validation_alias="GEMINI_API_KEY")
    gemini_default_model: str = Field(default="gemini-2.5-flash", validation_alias="GEMINI_DEFAULT_MODEL")
    allowed_origins: str = Field(
        default="http://localhost:8081,http://localhost:19006",
        validation_alias="ALLOWED_ORIGINS",
    )
    upload_dir: str = Field(default="backend/uploads", validation_alias="UPLOAD_DIR")
    upload_max_bytes: int = Field(default=30 * 1024 * 1024, validation_alias="UPLOAD_MAX_BYTES")
    ai_image_max_bytes: int = Field(default=28 * 1024 * 1024, validation_alias="AI_IMAGE_MAX_BYTES")
    docling_batch_size: int = Field(default=20, validation_alias="DOCLING_BATCH_SIZE")
    docling_fallback_batch_sizes: str = Field(default="10,5", validation_alias="DOCLING_FALLBACK_BATCH_SIZES")
    vision_concurrency: int = Field(default=3, validation_alias="VISION_CONCURRENCY")
    rag_text_min_score: float = Field(default=0.45, validation_alias="RAG_TEXT_MIN_SCORE")
    rag_image_summary_min_score: float = Field(default=0.50, validation_alias="RAG_IMAGE_SUMMARY_MIN_SCORE")
    rag_image_recheck_min_score: float = Field(default=0.55, validation_alias="RAG_IMAGE_RECHECK_MIN_SCORE")
    rag_internal_top_k: int = Field(default=12, validation_alias="RAG_INTERNAL_TOP_K")
    rag_context_max_chunks: int = Field(default=5, validation_alias="RAG_CONTEXT_MAX_CHUNKS")
    rag_source_display_max: int = Field(default=4, validation_alias="RAG_SOURCE_DISPLAY_MAX")
    rag_image_search_top_k: int = Field(default=5, validation_alias="RAG_IMAGE_SEARCH_TOP_K")
    rag_image_recheck_enabled: bool = Field(default=True, validation_alias="RAG_IMAGE_RECHECK_ENABLED")
    rag_image_recheck_judge_top_k: int = Field(default=3, validation_alias="RAG_IMAGE_RECHECK_JUDGE_TOP_K")
    rag_image_recheck_max_images: int = Field(default=2, validation_alias="RAG_IMAGE_RECHECK_MAX_IMAGES")
    page_max_image_crops: int = Field(default=3, validation_alias="PAGE_MAX_IMAGE_CROPS")
    document_max_vision_jobs: int = Field(default=60, validation_alias="DOCUMENT_MAX_VISION_JOBS")
    jwt_secret_key: str = Field(default_factory=lambda: token_urlsafe(32), validation_alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
    jwt_access_token_minutes: int = Field(default=60 * 24 * 7, validation_alias="JWT_ACCESS_TOKEN_MINUTES")

    @property
    def allowed_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def default_ai_model(self) -> str:
        return self.gemini_default_model if self.ai_provider.strip().lower() == "gemini" else self.openai_default_model

    @property
    def upload_path(self) -> Path:
        return Path(self.upload_dir)

    model_config = SettingsConfigDict(
        env_file="backend/.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
