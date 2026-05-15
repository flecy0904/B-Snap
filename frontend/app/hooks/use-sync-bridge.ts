import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_CAPTURE_PREVIEW_IMAGE_KEY, resolvePreviewImage } from '../preview-images';
import type { CaptureAsset, CaptureAssetEvent, CaptureAssetType, CaptureSource, CaptureSyncBridge, PublishAssetResult, SyncBridgeStatus } from '../types';

type AssetListener = (event: CaptureAssetEvent) => void;
type StatusListener = (status: SyncBridgeStatus) => void;

const assetListeners = new Set<AssetListener>();
let assetSequence = 1;
const defaultPreviewImage = resolvePreviewImage(DEFAULT_CAPTURE_PREVIEW_IMAGE_KEY);

function nextAssetId() {
  return `asset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

function findPreviewImage(subjectId: number) {
  return defaultPreviewImage;
}

export function createCaptureAsset(props: {
  subjectId: number;
  subjectName: string;
  type: CaptureAssetType;
  source: CaptureSource;
  fileName?: string;
  pageCount?: number;
}): CaptureAsset {
  const suffix = assetSequence;
  assetSequence += 1;
  const defaultTitle = props.type === 'image' ? `${props.subjectName} 판서 스냅 ${suffix}` : `${props.subjectName} 보조 PDF ${suffix}`;
  const analysisSummary =
    props.type === 'image'
      ? `${props.subjectName} 수업 중 촬영한 원본 사진입니다. 백엔드 전처리 이미지는 AI 인식용으로만 활용하고, 앱에는 원본 사진과 페이지 연결 설명을 보여줍니다.`
      : `${props.subjectName} 수업 보조 PDF입니다. 노트의 특정 페이지와 연결해 복습할 때 같이 확인할 수 있습니다.`;
  const sourceLabel =
    props.source === 'camera'
      ? 'iPhone camera import'
      : props.source === 'library'
        ? 'iPhone photo library'
        : 'iPhone document picker';

  return {
    id: nextAssetId(),
    subjectId: props.subjectId,
    type: props.type,
    status: 'uploaded' as const,
    title: props.fileName || defaultTitle,
    summary:
      props.type === 'image'
        ? `${props.source === 'camera' ? '카메라' : '사진첩'}에서 가져온 이미지입니다. 현재 PDF 페이지에 자료 카드로 연결하거나 보관함에 저장할 수 있습니다.`
        : '파일 선택기에서 가져온 PDF입니다. 현재 문서에 참고자료로 연결하거나 보관함으로만 저장할 수 있습니다.',
    analysisStatus: 'ready',
    analysisSummary,
    analysisKeywords: props.type === 'image'
      ? [props.subjectName, '판서사진', '수업자료']
      : [props.subjectName, 'PDF자료', '참고자료'],
    createdAt: '방금 전 · phone',
    sourceDeviceLabel: sourceLabel,
    previewImageKey: props.type === 'image' ? DEFAULT_CAPTURE_PREVIEW_IMAGE_KEY : undefined,
    previewImage: props.type === 'image' ? findPreviewImage(props.subjectId) : undefined,
    pageCount: props.type === 'pdf' ? props.pageCount ?? 6 + (suffix % 5) : undefined,
  };
}

function emitToListeners(listeners: Set<AssetListener>, event: CaptureAssetEvent) {
  listeners.forEach((listener) => listener(event));
}

function buildAssetCreatedEvent(asset: CaptureAsset): CaptureAssetEvent {
  return {
    event: 'asset.created',
    asset,
    receivedAt: new Date().toISOString(),
  };
}

function publishLocally(listeners: Set<AssetListener>, asset: CaptureAsset): PublishAssetResult {
  emitToListeners(listeners, buildAssetCreatedEvent(asset));
  return { delivery: 'local' };
}

function createLocalSyncBridge(): CaptureSyncBridge {
  const statusListeners = new Set<StatusListener>();
  return {
    mode: 'local',
    getStatus() {
      return 'local';
    },
    subscribeToStatus(listener) {
      statusListeners.add(listener);
      listener('local');
      return () => {
        statusListeners.delete(listener);
      };
    },
    publishAsset(asset) {
      return publishLocally(assetListeners, asset);
    },
    subscribeToAssets(listener) {
      assetListeners.add(listener);

      return () => {
        assetListeners.delete(listener);
      };
    },
  };
}

export function createWebSocketBridge(props: {
  httpUrl: string;
  wsUrl?: string;
  authToken?: string | null;
}): CaptureSyncBridge {
  const listeners = new Set<AssetListener>();
  const statusListeners = new Set<StatusListener>();
  const httpUrl = props.httpUrl.replace(/\/$/, '');
  const baseWsUrl = (props.wsUrl ?? httpUrl.replace(/^http/, 'ws') + '/ws').replace(/\/$/, '');
  const wsUrl = props.authToken
    ? `${baseWsUrl}${baseWsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(props.authToken)}`
    : baseWsUrl;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempt = 0;
  let closed = false;
  let status: SyncBridgeStatus = 'connecting';

  const setStatus = (nextStatus: SyncBridgeStatus) => {
    if (status === nextStatus) return;
    status = nextStatus;
    statusListeners.forEach((listener) => listener(status));
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const clearHeartbeatTimer = () => {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    clearHeartbeatTimer();
    setStatus('reconnecting');
    const delayMs = Math.min(8000, 900 + reconnectAttempt * 700);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const connect = () => {
    if (closed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

    setStatus(status === 'reconnecting' ? 'reconnecting' : 'connecting');
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      reconnectAttempt = 0;
      setStatus('connected');
      clearHeartbeatTimer();
      heartbeatTimer = setInterval(() => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify({ event: 'ping', sentAt: new Date().toISOString() }));
        } catch {
          socket?.close();
        }
      }, 15000);
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as CaptureAssetEvent;
        if ((payload as any)?.event === 'pong') return;
        if (payload?.event !== 'asset.created' || !payload.asset) return;
        emitToListeners(listeners, payload);
      } catch {
        // Ignore malformed payloads during development.
      }
    };
    socket.onclose = () => {
      clearHeartbeatTimer();
      socket = null;
      scheduleReconnect();
    };
    socket.onerror = () => {
      setStatus('offline');
      socket?.close();
    };
  };

  connect();

  return {
    mode: 'websocket',
    getStatus() {
      return status;
    },
    subscribeToStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      connect();

      return () => {
        statusListeners.delete(listener);
      };
    },
    async publishAsset(asset) {
      connect();

      try {
        const response = await fetch(`${httpUrl}/debug/assets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(props.authToken ? { Authorization: `Bearer ${props.authToken}` } : {}),
          },
          body: JSON.stringify({ asset }),
        });

        if (!response.ok) {
          throw new Error(`Failed to publish asset: ${response.status}`);
        }

        return { delivery: 'remote' };
      } catch {
        setStatus(socket?.readyState === WebSocket.OPEN ? 'connected' : 'offline');
        // Preserve the prototype flow when the debug server is unavailable.
        return publishLocally(listeners, asset);
      }
    },
    subscribeToAssets(listener) {
      listeners.add(listener);
      connect();

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearReconnectTimer();
          clearHeartbeatTimer();
        }
      };
    },
  };
}

const defaultBridge = createLocalSyncBridge();

const SyncBridgeContext = createContext<CaptureSyncBridge>(defaultBridge);

export function SyncBridgeProvider(props: {
  children: ReactNode;
  bridge?: CaptureSyncBridge;
}) {
  const bridge = useMemo(() => props.bridge ?? defaultBridge, [props.bridge]);
  return createElement(SyncBridgeContext.Provider, { value: bridge }, props.children);
}

export function useSyncBridge() {
  return useContext(SyncBridgeContext);
}

export function useSyncBridgeStatus() {
  const bridge = useSyncBridge();
  const [status, setStatus] = useState<SyncBridgeStatus>(() => bridge.getStatus());

  useEffect(() => bridge.subscribeToStatus(setStatus), [bridge]);

  return status;
}

export function createLocalBridge() {
  return createLocalSyncBridge();
}
