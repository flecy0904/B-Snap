import React, { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthenticatedApp } from './app/root/authenticated-app';
import { LoginScreen } from './app/root/login-screen';
import type { AuthUser } from './app/root/types';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);

  if (!user) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <LoginScreen onLogin={setUser} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthenticatedApp onLogout={() => setUser(null)} />
    </GestureHandlerRootView>
  );
}
