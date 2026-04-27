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

    model_config = SettingsConfigDict(
        env_file="backend/.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
