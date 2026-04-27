function normalizeBackendHttpUrl(value?: string) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

const DEFAULT_BACKEND_HTTP_URL = 'http://localhost:8000';

export function resolveBackendHttpUrl() {
  return normalizeBackendHttpUrl(process.env.EXPO_PUBLIC_BACKEND_URL) ?? DEFAULT_BACKEND_HTTP_URL;
}
