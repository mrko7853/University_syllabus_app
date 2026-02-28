import { supabase } from "../supabase.js";
import { fetchCourseData, openCourseInfoMenu, getCourseColorByType, fetchAvailableSemesters, openCourseSearchForSlot } from "./shared.js";
import { withBase } from "./path-utils.js";
import {
  applyPreferredTermToGlobals,
  applyStoredPreferences,
  getPreferredTermValue,
  normalizeTermValue,
  setPreferredTermValue
} from "./preferences.js";
import { openSemesterMobileSheet } from "./semester-mobile-sheet.js";
import { readSavedCourses, syncSavedCoursesForUser } from "./saved-courses.js";

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
  { period: 5, start: '16:40', end: '18:10', filterValue: '16:40' }
];
const HOME_PERIOD_BY_NUMBER = HOME_PERIODS.reduce((acc, slot) => {
  acc[slot.period] = slot;
  return acc;
}, {});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const yearValue = window.getCurrentYear ? window.getCurrentYear() : parseInt(document.getElementById('year-select')?.value || new Date().getFullYear(), 10);
  const termValue = window.getCurrentTerm ? window.getCurrentTerm() : document.getElementById('term-select')?.value || 'Fall';
  return {
    year: Number.isFinite(Number(yearValue)) ? Number(yearValue) : new Date().getFullYear(),
    term: normalizeTermName(termValue)
  };
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

