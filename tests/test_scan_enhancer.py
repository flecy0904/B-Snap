from pathlib import Path

import cv2
import numpy as np
import pytest

import img_preprocessing.enhance.scan_enhancer as scan_enhancer
from img_preprocessing.enhance import (
    ScanEnhanceOptions,
    ScanEnhanceResult,
    preprocess_after_yolo_crop,
    preprocess_image_file,
)


REQUIRED_METRIC_KEYS = {
    "image_type",
    "original_width",
    "original_height",
    "processed_width",
    "processed_height",
    "blur_score",
    "brightness",
    "contrast",
    "black_pixel_ratio",
    "white_pixel_ratio",
    "processing_ms",
    "upscale_applied",
    "downscale_applied",
    "enhanced_color_format",
    "ocr_bw_format",
}


def _whiteboard(width: int = 720, height: int = 520) -> np.ndarray:
    image = np.full((height, width, 3), 238, dtype=np.uint8)
    cv2.rectangle(image, (30, 30), (width - 30, height - 30), (220, 225, 225), 3)
    cv2.putText(image, "B-SNAP", (80, 190), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (20, 20, 20), 5)
    cv2.putText(image, "scan enhancer", (80, 270), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (30, 30, 30), 3)
    shadow = np.linspace(0, 35, width, dtype=np.uint8)
    return cv2.subtract(image, np.dstack([np.tile(shadow, (height, 1))] * 3))


def _blackboard(width: int = 900, height: int = 540) -> np.ndarray:
    image = np.full((height, width, 3), (35, 58, 42), dtype=np.uint8)
    cv2.rectangle(image, (30, 30), (width - 30, height - 30), (45, 75, 55), 3)
    cv2.putText(image, "DARK BOARD", (80, 210), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (225, 235, 220), 4)
    cv2.putText(image, "chalk text", (90, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (210, 225, 210), 3)
    return image


def test_whiteboard_image_creates_enhanced_color_and_ocr_bw() -> None:
    result = preprocess_after_yolo_crop(_whiteboard())

    assert isinstance(result, ScanEnhanceResult)
    assert result.enhanced_color.dtype == np.uint8
    assert result.enhanced_color.ndim == 3
    assert result.enhanced_color.shape[2] == 3
    assert result.ocr_bw.dtype == np.uint8
    assert result.ocr_bw.ndim == 2
    assert set(np.unique(result.ocr_bw)).issubset({0, 255})
    assert result.metrics["image_type"] in {"whiteboard", "screen"}


def test_blackboard_image_is_detected_and_ocr_is_inverted() -> None:
    result = preprocess_after_yolo_crop(_blackboard())

    assert result.metrics["image_type"] == "blackboard"
    assert float(np.mean(result.ocr_bw == 255)) > float(np.mean(result.ocr_bw == 0))


def test_small_image_sets_upscale_applied_true() -> None:
    result = preprocess_after_yolo_crop(_whiteboard(width=500, height=320))

    assert result.metrics["upscale_applied"] is True
    assert result.metrics["downscale_applied"] is False
    assert max(result.metrics["processed_width"], result.metrics["processed_height"]) == 1400


def test_large_image_sets_downscale_applied_true() -> None:
    result = preprocess_after_yolo_crop(_whiteboard(width=2600, height=1800))

    assert result.metrics["upscale_applied"] is False
    assert result.metrics["downscale_applied"] is True
    assert max(result.metrics["processed_width"], result.metrics["processed_height"]) == 2000


def test_metrics_include_required_keys() -> None:
    result = preprocess_after_yolo_crop(_whiteboard())

    assert REQUIRED_METRIC_KEYS.issubset(result.metrics.keys())


def test_output_dir_writes_expected_files(tmp_path: Path) -> None:
    result = preprocess_after_yolo_crop(
        _whiteboard(),
        output_dir=tmp_path,
        basename="unit test board",
    )

    assert (tmp_path / "unit_test_board_enhanced_color.jpg").exists()
    assert (tmp_path / "unit_test_board_ocr_bw.png").exists()
    assert (tmp_path / "unit_test_board_metrics.json").exists()
    assert result.enhanced_color_path == str(tmp_path / "unit_test_board_enhanced_color.jpg")
    assert result.ocr_bw_path == str(tmp_path / "unit_test_board_ocr_bw.png")
    assert result.metrics_path == str(tmp_path / "unit_test_board_metrics.json")


def test_preprocess_image_file_reads_input_and_writes_outputs(tmp_path: Path) -> None:
    input_path = tmp_path / "warped.jpg"
    assert cv2.imwrite(str(input_path), _whiteboard())

    result = preprocess_image_file(input_path, tmp_path / "out")

    assert result.enhanced_color_path is not None
    assert Path(result.enhanced_color_path).exists()
    assert Path(result.ocr_bw_path or "").exists()


def test_fallback_without_ximgproc(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scan_enhancer.cv2, "ximgproc", None, raising=False)

    result = preprocess_after_yolo_crop(_whiteboard())

    assert result.metrics["threshold_method"] == "adaptive_gaussian"
    assert result.metrics["opencv_contrib_ximgproc_available"] is False


def test_accepts_grayscale_and_non_uint8_input() -> None:
    gray_float = cv2.cvtColor(_whiteboard(), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0

    result = preprocess_after_yolo_crop(gray_float)

    assert result.enhanced_color.dtype == np.uint8
    assert result.enhanced_color.ndim == 3


def test_rejects_invalid_input() -> None:
    with pytest.raises(ValueError):
        preprocess_after_yolo_crop(np.zeros((0, 10, 3), dtype=np.uint8))
