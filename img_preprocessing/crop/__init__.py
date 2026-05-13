"""Crop-focused preprocessing modules for B-SNAP."""

__all__ = [
    "run_yolo_segmentation_preprocess",
    "SegmentationCropConfig",
    "YoloSegmentationCropper",
]


def __getattr__(name: str):
    if name in {
        "run_yolo_segmentation_preprocess",
        "SegmentationCropConfig",
        "YoloSegmentationCropper",
    }:
        from . import yolo_segmentation_cropper

        return getattr(yolo_segmentation_cropper, name)
    raise AttributeError(f"module 'img_preprocessing.crop' has no attribute '{name}'")
