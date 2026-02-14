import { PERIOD_DEFINITIONS } from '@/src/constants/calendar';
import type { Course, ParsedSchedule } from '@/src/types/course';

const courseTypeColors: Record<string, string> = {
  'Introductory Seminars': '#FFFF89',
  'Intermediate Seminars': '#FFFF89',
  'Advanced Seminars and Honors Thesis': '#FFFF89',
  'Academic and Research Skills': '#A0BEE8',
  'Understanding Japan and Kyoto': '#AED3F2',
  'Japanese Society and Global Culture Concentration': '#C1E0C8',
  'Japanese Business and the Global Economy Concentration': '#EFDC8F',
  'Japanese Politics and Global Studies Concentration': '#E6A4AE',
  'Other Elective Courses': '#CCCCFF',
};

const defaultCourseColor = '#E0E0E0';

export function getCourseColorByType(courseType?: string | null): string {
  if (!courseType) return defaultCourseColor;
  return courseTypeColors[courseType] || defaultCourseColor;
}

export function normalizeCourseTitle(title?: string | null): string {
  if (!title) return '';

  let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  normalized = normalized.replace(/　/g, ' ');
  normalized = normalized.replace(/[()（）]/g, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

export function parseCourseSchedule(course: Course): ParsedSchedule | null {
  if (!course.time_slot) return null;

  const jpMatch = course.time_slot.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
  if (jpMatch) {
    const dayMap: Record<string, ParsedSchedule['dayEN'] | null> = {
      '月': 'Mon',
      '火': 'Tue',
      '水': 'Wed',
      '木': 'Thu',
      '金': 'Fri',
      '土': null,
      '日': null,
    };
    const dayEN = dayMap[jpMatch[1]];
    const period = Number.parseInt(jpMatch[2], 10);
    if (!dayEN || period < 1 || period > 5) return null;
    return { dayEN, period };
  }

  const enMatch = course.time_slot.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
  if (!enMatch) return null;

  const dayEN = enMatch[1] as ParsedSchedule['dayEN'];
  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(dayEN)) return null;

  const startHour = Number.parseInt(enMatch[2], 10);
  const startMinute = Number.parseInt(enMatch[3], 10);
  const startMinutes = startHour * 60 + startMinute;

  const matchedPeriod = PERIOD_DEFINITIONS.find((period) => startMinutes >= period.start && startMinutes < period.end);
  if (!matchedPeriod) return null;

  return { dayEN, period: matchedPeriod.number };
}
