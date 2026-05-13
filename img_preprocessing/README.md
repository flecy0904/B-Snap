# B-SNAP 이미지 전처리 모듈

## 결론

현재 전처리 파이프라인은 **YOLO segmentation crop + scan enhancement** 구조입니다.

YOLO crop이 성공하면 OpenCV 기반 `enhance/scan_enhancer.py`가 항상 실행되고, 최종 LLM 입력 이미지는 `enhanced_color` 결과입니다.

```python
from img_preprocessing.pipeline import preprocess_for_service
```

```text
raw image
-> YOLO segmentation
-> mask contour perspective crop
-> scan enhancement
-> LLM-ready enhanced color image
```

기본 crop 방식은 `perspective`입니다. mask contour에서 안정적인 4점을 찾지 못하면 자동으로 `bbox` crop으로 fallback합니다.

## 파일 구성

```text
img_preprocessing/
├─ __init__.py
├─ crop/
│  ├─ __init__.py
│  ├─ best.pt
│  └─ yolo_segmentation_cropper.py
├─ enhance/
│  ├─ __init__.py
│  └─ scan_enhancer.py
├─ pipeline/
│  ├─ __init__.py
│  ├─ preprocessing_pipeline.py
│  ├─ preprocessing_experiment.py
│  └─ preprocessing_gui.py
```

## 서비스 파이프라인 실행

```bash
.venv/bin/python -m img_preprocessing.pipeline.preprocessing_experiment \
  --input "sample_images/IMG_7052.jpeg" \
  --output-dir "outputs/service_preprocess_demo" \
  --debug
```

주요 옵션:

```text
--model
--conf
--iou
--max-det
--imgsz
--device
--mask-margin
--min-mask-area
--crop-mode
--no-save-mask
--no-retina-masks
--debug
```

## GUI 테스트

```bash
.venv/bin/python img_preprocessing/pipeline/preprocessing_gui.py
```

GUI에서는 입력 이미지를 선택한 뒤 crop 결과, mask, debug overlay, `Enhanced Color`, `OCR BW`를 한 화면에서 확인할 수 있습니다.

각 이미지 패널을 클릭하면 확대 창에서 볼 수 있습니다.

## Crop 단독 실행

```bash
.venv/bin/python -m img_preprocessing.crop.yolo_segmentation_cropper \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/seg_crop/IMG_7052_crop.jpg" \
  --debug-dir "outputs/seg_crop/IMG_7052_debug"
```

기본 crop 설정:

```text
model=img_preprocessing/crop/best.pt
conf=0.25
iou=0.7
max_det=5
imgsz=640
mask_margin=0.02
crop_mode=perspective
retina_masks=on
```

`--crop-mode bbox`를 지정하면 원근보정 없이 mask를 감싸는 사각형만 crop합니다.

## Python API

한 장만 처리할 때:

```python
from img_preprocessing.crop.yolo_segmentation_cropper import run_yolo_segmentation_preprocess

result = run_yolo_segmentation_preprocess(
    "sample_images/IMG_7052.jpeg",
    output_path="outputs/seg_crop/IMG_7052_crop.jpg",
    debug_dir="outputs/seg_crop/IMG_7052_debug",
)
```

여러 장을 처리하면서 모델을 재사용할 때:

```python
from img_preprocessing.crop.yolo_segmentation_cropper import (
    SegmentationCropConfig,
    YoloSegmentationCropper,
)

cropper = YoloSegmentationCropper(SegmentationCropConfig())

result = cropper.preprocess(
    "sample_images/IMG_7052.jpeg",
    output_path="outputs/seg_crop/IMG_7052_crop.jpg",
)
```

서비스용 파이프라인:

```python
from img_preprocessing.pipeline import preprocess_for_service

result = preprocess_for_service(
    "sample_images/IMG_7052.jpeg",
    "outputs/service_preprocess_demo",
)
```

## Scan Enhancement 단독 실행

이미 원근 보정된 BGR 이미지가 있을 때 아래처럼 호출합니다.

```python
import cv2

from img_preprocessing.enhance import preprocess_after_yolo_crop

warped_bgr = cv2.imread("outputs/seg_crop/IMG_7052_crop.jpg")

result = preprocess_after_yolo_crop(
    warped_bgr,
    output_dir="outputs/scan_enhance_demo",
    basename="IMG_7052",
)

enhanced_color = result.enhanced_color
ocr_bw = result.ocr_bw
metrics = result.metrics
```

`output_dir`를 지정하면 아래 파일이 저장됩니다.

```text
IMG_7052_enhanced_color.jpg
IMG_7052_ocr_bw.png
IMG_7052_metrics.json
```

경로 기반 실행도 가능합니다.

```python
from img_preprocessing.enhance import preprocess_image_file

result = preprocess_image_file(
    "outputs/seg_crop/IMG_7052_crop.jpg",
    "outputs/scan_enhance_demo",
)
```

수동 테스트 스크립트:

```bash
.venv/bin/python scripts/run_scan_enhance.py \
  --input "outputs/seg_crop/IMG_7052_crop.jpg" \
  --output "outputs/scan_enhance_demo"
```

## 출력 구조

서비스 파이프라인은 입력 파일마다 별도 작업 디렉터리를 만듭니다.

```text
outputs/service_preprocess_demo/<output_id>/
├─ <output_id>_summary.json
├─ crop/
│  ├─ <output_id>_crop.jpg
│  └─ <output_id>_crop_mask.png
├─ scan_enhance/
│  ├─ <output_id>_crop_enhanced_color.jpg
│  ├─ <output_id>_crop_ocr_bw.png
│  └─ <output_id>_crop_metrics.json
└─ debug/
   ├─ 00_original.jpg
   ├─ 01_selected_mask.png
   ├─ 02_segmentation_overlay.jpg
   ├─ 99_selected_crop.jpg
   └─ segmentation_summary.json
```

`debug/`는 `--debug` 또는 `save_debug=True`일 때만 생성됩니다.

## 주요 결과 필드

```text
success
failure_stage
input_path
output_dir
crop_output_path
view_path
llm_image_path
llm_image_type
summary_path
write_error
crop.selected_candidate
crop.selected_candidate.crop_mode
crop.selected_candidate.corners
crop.selected_candidate.fallback
crop.mask_path
artifacts.crop_path
artifacts.mask_path
artifacts.view_path
artifacts.enhanced_color_path
artifacts.ocr_bw_path
artifacts.scan_metrics_path
artifacts.pipeline_summary_path
scan_enhance.metrics
```

현재 `view_path`와 `llm_image_path`는 모두 `enhanced_color` 결과 파일을 가리킵니다.

```text
llm_image_type=enhanced_color
```

## 모듈 역할

### `crop/yolo_segmentation_cropper.py`

YOLO segmentation으로 `target_area` mask를 찾고, 선택된 mask의 contour에서 4점을 추정해 원근보정 crop을 만듭니다.

원근보정이 실패하면 자동으로 mask bounding box crop으로 fallback합니다.

주요 API:

```python
run_yolo_segmentation_preprocess(...)
YoloSegmentationCropper
SegmentationCropConfig
```

### `pipeline/preprocessing_pipeline.py`

서비스용 orchestration 레이어입니다.

담당 역할:

1. 출력 디렉터리 구성
2. segmentation crop 실행
3. scan enhancement 실행
4. 전체 summary JSON 저장
5. LLM 입력 경로를 enhanced color 결과로 지정

### `enhance/scan_enhancer.py`

이미 원근 보정된 crop 이미지를 입력으로 받아 scan-style 후처리를 수행합니다.

담당 역할:

1. 조건부 resize
2. `whiteboard` / `blackboard` / `screen` 타입 추정
3. 조명 보정, CLAHE, 약한 denoise, 약한 sharpen
4. OCR용 adaptive threshold 이미지 생성
5. 처리 metrics 생성

주요 API:

```python
ScanEnhanceOptions
ScanEnhanceResult
preprocess_after_yolo_crop(...)
preprocess_image_file(...)
```

## 테스트 실행

```bash
.venv/bin/python -m pytest \
  tests/test_scan_enhancer.py \
  tests/test_preprocessing_pipeline.py \
  tests/test_yolo_segmentation_cropper.py \
  -q
```

현재 테스트는 다음을 확인합니다.

1. YOLO segmentation mask 기반 crop 생성
2. contour 기반 perspective crop 생성
3. perspective 실패 시 bbox fallback
4. mask 없는 경우 실패 처리
5. crop/mask/debug artifact 저장
6. 서비스용 raw→crop→enhanced color 파이프라인
7. scan enhancement 단독 후처리 결과 생성

## 의존성

전처리 의존성은 프로젝트 루트의 `requirements.txt`에서 관리합니다.

```text
numpy
opencv-python-headless
pytest
ultralytics
```

`opencv-contrib-python`은 필수가 아닙니다. `cv2.xphoto`, `cv2.ximgproc`가 없으면 gray-world white balance와 OCR threshold는 기본 OpenCV 구현으로 fallback됩니다.

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

## 주의사항

1. `HEIC`처럼 OpenCV가 바로 읽지 못하는 포맷은 실패할 수 있습니다.
2. 현재 crop 모델은 `target_area` 세그멘테이션 학습 분포 밖의 이미지에서 항상 정답을 보장하지 않습니다.
3. `img_preprocessing/crop/best.pt`가 없으면 기본 설정으로는 crop이 실패합니다.
4. `outputs/`는 검증 산출물 저장 위치이며 `.gitignore` 대상입니다.

## 요약

서비스 전처리는 이제 YOLO segmentation crop 이후 scan enhancement를 항상 수행합니다.

`best.pt`로 `target_area` mask를 찾고, mask contour 기반 원근보정 crop을 만든 뒤 `enhanced_color` 이미지를 LLM 입력 이미지로 사용합니다.
