from pathlib import Path

import cv2
import numpy as np

import img_preprocessing.crop.hybrid_preprocessor as hybrid_module
from img_preprocessing.crop.board_cropper import BoardCropResult
from img_preprocessing.crop.hybrid_preprocessor import (
    HybridCandidate,
    HybridBoardPreprocessor,
    HybridPreprocessorConfig,
    HybridScoringConfig,
    _apply_quality_checks,
    run_hybrid_preprocess,
)
from img_preprocessing.crop.yolo_world_detector import DetectionBox


class FakeYoloDetector:
    def detect(self, *args, **kwargs) -> list[DetectionBox]:
        return [
            DetectionBox(
                class_name="whiteboard",
                confidence=0.92,
                xyxy=[80.0, 55.0, 575.0, 365.0],
                score=0.86,
            )
        ]


def _synthetic_board_with_text() -> np.ndarray:
    image = np.zeros((420, 640, 3), dtype=np.uint8)
    polygon = np.array([[120, 80], [520, 65], [560, 330], [90, 350]], dtype=np.int32)
    cv2.fillConvexPoly(image, polygon, (245, 245, 245))
    cv2.polylines(image, [polygon.reshape(-1, 1, 2)], isClosed=True, color=(255, 255, 255), thickness=4)
    cv2.putText(image, "B-SNAP", (190, 185), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (20, 20, 20), 4)
    cv2.putText(image, "hybrid crop", (175, 245), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (20, 20, 20), 3)
    return image


def test_hybrid_invalid_path_returns_failure() -> None:
    result = run_hybrid_preprocess("does-not-exist.jpg", no_yolo=True)

    assert result["success"] is False
    assert "does not exist" in result["message"]


def test_hybrid_no_yolo_uses_opencv_candidate(tmp_path: Path) -> None:
    image = _synthetic_board_with_text()

    input_path = tmp_path / "synthetic_board.jpg"
    output_path = tmp_path / "synthetic_board_crop.jpg"
    assert cv2.imwrite(str(input_path), image)

    result = run_hybrid_preprocess(
        input_path,
        output_path=output_path,
        no_yolo=True,
    )

    assert result["success"] is True
    assert result["selected_candidate"]["source"] == "opencv"
    opencv_modes = {
        candidate["mode"]
        for candidate in result["candidates"]
        if candidate["source"] == "opencv"
    }
    assert {"board", "writing"}.issubset(opencv_modes)
    assert len(result["opencv_candidates"]) == 2
    assert output_path.exists()


def test_reusable_hybrid_preprocessor_no_yolo(tmp_path: Path) -> None:
    image = _synthetic_board_with_text()

    input_path = tmp_path / "synthetic_board.jpg"
    assert cv2.imwrite(str(input_path), image)

    preprocessor = HybridBoardPreprocessor(HybridPreprocessorConfig(use_yolo=False))
    result = preprocessor.preprocess(input_path)

    assert result["success"] is True
    assert result["selected_candidate"]["source"] == "opencv"


def test_hybrid_scoring_config_keeps_existing_defaults() -> None:
    scoring = HybridScoringConfig()

    assert scoring.opencv_corner_bonus == 0.06
    assert scoring.opencv_unstable_penalty == 0.22
    assert scoring.yolo_screen_bonus == 0.23
    assert scoring.yolo_board_bonus == 0.18
    assert scoring.yolo_high_conf_bonus == 0.15
    assert scoring.yolo_low_conf_penalty == 0.18
    assert scoring.yolo_refined_yolo_weight == 0.45
    assert scoring.yolo_refined_opencv_weight == 0.55
    assert scoring.yolo_refined_bonus == 0.10
    assert scoring.yolo_refined_min_area_ratio == 0.25
    assert scoring.max_yolo_refined_score == 0.98
    default_config = HybridPreprocessorConfig()
    assert default_config.yolo_conf == 0.05
    assert default_config.max_det == 20
    assert default_config.yolo_imgsz is None
    assert default_config.yolo_margin_ratio == 0.06
    assert "projection screen" in (default_config.yolo_classes or [])
    assert "green board" in (default_config.yolo_classes or [])
    assert default_config.refine_yolo_with_opencv is True


def test_refine_yolo_flag_controls_refined_candidates(tmp_path: Path) -> None:
    image = _synthetic_board_with_text()
    input_path = tmp_path / "synthetic_board.jpg"
    assert cv2.imwrite(str(input_path), image)

    without_refine = run_hybrid_preprocess(
        input_path,
        yolo_detector=FakeYoloDetector(),
        refine_yolo_with_opencv=False,
        enable_quality_check=False,
    )
    with_refine = run_hybrid_preprocess(
        input_path,
        yolo_detector=FakeYoloDetector(),
        refine_yolo_with_opencv=True,
        enable_quality_check=False,
    )

    assert any(candidate["source"] == "yolo_world" for candidate in without_refine["candidates"])
    assert not any(candidate["source"] == "yolo_world_opencv" for candidate in without_refine["candidates"])
    assert any(candidate["source"] == "yolo_world" for candidate in with_refine["candidates"])
    assert any(candidate["source"] == "yolo_world_opencv" for candidate in with_refine["candidates"])


def test_yolo_refined_candidate_rejects_tiny_corner_area(monkeypatch) -> None:
    candidate = HybridCandidate(
        source="yolo_world",
        mode="whiteboard",
        confidence=0.92,
        score=0.9,
        message="test yolo candidate",
        image=np.zeros((100, 100, 3), dtype=np.uint8),
        crop_box={"x": 20, "y": 30, "width": 100, "height": 100},
    )
    detection = DetectionBox(
        class_name="whiteboard",
        confidence=0.92,
        xyxy=[20.0, 30.0, 120.0, 130.0],
        score=0.86,
    )

    def fake_crop_and_warp_board(*args, **kwargs) -> BoardCropResult:
        return BoardCropResult(
            success=True,
            message="Tiny corner area.",
            corners=[[10, 10], [20, 10], [20, 20], [10, 20]],
            confidence=0.9,
            mode_used="board",
            warped_image=np.zeros((10, 10, 3), dtype=np.uint8),
        )

    monkeypatch.setattr(hybrid_module, "crop_and_warp_board", fake_crop_and_warp_board)

    refined = hybrid_module._candidate_from_yolo_refined(
        candidate,
        detection,
        scoring=HybridScoringConfig(),
    )

    assert refined is None


def test_quality_check_penalizes_low_quality_crop() -> None:
    candidate = HybridCandidate(
        source="test",
        mode="tiny",
        confidence=1.0,
        score=0.8,
        message="test candidate",
        image=np.zeros((8, 8, 3), dtype=np.uint8),
    )

    _apply_quality_checks([candidate], (420, 640, 3), HybridScoringConfig())

    assert candidate.base_score == 0.8
    assert candidate.score < candidate.base_score
    assert "small_crop" in candidate.quality_warnings
    assert "low_contrast" in candidate.quality_warnings


def test_quality_check_can_be_disabled(tmp_path: Path) -> None:
    image = _synthetic_board_with_text()
    input_path = tmp_path / "synthetic_board.jpg"
    assert cv2.imwrite(str(input_path), image)

    result = run_hybrid_preprocess(
        input_path,
        no_yolo=True,
        enable_quality_check=False,
    )

    assert result["success"] is True
    assert all(candidate["quality_warnings"] == [] for candidate in result["candidates"])
    assert all(candidate["quality_score"] == 1.0 for candidate in result["candidates"])
