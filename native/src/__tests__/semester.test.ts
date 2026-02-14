import { normalizeTerm, sortSemesters } from '@/src/utils/semester';

describe('semester utilities', () => {
  it('normalizes terms from mixed casing and japanese labels', () => {
    expect(normalizeTerm('fall')).toBe('Fall');
    expect(normalizeTerm('SPRING')).toBe('Spring');
    expect(normalizeTerm('秋学期')).toBe('Fall');
    expect(normalizeTerm('春学期')).toBe('Spring');
  });

  it('sorts semesters by year descending and Fall before Spring', () => {
    const sorted = sortSemesters([
      { term: 'Spring', year: 2025, label: 'Spring 2025' },
      { term: 'Fall', year: 2026, label: 'Fall 2026' },
      { term: 'Fall', year: 2025, label: 'Fall 2025' },
    ]);

    expect(sorted.map((entry) => entry.label)).toEqual(['Fall 2026', 'Fall 2025', 'Spring 2025']);
  });
});
