import type { Weekday } from '@/src/types/course';

export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const DAY_LABELS: Record<Weekday, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
};

export interface PeriodDefinition {
  number: number;
  label: string;
  timeRange: string;
  start: number;
  end: number;
}

export const PERIOD_DEFINITIONS: PeriodDefinition[] = [
  { number: 1, label: 'Period 1', timeRange: '09:00 - 10:30', start: 9 * 60, end: 10 * 60 + 30 },
  { number: 2, label: 'Period 2', timeRange: '10:45 - 12:15', start: 10 * 60 + 45, end: 12 * 60 + 15 },
  { number: 3, label: 'Period 3', timeRange: '13:10 - 14:40', start: 13 * 60 + 10, end: 14 * 60 + 40 },
  { number: 4, label: 'Period 4', timeRange: '14:55 - 16:25', start: 14 * 60 + 55, end: 16 * 60 + 25 },
  { number: 5, label: 'Period 5', timeRange: '16:40 - 18:10', start: 16 * 60 + 40, end: 18 * 60 + 10 },
];
