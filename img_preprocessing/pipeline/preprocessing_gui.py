"""Temporary Tkinter GUI for testing the full preprocessing pipeline."""

from __future__ import annotations

import argparse
import json
import queue
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import tkinter as tk
from PIL import Image, ImageOps, ImageTk
from tkinter import filedialog, messagebox, ttk

from img_preprocessing.crop.yolo_segmentation_cropper import DEFAULT_SEGMENTATION_MODEL, VALID_CROP_MODES
from img_preprocessing.pipeline.preprocessing_pipeline import preprocess_for_service


DEFAULT_OUTPUT_DIR = REPO_ROOT / "outputs" / "pipeline_gui"
IMAGE_FILETYPES = (
    ("Image files", "*.jpg *.jpeg *.png *.bmp *.webp"),
    ("All files", "*.*"),
)
WEIGHT_FILETYPES = (
    ("PyTorch weights", "*.pt"),
    ("All files", "*.*"),
)
RESAMPLE_FILTER = getattr(Image, "Resampling", Image).LANCZOS


@dataclass(frozen=True)
class PipelineJob:
    image_path: Path
    output_dir: Path
    model_name: str
    seg_conf: float
    seg_iou: float
    max_det: int
    seg_imgsz: int
    device: str | None
    mask_margin_ratio: float
    min_mask_area_ratio: float
    crop_mode: str
    save_debug: bool


