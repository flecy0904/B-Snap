import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthenticatedApp } from './app/root/authenticated-app';
import { LoginScreen } from './app/root/login-screen';
import { clearAuthSession, loadAuthSession } from './app/root/auth-storage';
import { getBackendCurrentUser, setBackendAuthToken } from './app/services/backend-api';
import { setLocalWorkspaceOwner } from './app/storage/local-workspace-store';
import type { AuthSession } from './app/root/types';

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadAuthSession()
      .then(async (storedSession) => {
        if (!storedSession) return;
        setBackendAuthToken(storedSession.accessToken);
        const user = await getBackendCurrentUser();
        if (!mounted) return;
        setLocalWorkspaceOwner(user.id);
        setSession({
          accessToken: storedSession.accessToken,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            provider: 'email',
          },
        });
      })
      .catch(async () => {
        setBackendAuthToken(null);
        await clearAuthSession();
      })
      .finally(() => {
        if (mounted) setRestoring(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const logout = async () => {
    setBackendAuthToken(null);
    setLocalWorkspaceOwner(null);
    await clearAuthSession();
    setSession(null);
  };

  if (restoring) {
    return <GestureHandlerRootView style={{ flex: 1 }} />;
  }

  if (!session) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <LoginScreen onLogin={(nextSession) => {
          setLocalWorkspaceOwner(nextSession.user.id);
          setSession(nextSession);
        }} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthenticatedApp session={session} onLogout={logout} />
    </GestureHandlerRootView>
  );
}
