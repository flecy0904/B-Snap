import { SemesterSchedule, Subject, UserProfile } from './types';

export const subjects: Subject[] = [
  { id: 101, name: '최신모바일시스템기술1', color: '#C98F84', bgColor: '#F2CFC8', textColor: '#8F5B52', noteCount: 0 },
  { id: 102, name: '컴퓨터네트워크', color: '#D0B56A', bgColor: '#F0E1AF', textColor: '#927A2E', noteCount: 0 },
  { id: 103, name: '통계학', color: '#A9C96F', bgColor: '#D8E8A8', textColor: '#6D8C35', noteCount: 0 },
  { id: 104, name: '실무중심산학협력프로젝트1', color: '#8FBAB4', bgColor: '#C9E1DC', textColor: '#587F79', noteCount: 0 },
  { id: 105, name: '강화학습', color: '#8A9FD8', bgColor: '#C9D4F4', textColor: '#566EA8', noteCount: 0 },
  { id: 106, name: 'IoT시스템', color: '#D5A16B', bgColor: '#EDCCA6', textColor: '#9B6940', noteCount: 0 },
];

export const semesterSchedules: SemesterSchedule[] = [
  {
    id: '2026-1',
    label: '2026년 1학기',
    entries: [
      { id: 1, subjectId: 101, day: 'MON', subject: '최신모바일시스템기술1', startHour: 9, duration: 1.5, location: '국제506' },
      { id: 2, subjectId: 102, day: 'MON', subject: '컴퓨터네트워크', startHour: 10.5, duration: 1.5, location: '국제402' },
      { id: 3, subjectId: 103, day: 'MON', subject: '통계학', startHour: 12, duration: 2, location: '상경505' },
      { id: 4, subjectId: 104, day: 'MON', subject: '실무중심산학협력프로젝트1(캡스톤디자인-MS)', startHour: 14, duration: 2, location: '국제608' },
      { id: 5, subjectId: 102, day: 'TUE', subject: '컴퓨터네트워크', startHour: 9, duration: 1.5, location: '국제401' },
      { id: 6, subjectId: 105, day: 'TUE', subject: '강화학습', startHour: 14, duration: 2, location: '국제506' },
      { id: 7, subjectId: 103, day: 'WED', subject: '통계학', startHour: 15, duration: 1.5, location: '상경505' },
      { id: 8, subjectId: 101, day: 'THU', subject: '최신모바일시스템기술1', startHour: 9, duration: 1.5, location: '국제506' },
      { id: 9, subjectId: 105, day: 'THU', subject: '강화학습', startHour: 10.5, duration: 1.5, location: '국제506' },
      { id: 10, subjectId: 106, day: 'THU', subject: 'IoT시스템', startHour: 12.5, duration: 2.5, location: '국제210' },
    ],
  },
];

export const timetable = semesterSchedules[0].entries;

export const profile: UserProfile = {
  name: '안기범',
  studentId: '학번 미설정',
  department: '단국대학교 모바일시스템공학과',
  semester: semesterSchedules[0].label,
};
