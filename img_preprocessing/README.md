# B-SNAP 이미지 전처리 모듈

## 결론

현재 전처리의 **최종 진입점**은 `crop/hybrid_preprocessor.py`입니다.

하이브리드 방식은 여러 후보를 함께 만들고, 점수 기반으로 가장 좋은 crop 결과를 선택합니다.

```text
OpenCV 후보
= board 4점 검출/perspective correction 후보 + writing 영역 crop 후보

YOLO-World 후보
= 칠판, 화이트보드, 프로젝터 화면 같은 강의 표면 탐지 후보

YOLO + OpenCV 후보
= YOLO box 안에서 OpenCV corner를 다시 찾아 원근 보정한 후보

Hybrid selector
= 후보들을 비교해서 최종 이미지 선택
```

일반 사용자는 `img_preprocessing.crop.hybrid_preprocessor`를 실행하면 됩니다.  
`crop/board_cropper.py`와 `crop/yolo_world_detector.py`는 하이브리드 내부에서 사용하는 핵심 모듈이고, `crop/yolo_world_probe.py`는 YOLO 결과만 따로 확인하는 실험/디버깅용 CLI입니다.

## 파일 구성

```text
img_preprocessing/
├─ __init__.py
├─ crop/
│  ├─ __init__.py
│  ├─ board_cropper.py       # OpenCV-only 전처리 후보 생성
│  ├─ hybrid_preprocessor.py # 최종 하이브리드 전처리 진입점
│  ├─ yolo_world_detector.py # YOLO-World detector 재사용 모듈
│  └─ yolo_world_probe.py    # YOLO-World 실험/디버깅 CLI
├─ download_wikimedia_whiteboards.py # 샘플 이미지 다운로드 유틸
└─ README.md
```

## 모듈 역할

### `crop/hybrid_preprocessor.py`

최종으로 사용할 전처리 스크립트입니다.

담당 역할:

1. 입력 이미지 로드
2. OpenCV 후보 생성
3. YOLO-World 후보 생성
4. 후보별 점수 계산
5. 최고 점수 후보 선택
6. 최종 crop 이미지와 debug 결과 저장

주요 API:

```python
run_hybrid_preprocess(...)
HybridBoardPreprocessor
HybridPreprocessorConfig
HybridScoringConfig
```

`HybridBoardPreprocessor`는 서버나 배치 작업처럼 여러 이미지를 처리할 때 YOLO detector를 재사용하기 위한 클래스입니다.

### `crop/board_cropper.py`

OpenCV 기반 후보를 만드는 모듈입니다.

담당 역할:

1. 보드/문서 외곽선 검출
2. 4개 꼭짓점 검출
3. perspective correction
4. 필기 stroke 밀집 영역 crop
5. OpenCV-only CLI 제공

주요 API:

```python
detect_board_corners(image_bgr, debug=False)
crop_and_warp_board(image_bgr, debug=False, mode="auto")
preprocess_board_image(input_path, output_path=None, debug_dir=None, mode="auto")
order_points(points)
```

### `crop/yolo_world_detector.py`

YOLO-World 탐지 로직을 재사용 가능한 형태로 분리한 모듈입니다.

담당 역할:

1. YOLO-World 모델 로드
2. 모델 캐싱
3. class prompt 설정
4. detection box 추출
5. box score 계산
6. annotation 이미지 생성

주요 API:

```python
YoloWorldDetector
DetectionBox
draw_detections(...)
parse_classes(...)
```

### `crop/yolo_world_probe.py`

YOLO-World가 특정 이미지에서 어떤 영역을 잡는지 확인하는 실험용 CLI입니다.

최종 전처리 진입점은 아니지만, 다음 상황에서 유용합니다.

1. prompt별 탐지 결과 확인
2. YOLO box 시각화
3. 하이브리드 실패 원인 분석
4. 발표용 탐지 예시 이미지 생성

## 하이브리드 실행 방법

프로젝트 루트에서 실행합니다.

```bash
.venv/bin/python -m img_preprocessing.crop.hybrid_preprocessor \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/hybrid/IMG_7052_result.jpg" \
  --debug-dir "outputs/hybrid/IMG_7052_debug"
```

하이브리드 크롭은 단일 기본 설정으로 실행됩니다.

기본 YOLO 설정:

```text
conf=0.05
max_det=20
classes=전체 surface prompt
imgsz=Ultralytics 기본값
YOLO 내부 OpenCV refine=on
최종 품질 검사=on
```

YOLO 없이 OpenCV 후보만 보고 싶으면 `--no-yolo`를 사용합니다.

```bash
.venv/bin/python -m img_preprocessing.crop.hybrid_preprocessor \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/hybrid/IMG_7052_opencv_only.jpg" \
  --debug-dir "outputs/hybrid/IMG_7052_opencv_only_debug" \
  --no-yolo
```

실험이 필요하면 YOLO class prompt나 threshold를 직접 지정할 수 있습니다.

