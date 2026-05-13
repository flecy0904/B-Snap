"""OpenCV scan-style enhancement for already warped board crops."""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray


ImageArray = NDArray[np.uint8]
VALID_IMAGE_TYPES = {"whiteboard", "blackboard", "screen"}


@dataclass(frozen=True)
class ScanEnhanceOptions:
    max_long_side: int = 2000
    min_long_side_for_upscale: int = 1000
    upscale_target_long_side: int = 1400
    jpeg_quality: int = 92
    enable_white_balance: bool = True
    enable_illumination_correction: bool = True
    enable_denoise: bool = True
    enable_sharpen: bool = True
    save_outputs: bool = True
    image_type: str | None = None
    clahe_clip_limit: float = 2.0
    clahe_tile_grid_size: tuple[int, int] = (8, 8)
    denoise_h: float = 4.0
    denoise_h_color: float = 4.0
    sharpen_sigma: float = 1.0
    sharpen_amount: float = 0.5
    illumination_kernel_size: int = 51
    adaptive_block_size: int = 35
    adaptive_c: int = 11
    sauvola_k: float = 0.20
    morph_kernel_size: int = 2


@dataclass
class ScanEnhanceResult:
    enhanced_color: ImageArray
    ocr_bw: ImageArray
    metrics: dict[str, Any]
    enhanced_color_path: str | None = None
    ocr_bw_path: str | None = None
    metrics_path: str | None = None

    def __iter__(self):
        """Allow tuple-unpacking for lightweight interactive testing."""

        yield self.enhanced_color
        yield self.ocr_bw
        yield self.metrics


@dataclass(frozen=True)
class ResizeInfo:
    original_width: int
    original_height: int
    processed_width: int
    processed_height: int
    scale: float
    upscale_applied: bool
    downscale_applied: bool


def preprocess_after_yolo_crop(
    warped_bgr: np.ndarray,
    output_dir: str | Path | None = None,
    basename: str = "board",
    options: ScanEnhanceOptions | dict[str, Any] | None = None,
) -> ScanEnhanceResult:
    """Post-process a YOLO Seg + perspective-corrected BGR image."""

    started_at = time.perf_counter()
    opts = _resolve_options(options)
    original = ensure_uint8_bgr(warped_bgr)
    resized, resize_info = conditional_resize(original, opts)
    image_type = estimate_board_type(resized, opts)

    enhanced_color = _make_enhanced_color(resized, image_type, opts)
    ocr_bw, threshold_method = make_ocr_bw(enhanced_color, image_type, opts)
    processing_ms = (time.perf_counter() - started_at) * 1000.0
    metrics = compute_quality_metrics(
        enhanced_color,
        ocr_bw,
        image_type,
        resize_info,
        processing_ms,
        threshold_method=threshold_method,
        options=opts,
    )

    result = ScanEnhanceResult(
        enhanced_color=enhanced_color,
        ocr_bw=ocr_bw,
        metrics=metrics,
    )
    if output_dir is not None and opts.save_outputs:
        save_preprocess_outputs(result, output_dir, basename, opts)
    return result


def preprocess_image_file(
    image_path: str | Path,
    output_dir: str | Path,
    basename: str | None = None,
    options: ScanEnhanceOptions | dict[str, Any] | None = None,
) -> ScanEnhanceResult:
    """Read an already warped image file and run scan enhancement."""

    path = Path(image_path)
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"Input image could not be decoded by OpenCV: {path}")
    return preprocess_after_yolo_crop(
        image,
        output_dir=output_dir,
        basename=basename or path.stem,
        options=options,
    )


def ensure_uint8_bgr(img: np.ndarray) -> ImageArray:
    if img is None:
        raise ValueError("warped_bgr must not be None.")
    if not isinstance(img, np.ndarray):
        raise ValueError("warped_bgr must be a numpy.ndarray.")
    if img.size == 0:
        raise ValueError("warped_bgr must not be empty.")

    normalized = _to_uint8(img)
    if normalized.ndim == 2:
        return cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)
    if normalized.ndim == 3 and normalized.shape[2] == 1:
        return cv2.cvtColor(normalized[:, :, 0], cv2.COLOR_GRAY2BGR)
    if normalized.ndim == 3 and normalized.shape[2] == 3:
        return normalized
    if normalized.ndim == 3 and normalized.shape[2] == 4:
        return cv2.cvtColor(normalized, cv2.COLOR_BGRA2BGR)
    raise ValueError("warped_bgr must be grayscale, BGR, or BGRA image data.")


