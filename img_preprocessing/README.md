# B-SNAP 이미지 전처리 모듈

## 개요

`board_cropper.py`는 강의실 화이트보드/칠판 사진에서 **주요 보드 영역을 검출하고**, 가능한 경우 **4개 꼭짓점 좌표를 추출한 뒤**, **원근 보정된 보드 이미지**를 생성하는 OpenCV 기반 전처리 모듈입니다.

이 모듈은 FastAPI, React Native, Expo와 독립적으로 동작하도록 작성되어 있습니다. 따라서 서버 백엔드, 로컬 CLI, 향후 모바일/온디바이스 파이프라인에서 재사용할 수 있습니다.

## 파일 구성

```text
img_preprocessing/
├─ __init__.py
├─ board_cropper.py
└─ README.md
```

## 주요 공개 함수

### `detect_board_corners(image_bgr, debug=False)`

BGR 형식의 OpenCV 이미지를 입력받아 보드 영역의 4개 꼭짓점을 검출합니다.

반환 결과에는 다음 정보가 포함됩니다.

```text
success
message
corners
confidence
original_size
debug_paths
fallback
```

`corners`는 항상 아래 순서로 반환됩니다.

```text
top-left -> top-right -> bottom-right -> bottom-left
```

### `crop_and_warp_board(image_bgr, debug=False)`

`detect_board_corners()`로 꼭짓점을 찾은 뒤, 원본 해상도 이미지에 perspective transform을 적용합니다.

성공 시 `warped_image`와 `warped_size`가 함께 반환됩니다.

### `preprocess_board_image(input_path, output_path=None, debug_dir=None)`

이미지 파일 경로를 입력받아 전체 파이프라인을 실행합니다.

선택적으로 다음 작업도 수행합니다.

1. 보정 결과 이미지 저장
2. 디버그 이미지 저장
3. JSON으로 직렬화 가능한 결과 메타데이터 생성

### `order_points(points)`

4개 좌표를 다음 순서로 정렬하는 헬퍼 함수입니다.

```text
top-left -> top-right -> bottom-right -> bottom-left
```

원근 보정은 꼭짓점 순서에 민감하기 때문에 별도 테스트 대상입니다.

## 처리 파이프라인

전체 OpenCV 처리 흐름은 아래 순서입니다.

```text
cvtColor -> GaussianBlur -> Canny -> morphologyEx -> findContours -> approxPolyDP -> getPerspectiveTransform -> warpPerspective
```

## 단계별 동작 설명

### 1. 입력 검증

입력 이미지가 다음 조건을 만족하는지 확인합니다.

- `None`이 아닌지
- `numpy.ndarray`인지
- 비어 있지 않은지
- BGR 3채널 이미지인지

잘못된 입력이어도 예외를 터뜨리지 않고 `success=False` 결과를 반환합니다.

### 2. 검출용 리사이즈

큰 이미지는 빠른 처리를 위해 기본 최대 폭 `1280px`로 줄여서 검출합니다.

검출된 좌표는 다시 원본 이미지 좌표로 환산합니다.

최종 원근 보정은 리사이즈 이미지가 아니라 **원본 해상도 이미지**에 적용합니다.

### 3. Grayscale 변환

```python
cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
```

BGR 이미지를 흑백 이미지로 변환합니다.

### 4. 노이즈 감소

```python
cv2.GaussianBlur(gray, (5, 5), 0)
```

작은 노이즈를 줄여 Canny edge 검출이 안정적으로 동작하도록 합니다.

### 5. Edge 검출

```python
cv2.Canny(blur, lower, upper)
```

기본값은 이미지 median intensity 기반 자동 threshold입니다.

필요하면 `canny_thresholds=(low, high)` 형태로 수동 threshold를 넘길 수 있습니다.

### 6. Morphological cleanup

```python
cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
```

끊어진 선분을 연결하기 위해 `MORPH_CLOSE`를 사용합니다.

기본 kernel은 직사각형 `7x7`입니다.

### 7. Contour 검출

```python
cv2.findContours(morph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
```

외곽 contour를 찾고, 면적이 큰 순서대로 후보를 검사합니다.

후보 필터 기준은 다음과 같습니다.

- 최소 면적 비율
- convex 여부
- aspect ratio 범위
- polygon point count
- contour area

### 8. Polygon 근사

