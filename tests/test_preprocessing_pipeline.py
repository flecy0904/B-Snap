import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

import img_preprocessing.pipeline.preprocessing_experiment as experiment_module
from img_preprocessing.pipeline.preprocessing_pipeline import (
    preprocess_directory_for_service,
    preprocess_for_service,
)


def _synthetic_board_with_text() -> np.ndarray:
    image = np.zeros((420, 640, 3), dtype=np.uint8)
    polygon = np.array([[120, 80], [520, 65], [560, 330], [90, 350]], dtype=np.int32)
    cv2.fillConvexPoly(image, polygon, (245, 245, 245))
    cv2.polylines(image, [polygon.reshape(-1, 1, 2)], isClosed=True, color=(255, 255, 255), thickness=4)
    cv2.putText(image, "B-SNAP", (190, 185), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (20, 20, 20), 4)
    cv2.putText(image, "pipeline", (190, 245), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (20, 20, 20), 3)
    return image


class FakeSegmentationCropper:
    def __init__(self, crop_image: np.ndarray | None = None) -> None:
        self.crop_image = crop_image if crop_image is not None else _synthetic_board_with_text()

    def preprocess(self, input_path, output_path=None, debug_dir=None):
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        assert cv2.imwrite(str(output), self.crop_image)
        mask_path = output.with_name(f"{output.stem}_mask.png")
        assert cv2.imwrite(str(mask_path), np.full(self.crop_image.shape[:2], 255, dtype=np.uint8))
        selected_candidate = {
            "source": "yolo_segmentation",
            "mode": "target_area",
            "class_name": "target_area",
            "confidence": 0.9,
            "crop_box": {"x": 0, "y": 0, "width": self.crop_image.shape[1], "height": self.crop_image.shape[0]},
            "segmentation": {"class_name": "target_area", "confidence": 0.9},
        }
        return {
            "success": True,
            "message": "fake segmentation crop success",
            "output_path": str(output),
            "mask_path": str(mask_path),
            "write_error": None,
            "selected_candidate": selected_candidate,
            "candidates": [selected_candidate],
        }


def test_preprocess_for_service_runs_segmentation_crop_pipeline(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_dir = tmp_path / "service_outputs"
    assert cv2.imwrite(str(input_path), _synthetic_board_with_text())

    result = preprocess_for_service(
        input_path,
        output_dir,
        segmentation_cropper=FakeSegmentationCropper(),
    )

    assert result["success"] is True
    assert result["failure_stage"] is None
    assert result["crop"]["success"] is True
    assert result["scan_enhance"]["success"] is True
    assert result["crop_output_path"] == result["crop"]["output_path"]
    assert result["view_path"] == result["llm_image_path"]
    assert result["view_path"] == result["scan_enhance"]["enhanced_color_path"]
    assert result["llm_image_type"] == "enhanced_color"
    assert Path(result["crop_output_path"]).exists()
    assert Path(result["view_path"]).exists()
    assert Path(result["scan_enhance"]["ocr_bw_path"]).exists()
    assert result["view_path"].endswith("_enhanced_color.jpg")
    assert Path(result["summary_path"]).exists()
    assert result["artifacts"]["pipeline_summary_path"] == result["summary_path"]
    assert result["artifacts"]["enhanced_color_path"] == result["view_path"]
    assert result["artifacts"]["ocr_bw_path"] == result["scan_enhance"]["ocr_bw_path"]


def test_preprocess_directory_for_service_avoids_same_stem_collisions(tmp_path: Path) -> None:
    input_root = tmp_path / "inputs"
    first_dir = input_root / "first"
    second_dir = input_root / "second"
    first_dir.mkdir(parents=True)
    second_dir.mkdir(parents=True)
    assert cv2.imwrite(str(first_dir / "same.jpg"), _synthetic_board_with_text())
    assert cv2.imwrite(str(second_dir / "same.jpg"), _synthetic_board_with_text())

    results = preprocess_directory_for_service(
        input_root,
        tmp_path / "service_outputs",
        recursive=True,
        segmentation_cropper=FakeSegmentationCropper(),
    )

    assert len(results) == 2
    assert all(result["success"] is True for result in results)
    output_dirs = {result["output_dir"] for result in results}
    view_paths = {result["view_path"] for result in results}
    enhanced_paths = {result["artifacts"]["enhanced_color_path"] for result in results}
    assert len(output_dirs) == 2
    assert len(view_paths) == 2
    assert len(enhanced_paths) == 2
    assert all(Path(view_path).exists() for view_path in view_paths)


def test_preprocessing_experiment_run_wraps_service_pipeline(tmp_path: Path, monkeypatch) -> None:
    input_path = tmp_path / "raw.jpg"
    output_dir = tmp_path / "service_outputs"
    assert cv2.imwrite(str(input_path), _synthetic_board_with_text())

    def fake_preprocess_for_service(input_path, output_dir, **kwargs):
        return preprocess_for_service(
            input_path,
            output_dir,
            segmentation_cropper=FakeSegmentationCropper(),
        )

    monkeypatch.setattr(experiment_module, "preprocess_for_service", fake_preprocess_for_service)

    result = experiment_module.run_experiment(
        input_path,
        output_dir,
        seg_conf=0.3,
        mask_margin_ratio=0.04,
    )

    assert result["success"] is True
    assert Path(result["view_path"]).exists()
    assert Path(result["summary_path"]).exists()


def test_preprocessing_experiment_cli_help_mentions_segmentation() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "img_preprocessing.pipeline.preprocessing_experiment",
            "--help",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert "segmentation" in completed.stdout
    assert "--mask-margin" in completed.stdout
    assert "--crop-mode" in completed.stdout
    assert "--output-format" not in completed.stdout