def resize_by_long_side(
    img: ImageArray,
    target_long_side: int,
    interpolation: int,
) -> ImageArray:
    height, width = img.shape[:2]
    long_side = max(height, width)
    if long_side <= 0:
        raise ValueError("image has invalid dimensions.")
    scale = target_long_side / float(long_side)
    target_size = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    return cv2.resize(img, target_size, interpolation=interpolation)


def conditional_resize(
    img: ImageArray,
    options: ScanEnhanceOptions,
) -> tuple[ImageArray, ResizeInfo]:
    _validate_resize_options(options)
    original_height, original_width = img.shape[:2]
    long_side = max(original_height, original_width)
    target_long_side = long_side
    interpolation = cv2.INTER_LINEAR
    upscale_applied = False
    downscale_applied = False

    if long_side < options.min_long_side_for_upscale:
        target_long_side = min(options.upscale_target_long_side, options.max_long_side)
        interpolation = cv2.INTER_LANCZOS4
        upscale_applied = target_long_side > long_side
    elif long_side > options.max_long_side:
        target_long_side = options.max_long_side
        interpolation = cv2.INTER_AREA
        downscale_applied = True

    if target_long_side == long_side:
        resized = img.copy()
        scale = 1.0
    else:
        resized = resize_by_long_side(img, target_long_side, interpolation)
        scale = target_long_side / float(long_side)

    processed_height, processed_width = resized.shape[:2]
    resize_info = ResizeInfo(
        original_width=original_width,
        original_height=original_height,
        processed_width=processed_width,
        processed_height=processed_height,
        scale=scale,
        upscale_applied=upscale_applied,
        downscale_applied=downscale_applied,
    )
    return resized, resize_info


def estimate_board_type(img_bgr: ImageArray, options: ScanEnhanceOptions | None = None) -> str:
    opts = options or ScanEnhanceOptions()
    if opts.image_type is not None:
        image_type = opts.image_type.strip().lower()
        if image_type not in VALID_IMAGE_TYPES:
            raise ValueError(f"image_type must be one of {sorted(VALID_IMAGE_TYPES)}.")
        return image_type

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    brightness = float(np.mean(gray))
    median = float(np.median(gray))
    contrast = float(np.std(gray))
    saturation = float(np.mean(hsv[:, :, 1]))
    white_ratio = float(np.mean(gray >= 205))
    black_ratio = float(np.mean(gray <= 55))

    if median < 95 and brightness < 120:
        return "blackboard"
    if black_ratio > 0.25 and brightness < 155:
        return "blackboard"
    if brightness > 150 and saturation < 55:
        return "whiteboard"
    if white_ratio > 0.35 and saturation < 70:
        return "whiteboard"
    if saturation > 55 or (contrast > 48 and white_ratio < 0.45):
        return "screen"
    return "whiteboard"


def compute_quality_metrics(
    img_bgr: ImageArray,
    ocr_bw: ImageArray,
    image_type: str,
    resize_info: ResizeInfo,
    processing_ms: float,
    *,
    threshold_method: str,
    options: ScanEnhanceOptions,
) -> dict[str, Any]:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    black_ratio = float(np.mean(ocr_bw == 0))
    white_ratio = float(np.mean(ocr_bw == 255))
    return {
        "image_type": image_type,
        "original_width": resize_info.original_width,
        "original_height": resize_info.original_height,
        "processed_width": resize_info.processed_width,
        "processed_height": resize_info.processed_height,
        "blur_score": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 4),
        "brightness": round(float(np.mean(gray)), 4),
        "contrast": round(float(np.std(gray)), 4),
        "black_pixel_ratio": round(black_ratio, 6),
        "white_pixel_ratio": round(white_ratio, 6),
        "processing_ms": round(float(processing_ms), 3),
        "upscale_applied": resize_info.upscale_applied,
        "downscale_applied": resize_info.downscale_applied,
        "resize_scale": round(float(resize_info.scale), 6),
        "enhanced_color_format": "jpg",
        "ocr_bw_format": "png",
        "threshold_method": threshold_method,
        "opencv_contrib_ximgproc_available": _has_ximgproc_threshold(),
        "opencv_contrib_xphoto_available": _has_xphoto_grayworld(),
        "jpeg_quality": int(options.jpeg_quality),
        "output_files": {},
        "write_error": None,
    }


