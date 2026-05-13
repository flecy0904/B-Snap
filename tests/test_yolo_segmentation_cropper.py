from pathlib import Path

import cv2
import numpy as np

import img_preprocessing.crop.yolo_segmentation_cropper as seg_module
from img_preprocessing.crop.yolo_segmentation_cropper import (
    YoloSegmentationCropper,
    SegmentationCropConfig,
    run_yolo_segmentation_preprocess,
)


class FakeMasks:
    def __init__(self, data: np.ndarray | None) -> None:
        self.data = data


class FakeBoxes:
    def __init__(
        self,
        *,
        xyxy: np.ndarray,
        conf: np.ndarray,
        cls: np.ndarray,
    ) -> None:
        self.xyxy = xyxy
        self.conf = conf
        self.cls = cls

    def __len__(self) -> int:
        return len(self.conf)


class FakeResult:
    def __init__(self, masks: FakeMasks, boxes: FakeBoxes | None = None) -> None:
        self.masks = masks
        self.boxes = boxes
        self.names = {0: "target_area"}
        self.orig_shape = (100, 120)


class FakeModel:
    def __init__(self, result: FakeResult) -> None:
        self.result = result
        self.last_kwargs = None

    def predict(self, **kwargs):
        self.last_kwargs = kwargs
        return [self.result]


def _input_image() -> np.ndarray:
    image = np.full((100, 120, 3), 40, dtype=np.uint8)
    cv2.rectangle(image, (30, 20), (89, 79), (230, 230, 230), -1)
    return image


def _fake_model_with_mask() -> FakeModel:
    mask = np.zeros((1, 100, 120), dtype=np.float32)
    mask[0, 20:80, 30:90] = 1.0
    boxes = FakeBoxes(
        xyxy=np.array([[30.0, 20.0, 90.0, 80.0]], dtype=np.float32),
        conf=np.array([0.92], dtype=np.float32),
        cls=np.array([0], dtype=np.float32),
    )
    return FakeModel(FakeResult(FakeMasks(mask), boxes))


def _fake_model_with_trapezoid_mask() -> FakeModel:
    mask = np.zeros((1, 100, 120), dtype=np.float32)
    points = np.array([[30, 20], [90, 15], [100, 80], [20, 85]], dtype=np.int32)
    cv2.fillConvexPoly(mask[0], points, 1.0)
    boxes = FakeBoxes(
        xyxy=np.array([[20.0, 15.0, 100.0, 85.0]], dtype=np.float32),
        conf=np.array([0.94], dtype=np.float32),
        cls=np.array([0], dtype=np.float32),
    )
    return FakeModel(FakeResult(FakeMasks(mask), boxes))


def _fake_model_with_tiny_mask() -> FakeModel:
    mask = np.zeros((1, 100, 120), dtype=np.float32)
    mask[0, 50, 60] = 1.0
    boxes = FakeBoxes(
        xyxy=np.array([[60.0, 50.0, 61.0, 51.0]], dtype=np.float32),
        conf=np.array([0.9], dtype=np.float32),
        cls=np.array([0], dtype=np.float32),
    )
    return FakeModel(FakeResult(FakeMasks(mask), boxes))


