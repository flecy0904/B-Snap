# B-Snap

B-Snap은 수업 시간표, 캡처 자료, PDF 필기, AI 정리 흐름을 하나로 묶는 학습 워크스페이스 앱입니다.

현재 프로젝트는 **Expo + React Native frontend**, **FastAPI + PostgreSQL backend** 구조입니다.

## 폴더 구조

```text
B-Snap-team/
  frontend/          # Expo React Native 앱
  backend/           # FastAPI backend
  img_preprocessing/ # 이미지 전처리 모듈
```

## 처음 세팅

### 1. Frontend 패키지 설치

```bash
cd frontend
npm clean-install
```

`npm install` 대신 `npm clean-install`을 권장합니다. 팀원 간 `package-lock.json` 기준으로 같은 의존성을 설치하기 위함입니다.


### 2. Backend 환경변수 생성

`backend/.env.example`을 참고해서 `backend/.env` 파일을 만듭니다.

macOS/Linux:

```bash
cp backend/.env.example backend/.env
```

예시:

```env
APP_ENV=local
APP_NAME=B-Snap API
DATABASE_URL=postgresql+psycopg://postgres:<password>@localhost:5432/bsnap
AI_PROVIDER=openai
OPENAI_API_KEY=<your_openai_api_key>
OPENAI_DEFAULT_MODEL=gpt-4.1-mini
ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006
JWT_SECRET_KEY=replace_with_openssl_rand_hex_32
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_MINUTES=10080
UPLOAD_DIR=backend/uploads
UPLOAD_MAX_BYTES=31457280
```

주의:

- 실제 `.env` 파일은 git에 올리지 않습니다.
- 실제 API key나 DB 비밀번호를 README, 이슈, PR, 채팅에 적지 않습니다.
- `JWT_SECRET_KEY`는 팀/환경마다 충분히 긴 랜덤 문자열로 설정합니다.
- 저비용 AI 채팅/사진 설명 기본 모델은 `gpt-4.1-mini`입니다.

### 2-1. Frontend 환경변수 생성

`frontend/.env.example`을 참고해서 `frontend/.env` 파일을 만듭니다.

```bash
cp frontend/.env.example frontend/.env
```

시뮬레이터만 사용할 때는 `localhost`도 가능하지만, 실기기와 같이 테스트할 때는 Mac의 같은 Wi-Fi IP를 넣습니다.

```bash
ipconfig getifaddr en0
```

예시:

```env
EXPO_PUBLIC_BACKEND_URL=http://172.31.97.89:8000
```

Wi-Fi가 바뀌면 IP도 바뀔 수 있으므로 `frontend/.env`를 수정하고 Metro를 다시 시작합니다.

### 3. PostgreSQL DB 생성

로컬 PostgreSQL에서 DB를 하나 만듭니다.

```sql
CREATE DATABASE bsnap;
```

### 4. Backend 가상환경/패키지 설치

