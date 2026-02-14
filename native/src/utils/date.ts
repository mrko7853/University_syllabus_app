export function parseDateFromInputValue(value: string): Date | null {
  if (!value) return null;

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, month, day);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateInputValue(date: Date | null | undefined): string {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeDateForStorage(date: Date | null | undefined): Date | null {
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
}

export function toDateLabel(value: string | null | undefined): string {
  if (!value) return 'No due date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No due date';
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getMonthMatrix(date: Date): Array<Array<Date | null>> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const daysInMonth = lastDay.getDate();
  const startWeekDay = firstDay.getDay();

  const matrix: Array<Array<Date | null>> = [];
  let cursor = 1 - startWeekDay;

  while (cursor <= daysInMonth) {
    const week: Array<Date | null> = [];
    for (let i = 0; i < 7; i += 1) {
      if (cursor < 1 || cursor > daysInMonth) {
        week.push(null);
      } else {
        week.push(new Date(year, month, cursor));
      }
      cursor += 1;
    }
    matrix.push(week);
  }

  return matrix;
}
