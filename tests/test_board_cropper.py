import cv2
import numpy as np
import pytest

from img_preprocessing.board_cropper import crop_and_warp_board, crop_writing_region, detect_board_corners, order_points


def _synthetic_board_image() -> tuple[np.ndarray, np.ndarray]:
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    points = np.array(
        [
            [95, 90],
            [545, 65],
            [575, 365],
            [70, 390],
        ],
        dtype=np.int32,
    )
    cv2.fillConvexPoly(image, points, (245, 245, 245))
    cv2.polylines(image, [points.reshape(-1, 1, 2)], isClosed=True, color=(255, 255, 255), thickness=4)
    return image, points.astype(np.float32)


def test_order_points_returns_tl_tr_br_bl() -> None:
    unordered = np.array(
        [
            [500, 400],
            [100, 100],
            [120, 420],
            [520, 90],
        ],
        dtype=np.float32,
    )

    ordered = order_points(unordered)

    assert ordered.shape == (4, 2)
    assert ordered[0].tolist() == pytest.approx([100, 100])
    assert ordered[1].tolist() == pytest.approx([520, 90])
    assert ordered[2].tolist() == pytest.approx([500, 400])
    assert ordered[3].tolist() == pytest.approx([120, 420])


def test_invalid_image_returns_failure() -> None:
    result = detect_board_corners(None)

    assert result.success is False
    assert result.confidence == 0.0
    assert "None" in result.message


def test_synthetic_rectangle_detection() -> None:
    image, _ = _synthetic_board_image()

    result = detect_board_corners(image)

    assert result.success is True
    assert len(result.corners) == 4
    assert result.confidence > 0.4
    assert result.original_size == {"width": 640, "height": 480}


def test_crop_and_warp_output_shape() -> None:
    image, _ = _synthetic_board_image()

    result = crop_and_warp_board(image, mode="board")

    assert result.success is True
    assert result.warped_image is not None
    assert result.warped_size is not None
    assert result.warped_image.shape[1] == result.warped_size["width"]
    assert result.warped_image.shape[0] == result.warped_size["height"]
    assert result.warped_size["width"] > result.warped_size["height"]


def test_writing_mode_crops_text_region() -> None:
    image = np.full((480, 640, 3), (35, 70, 60), dtype=np.uint8)
    cv2.putText(image, "sigma < 6.2", (80, 150), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (235, 235, 235), 2)
    cv2.putText(image, "chi square", (80, 230), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (235, 235, 235), 2)
    cv2.line(image, (360, 260), (560, 260), (235, 235, 235), 2)
    cv2.rectangle(image, (0, 360), (640, 480), (20, 20, 20), -1)

    result = crop_writing_region(image)

    assert result.success is True
    assert result.mode_used == "writing"
    assert result.crop_box is not None
    assert result.warped_image is not None
    assert result.warped_size is not None
    assert result.warped_size["height"] < 480
