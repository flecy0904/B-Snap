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
    "preprocess_board_image",
    "run_hybrid_preprocess",
    "YoloWorldDetector",
]


def __getattr__(name: str):
    if name in {"HybridBoardPreprocessor", "HybridPreprocessorConfig", "run_hybrid_preprocess"}:
        from . import hybrid_preprocessor

        return getattr(hybrid_preprocessor, name)
    if name == "YoloWorldDetector":
        from .yolo_world_detector import YoloWorldDetector

        return YoloWorldDetector
    if name in __all__:
        from . import board_cropper

        return getattr(board_cropper, name)
    raise AttributeError(f"module 'img_preprocessing' has no attribute '{name}'")
