"""CLI for enhance-only experiments on already-cropped images."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .crop_enhancer import enhance_cropped_image


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def run_experiment(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    jpeg_quality: int = 90,
    max_side: int = 1600,
) -> dict[str, Any] | list[dict[str, Any]]:
    path = Path(input_path)
    if path.is_dir():
        results: list[dict[str, Any]] = []
        for image_path in _iter_image_files(path):
            results.append(
                enhance_cropped_image(
                    image_path,
                    output_dir,
                    jpeg_quality=jpeg_quality,
                    max_side=max_side,
                )
            )
        return results

    return enhance_cropped_image(
        path,
        output_dir,
        jpeg_quality=jpeg_quality,
        max_side=max_side,
    )


def _iter_image_files(input_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in input_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
    )


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Enhance already-cropped board images.")
    parser.add_argument("--input", required=True, help="Input cropped image file or directory.")
    parser.add_argument("--output-dir", required=True, help="Directory where experiment outputs are saved.")
    parser.add_argument("--jpeg-quality", type=int, default=90, help="JPEG quality for view outputs.")
    parser.add_argument("--max-side", type=int, default=1600, help="Resize longest side before enhancement.")
    return parser


def main() -> int:
    args = _build_arg_parser().parse_args()
    result = run_experiment(
        args.input,
        args.output_dir,
        jpeg_quality=args.jpeg_quality,
        max_side=args.max_side,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if isinstance(result, list):
        return 0 if all(item.get("success") for item in result) else 1
    return 0 if result.get("success") else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