```bash
.venv/bin/python -m img_preprocessing.crop.hybrid_preprocessor \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/hybrid/IMG_7052_screen.jpg" \
  --classes "projector screen,projection screen,screen,projected slide"
```

```bash
.venv/bin/python -m img_preprocessing.crop.hybrid_preprocessor \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/hybrid/IMG_7052_custom.jpg" \
  --conf 0.10 \
  --max-det 12 \
  --imgsz 960
```

YOLO box 내부 OpenCV 재검출이나 최종 품질 감점을 끄고 비교할 수도 있습니다.

```bash
.venv/bin/python -m img_preprocessing.crop.hybrid_preprocessor \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/hybrid/IMG_7052_baseline.jpg" \
  --no-refine-yolo \
  --no-quality-check
```

## Python API 사용 예시

한 장만 처리할 때는 `run_hybrid_preprocess()`를 바로 호출할 수 있습니다.

```python
from img_preprocessing.crop.hybrid_preprocessor import run_hybrid_preprocess

result = run_hybrid_preprocess(
    "sample_images/IMG_7052.jpeg",
    output_path="outputs/hybrid/IMG_7052_result.jpg",
    debug_dir="outputs/hybrid/IMG_7052_debug",
)
```

서버나 배치처럼 여러 장을 처리할 때는 `HybridBoardPreprocessor` 사용을 권장합니다.

```python
from img_preprocessing.crop.hybrid_preprocessor import (
    HybridBoardPreprocessor,
    HybridPreprocessorConfig,
)

preprocessor = HybridBoardPreprocessor(
    HybridPreprocessorConfig()
)

result = preprocessor.preprocess(
    "sample_images/IMG_7052.jpeg",
    output_path="outputs/hybrid/IMG_7052_result.jpg",
)
```

이 방식은 내부 YOLO detector를 재사용하므로 매 요청마다 detector를 새로 만드는 구조보다 안정적입니다.

## 판단 기준

하이브리드는 이미지 자체를 먼저 분류하지 않습니다.  
대신 여러 후보를 만든 뒤 점수를 비교합니다.

```text
opencv:board
= OpenCV가 명확한 4점 외곽선을 찾은 경우

opencv:writing
= 외곽선은 애매하지만 필기 stroke 밀집 영역이 안정적인 경우

yolo_world:chalkboard / whiteboard / screen
= YOLO가 칠판, 화이트보드, 프로젝터 화면을 의미적으로 잘 찾은 경우

yolo_world_opencv:whiteboard:corner_refined
= YOLO box 내부에서 OpenCV가 4점 외곽선을 다시 찾은 경우
```

YOLO 후보는 기본적으로 box 주변에 약 `6%` 여백을 더해 OpenCV corner 재검출을 시도합니다.  
재검출된 corner polygon 면적이 YOLO crop 면적의 `25%` 미만이면, 내부의 작은 글씨 영역이나 잘못된 사각형을 보드 전체로 오인한 것으로 보고 `yolo_world_opencv` 후보를 버립니다.

점수에는 다음 요소가 반영됩니다.

1. 각 후보의 confidence
2. OpenCV fallback 사용 여부
3. 후보 crop 면적
4. 후보가 이미지 안에서 차지하는 위치
5. YOLO class 종류
6. 상단/천장 영역 오검출 가능성
7. 최종 crop의 크기, 비율, blur, contrast, 밝기

## OpenCV 처리 파이프라인

OpenCV 후보 생성은 아래 순서로 진행됩니다.

```text
cvtColor
-> GaussianBlur
-> Canny
-> morphologyEx
-> findContours
-> approxPolyDP
-> getPerspectiveTransform
-> warpPerspective
```

각 단계의 목적은 다음과 같습니다.

| 단계 | 목적 |
|---|---|
| `cvtColor` | BGR 이미지를 grayscale로 변환 |
| `GaussianBlur` | 작은 노이즈 제거 |
| `Canny` | 보드/문서 외곽 edge 검출 |
| `morphologyEx` | 끊어진 edge 연결 |
| `findContours` | 큰 외곽선 후보 탐색 |
| `approxPolyDP` | contour를 4점 polygon으로 근사 |
| `getPerspectiveTransform` | 원근 보정 행렬 생성 |
| `warpPerspective` | 원본 이미지에서 반듯한 crop 생성 |

외곽선이 불안정한 경우에는 별도의 writing crop 후보도 만듭니다.

```text
필기 stroke mask
-> 연결 요소 분석
-> 필기 밀집 영역 bounding box
-> 직사각형 crop
```

## YOLO-World 실험 CLI

YOLO 후보만 따로 보고 싶을 때 사용합니다.

```bash
.venv/bin/python -m img_preprocessing.crop.yolo_world_probe \
  --input "sample_images/IMG_7052.jpeg" \
  --output-dir "outputs/yolo_world_probe/IMG_7052" \
  --conf 0.05 \
  --max-det 20
```

생성 결과:

