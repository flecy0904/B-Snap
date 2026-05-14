import React, { useMemo } from 'react';
import { SyncBridgeProvider, createLocalBridge, createWebSocketBridge } from '../hooks/use-sync-bridge';
import { resolveBackendHttpUrl } from './backend-url';
import { AppShell } from './app-shell';
import type { AuthSession } from './types';

export function AuthenticatedApp(props: {
  session: AuthSession;
  onLogout: () => void;
}) {
  const syncBridge = useMemo(() => {
    const httpUrl = resolveBackendHttpUrl();
    return httpUrl ? createWebSocketBridge({ httpUrl, authToken: props.session.accessToken }) : createLocalBridge();
  }, [props.session.accessToken]);

  return (
    <SyncBridgeProvider bridge={syncBridge}>
      <AppShell authUser={props.session.user} onLogout={props.onLogout} />
    </SyncBridgeProvider>
  );
}
