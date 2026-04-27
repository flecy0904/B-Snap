import React from 'react';
import { DesktopScheduleView } from '../components/desktop-schedule-view';
import { MobileScheduleView } from '../components/mobile-schedule-view';
import type { SemesterSchedule, Subject, TimetableSlotInput } from '../types';

export interface MobileScheduleProps {
  semester: SemesterSchedule;
  semesters: SemesterSchedule[];
  subjects: Subject[];
  listOpen: boolean;
  addModalOpen: boolean;
  editMode: boolean;
  onToggleList: () => void;
  onCloseList: () => void;
  onSelectSemester: (id: string) => void;
  onOpenSubject: (id: number) => void;
  onOpenAddModal: () => void;
  onCloseAddModal: () => void;
  onToggleEditMode: () => void;
  onAddSubject: (name: string, slots: TimetableSlotInput[]) => void;
  onRemoveSubject: (entryId: number) => void;
  styles: any;
}

export interface DesktopScheduleProps {
  semester: SemesterSchedule;
  subjects: Subject[];
  addModalOpen: boolean;
  editMode: boolean;
  onOpenSubject: (id: number) => void;
  onOpenAddModal: () => void;
  onCloseAddModal: () => void;
  onToggleEditMode: () => void;
  onAddSubject: (name: string, slots: TimetableSlotInput[]) => void;
  onRemoveSubject: (entryId: number) => void;
  compact: boolean;
  styles: any;
}

export function MobileSchedule(props: MobileScheduleProps) {
  return <MobileScheduleView {...props} />;
}

export function DesktopSchedule(props: DesktopScheduleProps) {
  return <DesktopScheduleView {...props} />;
}
