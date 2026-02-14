import { formatDateInputValue, normalizeDateForStorage, parseDateFromInputValue } from '@/src/utils/date';

describe('date utils', () => {
  it('parses YYYY-MM-DD inputs into local Date objects', () => {
    const parsed = parseDateFromInputValue('2026-02-14');
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(1);
    expect(parsed?.getDate()).toBe(14);
  });

  it('normalizes due date to noon local time and formats correctly', () => {
    const parsed = parseDateFromInputValue('2026-03-09');
    const normalized = normalizeDateForStorage(parsed);

    expect(normalized?.getHours()).toBe(12);
    expect(formatDateInputValue(normalized)).toBe('2026-03-09');
  });
});
