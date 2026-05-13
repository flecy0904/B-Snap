"""Image preprocessing utilities for B-SNAP."""

__all__ = [
    "preprocess_for_service",
    "preprocess_directory_for_service",
    "run_yolo_segmentation_preprocess",
    "SegmentationCropConfig",
    "YoloSegmentationCropper",
    "ScanEnhanceOptions",
    "ScanEnhanceResult",
    "preprocess_after_yolo_crop",
    "preprocess_image_file",
]


def __getattr__(name: str):
    if name in {
        "run_yolo_segmentation_preprocess",
        "SegmentationCropConfig",
        "YoloSegmentationCropper",
    }:
        from .crop import yolo_segmentation_cropper

        return getattr(yolo_segmentation_cropper, name)
    if name in {"preprocess_for_service", "preprocess_directory_for_service"}:
        from .pipeline import preprocessing_pipeline

        return getattr(preprocessing_pipeline, name)
    if name in {
        "ScanEnhanceOptions",
        "ScanEnhanceResult",
        "preprocess_after_yolo_crop",
        "preprocess_image_file",
    }:
        from .enhance import scan_enhancer

        return getattr(scan_enhancer, name)
    raise AttributeError(f"module 'img_preprocessing' has no attribute '{name}'")
