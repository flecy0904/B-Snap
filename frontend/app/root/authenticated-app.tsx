import React, { useMemo } from 'react';
import { SyncBridgeProvider, createMockBridge, createWebSocketBridge } from '../hooks/use-sync-bridge';
import { resolveBackendHttpUrl } from './backend-url';
import { AppShell } from './app-shell';

export function AuthenticatedApp(props: {
  onLogout: () => void;
}) {
  const syncBridge = useMemo(() => {
    const httpUrl = resolveBackendHttpUrl();
    return httpUrl ? createWebSocketBridge({ httpUrl }) : createMockBridge();
  }, []);

  return (
    <SyncBridgeProvider bridge={syncBridge}>
      <AppShell onLogout={props.onLogout} />
    </SyncBridgeProvider>
  );
}
