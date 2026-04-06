import React from 'react';
import { DesktopScheduleView } from '../components/desktop-schedule-view';
import { MobileScheduleView } from '../components/mobile-schedule-view';
import type { SemesterSchedule } from '../types';

export interface MobileScheduleProps {
  semester: SemesterSchedule;
  semesters: SemesterSchedule[];
  listOpen: boolean;
  onToggleList: () => void;
  onCloseList: () => void;
  onSelectSemester: (id: string) => void;
  onOpenSubject: (id: number) => void;
  styles: any;
}

export interface DesktopScheduleProps {
  semester: SemesterSchedule;
  onOpenSubject: (id: number) => void;
  compact: boolean;
  styles: any;
}

export function MobileSchedule(props: MobileScheduleProps) {
  return <MobileScheduleView {...props} />;
}

export function DesktopSchedule(props: DesktopScheduleProps) {
  return <DesktopScheduleView {...props} />;
}
