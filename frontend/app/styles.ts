import { Platform, StyleSheet } from 'react-native';
import { C, sharedStyles } from './styles/shared';
import { scheduleStyles } from './styles/schedule';
import { notesStyles } from './styles/notes';
import { captureStyles } from './styles/capture';
import { profileStyles } from './styles/profile';

export { C };

const rawStyles = {
  ...sharedStyles,
  ...scheduleStyles,
  ...notesStyles,
  ...captureStyles,
  ...profileStyles,
};

type LooseStyle = Record<string, unknown>;
type StyleRegistry = Record<keyof typeof rawStyles, any>;
type ShadowOffset = { width?: number; height?: number };

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return `rgba(31, 41, 55, ${opacity})`;

  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function normalizeStyleForPlatform(style: LooseStyle) {
  if (Platform.OS !== 'web') return style;

  const { shadowColor, shadowOpacity, shadowRadius, shadowOffset, elevation, ...rest } = style;
  if (!shadowColor && !shadowOpacity && !shadowRadius && !shadowOffset && !elevation) return style;

  const numericElevation = typeof elevation === 'number' ? elevation : 0;
  const offset = (shadowOffset && typeof shadowOffset === 'object' ? shadowOffset : { width: 0, height: numericElevation ? Math.max(2, numericElevation) : 0 }) as ShadowOffset;
  const radius = typeof shadowRadius === 'number' ? shadowRadius : numericElevation ? numericElevation * 2 : 0;
  const opacity = typeof shadowOpacity === 'number' ? shadowOpacity : 0.16;
  const color = typeof shadowColor === 'string' ? shadowColor : '#1F2937';

  return {
    ...rest,
    boxShadow: `${offset.width ?? 0}px ${offset.height ?? 0}px ${radius}px ${hexToRgba(color, opacity)}`,
  };
}

const platformStyles = Object.fromEntries(
  Object.entries(rawStyles).map(([key, value]) => [key, normalizeStyleForPlatform(value as LooseStyle)]),
);

export const S = StyleSheet.create(platformStyles as StyleRegistry) as StyleRegistry;
export type AppStyles = typeof S;
