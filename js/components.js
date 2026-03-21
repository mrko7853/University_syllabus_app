import { supabase } from "../supabase.js";
import { fetchCourseData, openCourseInfoMenu, getCourseColorByType, fetchAvailableSemesters, openCourseSearchForSlot, formatProfessorDisplayName } from "./shared.js";
import { withBase } from "./path-utils.js";
import {
  applyPreferredTermToGlobals,
  applyStoredPreferences,
  inferCurrentSemesterValue,
  getPreferredTermValue,
  normalizeTermValue,
  resolvePreferredTermForAvailableSemesters,
  setPreferredTermValue
} from "./preferences.js";
import { openSemesterMobileSheet } from "./semester-mobile-sheet.js";
import { readSavedCourses, syncSavedCoursesForUser } from "./saved-courses.js";
import guestScreen2 from "../assets/screen2.png";
import guestScreenCtaMobile from "../assets/screen-cta-mobile.png";
function bootstrapStoredPreferences() {
  const applyBootPreferences = () => {
    applyStoredPreferences();
    const preferredTerm = getPreferredTermValue();
    if (preferredTerm) {
      const parsed = applyPreferredTermToGlobals(preferredTerm);
      if (parsed?.term && parsed?.year) {
        const termInput = document.getElementById('term-select');
        const yearInput = document.getElementById('year-select');
        if (termInput) termInput.value = parsed.term;
        if (yearInput) yearInput.value = String(parsed.year);
      }
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBootPreferences, { once: true });
    return;
  }
  applyBootPreferences();
}
bootstrapStoredPreferences();
function syncAppViewportHeight() {
  const root = document.documentElement;
  if (!root) return;
  const viewportHeight = Math.round(
    window.visualViewport?.height
    || window.innerHeight
    || document.documentElement.clientHeight
    || 0
  );
  if (viewportHeight <= 0) return;
  root.style.setProperty('--vh', `${viewportHeight * 0.01}px`);
  root.style.setProperty('--app-height', `${viewportHeight}px`);
}
function initializeAppViewportHeightSync() {
  if (window.__appViewportHeightSyncBound) return;
  window.__appViewportHeightSyncBound = true;
  syncAppViewportHeight();
  window.addEventListener('resize', syncAppViewportHeight, { passive: true });
  window.addEventListener('orientationchange', () => {
    window.setTimeout(syncAppViewportHeight, 250);
  }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppViewportHeight);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    syncAppViewportHeight();
  });
}
initializeAppViewportHeightSync();
// Helper function to normalize course titles
function normalizeCourseTitle(title) {
  if (!title) return title;
  // Convert full-width characters to normal characters
  let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (char) {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  });
  // Convert full-width spaces to normal spaces
  normalized = normalized.replace(/　/g, ' ');
  // Remove parentheses and their contents
  normalized = normalized.replace(/[()（）]/g, '');
  // Clean up extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}
