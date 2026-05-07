export function buildAiChatTitle(question: string, fallbackTitle?: string) {
  const normalized = question.replace(/\s+/g, ' ').trim();
  const fallback = fallbackTitle ? `${fallbackTitle} AI 채팅` : 'AI 채팅';
  if (!normalized) return fallback;

  const cleaned = normalized.replace(/[?!.,]+$/g, '').trim();
  const title = cleaned || normalized;
  return title.length > 28 ? `${title.slice(0, 28).trim()}...` : title;
}
