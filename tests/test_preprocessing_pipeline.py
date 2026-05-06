import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

import img_preprocessing.pipeline.preprocessing_pipeline as pipeline_module
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


def _dark_board_crop() -> np.ndarray:
    image = np.full((210, 320, 3), (35, 56, 42), dtype=np.uint8)
    cv2.rectangle(image, (14, 14), (305, 195), (48, 70, 55), 3)
    cv2.putText(image, "DARK BOARD", (36, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (225, 235, 220), 2)
    cv2.putText(image, "bright chalk", (44, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (210, 225, 210), 2)
    return image


def test_preprocess_for_service_runs_crop_and_enhance(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_dir = tmp_path / "service_outputs"
    assert cv2.imwrite(str(input_path), _synthetic_board_with_text())

    result = preprocess_for_service(input_path, output_dir, no_yolo=True)

    assert result["success"] is True
    assert result["failure_stage"] is None
    assert result["crop"]["success"] is True
    assert result["enhance"]["success"] is True
    assert result["crop_output_path"] == result["crop"]["output_path"]
    assert result["view_path"] == result["llm_image_path"]
    assert Path(result["crop_output_path"]).exists()
    assert Path(result["view_path"]).exists()
    assert Path(result["summary_path"]).exists()
    assert result["artifacts"]["pipeline_summary_path"] == result["summary_path"]
    assert result["enhancement_profile"] in {"scan_document", "dark_board"}


def test_preprocess_for_service_passes_dark_profile_hint(tmp_path: Path, monkeypatch) -> None:
    input_path = tmp_path / "raw.jpg"
    output_dir = tmp_path / "service_outputs"
    assert cv2.imwrite(str(input_path), _synthetic_board_with_text())

    def fake_run_hybrid_preprocess(*args, **kwargs):
        output_path = Path(kwargs["output_path"])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        assert cv2.imwrite(str(output_path), _dark_board_crop())
        return {
            "success": True,
            "message": "fake crop success",
            "output_path": str(output_path),
            "write_error": None,
            "selected_candidate": {
                "mode": "chalkboard",
                "yolo_detection": {"class_name": "chalkboard"},
            },
        }

    monkeypatch.setattr(
        pipeline_module,
        "run_hybrid_preprocess",
        fake_run_hybrid_preprocess,
    )

    result = preprocess_for_service(input_path, output_dir, no_yolo=True)

    assert result["success"] is True
    assert result["profile_hint"] == "chalkboard"
    assert result["enhancement_profile"] == "dark_board"
    assert result["enhance"]["profile_hint"] == "chalkboard"
    assert result["enhance"]["metrics"]["profile_metrics"]["decision_source"] == "hint_dark_board"


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
        no_yolo=True,
    )

    assert len(results) == 2
    assert all(result["success"] is True for result in results)
    output_dirs = {result["output_dir"] for result in results}
    view_paths = {result["view_path"] for result in results}
    assert len(output_dirs) == 2
    assert len(view_paths) == 2
    assert all(Path(view_path).exists() for view_path in view_paths)


def test_preprocessing_experiment_cli_wraps_service_pipeline(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_dir = tmp_path / "service_outputs"
    assert cv2.imwrite(str(input_path), _synthetic_board_with_text())

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "img_preprocessing.pipeline.preprocessing_experiment",
            "--input",
            str(input_path),
            "--output-dir",
            str(output_dir),
            "--no-yolo",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    result = json.loads(completed.stdout)
    assert result["success"] is True
    assert Path(result["view_path"]).exists()
    assert Path(result["summary_path"]).exists()
