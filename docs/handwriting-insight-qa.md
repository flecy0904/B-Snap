# Semantic Handwriting Insight QA

This checklist validates the full semantic handwriting insight flow without OCRing the original PDF. Every analysis path should use only B-Snap overlay `inkStrokes`.

## Required Env

Backend:

```bash
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/bsnap
```

Frontend debug flags:

```bash
EXPO_PUBLIC_ENABLE_HANDWRITING_DEBUG=true
EXPO_PUBLIC_ENABLE_HANDWRITING_AUTO_ANALYZE=true
```

Optional Vision fallback:

```bash
HANDWRITING_VISION_FALLBACK_ENABLED=true
OPENAI_API_KEY=...
HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE=6
HANDWRITING_VISION_MAX_PAGES_PER_NOTE=8
HANDWRITING_VISION_MIN_CLUSTER_STROKES=2
HANDWRITING_VISION_CACHE_TTL_DAYS=14
```

Current demo policy:

- Core recommendation works without OpenAI: star, bookmarks, highlights, AI questions, memos, group overlap, and weak ink density.
- Vision fallback is cost-controlled and should run only for pages where geometry detects a star anchor.
- Vision analyzes only nearby B-Snap overlay ink clusters. It must not include the original PDF background.
- ML Kit is optional. If it is unavailable or inaccurate, the app should continue with geometry/Vision.

## Run Locally

Backend:

```bash
cd /Users/angibeom/B-Snap-team
backend/.venv/bin/uvicorn backend.app.main:app --reload
```

Frontend web:

```bash
cd /Users/angibeom/B-Snap-team/frontend
EXPO_PUBLIC_ENABLE_HANDWRITING_DEBUG=true EXPO_PUBLIC_ENABLE_HANDWRITING_AUTO_ANALYZE=true npm start
```

iOS dev build check:

```bash
cd /Users/angibeom/B-Snap-team/frontend/ios
pod install
xcodebuild -workspace BSNAP.xcworkspace -scheme BSNAP -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -quiet build CODE_SIGNING_ALLOWED=NO
```

## Geometry-Only Web QA

1. Open a PDF note on web.
2. Draw a clear star overlay mark in B-Snap.
3. In the debug panel, run `현재 페이지 재분석`.
4. Confirm feedback says geometry analysis was saved and class insight was refreshed.
5. Confirm `handwritingRecognition.status`, `engine`, `symbols`, `confidence`, and `clusters` update.
6. Confirm bbox overlay appears and does not block interaction.
7. Ask: `중요 페이지 추천해줘`.
8. Expected: recommended pages reflect the star signal without exposing scores, signal counts, or engine names.

Notes:

- `check`, `circle`, `box`, `underline`, `bracket`, `arrow`, and `exclamation` may appear in debug metadata.
- They should not make a page high/very-high by themselves.
- Raw stroke density alone should remain a weak backup signal.

## Vision Fallback QA

1. Start backend with `HANDWRITING_VISION_FALLBACK_ENABLED=true` and `OPENAI_API_KEY`.
2. Draw a star and nearby short handwriting such as `중요`, `시험`, or `기말`.
3. Run `Vision fallback` from the debug panel.
4. Confirm only rendered overlay ink near the star is analyzed. Original PDF content must never be included.
5. Confirm `visionFallbackUsed`, `visionFallbackSkippedReason`, `analyzedClusterCount`, and `visionAnalyzedClusterCount` display clearly.
6. Draw Korean handwriting without a star and run Vision fallback.
7. Expected: Vision is skipped with `no-star-anchor`; OpenAI should not be called.
8. Remove `OPENAI_API_KEY` or disable the env flag and rerun.
9. Expected: analysis fails safely with `missing-api-key` or `fallback-disabled`; note save/PDF/chat/canvas flows keep working.

## ML Kit QA

Web expected behavior:

1. Click `ML Kit 확인` on web.
2. Expected: unavailable is normal because web has no native ML Kit bridge.
3. Click `현재 페이지 ML Kit` or `ML Kit 실행 후 저장`.
4. Expected: no crash; debug feedback clearly says the native module is unavailable on web.

iOS dev build:

1. Run an iOS dev build, not Expo Go.
2. Click `ML Kit 확인`.
3. Click `한국어 모델 준비`.
4. Draw Korean handwriting such as `중요`, `시험`, or `기말`.
5. Click `현재 페이지 ML Kit`.
6. Confirm candidates, normalized keywords, cluster count, and confidence are shown if available.
7. Click `ML Kit 실행 후 저장`.
8. Confirm persisted `handwritingRecognition` appears in the debug panel and class insight refreshes.
9. Modify strokes and try saving an old recognition result if possible.
10. Expected: backend returns safe `409 stale handwriting recognition result`; debug feedback asks you to rerun recognition.

## Demo Seed

Seed semantic class-insight demo data:

```bash
cd /Users/angibeom/B-Snap-team
backend/.venv/bin/python backend/scripts/seed_handwriting_semantic_demo.py
```

The script creates demo users with password `semantic-demo-pass` and pages:

- Page 13: star + `중요` + `시험`
- Page 21: `기말` / `중간`
- Page 32: `암기` / `필수`
- Page 75: many random strokes without semantic signal

Expected ranking:

```text
Page 13 outranks Page 75.
Star and strong keywords outrank raw-stroke-heavy pages.
Check/circle/underline-only pages should not become high priority.
```

## Prompt Examples

Use these in the AI panel:

```text
시험에 나올만한 페이지 어디야?
중요 페이지 추천해줘
먼저 복습할 페이지 알려줘
```

Expected answer style:

- Natural study-assistant wording.
- Mentions pages and concise reasons like handwritten important marks, star marks, exam/final keywords, or overlapping study signals.
- Does not expose hidden scores, classmate counts, raw signal counts, raw stroke count, engine names, OpenAI, or ML Kit details.