```python
cv2.approxPolyDP(contour, epsilon, True)
```

contour를 다각형으로 근사합니다.

우선 4개 점으로 근사되는 contour를 찾습니다. 실패하면 convex hull을 시도하고, 마지막 fallback으로 `minAreaRect`를 사용합니다.

fallback이 사용되면 `confidence`가 낮아집니다.

### 9. 꼭짓점 정렬

검출된 4개 점은 `order_points()`를 통해 아래 순서로 정렬됩니다.

```text
top-left
top-right
bottom-right
bottom-left
```

### 10. 원근 보정

```python
cv2.getPerspectiveTransform(src, dst)
cv2.warpPerspective(image, matrix, (width, height))
```

정렬된 꼭짓점으로 perspective transform matrix를 만들고, 원본 이미지에서 보드 영역을 반듯하게 펼칩니다.

너무 큰 결과 이미지가 생기지 않도록 긴 변은 기본 `2400px`로 제한합니다.

## CLI 사용법

프로젝트 루트에서 실행합니다.

```bash
.venv/bin/python -m img_preprocessing.board_cropper \
  --input "sample_images/frontend_assets/notes/mock-presentation/IMG_4837.JPG" \
  --output "outputs/board_cropper/IMG_4837_cropped.jpg" \
  --debug-dir "outputs/board_cropper/IMG_4837_debug"
```

가상환경을 활성화했다면 아래처럼 실행할 수도 있습니다.

```bash
python -m img_preprocessing.board_cropper \
  --input "sample_images/frontend_assets/notes/mock-presentation/IMG_4837.JPG" \
  --output "outputs/board_cropper/IMG_4837_cropped.jpg" \
  --debug-dir "outputs/board_cropper/IMG_4837_debug"
```

## CLI 출력 예시

```json
{
  "success": true,
  "message": "Board cropped and perspective-corrected.",
  "corners": [[94.0, 88.0], [547.0, 64.0], [576.0, 367.0], [68.0, 391.0]],
  "confidence": 0.95,
  "original_size": {"width": 640, "height": 480},
  "warped_size": {"width": 509, "height": 304},
  "output_path": "outputs/board_cropper/IMG_4837_cropped.jpg",
  "debug_paths": {
    "01_resized_input.jpg": "outputs/board_cropper/IMG_4837_debug/01_resized_input.jpg"
  },
  "fallback": null
}
```

## 디버그 이미지

`debug_dir`를 지정하면 다음 중간 결과 이미지가 저장됩니다.

```text
01_resized_input.jpg
02_gray.jpg
03_blur.jpg
04_edges.jpg
05_morph.jpg
06_contours.jpg
07_selected_corners.jpg
08_warped.jpg
```

각 파일의 의미는 다음과 같습니다.

| 파일 | 설명 |
|---|---|
| `01_resized_input.jpg` | 검출용으로 리사이즈된 입력 이미지 |
| `02_gray.jpg` | 흑백 변환 결과 |
| `03_blur.jpg` | Gaussian blur 결과 |
| `04_edges.jpg` | Canny edge 결과 |
| `05_morph.jpg` | morphology close 결과 |
| `06_contours.jpg` | 검출된 contour 시각화 |
| `07_selected_corners.jpg` | 선택된 4개 꼭짓점 표시 |
| `08_warped.jpg` | 최종 원근 보정 결과 |

## 테스트 실행

```bash
.venv/bin/python -m pytest tests/test_board_cropper.py -q
```

테스트는 다음을 확인합니다.

1. 꼭짓점 정렬 순서
2. 잘못된 입력 처리
3. 합성 사각형 보드 검출
4. 원근 보정 결과 이미지 크기

## 주의사항

- OpenCV가 바로 읽기 어려운 `HEIC` 이미지는 실패할 수 있습니다.
- 보드 경계가 거의 보이지 않거나 사진이 심하게 흔들린 경우 검출 실패가 발생할 수 있습니다.
- `fallback`이 `convex_hull` 또는 `min_area_rect`인 경우 신뢰도가 낮게 설정됩니다.
- 이 버전은 머신러닝 없이 classical OpenCV만 사용하는 1차 구현입니다.

## 의존성

Python 의존성은 프로젝트 루트의 `requirements.txt`에서 관리합니다.

```text
numpy
opencv-python-headless
pytest
```

가상환경 설치 예시는 다음과 같습니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
