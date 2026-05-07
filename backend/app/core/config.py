from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = Field(default="local", validation_alias="APP_ENV")
    app_name: str = Field(default="B-Snap API", validation_alias="APP_NAME")
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/bsnap",
        validation_alias="DATABASE_URL",
    )
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_default_model: str = Field(default="gpt-4.1-mini", validation_alias="OPENAI_DEFAULT_MODEL")
    allowed_origins: str = Field(
        default="http://localhost:8081,http://localhost:19006",
        validation_alias="ALLOWED_ORIGINS",
    )

    @property
    def allowed_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file="backend/.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
