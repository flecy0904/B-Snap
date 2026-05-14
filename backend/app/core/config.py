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
    gemini_api_key: str | None = Field(default=None, validation_alias="GEMINI_API_KEY")
    gemini_default_model: str = Field(default="gemini-2.5-flash", validation_alias="GEMINI_DEFAULT_MODEL")
    allowed_origins: str = Field(
        default="http://localhost:8081,http://localhost:19006",
        validation_alias="ALLOWED_ORIGINS",
    )
    upload_dir: str = Field(default="backend/uploads", validation_alias="UPLOAD_DIR")
    upload_max_bytes: int = Field(default=30 * 1024 * 1024, validation_alias="UPLOAD_MAX_BYTES")
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
