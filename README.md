# B-Snap

B-Snap은 수업 시간표, 캡처 자료, PDF 필기, AI 정리 흐름을 하나로 묶는 학습 워크스페이스 앱입니다.

현재 프론트엔드는 **Expo + React Native** 기반입니다.

## 폴더 구조

```text
B-Snap-team/
  frontend/          # Expo React Native 앱
  backend/           # 백엔드 자리, 현재는 구현 파일 없음
  img_preprocessing/ # 이미지 전처리 자리
```

## 1. 처음 설치

```bash
cd frontend
npm clean-install
```

`npm install` 대신 `npm clean-install`을 권장합니다. 팀원 간 `package-lock.json` 기준으로 같은 의존성을 설치하기 위함입니다.

## 2. 웹 실행

```bash
cd frontend
npm run web
```

## 3. iOS 실행

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
npm run start
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

## 4. Android 실행

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

## 5. 자주 쓰는 명령어

```bash
npm run start       # Expo dev client Metro 실행
npm run start:reset # Metro 캐시 초기화 후 실행
npm run web         # 웹 실행
npm run ios         # iOS 기본 시뮬레이터 실행
npm run ios:ipad    # iPad (A16) 시뮬레이터 실행
npm run android     # Android 실행
npm run check       # 타입 체크
```

## 6. Push 전 확인

```bash
cd frontend
npm run check
```

## 7. 자주 나는 오류

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

## 8. 현재 구현 상태

- mock 로그인
- 시간표 화면
- 캡처 업로드 프로토타입
- PDF/빈 노트 워크스페이스
- 펜, 형광펜, 지우개, 선택, 텍스트 메모
- 페이지별 필기 저장
- PDF 렌더 크기 변화에 맞춘 필기 좌표 보정
- 로컬 SQLite 저장
- mock AI 정리 패널

백엔드는 아직 실제 구현 파일이 없습니다.
