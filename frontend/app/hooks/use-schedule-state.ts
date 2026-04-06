import { useMemo, useState } from 'react';
import { semesterSchedules, subjects, timetable } from '../data';
import { currentSubjectId } from '../ui-helpers';

export function useScheduleState() {
  const [semesterId, setSemesterId] = useState(semesterSchedules[0].id);
  const [scheduleListOpen, setScheduleListOpen] = useState(false);
  const [captureId, setCaptureId] = useState(currentSubjectId(timetable) ?? subjects[0]?.id ?? 101);

  const semester = useMemo(() => semesterSchedules.find((item) => item.id === semesterId) ?? semesterSchedules[0], [semesterId]);
  const semesterSubjects = useMemo(() => subjects.filter((item) => semester.entries.some((entry) => entry.subjectId === item.id)), [semester]);

  const selectSemester = (id: string) => {
    const nextSemester = semesterSchedules.find((item) => item.id === id) ?? semesterSchedules[0];
    setSemesterId(id);
    if (!nextSemester.entries.some((entry) => entry.subjectId === captureId)) {
      setCaptureId(nextSemester.entries[0]?.subjectId ?? captureId);
    }
    setScheduleListOpen(false);
  };

  return {
    semester,
    semesterSubjects,
    semesterSchedules,
    scheduleListOpen,
    captureId,
    setCaptureId,
    openScheduleList: () => setScheduleListOpen(true),
    closeScheduleList: () => setScheduleListOpen(false),
    toggleScheduleList: () => setScheduleListOpen((current) => !current),
    selectSemester,
  };
}