def normalize_illumination_gray(gray: ImageArray, ksize: int = 51) -> ImageArray:
    kernel_size = _valid_odd_kernel_size(ksize)
    if min(gray.shape[:2]) <= 2:
        return gray.copy()
    max_kernel = max(3, min(gray.shape[:2]) - 1)
    if max_kernel % 2 == 0:
        max_kernel -= 1
    kernel_size = min(kernel_size, max_kernel)
    background = cv2.medianBlur(gray, kernel_size)
    background = np.maximum(background, 1).astype(np.uint8)
    return cv2.divide(gray, background, scale=255)


def apply_grayworld_white_balance(img_bgr: ImageArray) -> ImageArray:
    if _has_xphoto_grayworld():
        try:
            wb = cv2.xphoto.createGrayworldWB()
            return wb.balanceWhite(img_bgr)
        except Exception:
            pass

    image = img_bgr.astype(np.float32)
    means = np.mean(image.reshape(-1, 3), axis=0)
    gray_mean = float(np.mean(means))
    scales = gray_mean / np.maximum(means, 1.0)
    balanced = image * scales.reshape(1, 1, 3)
    return np.clip(balanced, 0, 255).astype(np.uint8)


def apply_clahe_l_channel(
    img_bgr: ImageArray,
    clip_limit: float = 2.0,
    tile_grid_size: tuple[int, int] = (8, 8),
) -> ImageArray:
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=max(0.1, float(clip_limit)), tileGridSize=tile_grid_size)
    enhanced_l = clahe.apply(l_channel)
    return cv2.cvtColor(cv2.merge((enhanced_l, a_channel, b_channel)), cv2.COLOR_LAB2BGR)


def denoise_color(img_bgr: ImageArray, h: float = 4.0, h_color: float = 4.0) -> ImageArray:
    if h <= 0 and h_color <= 0:
        return img_bgr
    return cv2.fastNlMeansDenoisingColored(img_bgr, None, float(h), float(h_color), 7, 21)


def unsharp_mask(img_bgr: ImageArray, sigma: float = 1.0, amount: float = 0.5) -> ImageArray:
    if amount <= 0:
        return img_bgr
    blurred = cv2.GaussianBlur(img_bgr, (0, 0), max(0.1, float(sigma)))
    return cv2.addWeighted(img_bgr, 1.0 + float(amount), blurred, -float(amount), 0)


def make_ocr_bw(
    enhanced_bgr: ImageArray,
    image_type: str,
    options: ScanEnhanceOptions | None = None,
) -> tuple[ImageArray, str]:
    opts = options or ScanEnhanceOptions()
    gray = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2GRAY)
    if image_type == "whiteboard" and opts.enable_illumination_correction:
        gray = normalize_illumination_gray(gray, opts.illumination_kernel_size)
    if image_type == "blackboard":
        gray = cv2.bitwise_not(gray)

    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    thresholded, method = _threshold_for_ocr(gray, opts)
    if float(np.mean(thresholded == 0)) > 0.60:
        thresholded = cv2.bitwise_not(thresholded)

    cleaned = _morphology_cleanup(thresholded, opts)
    return cleaned, method