class ImagePreviewWindow:
    def __init__(self, parent: tk.Tk, title: str, image_path: Path) -> None:
        self.window = tk.Toplevel(parent)
        self.window.title(f"{title} - {image_path.name}")
        self.window.minsize(720, 520)
        self.window.columnconfigure(0, weight=1)
        self.window.rowconfigure(1, weight=1)

        with Image.open(image_path) as opened:
            self.original_image = ImageOps.exif_transpose(opened).convert("RGB")

        self.fit_to_window = tk.BooleanVar(master=self.window, value=True)
        self.photo: ImageTk.PhotoImage | None = None

        toolbar = ttk.Frame(self.window, padding=(8, 8, 8, 4))
        toolbar.grid(row=0, column=0, sticky="ew")
        toolbar.columnconfigure(0, weight=1)

        dimensions = f"{self.original_image.width} x {self.original_image.height}"
        ttk.Label(toolbar, text=f"{title}: {image_path.name}", anchor="w").grid(row=0, column=0, sticky="ew")
        ttk.Label(toolbar, text=dimensions).grid(row=0, column=1, padx=(12, 8))
        ttk.Button(toolbar, text="Fit", command=self._show_fit).grid(row=0, column=2, padx=(0, 4))
        ttk.Button(toolbar, text="100%", command=self._show_actual_size).grid(row=0, column=3)

        body = ttk.Frame(self.window)
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)

        self.canvas = tk.Canvas(body, bg="#111111", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        y_scroll = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll = ttk.Scrollbar(body, orient="horizontal", command=self.canvas.xview)
        x_scroll.grid(row=1, column=0, sticky="ew")
        self.canvas.configure(xscrollcommand=x_scroll.set, yscrollcommand=y_scroll.set)

        self.canvas.bind("<Configure>", self._handle_resize)
        self.window.after_idle(self._redraw)

    def _handle_resize(self, _event: tk.Event) -> None:
        if self.fit_to_window.get():
            self._redraw()

    def _show_fit(self) -> None:
        self.fit_to_window.set(True)
        self._redraw()

    def _show_actual_size(self) -> None:
        self.fit_to_window.set(False)
        self._redraw()

    def _redraw(self) -> None:
        image = self._render_image()
        self.photo = ImageTk.PhotoImage(image)

        canvas_width = max(self.canvas.winfo_width(), 1)
        canvas_height = max(self.canvas.winfo_height(), 1)
        x = max((canvas_width - image.width) // 2, 0)
        y = max((canvas_height - image.height) // 2, 0)

        self.canvas.delete("all")
        self.canvas.create_image(x, y, image=self.photo, anchor="nw")
        self.canvas.configure(
            scrollregion=(
                0,
                0,
                max(canvas_width, x + image.width),
                max(canvas_height, y + image.height),
            )
        )

    def _render_image(self) -> Image.Image:
        if not self.fit_to_window.get():
            return self.original_image

        canvas_width = max(self.canvas.winfo_width() - 12, 1)
        canvas_height = max(self.canvas.winfo_height() - 12, 1)
        scale = min(
            canvas_width / self.original_image.width,
            canvas_height / self.original_image.height,
        )
        target_size = (
            max(int(self.original_image.width * scale), 1),
            max(int(self.original_image.height * scale), 1),
        )
        if target_size == self.original_image.size:
            return self.original_image
        return self.original_image.resize(target_size, RESAMPLE_FILTER)


class PreprocessingGui(ttk.Frame):
    def __init__(self, root: tk.Tk, args: argparse.Namespace) -> None:
        super().__init__(root, padding=12)
        self.root = root
        self.result_queue: queue.Queue[tuple[str, dict[str, Any] | str]] = queue.Queue()
        self.worker: threading.Thread | None = None
        self.photos: dict[str, ImageTk.PhotoImage] = {}
        self.preview_titles: dict[str, str] = {}
        self.preview_paths: dict[str, Path | None] = {
            "original": None,
            "crop": None,
            "mask": None,
            "overlay": None,
            "enhanced_color": None,
            "ocr_bw": None,
        }

        self.image_var = tk.StringVar(value=str(Path(args.image).expanduser()) if args.image else "")
        self.output_dir_var = tk.StringVar(value=str(Path(args.output_dir).expanduser()))
        self.model_var = tk.StringVar(value=str(Path(args.model).expanduser()))
        self.conf_var = tk.StringVar(value=f"{args.conf:.2f}")
        self.iou_var = tk.StringVar(value=f"{args.iou:.2f}")
        self.max_det_var = tk.StringVar(value=str(args.max_det))
        self.imgsz_var = tk.StringVar(value=str(args.imgsz))
        self.device_var = tk.StringVar(value=args.device or "")
        self.mask_margin_var = tk.StringVar(value=f"{args.mask_margin:.3f}")
        self.min_mask_area_var = tk.StringVar(value=f"{args.min_mask_area:.4f}")
        self.crop_mode_var = tk.StringVar(value=args.crop_mode)
        self.debug_var = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="이미지를 선택한 뒤 Run을 누르세요.")

        self._build_ui()
        if self.image_var.get():
            self._set_original(Path(self.image_var.get()).expanduser())
        self._poll_results()

    def _build_ui(self) -> None:
        self.root.title("B-SNAP Pipeline Tester")
        self.root.minsize(1120, 820)
        self.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        inputs = ttk.LabelFrame(self, text="Inputs", padding=10)
        inputs.grid(row=0, column=0, sticky="ew")
        inputs.columnconfigure(1, weight=1)

        self._path_row(inputs, 0, "Image", self.image_var, self._browse_image)
        self._path_row(inputs, 1, "Output dir", self.output_dir_var, self._browse_output_dir)
        self._path_row(inputs, 2, "Model", self.model_var, self._browse_model)

        params = ttk.LabelFrame(self, text="Parameters", padding=10)
        params.grid(row=1, column=0, sticky="ew", pady=(10, 10))
        for column in range(14):
            params.columnconfigure(column, weight=0)
        params.columnconfigure(14, weight=1)

        self._entry(params, 0, 0, "Conf", self.conf_var, 7)
        self._entry(params, 0, 2, "IoU", self.iou_var, 7)
        self._entry(params, 0, 4, "Max det", self.max_det_var, 7)
        self._entry(params, 0, 6, "Image size", self.imgsz_var, 8)
        self._entry(params, 0, 8, "Mask margin", self.mask_margin_var, 8)
        self._entry(params, 0, 10, "Min mask", self.min_mask_area_var, 8)
        self._entry(params, 0, 12, "Device", self.device_var, 8)
        ttk.Checkbutton(params, text="Debug", variable=self.debug_var).grid(row=0, column=14, sticky="w")

        ttk.Label(params, text="Crop mode").grid(row=1, column=0, sticky="w", pady=3)
        ttk.Combobox(
            params,
            textvariable=self.crop_mode_var,
            values=sorted(VALID_CROP_MODES),
            state="readonly",
            width=12,
        ).grid(row=1, column=1, padx=(6, 14), pady=3)
        self.run_button = ttk.Button(params, text="Run pipeline", command=self._start_pipeline)
        self.run_button.grid(row=1, column=14, sticky="e", pady=(8, 0))

        preview = ttk.Frame(self)
        preview.grid(row=2, column=0, sticky="nsew")
        for column in range(3):
            preview.columnconfigure(column, weight=1)
        for row in range(5):
            preview.rowconfigure(row, weight=1 if row in {1, 3, 4} else 0)

        self.canvases: dict[str, tk.Canvas] = {}
        self._preview_panel(preview, "original", "Original", 0, 0)
        self._preview_panel(preview, "crop", "Crop", 0, 1)
        self._preview_panel(preview, "mask", "Mask", 0, 2)
        self._preview_panel(preview, "overlay", "Debug Overlay", 2, 0)
        self._preview_panel(preview, "enhanced_color", "Enhanced Color", 2, 1)
        self._preview_panel(preview, "ocr_bw", "OCR BW", 2, 2)

        details_frame = ttk.LabelFrame(preview, text="Result", padding=6)
        details_frame.grid(row=4, column=0, columnspan=3, sticky="nsew")
        details_frame.columnconfigure(0, weight=1)
        details_frame.rowconfigure(0, weight=1)
        self.details_text = tk.Text(details_frame, height=12, wrap="word")
        self.details_text.grid(row=0, column=0, sticky="nsew")
        details_scroll = ttk.Scrollbar(details_frame, command=self.details_text.yview)
        details_scroll.grid(row=0, column=1, sticky="ns")
        self.details_text.configure(yscrollcommand=details_scroll.set, state="disabled")

        ttk.Label(self, textvariable=self.status_var, anchor="w").grid(row=3, column=0, sticky="ew", pady=(10, 0))

    def _path_row(
        self,
        parent: ttk.Frame,
        row: int,
        label: str,
        variable: tk.StringVar,
        command: Any,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", padx=8, pady=3)
        ttk.Button(parent, text="Browse", command=command).grid(row=row, column=2, sticky="e", pady=3)

    def _entry(
        self,
        parent: ttk.Frame,
        row: int,
        column: int,
        label: str,
        variable: tk.StringVar,
        width: int,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=variable, width=width).grid(row=row, column=column + 1, padx=(6, 14), pady=3)

    def _preview_panel(
        self,
        parent: ttk.Frame,
        key: str,
        title: str,
        row: int,
        column: int,
    ) -> None:
        ttk.Label(parent, text=title).grid(row=row, column=column, sticky="w", padx=(0 if column == 0 else 8, 0))
        canvas = tk.Canvas(parent, bg="#111111", highlightthickness=0)
        canvas.grid(row=row + 1, column=column, sticky="nsew", padx=(0 if column == 0 else 8, 0), pady=(4, 8))
        canvas.configure(cursor="hand2")
        canvas.bind("<Configure>", lambda _event, panel_key=key: self._draw_panel(panel_key))
        canvas.bind("<Button-1>", lambda _event, panel_key=key: self._open_preview_window(panel_key))
        self.preview_titles[key] = title
        self.canvases[key] = canvas

    def _browse_image(self) -> None:
        path = filedialog.askopenfilename(
            title="Select input image",
            initialdir=str(REPO_ROOT / "sample_images"),
            filetypes=IMAGE_FILETYPES,
        )
        if path:
            self.image_var.set(path)
            self._set_original(Path(path))

    def _browse_output_dir(self) -> None:
        path = filedialog.askdirectory(
            title="Select output directory",
            initialdir=str(Path(self.output_dir_var.get()).expanduser()),
        )
        if path:
            self.output_dir_var.set(path)

    def _browse_model(self) -> None:
        path = filedialog.askopenfilename(
            title="Select YOLO segmentation weights",
            initialdir=str(Path(self.model_var.get()).expanduser().parent),
            filetypes=WEIGHT_FILETYPES,
        )
        if path:
            self.model_var.set(path)

    def _set_original(self, path: Path) -> None:
        self.preview_paths = {
            "original": path,
            "crop": None,
            "mask": None,
            "overlay": None,
            "enhanced_color": None,
            "ocr_bw": None,
        }
        self._set_details("")
        self._draw_all()

    def _collect_job(self) -> PipelineJob:
        image_path = Path(self.image_var.get()).expanduser()
        output_dir = Path(self.output_dir_var.get()).expanduser()
        model_name = str(Path(self.model_var.get()).expanduser())
        device = self.device_var.get().strip() or None

        job = PipelineJob(
            image_path=image_path,
            output_dir=output_dir,
            model_name=model_name,
            seg_conf=float(self.conf_var.get()),
            seg_iou=float(self.iou_var.get()),
            max_det=int(self.max_det_var.get()),
            seg_imgsz=int(self.imgsz_var.get()),
            device=device,
            mask_margin_ratio=float(self.mask_margin_var.get()),
            min_mask_area_ratio=float(self.min_mask_area_var.get()),
            crop_mode=self.crop_mode_var.get(),
            save_debug=self.debug_var.get(),
        )
        self._validate_job(job)
        return job

    def _validate_job(self, job: PipelineJob) -> None:
        if not job.image_path.exists():
            raise ValueError(f"이미지 파일이 없습니다: {job.image_path}")
        if not job.image_path.is_file():
            raise ValueError(f"이미지 경로가 파일이 아닙니다: {job.image_path}")
        if not Path(job.model_name).exists():
            raise ValueError(f"모델 파일이 없습니다: {job.model_name}")
        if not 0.0 <= job.seg_conf <= 1.0:
            raise ValueError("Conf는 0과 1 사이여야 합니다.")
        if not 0.0 <= job.seg_iou <= 1.0:
            raise ValueError("IoU는 0과 1 사이여야 합니다.")
        if job.max_det <= 0:
            raise ValueError("Max det는 1 이상이어야 합니다.")
        if job.seg_imgsz <= 0:
            raise ValueError("Image size는 1 이상이어야 합니다.")
        if job.mask_margin_ratio < 0:
            raise ValueError("Mask margin은 0 이상이어야 합니다.")
        if job.min_mask_area_ratio < 0:
            raise ValueError("Min mask는 0 이상이어야 합니다.")
        if job.crop_mode not in VALID_CROP_MODES:
            raise ValueError("Crop mode는 bbox 또는 perspective여야 합니다.")

    def _start_pipeline(self) -> None:
        if self.worker is not None and self.worker.is_alive():
            return

        try:
            job = self._collect_job()
        except Exception as exc:
            messagebox.showerror("입력 오류", str(exc))
            return

        self._set_original(job.image_path)
        self.run_button.configure(state="disabled")
        self.status_var.set("전처리 실행 중입니다...")
        self.worker = threading.Thread(target=self._worker_run, args=(job,), daemon=True)
        self.worker.start()

    def _worker_run(self, job: PipelineJob) -> None:
        try:
            result = preprocess_for_service(
                job.image_path,
                job.output_dir,
                model_name=job.model_name,
                seg_conf=job.seg_conf,
                seg_iou=job.seg_iou,
                max_det=job.max_det,
                seg_imgsz=job.seg_imgsz,
                device=job.device,
                mask_margin_ratio=job.mask_margin_ratio,
                min_mask_area_ratio=job.min_mask_area_ratio,
                crop_mode=job.crop_mode,
                save_mask=True,
                retina_masks=True,
                save_debug=job.save_debug,
            )
            self.result_queue.put(("ok", result))
        except Exception as exc:
            self.result_queue.put(("error", str(exc)))

    def _poll_results(self) -> None:
        try:
            status, payload = self.result_queue.get_nowait()
        except queue.Empty:
            self.root.after(100, self._poll_results)
            return

        self.run_button.configure(state="normal")
        if status == "ok" and isinstance(payload, dict):
            self._show_result(payload)
        else:
            messagebox.showerror("실행 실패", str(payload))
            self.status_var.set("전처리에 실패했습니다.")

        self.root.after(100, self._poll_results)

    def _show_result(self, result: dict[str, Any]) -> None:
        crop = result.get("crop") if isinstance(result.get("crop"), dict) else {}
        debug_paths = crop.get("debug_paths") if isinstance(crop.get("debug_paths"), dict) else {}
        artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
        scan_enhance = result.get("scan_enhance") if isinstance(result.get("scan_enhance"), dict) else {}

        self.preview_paths.update(
            {
                "crop": _optional_path(result.get("crop_output_path")),
                "mask": _optional_path(artifacts.get("mask_path") or crop.get("mask_path")),
                "overlay": _optional_path(debug_paths.get("02_segmentation_overlay.jpg")),
                "enhanced_color": _optional_path(scan_enhance.get("enhanced_color_path")),
                "ocr_bw": _optional_path(scan_enhance.get("ocr_bw_path")),
            }
        )
        self._draw_all()

        selected = crop.get("selected_candidate") if isinstance(crop, dict) else None
        details = {
            "success": result.get("success"),
            "message": result.get("message"),
            "failure_stage": result.get("failure_stage"),
            "output_dir": result.get("output_dir"),
            "crop_output_path": result.get("crop_output_path"),
            "mask_path": artifacts.get("mask_path") if isinstance(artifacts, dict) else None,
            "view_path": result.get("view_path"),
            "llm_image_path": result.get("llm_image_path"),
            "llm_image_type": result.get("llm_image_type"),
            "summary_path": result.get("summary_path"),
            "scan_enhance": scan_enhance,
            "selected_candidate": selected,
        }
        self._set_details(json.dumps(details, ensure_ascii=False, indent=2))

        if result.get("success"):
            scan_metrics = scan_enhance.get("metrics") if isinstance(scan_enhance.get("metrics"), dict) else {}
            image_type = scan_metrics.get("image_type")
            suffix = f" | scan={image_type}" if image_type else ""
            self.status_var.set(f"완료: {result.get('llm_image_path')}{suffix}")
        else:
            self.status_var.set(f"실패: {result.get('message')}")

    def _set_details(self, text: str) -> None:
        self.details_text.configure(state="normal")
        self.details_text.delete("1.0", tk.END)
        self.details_text.insert("1.0", text)
        self.details_text.configure(state="disabled")

    def _draw_all(self) -> None:
        for key in self.canvases:
            self._draw_panel(key)

    def _open_preview_window(self, key: str) -> None:
        path = self.preview_paths.get(key)
        if path is None or not path.exists():
            self.status_var.set("확대해서 볼 이미지가 없습니다.")
            return

        try:
            ImagePreviewWindow(self.root, self.preview_titles.get(key, key), path)
        except Exception as exc:
            messagebox.showerror("이미지 열기 실패", str(exc))

    def _draw_panel(self, key: str) -> None:
        canvas = self.canvases[key]
        canvas.delete("all")
        width = max(canvas.winfo_width(), 260)
        height = max(canvas.winfo_height(), 180)
        path = self.preview_paths.get(key)

        if path is None or not path.exists():
            canvas.create_text(width // 2, height // 2, text="No image", fill="#dddddd")
            return

        try:
            image = Image.open(path)
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((max(width - 20, 1), max(height - 20, 1)), RESAMPLE_FILTER)
            photo = ImageTk.PhotoImage(image)
        except Exception as exc:
            canvas.create_text(width // 2, height // 2, text=f"Load failed\n{exc}", fill="#dddddd")
            return

        self.photos[key] = photo
        canvas.create_image(width // 2, height // 2, image=photo, anchor="center")


def _optional_path(value: Any) -> Path | None:
    if not value:
        return None
    path = Path(str(value))
    return path if path.exists() else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open a temporary GUI for testing the B-SNAP preprocessing pipeline.")
    parser.add_argument("--image", default="", help="Optional image path to load on startup.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for GUI test outputs.")
    parser.add_argument("--model", default=DEFAULT_SEGMENTATION_MODEL, help="YOLO segmentation .pt path.")
    parser.add_argument("--conf", type=float, default=0.25, help="Segmentation confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.7, help="YOLO NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=5, help="Maximum segmentation detections to keep.")
    parser.add_argument("--imgsz", type=int, default=640, help="YOLO inference image size.")
    parser.add_argument("--device", default="", help="Optional YOLO device, e.g. cpu, mps, cuda:0.")
    parser.add_argument("--mask-margin", type=float, default=0.02, help="Crop margin ratio around selected mask.")
    parser.add_argument("--min-mask-area", type=float, default=0.0005, help="Minimum mask area ratio.")
    parser.add_argument(
        "--crop-mode",
        choices=sorted(VALID_CROP_MODES),
        default="perspective",
        help="Crop strategy. perspective uses mask contour warping and falls back to bbox.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = tk.Tk()
    PreprocessingGui(root, args)
    root.mainloop()


if __name__ == "__main__":
    main()
