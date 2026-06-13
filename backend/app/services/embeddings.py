import logging

from openai import OpenAI, OpenAIError

from backend.app.core.config import get_settings


logger = logging.getLogger(__name__)
EMBEDDING_DIMENSION = 1536


class EmbeddingError(RuntimeError):
    pass


def embedding_to_vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.8g}" for value in embedding) + "]"


def generate_embedding(text: str, *, model: str | None = None) -> list[float]:
    settings = get_settings()
    selected_model = model or settings.openai_embedding_model
    if not settings.openai_api_key or settings.openai_api_key == "your_openai_api_key_here":
        raise EmbeddingError("OPENAI_API_KEY is not configured for embeddings")

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        response = client.embeddings.create(
            model=selected_model,
            input=text,
        )
    except OpenAIError as exc:
        logger.exception("OpenAI embedding request failed: model=%s", selected_model)
        raise EmbeddingError("OpenAI embedding request failed") from exc

    embedding = list(response.data[0].embedding)
    if len(embedding) != EMBEDDING_DIMENSION:
        raise EmbeddingError(f"Unexpected embedding dimension: {len(embedding)}")
    return embedding
