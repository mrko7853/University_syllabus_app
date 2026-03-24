export const BLOCKED_SEMESTER_VALUES = new Set([
  'Spring-2024',
  'Fall-2024',
  'Spring-2025',
  'Fall-2025'
])

export const LATEST_ACTIVE_SEMESTER_VALUE = 'Spring-2026'

export function normalizeSemesterValue(value) {
  if (!value) return null

  const cleaned = String(value).trim().replace(/\s+/g, '-')
  const match = cleaned.match(/^([A-Za-z]+)-(\d{4})$/)
  if (!match) return null

  const termRaw = match[1].toLowerCase()
  const term = termRaw.charAt(0).toUpperCase() + termRaw.slice(1)
  const year = parseInt(match[2], 10)

  if (!Number.isFinite(year)) return null
  return `${term}-${year}`
}

export function parseSemesterValue(value) {
  const normalized = normalizeSemesterValue(value)
  if (!normalized) {
    return { term: null, year: null, value: null }
  }

  const [term, yearText] = normalized.split('-')
  const year = parseInt(yearText, 10)

  return {
    term,
    year: Number.isFinite(year) ? year : null,
    value: normalized
  }
}

export function isBlockedSemesterValue(value) {
  const normalized = normalizeSemesterValue(value)
  if (!normalized) return false
  return BLOCKED_SEMESTER_VALUES.has(normalized)
}

export function coerceSemesterValue(value, fallbackValue = LATEST_ACTIVE_SEMESTER_VALUE) {
  const normalized = normalizeSemesterValue(value)
  if (!normalized) return null

  if (!isBlockedSemesterValue(normalized)) {
    return normalized
  }

  const fallback = normalizeSemesterValue(fallbackValue)
  return fallback || null
}

export function filterBlockedSemesters(semesters = []) {
  if (!Array.isArray(semesters) || semesters.length === 0) return []

  return semesters.filter((semester) => {
    const value = normalizeSemesterValue(`${semester?.term || ''}-${semester?.year || ''}`)
    return Boolean(value && !isBlockedSemesterValue(value))
  })
}
