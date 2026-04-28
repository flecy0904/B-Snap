from pathlib import Path

import cv2
import numpy as np

from img_preprocessing.crop.hybrid_preprocessor import (
    HybridBoardPreprocessor,
    HybridPreprocessorConfig,
    run_hybrid_preprocess,
)


def test_hybrid_invalid_path_returns_failure() -> None:
    result = run_hybrid_preprocess("does-not-exist.jpg", no_yolo=True)

    assert result["success"] is False
    assert "does not exist" in result["message"]


def test_hybrid_no_yolo_uses_opencv_candidate(tmp_path: Path) -> None:
    image = np.zeros((420, 640, 3), dtype=np.uint8)
    polygon = np.array([[120, 80], [520, 65], [560, 330], [90, 350]], dtype=np.int32)
    cv2.fillConvexPoly(image, polygon, (245, 245, 245))
    cv2.putText(image, "B-SNAP", (190, 205), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (20, 20, 20), 4)

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
    assert output_path.exists()


def test_reusable_hybrid_preprocessor_no_yolo(tmp_path: Path) -> None:
    image = np.zeros((420, 640, 3), dtype=np.uint8)
    polygon = np.array([[120, 80], [520, 65], [560, 330], [90, 350]], dtype=np.int32)
    cv2.fillConvexPoly(image, polygon, (245, 245, 245))

    input_path = tmp_path / "synthetic_board.jpg"
    assert cv2.imwrite(str(input_path), image)

    preprocessor = HybridBoardPreprocessor(HybridPreprocessorConfig(use_yolo=False))
    result = preprocessor.preprocess(input_path)

    assert result["success"] is True
    assert result["selected_candidate"]["source"] == "opencv"