def test_yolo_segmentation_cropper_saves_crop_and_mask(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_path = tmp_path / "crop.jpg"
    assert cv2.imwrite(str(input_path), _input_image())

    model = _fake_model_with_mask()
    result = run_yolo_segmentation_preprocess(
        input_path,
        output_path=output_path,
        model=model,
        mask_margin_ratio=0.0,
        seg_conf=0.33,
        seg_iou=0.66,
        seg_imgsz=320,
    )

    assert result["success"] is True
    assert result["selected_candidate"]["source"] == "yolo_segmentation"
    assert result["selected_candidate"]["crop_mode"] == "perspective"
    assert result["selected_candidate"]["fallback"] is None
    assert len(result["selected_candidate"]["corners"]) == 4
    assert result["selected_candidate"]["crop_box"] == {
        "x": 30,
        "y": 20,
        "width": 60,
        "height": 60,
    }
    assert result["output_path"] == str(output_path)
    assert Path(result["mask_path"]).exists()
    assert output_path.exists()
    assert model.last_kwargs["conf"] == 0.33
    assert model.last_kwargs["iou"] == 0.66
    assert model.last_kwargs["imgsz"] == 320


def test_yolo_segmentation_cropper_can_use_bbox_crop_mode(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_path = tmp_path / "crop.jpg"
    assert cv2.imwrite(str(input_path), _input_image())

    result = run_yolo_segmentation_preprocess(
        input_path,
        output_path=output_path,
        model=_fake_model_with_mask(),
        mask_margin_ratio=0.0,
        crop_mode="bbox",
    )

    assert result["success"] is True
    assert result["selected_candidate"]["crop_mode"] == "bbox"
    assert result["selected_candidate"]["fallback"] is None
    assert result["selected_size"] == {"width": 60, "height": 60}


def test_yolo_segmentation_cropper_perspective_warps_trapezoid_mask(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_path = tmp_path / "crop.jpg"
    assert cv2.imwrite(str(input_path), _input_image())

    result = run_yolo_segmentation_preprocess(
        input_path,
        output_path=output_path,
        model=_fake_model_with_trapezoid_mask(),
        mask_margin_ratio=0.0,
        crop_mode="perspective",
    )

    assert result["success"] is True
    assert result["selected_candidate"]["crop_mode"] == "perspective"
    assert result["selected_candidate"]["fallback"] is None
    assert len(result["selected_candidate"]["corners"]) == 4
    assert result["selected_size"]["width"] > 50
    assert result["selected_size"]["height"] > 50


def test_yolo_segmentation_cropper_falls_back_to_bbox_when_quad_fails(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_path = tmp_path / "crop.jpg"
    assert cv2.imwrite(str(input_path), _input_image())

    result = run_yolo_segmentation_preprocess(
        input_path,
        output_path=output_path,
        model=_fake_model_with_tiny_mask(),
        min_mask_area_ratio=0.0,
        crop_mode="perspective",
    )

    assert result["success"] is True
    assert result["selected_candidate"]["crop_mode"] == "bbox"
    assert result["selected_candidate"]["fallback"] == "perspective_quad_not_found"


def test_yolo_segmentation_cropper_reports_missing_mask(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    assert cv2.imwrite(str(input_path), _input_image())
    model = FakeModel(FakeResult(FakeMasks(None), None))

    result = run_yolo_segmentation_preprocess(input_path, model=model)

    assert result["success"] is False
    assert result["selected_candidate"] is None
    assert "No target area segmentation mask" in result["message"]


def test_yolo_segmentation_cropper_debug_outputs(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    output_path = tmp_path / "crop.jpg"
    debug_dir = tmp_path / "debug"
    assert cv2.imwrite(str(input_path), _input_image())

    result = run_yolo_segmentation_preprocess(
        input_path,
        output_path=output_path,
        debug_dir=debug_dir,
        model=_fake_model_with_mask(),
        mask_margin_ratio=0.0,
    )

    assert result["success"] is True
    assert Path(result["debug_paths"]["00_original.jpg"]).exists()
    assert Path(result["debug_paths"]["01_selected_mask.png"]).exists()
    assert Path(result["debug_paths"]["02_segmentation_overlay.jpg"]).exists()
    assert Path(result["debug_paths"]["segmentation_summary.json"]).exists()


def test_yolo_segmentation_cropper_write_failure(tmp_path: Path, monkeypatch) -> None:
    input_path = tmp_path / "raw.jpg"
    output_path = tmp_path / "crop.jpg"
    assert cv2.imwrite(str(input_path), _input_image())

    monkeypatch.setattr(seg_module.cv2, "imwrite", lambda *args, **kwargs: False)

    result = run_yolo_segmentation_preprocess(
        input_path,
        output_path=output_path,
        model=_fake_model_with_mask(),
    )

    assert result["success"] is False
    assert result["output_path"] is None
    assert "cv2.imwrite returned False" in result["write_error"]


def test_reusable_yolo_segmentation_cropper(tmp_path: Path) -> None:
    input_path = tmp_path / "raw.jpg"
    assert cv2.imwrite(str(input_path), _input_image())

    cropper = YoloSegmentationCropper(
        SegmentationCropConfig(mask_margin_ratio=0.0, crop_mode="bbox"),
        model=_fake_model_with_mask(),
    )
    result = cropper.preprocess(input_path)

    assert result["success"] is True
    assert result["selected_candidate"]["crop_box"]["width"] == 60
