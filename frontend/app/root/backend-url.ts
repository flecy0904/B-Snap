import { Platform } from 'react-native';

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
const ANDROID_EMULATOR_HOST = '10.0.2.2';

function resolvePlatformBackendUrl(url: string) {
  if (Platform.OS !== 'android') return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = ANDROID_EMULATOR_HOST;
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    return url;
  }
  return url;
}

export function resolveBackendHttpUrl() {
  return resolvePlatformBackendUrl(
    normalizeBackendHttpUrl(process.env.EXPO_PUBLIC_BACKEND_URL) ?? DEFAULT_BACKEND_HTTP_URL,
  );
}
