import { TimetableEntry } from './types';

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
export const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금' } as const;
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export function visibleHours(entries: TimetableEntry[]) {
  const latest = entries.reduce((max, entry) => Math.max(max, entry.startHour + entry.duration), 16);
  const endHour = Math.min(20, Math.max(16, Math.ceil(latest)));
  return HOURS.filter((hour) => hour <= endHour);
}

export function darkenHex(hex: string, amount = 0.2) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const r = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(0, 2), 16) * (1 - amount))));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(2, 4), 16) * (1 - amount))));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(4, 6), 16) * (1 - amount))));
  return `rgb(${r}, ${g}, ${b})`;
}

export function currentSubjectId(entries: TimetableEntry[]) {
  const now = new Date();
  const day = DAYS[now.getDay() - 1];
  const hour = now.getHours() + now.getMinutes() / 60;
  return entries.find((entry) => entry.day === day && hour >= entry.startHour && hour < entry.startHour + entry.duration)?.subjectId ?? null;
}