def save_preprocess_outputs(
    result: ScanEnhanceResult,
    output_dir: str | Path,
    basename: str,
    options: ScanEnhanceOptions | None = None,
) -> ScanEnhanceResult:
    opts = options or ScanEnhanceOptions()
    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_basename(basename)
    enhanced_color_path = output_root / f"{safe_name}_enhanced_color.jpg"
    ocr_bw_path = output_root / f"{safe_name}_ocr_bw.png"
    metrics_path = output_root / f"{safe_name}_metrics.json"

    write_errors: list[str] = []
    if not cv2.imwrite(
        str(enhanced_color_path),
        result.enhanced_color,
        [int(cv2.IMWRITE_JPEG_QUALITY), int(opts.jpeg_quality)],
    ):
        write_errors.append(f"cv2.imwrite returned False for {enhanced_color_path}")
    if not cv2.imwrite(str(ocr_bw_path), result.ocr_bw):
        write_errors.append(f"cv2.imwrite returned False for {ocr_bw_path}")

    result.enhanced_color_path = str(enhanced_color_path)
    result.ocr_bw_path = str(ocr_bw_path)
    result.metrics_path = str(metrics_path)
    result.metrics["output_files"] = {
        "enhanced_color": result.enhanced_color_path,
        "ocr_bw": result.ocr_bw_path,
        "metrics": result.metrics_path,
    }
    result.metrics["write_error"] = "; ".join(write_errors) if write_errors else None
    metrics_path.write_text(json.dumps(result.metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def _make_enhanced_color(
    img_bgr: ImageArray,
    image_type: str,
    options: ScanEnhanceOptions,
) -> ImageArray:
    enhanced = img_bgr.copy()
    if image_type == "whiteboard" and options.enable_white_balance:
        enhanced = apply_grayworld_white_balance(enhanced)

    if image_type == "whiteboard" and options.enable_illumination_correction:
        enhanced = _normalize_illumination_l_channel(enhanced, options.illumination_kernel_size)

    clip_limit = options.clahe_clip_limit
    if image_type == "screen":
        clip_limit = min(clip_limit, 1.5)
    elif image_type == "blackboard":
        clip_limit = min(max(clip_limit, 1.6), 2.4)
    enhanced = apply_clahe_l_channel(enhanced, clip_limit, options.clahe_tile_grid_size)

    if options.enable_denoise:
        enhanced = denoise_color(enhanced, options.denoise_h, options.denoise_h_color)
    if options.enable_sharpen:
        enhanced = unsharp_mask(enhanced, options.sharpen_sigma, options.sharpen_amount)
    return enhanced


def _normalize_illumination_l_channel(img_bgr: ImageArray, ksize: int) -> ImageArray:
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    normalized_l = normalize_illumination_gray(l_channel, ksize)
    return cv2.cvtColor(cv2.merge((normalized_l, a_channel, b_channel)), cv2.COLOR_LAB2BGR)


def _threshold_for_ocr(gray: ImageArray, options: ScanEnhanceOptions) -> tuple[ImageArray, str]:
    block_size = _valid_adaptive_block_size(options.adaptive_block_size)
    if _has_ximgproc_threshold():
        try:
            method = getattr(cv2.ximgproc, "BINARIZATION_SAUVOLA", None)
            if method is not None:
                return (
                    cv2.ximgproc.niBlackThreshold(
                        gray,
                        255,
                        cv2.THRESH_BINARY,
                        block_size,
                        float(options.sauvola_k),
                        binarizationMethod=method,
                    ),
                    "ximgproc_sauvola",
                )
            return (
                cv2.ximgproc.niBlackThreshold(
                    gray,
                    255,
                    cv2.THRESH_BINARY,
                    block_size,
                    float(options.sauvola_k),
                ),
                "ximgproc_niblack",
            )
        except Exception:
            pass

    return (
        cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            block_size,
            int(options.adaptive_c),
        ),
        "adaptive_gaussian",
    )


def _morphology_cleanup(binary: ImageArray, options: ScanEnhanceOptions) -> ImageArray:
    kernel_size = max(1, int(options.morph_kernel_size))
    if kernel_size <= 1:
        return binary
    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
    foreground = cv2.bitwise_not(binary)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel)
    return cv2.bitwise_not(foreground)