```text
*_yolo_world_annotated.jpg
*_yolo_world_best_crop.jpg
*_yolo_world_summary.json
```

## OpenCV-only CLI

OpenCV 모듈만 따로 확인하고 싶을 때 사용합니다.

```bash
.venv/bin/python -m img_preprocessing.crop.board_cropper \
  --mode auto \
  --input "sample_images/IMG_7052.jpeg" \
  --output "outputs/board_cropper/IMG_7052_cropped.jpg" \
  --debug-dir "outputs/board_cropper/IMG_7052_debug"
```

지원 모드:

| mode | 설명 |
|---|---|
| `auto` | board/document 후보와 writing 후보 중 자동 선택 |
| `board` | 보드/문서 외곽 4점 검출 우선 |
| `document` | 종이/문서 외곽 4점 검출 우선 |
| `writing` | 필기 stroke 밀집 영역 crop |

## Debug 출력

하이브리드에서 `debug_dir`를 지정하면 다음 파일들이 저장됩니다.

```text
00_original.jpg
01_yolo_annotated.jpg
02_opencv_board_result.jpg
02_opencv_writing_result.jpg
99_selected.jpg
candidate_*.jpg
opencv_board_*.jpg
opencv_writing_*.jpg
hybrid_summary.json
```

OpenCV debug 파일 예시:

```text
opencv_board_01_resized_input.jpg
opencv_board_02_gray.jpg
opencv_board_03_blur.jpg
opencv_board_04_edges.jpg
opencv_board_05_morph.jpg
opencv_board_06_contours.jpg
opencv_board_07_selected_corners.jpg
opencv_board_08_warped.jpg
opencv_writing_09_writing_mask.jpg
opencv_writing_10_writing_components.jpg
opencv_writing_11_writing_crop_box.jpg
```

`hybrid_summary.json`에는 다음 정보가 포함됩니다.

```text
success
message
original_size
selected_size
selected_candidate
candidates
yolo_detections
opencv_result
opencv_candidates
output_path
debug_paths
```

## 의존성

전처리 의존성은 프로젝트 루트의 `requirements.txt`에서 한 번에 관리합니다.

```text
numpy
opencv-python-headless
pytest
ultralytics
```

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

첫 YOLO 실행 시 모델 weight가 자동 다운로드될 수 있습니다. 다운로드된 `*.pt` 파일은 `.gitignore` 대상입니다.

## 컴퓨팅 자원

현재 구조에서 OpenCV 처리는 CPU를 사용합니다.

YOLO-World는 Ultralytics/PyTorch backend를 사용하며, `--device`로 장치를 지정할 수 있습니다.

```bash
--device cpu
--device mps
--device cuda:0
```

모바일 중심 운영에서는 다음 구조를 권장합니다.

```text
모바일 CPU
-> OpenCV 전처리 우선

서버 CPU/GPU
-> 실패하거나 어려운 이미지에 하이브리드 전처리 적용
```

## 테스트 실행

```bash
.venv/bin/python -m pytest \
  tests/test_board_cropper.py \
  tests/test_hybrid_preprocessor.py \
  tests/test_yolo_world_detector.py \
  -q
```

현재 테스트는 다음을 확인합니다.

1. 꼭짓점 정렬 순서
2. 잘못된 입력 처리
3. 합성 사각형 보드 검출
4. 원근 보정 결과 이미지 크기
5. 필기 영역 crop 결과
6. 하이브리드 OpenCV board/writing 후보 생성
7. YOLO refined 후보 생성 옵션
8. 최종 crop 품질 감점
9. YOLO detector 유틸리티

## 주의사항

1. `crop/hybrid_preprocessor.py`가 최종 전처리 진입점입니다.
2. `crop/board_cropper.py`는 하이브리드 내부에서도 계속 필요한 OpenCV 후보 생성 모듈입니다.
3. `crop/yolo_world_detector.py`는 하이브리드 내부에서도 계속 필요한 YOLO 후보 생성 모듈입니다.
4. `crop/yolo_world_probe.py`는 선택 사항이지만, YOLO 디버깅과 발표 자료 생성에 유용합니다.
5. `HEIC`처럼 OpenCV가 바로 읽지 못하는 포맷은 실패할 수 있습니다.
6. 보드 경계가 거의 보이지 않거나 조명이 심하게 반사된 이미지는 오검출될 수 있습니다.
7. YOLO-World는 사전학습 open-vocabulary 모델이므로 모든 강의실 상황에서 항상 정답을 보장하지 않습니다.

## 요약

최종 사용은 `crop/hybrid_preprocessor.py`입니다.

`crop/board_cropper.py`는 OpenCV 후보를 만들고, `crop/yolo_world_detector.py`는 YOLO 후보를 만들며, `crop/hybrid_preprocessor.py`가 두 후보를 비교해서 최종 crop을 선택합니다.

`crop/yolo_world_probe.py`는 최종 경로가 아니라 YOLO 단독 결과를 확인하는 실험/디버깅 도구입니다.