function parseCourseTimeSlot(timeSlot) {
  if (!timeSlot) return null;

  let match = String(timeSlot).match(/\(?([月火水木金])(?:曜日)?(\d+)(?:講時)?\)?/);
  if (match) {
    const dayJP = match[1];
    const dayMap = { 月: 'Mon', 火: 'Tue', 水: 'Wed', 木: 'Thu', 金: 'Fri' };
    const period = parseInt(match[2], 10);
    const day = dayMap[dayJP];
    if (!day || !HOME_PERIOD_BY_NUMBER[period]) return null;
    return { day, period, timeLabel: formatPeriodWindow(period) };
  }

  match = String(timeSlot).match(/^(Mon|Tue|Wed|Thu|Fri)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
  if (match) {
    const day = match[1];
    const startHour = parseInt(match[2], 10);
    const startMin = parseInt(match[3], 10);
    const startLabel = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
    const period = HOME_PERIODS.find((slot) => slot.filterValue === startLabel)?.period;
    if (!period) return null;
    return { day, period, timeLabel: `${match[2]}:${match[3]} - ${match[4]}:${match[5]}` };
  }

  return null;
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
  const selectedSemesterValue = formatSemesterValue(term, year);
  let savedCourses = readSavedCourses(5);

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
      savedCourses
    };
  }

  try {
    savedCourses = (await syncSavedCoursesForUser(user.id)).slice(0, 5);
  } catch (savedSyncError) {
    console.warn('Unable to sync saved courses for user:', savedSyncError);
    savedCourses = readSavedCourses(5);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('courses_selection')
    .eq('id', user.id)
    .single();

  if (profileError) throw profileError;

  const selectedCourseEntries = Array.isArray(profile?.courses_selection) ? profile.courses_selection : [];
  const normalizedTerm = normalizeTermName(term);
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
    const slot = parseCourseTimeSlot(course?.time_slot);
    if (!slot || !HOME_DAY_ORDER.includes(slot.day) || !HOME_PERIOD_BY_NUMBER[slot.period]) return;
    const key = `${slot.day}-${slot.period}`;
    const existing = slotMap.get(key) || [];
    existing.push(course);
    slotMap.set(key, existing);
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
      .select('title, due_date, status, course_code, course_year, course_term')
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
        title: String(assignment?.title || 'Untitled assignment').trim() || 'Untitled assignment',
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
    savedCourses
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

  const preferredTerm = getPreferredTermValue();
  const hiddenTerm = document.getElementById('term-select');
  const hiddenYear = document.getElementById('year-select');
  const hiddenSelection = formatSemesterValue(hiddenTerm?.value || '', hiddenYear?.value || '');
  const selectedSemesterValue = (
    (preferredTerm && semesterValues.includes(preferredTerm) && preferredTerm)
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
      option.className = `custom-select-option${value === selectedSemesterValue ? ' selected' : ''}`;
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

  const customSelects = homeMain.querySelectorAll('.custom-select[data-target^="semester-select"]');
  customSelects.forEach((customSelect) => {
    const trigger = customSelect.querySelector('.custom-select-trigger');
    const optionsContainer = customSelect.querySelector('.custom-select-options');
    const targetId = customSelect.dataset.target;
    const targetSelect = document.getElementById(targetId);
    if (!trigger || !optionsContainer || !targetSelect) return;
    if (customSelect.dataset.initialized === 'true') return;
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

function renderHomeSearchAutocomplete(query, input, autocompleteContainer) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) {
    autocompleteContainer.style.display = 'none';
    autocompleteContainer.innerHTML = '';
    return;
  }

  const normalizedQuery = trimmed.toLowerCase();
  const suggestions = (homeDesktopHeaderState.searchCourses || [])
    .filter((course) => {
      const title = String(course?.title || '').toLowerCase();
      const professor = String(course?.professor || '').toLowerCase();
      const code = String(course?.course_code || '').toLowerCase();
      return title.includes(normalizedQuery) || professor.includes(normalizedQuery) || code.includes(normalizedQuery);
    })
    .slice(0, 6);

  if (!suggestions.length) {
    autocompleteContainer.style.display = 'none';
    autocompleteContainer.innerHTML = '';
    return;
  }

  autocompleteContainer.innerHTML = suggestions.map((course) => {
    const title = escapeHtml(course?.title || '');
    const professor = escapeHtml(course?.professor || '');
    const code = escapeHtml(course?.course_code || '');
    return `
      <div class="search-autocomplete-item" data-course-code="${code}">
        <div class="item-title">${title}</div>
        <div class="item-details">
          <span class="item-code">${code}</span>
          <span class="item-professor">${professor}</span>
        </div>
      </div>
    `;
  }).join('');

  autocompleteContainer.style.display = 'block';

  autocompleteContainer.querySelectorAll('.search-autocomplete-item').forEach((item) => {
    item.addEventListener('click', () => {
      const courseCode = item.dataset.courseCode;
      const selectedCourse = (homeDesktopHeaderState.searchCourses || []).find((course) => String(course?.course_code || '') === String(courseCode || ''));
      input.value = selectedCourse?.title || '';
      autocompleteContainer.style.display = 'none';
      autocompleteContainer.innerHTML = '';
      if (selectedCourse) {
        openCourseInfoMenu(selectedCourse);
      }
    });
  });
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

async function initializeHomeDesktopHeader() {
  const homeMain = document.getElementById('home-main');
  const desktopHeader = homeMain?.querySelector('.home-container-above.container-above-desktop');
  if (!homeMain || !desktopHeader) return;

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
                    <li class="nav-main-item"><button class="nav-btn" id="calendar-btn" data-route="/calendar">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Calendar</span>
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
                <h2 class="total-text">Assignments Due</h2>
                <h2 class="total-count">0</h2>
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
            <h2 class="total-count" id="term-semester">Fall</h2>
            <h2 class="total-text" id="term-year">2025</h2>
          </div>
        </div>
      `;
    } else {
      // New Next Class HTML (will be used once enabled)
      this.innerHTML = `
        <div class="total-courses">
          <div class="total-courses-container">
            <h2 class="total-text" id="next-class-label">Next Class</h2>
            <h2 class="total-count" id="next-class-name">Loading...</h2>
            <h2 class="total-text" id="next-class-time">Calculating...</h2>
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
      nextClassContainer.setAttribute('role', 'button');
      nextClassContainer.setAttribute('tabindex', '0');
      nextClassContainer.addEventListener('click', this.handleNextClassCardClick);
      nextClassContainer.addEventListener('keydown', this.handleNextClassCardKeyDown);
    }
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

    if (!labelEl || !nameEl || !timeEl) return;
    this.currentNextClassCourse = null;

    try {
      // Get current user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        nameEl.textContent = 'Please log in';
        timeEl.textContent = '';
        return;
      }

      // Get selected semester
      const year = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const termRaw = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';
      const term = termRaw.includes('/') ? termRaw.split('/')[1] : termRaw;

      // Get user's selected courses
      const { data: profile } = await supabase
        .from('profiles')
        .select('courses_selection')
        .eq('id', session.user.id)
        .single();

      const selectedCourses = profile?.courses_selection || [];
      const normalizedTerm = term.trim();

      // Filter for current semester
      const semesterCourses = selectedCourses.filter(course => {
        const courseTerm = course.term ? (course.term.includes('/') ? course.term.split('/')[1] : course.term) : null;
        return course.year === parseInt(year) && (!courseTerm || courseTerm === normalizedTerm);
      });

      if (semesterCourses.length === 0) {
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        return;
      }

      // Fetch full course data
      const allCoursesInSemester = await fetchCourseData(year, term);
      const userCourses = allCoursesInSemester.filter(course =>
        semesterCourses.some(sc => sc.code === course.course_code)
      );

      // Find next class
      const nextClass = this.findNextClass(userCourses, year, term);

      if (!nextClass) {
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        return;
      }

      // Display the class info
      let displayName = nextClass.course.title || nextClass.course.course_code;

      // Truncate to 30 characters if needed
      if (displayName.length > 22) {
        displayName = displayName.substring(0, 22) + '...';
      }

      if (nextClass.isCurrent) {
        labelEl.textContent = 'Current Class';
        nameEl.textContent = displayName;
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        this.currentNextClassCourse = nextClass.course;
      } else {
        labelEl.textContent = 'Next Class';
        nameEl.textContent = displayName;
        timeEl.textContent = nextClass.timeRemaining;
        timeEl.style.display = nextClass.timeRemaining ? 'block' : 'none';
        this.currentNextClassCourse = nextClass.course;
      }
    } catch (error) {
      console.error('Error updating next class:', error);
      nameEl.textContent = 'Error loading';
      timeEl.textContent = '';
    }
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
      '月': 1, '火': 2, '水': 3, '木': 4, '金': 5
    };

    const scheduledClasses = [];

    courses.forEach(course => {
      const parsed = this.parseTimeSlot(course.time_slot);
      if (!parsed) return;

      const { day, startTime, endTime } = parsed;
      const dayNum = dayMap[day];
      if (!dayNum) return;

      scheduledClasses.push({
        course,
        dayNum,
        startTime,
        endTime
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

      if (targetDay === 0 || targetDay === 6) continue; // Skip weekends

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

    // Calculate time remaining string
    const days = Math.floor(minDiff / (24 * 60));
    const hours = Math.floor((minDiff % (24 * 60)) / 60);
    const minutes = Math.floor(minDiff % 60);

    let timeStr = 'in ';
    if (days > 0) timeStr += `${days}d `;
    if (hours > 0) timeStr += `${hours}h `;
    if (minutes > 0 || (days === 0 && hours === 0)) timeStr += `${minutes}m`;

    return {
      course: nextClass.course,
      isCurrent: false,
      timeRemaining: timeStr.trim()
    };
  }

  parseTimeSlot(timeSlot) {
    if (!timeSlot) return null;

    // Try Japanese format: (月1講時) or (月曜日1講時)
    let match = timeSlot.match(/\(?([月火水木金])(?:曜日)?(\d+)(?:講時)?\)?/);
    if (match) {
      const dayJP = match[1];
      const period = parseInt(match[2], 10);

      const timeSlots = {
        1: { start: 9 * 60, end: 10 * 60 + 30 },      // 09:00-10:30
        2: { start: 10 * 60 + 45, end: 12 * 60 + 15 }, // 10:45-12:15
        3: { start: 13 * 60 + 10, end: 14 * 60 + 40 }, // 13:10-14:40
        4: { start: 14 * 60 + 55, end: 16 * 60 + 25 }, // 14:55-16:25
        5: { start: 16 * 60 + 40, end: 18 * 60 + 10 }  // 16:40-18:10
      };

      const slot = timeSlots[period];
      if (!slot) return null;

      return {
        day: dayJP,
        startTime: slot.start,
        endTime: slot.end
      };
    }

    // Try English format: "Mon 09:00 - 10:30"
    const engMatch = timeSlot.match(/^(Mon|Tue|Wed|Thu|Fri)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
    if (engMatch) {
      const day = engMatch[1];
      const startHour = parseInt(engMatch[2], 10);
      const startMin = parseInt(engMatch[3], 10);
      const endHour = parseInt(engMatch[4], 10);
      const endMin = parseInt(engMatch[5], 10);

      return {
        day,
        startTime: startHour * 60 + startMin,
        endTime: endHour * 60 + endMin
      };
    }

    return null;
  }

  getSemesterEnd(year, term) {
    // Spring semester: April 1 - July 31
    // Fall semester: October 1 - January 31 (next year)
    if (term === 'Spring') {
      return new Date(year, 6, 31, 23, 59, 59); // July 31 (month is 0-indexed)
    } else {
      return new Date(parseInt(year) + 1, 0, 31, 23, 59, 59); // January 31 next year
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
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.shadow = this;
    this.calendar = this.querySelector("#calendar-main");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.querySelector("#loading-indicator");
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

    this.calendar.addEventListener("click", this.handleCalendarClickBound);
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
      { start: 16 * 60 + 40, end: 18 * 60 + 10, row: 4 }  // 16:40-18:10 (period 5)
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

      this.renderLegendFromCourses(coursesToShow);

      console.log('Mini calendar: Courses to show:', coursesToShow.length);
      console.log('Mini calendar: Course details:', coursesToShow.map(c => ({ code: c.course_code, time: c.time_slot })));

      this.clearCourseCells();

      for (const course of coursesToShow) {
        if (this.isRenderRequestStale(requestId)) return;

        // Try Japanese format first: (月曜日1講時) or (月1講時) or (木4講時)
        let match = course.time_slot?.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
        let dayEN, period;

        if (match) {
          // Japanese format
          const dayJP = match[1];
          period = parseInt(match[2], 10);
          const dayMap = { "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat", "日": "Sun" };
          dayEN = dayMap[dayJP];
        } else {
          // Try English format: "Mon 10:45 - 12:15", "Wed 09:00 - 10:30", etc.
          const englishMatch = course.time_slot?.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
          if (englishMatch) {
            dayEN = englishMatch[1];
            const startHour = parseInt(englishMatch[2], 10);
            const startMin = parseInt(englishMatch[3], 10);

            // Map time to period based on start time
            const timeToSlot = startHour * 100 + startMin;
            if (timeToSlot >= 900 && timeToSlot < 1030) period = 1;
            else if (timeToSlot >= 1045 && timeToSlot < 1215) period = 2;
            else if (timeToSlot >= 1310 && timeToSlot < 1440) period = 3;
            else if (timeToSlot >= 1455 && timeToSlot < 1625) period = 4;
            else if (timeToSlot >= 1640 && timeToSlot < 1810) period = 5;
            else period = -1; // Invalid time slot
          }
        }

        if (!dayEN || !this.dayIdByEN[dayEN] || !period || period < 1) {
          continue;
        }

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
        div.dataset.timeLabel = formatPeriodWindow(period) || String(course.time_slot || '');
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

      // Fill remaining empty cells with placeholders
      if (this.isRenderRequestStale(requestId)) return;
      this.populateEmptyPlaceholders();
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
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
      const currentMonth = new Date().getMonth() + 1;
      return currentMonth >= 8 || currentMonth <= 2 ? "Fall" : "Spring";
    })();

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
    this.handlePageLoaded = () => setTimeout(() => this.renderQuickActions(), 70);
    this.renderQuickActions();
  }

  renderQuickActions() {
    this.innerHTML = `
      <div class="home-courses-preview home-quick-actions-panel">
        <div class="home-courses-preview-header">
          <h2 class="home-courses-preview-title">Quick Actions</h2>
        </div>
        <div class="home-quick-actions-stack">
          <button type="button" class="home-quick-action-btn" data-action="add-assignment">Add assignment</button>
          <button type="button" class="home-quick-action-btn" data-action="browse-courses">Browse courses</button>
          <button type="button" class="home-quick-action-btn" data-action="write-review">Write review</button>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);

    const card = this.querySelector('.home-courses-preview');
    if (card) {
      card.removeEventListener('click', this.handleActionClick);
      card.addEventListener('click', this.handleActionClick);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    const card = this.querySelector('.home-courses-preview');
    if (card) {
      card.removeEventListener('click', this.handleActionClick);
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

    if (action === 'write-review') {
      const reviewCard = document.querySelector('#home-review-suggestion-container .home-review-suggestion');
      const reviewContainer = document.getElementById('home-review-suggestion-container');
      if (reviewCard && reviewContainer && reviewContainer.style.display !== 'none') {
        reviewCard.click();
        return;
      }
      navigateToRoute('/courses');
    }
  }
}

class ReviewSuggestionWidget extends HTMLElement {
  constructor() {
    super();
    this.suggestedCourse = null;
    this.lastSuggestedCourseKey = null;
    this.handlePageLoaded = () => {
      setTimeout(() => this.refreshSuggestion(), 120);
    };
    this.handleCardClick = () => {
      if (!this.suggestedCourse) return;
      const route = `/courses/${encodeURIComponent(this.suggestedCourse.code)}/${this.suggestedCourse.year}/${encodeURIComponent(this.suggestedCourse.term)}`;
      if (window.router?.navigate) {
        window.router.navigate(route);
        return;
      }
      window.location.href = withBase(route);
    };
    this.handleCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleCardClick();
      }
    };

    this.innerHTML = `
      <div class="home-review-suggestion">
        <div class="home-review-suggestion-header">
          <h2 class="home-review-suggestion-title">Suggestion</h2>
          <span class="home-review-suggestion-link">Write Review</span>
        </div>
        <p class="home-review-suggestion-text">Review a course you have registered for.</p>
        <div class="home-review-suggestion-course-card">
          <h3 class="home-review-suggestion-course">Loading...</h3>
          <p class="home-review-suggestion-meta"></p>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.refreshSuggestion();
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);

    const card = this.querySelector('.home-review-suggestion');
    if (card) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.removeEventListener('click', this.handleCardClick);
      card.removeEventListener('keydown', this.handleCardKeyDown);
      card.addEventListener('click', this.handleCardClick);
      card.addEventListener('keydown', this.handleCardKeyDown);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    const card = this.querySelector('.home-review-suggestion');
    if (card) {
      card.removeEventListener('click', this.handleCardClick);
      card.removeEventListener('keydown', this.handleCardKeyDown);
    }
  }

  setContainerVisibility(isVisible) {
    this.style.display = isVisible ? 'block' : 'none';
    const container = this.closest('#home-review-suggestion-container');
    if (container) {
      container.style.display = isVisible ? 'block' : 'none';
    }
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

  getCourseSuggestionKey(course) {
    if (!course) return '';
    const code = String(course.code || '').trim();
    const year = Number(course.year) || '';
    const term = this.normalizeTerm(course.term || '');
    return `${code}|${year}|${term}`;
  }

  getReviewedCourseKey(code, termValue) {
    const normalizedCode = String(code || '').trim();
    const normalizedTerm = this.normalizeTerm(termValue || '');
    return `${normalizedCode}|${normalizedTerm}`;
  }

  pickRandomCourse(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return null;
    if (courses.length === 1) return courses[0];

    const candidates = this.lastSuggestedCourseKey
      ? courses.filter((course) => this.getCourseSuggestionKey(course) !== this.lastSuggestedCourseKey)
      : courses;
    const pool = candidates.length > 0 ? candidates : courses;
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex];
  }

  async refreshSuggestion() {
    const courseTitleEl = this.querySelector('.home-review-suggestion-course');
    const courseMetaEl = this.querySelector('.home-review-suggestion-meta');
    const courseCardEl = this.querySelector('.home-review-suggestion-course-card');
    if (courseTitleEl) courseTitleEl.textContent = 'Loading...';
    if (courseMetaEl) courseMetaEl.textContent = '';
    if (courseCardEl) courseCardEl.style.backgroundColor = 'rgba(255, 255, 255, 0.72)';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || null;
      if (!user) {
        this.suggestedCourse = null;
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

      let reviewedCourseKeys = new Set();
      try {
        const { data: reviewedCourses, error: reviewedCoursesError } = await supabase
          .from('course_reviews')
          .select('course_code, term')
          .eq('user_id', user.id);

        if (reviewedCoursesError) {
          throw reviewedCoursesError;
        }

        reviewedCourseKeys = new Set(
          (reviewedCourses || []).map((review) =>
            this.getReviewedCourseKey(review.course_code, review.term)
          )
        );
      } catch (error) {
        console.error('Error loading reviewed courses for suggestion widget:', error);
      }

      const availableCourses = uniqueSelectedCourses.filter((course) => {
        const reviewedKey = this.getReviewedCourseKey(course.code, course.term);
        return !reviewedCourseKeys.has(reviewedKey);
      });

      if (availableCourses.length === 0) {
        this.suggestedCourse = null;
        this.setContainerVisibility(false);
        return;
      }

      const selectedCourse = this.pickRandomCourse(availableCourses) || availableCourses[0];
      const year = Number(selectedCourse.year) || new Date().getFullYear();
      const term = this.normalizeTerm(selectedCourse.term);
      const code = String(selectedCourse.code);

      let displayTitle = code;
      let courseType = null;
      try {
        const semesterCourses = await fetchCourseData(year, term);
        const matchedCourse = Array.isArray(semesterCourses)
          ? semesterCourses.find((course) => course.course_code === code)
          : null;
        if (matchedCourse) {
          displayTitle = normalizeCourseTitle(matchedCourse.title || code);
          courseType = matchedCourse.type || null;
        }
      } catch (error) {
        console.error('Error fetching course title for review suggestion:', error);
      }

      this.suggestedCourse = { code, year, term };
      this.lastSuggestedCourseKey = `${code}|${year}|${term}`;
      if (courseTitleEl) courseTitleEl.textContent = displayTitle;
      if (courseMetaEl) courseMetaEl.textContent = `${term} ${year}`;
      if (courseCardEl) {
        courseCardEl.style.backgroundColor = courseType
          ? getCourseColorByType(courseType)
          : 'rgba(255, 255, 255, 0.72)';
      }
      this.setContainerVisibility(true);
    } catch (error) {
      console.error('Error loading review suggestion widget:', error);
      this.suggestedCourse = null;
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
    const credits = Number(data?.creditsTotal || 0);
    const creditsLabel = credits % 1 === 0 ? credits.toFixed(0) : credits.toFixed(1);
    const creditsProgressLabel = `${creditsLabel}/${HOME_SEMESTER_MAX_CREDITS}`;
    const slotCountLabel = `${data?.occupiedSlotsCount || 0}/25`;
    const conflicts = Array.isArray(data?.conflicts) ? data.conflicts : [];
    const conflictSectionMarkup = conflicts.length
      ? `
        <div class="home-planner-conflict-box">
          <h4>Conflicts</h4>
          <ul class="home-planner-conflict-list">
            ${conflicts.slice(0, 2).map((conflict) => `
              <li>${escapeHtml(conflict.label)} (${conflict.courses.length})</li>
            `).join('')}
          </ul>
        </div>
      `
      : '';

    this.innerHTML = `
      <div class="home-planner-overview">
        <h3 class="home-planner-section-title">Planner</h3>
        <div class="home-planner-kpi-grid">
          <div class="home-planner-kpi">
            <span>Credits</span>
            <strong>${creditsProgressLabel}</strong>
          </div>
          <div class="home-planner-kpi">
            <span>Courses</span>
            <strong>${data?.courseCount || 0}</strong>
          </div>
          <div class="home-planner-kpi">
            <span>Slots</span>
            <strong>${slotCountLabel}</strong>
          </div>
        </div>
        ${conflictSectionMarkup}
        <div class="home-planner-actions">
          <button type="button" class="home-planner-action-btn" data-action="add-course">Add course</button>
          <button type="button" class="home-planner-action-btn" data-action="find-slots">Find courses for empty slots</button>
        </div>
      </div>
    `;
  }

  handleActionClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;

    const action = actionElement.dataset.action;
    if (action === 'add-course') {
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

  }
}

class HomeProgressRequirements extends HomePlannerWidgetBase {
  renderWidget(data) {
    if (!data?.isAuthenticated) {
      this.innerHTML = `
        <div class="home-progress-card-content">
          <div class="home-progress-card-header">
            <h2 class="home-progress-card-title">Progress</h2>
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

    this.innerHTML = `
      <div class="home-progress-card-content">
        <div class="home-progress-card-header">
          <h2 class="home-progress-card-title">Progress / Requirements</h2>
          <span class="home-progress-meta">${data?.courseCount || 0} courses</span>
        </div>
        <div class="home-progress-stat-grid">
          <div class="home-progress-stat">
            <span class="home-progress-stat-label">Credits</span>
            <strong class="home-progress-stat-value">${creditsProgressLabel}</strong>
          </div>
          <div class="home-progress-stat">
            <span class="home-progress-stat-label">Slots filled</span>
            <strong class="home-progress-stat-value">${data?.occupiedSlotsCount || 0}/25</strong>
          </div>
        </div>
        <div class="home-progress-breakdown">
          ${breakdown.length ? breakdown.map((entry) => {
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
    }).join('') : '<p class="home-planner-empty">Requirements breakdown coming soon.</p>'}
        </div>
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
    const slots = Array.isArray(data?.emptySlots) ? data.emptySlots.slice(0, 6) : [];

    if (!slots.length) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-planner-module-header">
            <h2 class="home-planner-module-title">Empty slots</h2>
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
          <h2 class="home-planner-module-title">Empty slots</h2>
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
    this.savedEntries = Array.isArray(data?.savedCourses) ? data.savedCourses.slice(0, 5) : [];

    if (!this.savedEntries.length) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-planner-module-header">
            <h2 class="home-planner-module-title">Saved for later</h2>
          </div>
          <p class="home-planner-empty">Save courses to add later.</p>
          <button type="button" class="home-module-link-btn" data-action="browse-courses">Browse courses</button>
        </div>
      `;
      return;
    }

    this.innerHTML = `
      <div class="home-planner-module">
        <div class="home-planner-module-header">
          <h2 class="home-planner-module-title">Saved for later</h2>
        </div>
        <ul class="home-planner-list">
          ${this.savedEntries.map((course, index) => `
            <li class="home-planner-list-item">
              <span>
                <strong>${escapeHtml(course.title)}</strong>
                ${course.day && course.period ? `<small>${escapeHtml(formatSlotLabel(course.day, course.period))}</small>` : ''}
              </span>
              <button type="button" class="home-module-link-btn" data-action="add-saved" data-index="${index}">Add</button>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  async handleSavedAction(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
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
            <h2 class="home-planner-module-title">Due soon</h2>
          </div>
          <p class="home-planner-empty">Sign in to see upcoming deadlines.</p>
        </div>
      `;
      return;
    }

    const dueSoonItems = Array.isArray(data?.assignmentsDueSoon) ? data.assignmentsDueSoon.slice(0, 3) : [];
    if (!dueSoonItems.length) {
      this.innerHTML = `
        <div class="home-planner-module">
          <div class="home-planner-module-header">
            <h2 class="home-planner-module-title">Due soon</h2>
          </div>
          <p class="home-planner-empty">No deadlines in the next 7 days.</p>
          <button type="button" class="home-module-link-btn" data-action="open-assignments">Open assignments</button>
        </div>
      `;
      return;
    }

    this.innerHTML = `
      <div class="home-planner-module">
        <div class="home-planner-module-header">
          <h2 class="home-planner-module-title">Due soon</h2>
          <span class="home-module-badge">${data.assignmentsDueSoon.length}</span>
        </div>
        <ul class="home-planner-list">
          ${dueSoonItems.map((assignment) => {
      const daysLeft = assignment.daysLeft;
      const deadlineText = daysLeft === 0
        ? 'Due today'
        : (daysLeft === 1 ? '1 day left' : `${daysLeft} days left`);
      const dueDateLabel = formatDueDateLabel(assignment.dueDate) || 'Date not set';
      const courseLabel = assignment.courseName || assignment.courseCode || 'Course not set';
      return `
              <li class="home-planner-list-item home-due-item">
                <button type="button" class="home-due-item-btn" data-action="open-assignments">
                  <strong>${escapeHtml(assignment.title)}</strong>
                  <small class="home-due-item-meta">
                    <span class="home-due-item-meta-value">${escapeHtml(dueDateLabel)}</span>
                    <span class="home-due-item-meta-separator">•</span>
                    <span class="home-due-item-meta-value home-due-item-meta-course">${escapeHtml(courseLabel)}</span>
                    <span class="home-due-item-meta-separator">•</span>
                    <span class="home-due-item-meta-value">${escapeHtml(deadlineText)}</span>
                  </small>
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
    if (!actionElement) {
      if (event.target.closest('.home-planner-module')) {
        navigateToRoute('/assignments');
      }
      return;
    }
    if (actionElement.dataset.action === 'open-assignments') {
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
      { start: 16 * 60 + 40, end: 18 * 60 + 10, row: 4 }
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
      const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
        const currentMonth = new Date().getMonth() + 1;
        return currentMonth >= 8 || currentMonth <= 2 ? "Fall" : "Spring";
      })();

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
      if (!course.day || !course.period) return;

      const dayIndex = dayMap[course.day];
      if (!dayIndex) return;

      const period = parseInt(course.period);
      if (isNaN(period) || period < 1 || period > 5) return;

      // Find the cell (row = period, column = day)
      const table = this.querySelector('#calendar tbody');
      const row = table.rows[period - 1]; // 0-indexed
      const cell = row.cells[dayIndex]; // day index is already 1-based, so this works

      if (cell) {
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
      }
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