// Helper function to normalize short titles for Next Class display
function normalizeShortTitle(shortTitle) {
  if (!shortTitle) return shortTitle;
  // Convert full-width characters to normal width
  let normalized = shortTitle.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (char) {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  });
  // Convert full-width spaces to normal spaces
  normalized = normalized.replace(/　/g, ' ');
  // Remove ○ symbol
  normalized = normalized.replace(/○/g, '');
  // Remove parentheses
  normalized = normalized.replace(/[()（）]/g, '');
  // Clean up extra spaces and convert to UPPERCASE
  normalized = normalized.replace(/\s+/g, ' ').trim().toUpperCase();
  return normalized;
}
const HOME_DESKTOP_BREAKPOINT = 1024;
const HOME_SEMESTER_MIN_CREDITS = 2;
const HOME_SEMESTER_MAX_CREDITS = 24;
const HOME_OPEN_ASSIGNMENT_INTENT_KEY = 'ila_open_assignment_id';
const HOME_DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HOME_DAY_SHORT_LABELS = {
  Mon: 'Mon',
  Tue: 'Tue',
  Wed: 'Wed',
  Thu: 'Thu',
  Fri: 'Fri'
};
const HOME_PERIODS = [
  { period: 1, start: '09:00', end: '10:30', filterValue: '09:00' },
  { period: 2, start: '10:45', end: '12:15', filterValue: '10:45' },
  { period: 3, start: '13:10', end: '14:40', filterValue: '13:10' },
  { period: 4, start: '14:55', end: '16:25', filterValue: '14:55' },
  { period: 5, start: '16:40', end: '18:10', filterValue: '16:40' },
  { period: 6, start: '18:25', end: '19:55', filterValue: '18:25' }
];
const HOME_PERIOD_BY_NUMBER = HOME_PERIODS.reduce((acc, slot) => {
  acc[slot.period] = slot;
  return acc;
}, {});
const HOME_REVIEW_SUGGESTION_OPEN_REVIEW_KEY = 'ila_open_review_from_suggestion';
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function highlightHomeSearchMatch(value, query) {
  const text = String(value || '');
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery || normalizedQuery.length < 2) {
    return escapeHtml(text);
  }
  const pattern = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig');
  return text
    .split(pattern)
    .map((part, index) => {
      if (index % 2 === 1) {
        return `<mark class="home-search-match">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join('');
}
function normalizeTermName(termValue) {
  if (!termValue) return 'Fall';
  const raw = String(termValue).trim();
  if (raw.includes('/')) {
    return normalizeTermName(raw.split('/').pop());
  }
  const lowered = raw.toLowerCase();
  if (lowered.includes('fall') || raw.includes('秋')) return 'Fall';
  if (lowered.includes('spring') || raw.includes('春')) return 'Spring';
  if (!raw) return 'Fall';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}
function parseSemesterValue(value) {
  const normalized = normalizeTermValue(String(value || '').replace('/', '-'));
  if (!normalized) return { term: null, year: null, value: null };
  const [term, yearText] = normalized.split('-');
  const year = parseInt(yearText, 10);
  return {
    term,
    year: Number.isFinite(year) ? year : null,
    value: normalized
  };
}
function formatSemesterValue(term, year) {
  if (!term || !year) return null;
  return normalizeTermValue(`${normalizeTermName(term)}-${year}`);
}
function getCurrentHomeSemesterContext() {
  const inferred = inferCurrentSemesterValue();
  const yearValue = window.getCurrentYear
    ? window.getCurrentYear()
    : parseInt(document.getElementById('year-select')?.value || inferred.year, 10);
  const termValue = window.getCurrentTerm
    ? window.getCurrentTerm()
    : document.getElementById('term-select')?.value || inferred.term;
  return {
    year: Number.isFinite(Number(yearValue)) ? Number(yearValue) : inferred.year,
    term: normalizeTermName(termValue)
  };
}
function filterSavedCoursesBySemester(savedCourses, year, term) {
  const targetYear = Number(year);
  const targetTerm = normalizeTermName(term);
  if (!Array.isArray(savedCourses) || !Number.isFinite(targetYear) || !targetTerm) return [];
  return savedCourses.filter((savedCourse) => {
    const savedYear = Number(savedCourse?.year);
    const savedTerm = normalizeTermName(savedCourse?.term);
    return savedYear === targetYear && savedTerm === targetTerm;
  });
}
function parseCreditsValue(rawCredits) {
  if (rawCredits === null || rawCredits === undefined || rawCredits === '') return 0;
  if (typeof rawCredits === 'number') return Number.isFinite(rawCredits) ? rawCredits : 0;
  const matched = String(rawCredits).match(/(\d+(\.\d+)?)/);
  if (!matched) return 0;
  const parsed = parseFloat(matched[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}
function getPeriodMeta(period) {
  return HOME_PERIOD_BY_NUMBER[Number(period)] || null;
}
function formatSlotLabel(day, period) {
  return `${HOME_DAY_SHORT_LABELS[day] || day} • P${period}`;
}
function formatPeriodWindow(period) {
  const meta = getPeriodMeta(period);
  return meta ? `${meta.start} - ${meta.end}` : '';
}
function mapStartTimeToHomePeriod(startHour, startMinute) {
  const numericStart = (Number(startHour) * 100) + Number(startMinute);
  if (numericStart >= 900 && numericStart < 1030) return 1;
  if (numericStart >= 1045 && numericStart < 1215) return 2;
  if (numericStart >= 1310 && numericStart < 1440) return 3;
  if (numericStart >= 1455 && numericStart < 1625) return 4;
  if (numericStart >= 1640 && numericStart < 1810) return 5;
  if (numericStart >= 1825 && numericStart < 1955) return 6;
  return null;
}
function normalizeCourseDayToken(dayToken) {
  const raw = String(dayToken || '').trim();
  if (!raw) return null;
  const jpMatch = raw.match(/[月火水木金土日]/);
  if (jpMatch) {
    const dayMap = { 月: 'Mon', 火: 'Tue', 水: 'Wed', 木: 'Thu', 金: 'Fri', 土: 'Sat', 日: 'Sun' };
    return dayMap[jpMatch[0]] || null;
  }
  const lowered = raw.replace(/\./g, '').toLowerCase();
  if (lowered.startsWith('mon')) return 'Mon';
  if (lowered.startsWith('tue')) return 'Tue';
  if (lowered.startsWith('wed')) return 'Wed';
  if (lowered.startsWith('thu')) return 'Thu';
  if (lowered.startsWith('fri')) return 'Fri';
  if (lowered.startsWith('sat')) return 'Sat';
  if (lowered.startsWith('sun')) return 'Sun';
  return null;
}
function parseCourseMeetingSlots(timeSlot, fallbackDay = null, fallbackPeriod = null) {
  const raw = String(timeSlot || '').trim();
  const slots = [];
  const seen = new Set();
  const addSlot = (dayToken, periodValue, explicitTimeLabel = '') => {
    const day = normalizeCourseDayToken(dayToken);
    const period = Number(periodValue);
    if (!day || !Number.isFinite(period) || period < 1 || period > 6) return;
    const key = `${day}-${period}`;
    if (seen.has(key)) return;
    seen.add(key);
    slots.push({
      day,
      period,
      key,
      timeLabel: explicitTimeLabel || formatPeriodWindow(period)
    });
  };
  if (raw) {
    const jpRegex = /([月火水木金土日])(?:曜日)?\s*([1-6])(?:講時)?/g;
    let jpMatch = jpRegex.exec(raw);
    while (jpMatch) {
      addSlot(jpMatch[1], Number(jpMatch[2]));
      jpMatch = jpRegex.exec(raw);
    }
    const enRegex = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\s+(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/gi;
    let enMatch = enRegex.exec(raw);
    while (enMatch) {
      const period = mapStartTimeToHomePeriod(parseInt(enMatch[2], 10), parseInt(enMatch[3], 10));
      const hasEnd = enMatch[4] !== undefined && enMatch[5] !== undefined;
      const timeLabel = hasEnd
        ? `${String(enMatch[2]).padStart(2, '0')}:${String(enMatch[3]).padStart(2, '0')} - ${String(enMatch[4]).padStart(2, '0')}:${String(enMatch[5]).padStart(2, '0')}`
        : '';
      addSlot(enMatch[1], period, timeLabel);
      enMatch = enRegex.exec(raw);
    }
  }
  if (
    slots.length === 0
    && fallbackDay !== null
    && fallbackDay !== undefined
    && fallbackPeriod !== null
    && fallbackPeriod !== undefined
  ) {
    addSlot(fallbackDay, fallbackPeriod);
  }
  return slots;
}
function parseCourseTimeSlot(timeSlot, fallbackDay = null, fallbackPeriod = null) {
  const slots = parseCourseMeetingSlots(timeSlot, fallbackDay, fallbackPeriod);
  if (slots.length === 0) return null;
  const first = slots[0];
  return { day: first.day, period: first.period, timeLabel: first.timeLabel };
}
function formatDueDateLabel(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}
function getDaysUntilDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
function navigateToRoute(path) {
  if (!path) return;
  if (window.router?.navigate) {
    window.router.navigate(path);
    return;
  }
  window.location.href = withBase(path);
}
function navigateToSlotCourseSearch(day, period, term, year) {
  openCourseSearchForSlot({
    day,
    period: Number(period),
    term: normalizeTermName(term),
    year: Number(year) || null,
    source: 'home-planner'
  });
}
function navigateToDayCourseSearch(day, term, year) {
  openCourseSearchForSlot({
    day,
    term: normalizeTermName(term),
    year: Number(year) || null,
    source: 'home-calendar-day'
  });
}
function isSemesterSelectionTarget(target) {
  const targetId = target?.id;
  if (!targetId) return false;
  return (
    targetId === 'semester-select'
    || targetId === 'semester-select-mobile'
    || targetId === 'term-select'
    || targetId === 'year-select'
  );
}
let homePlannerDataCache = {
  key: null,
  updatedAt: 0,
  data: null,
  pending: null
};
function invalidateHomePlannerDataCache() {
  homePlannerDataCache = {
    key: null,
    updatedAt: 0,
    data: null,
    pending: null
  };
}
async function fetchHomePlannerData() {
  const { year, term } = getCurrentHomeSemesterContext();
  const normalizedTerm = normalizeTermName(term);
  const selectedSemesterValue = formatSemesterValue(term, year);
  let savedCourses = [];
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user || null;
  const emptySlotsFallback = HOME_DAY_ORDER.flatMap((day) =>
    HOME_PERIODS.map((slot) => ({
      day,
      period: slot.period,
      label: formatSlotLabel(day, slot.period)
    }))
  );
  if (!user) {
    return {
      isAuthenticated: false,
      user: null,
      year,
      term,
      selectedSemesterValue,
      userCourses: [],
      selectedCourseEntries: [],
      emptySlots: emptySlotsFallback,
      occupiedSlotsCount: 0,
      conflicts: [],
      creditsTotal: 0,
      courseCount: 0,
      typeBreakdown: [],
      assignmentsDueSoon: [],
      savedCourses: []
    };
  }
  try {
    savedCourses = await syncSavedCoursesForUser(user.id);
  } catch (savedSyncError) {
    console.warn('Unable to sync saved courses for user:', savedSyncError);
    savedCourses = readSavedCourses(Number.POSITIVE_INFINITY);
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('courses_selection')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;
  const selectedCourseEntries = Array.isArray(profile?.courses_selection) ? profile.courses_selection : [];
  const selectedForSemester = selectedCourseEntries.filter((course) => {
    const courseYear = Number(course?.year);
    const courseTerm = course?.term ? normalizeTermName(course.term) : null;
    return courseYear === Number(year) && (!courseTerm || courseTerm === normalizedTerm);
  });
  let userCourses = [];
  let typeBreakdown = [];
  let creditsTotal = 0;
  if (selectedForSemester.length > 0) {
    const semesterCourses = await fetchCourseData(year, normalizedTerm);
    const selectionCodes = new Set(selectedForSemester.map((course) => String(course?.code || '').trim()).filter(Boolean));
    userCourses = (semesterCourses || []).filter((course) => selectionCodes.has(String(course?.course_code || '').trim()));
    const breakdownMap = new Map();
    userCourses.forEach((course) => {
      const type = String(course?.type || 'General').trim() || 'General';
      const credits = parseCreditsValue(course?.credits);
      creditsTotal += credits;
      const existing = breakdownMap.get(type) || { type, count: 0, credits: 0 };
      existing.count += 1;
      existing.credits += credits;
      breakdownMap.set(type, existing);
    });
    typeBreakdown = [...breakdownMap.values()].sort((a, b) => {
      if (b.credits !== a.credits) return b.credits - a.credits;
      return b.count - a.count;
    });
  }
  const slotMap = new Map();
  userCourses.forEach((course) => {
    const slots = parseCourseMeetingSlots(course?.time_slot, course?.day, course?.period);
    slots.forEach((slot) => {
      if (!HOME_DAY_ORDER.includes(slot.day) || !HOME_PERIOD_BY_NUMBER[slot.period]) return;
      const key = `${slot.day}-${slot.period}`;
      const existing = slotMap.get(key) || [];
      existing.push(course);
      slotMap.set(key, existing);
    });
  });
  const emptySlots = [];
  HOME_DAY_ORDER.forEach((day) => {
    HOME_PERIODS.forEach((slot) => {
      const key = `${day}-${slot.period}`;
      if (!slotMap.has(key)) {
        emptySlots.push({
          day,
          period: slot.period,
          label: formatSlotLabel(day, slot.period)
        });
      }
    });
  });
  const conflicts = [];
  slotMap.forEach((courses, key) => {
    if (courses.length < 2) return;
    const [day, periodText] = key.split('-');
    conflicts.push({
      day,
      period: Number(periodText),
      label: formatSlotLabel(day, periodText),
      courses: courses.map((course) => normalizeCourseTitle(course?.title || course?.course_code || 'Course'))
    });
  });
  let assignmentsDueSoon = [];
  try {
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select('id, title, due_date, status, assignment_icon, course_code, course_year, course_term')
      .eq('user_id', user.id)
      .neq('status', 'completed')
      .not('due_date', 'is', null);
    if (assignmentsError) throw assignmentsError;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const dueSoonAssignments = (assignments || [])
      .filter((assignment) => {
        const dueDate = assignment?.due_date ? new Date(assignment.due_date) : null;
        if (!dueDate || Number.isNaN(dueDate.getTime())) return false;
        dueDate.setHours(0, 0, 0, 0);
        if (dueDate < today || dueDate > windowEnd) return false;
        const assignmentYear = assignment?.course_year === null || assignment?.course_year === undefined
          ? null
          : Number(assignment.course_year);
        const assignmentTerm = assignment?.course_term ? normalizeTermName(assignment.course_term) : null;
        const hasSemesterMeta = assignmentYear !== null && assignmentTerm;
        if (!hasSemesterMeta) return true;
        return assignmentYear === Number(year) && assignmentTerm === normalizedTerm;
      })
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
    const courseNameByCode = new Map();
    userCourses.forEach((course) => {
      const code = String(course?.course_code || '').trim();
      if (!code || courseNameByCode.has(code)) return;
      courseNameByCode.set(code, normalizeCourseTitle(course?.title || code));
    });
    const missingCourseCodes = [...new Set(
      dueSoonAssignments
        .map((assignment) => String(assignment?.course_code || '').trim())
        .filter((code) => code && !courseNameByCode.has(code))
    )];
    if (missingCourseCodes.length > 0) {
      try {
        const { data: mappedCourses, error: mappedCoursesError } = await supabase
          .from('courses')
          .select('course_code, title, academic_year, term')
          .in('course_code', missingCourseCodes)
          .eq('academic_year', Number(year))
          .eq('term', normalizedTerm);
        if (!mappedCoursesError) {
          (mappedCourses || []).forEach((course) => {
            const code = String(course?.course_code || '').trim();
            if (!code || courseNameByCode.has(code)) return;
            courseNameByCode.set(code, normalizeCourseTitle(course?.title || code));
          });
        }
      } catch (mappingError) {
        console.warn('Unable to map assignment course names for due-soon widget:', mappingError);
      }
    }
    assignmentsDueSoon = dueSoonAssignments.map((assignment) => {
      const courseCode = assignment?.course_code ? String(assignment.course_code).trim() : '';
      return {
        id: assignment?.id ? String(assignment.id) : '',
        title: String(assignment?.title || 'Untitled assignment').trim() || 'Untitled assignment',
        status: String(assignment?.status || '').trim().toLowerCase(),
        assignmentIcon: String(assignment?.assignment_icon || '📄').trim() || '📄',
        courseCode,
        courseName: courseNameByCode.get(courseCode) || courseCode || 'Course not set',
        dueDate: assignment?.due_date,
        daysLeft: getDaysUntilDate(assignment?.due_date)
      };
    });
  } catch (error) {
    console.error('Error loading home planner assignments:', error);
    assignmentsDueSoon = [];
  }
  return {
    isAuthenticated: true,
    user,
    year,
    term: normalizedTerm,
    selectedSemesterValue,
    userCourses,
    selectedCourseEntries: selectedForSemester,
    emptySlots,
    occupiedSlotsCount: slotMap.size,
    conflicts,
    creditsTotal,
    courseCount: userCourses.length,
    typeBreakdown,
    assignmentsDueSoon,
    savedCourses: filterSavedCoursesBySemester(savedCourses, year, normalizedTerm)
  };
}
async function getHomePlannerData({ force = false } = {}) {
  const { year, term } = getCurrentHomeSemesterContext();
  const key = `${year}-${term}`;
  const isFresh = (Date.now() - homePlannerDataCache.updatedAt) < 9000;
  if (!force && homePlannerDataCache.key === key && homePlannerDataCache.data && isFresh) {
    return homePlannerDataCache.data;
  }
  if (!force && homePlannerDataCache.key === key && homePlannerDataCache.pending) {
    return homePlannerDataCache.pending;
  }
  const pending = fetchHomePlannerData()
    .then((data) => {
      homePlannerDataCache = {
        key,
        updatedAt: Date.now(),
        data,
        pending: null
      };
      return data;
    })
    .catch((error) => {
      homePlannerDataCache.pending = null;
      throw error;
    });
  homePlannerDataCache.pending = pending;
  homePlannerDataCache.key = key;
  return pending;
}
const homeDesktopHeaderState = {
  searchCourses: [],
  initializedAtLeastOnce: false
};
let homeMobileHeaderBehaviorCleanup = null;
let homeMobileSearchModalCleanup = null;
let homeDesktopToolbarScrollCleanup = null;
let mobilePageHeaderBehaviorCleanup = null;
let homeMobileModalLockCount = 0;
let homeMobileModalScrollY = 0;
const MOBILE_HEADER_SCROLL_THRESHOLD = 6;
const MOBILE_HEADER_TOP_REVEAL_THRESHOLD = 8;
const MOBILE_PAGE_TOOLBAR_SELECTOR = [
  '.page-courses .courses-toolbar-shell',
  '#assignments-main.page-assignments .assignments-toolbar-shell',
  '#course-summary.calendar-page-modern .container-above.container-above-mobile',
  'body.course-page-mode #course-page .course-page-toolbar-shell'
].join(', ');
function isHomeMobileViewport() {
  return window.innerWidth <= 1023;
}
async function populateHomeSemesterDropdown() {
  const homeMain = document.getElementById('home-main');
  if (!homeMain) return;
  const semesterSelects = homeMain.querySelectorAll('.semester-select');
  const customSelects = homeMain.querySelectorAll('.custom-select[data-target^="semester-select"]');
  if (!semesterSelects.length || !customSelects.length) return;
  const semesters = await fetchAvailableSemesters();
  if (!Array.isArray(semesters) || semesters.length === 0) return;
  const semesterValues = semesters
    .map((semester) => formatSemesterValue(semester.term, semester.year))
    .filter(Boolean);
  const hiddenTerm = document.getElementById('term-select');
  const hiddenYear = document.getElementById('year-select');
  const hiddenSelection = formatSemesterValue(hiddenTerm?.value || '', hiddenYear?.value || '');
  const resolvedDefault = resolvePreferredTermForAvailableSemesters(semesterValues);
  const selectedSemesterValue = (
    (resolvedDefault && semesterValues.includes(resolvedDefault) && resolvedDefault)
    || (hiddenSelection && semesterValues.includes(hiddenSelection) && hiddenSelection)
    || semesterValues[0]
  );
  const selectedSemester = semesters.find((semester) => (
    formatSemesterValue(semester.term, semester.year) === selectedSemesterValue
  )) || semesters[0];
  semesterSelects.forEach((select) => {
    select.innerHTML = '';
    semesters.forEach((semester) => {
      const value = formatSemesterValue(semester.term, semester.year);
      if (!value) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = semester.label || `${semester.term} ${semester.year}`;
      if (value === selectedSemesterValue) option.selected = true;
      select.appendChild(option);
    });
    select.value = selectedSemesterValue;
  });
  customSelects.forEach((customSelect) => {
    const optionsContainer = customSelect.querySelector('.custom-select-options');
    const valueElement = customSelect.querySelector('.custom-select-value');
    if (!optionsContainer || !valueElement) return;
    optionsContainer.innerHTML = '';
    semesters.forEach((semester) => {
      const value = formatSemesterValue(semester.term, semester.year);
      if (!value) return;
      const option = document.createElement('div');
      option.className = `ui-select__option custom-select-option${value === selectedSemesterValue ? ' selected' : ''}`;
      option.dataset.value = value;
      option.textContent = semester.label || `${semester.term} ${semester.year}`;
      optionsContainer.appendChild(option);
    });
    valueElement.textContent = selectedSemester?.label || `${selectedSemester?.term || ''} ${selectedSemester?.year || ''}`.trim();
  });
  if (selectedSemesterValue) {
    setPreferredTermValue(selectedSemesterValue);
    applyPreferredTermToGlobals(selectedSemesterValue);
  }
  const hiddenTermInput = document.getElementById('term-select');
  const hiddenYearInput = document.getElementById('year-select');
  if (selectedSemester?.term && hiddenTermInput) hiddenTermInput.value = normalizeTermName(selectedSemester.term);
  if (selectedSemester?.year && hiddenYearInput) hiddenYearInput.value = String(selectedSemester.year);
}
function applyHomeSemesterSelection(value, { dispatchChange = true } = {}) {
  const parsed = parseSemesterValue(value);
  if (!parsed.value || !parsed.term || !parsed.year) return;
  const homeMain = document.getElementById('home-main');
  if (!homeMain) return;
  const semesterSelects = homeMain.querySelectorAll('.semester-select');
  const customSelects = homeMain.querySelectorAll('.custom-select[data-target^="semester-select"]');
  semesterSelects.forEach((select) => {
    select.value = parsed.value;
  });
  customSelects.forEach((customSelect) => {
    const valueElement = customSelect.querySelector('.custom-select-value');
    customSelect.querySelectorAll('.custom-select-option').forEach((option) => {
      const selected = option.dataset.value === parsed.value;
      option.classList.toggle('selected', selected);
      if (selected && valueElement) {
        valueElement.textContent = option.textContent;
      }
    });
  });
  const termInput = document.getElementById('term-select');
  const yearInput = document.getElementById('year-select');
  if (termInput) termInput.value = parsed.term;
  if (yearInput) yearInput.value = String(parsed.year);
  setPreferredTermValue(parsed.value);
  applyPreferredTermToGlobals(parsed.value);
  homeDesktopHeaderState.initializedAtLeastOnce = true;
  invalidateHomePlannerDataCache();
  if (dispatchChange) {
    yearInput?.dispatchEvent(new Event('change', { bubbles: true }));
    termInput?.dispatchEvent(new Event('change', { bubbles: true }));
    document.dispatchEvent(new CustomEvent('homeSemesterChanged', {
      detail: {
        term: parsed.term,
        year: parsed.year
      }
    }));
  }
}
function initializeHomeCustomSelects() {
  const homeMain = document.getElementById('home-main');
  if (!homeMain) return;

  const bindContainedScroll = (optionsEl) => {
    if (!optionsEl || optionsEl.dataset.scrollContainBound === 'true') return;
    optionsEl.dataset.scrollContainBound = 'true';

    const canScroll = () => optionsEl.scrollHeight > (optionsEl.clientHeight + 1);
    const atTop = () => optionsEl.scrollTop <= 0;
    const atBottom = () => (optionsEl.scrollTop + optionsEl.clientHeight) >= (optionsEl.scrollHeight - 1);
    let lastTouchY = null;

    optionsEl.addEventListener('wheel', (event) => {
      event.stopPropagation();
      if (!canScroll()) {
        event.preventDefault();
        return;
      }
      if ((event.deltaY < 0 && atTop()) || (event.deltaY > 0 && atBottom())) {
        event.preventDefault();
      }
    }, { passive: false });

    optionsEl.addEventListener('touchstart', (event) => {
      if (!event.touches || !event.touches.length) return;
      lastTouchY = event.touches[0].clientY;
    }, { passive: true });

    optionsEl.addEventListener('touchmove', (event) => {
      event.stopPropagation();
      if (!event.touches || !event.touches.length || lastTouchY === null) return;

      const currentY = event.touches[0].clientY;
      const deltaY = lastTouchY - currentY;
      lastTouchY = currentY;

      if (!canScroll()) {
        event.preventDefault();
        return;
      }
      if ((deltaY < 0 && atTop()) || (deltaY > 0 && atBottom())) {
        event.preventDefault();
      }
    }, { passive: false });

    optionsEl.addEventListener('touchend', () => {
      lastTouchY = null;
    }, { passive: true });

    optionsEl.addEventListener('touchcancel', () => {
      lastTouchY = null;
    }, { passive: true });
  };

  const customSelects = homeMain.querySelectorAll('.custom-select[data-target^="semester-select"]');
  customSelects.forEach((customSelect) => {
    const trigger = customSelect.querySelector('.custom-select-trigger');
    const optionsContainer = customSelect.querySelector('.custom-select-options');
    const targetId = customSelect.dataset.target;
    const targetSelect = document.getElementById(targetId);
    if (!trigger || !optionsContainer || !targetSelect) return;
    if (customSelect.dataset.initialized === 'true') return;
    bindContainedScroll(optionsContainer);
    customSelect.dataset.initialized = 'true';
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openSemesterMobileSheet({ targetSelect })) {
        customSelect.classList.remove('open');
        return;
      }
      homeMain.querySelectorAll('.custom-select').forEach((other) => {
        if (other !== customSelect) other.classList.remove('open');
      });
      customSelect.classList.toggle('open');
    });
    optionsContainer.addEventListener('click', (event) => {
      const option = event.target.closest('.custom-select-option');
      if (!option) return;
      const value = option.dataset.value;
      if (!value) return;
      targetSelect.value = value;
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
      customSelect.classList.remove('open');
    });
  });
  if (!document.body.dataset.homeCustomSelectOutsideBound) {
    document.addEventListener('click', (event) => {
      const activeHomeMain = document.getElementById('home-main');
      if (!activeHomeMain) return;
      if (!event.target.closest('#home-main .custom-select')) {
        activeHomeMain.querySelectorAll('.custom-select').forEach((customSelect) => customSelect.classList.remove('open'));
      }
    });
    document.body.dataset.homeCustomSelectOutsideBound = 'true';
  }
}
function setupHomeSemesterSync() {
  const homeMain = document.getElementById('home-main');
  if (!homeMain) return;
  const semesterSelects = homeMain.querySelectorAll('.semester-select');
  semesterSelects.forEach((select) => {
    if (select.dataset.listenerAttached === 'true') return;
    select.dataset.listenerAttached = 'true';
    select.addEventListener('change', async () => {
      applyHomeSemesterSelection(select.value);
      await loadHomeSearchCourses();
      refreshHomeSearchAutocomplete();
    });
  });
}
function getSelectedHomeSemester() {
  const semesterSelect = document.getElementById('semester-select');
  if (!semesterSelect?.value) return null;
  const parsed = parseSemesterValue(semesterSelect.value);
  if (!parsed.term || !parsed.year) return null;
  return parsed;
}
async function loadHomeSearchCourses() {
  const selected = getSelectedHomeSemester();
  if (!selected) {
    homeDesktopHeaderState.searchCourses = [];
    return [];
  }
  try {
    const courses = await fetchCourseData(selected.year, selected.term);
    homeDesktopHeaderState.searchCourses = Array.isArray(courses) ? courses : [];
  } catch (error) {
    console.error('Error loading home desktop search courses:', error);
    homeDesktopHeaderState.searchCourses = [];
  }
  return homeDesktopHeaderState.searchCourses;
}
function getHomeSearchSuggestions(query, limit = 6) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return [];
  const normalizedQuery = trimmed.toLowerCase();
  return (homeDesktopHeaderState.searchCourses || [])
    .filter((course) => {
      const title = String(course?.title || '').toLowerCase();
      const professorRaw = String(course?.professor || '').toLowerCase();
      const professorRomaji = String(formatProfessorDisplayName(course?.professor || '') || '').toLowerCase();
      const code = String(course?.course_code || '').toLowerCase();
      return title.includes(normalizedQuery) || professorRaw.includes(normalizedQuery) || professorRomaji.includes(normalizedQuery) || code.includes(normalizedQuery);
    })
    .slice(0, limit);
}
function renderHomeSearchAutocomplete(query, input, autocompleteContainer, options = {}) {
  const { onSelect } = options;
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) {
    autocompleteContainer.style.display = 'none';
    autocompleteContainer.innerHTML = '';
    return;
  }
  const suggestions = getHomeSearchSuggestions(trimmed, 6);
  if (!suggestions.length) {
    autocompleteContainer.style.display = 'none';
    autocompleteContainer.innerHTML = '';
    return;
  }
  const itemsMarkup = suggestions.map((course, index) => {
    const rawCode = String(course?.course_code || '');
    const title = highlightHomeSearchMatch(course?.title || '', trimmed);
    const professor = highlightHomeSearchMatch(formatProfessorDisplayName(course?.professor || ''), trimmed);
    const code = highlightHomeSearchMatch(rawCode, trimmed);
    return `
      <div class="search-autocomplete-item" data-suggestion-index="${index}">
        <div class="item-title">${title}</div>
        <div class="item-details">
          <span class="item-code">${code}</span>
          <span class="item-professor">${professor}</span>
        </div>
      </div>
    `;
  }).join('');
  if (autocompleteContainer.classList.contains('search-pill-autocomplete')) {
    autocompleteContainer.innerHTML = `<div class="search-pill-autocomplete-inner">${itemsMarkup}</div>`;
  } else {
    autocompleteContainer.innerHTML = itemsMarkup;
  }
  autocompleteContainer.style.display = 'block';
  autocompleteContainer.querySelectorAll('.search-autocomplete-item').forEach((item) => {
    item.addEventListener('click', () => {
      const index = Number(item.dataset.suggestionIndex);
      const selectedCourse = Number.isInteger(index) ? suggestions[index] : null;
      input.value = selectedCourse?.title || '';
      autocompleteContainer.style.display = 'none';
      autocompleteContainer.innerHTML = '';
      if (selectedCourse) {
        if (typeof onSelect === 'function') {
          onSelect(selectedCourse);
        } else {
          openCourseInfoMenu(selectedCourse);
        }
      }
    });
  });
}
function bindHomeAutocompleteScrollContainment(autocompleteContainer) {
  if (!autocompleteContainer || autocompleteContainer.dataset.scrollContainmentBound === 'true') return;
  const getScrollHost = () => (
    autocompleteContainer.querySelector('.search-pill-autocomplete-inner')
    || autocompleteContainer
  );
  autocompleteContainer.addEventListener('wheel', (event) => {
    const host = getScrollHost();
    if (!host) return;
    const canScroll = host.scrollHeight > host.clientHeight + 1;
    if (!canScroll) {
      event.preventDefault();
      return;
    }
    const deltaY = event.deltaY;
    const atTop = host.scrollTop <= 0;
    const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 1;
    if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
      event.preventDefault();
    }
  }, { passive: false });
  autocompleteContainer.dataset.scrollContainmentBound = 'true';
}
function refreshHomeSearchAutocomplete() {
  const input = document.getElementById('search-pill-input');
  const autocomplete = document.getElementById('search-pill-autocomplete');
  if (!input || !autocomplete) return;
  renderHomeSearchAutocomplete(input.value, input, autocomplete);
}
function setupHomeSearchAutocomplete() {
  const input = document.getElementById('search-pill-input');
  const autocomplete = document.getElementById('search-pill-autocomplete');
  if (!input || !autocomplete) return;
  if (input.dataset.listenerAttached === 'true') return;
  input.dataset.listenerAttached = 'true';
  bindHomeAutocompleteScrollContainment(autocomplete);
  const rerender = () => renderHomeSearchAutocomplete(input.value, input, autocomplete);
  input.addEventListener('input', rerender);
  input.addEventListener('focus', async () => {
    await loadHomeSearchCourses();
    rerender();
  });
  input.addEventListener('click', async () => {
    await loadHomeSearchCourses();
    rerender();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const firstItem = autocomplete.querySelector('.search-autocomplete-item');
    if (!firstItem) return;
    event.preventDefault();
    firstItem.click();
  });
  if (!document.body.dataset.homeSearchOutsideBound) {
    document.addEventListener('click', (event) => {
      if (!document.getElementById('home-main')) return;
      if (!event.target.closest('#home-main .search-pill-container')) {
        const container = document.getElementById('search-pill-autocomplete');
        if (container) {
          container.style.display = 'none';
          container.innerHTML = '';
        }
      }
    });
    document.body.dataset.homeSearchOutsideBound = 'true';
  }
}
function teardownHomeDesktopToolbarScrollState() {
  if (typeof homeDesktopToolbarScrollCleanup === 'function') {
    homeDesktopToolbarScrollCleanup();
    homeDesktopToolbarScrollCleanup = null;
  }
}
function initializeHomeDesktopToolbarScrollState(homeMain, desktopHeader) {
  teardownHomeDesktopToolbarScrollState();
  const appContent = document.getElementById('app-content');
  let rafId = 0;
  const getScrollTop = () => {
    const windowScrollY = window.scrollY || window.pageYOffset || 0;
    const rootScrollY = document.documentElement?.scrollTop || 0;
    const bodyScrollY = document.body?.scrollTop || 0;
    const contentScrollY = appContent ? appContent.scrollTop : 0;
    const homeScrollY = homeMain ? homeMain.scrollTop : 0;
    return Math.max(windowScrollY, rootScrollY, bodyScrollY, contentScrollY, homeScrollY);
  };
  const applyScrollState = () => {
    rafId = 0;
    if (window.innerWidth <= 1023) {
      desktopHeader.classList.remove('is-scrolled');
      return;
    }
    const isScrolled = getScrollTop() > 0;
    desktopHeader.classList.toggle('is-scrolled', isScrolled);
  };
  const requestApply = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(applyScrollState);
  };
  window.addEventListener('scroll', requestApply, { passive: true });
  appContent?.addEventListener('scroll', requestApply, { passive: true });
  homeMain?.addEventListener('scroll', requestApply, { passive: true });
  document.addEventListener('scroll', requestApply, { passive: true, capture: true });
  window.addEventListener('resize', requestApply);
  applyScrollState();
  homeDesktopToolbarScrollCleanup = () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener('scroll', requestApply);
    appContent?.removeEventListener('scroll', requestApply);
    homeMain?.removeEventListener('scroll', requestApply);
    document.removeEventListener('scroll', requestApply, true);
    window.removeEventListener('resize', requestApply);
    desktopHeader.classList.remove('is-scrolled');
  };
}
function lockHomeMobileModalScroll() {
  homeMobileModalLockCount += 1;
  if (homeMobileModalLockCount !== 1) return;
  homeMobileModalScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  document.body.classList.add('home-modal-open');
  document.body.style.top = `-${homeMobileModalScrollY}px`;
}
function unlockHomeMobileModalScroll({ force = false } = {}) {
  const wasLocked = document.body.classList.contains('home-modal-open');
  if (force) {
    homeMobileModalLockCount = 0;
  } else {
    homeMobileModalLockCount = Math.max(0, homeMobileModalLockCount - 1);
  }
  if (homeMobileModalLockCount > 0) return;
  document.body.classList.remove('home-modal-open');
  document.body.style.top = '';
  if (wasLocked) {
    window.scrollTo(0, homeMobileModalScrollY);
  }
}
function teardownHomeMobileSearchModal() {
  if (typeof homeMobileSearchModalCleanup === 'function') {
    homeMobileSearchModalCleanup();
    homeMobileSearchModalCleanup = null;
  }
  unlockHomeMobileModalScroll({ force: true });
}
function setupHomeMobileSearchModal() {
  teardownHomeMobileSearchModal();
  const homeMain = document.getElementById('home-main');
  if (!homeMain) return;
  const searchContainer = homeMain.querySelector('#home-search-container');
  const searchModal = homeMain.querySelector('#home-search-modal');
  const searchBackground = homeMain.querySelector('#home-search-container .search-background');
  const searchInput = homeMain.querySelector('#home-search-input');
  const searchAutocomplete = homeMain.querySelector('#home-search-autocomplete');
  const searchSubmit = homeMain.querySelector('#home-search-submit');
  const searchCancel = homeMain.querySelector('#home-search-cancel');
  const searchButton = homeMain.querySelector('.home-container-above .search-btn');
  let closeTimerId = null;
  if (!searchContainer || !searchModal || !searchInput || !searchAutocomplete || !searchButton) return;
  const closeSearchModal = ({ forceUnlock = false, immediate = false } = {}) => {
    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }
    searchModal.classList.remove('show');
    searchAutocomplete.style.display = 'none';
    searchAutocomplete.innerHTML = '';
    const finalizeClose = () => {
      searchContainer.classList.add('hidden');
      if (forceUnlock) {
        unlockHomeMobileModalScroll({ force: true });
      } else {
        unlockHomeMobileModalScroll();
      }
    };
    if (immediate) {
      finalizeClose();
      return;
    }
    closeTimerId = window.setTimeout(() => {
      closeTimerId = null;
      finalizeClose();
    }, 400);
  };
  const openSearchModal = async () => {
    if (!isHomeMobileViewport()) return;
    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }
    if (!searchContainer.classList.contains('hidden')) return;
    searchContainer.classList.remove('hidden');
    searchModal.classList.add('show');
    lockHomeMobileModalScroll();
    await loadHomeSearchCourses();
    renderHomeSearchAutocomplete(searchInput.value, searchInput, searchAutocomplete, {
      onSelect: (selectedCourse) => {
        closeSearchModal();
        openCourseInfoMenu(selectedCourse);
      }
    });
    window.setTimeout(() => {
      searchInput.focus();
      if (searchInput.value) searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }, 90);
  };
  const handleSearchSubmit = async () => {
    const query = String(searchInput.value || '').trim();
    if (!query) {
      closeSearchModal();
      return;
    }
    await loadHomeSearchCourses();
    const firstSuggestion = getHomeSearchSuggestions(query, 1)[0];
    if (!firstSuggestion) {
      closeSearchModal();
      return;
    }
    closeSearchModal();
    openCourseInfoMenu(firstSuggestion);
  };
  const handleSearchButtonClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSearchModal();
  };
  const handleSearchCancel = (event) => {
    event.preventDefault();
    closeSearchModal();
  };
  const handleSearchBackgroundClick = (event) => {
    if (event.target !== searchBackground) return;
    closeSearchModal();
  };
  const handleSearchInput = () => {
    renderHomeSearchAutocomplete(searchInput.value, searchInput, searchAutocomplete, {
      onSelect: (selectedCourse) => {
        closeSearchModal();
        openCourseInfoMenu(selectedCourse);
      }
    });
  };
  const handleSearchKeydown = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const firstItem = searchAutocomplete.querySelector('.search-autocomplete-item');
      if (firstItem) {
        firstItem.click();
        return;
      }
      await handleSearchSubmit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchModal();
    }
  };
  if (searchBackground && typeof window.addSwipeToCloseSimple === 'function' && searchModal.dataset.swipeBound !== 'true') {
    window.addSwipeToCloseSimple(searchModal, searchBackground, () => {
      closeSearchModal({ forceUnlock: true, immediate: true });
    });
    searchModal.dataset.swipeBound = 'true';
  }
  searchButton.addEventListener('click', handleSearchButtonClick);
  searchCancel?.addEventListener('click', handleSearchCancel);
  searchSubmit?.addEventListener('click', handleSearchSubmit);
  searchBackground?.addEventListener('click', handleSearchBackgroundClick);
  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', handleSearchKeydown);
  homeMobileSearchModalCleanup = () => {
    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }
    searchButton.removeEventListener('click', handleSearchButtonClick);
    searchCancel?.removeEventListener('click', handleSearchCancel);
    searchSubmit?.removeEventListener('click', handleSearchSubmit);
    searchBackground?.removeEventListener('click', handleSearchBackgroundClick);
    searchInput.removeEventListener('input', handleSearchInput);
    searchInput.removeEventListener('keydown', handleSearchKeydown);
    searchModal.classList.remove('show');
    searchContainer.classList.add('hidden');
    unlockHomeMobileModalScroll({ force: true });
  };
}
function teardownHomeMobileStickyHeaderBehavior() {
  if (typeof homeMobileHeaderBehaviorCleanup === 'function') {
    homeMobileHeaderBehaviorCleanup();
    homeMobileHeaderBehaviorCleanup = null;
  }
  document.querySelector('.app-header')?.classList.remove('app-header--hidden');
  document.querySelector('#home-main .home-container-above.container-above-desktop')?.classList.remove('home-toolbar--hidden');
  document.body.classList.remove('home-mobile-header-sticky');
  document.documentElement.style.removeProperty('--home-mobile-header-height');
  document.documentElement.style.removeProperty('--home-mobile-toolbar-height');
}
function teardownMobilePageStickyHeaderBehavior() {
  if (typeof mobilePageHeaderBehaviorCleanup === 'function') {
    mobilePageHeaderBehaviorCleanup();
    mobilePageHeaderBehaviorCleanup = null;
  }
  document.body.classList.remove('mobile-page-header-sticky');
  document.querySelector('.app-header')?.classList.remove('app-header--hidden');
  document.querySelectorAll(MOBILE_PAGE_TOOLBAR_SELECTOR).forEach((toolbar) => {
    toolbar.classList.remove('app-mobile-toolbar--hidden');
  });
  document.documentElement.style.removeProperty('--mobile-page-header-height');
  document.documentElement.style.removeProperty('--mobile-page-toolbar-height');
}
function initializeHomeMobileStickyHeaderBehavior() {
  // Ensure cross-page mobile sticky state is fully reset before applying Home behavior.
  teardownMobilePageStickyHeaderBehavior();
  teardownHomeMobileStickyHeaderBehavior();
  const homeMain = document.getElementById('home-main');
  const header = document.querySelector('.app-header');
  const homeToolbar = homeMain?.querySelector('.home-container-above.container-above-desktop');
  const appContent = document.getElementById('app-content');
  if (!homeMain || !header || !homeToolbar) return;
  if (!isHomeMobileViewport()) {
    header.classList.remove('app-header--hidden');
    homeToolbar.classList.remove('home-toolbar--hidden');
    return;
  }
  document.body.classList.add('home-mobile-header-sticky');
  const setHeights = () => {
    const headerHeight = Math.min(160, Math.ceil(header.getBoundingClientRect().height || 0));
    const toolbarHeight = Math.min(160, Math.ceil(homeToolbar.getBoundingClientRect().height || 0));
    document.documentElement.style.setProperty('--home-mobile-header-height', `${headerHeight}px`);
    document.documentElement.style.setProperty('--home-mobile-toolbar-height', `${toolbarHeight}px`);
  };
  const getCurrentScrollY = () => {
    const windowScrollY = window.scrollY || window.pageYOffset || 0;
    const rootScrollY = document.documentElement?.scrollTop || 0;
    const bodyScrollY = document.body?.scrollTop || 0;
    const docScrollY = document.scrollingElement?.scrollTop || 0;
    const contentScrollY = appContent ? appContent.scrollTop : 0;
    const homeScrollY = homeMain.scrollTop || 0;
    return Math.max(windowScrollY, rootScrollY, bodyScrollY, docScrollY, contentScrollY, homeScrollY);
  };
  let lastScrollY = getCurrentScrollY();
  let ticking = false;
  const applyScrollState = () => {
    ticking = false;
    const guestHeaderOnly = document.body.classList.contains('guest-dashboard');
    const currentScrollY = getCurrentScrollY();
    if (currentScrollY <= MOBILE_HEADER_TOP_REVEAL_THRESHOLD) {
      header.classList.remove('app-header--hidden');
      if (!guestHeaderOnly) {
        homeToolbar.classList.remove('home-toolbar--hidden');
      }
      lastScrollY = currentScrollY;
      return;
    }
    const deltaY = currentScrollY - lastScrollY;
    if (Math.abs(deltaY) <= MOBILE_HEADER_SCROLL_THRESHOLD) return;
    if (deltaY > 0) {
      header.classList.add('app-header--hidden');
      if (!guestHeaderOnly) {
        homeToolbar.classList.add('home-toolbar--hidden');
      }
    } else {
      header.classList.remove('app-header--hidden');
      if (!guestHeaderOnly) {
        homeToolbar.classList.remove('home-toolbar--hidden');
      }
    }
    lastScrollY = currentScrollY;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyScrollState);
  };
  const onResize = () => {
    if (!document.getElementById('home-main')) {
      teardownHomeMobileStickyHeaderBehavior();
      return;
    }
    if (!isHomeMobileViewport()) {
      teardownHomeMobileStickyHeaderBehavior();
      return;
    }
    setHeights();
    header.classList.remove('app-header--hidden');
    homeToolbar.classList.remove('home-toolbar--hidden');
  };
  setHeights();
  header.classList.remove('app-header--hidden');
  homeToolbar.classList.remove('home-toolbar--hidden');
  window.addEventListener('scroll', onScroll, { passive: true });
  appContent?.addEventListener('scroll', onScroll, { passive: true });
  homeMain.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onResize);
  homeMobileHeaderBehaviorCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    appContent?.removeEventListener('scroll', onScroll);
    homeMain.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    header.classList.remove('app-header--hidden');
    homeToolbar.classList.remove('home-toolbar--hidden');
  };
}
function initializeMobilePageStickyHeaderBehavior() {
  teardownMobilePageStickyHeaderBehavior();
  const header = document.querySelector('.app-header');
  const appContent = document.getElementById('app-content');
  const homeMain = document.getElementById('home-main');
  const profileMain = document.getElementById('profile-main');
  if (!header || homeMain || profileMain) return;
  if (!isHomeMobileViewport()) {
    header.classList.remove('app-header--hidden');
    return;
  }
  const toolbars = Array.from(document.querySelectorAll(MOBILE_PAGE_TOOLBAR_SELECTOR))
    .filter((toolbar) => {
      if (!(toolbar instanceof HTMLElement)) return false;
      const styles = window.getComputedStyle(toolbar);
      return styles.display !== 'none' && toolbar.getBoundingClientRect().height > 0;
    });
  document.body.classList.add('mobile-page-header-sticky');
  const setHeaderStackHeights = () => {
    const headerHeight = Math.min(160, Math.ceil(header.getBoundingClientRect().height || 0));
    const toolbarHeight = Math.min(240, Math.ceil(
      toolbars.reduce((total, toolbar) => total + (toolbar.getBoundingClientRect().height || 0), 0)
    ));
    document.documentElement.style.setProperty('--mobile-page-header-height', `${headerHeight}px`);
    document.documentElement.style.setProperty('--mobile-page-toolbar-height', `${toolbarHeight}px`);
  };
  let measureRafId = 0;
  const scheduleHeaderStackMeasure = () => {
    if (measureRafId) return;
    measureRafId = window.requestAnimationFrame(() => {
      measureRafId = 0;
      setHeaderStackHeights();
    });
  };
  let toolbarResizeObserver = null;
  let toolbarMutationObserver = null;
  if (typeof ResizeObserver === 'function') {
    toolbarResizeObserver = new ResizeObserver(() => {
      scheduleHeaderStackMeasure();
    });
    toolbarResizeObserver.observe(header);
    toolbars.forEach((toolbar) => {
      toolbarResizeObserver.observe(toolbar);
    });
  } else if (typeof MutationObserver === 'function') {
    toolbarMutationObserver = new MutationObserver(() => {
      scheduleHeaderStackMeasure();
    });
    toolbars.forEach((toolbar) => {
      toolbarMutationObserver.observe(toolbar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    });
  }
  const setHiddenState = (hidden) => {
    header.classList.toggle('app-header--hidden', hidden);
    toolbars.forEach((toolbar) => {
      toolbar.classList.toggle('app-mobile-toolbar--hidden', hidden);
    });
  };
  const getCurrentScrollY = () => {
    const windowScrollY = window.scrollY || window.pageYOffset || 0;
    const rootScrollY = document.documentElement?.scrollTop || 0;
    const bodyScrollY = document.body?.scrollTop || 0;
    const docScrollY = document.scrollingElement?.scrollTop || 0;
    const contentScrollY = appContent ? appContent.scrollTop : 0;
    return Math.max(windowScrollY, rootScrollY, bodyScrollY, docScrollY, contentScrollY);
  };
  let lastScrollY = getCurrentScrollY();
  let ticking = false;
  const applyScrollState = () => {
    ticking = false;
    const currentScrollY = getCurrentScrollY();
    if (currentScrollY <= MOBILE_HEADER_TOP_REVEAL_THRESHOLD) {
      setHiddenState(false);
      lastScrollY = currentScrollY;
      return;
    }
    const deltaY = currentScrollY - lastScrollY;
    if (Math.abs(deltaY) <= MOBILE_HEADER_SCROLL_THRESHOLD) return;
    setHiddenState(deltaY > 0);
    lastScrollY = currentScrollY;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyScrollState);
  };
  const onResize = () => {
    if (!isHomeMobileViewport() || document.getElementById('home-main') || document.getElementById('profile-main')) {
      teardownMobilePageStickyHeaderBehavior();
      return;
    }
    setHeaderStackHeights();
    setHiddenState(false);
  };
  setHeaderStackHeights();
  setHiddenState(false);
  window.addEventListener('scroll', onScroll, { passive: true });
  appContent?.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onResize);
  mobilePageHeaderBehaviorCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    appContent?.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    if (measureRafId) {
      window.cancelAnimationFrame(measureRafId);
      measureRafId = 0;
    }
    toolbarResizeObserver?.disconnect();
    toolbarMutationObserver?.disconnect();
    setHiddenState(false);
  };
}
async function initializeHomeDesktopHeader() {
  const homeMain = document.getElementById('home-main');
  const desktopHeader = homeMain?.querySelector('.home-container-above.container-above-desktop');
  if (!homeMain || !desktopHeader) {
    teardownHomeDesktopToolbarScrollState();
    teardownHomeMobileStickyHeaderBehavior();
    teardownHomeMobileSearchModal();
    return;
  }
  initializeHomeDesktopToolbarScrollState(homeMain, desktopHeader);
  setupHomeMobileSearchModal();
  initializeHomeMobileStickyHeaderBehavior();
  try {
    await populateHomeSemesterDropdown();
    initializeHomeCustomSelects();
    setupHomeSemesterSync();
    if (!homeDesktopHeaderState.initializedAtLeastOnce) {
      const selectedValue = document.getElementById('semester-select')?.value;
      if (selectedValue) {
        applyHomeSemesterSelection(selectedValue, { dispatchChange: true });
      }
    }
    await loadHomeSearchCourses();
    setupHomeSearchAutocomplete();
  } catch (error) {
    console.error('Error initializing home desktop header:', error);
  }
}
const handleHomeDesktopHeaderSetup = () => {
  setTimeout(() => {
    initializeHomeDesktopHeader();
  }, 30);
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleHomeDesktopHeaderSetup, { once: true });
} else {
  handleHomeDesktopHeaderSetup();
}
document.addEventListener('pageLoaded', handleHomeDesktopHeaderSetup);
const handleMobilePageHeaderSetup = () => {
  setTimeout(() => {
    initializeMobilePageStickyHeaderBehavior();
  }, 30);
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleMobilePageHeaderSetup, { once: true });
} else {
  handleMobilePageHeaderSetup();
}
document.addEventListener('pageLoaded', handleMobilePageHeaderSetup);
// Initialize session state - will be updated by components as needed
window.globalSession = null;
window.globalUser = null;
// Initialize session asynchronously
(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    window.globalSession = session;
    window.globalUser = session?.user || null;
  } catch (error) {
    console.error('Error initializing global session:', error);
  }
})();
const yearSelect = document.getElementById("year-select");
const termSelect = document.getElementById("term-select");
// Keep for backward compatibility, but components should fetch fresh sessions
const user = window.globalUser;
const MOBILE_BREAKPOINT = 1023;
const KEYBOARD_HEIGHT_THRESHOLD = 120;
function isEditableElement(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (!element.matches) return false;
  return element.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
}
function updateMobileNavSafeHeight() {
  const root = document.documentElement;
  const nav = document.querySelector('app-navigation');
  if (!root || !nav || window.innerWidth > MOBILE_BREAKPOINT) {
    root?.style.removeProperty('--mobile-nav-safe-height');
    return;
  }
  const navHeight = Math.ceil(nav.getBoundingClientRect().height || 0);
  if (navHeight > 0) {
    root.style.setProperty('--mobile-nav-safe-height', `${navHeight + 0}px`);
  }
}
function initializeMobileNavKeyboardState() {
  if (window.__mobileNavKeyboardStateInitialized) return;
  window.__mobileNavKeyboardStateInitialized = true;
  let baselineViewportHeight = window.visualViewport?.height || window.innerHeight;
  const updateKeyboardState = () => {
    if (!document.body) return;
    if (window.innerWidth > MOBILE_BREAKPOINT) {
      document.body.classList.remove('keyboard-visible');
      return;
    }
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    if (viewportHeight > baselineViewportHeight - 32) {
      baselineViewportHeight = viewportHeight;
    }
    const activeElement = document.activeElement;
    const isEditing = isEditableElement(activeElement);
    const keyboardHeight = baselineViewportHeight - viewportHeight;
    const isKeyboardVisible = isEditing && keyboardHeight > KEYBOARD_HEIGHT_THRESHOLD;
    document.body.classList.toggle('keyboard-visible', isKeyboardVisible);
  };
  const refreshMobileNavState = () => {
    updateMobileNavSafeHeight();
    updateKeyboardState();
  };
  window.addEventListener('resize', refreshMobileNavState, { passive: true });
  window.addEventListener('orientationchange', () => {
    baselineViewportHeight = window.visualViewport?.height || window.innerHeight;
    setTimeout(refreshMobileNavState, 250);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', refreshMobileNavState);
    window.visualViewport.addEventListener('scroll', updateKeyboardState);
  }
  document.addEventListener('focusin', updateKeyboardState, true);
  document.addEventListener('focusout', () => {
    setTimeout(updateKeyboardState, 120);
  }, true);
  document.addEventListener('pageLoaded', () => {
    setTimeout(refreshMobileNavState, 30);
  });
  setTimeout(refreshMobileNavState, 0);
}
initializeMobileNavKeyboardState();
class AppNavigation extends HTMLElement {
  constructor() {
    super();
    // Use regular DOM instead of Shadow DOM to avoid CSS import issues
    this.innerHTML = `
            <nav class="test">
                <ul>
                    <li class="logo-nav-item"><div class="desktop-app-logo"></div></li>
                    <li class="nav-main-item nav-main-first"><button class="nav-btn" id="home-btn" data-route="/">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Home</span>
                    </button></li>
                    <li class="nav-main-item"><button class="nav-btn" id="dashboard" data-route="/courses">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Courses</span>
                    </button></li>
                    <li class="nav-main-item"><button class="nav-btn" id="calendar-btn" data-route="/timetable">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Timetable</span>
                    </button></li>
                    <li class="nav-main-item"><button class="nav-btn" id="assignments-btn" data-route="/assignments">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Assignments</span>
                    </button></li>
                    <li class="nav-main-item nav-main-last"><button class="nav-btn" id="profile" data-route="/profile">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Profile</span>
                    </button></li>
                </ul>
            </nav>
        `;
  }
  connectedCallback() {
    updateMobileNavSafeHeight();
  }
}
class TotalCourses extends HTMLElement {
  constructor() {
    super();
    this.handlePageLoaded = () => {
      setTimeout(() => this.updateTotalCourses(), 100);
    };
    this.handleSemesterSelectionChange = (event) => {
      const targetId = event?.target?.id;
      if (!targetId) return;
      if (
        targetId === 'semester-select'
        || targetId === 'semester-select-mobile'
        || targetId === 'term-select'
        || targetId === 'year-select'
      ) {
        setTimeout(() => this.updateTotalCourses(), 60);
      }
    };
    this.handleAssignmentsCardClick = () => {
      if (window.router?.navigate) {
        window.router.navigate('/assignments');
        return;
      }
      window.location.href = withBase('/assignments');
    };
    this.handleAssignmentsCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleAssignmentsCardClick();
      }
    };
    this.innerHTML = `
            <div class="total-courses" id="total-registered-courses">
                <div class="total-courses-container">
                <h3 class="total-text">Assignments Due</h3>
                <h3 class="total-count">0</h3>
                <p class="total-upcoming">
                  <span class="upcoming-assignment-title" hidden></span>
                  <span class="no-upcoming-assignment-text">No upcoming assignment</span>
                  <span class="upcoming-assignment-deadline"></span>
                </p>
                </div>
            </div>
        `;
  }
  connectedCallback() {
    // Always reinitialize when connected
    this.updateTotalCourses();
    // Set up refresh on router navigation
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);
    document.removeEventListener('change', this.handleSemesterSelectionChange);
    document.addEventListener('change', this.handleSemesterSelectionChange);
    const assignmentsContainer = this.querySelector('.total-courses-container');
    if (assignmentsContainer) {
      assignmentsContainer.setAttribute('role', 'button');
      assignmentsContainer.setAttribute('tabindex', '0');
      assignmentsContainer.addEventListener('click', this.handleAssignmentsCardClick);
      assignmentsContainer.addEventListener('keydown', this.handleAssignmentsCardKeyDown);
    }
  }
  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.removeEventListener('change', this.handleSemesterSelectionChange);
    const assignmentsContainer = this.querySelector('.total-courses-container');
    if (assignmentsContainer) {
      assignmentsContainer.removeEventListener('click', this.handleAssignmentsCardClick);
      assignmentsContainer.removeEventListener('keydown', this.handleAssignmentsCardKeyDown);
    }
  }
  getDaysLeft(dueDateValue) {
    const dueDate = new Date(dueDateValue);
    if (Number.isNaN(dueDate.getTime())) return null;
    dueDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }
  formatDaysLeft(daysLeft) {
    if (daysLeft === null) return '';
    if (daysLeft <= 0) return 'Due today';
    if (daysLeft === 1) return '1 day left';
    return `${daysLeft} days left`;
  }
  async updateTotalCourses() {
    const totalCountEl = this.querySelector('.total-count');
    const upcomingAssignmentTitleEl = this.querySelector('.upcoming-assignment-title');
    const noUpcomingTextEl = this.querySelector('.no-upcoming-assignment-text');
    const upcomingDeadlineEl = this.querySelector('.upcoming-assignment-deadline');
    const updateDisplay = ({
      count = '0',
      assignmentTitle = '',
      noUpcomingText = 'No upcoming assignment',
      daysLeftText = '',
      hasUpcomingAssignment = false
    }) => {
      if (totalCountEl) totalCountEl.textContent = String(count);
      if (upcomingDeadlineEl) upcomingDeadlineEl.textContent = daysLeftText;
      if (upcomingAssignmentTitleEl) {
        upcomingAssignmentTitleEl.textContent = hasUpcomingAssignment ? assignmentTitle : '';
        upcomingAssignmentTitleEl.hidden = !hasUpcomingAssignment;
      }
      if (noUpcomingTextEl) {
        noUpcomingTextEl.textContent = hasUpcomingAssignment ? '' : noUpcomingText;
        noUpcomingTextEl.hidden = hasUpcomingAssignment;
      }
    };
    const fetchDueAssignments = async () => {
      try {
        // Get fresh session data
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user || null;
        if (!currentUser) {
          return { guestUser: true, dueAssignments: [] };
        }
        const { data: assignments, error: assignmentsError } = await supabase
          .from('assignments')
          .select('title, due_date, status, course_year, course_term')
          .eq('user_id', currentUser.id)
          .neq('status', 'completed')
          .not('due_date', 'is', null);
        if (assignmentsError) {
          throw assignmentsError;
        }
        const currentYear = window.getCurrentYear ? window.getCurrentYear() : parseInt(document.getElementById("year-select")?.value || new Date().getFullYear(), 10);
        const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (document.getElementById("term-select")?.value || 'Fall');
        const normalizedCurrentTerm = String(currentTerm).trim().toLowerCase();
        const normalizedCurrentYear = Number(currentYear);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueAssignments = (assignments || [])
          .filter((assignment) => {
            const dueDate = assignment?.due_date ? new Date(assignment.due_date) : null;
            if (!dueDate || Number.isNaN(dueDate.getTime())) return false;
            dueDate.setHours(0, 0, 0, 0);
            if (dueDate < today) return false;
            const assignmentYear = assignment?.course_year === null || assignment?.course_year === undefined
              ? null
              : Number(assignment.course_year);
            const assignmentTerm = assignment?.course_term ? String(assignment.course_term).trim().toLowerCase() : null;
            const hasSemesterMetadata = assignmentYear !== null && assignmentTerm;
            if (!hasSemesterMetadata) return true;
            return assignmentYear === normalizedCurrentYear && assignmentTerm === normalizedCurrentTerm;
          })
          .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
        return { guestUser: false, dueAssignments };
      } catch (error) {
        console.error('Error fetching due assignments:', error);
        return { guestUser: false, dueAssignments: [] };
      }
    };
    try {
      const { guestUser, dueAssignments } = await fetchDueAssignments();
      if (guestUser) {
        updateDisplay({
          count: '--',
          noUpcomingText: 'Sign in to view due assignments',
          daysLeftText: '',
          hasUpcomingAssignment: false
        });
        return;
      }
      const upcoming = dueAssignments[0] || null;
      const daysLeft = upcoming?.due_date ? this.getDaysLeft(upcoming.due_date) : null;
      const assignmentTitle = upcoming?.title?.trim() || 'Untitled Assignment';
      updateDisplay({
        count: dueAssignments.length,
        assignmentTitle,
        noUpcomingText: 'No upcoming assignment',
        daysLeftText: upcoming ? this.formatDaysLeft(daysLeft) : '',
        hasUpcomingAssignment: Boolean(upcoming)
      });
    } catch (error) {
      console.error('Error updating due assignments display:', error);
      updateDisplay({
        count: '--',
        noUpcomingText: 'Unable to load assignments',
        daysLeftText: '',
        hasUpcomingAssignment: false
      });
    }
  }
}
class TermBox extends HTMLElement {
  constructor() {
    super();
    // ====================================================================
    // NEXT CLASS FEATURE - ENABLED
    // Semester end check is DISABLED for styling purposes
    // ====================================================================
    this.enableNextClass = true;
    // Temporary HTML for styling (shows old term/year display)
    if (!this.enableNextClass) {
      this.innerHTML = `
        <div class="total-courses">
          <div class="total-courses-container" id="#year-courses">
            <h3 class="total-count" id="term-semester">Fall</h3>
            <h3 class="total-text" id="term-year">2025</h3>
          </div>
        </div>
      `;
    } else {
      // New Next Class HTML (will be used once enabled)
      this.innerHTML = `
        <div class="total-courses">
          <div class="total-courses-container">
            <h3 class="total-text" id="next-class-label">Next Class</h3>
            <div class="home-next-class-title-wrap" id="next-class-title-wrap">
              <h3 class="total-count" id="next-class-name">Loading...</h3>
              <h3 class="total-text" id="next-class-time">Calculating...</h3>
              <div class="home-next-class-action-wrap" id="next-class-action-cue" hidden aria-hidden="true">
                <span class="home-review-suggestion-course-action">
                  <span class="home-review-suggestion-course-action-label">Class Info</span>
                </span>
                <span class="home-review-suggestion-course-action-chevron"></span>
              </div>
            </div>
          </div>
        </div>
      `;
    }
    this.updateInterval = null;
    this.courses = [];
    this.currentNextClassCourse = null;
    this.yearSelectEl = null;
    this.termSelectEl = null;
    this.handleNextClassPageLoaded = () => {
      setTimeout(() => this.updateNextClass(), 100);
    };
    this.handleNextClassSelectionChange = () => {
      this.updateNextClass();
    };
    this.handleNextClassCardClick = () => {
      if (this.currentNextClassCourse) {
        openCourseInfoMenu(this.currentNextClassCourse);
      }
    };
    this.handleNextClassCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleNextClassCardClick();
      }
    };
  }
  setNextClassCardInteractive(isInteractive) {
    const nextClassContainer = this.querySelector('.total-courses-container');
    if (!nextClassContainer) return;
    if (isInteractive) {
      nextClassContainer.setAttribute('role', 'button');
      nextClassContainer.setAttribute('tabindex', '0');
      nextClassContainer.removeAttribute('aria-disabled');
      nextClassContainer.style.cursor = 'pointer';
      return;
    }
    nextClassContainer.removeAttribute('role');
    nextClassContainer.removeAttribute('tabindex');
    nextClassContainer.setAttribute('aria-disabled', 'true');
    nextClassContainer.style.cursor = 'default';
  }
  connectedCallback() {
    // ====================================================================
    // ENABLE NEXT CLASS FEATURE BY CHANGING enableNextClass to true
    // ====================================================================
    if (!this.enableNextClass) {
      // Old behavior: show term and year
      this.showOldTermDisplay();
      return;
    }
    // New behavior: show next class
    this.updateNextClass();
    // Update every minute
    this.updateInterval = setInterval(() => {
      this.updateNextClass();
    }, 60000); // 60 seconds
    // Listen for selector changes
    this.yearSelectEl = document.getElementById('year-select');
    this.termSelectEl = document.getElementById('term-select');
    this.yearSelectEl?.addEventListener('change', this.handleNextClassSelectionChange);
    this.termSelectEl?.addEventListener('change', this.handleNextClassSelectionChange);
    // Refresh on page navigation
    document.removeEventListener('pageLoaded', this.handleNextClassPageLoaded);
    document.addEventListener('pageLoaded', this.handleNextClassPageLoaded);
    const nextClassContainer = this.querySelector('.total-courses-container');
    if (nextClassContainer) {
      nextClassContainer.addEventListener('click', this.handleNextClassCardClick);
      nextClassContainer.addEventListener('keydown', this.handleNextClassCardKeyDown);
    }
    this.setNextClassCardInteractive(false);
  }
  disconnectedCallback() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.yearSelectEl?.removeEventListener('change', this.handleNextClassSelectionChange);
    this.termSelectEl?.removeEventListener('change', this.handleNextClassSelectionChange);
    this.yearSelectEl = null;
    this.termSelectEl = null;
    document.removeEventListener('pageLoaded', this.handleNextClassPageLoaded);
    const nextClassContainer = this.querySelector('.total-courses-container');
    if (nextClassContainer) {
      nextClassContainer.removeEventListener('click', this.handleNextClassCardClick);
      nextClassContainer.removeEventListener('keydown', this.handleNextClassCardKeyDown);
    }
    this.setNextClassCardInteractive(false);
  }
  // ====================================================================
  // OLD TERM DISPLAY (temporary for styling)
  // ====================================================================
  showOldTermDisplay() {
    this.updateDisplayTerm();
    const yearSelect = document.getElementById('year-select');
    const termSelect = document.getElementById('term-select');
    if (yearSelect) {
      yearSelect.addEventListener('change', () => this.updateDisplayTerm());
    }
    if (termSelect) {
      termSelect.addEventListener('change', () => this.updateDisplayTerm());
    }
    document.addEventListener('pageLoaded', () => {
      setTimeout(() => this.updateDisplayTerm(), 100);
    });
  }
  updateDisplayTerm() {
    const displayTermSemester = this.querySelector('#term-semester');
    const displayTermYear = this.querySelector('#term-year');
    if (!displayTermSemester || !displayTermYear) return;
    const ys = document.getElementById('year-select');
    const ts = document.getElementById('term-select');
    let year = ys?.value || '';
    let termRaw = ts?.value || '';
    if (termRaw.includes('/')) {
      const parts = termRaw.split('/');
      if (parts.length > 1) {
        if (!year) year = (parts[0] || '').trim();
        termRaw = (parts[1] || '').trim();
      }
    }
    const term = termRaw.trim();
    displayTermSemester.textContent = term;
    displayTermYear.textContent = year;
  }
  // ====================================================================
  // NEW NEXT CLASS FUNCTIONALITY (will run when enableNextClass = true)
  // ====================================================================
  async updateNextClass() {
    const labelEl = this.querySelector('#next-class-label');
    const nameEl = this.querySelector('#next-class-name');
    const timeEl = this.querySelector('#next-class-time');
    const titleWrapEl = this.querySelector('#next-class-title-wrap');
    const actionCueEl = this.querySelector('#next-class-action-cue');
    if (!labelEl || !nameEl || !timeEl) return;
    this.currentNextClassCourse = null;
    if (actionCueEl) actionCueEl.hidden = true;
    this.setNextClassCardInteractive(false);
    const toSoftAccentColor = (colorValue, alpha = 0.34) => {
      const raw = String(colorValue || '').trim();
      if (!raw) return null;
      if (raw.startsWith('#')) {
        const hex = raw.slice(1);
        if (hex.length === 3) {
          const [r, g, b] = hex.split('');
          return `rgba(${parseInt(`${r}${r}`, 16)}, ${parseInt(`${g}${g}`, 16)}, ${parseInt(`${b}${b}`, 16)}, ${alpha})`;
        }
        if (hex.length === 6) {
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
      }
      const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map(part => part.trim());
        if (parts.length >= 3) {
          const r = parseFloat(parts[0]);
          const g = parseFloat(parts[1]);
          const b = parseFloat(parts[2]);
          if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          }
        }
      }
      return null;
    };
    const applyTitleAccent = (courseType) => {
      if (!titleWrapEl) return;
      const accent = getCourseColorByType(courseType);
      if (accent) {
        titleWrapEl.style.setProperty('--next-class-accent', accent);
        const softAccent = toSoftAccentColor(accent);
        if (softAccent) {
          titleWrapEl.style.setProperty('--next-class-accent-soft', softAccent);
        } else {
          titleWrapEl.style.removeProperty('--next-class-accent-soft');
        }
      } else {
        titleWrapEl.style.removeProperty('--next-class-accent');
        titleWrapEl.style.removeProperty('--next-class-accent-soft');
      }
    };
    const resetTitleAccent = () => {
      if (!titleWrapEl) return;
      titleWrapEl.style.removeProperty('--next-class-accent');
      titleWrapEl.style.removeProperty('--next-class-accent-soft');
    };
    try {
      // Get current user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        resetTitleAccent();
        nameEl.textContent = 'Please log in';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        if (actionCueEl) actionCueEl.hidden = true;
        return;
      }
      // Get selected semester
      const selectedYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const selectedTerm = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';
      const year = Number.parseInt(selectedYear, 10);
      const term = normalizeTermName(selectedTerm);
      if (!Number.isFinite(year) || !term) {
        resetTitleAccent();
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        if (actionCueEl) actionCueEl.hidden = true;
        return;
      }
      // Get user's selected courses
      const { data: profile } = await supabase
        .from('profiles')
        .select('courses_selection')
        .eq('id', session.user.id)
        .single();
      const selectedCourses = Array.isArray(profile?.courses_selection)
        ? profile.courses_selection
        : [];
      // Filter for current semester
      const semesterCourses = selectedCourses.filter(course => {
        const courseYear = Number.parseInt(course?.year, 10);
        const rawTerm = course?.term || course?.course_term || '';
        const courseTerm = rawTerm ? normalizeTermName(rawTerm) : null;
        return courseYear === year && (!courseTerm || courseTerm === term);
      });
      if (semesterCourses.length === 0) {
        resetTitleAccent();
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        if (actionCueEl) actionCueEl.hidden = true;
        return;
      }
      // Fetch full course data
      const allCoursesInSemester = await fetchCourseData(year, term);
      const selectionCodes = new Set(
        semesterCourses
          .map((course) => String(course?.code || course?.course_code || '').trim().toUpperCase())
          .filter(Boolean)
      );
      const userCourses = allCoursesInSemester.filter(course =>
        selectionCodes.has(String(course?.course_code || '').trim().toUpperCase())
      );
      // Find next class
      const nextClass = this.findNextClass(userCourses, year, term);
      if (!nextClass) {
        resetTitleAccent();
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        if (actionCueEl) actionCueEl.hidden = true;
        return;
      }
      // Display the class info
      let displayName = nextClass.course.title || nextClass.course.course_code;
      // Truncate to 32 characters if needed
      if (displayName.length > 32) {
        displayName = `${displayName.substring(0, 32).trimEnd()}…`;
      }
      if (nextClass.isCurrent) {
        applyTitleAccent(nextClass.course?.type);
        labelEl.textContent = 'Current Class';
        nameEl.textContent = displayName;
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        this.currentNextClassCourse = nextClass.course;
        this.setNextClassCardInteractive(true);
        if (actionCueEl) actionCueEl.hidden = false;
      } else {
        applyTitleAccent(nextClass.course?.type);
        labelEl.textContent = 'Next Class';
        nameEl.textContent = displayName;
        timeEl.textContent = nextClass.timeRemaining;
        timeEl.style.display = nextClass.timeRemaining ? 'block' : 'none';
        this.currentNextClassCourse = nextClass.course;
        this.setNextClassCardInteractive(true);
        if (actionCueEl) actionCueEl.hidden = false;
      }
    } catch (error) {
      console.error('Error updating next class:', error);
      resetTitleAccent();
      nameEl.textContent = 'Error loading';
      timeEl.textContent = '';
      timeEl.style.display = 'none';
      if (actionCueEl) actionCueEl.hidden = true;
    }
  }
  formatHumanizedTimeRemaining(totalMinutes) {
    const minutes = Number.isFinite(Number(totalMinutes))
      ? Math.max(0, Math.floor(Number(totalMinutes)))
      : 0;
    if (minutes >= 24 * 60) {
      const days = Math.floor(minutes / (24 * 60));
      return `in ${days} day${days === 1 ? '' : 's'}`;
    }
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      return `in ${hours} hour${hours === 1 ? '' : 's'}`;
    }
    const remainingMinutes = Math.max(1, minutes);
    return `in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
  }
  findNextClass(courses, year, term) {
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
    const currentTime = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
    // ====================================================================
    // SEMESTER END CHECK - TEMPORARILY DISABLED FOR STYLING
    // To enable: Uncomment the lines below
    // ====================================================================
    /*
    const semesterEnd = this.getSemesterEnd(year, term);
    if (now > semesterEnd) {
      return null;
    }
    */
    const dayMap = {
      'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5,
      'Sat': 6, 'Sun': 0,
      '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6, '日': 0
    };
    const scheduledClasses = [];
    courses.forEach(course => {
      const parsedSlots = this.parseTimeSlots(course.time_slot, course.day, course.period);
      parsedSlots.forEach(({ day, startTime, endTime }) => {
        const dayNum = dayMap[day];
        if (dayNum === undefined || dayNum === null) return;
        scheduledClasses.push({
          course,
          dayNum,
          startTime,
          endTime
        });
      });
    });
    if (scheduledClasses.length === 0) return null;
    // Check for current class (within first 30 minutes)
    const currentClasses = scheduledClasses.filter(cls => {
      return cls.dayNum === currentDay &&
        currentTime >= cls.startTime &&
        currentTime < cls.startTime + 30;
    });
    if (currentClasses.length > 0) {
      return {
        course: currentClasses[0].course,
        isCurrent: true,
        timeRemaining: ''
      };
    }
    // Find next upcoming class
    let nextClass = null;
    let minDiff = Infinity;
    for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysAhead);
      const targetDay = targetDate.getDay();
      scheduledClasses.forEach(cls => {
        if (cls.dayNum !== targetDay) return;
        let timeDiff;
        if (daysAhead === 0) {
          // Today: only consider future classes
          if (cls.startTime <= currentTime) return;
          timeDiff = cls.startTime - currentTime;
        } else {
          // Future days
          timeDiff = (daysAhead * 24 * 60) + (cls.startTime - currentTime);
        }
        if (timeDiff > 0 && timeDiff < minDiff) {
          minDiff = timeDiff;
          nextClass = cls;
        }
      });
      if (nextClass) break; // Found a class this week
    }
    if (!nextClass) return null;
    return {
      course: nextClass.course,
      isCurrent: false,
      timeRemaining: this.formatHumanizedTimeRemaining(minDiff)
    };
  }
  parseTimeSlots(timeSlot, fallbackDay = null, fallbackPeriod = null) {
    return parseCourseMeetingSlots(timeSlot, fallbackDay, fallbackPeriod)
      .map((slot) => {
        const periodMeta = getPeriodMeta(slot.period);
        if (!periodMeta) return null;
        const [startHour, startMinute] = String(periodMeta.start || '').split(':').map((value) => parseInt(value, 10));
        const [endHour, endMinute] = String(periodMeta.end || '').split(':').map((value) => parseInt(value, 10));
        if (
          !Number.isFinite(startHour)
          || !Number.isFinite(startMinute)
          || !Number.isFinite(endHour)
          || !Number.isFinite(endMinute)
        ) {
          return null;
        }
        return {
          day: slot.day,
          startTime: startHour * 60 + startMinute,
          endTime: endHour * 60 + endMinute
        };
      })
      .filter(Boolean);
  }
  getSemesterEnd(year, term) {
    // Spring semester lock: August 1 (same year)
    // Fall semester lock: March 1 (next year)
    if (term === 'Spring') {
      return new Date(year, 7, 1, 0, 0, 0, 0); // August 1 (month is 0-indexed)
    } else {
      return new Date(parseInt(year, 10) + 1, 2, 1, 0, 0, 0, 0); // March 1 next year
    }
  }
}
class CourseCalendar extends HTMLElement {
  constructor() {
    super();
    this.isInitialized = false;
    this.pageLoadedListenerAdded = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.renderRequestId = 0;
    this.tooltipElement = null;
    this.activeTooltipCell = null;
    this.intensiveCourseLookup = new Map();
    this.handleCalendarClickBound = this.handleCalendarClick.bind(this);
    this.handleCalendarKeyDownBound = this.handleCalendarKeyDown.bind(this);
    this.handleCalendarPointerOverBound = this.handleCalendarPointerOver.bind(this);
    this.handleCalendarPointerMoveBound = this.handleCalendarPointerMove.bind(this);
    this.handleCalendarPointerLeaveBound = this.handleCalendarPointerLeave.bind(this);
    this.handleCalendarPageLoaded = () => {
      setTimeout(() => this.initializeCalendar(), 100);
    };
    this.handleCalendarSelectionChange = (event) => {
      if (!event || isSemesterSelectionTarget(event.target)) {
        this.refreshFromSelectors();
      }
    };
    this.handleCalendarResize = () => {
      if (window.innerWidth < HOME_DESKTOP_BREAKPOINT) {
        this.hideTooltip();
      }
    };
    this.innerHTML = `
      <div class="calendar-container-main">
        <div class="calendar-wrapper">
          <div class="loading-indicator" id="loading-indicator" style="display: none;"></div>
          <table id="calendar-main">
            <thead>
              <tr>
                <th><p style="display: none;">empty</p></th>
                <th id="calendar-monday"><p>M</p></th>
                <th id="calendar-tuesday"><p>T</p></th>
                <th id="calendar-wednesday"><p>W</p></th>
                <th id="calendar-thursday"><p>T</p></th>
                <th id="calendar-friday"><p>F</p></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="calendar-period-1">
                  <span class="period-index">1</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-2">
                  <span class="period-index">2</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-3">
                  <span class="period-index">3</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-4">
                  <span class="period-index">4</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-5">
                  <span class="period-index">5</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-6">
                  <span class="period-index">6</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
            </tbody>
          </table>
          <section class="home-calendar-intensive" data-role="home-intensive" hidden>
            <h4 class="home-calendar-intensive-heading">Intensive</h4>
            <div class="home-calendar-intensive-list" data-role="home-intensive-list"></div>
          </section>
        </div>
      </div>
    `;
    this.shadow = this;
    this.calendar = this.querySelector("#calendar-main");
    this.calendarWrapper = this.querySelector(".calendar-wrapper");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.querySelector("#loading-indicator");
    this.homeIntensiveSection = this.querySelector('[data-role="home-intensive"]');
    this.homeIntensiveList = this.querySelector('[data-role="home-intensive-list"]');
    this.initializeDayHeaderInteractions();
    this.displayedYear = null;
    this.displayedTerm = null;
    this.dayIdByEN = {
      Mon: 'calendar-monday',
      Tue: 'calendar-tuesday',
      Wed: 'calendar-wednesday',
      Thu: 'calendar-thursday',
      Fri: 'calendar-friday'
    };
    this.calendarWrapper?.addEventListener("click", this.handleCalendarClickBound);
    this.calendar.addEventListener("keydown", this.handleCalendarKeyDownBound);
    this.calendar.addEventListener("mouseover", this.handleCalendarPointerOverBound);
    this.calendar.addEventListener("mousemove", this.handleCalendarPointerMoveBound);
    this.calendar.addEventListener("mouseleave", this.handleCalendarPointerLeaveBound);
  }
  initializeDayHeaderInteractions() {
    const headerCells = Array.from(this.calendarHeader).slice(1);
    headerCells.forEach((headerCell, index) => {
      const dayCode = HOME_DAY_ORDER[index];
      if (!dayCode) return;
      headerCell.dataset.day = dayCode;
      headerCell.tabIndex = 0;
      headerCell.setAttribute('aria-label', `Filter courses by ${HOME_DAY_SHORT_LABELS[dayCode]}`);
    });
  }
  connectedCallback() {
    this.calendarWrapper?.removeEventListener("click", this.handleCalendarClickBound);
    this.calendar.removeEventListener("keydown", this.handleCalendarKeyDownBound);
    this.calendar.removeEventListener("mouseover", this.handleCalendarPointerOverBound);
    this.calendar.removeEventListener("mousemove", this.handleCalendarPointerMoveBound);
    this.calendar.removeEventListener("mouseleave", this.handleCalendarPointerLeaveBound);
    this.calendarWrapper?.addEventListener("click", this.handleCalendarClickBound);
    this.calendar.addEventListener("keydown", this.handleCalendarKeyDownBound);
    this.calendar.addEventListener("mouseover", this.handleCalendarPointerOverBound);
    this.calendar.addEventListener("mousemove", this.handleCalendarPointerMoveBound);
    this.calendar.addEventListener("mouseleave", this.handleCalendarPointerLeaveBound);

    // Only initialize if not already done
    if (!this.isInitialized) {
      this.initializeCalendar();
    }
    // Set up refresh on router navigation only once
    if (!this.pageLoadedListenerAdded) {
      this.pageLoadedListenerAdded = true;
      document.addEventListener('pageLoaded', this.handleCalendarPageLoaded);
      document.addEventListener('change', this.handleCalendarSelectionChange);
      document.addEventListener('homeSemesterChanged', this.handleCalendarSelectionChange);
      window.addEventListener('resize', this.handleCalendarResize);
    }
  }
  disconnectedCallback() {
    this.calendarWrapper?.removeEventListener("click", this.handleCalendarClickBound);
    this.calendar.removeEventListener("keydown", this.handleCalendarKeyDownBound);
    this.calendar.removeEventListener("mouseover", this.handleCalendarPointerOverBound);
    this.calendar.removeEventListener("mousemove", this.handleCalendarPointerMoveBound);
    this.calendar.removeEventListener("mouseleave", this.handleCalendarPointerLeaveBound);
    document.removeEventListener('pageLoaded', this.handleCalendarPageLoaded);
    document.removeEventListener('change', this.handleCalendarSelectionChange);
    document.removeEventListener('homeSemesterChanged', this.handleCalendarSelectionChange);
    window.removeEventListener('resize', this.handleCalendarResize);
    this.hideTooltip();
    this.pageLoadedListenerAdded = false;
  }
  refreshFromSelectors() {
    const year = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const term = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';
    invalidateHomePlannerDataCache();
    console.log('Mini calendar: Refreshing from selectors:', year, term);
    this.showCourseWithRetry(year, term);
  }
  async initializeCalendar() {
    try {
      this.showLoading();
      // Get fresh session data
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;
      // Initial highlight
      this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
      this.highlightPeriod();
      this.highlightCurrentTimePeriod();
      // Use selected year/term from selectors instead of current date
      const year = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const term = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';
      console.log('Mini calendar: Initializing with year/term:', year, term);
      // Load courses with retry mechanism
      await this.showCourseWithRetry(year, term);
      this.isInitialized = true;
      this.hideLoading();
    } catch (error) {
      console.error('Error initializing calendar:', error);
      this.hideLoading();
      // Retry initialization after a short delay
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        setTimeout(() => this.initializeCalendar(), 1000 * this.retryCount);
      }
    }
  }
  showLoading() {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'block';
    }
  }
  hideLoading() {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'none';
    }
  }
  createRenderRequestId() {
    this.renderRequestId += 1;
    return this.renderRequestId;
  }
  isRenderRequestStale(requestId) {
    return requestId !== this.renderRequestId;
  }
  async showCourseWithRetry(year, term, retryAttempt = 0, requestId = null) {
    const activeRequestId = requestId ?? this.createRenderRequestId();
    try {
      if (retryAttempt === 0) this.showLoading();
      await this.showCourse(year, term, activeRequestId);
      if (this.isRenderRequestStale(activeRequestId)) {
        return;
      }
      if (retryAttempt === 0) this.hideLoading(); // Only hide loading if this was the initial attempt
    } catch (error) {
      if (this.isRenderRequestStale(activeRequestId)) {
        return;
      }
      if (retryAttempt < this.maxRetries) {
        // Don't hide loading for retries
        // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
        const delay = 500 * Math.pow(2, retryAttempt);
        setTimeout(() => {
          if (this.isRenderRequestStale(activeRequestId)) return;
          this.showCourseWithRetry(year, term, retryAttempt + 1, activeRequestId);
        }, delay);
      } else {
        // Final fallback: show empty cells and hide loading
        this.hideLoading();
        this.showEmptyCalendar();
      }
    }
  }
  getColIndexByDayEN(dayEN) {
    const id = this.dayIdByEN[dayEN];
    if (!id) return -1;
    const el = this.querySelector(`#${id}`);
    if (!el) return -1;
    return Array.from(this.calendarHeader).indexOf(el);
  }
  clearCourseCells() {
    // Remove all course/placeholder blocks in day cells.
    this.calendar.querySelectorAll('tbody tr td:not(:first-child)').forEach(cell => {
      cell.textContent = '';
    });
  }
  isIntensiveCourse(course) {
    const rawTimeSlot = String(course?.time_slot || '').trim();
    if (!rawTimeSlot) return false;
    return /(集中講義|集中|intensive)/i.test(rawTimeSlot);
  }
  getUniqueSortedIntensiveCourses(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return [];
    const uniqueByCode = new Map();
    const noCode = [];
    courses.forEach((course) => {
      const code = String(course?.course_code || '').trim().toUpperCase();
      if (!code) {
        noCode.push(course);
        return;
      }
      if (!uniqueByCode.has(code)) {
        uniqueByCode.set(code, course);
      }
    });
    const merged = [...uniqueByCode.values(), ...noCode];
    merged.sort((left, right) => normalizeCourseTitle(left?.title || left?.course_code || 'Course').localeCompare(
      normalizeCourseTitle(right?.title || right?.course_code || 'Course')
    ));
    return merged;
  }
  renderHomeIntensiveCourses(courses) {
    if (!this.homeIntensiveSection || !this.homeIntensiveList) return;

    this.homeIntensiveList.innerHTML = '';
    this.intensiveCourseLookup.clear();

    const intensiveCourses = this.getUniqueSortedIntensiveCourses(courses);
    if (!intensiveCourses.length) {
      this.homeIntensiveSection.hidden = true;
      this.calendarWrapper?.classList.remove('has-home-intensive');
      return;
    }

    const fragment = document.createDocumentFragment();
    intensiveCourses.forEach((course, index) => {
      const courseKey = String(course?.course_code || '').trim().toUpperCase() || `intensive-${index}`;
      this.intensiveCourseLookup.set(courseKey, course);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'home-calendar-intensive-card';
      card.dataset.courseKey = courseKey;
      card.style.backgroundColor = getCourseColorByType(course?.type);

      const title = document.createElement('p');
      title.className = 'home-calendar-intensive-title';
      title.textContent = normalizeCourseTitle(course?.title || course?.course_code || 'Course');

      const professor = document.createElement('p');
      professor.className = 'home-calendar-intensive-professor';
      professor.textContent = formatProfessorDisplayName(course?.professor);

      const meta = document.createElement('p');
      meta.className = 'home-calendar-intensive-meta';
      meta.textContent = 'Intensive';

      card.appendChild(title);
      card.appendChild(professor);
      card.appendChild(meta);
      fragment.appendChild(card);
    });

    this.homeIntensiveList.appendChild(fragment);
    this.homeIntensiveSection.hidden = false;
    this.calendarWrapper?.classList.add('has-home-intensive');
  }
  populateEmptyPlaceholders() {
    const rows = this.calendar.querySelectorAll('tbody tr');
    rows.forEach((row, rowIndex) => {
      const period = rowIndex + 1;
      const cells = row.querySelectorAll('td:not(:first-child)');
      cells.forEach((cell, colIndex) => {
        if (cell.querySelector('.course-cell-main')) return;
        const day = HOME_DAY_ORDER[colIndex];
        const emptyDiv = document.createElement('div');
        emptyDiv.classList.add('course-cell-main', 'course-cell-empty');
        emptyDiv.dataset.emptySlot = 'true';
        emptyDiv.dataset.day = day;
        emptyDiv.dataset.period = String(period);
        emptyDiv.dataset.slotLabel = formatSlotLabel(day, period);
        emptyDiv.dataset.timeLabel = formatPeriodWindow(period);
        emptyDiv.setAttribute('aria-label', `${formatSlotLabel(day, period)} empty slot`);
        cell.appendChild(emptyDiv);
      });
    });
  }
  showEmptyCalendar() {
    this.clearCourseCells();
    this.populateEmptyPlaceholders();
    this.renderHomeIntensiveCourses([]);
    this.renderLegendFromCourses([]);
    this.hideTooltip();
  }
  getLegendContainer() {
    const calendarContainer = this.closest('#calendar-container');
    return calendarContainer?.querySelector('.home-calendar-legend') || document.querySelector('#home-main .home-calendar-legend');
  }
  renderLegendFromCourses(courses) {
    const legendContainer = this.getLegendContainer();
    if (!legendContainer) return;
    const normalizeLegendType = (rawTypeLabel) => {
      const typeLabel = String(rawTypeLabel || 'General').trim() || 'General';
      const seminarTypes = new Set([
        'Introductory Seminars',
        'Intermediate Seminars',
        'Advanced Seminars and Honors Thesis'
      ]);
      if (seminarTypes.has(typeLabel)) {
        return {
          label: 'Seminar and Honor Thesis',
          color: getCourseColorByType('Advanced Seminars and Honors Thesis')
        };
      }
      if (typeLabel === 'Graduate courses') {
        return {
          label: 'Graduate',
          color: getCourseColorByType('Graduate courses')
        };
      }
      return {
        label: typeLabel,
        color: getCourseColorByType(typeLabel)
      };
    };
    const typeColorMap = new Map();
    (Array.isArray(courses) ? courses : []).forEach((course) => {
      const normalized = normalizeLegendType(course?.type);
      if (typeColorMap.has(normalized.label)) return;
      typeColorMap.set(normalized.label, normalized.color);
    });
    const legendEntries = Array.from(typeColorMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (!legendEntries.length) {
      legendContainer.innerHTML = '<span class="home-calendar-legend-empty">No registered courses yet</span>';
      return;
    }
    legendContainer.innerHTML = legendEntries.map(([typeLabel, color]) => `
      <span class="home-calendar-legend-item">
        <span class="home-calendar-legend-dot" style="background:${color};"></span>
        <span>${escapeHtml(typeLabel)}</span>
      </span>
    `).join('');
  }
  highlightDay(dayShort) {
    // Remove previous highlights
    this.calendar.querySelectorAll('thead th, tbody td').forEach(el => {
      el.classList.remove('highlight-day', 'highlight-current-day');
    });
    const colIndex = this.getColIndexByDayEN(dayShort);
    if (colIndex === -1) return;
    // Highlight the header
    const header = this.calendarHeader[colIndex];
    if (header) header.classList.add('highlight-day');
    // Highlight entire column for current day
    this.calendar.querySelectorAll(`tbody tr`).forEach(row => {
      const cell = row.querySelector(`td:nth-child(${colIndex + 1})`);
      if (cell) cell.classList.add('highlight-current-day');
    });
  }
  highlightPeriod() {
    // Minimal highlight for the first column (time slots)
    if (this.calendarHeader[0]) this.calendarHeader[0].classList.add("calendar-first");
    this.calendar.querySelectorAll("tbody tr").forEach(row => {
      const cell = row.querySelector("td:nth-child(1)");
      if (cell) cell.classList.add("calendar-first");
    });
  }
  highlightCurrentTimePeriod() {
    // Get current time
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute; // minutes since midnight
    const currentDay = now.toLocaleDateString("en-US", { weekday: "short" });
    // Time periods in minutes
    const periods = [
      { start: 9 * 60, end: 10 * 60 + 30, row: 0 },      // 09:00-10:30 (period 1)
      { start: 10 * 60 + 45, end: 12 * 60 + 15, row: 1 }, // 10:45-12:15 (period 2)
      { start: 13 * 60 + 10, end: 14 * 60 + 40, row: 2 }, // 13:10-14:40 (period 3)
      { start: 14 * 60 + 55, end: 16 * 60 + 25, row: 3 }, // 14:55-16:25 (period 4)
      { start: 16 * 60 + 40, end: 18 * 60 + 10, row: 4 }, // 16:40-18:10 (period 5)
      { start: 18 * 60 + 25, end: 19 * 60 + 55, row: 5 }  // 18:25-19:55 (period 6)
    ];
    // Find current period
    const currentPeriod = periods.find(p => currentTime >= p.start && currentTime <= p.end);
    if (!currentPeriod) return; // Not during class time
    // Get column index for current day
    const colIndex = this.getColIndexByDayEN(currentDay);
    if (colIndex === -1) return;
    // Highlight the cell
    const rows = this.calendar.querySelectorAll('tbody tr');
    if (rows[currentPeriod.row]) {
      const cell = rows[currentPeriod.row].querySelector(`td:nth-child(${colIndex + 1})`);
      if (cell) cell.classList.add('highlight-current-time');
    }
  }
  async showCourse(year, term, requestId = this.renderRequestId) {
    this.displayedYear = year;
    this.displayedTerm = term;
    try {
      // Ensure we have the latest user session
      if (!this.currentUser) {
        const { data: { session } } = await supabase.auth.getSession();
        if (this.isRenderRequestStale(requestId)) return;
        this.currentUser = session?.user || null;
      }
      let selectedCourses = [];
      let normalizedTerm = term.includes('/') ? term.split('/')[1] : term;
      if (this.currentUser) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('courses_selection')
          .eq('id', this.currentUser.id)
          .single();
        if (profileError) throw profileError;
        if (this.isRenderRequestStale(requestId)) return;
        selectedCourses = profile?.courses_selection || [];
        normalizedTerm = term.includes('/') ? term.split('/')[1] : term;
        // Filter to only show courses for the current year and term
        selectedCourses = selectedCourses.filter(course => {
          const courseTerm = course.term ? (course.term.includes('/') ? course.term.split('/')[1] : course.term) : null;
          return course.year === parseInt(year) && (!courseTerm || courseTerm === normalizedTerm);
        });
        console.log('Mini calendar: Selected courses for', year, normalizedTerm, ':', selectedCourses.length);
      }
      // If no user or no selected courses for current year/term, fill with EMPTY placeholders
      if (!this.currentUser || !selectedCourses.length) {
        if (this.isRenderRequestStale(requestId)) return;
        this.showEmptyCalendar();
        return;
      }
      const allCoursesInSemester = await fetchCourseData(year, term);
      if (this.isRenderRequestStale(requestId)) return;
      const coursesToShow = allCoursesInSemester.filter(course =>
        selectedCourses.some((profileCourse) =>
          profileCourse.code === course.course_code
        )
      );
      const intensiveCourses = this.getUniqueSortedIntensiveCourses(
        coursesToShow.filter((course) => this.isIntensiveCourse(course))
      );
      const slotBasedCourses = coursesToShow.filter((course) => !this.isIntensiveCourse(course));
      this.renderLegendFromCourses(coursesToShow);
      console.log('Mini calendar: Courses to show:', coursesToShow.length);
      console.log('Mini calendar: Course details:', coursesToShow.map(c => ({ code: c.course_code, time: c.time_slot })));
      this.clearCourseCells();
      for (const course of slotBasedCourses) {
        if (this.isRenderRequestStale(requestId)) return;
        const meetingSlots = parseCourseMeetingSlots(course.time_slot, course.day, course.period)
          .filter((slot) => Boolean(this.dayIdByEN[slot.day]));
        if (meetingSlots.length === 0) continue;
        for (const meetingSlot of meetingSlots) {
          const dayEN = meetingSlot.day;
          const period = meetingSlot.period;
          const colIndex = this.getColIndexByDayEN(dayEN);
          if (colIndex === -1) {
            console.log('Invalid column index for day:', dayEN);
            continue;
          }
          const rowIndex = Number.isFinite(period) ? (period - 1) : -1;
          if (rowIndex < 0 || rowIndex >= 5) {
            console.log('Invalid row index for period:', period, 'rowIndex:', rowIndex);
            continue;
          }
          const cell = this.calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
          if (!cell) {
            console.log('Cell not found for position:', { rowIndex: rowIndex + 1, colIndex: colIndex + 1 });
            continue;
          }
          console.log('Rendering course in cell:', { course: course.course_code, dayEN, period, colIndex, rowIndex });
          const div = document.createElement("div");
          const div_title = document.createElement("div");
          const div_box = document.createElement("div");
          const div_classroom = document.createElement("div");
          div.classList.add("course-cell-main");
          div_box.classList.add("course-cell-box");
          div_title.classList.add("course-title");
          div_classroom.classList.add("course-classroom");
          // Set the course content
          // div_title.textContent = course.short_title || course.title || course.course_code;
          // div_classroom.textContent = course.classroom || '';
          //if (div_classroom.textContent === "") {
          //  div_classroom.classList.add("empty-classroom");
          //  div_title.classList.add("empty-classroom-title");
          //}
          const title = normalizeCourseTitle(course.title || course.course_code || 'Course');
          const creditsValue = parseCreditsValue(course.credits);
          const creditsLabel = creditsValue > 0
            ? `${creditsValue % 1 === 0 ? creditsValue.toFixed(0) : creditsValue.toFixed(1)} credits`
            : '';
          const typeLabel = String(course.type || 'General').trim() || 'General';
          div_box.style.backgroundColor = getCourseColorByType(course.type);
          div.dataset.courseIdentifier = course.course_code;
          div.dataset.courseCode = String(course.course_code || '');
          div.dataset.courseTitle = title;
          div.dataset.courseType = typeLabel;
          div.dataset.day = dayEN;
          div.dataset.period = String(period);
          div.dataset.slotLabel = formatSlotLabel(dayEN, period);
          div.dataset.timeLabel = meetingSlot.timeLabel || formatPeriodWindow(period) || String(course.time_slot || '');
          div.dataset.creditsLabel = creditsLabel;
          div.setAttribute(
            'aria-label',
            `${title} ${formatSlotLabel(dayEN, period)} ${div.dataset.timeLabel}`.trim()
          );
          cell.appendChild(div);
          div.appendChild(div_box);
          div.appendChild(div_title);
          div.appendChild(div_classroom);
        }
      }
      // Fill remaining empty cells with placeholders
      if (this.isRenderRequestStale(requestId)) return;
      this.populateEmptyPlaceholders();
      this.renderHomeIntensiveCourses(intensiveCourses);
      this.hideTooltip();
    } catch (error) {
      console.error('An unexpected error occurred while showing courses:', error);
      throw error; // Re-throw to trigger retry mechanism
    }
  }
  isDesktopPlannerMode() {
    return window.innerWidth >= HOME_DESKTOP_BREAKPOINT;
  }
  ensureTooltipElement() {
    if (this.tooltipElement && document.body.contains(this.tooltipElement)) {
      return this.tooltipElement;
    }
    const tooltip = document.createElement('div');
    tooltip.className = 'home-calendar-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    this.tooltipElement = tooltip;
    return tooltip;
  }
  positionTooltip(clientX, clientY) {
    const tooltip = this.tooltipElement;
    if (!tooltip) return;
    const offset = 14;
    const maxX = window.innerWidth - tooltip.offsetWidth - 8;
    const maxY = window.innerHeight - tooltip.offsetHeight - 8;
    const left = Math.max(8, Math.min(clientX + offset, maxX));
    const top = Math.max(8, Math.min(clientY + offset, maxY));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  showTooltipForCell(cell, event) {
    if (!this.isDesktopPlannerMode()) return;
    const tooltip = this.ensureTooltipElement();
    if (!tooltip) return;
    const isEmpty = cell.dataset.emptySlot === 'true';
    const slotLabel = cell.dataset.slotLabel || '';
    const timeLabel = cell.dataset.timeLabel || '';
    let title = '';
    let subtitle = '';
    let detail = '';
    if (isEmpty) {
      title = 'Empty slot';
      subtitle = [slotLabel, timeLabel].filter(Boolean).join(' • ');
      detail = 'Click to find matching courses';
    } else if (cell.dataset.courseIdentifier) {
      title = cell.dataset.courseTitle || cell.dataset.courseCode || 'Course';
      subtitle = [slotLabel, timeLabel].filter(Boolean).join(' • ');
      const detailParts = [];
      if (cell.dataset.creditsLabel) detailParts.push(cell.dataset.creditsLabel);
      if (cell.dataset.courseType) detailParts.push(cell.dataset.courseType);
      detail = detailParts.join(' • ');
    } else {
      this.hideTooltip();
      return;
    }
    tooltip.innerHTML = `
      <div class="home-calendar-tooltip-title">${escapeHtml(title)}</div>
      <div class="home-calendar-tooltip-subtitle">${escapeHtml(subtitle)}</div>
      ${detail ? `<div class="home-calendar-tooltip-detail">${escapeHtml(detail)}</div>` : ''}
    `;
    tooltip.classList.add('is-visible');
    this.positionTooltip(event.clientX, event.clientY);
  }
  hideTooltip() {
    if (!this.tooltipElement) return;
    this.tooltipElement.classList.remove('is-visible');
  }
  handleCalendarPointerOver(event) {
    if (!this.isDesktopPlannerMode()) return;
    const cell = event.target.closest('.course-cell-main');
    if (!cell || !this.calendar.contains(cell)) return;
    this.activeTooltipCell = cell;
    this.showTooltipForCell(cell, event);
  }
  handleCalendarPointerMove(event) {
    if (!this.isDesktopPlannerMode() || !this.activeTooltipCell) return;
    this.positionTooltip(event.clientX, event.clientY);
  }
  handleCalendarPointerLeave() {
    this.activeTooltipCell = null;
    this.hideTooltip();
  }
  getHeaderDayFromEventTarget(target) {
    const dayHeader = target?.closest('th[data-day]');
    if (!dayHeader || !this.calendar.contains(dayHeader)) return null;
    const day = dayHeader.dataset.day;
    return day && HOME_DAY_ORDER.includes(day) ? day : null;
  }
  navigateToDayFromHeader(day) {
    if (!day) return;
    const fallbackSemester = getCurrentHomeSemesterContext();
    const targetYear = this.displayedYear || fallbackSemester.year;
    const targetTerm = this.displayedTerm || fallbackSemester.term;
    if (!targetYear || !targetTerm) return;
    navigateToDayCourseSearch(day, targetTerm, targetYear);
  }
  handleCalendarKeyDown(event) {
    if (!event) return;
    const isActivationKey = event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
    if (!isActivationKey) return;
    const day = this.getHeaderDayFromEventTarget(event.target);
    if (!day) return;
    event.preventDefault();
    this.navigateToDayFromHeader(day);
  }
  async handleCalendarClick(event) {
    const selectedDay = this.getHeaderDayFromEventTarget(event.target);
    if (selectedDay) {
      this.navigateToDayFromHeader(selectedDay);
      return;
    }
    const intensiveCard = event.target.closest('.home-calendar-intensive-card');
    if (intensiveCard) {
      const courseKey = String(intensiveCard.dataset.courseKey || '').trim();
      if (!courseKey) return;
      const intensiveCourse = this.intensiveCourseLookup.get(courseKey);
      if (intensiveCourse) {
        openCourseInfoMenu(intensiveCourse);
      }
      return;
    }
    const clickedCell = event.target.closest("div.course-cell-main");
    if (!clickedCell) return;
    if (clickedCell.dataset.emptySlot === 'true') {
      if (!this.isDesktopPlannerMode()) return;
      const day = clickedCell.dataset.day;
      const period = Number(clickedCell.dataset.period);
      if (day && period && this.displayedYear && this.displayedTerm) {
        navigateToSlotCourseSearch(day, period, this.displayedTerm, this.displayedYear);
      }
      return;
    }
    const courseCode = clickedCell.dataset.courseIdentifier;
    if (!this.displayedYear || !this.displayedTerm || !courseCode) return;
    try {
      const courses = await fetchCourseData(this.displayedYear, this.displayedTerm);
      const clickedCourse = courses.find((course) => course.course_code === courseCode);
      if (clickedCourse) openCourseInfoMenu(clickedCourse);
    } catch (error) {
      console.error('Error handling calendar click:', error);
    }
  }
  // Public method to refresh calendar data
  async refreshCalendar() {
    console.log('Refreshing calendar...');
    // Clear current user to force fresh session fetch
    this.currentUser = null;
    if (!this.isInitialized) {
      return this.initializeCalendar();
    }
    // Use utility functions to get current year and term from selectors
    const inferred = inferCurrentSemesterValue();
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : inferred.year;
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : inferred.term;
    await this.showCourseWithRetry(currentYear, currentTerm);
  }
  // Public method to show specific term
  async showTerm(year, term) {
    // Clear current user to force fresh session fetch
    this.currentUser = null;
    await this.showCourseWithRetry(year, term);
  }
}
class LatestCoursesPreview extends HTMLElement {
  constructor() {
    super();
    this.handleActionClick = this.handleActionClick.bind(this);
    this.handlePageLoaded = () => setTimeout(() => {
      this.renderQuickActions();
      this.bindQuickActionHandlers();
    }, 70);
    this.renderQuickActions();
  }
  renderQuickActions() {
    this.innerHTML = `
      <div class="home-courses-preview home-quick-actions-panel">
        <div class="home-courses-preview-header">
          <h3 class="home-courses-preview-title">Quick Actions</h3>
        </div>
        <div class="home-quick-actions-stack">
          <button type="button" class="home-quick-action-btn" data-action="add-assignment">Add assignment</button>
          <button type="button" class="home-quick-action-btn" data-action="browse-courses">Browse courses</button>
          <button type="button" class="home-quick-action-btn" data-action="view-saved-courses">Saved courses</button>
        </div>
      </div>
    `;
  }
  bindQuickActionHandlers() {
    const actionStack = this.querySelector('.home-quick-actions-stack');
    if (!actionStack) return;
    actionStack.removeEventListener('click', this.handleActionClick);
    actionStack.addEventListener('click', this.handleActionClick);
  }
  connectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);
    this.bindQuickActionHandlers();
  }
  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    const actionStack = this.querySelector('.home-quick-actions-stack');
    if (actionStack) {
      actionStack.removeEventListener('click', this.handleActionClick);
    }
  }
  handleActionClick(event) {
    const actionButton = event.target.closest('.home-quick-action-btn');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (!action) return;
    if (action === 'add-assignment') {
      try {
        sessionStorage.setItem('open_new_assignment_modal', '1');
      } catch (error) {
        console.warn('Unable to store assignment quick-action intent:', error);
      }
      navigateToRoute('/assignments');
      return;
    }
    if (action === 'browse-courses') {
      navigateToRoute('/courses');
      return;
    }
    if (action === 'view-saved-courses') {
      try {
        sessionStorage.setItem('ila_courses_preset_prefill', JSON.stringify({
          presetId: 'preset-saved-only',
          createdAt: Date.now()
        }));
      } catch (error) {
        console.warn('Unable to store courses preset prefill payload:', error);
      }
      navigateToRoute('/courses');
      return;
    }
  }
}
class GuestHomeBrowseWidget extends HTMLElement {
  constructor() {
    super();
    this.courseLookup = new Map();
    this.refreshToken = 0;
    this.handleWidgetClick = this.handleWidgetClick.bind(this);
    this.handlePageLoaded = () => {
      setTimeout(() => this.refreshCoursePreview(), 80);
    };
    this.renderLoadingState();
  }
  connectedCallback() {
    this.removeEventListener('click', this.handleWidgetClick);
    this.addEventListener('click', this.handleWidgetClick);
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);
    this.refreshCoursePreview();
  }
  disconnectedCallback() {
    this.removeEventListener('click', this.handleWidgetClick);
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
  }
  normalizeCourseCode(codeValue) {
    return String(codeValue || '').trim().toUpperCase();
  }
  dedupeCourses(courses) {
    if (!Array.isArray(courses) || !courses.length) return [];
    const uniqueByCode = new Map();
    courses.forEach((course) => {
      const code = this.normalizeCourseCode(course?.course_code);
      if (!code || uniqueByCode.has(code)) return;
      uniqueByCode.set(code, course);
    });
    return Array.from(uniqueByCode.values());
  }
  pickRandomCourses(courses, maxCount = 4) {
    if (!Array.isArray(courses) || !courses.length) return [];
    const pool = [...courses];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[randomIndex]] = [pool[randomIndex], pool[i]];
    }
    return pool.slice(0, Math.max(1, maxCount));
  }
  isMobileViewport() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 1023px)').matches;
  }
  getViewportCourseLimit() {
    return this.isMobileViewport() ? 3 : 4;
  }
  resolveCourseAccent(course) {
    const fallback = 'var(--color-accent-primary-soft)';
    const rawValue = String(getCourseColorByType(course?.type) || '').trim();
    if (!rawValue) return fallback;
    if (/^#[0-9A-Fa-f]{3,8}$/.test(rawValue)) return rawValue;
    if (/^rgba?\([^)]*\)$/.test(rawValue)) return rawValue;
    if (/^var\(--[a-zA-Z0-9-_]+\)$/.test(rawValue)) return rawValue;
    return fallback;
  }
  renderLoadingState() {
    const loadingSkeletonCount = this.getViewportCourseLimit();
    this.innerHTML = `
      <div class="guest-v2-browse">
        <div class="guest-v2-browse-header">
          <div class="guest-v2-browse-copy">
            <h3 class="home-calendar-summary-title">Browse courses</h3>
            <p class="guest-v2-browse-subtitle">Loading the current semester preview...</p>
          </div>
          <button type="button" class="home-calendar-link guest-v2-browse-link" data-action="browse-courses">Browse courses</button>
        </div>
        <div class="guest-v2-course-grid guest-v2-course-grid--loading" aria-hidden="true">
          ${Array.from({ length: loadingSkeletonCount }, () => '<div class="guest-v2-course-skeleton"></div>').join('')}
        </div>
      </div>
    `;
  }
  renderEmptyState(message, semesterLabel = 'Latest semester') {
    this.innerHTML = `
      <div class="guest-v2-browse">
        <div class="guest-v2-browse-header">
          <div class="guest-v2-browse-copy">
            <h3 class="home-calendar-summary-title">Browse courses</h3>
            <p class="guest-v2-browse-subtitle">${escapeHtml(semesterLabel)} preview</p>
          </div>
          <button type="button" class="home-calendar-link guest-v2-browse-link" data-action="browse-courses">Browse courses</button>
        </div>
        <p class="guest-v2-browse-empty">${escapeHtml(message || 'Courses are not available right now. Please browse the full course list.')}</p>
      </div>
    `;
  }
  renderCourses(courses, semesterLabel) {
    const safeSemesterLabel = escapeHtml(semesterLabel || 'Latest semester');
    const picksLabel = Number(courses?.length) || 0;
    const cardsMarkup = courses.map((course) => {
      const courseCode = this.normalizeCourseCode(course?.course_code);
      const title = normalizeCourseTitle(course?.title || courseCode || 'Untitled course');
      const professor = formatProfessorDisplayName(course?.professor || '') || 'Professor TBA';
      const courseAccent = this.resolveCourseAccent(course);
      const meta = professor;
      return `
        <button
          type="button"
          class="home-review-suggestion-course-card guest-v2-course-card"
          data-course-code="${escapeHtml(courseCode)}"
          style="background-color:${courseAccent};"
        >
          <span class="home-review-suggestion-course-content">
            <h3 class="home-review-suggestion-course">${escapeHtml(title)}</h3>
            <p class="home-review-suggestion-meta">${escapeHtml(meta)}</p>
          </span>
          <span class="home-review-suggestion-course-action-wrap" aria-hidden="true">
            <span class="home-review-suggestion-course-action">
              <span class="home-review-suggestion-course-action-label">Course info</span>
            </span>
            <span class="home-review-suggestion-course-action-chevron"></span>
          </span>
        </button>
      `;
    }).join('');
    this.innerHTML = `
      <div class="guest-v2-browse">
        <div class="guest-v2-browse-header">
          <div class="guest-v2-browse-copy">
            <h3 class="home-calendar-summary-title">Browse courses</h3>
            <p class="guest-v2-browse-subtitle">${picksLabel} randomized picks from ${safeSemesterLabel}</p>
          </div>
          <button type="button" class="home-calendar-link guest-v2-browse-link" data-action="browse-courses">Browse courses</button>
        </div>
        <div class="guest-v2-course-grid">
          ${cardsMarkup}
        </div>
      </div>
    `;
  }
  getCurrentSemesterTarget() {
    const { term, year } = inferCurrentSemesterValue();
    return { term, year };
  }
  async refreshCoursePreview() {
    const currentToken = ++this.refreshToken;
    this.renderLoadingState();
    try {
      const semesters = await fetchAvailableSemesters();
      if (!this.isConnected || currentToken !== this.refreshToken) return;
      const { term: currentTerm, year: currentYear } = this.getCurrentSemesterTarget();
      const currentSemester = Array.isArray(semesters)
        ? semesters.find((semester) => (
          normalizeTermName(semester?.term) === currentTerm
          && Number(semester?.year) === Number(currentYear)
        ))
        : null;
      if (!currentSemester) {
        this.courseLookup = new Map();
        this.renderEmptyState(`No courses available for ${currentTerm} ${currentYear}.`, `${currentTerm} ${currentYear}`);
        return;
      }
      const semesterLabel = `${currentTerm} ${currentYear}`;
      const semesterCourses = await fetchCourseData(currentYear, currentTerm);
      if (!this.isConnected || currentToken !== this.refreshToken) return;
      const dedupedCourses = this.dedupeCourses(semesterCourses);
      if (!dedupedCourses.length) {
        this.courseLookup = new Map();
        this.renderEmptyState(`No courses available for ${semesterLabel}.`, semesterLabel);
        return;
      }
      const randomizedCourses = this.pickRandomCourses(dedupedCourses, this.getViewportCourseLimit());
      this.courseLookup = new Map(randomizedCourses.map((course) => [this.normalizeCourseCode(course?.course_code), course]));
      this.renderCourses(randomizedCourses, semesterLabel);
    } catch (error) {
      console.error('Unable to load guest browse preview:', error);
      if (!this.isConnected || currentToken !== this.refreshToken) return;
      this.courseLookup = new Map();
      this.renderEmptyState('Unable to load course previews right now.');
    }
  }
  handleWidgetClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (actionElement && this.contains(actionElement)) {
      if (actionElement.dataset.action === 'browse-courses') {
        navigateToRoute('/courses');
      }
      return;
    }
    const courseButton = event.target.closest('.guest-v2-course-card[data-course-code]');
    if (!courseButton || !this.contains(courseButton)) return;
    const courseCode = this.normalizeCourseCode(courseButton.dataset.courseCode);
    if (!courseCode) return;
    const selectedCourse = this.courseLookup.get(courseCode);
    if (!selectedCourse) return;
    openCourseInfoMenu(selectedCourse);
  }
}
class GuestHomeTeaserWidget extends HTMLElement {
  constructor() {
    super();
    this.storageKey = 'ila_guest_home_teaser_variant_last';
    this.handlePageLoaded = () => {
      this.renderTeaser();
    };
    this.handleViewportResize = () => {
      this.renderTeaser();
    };
  }
  connectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);
    window.removeEventListener('resize', this.handleViewportResize);
    window.addEventListener('resize', this.handleViewportResize, { passive: true });
    this.renderTeaser();
  }
  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    window.removeEventListener('resize', this.handleViewportResize);
  }
  isMobileViewport() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 1023px)').matches;
  }
  readLastVariantIndex() {
    try {
      const rawValue = window.localStorage.getItem(this.storageKey);
      const parsed = Number.parseInt(rawValue || '', 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      console.warn('Guest teaser: unable to read localStorage state', error);
      return null;
    }
  }
  writeLastVariantIndex(index) {
    try {
      window.localStorage.setItem(this.storageKey, String(index));
    } catch (error) {
      console.warn('Guest teaser: unable to persist localStorage state', error);
    }
  }
  pickVariantIndex(length) {
    if (!Number.isFinite(length) || length <= 1) return 0;
    const lastIndex = this.readLastVariantIndex();
    let selectedIndex = Math.floor(Math.random() * length);
    if (Number.isFinite(lastIndex) && lastIndex >= 0 && lastIndex < length && selectedIndex === lastIndex) {
      selectedIndex = (selectedIndex + 1 + Math.floor(Math.random() * (length - 1))) % length;
    }
    this.writeLastVariantIndex(selectedIndex);
    return selectedIndex;
  }
  getImageCandidates(primarySrc, fileName) {
    const safePrimarySrc = String(primarySrc || '').trim();
    const safeFileName = String(fileName || '').trim();
    const candidatePool = [];
    if (safePrimarySrc) candidatePool.push(safePrimarySrc);
    if (!safeFileName) return Array.from(new Set(candidatePool));
    const candidates = [
      ...candidatePool,
      withBase(`/assets/${safeFileName}`),
      `/assets/${safeFileName}`,
      `assets/${safeFileName}`,
      `./assets/${safeFileName}`
    ].filter(Boolean);
    return Array.from(new Set(candidates));
  }
  getMockVariants() {
    return [
      {
        id: 'screen2',
        label: 'Feature preview screen 2',
        imageSrc: guestScreen2,
        imageFile: 'screen2.png',
        mobileImageSrc: guestScreenCtaMobile,
        mobileImageFile: 'screen-cta-mobile.png'
      }
    ];
  }
  renderTeaser() {
    const variants = this.getMockVariants();
    if (!Array.isArray(variants) || !variants.length) return;
    const selectedIndex = this.pickVariantIndex(variants.length);
    const selectedVariant = variants[selectedIndex] || variants[0];
    this.innerHTML = `
      <div class="guest-v2-teaser">
        <div class="guest-v2-teaser-mock guest-v2-teaser-mock--${escapeHtml(selectedVariant.id)}" aria-hidden="true">
          <img
            class="guest-v2-teaser-image"
            title="${escapeHtml(selectedVariant.label || 'Feature preview')}"
            src=""
            loading="eager"
            decoding="async"
            draggable="false"
            aria-hidden="true"
          />
        </div>
        <div class="guest-v2-teaser-fade" aria-hidden="true"></div>
        <div class="guest-v2-teaser-cta">
          <h3 class="guest-v2-teaser-title">Build your semester in one personal workspace.</h3>
          <p class="guest-v2-teaser-subtitle">Save courses, track assignments, and keep your timetable organized so every week is easier to manage.</p>
          <div class="guest-v2-teaser-actions">
            <a class="home-calendar-link guest-v2-teaser-btn guest-v2-teaser-btn--primary" href="/register">Get started</a>
            <a class="home-calendar-link guest-v2-teaser-btn guest-v2-teaser-btn--secondary" href="/courses">Browse courses</a>
          </div>
        </div>
      </div>
    `;
    const previewImage = this.querySelector('.guest-v2-teaser-image');
    if (!previewImage) return;
    const mobileViewport = this.isMobileViewport();
    const imageCandidates = this.getImageCandidates(
      mobileViewport ? (selectedVariant.mobileImageSrc || selectedVariant.imageSrc) : selectedVariant.imageSrc,
      mobileViewport ? (selectedVariant.mobileImageFile || selectedVariant.imageFile) : selectedVariant.imageFile
    );
    if (!imageCandidates.length) {
      previewImage.style.visibility = 'hidden';
      this.classList.add('guest-v2-teaser-image-error');
      return;
    }
    let candidateIndex = 0;
    const tryNextCandidate = () => {
      if (candidateIndex >= imageCandidates.length) {
        previewImage.style.visibility = 'hidden';
        this.classList.add('guest-v2-teaser-image-error');
        return;
      }
      const nextSrc = imageCandidates[candidateIndex++];
      previewImage.src = nextSrc;
    };
    previewImage.addEventListener('load', () => {
      previewImage.style.visibility = 'visible';
      this.classList.remove('guest-v2-teaser-image-error');
    }, { once: true });
    previewImage.addEventListener('error', () => {
      tryNextCandidate();
    });
    tryNextCandidate();
  }
}
class ReviewSuggestionWidget extends HTMLElement {
  constructor() {
    super();
    this.suggestedCourses = [];
    this.lastSuggestedCourseKey = null;
    this.handlePageLoaded = () => {
      setTimeout(() => this.refreshSuggestion(), 120);
    };
    this.handleSuggestionCardClick = (event) => {
      const cardButton = event.target.closest('.home-review-suggestion-course-card[data-index]');
      if (!cardButton || !this.contains(cardButton)) return;
      const index = Number(cardButton.dataset.index);
      if (!Number.isFinite(index)) return;
      this.openCourseSuggestionByIndex(index);
    };
    this.innerHTML = `
      <div class="home-review-suggestion">
        <div class="home-review-suggestion-header">
          <div class="home-review-suggestion-header-copy">
            <h3 class="home-review-suggestion-title">Suggestion</h3>
            <p class="home-review-suggestion-text">Review a course you have registered for</p>
          </div>
        </div>
        <div class="home-review-suggestion-grid">
          <button type="button" class="home-review-suggestion-course-card home-review-suggestion-course-card--loading" data-index="0" disabled>
            <span class="home-review-suggestion-course-content">
              <h3 class="home-review-suggestion-course">Loading...</h3>
              <p class="home-review-suggestion-meta"></p>
            </span>
          </button>
        </div>
      </div>
    `;
  }
  openCourseSuggestionByIndex(index) {
    if (!Array.isArray(this.suggestedCourses) || this.suggestedCourses.length === 0) return false;
    const selectedCourse = this.suggestedCourses[index];
    return this.openCourseForReview(selectedCourse || this.suggestedCourses[0]);
  }
  openCourseForReview(course) {
    if (!course) return false;
    const code = this.normalizeCourseCode(course.code);
    const year = Number(course.year) || new Date().getFullYear();
    const term = this.normalizeTerm(course.term);
    try {
      sessionStorage.setItem(HOME_REVIEW_SUGGESTION_OPEN_REVIEW_KEY, JSON.stringify({
        courseCode: code,
        year,
        term,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('Unable to store review suggestion modal intent:', error);
    }
    const route = `/courses/${encodeURIComponent(code)}/${year}/${encodeURIComponent(term)}`;
    if (window.router?.navigate) {
      window.router.navigate(route);
      return true;
    }
    window.location.href = withBase(route);
    return true;
  }
  connectedCallback() {
    this.refreshSuggestion();
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);
    this.removeEventListener('click', this.handleSuggestionCardClick);
    this.addEventListener('click', this.handleSuggestionCardClick);
  }
  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    this.removeEventListener('click', this.handleSuggestionCardClick);
  }
  setContainerVisibility(isVisible) {
    this.style.display = isVisible ? 'block' : 'none';
    const container = this.closest('#home-review-suggestion-container');
    if (container) {
      container.style.display = isVisible ? 'block' : 'none';
    }
  }
  renderLoadingCards() {
    const suggestionGrid = this.querySelector('.home-review-suggestion-grid');
    if (!suggestionGrid) return;
    suggestionGrid.innerHTML = `
      <button type="button" class="home-review-suggestion-course-card home-review-suggestion-course-card--loading" data-index="0" disabled>
        <span class="home-review-suggestion-course-content">
          <h3 class="home-review-suggestion-course">Loading...</h3>
          <p class="home-review-suggestion-meta"></p>
        </span>
      </button>
    `;
  }
  renderSuggestionCards(suggestions) {
    const suggestionGrid = this.querySelector('.home-review-suggestion-grid');
    if (!suggestionGrid) return;
    suggestionGrid.innerHTML = suggestions.map((suggestion, index) => `
      <button type="button" class="home-review-suggestion-course-card" data-index="${index}" style="background-color:${suggestion.color};">
        <span class="home-review-suggestion-course-content">
          <h3 class="home-review-suggestion-course">${escapeHtml(suggestion.title)}</h3>
          <p class="home-review-suggestion-meta">${escapeHtml(suggestion.meta)}</p>
        </span>
        <span class="home-review-suggestion-course-action-wrap" aria-hidden="true">
          <span class="home-review-suggestion-course-action">
            <span class="home-review-suggestion-course-action-label">Write review</span>
          </span>
          <span class="home-review-suggestion-course-action-chevron"></span>
        </span>
      </button>
    `).join('');
  }
  normalizeTerm(termValue) {
    if (termValue === null || termValue === undefined || termValue === '') {
      return window.getCurrentTerm ? String(window.getCurrentTerm()) : 'Fall';
    }
    const raw = String(termValue).trim();
    if (raw.includes('/')) {
      return raw.split('/').pop().trim();
    }
    const lower = raw.toLowerCase();
    if (lower.includes('fall') || raw.includes('秋')) return 'Fall';
    if (lower.includes('spring') || raw.includes('春')) return 'Spring';
    return raw;
  }
  normalizeCourseCode(codeValue) {
    return String(codeValue || '').trim().toUpperCase();
  }
  getCourseCodeFamily(codeValue) {
    const normalizedCode = this.normalizeCourseCode(codeValue);
    if (!normalizedCode) return '';
    const sectionMatch = normalizedCode.match(/^(.+)-([0-9]{2,4})$/);
    return sectionMatch ? String(sectionMatch[1] || '').trim() : normalizedCode;
  }
  isSectionSpecificCourseTitle(titleValue) {
    const normalizedTitle = String(titleValue || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalizedTitle) return false;
    return /\bseminar\b/.test(normalizedTitle) || /\bthesis\b/.test(normalizedTitle);
  }
  isSectionSpecificCourse(course) {
    return this.isSectionSpecificCourseTitle(course?.title || '');
  }
  getCourseSuggestionKey(course) {
    if (!course) return '';
    const code = this.normalizeCourseCode(course.code);
    const year = Number(course.year) || '';
    const term = this.normalizeTerm(course.term || '');
    return `${code}|${year}|${term}`;
  }
  getReviewedCourseKey(code, termValue) {
    const normalizedCode = this.getCourseCodeFamily(code);
    const normalizedTerm = this.normalizeTerm(termValue || '');
    return `${normalizedCode}|${normalizedTerm}`;
  }
  pickSuggestionCourses(courses, maxCount = 4) {
    if (!Array.isArray(courses) || courses.length === 0) return [];
    const shuffled = [...courses];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
    }
    if (this.lastSuggestedCourseKey && shuffled.length > 1) {
      const firstDifferentIndex = shuffled.findIndex((course) => (
        this.getCourseSuggestionKey(course) !== this.lastSuggestedCourseKey
      ));
      if (firstDifferentIndex > 0) {
        const [nextPrimary] = shuffled.splice(firstDifferentIndex, 1);
        shuffled.unshift(nextPrimary);
      }
    }
    return shuffled.slice(0, Math.max(1, maxCount));
  }
  resolveSuggestionCardColor(courseType) {
    if (!courseType) return 'var(--color-bg-card)';
    const resolvedColor = getCourseColorByType(courseType);
    return resolvedColor || 'var(--color-bg-card)';
  }
  async refreshSuggestion() {
    this.renderLoadingCards();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || null;
      if (!user) {
        this.suggestedCourses = [];
        this.setContainerVisibility(false);
        return;
      }
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('courses_selection')
        .eq('id', user.id)
        .single();
      if (error) {
        throw error;
      }
      const selectedCourses = Array.isArray(profile?.courses_selection)
        ? profile.courses_selection.filter((course) => course?.code && course?.year)
        : [];
      const uniqueSelectedCourses = [...new Map(
        selectedCourses.map((course) => [this.getCourseSuggestionKey(course), course])
      ).values()];
      let reviewedCourseCodes = new Set();
      let reviewedCourseFamilies = new Set();
      try {
        const { data: reviewedCourses, error: reviewedCoursesError } = await supabase
          .from('course_reviews')
          .select('course_code, term')
          .eq('user_id', user.id);
        if (reviewedCoursesError) {
          throw reviewedCoursesError;
        }
        reviewedCourseCodes = new Set((reviewedCourses || []).map((review) => (
          this.normalizeCourseCode(review.course_code)
        )));
        reviewedCourseFamilies = new Set((reviewedCourses || []).map((review) => (
          this.getCourseCodeFamily(review.course_code)
        )));
      } catch (error) {
        console.error('Error loading reviewed courses for suggestion widget:', error);
      }
      const availableCourses = uniqueSelectedCourses.filter((course) => {
        const normalizedCode = this.normalizeCourseCode(course.code);
        const normalizedFamily = this.getCourseCodeFamily(course.code);
        if (this.isSectionSpecificCourse(course)) {
          if (reviewedCourseCodes.has(normalizedCode)) return false;
          return true;
        }
        if (reviewedCourseFamilies.has(normalizedFamily)) return false;
        return true;
      });
      if (availableCourses.length === 0) {
        this.suggestedCourses = [];
        this.setContainerVisibility(false);
        return;
      }
      const pickedCourses = this.pickSuggestionCourses(availableCourses, 4);
      const semesterCourseCache = new Map();
      const getSemesterCourses = async (year, term) => {
        const semesterKey = `${year}|${term}`;
        if (semesterCourseCache.has(semesterKey)) {
          return semesterCourseCache.get(semesterKey);
        }
        try {
          const semesterCourses = await fetchCourseData(year, term);
          const normalizedCourses = Array.isArray(semesterCourses) ? semesterCourses : [];
          semesterCourseCache.set(semesterKey, normalizedCourses);
          return normalizedCourses;
        } catch (error) {
          console.error('Error fetching course title for review suggestion:', error);
          semesterCourseCache.set(semesterKey, []);
          return [];
        }
      };
      const resolvedSuggestions = [];
      for (const pickedCourse of pickedCourses) {
        const year = Number(pickedCourse.year) || new Date().getFullYear();
        const term = this.normalizeTerm(pickedCourse.term);
        const code = this.normalizeCourseCode(pickedCourse.code);
        let displayTitle = code;
        let courseType = null;
        const semesterCourses = await getSemesterCourses(year, term);
        const matchedCourse = semesterCourses.find((course) => (
          this.normalizeCourseCode(course.course_code) === code
        ));
        if (matchedCourse) {
          displayTitle = normalizeCourseTitle(matchedCourse.title || code);
          courseType = matchedCourse.type || null;
        }
        resolvedSuggestions.push({
          code,
          year,
          term,
          title: displayTitle,
          meta: `${term} ${year}`,
          color: this.resolveSuggestionCardColor(courseType)
        });
      }
      if (resolvedSuggestions.length === 0) {
        this.suggestedCourses = [];
        this.setContainerVisibility(false);
        return;
      }
      this.suggestedCourses = resolvedSuggestions.map((suggestion) => ({
        code: suggestion.code,
        year: suggestion.year,
        term: suggestion.term
      }));
      this.lastSuggestedCourseKey = this.getCourseSuggestionKey(this.suggestedCourses[0]);
      this.renderSuggestionCards(resolvedSuggestions);
      this.setContainerVisibility(true);
    } catch (error) {
      console.error('Error loading review suggestion widget:', error);
      this.suggestedCourses = [];
      this.setContainerVisibility(false);
    }
  }
}
class HomePlannerWidgetBase extends HTMLElement {
  constructor() {
    super();
    this.latestData = null;
    this.handlePlannerPageLoaded = () => {
      setTimeout(() => this.refreshWidget(true), 100);
    };
    this.handlePlannerSelectionChange = (event) => {
      if (!event || isSemesterSelectionTarget(event.target)) {
        this.refreshWidget(true);
      }
    };
  }
  connectedCallback() {
    this.refreshWidget();
    document.removeEventListener('pageLoaded', this.handlePlannerPageLoaded);
    document.addEventListener('pageLoaded', this.handlePlannerPageLoaded);
    document.removeEventListener('change', this.handlePlannerSelectionChange);
    document.addEventListener('change', this.handlePlannerSelectionChange);
    document.removeEventListener('homeSemesterChanged', this.handlePlannerSelectionChange);
    document.addEventListener('homeSemesterChanged', this.handlePlannerSelectionChange);
  }
  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePlannerPageLoaded);
    document.removeEventListener('change', this.handlePlannerSelectionChange);
    document.removeEventListener('homeSemesterChanged', this.handlePlannerSelectionChange);
  }
  async refreshWidget(force = false) {
    if (!document.getElementById('home-main')) return;
    try {
      const data = await getHomePlannerData({ force });
      this.latestData = data;
      this.renderWidget(data);
    } catch (error) {
      console.error('Error refreshing home planner widget:', error);
      this.renderWidgetError();
    }
  }
  renderWidget(_data) { }
  renderWidgetError() {
    this.innerHTML = '<p class="home-planner-empty">Unable to load data.</p>';
  }
}
class HomePlannerOverview extends HomePlannerWidgetBase {
  constructor() {
    super();
    this.handleActionClick = this.handleActionClick.bind(this);
  }
  connectedCallback() {
    super.connectedCallback();
    this.removeEventListener('click', this.handleActionClick);
    this.addEventListener('click', this.handleActionClick);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.handleActionClick);
  }
  renderWidget(data) {
    this.innerHTML = `
      <div class="home-planner-overview">
        <h3 class="home-planner-section-title">Planner</h3>
        <div class="home-planner-actions">
          <button type="button" class="home-planner-action-btn" data-action="find-slots">Find courses for empty slots</button>
        </div>
      </div>
    `;
  }
  handleActionClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (action === 'find-slots') {
      const firstEmpty = this.latestData?.emptySlots?.[0];
      if (firstEmpty && this.latestData?.year && this.latestData?.term) {
        navigateToSlotCourseSearch(firstEmpty.day, firstEmpty.period, this.latestData.term, this.latestData.year);
        return;
      }
      navigateToRoute('/courses');
      return;
    }
  }
}
class HomeProgressRequirements extends HomePlannerWidgetBase {
  renderWidget(data) {
    if (!data?.isAuthenticated) {
      this.innerHTML = `
        <div class="home-progress-card-content">
          <div class="home-progress-card-header">
            <h3 class="home-progress-card-title">Progress</h3>
          </div>
          <p class="home-planner-empty">Sign in to track your planning progress.</p>
        </div>
      `;
      return;
    }
    const credits = Number(data?.creditsTotal || 0);
    const creditsLabel = credits % 1 === 0 ? credits.toFixed(0) : credits.toFixed(1);
    const creditsProgressLabel = `${creditsLabel}/${HOME_SEMESTER_MAX_CREDITS}`;
    const totalForBars = credits > 0 ? credits : Math.max(Number(data?.courseCount || 0), 1);
    const breakdown = Array.isArray(data?.typeBreakdown) ? data.typeBreakdown.slice(0, 4) : [];
    const breakdownMarkup = breakdown.length ? `
        <div class="home-progress-breakdown">
          ${breakdown.map((entry) => {
      const amount = entry.credits > 0 ? entry.credits : entry.count;
      const pct = Math.max(6, Math.min(100, Math.round((amount / totalForBars) * 100)));
      const amountLabel = entry.credits > 0
        ? `${entry.credits % 1 === 0 ? entry.credits.toFixed(0) : entry.credits.toFixed(1)} cr`
        : `${entry.count} course${entry.count === 1 ? '' : 's'}`;
      return `
              <div class="home-progress-row">
                <div class="home-progress-row-head">
                  <span>${escapeHtml(entry.type)}</span>
                  <span>${amountLabel}</span>
                </div>
                <div class="home-progress-bar"><span style="width:${pct}%"></span></div>
              </div>
            `;
    }).join('')}
        </div>
      ` : '';
    this.innerHTML = `
        <div class="home-progress-card-content">
        <div class="home-progress-card-header">
          <h3 class="home-progress-card-title">Progress / Requirements</h3>
        </div>
        <div class="home-progress-stat-grid">
          <div class="home-progress-stat">
            <span class="home-progress-stat-label">Credits</span>
            <strong class="home-progress-stat-value">${creditsProgressLabel}</strong>
          </div>
          <div class="home-progress-stat">
            <span class="home-progress-stat-label">Courses</span>
            <strong class="home-progress-stat-value">${data?.courseCount || 0}</strong>
          </div>
        </div>
        ${breakdownMarkup}
      </div>
    `;
  }
}
class HomeEmptySlotsWidget extends HomePlannerWidgetBase {
  constructor() {
    super();
    this.handleSlotClick = this.handleSlotClick.bind(this);
  }
  connectedCallback() {
    super.connectedCallback();
    this.removeEventListener('click', this.handleSlotClick);
    this.addEventListener('click', this.handleSlotClick);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.handleSlotClick);
  }
  renderWidget(data) {
    const slots = Array.isArray(data?.emptySlots) ? data.emptySlots.slice(0, 5) : [];
    if (!slots.length) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-planner-module-header">
            <h3 class="home-planner-module-title">Empty slots</h3>
          </div>
          <p class="home-planner-empty success">Your week is fully planned.</p>
          <button type="button" class="home-module-link-btn" data-action="browse-courses">Browse courses anyway</button>
        </div>
      `;
      return;
    }
    this.innerHTML = `
      <div class="home-planner-module">
        <div class="home-planner-module-header">
          <h3 class="home-planner-module-title">Empty slots</h3>
        </div>
        <ul class="home-planner-list">
          ${slots.map((slot) => `
            <li class="home-planner-list-item">
              <span>${escapeHtml(slot.label)} - Empty</span>
              <button type="button" class="home-module-link-btn" data-action="slot-search" data-day="${slot.day}" data-period="${slot.period}">
                Find courses
              </button>
            </li>
          `).join('')}
        </ul>
        <button type="button" class="home-module-link-btn" data-action="find-slots">Find courses for empty slots</button>
      </div>
    `;
  }
  handleSlotClick(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === 'browse-courses') {
      navigateToRoute('/courses');
      return;
    }
    if (action === 'find-slots') {
      const firstEmpty = this.latestData?.emptySlots?.[0];
      if (firstEmpty && this.latestData?.year && this.latestData?.term) {
        navigateToSlotCourseSearch(firstEmpty.day, firstEmpty.period, this.latestData.term, this.latestData.year);
        return;
      }
      navigateToRoute('/courses');
      return;
    }
    if (action !== 'slot-search') return;
    const day = actionButton.dataset.day;
    const period = Number(actionButton.dataset.period);
    if (!day || !period || !this.latestData?.term || !this.latestData?.year) {
      navigateToRoute('/courses');
      return;
    }
    navigateToSlotCourseSearch(day, period, this.latestData.term, this.latestData.year);
  }
}
class HomeSavedCoursesWidget extends HomePlannerWidgetBase {
  constructor() {
    super();
    this.handleSavedAction = this.handleSavedAction.bind(this);
    this.handleSavedCoursesChanged = () => this.refreshWidget(true);
    this.savedEntries = [];
    this.pageSize = 3;
    this.currentPage = 0;
  }
  connectedCallback() {
    super.connectedCallback();
    this.removeEventListener('click', this.handleSavedAction);
    this.addEventListener('click', this.handleSavedAction);
    window.removeEventListener('saved-courses:changed', this.handleSavedCoursesChanged);
    window.addEventListener('saved-courses:changed', this.handleSavedCoursesChanged);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.handleSavedAction);
    window.removeEventListener('saved-courses:changed', this.handleSavedCoursesChanged);
  }
  renderWidget(data) {
    this.savedEntries = Array.isArray(data?.savedCourses) ? data.savedCourses : [];
    if (!this.savedEntries.length) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-planner-module-header">
            <div class="home-due-header-copy">
              <h3 class="home-planner-module-title">Saved for Later</h3>
              <p class="home-planner-empty home-saved-subtitle">Saved courses will appear here</p>
            </div>
          </div>
        </div>
      `;
      return;
    }
    const totalPages = Math.ceil(this.savedEntries.length / this.pageSize);
    this.currentPage = Math.max(0, Math.min(this.currentPage, totalPages - 1));
    const pageStart = this.currentPage * this.pageSize;
    const pageEntries = this.savedEntries.slice(pageStart, pageStart + this.pageSize);
    const showPager = totalPages > 1;
    const fillerCount = showPager ? Math.max(0, this.pageSize - pageEntries.length) : 0;
    this.innerHTML = `
      <div class="home-planner-module">
        <div class="home-planner-module-header">
          <h3 class="home-planner-module-title">Saved for Later</h3>
        </div>
        <div class="home-saved-list-viewport${showPager ? ' is-paginated' : ''}">
          <ul class="home-planner-list home-saved-list${showPager ? ' is-paginated' : ''}" data-page="${this.currentPage + 1}">
            ${pageEntries.map((course, index) => `
              <li class="home-planner-list-item">
                <span>
                  <strong>${escapeHtml(course.title)}</strong>
                  ${course.day && course.period ? `<small>${escapeHtml(formatSlotLabel(course.day, course.period))}</small>` : ''}
                </span>
                <button type="button" class="home-module-link-btn" data-action="add-saved" data-index="${pageStart + index}">
                  ${this.getSavedActionLabel(course)}
                </button>
              </li>
            `).join('')}
            ${Array.from({ length: fillerCount }, () => (
      '<li class="home-planner-list-item home-saved-list-item-ghost" aria-hidden="true"></li>'
    )).join('')}
          </ul>
        </div>
        ${showPager ? `
          <div class="home-saved-pagination" aria-label="Saved courses pages">
            <button
              type="button"
              class="home-saved-pagination-arrow"
              data-action="saved-prev"
              aria-label="Previous saved courses page"
              ${this.currentPage === 0 ? 'disabled' : ''}>
            </button>
            <span class="home-saved-pagination-label" aria-live="polite">${this.currentPage + 1} / ${totalPages}</span>
            <button
              type="button"
              class="home-saved-pagination-arrow"
              data-action="saved-next"
              aria-label="Next saved courses page"
              ${this.currentPage >= totalPages - 1 ? 'disabled' : ''}>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }
  animateSavedPage(direction = 'next') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rows = this.querySelectorAll('.home-saved-list .home-planner-list-item:not(.home-saved-list-item-ghost)');
    const baseOffset = direction === 'prev' ? -12 : 12;
    rows.forEach((row, index) => {
      row.animate(
        [
          { opacity: 0, transform: `translateX(${baseOffset}px)` },
          { opacity: 1, transform: 'translateX(0)' }
        ],
        {
          duration: 220,
          delay: index * 22,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both'
        }
      );
    });
  }
  getSavedActionLabel(savedCourse) {
    if (savedCourse?.code && savedCourse?.year && savedCourse?.term) return 'Open';
    if (savedCourse?.day && savedCourse?.period && this.latestData?.term && this.latestData?.year) return 'Find courses';
    return 'Browse courses';
  }
  async handleSavedAction(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === 'saved-prev' || action === 'saved-next') {
      const totalPages = Math.max(1, Math.ceil(this.savedEntries.length / this.pageSize));
      const nextPage = action === 'saved-prev' ? this.currentPage - 1 : this.currentPage + 1;
      const clamped = Math.max(0, Math.min(nextPage, totalPages - 1));
      if (clamped === this.currentPage) return;
      this.currentPage = clamped;
      this.renderWidget(this.latestData || { savedCourses: this.savedEntries });
      this.animateSavedPage(action === 'saved-prev' ? 'prev' : 'next');
      return;
    }
    if (action === 'browse-courses') {
      navigateToRoute('/courses');
      return;
    }
    if (action !== 'add-saved') return;
    const index = Number(actionButton.dataset.index);
    const savedCourse = this.savedEntries[index];
    if (!savedCourse) return;
    if (!this.latestData?.isAuthenticated) {
      if (typeof window.requireAuth === 'function') {
        window.requireAuth('save-plan', () => navigateToRoute('/courses'));
      } else {
        navigateToRoute('/register');
      }
      return;
    }
    if (savedCourse.code && savedCourse.year && savedCourse.term) {
      try {
        const semesterCourses = await fetchCourseData(savedCourse.year, savedCourse.term);
        const selectedCourse = (semesterCourses || []).find((course) => String(course?.course_code || '') === savedCourse.code);
        if (selectedCourse) {
          openCourseInfoMenu(selectedCourse);
          return;
        }
      } catch (error) {
        console.error('Unable to open saved course detail:', error);
      }
    }
    if (savedCourse.day && savedCourse.period && this.latestData?.term && this.latestData?.year) {
      navigateToSlotCourseSearch(savedCourse.day, savedCourse.period, this.latestData.term, this.latestData.year);
      return;
    }
    navigateToRoute('/courses');
  }
}
class HomeDueSoonWidget extends HomePlannerWidgetBase {
  constructor() {
    super();
    this.handleDueSoonClick = this.handleDueSoonClick.bind(this);
  }
  connectedCallback() {
    super.connectedCallback();
    this.removeEventListener('click', this.handleDueSoonClick);
    this.addEventListener('click', this.handleDueSoonClick);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.handleDueSoonClick);
  }
  renderWidget(data) {
    if (!data?.isAuthenticated) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-planner-module-header">
            <h3 class="home-planner-module-title">Due Soon</h3>
          </div>
          <p class="home-planner-empty">Sign in to see upcoming deadlines.</p>
        </div>
      `;
      return;
    }
    const allDueSoonItems = Array.isArray(data?.assignmentsDueSoon) ? data.assignmentsDueSoon : [];
    const dueSoonCount = allDueSoonItems.length;
    if (!dueSoonCount) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-due-header">
            <div class="home-due-header-copy">
              <h3 class="home-planner-module-title">Due Soon</h3>
              <p class="home-planner-empty home-due-subtitle">No deadlines in the next 7 days</p>
            </div>
            <button type="button" class="home-calendar-link home-due-open-btn" data-action="open-assignments">Open assignments</button>
          </div>
        </div>
      `;
      return;
    }
    const isMobileViewport = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 1023px)').matches;
    const dueSoonItems = isMobileViewport
      ? allDueSoonItems
      : (dueSoonCount <= 3 ? allDueSoonItems : allDueSoonItems.slice(0, 3));
    const showOpenAllCta = dueSoonCount > 3;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const parseDueDate = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) return null;
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    };
    const getAssignmentDueMeta = (assignment) => {
      const dueDate = parseDueDate(assignment?.dueDate);
      if (!dueDate) {
        return {
          dueDate: null,
          isOverdue: false,
          daysUntilDue: null,
          urgencyLabel: ''
        };
      }
      const diffDays = Math.round((dueDate.getTime() - startOfToday.getTime()) / MS_PER_DAY);
      const isCompleted = String(assignment?.status || '') === 'completed';
      const isOverdue = diffDays < 0 && !isCompleted;
      let urgencyLabel = '';
      if (!isCompleted && diffDays >= 0 && diffDays <= 7) {
        if (diffDays === 0) urgencyLabel = 'Due today';
        else if (diffDays === 1) urgencyLabel = 'Due in 1 day';
        else urgencyLabel = `Due in ${diffDays} days`;
      }
      return {
        dueDate,
        isOverdue,
        daysUntilDue: diffDays,
        urgencyLabel
      };
    };
    const getStatusInfo = (assignment) => {
      const dueMeta = getAssignmentDueMeta(assignment);
      const statusMap = {
        'not_started': { text: 'Not Started', className: 'status-not-started' },
        'ongoing': { text: 'In Progress', className: 'status-ongoing' },
        'in_progress': { text: 'In Progress', className: 'status-ongoing' },
        'completed': { text: 'Completed', className: 'status-completed' }
      };
      if (dueMeta.isOverdue) {
        return { text: 'Overdue', className: 'status-overdue' };
      }
      return statusMap[assignment?.status] || { text: 'Not Started', className: 'status-not-started' };
    };
    const formatAssignmentDueDate = (dateValue) => {
      const parsed = parseDueDate(dateValue);
      if (!parsed) return 'No due date';
      return `Due ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    };
    this.innerHTML = `
      <div class="home-planner-module">
        <div class="home-planner-module-header home-due-module-header">
          <div class="home-due-header-left">
            <h3 class="home-planner-module-title">Due Soon</h3>
            <span class="home-module-badge">${dueSoonCount}</span>
          </div>
          ${showOpenAllCta ? '<button type="button" class="home-calendar-link home-due-open-btn" data-action="open-assignments">All assignments</button>' : ''}
        </div>
        <ul class="home-planner-list">
          ${dueSoonItems.map((assignment) => {
      const dueMeta = getAssignmentDueMeta(assignment);
      const statusInfo = getStatusInfo(assignment);
      return `
              <li class="home-planner-list-item home-due-item">
                <button type="button" class="home-due-item-btn course-assignment-item" data-action="open-assignments" data-assignment-id="${escapeHtml(assignment.id || '')}">
                  <div class="assignment-item-left">
                    <span class="assignment-item-icon">${escapeHtml(assignment.assignmentIcon || '📄')}</span>
                    <div class="assignment-item-details">
                      <p class="assignment-item-title">${escapeHtml(assignment.title || 'Untitled assignment')}</p>
                      <div class="assignment-item-meta">
                        <p class="assignment-item-due">${escapeHtml(formatAssignmentDueDate(assignment.dueDate))}</p>
                        ${dueMeta.urgencyLabel ? `<span class="assignment-item-urgency">${escapeHtml(dueMeta.urgencyLabel)}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="assignment-item-right">
                    <span class="status-badge ${statusInfo.className}">${statusInfo.text}</span>
                    <span class="assignment-item-hover-action" aria-hidden="true">Open</span>
                    <span class="assignment-item-chevron" aria-hidden="true">›</span>
                  </div>
                </button>
              </li>
            `;
    }).join('')}
        </ul>
      </div>
    `;
  }
  handleDueSoonClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    if (actionElement.dataset.action === 'open-assignments') {
      const assignmentId = String(actionElement.dataset.assignmentId || '').trim();
      try {
        if (assignmentId) {
          sessionStorage.setItem(HOME_OPEN_ASSIGNMENT_INTENT_KEY, assignmentId);
        } else {
          sessionStorage.removeItem(HOME_OPEN_ASSIGNMENT_INTENT_KEY);
        }
      } catch (error) {
        console.warn('Unable to store assignment navigation intent:', error);
      }
      navigateToRoute('/assignments');
    }
  }
}
class WeeklyCalendar extends HTMLElement {
  constructor() {
    super();
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 3;
  }
  async connectedCallback() {
    await this.render();
    this.highlightToday();
    this.highlightCurrentTimePeriod();
    this.setupMobile();
    await this.loadCourses();
  }
  async render() {
    this.innerHTML = `
      <table id="calendar">
        <thead>
          <tr>
            <th style="text-align: left;"><button id="previous"></button></th>
            <th>Mon</th>
            <th>Tue</th>
            <th>Wed</th>
            <th>Thu</th>
            <th>Fri</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><p id="smaller-text">period 1</p><p>09:00<span class="mobile-time"></span>10:30</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 2</p><p>10:45<span class="mobile-time"></span>12:15</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 3</p><p>13:10<span class="mobile-time"></span>14:40</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 4</p><p>14:55<span class="mobile-time"></span>16:25</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 5</p><p>16:40<span class="mobile-time"></span>18:10</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 6</p><p>18:25<span class="mobile-time"></span>19:55</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    `;
    // Add event listeners
    this.setupEventListeners();
  }
  setupEventListeners() {
    const previousBtn = this.querySelector('#previous');
    if (previousBtn) {
      previousBtn.addEventListener('click', () => {
        // Navigate to previous week or refresh
        this.loadCourses();
      });
    }
    // Set up mobile resize listener
    window.addEventListener('resize', () => this.checkMobile());
    this.checkMobile();
  }
  checkMobile() {
    window.isMobile = window.innerWidth <= 1023;
    if (window.isMobile) {
      this.generateMobileButtons();
    }
  }
  generateMobileButtons() {
    const mobileButtonsContainer = document.querySelector(".mobile-day-buttons");
    if (!mobileButtonsContainer) return;
    mobileButtonsContainer.innerHTML = "";
    const dayHeaders = this.querySelectorAll("#calendar thead th");
    dayHeaders.forEach((header, index) => {
      if (index === 0) return; // Skip the first column (time)
      const button = document.createElement("div");
      button.className = "day-button";
      button.textContent = header.textContent.trim().substring(0, 1);
      button.dataset.day = header.textContent.trim();
      mobileButtonsContainer.appendChild(button);
      button.addEventListener("click", () => this.showDay(header.textContent.trim()));
    });
  }
  showDay(day) {
    if (!window.isMobile) return;
    const dayHeaders = this.querySelectorAll("#calendar thead th");
    const dayButtons = document.querySelectorAll(".day-button");
    let columnIndexToShow = -1;
    dayHeaders.forEach((header, index) => {
      if (header.textContent.trim() === day) {
        columnIndexToShow = index;
      }
    });
    if (columnIndexToShow === -1) return;
    this.querySelectorAll("#calendar tr").forEach(row => {
      const cells = row.children;
      for (let i = 0; i < cells.length; i++) {
        if (i === 0 || i === columnIndexToShow) {
          cells[i].style.display = "";
        } else {
          cells[i].style.display = "none";
        }
      }
    });
    // Update day button styles
    dayButtons.forEach((button, index) => {
      if (button.textContent === day.substring(0, 1)) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });
    // Update header highlighting
    dayHeaders.forEach((header, index) => {
      if (index === columnIndexToShow) {
        header.classList.add("highlight-day");
      } else {
        header.classList.remove("highlight-day");
      }
    });
    window.currentDay = day;
  }
  setupMobile() {
    this.checkMobile();
  }
  highlightToday() {
    const today = new Date().toLocaleDateString("en-US", { weekday: "short" });
    const headers = this.querySelectorAll('#calendar thead th');
    // Find column index for today
    let todayIndex = -1;
    headers.forEach((header, index) => {
      if (header.textContent.trim() === today) {
        todayIndex = index;
        header.classList.add('highlight-day');
      }
    });
    if (todayIndex === -1) return;
    // Highlight entire column
    const rows = this.querySelectorAll('#calendar tbody tr');
    rows.forEach(row => {
      const cells = row.children;
      if (cells[todayIndex]) {
        cells[todayIndex].classList.add('highlight-current-day');
      }
    });
  }
  highlightCurrentTimePeriod() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;
    const today = new Date().toLocaleDateString("en-US", { weekday: "short" });
    // Time periods in minutes
    const periods = [
      { start: 9 * 60, end: 10 * 60 + 30, row: 0 },
      { start: 10 * 60 + 45, end: 12 * 60 + 15, row: 1 },
      { start: 13 * 60 + 10, end: 14 * 60 + 40, row: 2 },
      { start: 14 * 60 + 55, end: 16 * 60 + 25, row: 3 },
      { start: 16 * 60 + 40, end: 18 * 60 + 10, row: 4 },
      { start: 18 * 60 + 25, end: 19 * 60 + 55, row: 5 }
    ];
    const currentPeriod = periods.find(p => currentTime >= p.start && currentTime <= p.end);
    if (!currentPeriod) return;
    // Find today's column
    const headers = this.querySelectorAll('#calendar thead th');
    let todayIndex = -1;
    headers.forEach((header, index) => {
      if (header.textContent.trim() === today) {
        todayIndex = index;
      }
    });
    if (todayIndex === -1) return;
    // Highlight the specific cell
    const rows = this.querySelectorAll('#calendar tbody tr');
    if (rows[currentPeriod.row]) {
      const cells = rows[currentPeriod.row].children;
      if (cells[todayIndex]) {
        cells[todayIndex].classList.add('highlight-current-time');
      }
    }
  }
  async getCurrentUser() {
    if (this.currentUser) return this.currentUser;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;
      return this.currentUser;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }
  async loadCourses() {
    try {
      const user = await this.getCurrentUser();
      if (!user) {
        console.log('No user session found for weekly calendar');
        return;
      }
      // Get current year and term from global state
      const inferred = inferCurrentSemesterValue();
      const currentYear = window.getCurrentYear ? window.getCurrentYear() : inferred.year;
      const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : inferred.term;
      console.log(`Loading courses for weekly calendar: ${currentYear} ${currentTerm} for user ${user.id}`);
      const courses = await fetchCourseData(currentYear, currentTerm);
      console.log('Courses fetched for weekly calendar:', courses);
      if (courses && courses.length > 0) {
        this.renderCourses(courses);
        this.retryCount = 0; // Reset retry count on success
      } else {
        console.log('No courses found for weekly calendar');
        this.clearCalendar();
      }
    } catch (error) {
      console.error('Error loading courses for weekly calendar:', error);
      // Retry logic
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`Retrying weekly calendar load (attempt ${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this.loadCourses(), 1000 * this.retryCount);
      } else {
        console.error('Max retries reached for weekly calendar');
        this.clearCalendar();
      }
    }
  }
  renderCourses(courses) {
    // Clear existing courses
    this.clearCalendar();
    // Day mapping
    const dayMap = {
      'Mon': 1, 'Monday': 1, '月': 1,
      'Tue': 2, 'Tuesday': 2, '火': 2,
      'Wed': 3, 'Wednesday': 3, '水': 3,
      'Thu': 4, 'Thursday': 4, '木': 4,
      'Fri': 5, 'Friday': 5, '金': 5
    };
    courses.forEach(course => {
      const meetingSlots = parseCourseMeetingSlots(course?.time_slot, course?.day, course?.period);
      if (meetingSlots.length === 0) return;
      const table = this.querySelector('#calendar tbody');
      if (!table) return;
      meetingSlots.forEach((meetingSlot) => {
        const dayIndex = dayMap[meetingSlot.day];
        if (!dayIndex) return;
        const period = parseInt(meetingSlot.period, 10);
        if (!Number.isFinite(period) || period < 1 || period > 6) return;
        // Find the cell (row = period, column = day)
        const row = table.rows[period - 1]; // 0-indexed
        if (!row) return;
        const cell = row.cells[dayIndex]; // day index is already 1-based, so this works
        if (!cell) return;
        // Create course element
        const courseElement = document.createElement('div');
        courseElement.className = 'course-cell-main';
        courseElement.innerHTML = `
          <div class="course-cell-box" style="background-color: ${getCourseColorByType(course.type)};">
            <span style="display: none;">${normalizeCourseTitle(course.title)}</span>
          </div>
        `;
        // Add click handler
        courseElement.addEventListener('click', () => {
          openCourseInfoMenu(course);
        });
        cell.appendChild(courseElement);
      });
    });
  }
  clearCalendar() {
    // Remove all course elements from table cells
    const cells = this.querySelectorAll('#calendar tbody td:not(:first-child)');
    cells.forEach(cell => {
      // Keep the time info, remove course elements
      const courseElements = cell.querySelectorAll('.course-cell-main');
      courseElements.forEach(el => el.remove());
    });
  }
  // Public method to refresh calendar
  async refresh() {
    console.log('Refreshing weekly calendar...');
    this.currentUser = null; // Force fresh session fetch
    await this.loadCourses();
  }
  // Public method to show specific term
  async showTerm(year, term) {
    console.log(`Showing weekly calendar for: ${year} ${term}`);
    this.currentUser = null; // Force fresh session fetch
    await this.loadCourses();
  }
}
customElements.define('app-navigation', AppNavigation);
customElements.define('total-courses', TotalCourses);
customElements.define('term-box', TermBox);
customElements.define('course-calendar', CourseCalendar);
customElements.define('latest-courses-preview', LatestCoursesPreview);
customElements.define('guest-home-browse-widget', GuestHomeBrowseWidget);
customElements.define('guest-home-teaser-widget', GuestHomeTeaserWidget);
customElements.define('review-suggestion-widget', ReviewSuggestionWidget);
customElements.define('home-planner-overview', HomePlannerOverview);
customElements.define('home-progress-requirements', HomeProgressRequirements);
customElements.define('home-empty-slots-widget', HomeEmptySlotsWidget);
customElements.define('home-saved-courses-widget', HomeSavedCoursesWidget);
customElements.define('home-due-soon-widget', HomeDueSoonWidget);
customElements.define('weekly-calendar', WeeklyCalendar);
window.refreshCalendar = () => {
  const calendar = document.querySelector('course-calendar');
  const weeklyCalendar = document.querySelector('weekly-calendar');
  if (calendar) {
    calendar.forceReinit();
  }
  if (weeklyCalendar) {
    weeklyCalendar.refresh();
  }
  if (!calendar && !weeklyCalendar) {
    console.log('No calendar components found');
  }
};
