import { supabase } from '@/src/lib/supabase';
import type { Course, CourseSelection, Semester } from '@/src/types/course';
import { normalizeTerm, sortSemesters } from '@/src/utils/semester';

const defaultSemesters: Semester[] = [
  { term: 'Fall', year: 2025, label: 'Fall 2025' },
  { term: 'Spring', year: 2025, label: 'Spring 2025' },
  { term: 'Fall', year: 2024, label: 'Fall 2024' },
];

export async function fetchAvailableSemesters(): Promise<Semester[]> {
  const { data, error } = await supabase
    .from('courses')
    .select('term, academic_year')
    .order('academic_year', { ascending: false });

  if (error || !data || data.length === 0) {
    return defaultSemesters;
  }

  const semesterMap = new Map<string, Semester>();
  data.forEach((row) => {
    if (!row.term || !row.academic_year) return;

    const term = normalizeTerm(String(row.term));
    const year = Number(row.academic_year);
    const key = `${term}-${year}`;

    if (!semesterMap.has(key)) {
      semesterMap.set(key, {
        term,
        year,
        label: `${term} ${year}`,
      });
    }
  });

  const semesters = sortSemesters(Array.from(semesterMap.values()));
  return semesters.length > 0 ? semesters : defaultSemesters;
}

export async function fetchCourseData(year: number | string, term: string): Promise<Course[]> {
  const normalizedYear = Number(year);
  const normalizedTerm = normalizeTerm(term);

  const { data, error } = await supabase
    .from('courses')
    .select(`
      *,
      gpa_a_percent,
      gpa_b_percent,
      gpa_c_percent,
      gpa_d_percent,
      gpa_f_percent
    `)
    .eq('academic_year', normalizedYear)
    .eq('term', normalizedTerm);

  if (error) throw error;
  return (data as Course[]) ?? [];
}

export async function fetchUserSelectedCourseCodes(
  userId: string,
  year: number | string,
  term: string
): Promise<CourseSelection[]> {
  const normalizedYear = Number(year);
  const normalizedTerm = normalizeTerm(term);

  const { data, error } = await supabase
    .from('profiles')
    .select('courses_selection')
    .eq('id', userId)
    .single();

  if (error || !data?.courses_selection) return [];

  const selections = data.courses_selection as CourseSelection[];

  return selections.filter((selection) => {
    const selectionYear = Number(selection.year);
    return selectionYear === normalizedYear && (!selection.term || normalizeTerm(selection.term) === normalizedTerm);
  });
}
