import hashlib
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


SUBJECT_ALIAS_KEYS: dict[str, str] = {
    "컴네": "컴퓨터네트워크",
    "컴퓨터망": "컴퓨터네트워크",
    "강화": "강화학습",
}


def normalize_match_text(value: str | None, *, keep_digits: bool = True) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"\.pdf$", "", text)
    text = re.sub(r"^\s*\d+\s*[.)_-]*\s*", "", text)
    allowed = r"0-9a-z가-힣" if keep_digits else r"a-z가-힣"
    return re.sub(fr"[^{allowed}]+", "", text)


def normalize_subject_key(value: str | None) -> str:
    key = normalize_match_text(value, keep_digits=False)
    key = SUBJECT_ALIAS_KEYS.get(key, key)
    return key


def normalize_file_name_key(value: str | None) -> str:
    if not value:
        return ""
    return normalize_match_text(Path(value).name, keep_digits=True)


def build_document_match_key(filename: str | None, page_count: int | None) -> str | None:
    file_key = normalize_file_name_key(filename)
    if not file_key or not page_count:
        return None
    return f"{file_key}:pages={max(1, int(page_count))}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def subjects_match(left_name: str | None, right_name: str | None, left_key: str | None = None, right_key: str | None = None) -> bool:
    left = left_key or normalize_subject_key(left_name)
    right = right_key or normalize_subject_key(right_name)
    if not left or not right:
        return False
    if left == right:
        return True
    if min(len(left), len(right)) >= 2 and (left.startswith(right) or right.startswith(left)):
        return True
    return _similarity(left, right) >= 0.82


def _page_counts_match(left: Any, right: Any) -> bool:
    try:
        left_count = int(left)
        right_count = int(right)
    except (TypeError, ValueError):
        return False
    return left_count > 0 and right_count > 0 and left_count == right_count


def _file_sizes_compatible(left: Any, right: Any) -> bool:
    try:
        left_size = int(left)
        right_size = int(right)
    except (TypeError, ValueError):
        return True
    if left_size <= 0 or right_size <= 0:
        return True
    ratio = abs(left_size - right_size) / max(left_size, right_size)
    return ratio <= 0.08


def documents_match(current: dict[str, Any], candidate: dict[str, Any]) -> bool:
    if not _page_counts_match(current.get("page_count"), candidate.get("page_count")):
        return False

    current_hash = current.get("file_sha256")
    candidate_hash = candidate.get("file_sha256")
    if current_hash and candidate_hash and current_hash == candidate_hash:
        return True

    sizes_compatible = _file_sizes_compatible(
        current.get("file_size_bytes"),
        candidate.get("file_size_bytes"),
    )

    current_key = current.get("document_match_key") or build_document_match_key(
        current.get("original_filename") or current.get("title"),
        current.get("page_count"),
    )
    candidate_key = candidate.get("document_match_key") or build_document_match_key(
        candidate.get("original_filename") or candidate.get("title"),
        candidate.get("page_count"),
    )
    if current_key and candidate_key and current_key == candidate_key:
        return sizes_compatible

    current_name = normalize_file_name_key(current.get("original_filename") or current.get("title"))
    candidate_name = normalize_file_name_key(candidate.get("original_filename") or candidate.get("title"))
    return _similarity(current_name, candidate_name) >= 0.94 and sizes_compatible
