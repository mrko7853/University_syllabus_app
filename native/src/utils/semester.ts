import type { Semester, Term } from '@/src/types/course';

export function normalizeTerm(term: string): Term {
  const lower = term.trim().toLowerCase();
  if (lower.includes('fall') || term.includes('秋')) return 'Fall';
  if (lower.includes('spring') || term.includes('春')) return 'Spring';
  return lower === 'fall' ? 'Fall' : 'Spring';
}

export function sortSemesters(input: Semester[]): Semester[] {
  return [...input].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.term === 'Fall' && b.term === 'Spring') return -1;
    if (a.term === 'Spring' && b.term === 'Fall') return 1;
    return 0;
  });
}
