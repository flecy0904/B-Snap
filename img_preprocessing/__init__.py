"""Image preprocessing utilities for B-SNAP."""

__all__ = [
    "BoardCropResult",
    "crop_and_warp_board",
    "crop_writing_region",
    "detect_board_corners",
    "detect_writing_region",
    "HybridBoardPreprocessor",
    "HybridPreprocessorConfig",
    "order_points",
    "preprocess_for_service",
    "preprocess_directory_for_service",
    "preprocess_board_image",
    "run_hybrid_preprocess",
    "YoloWorldDetector",
]


def __getattr__(name: str):
    if name in {"HybridBoardPreprocessor", "HybridPreprocessorConfig", "run_hybrid_preprocess"}:
        from .crop import hybrid_preprocessor

        return getattr(hybrid_preprocessor, name)
    if name == "YoloWorldDetector":
        from .crop.yolo_world_detector import YoloWorldDetector

        return YoloWorldDetector
    if name in {"preprocess_for_service", "preprocess_directory_for_service"}:
        from .pipeline import preprocessing_pipeline

        return getattr(preprocessing_pipeline, name)
    if name in __all__:
        from .crop import board_cropper

        return getattr(board_cropper, name)
    raise AttributeError(f"module 'img_preprocessing' has no attribute '{name}'")
