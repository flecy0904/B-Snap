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

export function resolveBackendHttpUrl() {
  return normalizeBackendHttpUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
}
