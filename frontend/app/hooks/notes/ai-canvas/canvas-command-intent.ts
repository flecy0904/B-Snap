const CANVAS_CREATE_REQUEST_KEYWORDS = [
  'new canvas',
  '새 canvas',
  '새 캔버스',
  '새로운 canvas',
  '새로운 캔버스',
  '별도 canvas',
  '별도 캔버스',
  '다른 canvas',
  '다른 캔버스',
  '새 정리본',
  '새 요약본',
  '새 정리 노트',
  '새 노트',
];

export function isCanvasCreateRequest(command: string) {
  const normalized = command.toLowerCase();
  return CANVAS_CREATE_REQUEST_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