```powershell
cd B-Snap
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

참고: `cd frontend && npm run backend` 명령도 backend 가상환경과 패키지가 없으면 자동으로 준비를 시도합니다.

### 5. DB 테이블 생성

DB를 만든 뒤 한 번 실행합니다.

```powershell
cd C:\Users\User\Desktop\WorkSpace\B-Snap
.\backend\.venv\Scripts\python.exe -m backend.scripts.init_db
```

## 실행 방법

개발 중에는 보통 터미널을 2개 사용합니다.

### Terminal 1. Backend 실행

```powershell
cd frontend
npm run backend:dev
```

기본 주소:

```text
http://localhost:8000
```

확인 URL:

```text
http://localhost:8000/health
http://localhost:8000/health/db
```

### Terminal 2. Web 실행

```bash
cd frontend
npm run web
```

### iOS 실행

iOS는 **macOS + Xcode + CocoaPods** 환경에서만 실행됩니다.

처음 한 번, 또는 `package-lock.json` / 네이티브 모듈 변경 후:

```bash
cd frontend/ios
pod install
cd ..
```

실행:

```bash
cd frontend
npm run start:reset -- --host lan
```

새 터미널:

```bash
cd frontend
npm run ios
```

iPad A16 시뮬레이터로 실행:

```bash
cd frontend
npm run ios:ipad
```

실기기는 같은 Wi-Fi에 연결한 뒤 Metro QR을 개발 빌드에서 열거나, USB 연결 후 Xcode/React Native CLI로 설치한 개발 빌드를 실행합니다. `No script URL provided`가 뜨면 Metro가 꺼져 있거나, 앱이 다른 Metro 포트/주소를 보고 있는 상태입니다. 이때는 Expo 서버를 하나만 남기고 다시 시작합니다.

```bash
pkill -f "expo start --dev-client"
cd frontend
npm run start:reset -- --host lan
```

앱과 Metro가 같은 서버에 붙어 있으면 터미널의 `r` 또는 시뮬레이터의 `Cmd+R`로 리로드할 수 있습니다.
### Android 실행

필수:

- Android Studio
- Android SDK
- Android Emulator 또는 실기기

SDK 경로가 자동으로 잡히지 않으면 `frontend/android/local.properties` 파일을 직접 만듭니다. 이 파일은 git에 올리지 않습니다.

macOS:

```properties
sdk.dir=/Users/<username>/Library/Android/sdk
```

Windows:

```properties
sdk.dir=C:\\Users\\<username>\\AppData\\Local\\Android\\Sdk
```

실행:

```bash
cd frontend
npm run start
```

새 터미널:

```bash
cd frontend
npm run android
```

## 자주 쓰는 명령어

```bash
npm run start       # Expo dev client Metro 실행
npm run start:reset # Metro 캐시 초기화 후 실행
npm run web         # 웹 실행
npm run ios         # iOS 기본 시뮬레이터 실행
npm run ios:ipad    # iPad (A16) 시뮬레이터 실행
npm run android     # Android 실행
npm run check       # 타입 체크
```

## Push 전 확인

```bash
cd frontend
npm run check
```

## 현재 구현 상태

Frontend:

- 이메일/비밀번호 로그인 및 계정별 토큰 저장
- 시간표 화면
- 캡처 업로드 프로토타입
- PDF/빈 노트 워크스페이스
- 펜/형광펜/지우개/선택 도구
- 백엔드 API를 통한 노트 목록 불러오기
- 노트 제목 수정 UI와 백엔드 저장 연결
- 손글씨 필기 저장/불러오기 연결
- AI 채팅 패널
- AI 채팅방 목록/전체 채팅 목록 표시
- AI 채팅 내역 표시

Backend:

- FastAPI 앱 구조
- users/auth API와 JWT 인증
- PostgreSQL 연결
- folders/notes/note_pages CRUD
- folders/notes/chat/upload/RAG API의 사용자별 데이터 제한
- chat_sessions/chat_messages CRUD
- 전체 chat session 조회
- 노트 제목 및 노트 페이지 내용 저장 API
- OpenAI `gpt-4.1-mini` 연결
- AI 질문/응답 DB 저장
- 이미지 업로드 시 원본 파일 저장, 전처리 이미지 생성, 전처리 이미지를 우선 사용한 AI 사진 설명 생성

## 이미지 전처리/사진 설명 흐름

사진 업로드 흐름은 다음 구조를 따릅니다.

1. 원본 이미지는 `backend/uploads`에 저장합니다.
2. 가능한 경우 전처리 이미지는 `backend/uploads/processed-images`에 PNG로 저장합니다.
3. AI 사진 설명은 전처리 이미지를 우선 사용하고, 전처리 실패 시 원본 이미지로 fallback합니다.
4. 앱 UI는 원본 사진을 우선 보여주고, `AI로 더 보기` 같은 분석 요청에는 전처리 URL을 우선 사용합니다.

따라서 팀원이 로컬에서 사진 설명까지 테스트하려면 `backend/.env`의 `AI_PROVIDER`, `OPENAI_API_KEY`, `UPLOAD_DIR`, `AI_IMAGE_MAX_BYTES` 설정이 필요합니다.

## 팀 개발 참고 문서

- [Notes Data Contract Draft](docs/notes-data-contract.md): OCR/RAG 연동 전 현재 노트/페이지/업로드 데이터 구조 초안

## 자주 나는 오류

### `Unable to resolve module expo-asset`

의존성 설치가 꼬였을 가능성이 큽니다.

```bash
cd frontend
npm clean-install
npm run start:reset
```

iOS라면 추가로:

```bash
cd ios
pod install
cd ..
```

### iOS에서 `ExpoAsset ... node_modules/expo/node_modules/expo-asset` 오류

Pods가 예전 경로를 보고 있는 상태입니다.

```bash
cd frontend/ios
pod install
cd ..
```

그 다음:

```bash
npm run start:reset
npm run ios
```

### Android에서 `SDK location not found`

`frontend/android/local.properties`를 만듭니다.

macOS:

```properties
sdk.dir=/Users/<username>/Library/Android/sdk
```

Windows:

```properties
sdk.dir=C:\\Users\\<username>\\AppData\\Local\\Android\\Sdk
```

### Metro가 꼬였을 때

```bash
cd frontend
npm run start:reset
```
