export type Term = 'Fall' | 'Spring';

export interface Semester {
  term: Term;
  year: number;
  label: string;
}

export interface Course {
  course_code: string;
  title: string;
  title_short?: string | null;
  professor?: string | null;
  term: string;
  academic_year: number;
  time_slot?: string | null;
  type?: string | null;
  location?: string | null;
  url?: string | null;
  gpa_a_percent?: number | null;
  gpa_b_percent?: number | null;
  gpa_c_percent?: number | null;
  gpa_d_percent?: number | null;
  gpa_f_percent?: number | null;
}

export interface CourseSelection {
  code: string;
  year: number;
  term?: string;
  title?: string;
  type?: string;
}

export interface ParsedSchedule {
  dayEN: Weekday;
  period: number;
}

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
