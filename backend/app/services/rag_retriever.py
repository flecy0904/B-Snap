import re
from collections import Counter
from typing import Any

from backend.app.schemas.rag import RetrievedContext


Document = dict[str, Any]

KOREAN_STOPWORDS = {
    "그리고",
    "그러나",
    "그래서",
    "대한",
    "에서",
    "으로",
    "하게",
    "하는",
    "하면",
    "이것",
    "저것",
    "그것",
    "입니다",
    "있습니다",
}

KOREAN_PARTICLE_SUFFIXES = (
    "으로",
    "에서",
    "에게",
    "까지",
    "부터",
    "처럼",
    "보다",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "와",
    "과",
    "도",
    "만",
    "의",
    "에",
)

TOKEN_ALIASES = {
    "스택": ("stack",),
    "stack": ("스택",),
    "큐": ("queue",),
    "queue": ("큐",),
    "후입선출": ("lifo",),
    "lifo": ("후입선출",),
    "선입선출": ("fifo",),
    "fifo": ("선입선출",),
    "트리": ("tree",),
    "tree": ("트리",),
    "그래프": ("graph",),
    "graph": ("그래프",),
    "정렬": ("sort", "sorting"),
    "sort": ("정렬", "sorting"),
    "sorting": ("정렬", "sort"),
    "해시": ("hash", "hashing"),
    "hash": ("해시", "hashing"),
    "hashing": ("해시", "hash"),
    "재귀": ("recursion", "recursive"),
    "recursion": ("재귀", "recursive"),
    "recursive": ("재귀", "recursion"),
    "동적계획법": ("dp", "dynamic", "programming"),
    "dp": ("동적계획법",),
}


def split_text_into_chunks(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    if not text:
        return []
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be greater than or equal to 0 and smaller than chunk_size")

    normalized = re.sub(r"\s+", " ", text).strip()
    chunks = []
    start = 0
    while start < len(normalized):
        end = start + chunk_size
        chunks.append(normalized[start:end].strip())
        if end >= len(normalized):
            break
        start = end - overlap
    return [chunk for chunk in chunks if chunk]


def retrieve_relevant_contexts(
    query: str,
    documents: list[Document],
    top_k: int = 5,
) -> list[RetrievedContext]:
    query_tokens = _tokenize(query)
    if not query_tokens:
        return []

    contexts = []
    for document in documents:
        content = document.get("content") or ""
        title = document.get("title") or ""
        chunks = split_text_into_chunks(content)
        for chunk_index, chunk in enumerate(chunks):
            score = _keyword_overlap_score(query_tokens, " ".join([str(title), chunk]))
            if score <= 0:
                continue
            source_id = str(document.get("source_id") or document.get("id") or "")
            if len(chunks) > 1:
                source_id = f"{source_id}#chunk-{chunk_index + 1}"
            contexts.append(
                RetrievedContext(
                    source_type=str(document.get("source_type") or "document"),
                    source_id=source_id,
                    title=str(document.get("title") or "Untitled"),
                    content=chunk,
                    score=score,
                )
            )

    contexts.sort(key=lambda context: context.score, reverse=True)
    return contexts[:top_k]


def build_rag_context(contexts: list[RetrievedContext]) -> str:
    if not contexts:
        return ""

    return "\n\n".join(
        [
            f"[{index}] {context.title} ({context.source_type}:{context.source_id}, score={context.score:.4f})\n"
            f"{context.content}"
            for index, context in enumerate(contexts, start=1)
        ]
    )


def build_mock_contexts(query: str) -> list[RetrievedContext]:
    return [
        RetrievedContext(
            source_type="mock",
            source_id="mock-note-1",
            title="RAG 테스트용 mock context",
            content=(
                "B-Snap RAG mock context입니다. 실제 DB에서 노트나 페이지 텍스트를 찾지 못했을 때 "
                "keyword retrieval과 프롬프트 연결을 수동 검증하기 위한 fallback입니다. "
                f"사용자 질문: {query}"
            ),
            score=0.0,
        )
    ]


def _tokenize(text: str) -> list[str]:
    raw_tokens = re.findall(r"[0-9A-Za-z가-힣]+", text.lower())
    tokens = []
    seen = set()
    for raw_token in raw_tokens:
        token = _normalize_token(raw_token)
        if len(token) < 2 or token in KOREAN_STOPWORDS:
            continue
        for expanded_token in (token, *TOKEN_ALIASES.get(token, ())):
            if expanded_token not in seen:
                tokens.append(expanded_token)
                seen.add(expanded_token)
    return tokens


def _normalize_token(token: str) -> str:
    normalized = token.strip().lower()
    if re.fullmatch(r"[가-힣]+", normalized):
        for suffix in KOREAN_PARTICLE_SUFFIXES:
            if len(normalized) > len(suffix) + 1 and normalized.endswith(suffix):
                return normalized[: -len(suffix)]
    return normalized


def _keyword_overlap_score(query_tokens: list[str], text: str) -> float:
    text_tokens = _tokenize(text)
    if not text_tokens:
        return 0.0

    query_counts = Counter(query_tokens)
    text_counts = Counter(text_tokens)
    overlap = sum(min(query_counts[token], text_counts[token]) for token in query_counts)
    coverage = overlap / max(len(query_counts), 1)
    density = overlap / max(len(text_counts), 1)
    return round((coverage * 0.8) + (density * 0.2), 4)
