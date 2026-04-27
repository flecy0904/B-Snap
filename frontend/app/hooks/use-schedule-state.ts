import { useEffect, useMemo, useState } from 'react';
import { semesterSchedules as fallbackSchedules, subjects as fallbackSubjects } from '../data';
import { currentSubjectId } from '../ui-helpers';
import { loadScheduleWorkspaceState, saveScheduleWorkspaceState } from '../storage/local-workspace-store';
import { Subject, SemesterSchedule, TimetableDay, TimetableEntry, TimetableSlotInput } from '../types';

const SUBJECT_PALETTE = [
  { color: '#C98F84', bgColor: '#F2CFC8', textColor: '#8F5B52' },
  { color: '#D0B56A', bgColor: '#F0E1AF', textColor: '#927A2E' },
  { color: '#A9C96F', bgColor: '#D8E8A8', textColor: '#6D8C35' },
  { color: '#8FBAB4', bgColor: '#C9E1DC', textColor: '#587F79' },
  { color: '#8A9FD8', bgColor: '#C9D4F4', textColor: '#566EA8' },
  { color: '#D5A16B', bgColor: '#EDCCA6', textColor: '#9B6940' },
];

const TIMETABLE_DAYS = new Set<TimetableDay>(['MON', 'TUE', 'WED', 'THU', 'FRI']);

function resolveTimetableDay(day: string): TimetableDay {
  const normalized = day.toUpperCase();
  return TIMETABLE_DAYS.has(normalized as TimetableDay) ? normalized as TimetableDay : 'MON';
}

function parseTimeToHour(value: string, fallback: number) {
  const [hourPart, minutePart] = value.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart ?? 0);

  if (!Number.isFinite(hour)) return fallback;
  return hour + (Number.isFinite(minute) ? minute : 0) / 60;
}

export function useScheduleState() {
  const [isReady, setIsReady] = useState(false);
  const [customSubjects, setCustomSubjects] = useState<Subject[]>(fallbackSubjects);
  const [customSchedules, setCustomSchedules] = useState<SemesterSchedule[]>(fallbackSchedules);

  const [semesterId, setSemesterId] = useState(fallbackSchedules[0].id);
  const [scheduleListOpen, setScheduleListOpen] = useState(false);
  const [addSubjectModalOpen, setAddSubjectModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [captureId, setCaptureId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    loadScheduleWorkspaceState().then((state) => {
      if (!mounted) return;
      if (state && state.userSubjects && state.userSchedules) {
        setCustomSubjects(state.userSubjects.length > 0 ? state.userSubjects : fallbackSubjects);
        setCustomSchedules(state.userSchedules.length > 0 ? state.userSchedules : fallbackSchedules);
        if (state.userSchedules.length > 0) {
          setSemesterId(state.userSchedules[0].id);
        }
      }
      setIsReady(true);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const timer = setTimeout(() => {
      saveScheduleWorkspaceState({
        version: 1,
        userSubjects: customSubjects,
        userSchedules: customSchedules,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [customSubjects, customSchedules, isReady]);

  const semester = useMemo(() => customSchedules.find((item) => item.id === semesterId) ?? customSchedules[0], [semesterId, customSchedules]);
  const semesterSubjects = useMemo(() => customSubjects.filter((item) => semester.entries.some((entry) => entry.subjectId === item.id)), [semester, customSubjects]);

  useEffect(() => {
    if (isReady && captureId === null) {
      setCaptureId(currentSubjectId(semester.entries) ?? semesterSubjects[0]?.id ?? 101);
    }
  }, [isReady, captureId, semester.entries, semesterSubjects]);

  const selectSemester = (id: string) => {
    const nextSemester = customSchedules.find((item) => item.id === id) ?? customSchedules[0];
    setSemesterId(id);
    if (captureId !== null && !nextSemester.entries.some((entry) => entry.subjectId === captureId)) {
      setCaptureId(nextSemester.entries[0]?.subjectId ?? captureId);
    }
    setScheduleListOpen(false);
  };

  const addSubject = (name: string, slots: TimetableSlotInput[]) => {
    const subjectName = name.trim();
    if (!subjectName) return;

    const newSubjectId = Date.now();
    const palette = SUBJECT_PALETTE[newSubjectId % SUBJECT_PALETTE.length];
    
    const newSubject: Subject = {
      id: newSubjectId,
      name: subjectName,
      color: palette.color,
      bgColor: palette.bgColor,
      textColor: palette.textColor,
      noteCount: 0,
    };

    const newEntries: TimetableEntry[] = slots.map((slot, index) => {
      const startHour = parseTimeToHour(slot.start, 9);
      const endHour = parseTimeToHour(slot.end, startHour + 1);
      return {
        id: newSubjectId + index,
        subjectId: newSubjectId,
        subject: subjectName,
        day: resolveTimetableDay(slot.day),
        startHour,
        duration: Math.max(0.5, endHour - startHour),
        location: slot.location || '미정',
      };
    });

    setCustomSubjects([...customSubjects, newSubject]);
    setCustomSchedules(current => current.map(sem => 
      sem.id === semesterId 
        ? { ...sem, entries: [...sem.entries, ...newEntries] } 
        : sem
    ));
    setAddSubjectModalOpen(false);
  };

  const removeSubject = (entryId: number) => {
    setCustomSchedules(current => current.map(sem => 
      sem.id === semesterId 
        ? { ...sem, entries: sem.entries.filter(e => e.id !== entryId) } 
        : sem
    ));
  };

  return {
    semester,
    semesterSubjects,
    semesterSchedules: customSchedules,
    scheduleListOpen,
    addSubjectModalOpen,
    editMode,
    captureId: captureId ?? 101,
    setCaptureId,
    openScheduleList: () => setScheduleListOpen(true),
    closeScheduleList: () => setScheduleListOpen(false),
    toggleScheduleList: () => setScheduleListOpen((current) => !current),
    openAddSubjectModal: () => setAddSubjectModalOpen(true),
    closeAddSubjectModal: () => setAddSubjectModalOpen(false),
    toggleEditMode: () => setEditMode((current) => !current),
    selectSemester,
    addSubject,
    removeSubject,
  };
}
