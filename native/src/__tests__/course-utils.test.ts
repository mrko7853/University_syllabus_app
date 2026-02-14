import { getCourseColorByType, parseCourseSchedule } from '@/src/utils/course';
import type { Course } from '@/src/types/course';

describe('course utils', () => {
  it('maps known course type colors and falls back for unknown values', () => {
    expect(getCourseColorByType('Understanding Japan and Kyoto')).toBe('#AED3F2');
    expect(getCourseColorByType('Unknown Type')).toBe('#E0E0E0');
  });

  it('parses japanese and english timeslots to day+period', () => {
    const jpCourse = { time_slot: '月曜日3講時' } as Course;
    const enCourse = { time_slot: 'Thu 14:55 - 16:25' } as Course;

    expect(parseCourseSchedule(jpCourse)).toEqual({ dayEN: 'Mon', period: 3 });
    expect(parseCourseSchedule(enCourse)).toEqual({ dayEN: 'Thu', period: 4 });
  });
});
