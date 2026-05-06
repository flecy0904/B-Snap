import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

import img_preprocessing.enhance.crop_enhancer as enhancer_module
from img_preprocessing.enhance.crop_enhancer import enhance_cropped_image


def _low_contrast_crop() -> np.ndarray:
    image = np.full((180, 260, 3), 184, dtype=np.uint8)
    cv2.rectangle(image, (0, 0), (259, 179), (205, 205, 205), 6)
    cv2.putText(image, "B-SNAP", (38, 82), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (118, 118, 118), 3)
    cv2.putText(image, "crop enhance", (34, 126), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (126, 126, 126), 2)
    cv2.line(image, (30, 145), (230, 145), (130, 130, 130), 2)
    return image


def _shadowed_document_crop() -> np.ndarray:
    height, width = 220, 320
    horizontal_gradient = np.linspace(0.58, 1.08, width, dtype=np.float32)
    vertical_gradient = np.linspace(0.92, 1.02, height, dtype=np.float32)[:, None]
    background = 216.0 * horizontal_gradient * vertical_gradient
    gray = np.clip(background, 0, 242).astype(np.uint8)
    image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    cv2.rectangle(image, (16, 16), (303, 203), (225, 225, 225), 2)
    cv2.putText(image, "SCAN NOTE", (40, 88), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (82, 82, 82), 3)
    cv2.putText(image, "shadow removal", (42, 132), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (92, 92, 92), 2)
    cv2.line(image, (42, 154), (270, 154), (105, 105, 105), 2)
    return image


