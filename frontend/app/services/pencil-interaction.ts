import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const EVENT_NAME = 'BsnPencilInteractionEvent';

export type PencilInteractionEventType = 'tap' | 'squeeze';
export type PencilInteractionPhase = 'began' | 'changed' | 'ended' | 'cancelled';

export type PencilHoverPose = {
  x: number;
  y: number;
  zOffset: number;
  azimuthAngle: number;
  altitudeAngle: number;
  rollAngle: number;
};

export type PencilInteractionEvent = {
  type: PencilInteractionEventType;
  phase?: PencilInteractionPhase;
  timestamp: number;
  preferredTapAction?: string;
  preferredSqueezeAction?: string;
  hoverPose?: PencilHoverPose;
};

export type PencilInteractionState = {
  available: boolean;
  installed: boolean;
  prefersPencilOnlyDrawing: boolean;
  prefersHoverToolPreview: boolean;
  preferredTapAction: string;
  preferredSqueezeAction: string;
};

type NativePencilInteractionModule = {
  start: () => void;
  stop: () => void;
  getState: () => Promise<PencilInteractionState>;
  addListener: (eventType: string) => void;
  removeListeners: (count: number) => void;
};

const nativeModule = Platform.OS === 'ios'
  ? NativeModules.BsnPencilInteraction as NativePencilInteractionModule | undefined
  : undefined;

const emitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

export function isPencilInteractionSupported() {
  return Platform.OS === 'ios' && Boolean(nativeModule);
}

export function startPencilInteraction() {
  nativeModule?.start();
}

export function getPencilInteractionState() {
  if (!nativeModule) {
    return Promise.resolve<PencilInteractionState>({
      available: false,
      installed: false,
      prefersPencilOnlyDrawing: false,
      prefersHoverToolPreview: false,
      preferredTapAction: 'unavailable',
      preferredSqueezeAction: 'unavailable',
    });
  }

  return nativeModule.getState();
}

export function addPencilInteractionListener(listener: (event: PencilInteractionEvent) => void) {
  if (!nativeModule || !emitter) {
    return { remove: () => undefined };
  }

  nativeModule.start();
  const subscription = emitter.addListener(EVENT_NAME, listener);
  return {
    remove: () => subscription.remove(),
  };
}
