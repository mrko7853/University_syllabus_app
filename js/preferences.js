export const PREFERENCE_KEYS = {
  currentTerm: 'ila_current_term',
  language: 'ila_lang',
  timeFormat: 'ila_timefmt',
  weekStart: 'ila_weekstart',
  fullCardColors: 'ila_fullcardcolors',
  reduceMotion: 'ila_reducemotion'
}

export const DEFAULT_PREFERENCES = {
  language: 'en',
  timeFormat: '12',
  weekStart: 'mon',
  fullCardColors: true,
  reduceMotion: false
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    console.warn('Preferences: unable to read localStorage key', key, error)
    return null
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (error) {
    console.warn('Preferences: unable to write localStorage key', key, error)
    return false
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch (error) {
    console.warn('Preferences: unable to remove localStorage key', key, error)
    return false
  }
}

function parseBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const normalized = String(value).trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false
  }
  return fallback
}

function toStoredBoolean(value) {
  return value ? '1' : '0'
}

function normalizeLanguage(value) {
  return String(value || '').toLowerCase() === 'ja' ? 'ja' : 'en'
}

function normalizeTimeFormat(value) {
  return String(value || '') === '24' ? '24' : '12'
}

function normalizeWeekStart(value) {
  return String(value || '').toLowerCase() === 'sun' ? 'sun' : 'mon'
}

export function normalizeTermValue(value) {
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

export function parseTermValue(value) {
  const normalized = normalizeTermValue(value)
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

export function getPreferredTermValue() {
  return normalizeTermValue(readStorage(PREFERENCE_KEYS.currentTerm))
}

export function setPreferredTermValue(value) {
  const normalized = normalizeTermValue(value)
  if (!normalized) {
    removeStorage(PREFERENCE_KEYS.currentTerm)
    return null
  }

  writeStorage(PREFERENCE_KEYS.currentTerm, normalized)
  return normalized
}

export function applyPreferredTermToGlobals(value = getPreferredTermValue()) {
  const parsed = parseTermValue(value)
  if (!parsed.value) return parsed

  window.globalCurrentTerm = parsed.term
  window.globalCurrentYear = parsed.year
  return parsed
}

export function getStoredPreferences() {
  return {
    language: normalizeLanguage(readStorage(PREFERENCE_KEYS.language) || DEFAULT_PREFERENCES.language),
    timeFormat: normalizeTimeFormat(readStorage(PREFERENCE_KEYS.timeFormat) || DEFAULT_PREFERENCES.timeFormat),
    weekStart: normalizeWeekStart(readStorage(PREFERENCE_KEYS.weekStart) || DEFAULT_PREFERENCES.weekStart),
    fullCardColors: parseBoolean(readStorage(PREFERENCE_KEYS.fullCardColors), DEFAULT_PREFERENCES.fullCardColors),
    reduceMotion: parseBoolean(readStorage(PREFERENCE_KEYS.reduceMotion), DEFAULT_PREFERENCES.reduceMotion)
  }
}

export function setStoredPreference(key, value) {
  switch (key) {
    case PREFERENCE_KEYS.language:
      return writeStorage(key, normalizeLanguage(value))
    case PREFERENCE_KEYS.timeFormat:
      return writeStorage(key, normalizeTimeFormat(value))
    case PREFERENCE_KEYS.weekStart:
      return writeStorage(key, normalizeWeekStart(value))
    case PREFERENCE_KEYS.fullCardColors:
    case PREFERENCE_KEYS.reduceMotion:
      return writeStorage(key, toStoredBoolean(Boolean(value)))
    case PREFERENCE_KEYS.currentTerm: {
      const normalized = normalizeTermValue(value)
      if (!normalized) return false
      return writeStorage(key, normalized)
    }
    default:
      return writeStorage(key, String(value))
  }
}

export function clearStoredPreferences() {
  Object.values(PREFERENCE_KEYS).forEach((key) => removeStorage(key))
}

export function applyPreferencesToDocument(preferences = {}) {
  const merged = {
    ...DEFAULT_PREFERENCES,
    ...preferences
  }

  const html = document.documentElement
  const body = document.body

  if (html) {
    html.lang = normalizeLanguage(merged.language)
  }

  if (body) {
    const fullColorsEnabled = merged.fullCardColors !== false
    body.classList.toggle('reduced-motion', Boolean(merged.reduceMotion))
    body.classList.toggle('full-card-colors', fullColorsEnabled)
    body.classList.toggle('no-full-card-colors', !fullColorsEnabled)
  }

  return {
    language: normalizeLanguage(merged.language),
    timeFormat: normalizeTimeFormat(merged.timeFormat),
    weekStart: normalizeWeekStart(merged.weekStart),
    fullCardColors: merged.fullCardColors !== false,
    reduceMotion: Boolean(merged.reduceMotion)
  }
}

export function applyStoredPreferences() {
  return applyPreferencesToDocument(getStoredPreferences())
}