def _dark_board_crop() -> np.ndarray:
    image = np.full((210, 320, 3), (35, 56, 42), dtype=np.uint8)
    cv2.rectangle(image, (14, 14), (305, 195), (48, 70, 55), 3)
    cv2.putText(image, "DARK BOARD", (36, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (225, 235, 220), 2)
    cv2.putText(image, "bright chalk", (44, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (210, 225, 210), 2)
    cv2.line(image, (42, 150), (276, 150), (215, 230, 215), 2)
    cv2.circle(image, (238, 92), 22, (205, 220, 205), 2)
    return image


def _bright_whiteboard_crop() -> np.ndarray:
    image = np.full((210, 320, 3), 235, dtype=np.uint8)
    cv2.rectangle(image, (14, 14), (305, 195), (248, 248, 248), 4)
    cv2.putText(image, "WHITE BOARD", (34, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (40, 40, 40), 2)
    cv2.putText(image, "not chalk", (52, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (65, 65, 65), 2)
    cv2.line(image, (42, 150), (276, 150), (80, 80, 80), 2)
    return image


def _illumination_variation(image_bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=25, sigmaY=25)
    return float(np.std(background))


def test_enhance_cropped_image_creates_outputs(tmp_path: Path) -> None:
    input_path = tmp_path / "crop.jpg"
    output_dir = tmp_path / "enhanced"
    low_contrast = _low_contrast_crop()
    assert cv2.imwrite(str(input_path), low_contrast)

    result = enhance_cropped_image(input_path, output_dir)
    view_image = cv2.imread(result["view_path"], cv2.IMREAD_COLOR)

    assert result["success"] is True
    assert result["write_error"] is None
    assert result["view_path"].endswith("_view.jpg")
    assert result["ocr_path"] is None
    assert result["comparison_path"] is None
    assert result["llm_selection_visual_path"] is None
    assert result["llm_image_type"] == "view"
    assert result["llm_image_path"] == result["view_path"]
    assert Path(result["llm_image_path"]).exists()
    assert result["llm_image_scores"]["view"] >= 0.0
    assert result["llm_image_reason"]
    assert result["summary_path"].endswith("_summary.json")
    assert Path(result["view_path"]).exists()
    assert Path(result["summary_path"]).exists()
    assert result["metrics"]["original_size"] == {"width": 260, "height": 180}
    assert result["metrics"]["view_size"] == {"width": 260, "height": 180}
    assert result["metrics"]["view_bytes"] is not None
    assert result["metrics"]["ocr_bytes"] is None
    assert result["enhancement_profile"] == "scan_document"
    assert result["metrics"]["profile_metrics"]["selected_profile"] == "scan_document"
    assert (
        result["metrics"]["scan_metrics"]["contrast_after"]
        > result["metrics"]["scan_metrics"]["contrast_before"]
    )
    assert (
        result["metrics"]["scan_metrics"]["sharpness_after"]
        > result["metrics"]["scan_metrics"]["sharpness_before"]
    )
    assert view_image is not None
    assert np.std(cv2.cvtColor(view_image, cv2.COLOR_BGR2GRAY)) > np.std(
        cv2.cvtColor(low_contrast, cv2.COLOR_BGR2GRAY)
    )


def test_scan_like_view_reduces_shadow_variation(tmp_path: Path) -> None:
    input_path = tmp_path / "shadowed.jpg"
    output_dir = tmp_path / "enhanced"
    shadowed = _shadowed_document_crop()
    assert cv2.imwrite(str(input_path), shadowed)

    result = enhance_cropped_image(input_path, output_dir)
    view_image = cv2.imread(result["view_path"], cv2.IMREAD_COLOR)

    assert result["success"] is True
    assert view_image is not None
    assert result["enhancement_profile"] == "scan_document"
    assert _illumination_variation(view_image) < _illumination_variation(shadowed)
    assert result["metrics"]["scan_metrics"]["background_brightness"] > 210
    assert result["metrics"]["scan_metrics"]["background_white_ratio"] > 0


def test_dark_board_profile_preserves_dark_background_and_enhances_bright_strokes(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "dark_board.jpg"
    output_dir = tmp_path / "enhanced"
    dark_board = _dark_board_crop()
    assert cv2.imwrite(str(input_path), dark_board)

    result = enhance_cropped_image(input_path, output_dir)
    view_image = cv2.imread(result["view_path"], cv2.IMREAD_COLOR)

    assert result["success"] is True
    assert result["enhancement_profile"] == "dark_board"
    assert result["metrics"]["profile_metrics"]["selected_profile"] == "dark_board"
    assert view_image is not None

    before_gray = cv2.cvtColor(dark_board, cv2.COLOR_BGR2GRAY)
    after_gray = cv2.cvtColor(view_image, cv2.COLOR_BGR2GRAY)
    background_mask = before_gray < 95
    stroke_mask = before_gray > 160

    assert float(np.mean(after_gray[background_mask])) <= (
        float(np.mean(before_gray[background_mask])) + 12.0
    )
    assert float(np.mean(after_gray[stroke_mask])) > float(np.mean(before_gray[stroke_mask]))
    assert (
        result["metrics"]["scan_metrics"]["sharpness_after"]
        > result["metrics"]["scan_metrics"]["sharpness_before"]
    )


def test_bright_surface_ignores_chalkboard_hint(tmp_path: Path) -> None:
    input_path = tmp_path / "bright_whiteboard.jpg"
    output_dir = tmp_path / "enhanced"
    assert cv2.imwrite(str(input_path), _bright_whiteboard_crop())

    result = enhance_cropped_image(input_path, output_dir, profile_hint="chalkboard")
    profile_metrics = result["metrics"]["profile_metrics"]

    assert result["success"] is True
    assert result["profile_hint"] == "chalkboard"
    assert result["enhancement_profile"] == "scan_document"
    assert profile_metrics["hint_dark_board"] is True
    assert profile_metrics["obviously_bright_surface"] is True
    assert profile_metrics["decision_source"] == "pixel_bright_scan_document"


def test_enhance_cropped_image_only_writes_view_output(tmp_path: Path) -> None:
    input_path = tmp_path / "crop.jpg"
    output_dir = tmp_path / "enhanced"
    assert cv2.imwrite(str(input_path), _low_contrast_crop())

    result = enhance_cropped_image(input_path, output_dir)

    assert result["success"] is True
    assert sorted(path.name for path in output_dir.iterdir()) == [
        "crop_summary.json",
        "crop_view.jpg",
    ]


def test_enhance_cropped_image_write_false_returns_failure(tmp_path: Path, monkeypatch) -> None:
    input_path = tmp_path / "crop.jpg"
    output_dir = tmp_path / "enhanced"
    assert cv2.imwrite(str(input_path), _low_contrast_crop())

    monkeypatch.setattr(enhancer_module.cv2, "imwrite", lambda *args, **kwargs: False)

    result = enhance_cropped_image(input_path, output_dir)

    assert result["success"] is False
    assert result["view_path"] is None
    assert result["ocr_path"] is None
    assert result["comparison_path"] is None
    assert result["llm_image_path"] is None
    assert result["llm_image_type"] is None
    assert result["llm_selection_visual_path"] is None
    assert result["summary_path"] is not None
    assert result["write_error"] is not None
    assert "cv2.imwrite returned False" in result["write_error"]


def test_enhance_cropped_image_invalid_inputs_return_failure(tmp_path: Path) -> None:
    missing = enhance_cropped_image(tmp_path / "missing.jpg", tmp_path / "out")
    assert missing["success"] is False
    assert "does not exist" in missing["message"]

    undecodable_path = tmp_path / "not_an_image.jpg"
    undecodable_path.write_text("not an image", encoding="utf-8")
    undecodable = enhance_cropped_image(undecodable_path, tmp_path / "out")

    assert undecodable["success"] is False
    assert "could not be decoded" in undecodable["message"]


def test_crop_enhancement_cli_directory_processes_only_images(tmp_path: Path) -> None:
    input_dir = tmp_path / "inputs"
    output_dir = tmp_path / "outputs"
    input_dir.mkdir()
    assert cv2.imwrite(str(input_dir / "a.jpg"), _low_contrast_crop())
    assert cv2.imwrite(str(input_dir / "b.png"), _low_contrast_crop())
    (input_dir / "notes.txt").write_text("skip me", encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "img_preprocessing.enhance.crop_enhancement_experiment",
            "--input",
            str(input_dir),
            "--output-dir",
            str(output_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    results = json.loads(completed.stdout)
    assert isinstance(results, list)
    assert len(results) == 2
    assert {Path(result["input_path"]).suffix for result in results} == {".jpg", ".png"}
    assert all(result["success"] is True for result in results)
    assert all(Path(result["view_path"]).exists() for result in results)
    assert not list(output_dir.glob("*_ocr.png"))
    assert not list(output_dir.glob("*_comparison.jpg"))
