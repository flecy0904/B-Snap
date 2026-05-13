#!/usr/bin/env python3
"""Manual runner for OpenCV scan enhancement on an already warped image."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from img_preprocessing.enhance import ScanEnhanceOptions, preprocess_image_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run scan enhancement on a warped/cropped image.")
    parser.add_argument("--input", required=True, help="Input warped/cropped image path.")
    parser.add_argument("--output", required=True, help="Output directory.")
    parser.add_argument("--basename", help="Output basename. Defaults to input filename stem.")
    parser.add_argument("--image-type", choices=("whiteboard", "blackboard", "screen"), help="Override image type.")
    parser.add_argument("--jpeg-quality", type=int, default=92, help="Enhanced color JPEG quality.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = preprocess_image_file(
        args.input,
        args.output,
        basename=args.basename,
        options=ScanEnhanceOptions(
            image_type=args.image_type,
            jpeg_quality=args.jpeg_quality,
        ),
    )
    print(f"enhanced_color: {result.enhanced_color_path}")
    print(f"ocr_bw: {result.ocr_bw_path}")
    print(f"metrics: {result.metrics_path}")
    print(
        json.dumps(
            {
                "image_type": result.metrics["image_type"],
                "blur_score": result.metrics["blur_score"],
                "brightness": result.metrics["brightness"],
                "contrast": result.metrics["contrast"],
                "black_pixel_ratio": result.metrics["black_pixel_ratio"],
                "white_pixel_ratio": result.metrics["white_pixel_ratio"],
                "processing_ms": result.metrics["processing_ms"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
