import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from './types';

const AUTH_SESSION_KEY = 'bsnap-auth-session';

export async function saveAuthSession(session: AuthSession) {
  const value = JSON.stringify(session);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(AUTH_SESSION_KEY, value);
    return;
  }

  await SecureStore.setItemAsync(AUTH_SESSION_KEY, value);
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  const value = Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(AUTH_SESSION_KEY) ?? null
    : await SecureStore.getItemAsync(AUTH_SESSION_KEY);
  if (!value) return null;

  try {
    return JSON.parse(value) as AuthSession;
  } catch {
    return null;
  }
}

export async function clearAuthSession() {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(AUTH_SESSION_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}