def _resolve_options(options: ScanEnhanceOptions | dict[str, Any] | None) -> ScanEnhanceOptions:
    if options is None:
        return ScanEnhanceOptions()
    if isinstance(options, ScanEnhanceOptions):
        return options
    if not isinstance(options, dict):
        raise TypeError("options must be None, dict, or ScanEnhanceOptions.")

    allowed = {field.name for field in fields(ScanEnhanceOptions)}
    unknown = sorted(set(options) - allowed)
    if unknown:
        raise ValueError(f"Unknown scan enhancement options: {unknown}")
    values = asdict(ScanEnhanceOptions())
    values.update(options)
    if isinstance(values["clahe_tile_grid_size"], list):
        values["clahe_tile_grid_size"] = tuple(values["clahe_tile_grid_size"])
    return ScanEnhanceOptions(**values)


def _to_uint8(img: np.ndarray) -> ImageArray:
    if img.dtype == np.uint8:
        return img.copy()

    source = img.astype(np.float32)
    finite = source[np.isfinite(source)]
    if finite.size == 0:
        raise ValueError("warped_bgr contains no finite numeric values.")
    min_value = float(finite.min())
    max_value = float(finite.max())
    if 0.0 <= min_value and max_value <= 1.0:
        scaled = source * 255.0
    elif 0.0 <= min_value and max_value <= 255.0:
        scaled = source
    elif abs(max_value - min_value) < 1e-6:
        scaled = np.zeros_like(source)
    else:
        scaled = cv2.normalize(source, None, 0, 255, cv2.NORM_MINMAX)
    return np.clip(scaled, 0, 255).astype(np.uint8)


def _validate_resize_options(options: ScanEnhanceOptions) -> None:
    if options.max_long_side <= 0:
        raise ValueError("max_long_side must be positive.")
    if options.min_long_side_for_upscale <= 0:
        raise ValueError("min_long_side_for_upscale must be positive.")
    if options.upscale_target_long_side <= 0:
        raise ValueError("upscale_target_long_side must be positive.")
    if options.upscale_target_long_side < options.min_long_side_for_upscale:
        raise ValueError("upscale_target_long_side must be >= min_long_side_for_upscale.")


def _valid_odd_kernel_size(value: int) -> int:
    kernel_size = max(3, int(value))
    if kernel_size % 2 == 0:
        kernel_size += 1
    return kernel_size


def _valid_adaptive_block_size(value: int) -> int:
    block_size = max(3, int(value))
    if block_size % 2 == 0:
        block_size += 1
    return block_size


def _safe_basename(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value)).strip("._")
    return safe or "board"


def _has_ximgproc_threshold() -> bool:
    ximgproc = getattr(cv2, "ximgproc", None)
    return bool(ximgproc is not None and hasattr(ximgproc, "niBlackThreshold"))


def _has_xphoto_grayworld() -> bool:
    xphoto = getattr(cv2, "xphoto", None)
    return bool(xphoto is not None and hasattr(xphoto, "createGrayworldWB"))


def _parse_cli_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run OpenCV scan enhancement on an already warped image.")
    parser.add_argument("--input", required=True, help="Input warped/cropped image path.")
    parser.add_argument("--output", required=True, help="Output directory.")
    parser.add_argument("--basename", help="Output basename. Defaults to input stem.")
    parser.add_argument("--image-type", choices=sorted(VALID_IMAGE_TYPES), help="Override image type.")
    parser.add_argument("--jpeg-quality", type=int, default=92, help="Enhanced color JPEG quality.")
    return parser.parse_args()


def main() -> int:
    args = _parse_cli_args()
    result = preprocess_image_file(
        args.input,
        args.output,
        basename=args.basename,
        options=ScanEnhanceOptions(
            image_type=args.image_type,
            jpeg_quality=args.jpeg_quality,
        ),
    )
    print(f"enhanced_color: {result.enhanced_color_path}")
    print(f"ocr_bw: {result.ocr_bw_path}")
    print(f"metrics: {result.metrics_path}")
    print(
        json.dumps(
            {
                "image_type": result.metrics["image_type"],
                "blur_score": result.metrics["blur_score"],
                "brightness": result.metrics["brightness"],
                "contrast": result.metrics["contrast"],
                "processing_ms": result.metrics["processing_ms"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
