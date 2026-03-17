import { supabase } from "../supabase.js";
import {
    fetchCourseData,
    getCourseColorByType,
    fetchAvailableSemesters,
    isCourseGpaAlignedWithCurrentProfessor,
    getCourseRequiredYearMeta,
    parseProfileCurrentYearLevel,
    showGlobalToast
} from './shared.js';
import { openCourseInfoMenu, initializeCourseRouting, checkTimeConflict, showTimeConflictModal } from './shared.js';
import * as wanakana from 'wanakana';
import { getCurrentAppPath, withBase } from './path-utils.js';
import { applyPreferredTermToGlobals, normalizeTermValue, resolvePreferredTermForAvailableSemesters, setPreferredTermValue } from './preferences.js';
import { openSemesterMobileSheet } from './semester-mobile-sheet.js';
import { readSavedCourses, syncSavedCoursesForUser } from './saved-courses.js';

// Import components to ensure web components are defined
import './components.js';

// Handle dynamic viewport height for mobile browsers
function setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}

// Initialize viewport height and add listeners for changes
setViewportHeight();
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', () => {
    setTimeout(setViewportHeight, 500); // Delay to account for orientation change
});

// Japanese name romanization mapping
const japaneseNameMapping = {
    // Common surnames
    '髙橋': 'Takahashi', '高橋': 'Takahashi', '高': 'Taka',
    '八木': 'Yagi', '木': 'Ki',
    '和田': 'Wada', '田': 'Da', '和': 'Wa',
    '津田': 'Tsuda', '津': 'Tsu',
    '張': 'Chou',
    '趙': 'Chou',
    '仲間': 'Nakama', '間': 'Ma', '仲': 'Naka',
    '河村': 'Kawamura', '河島': 'Kawashima', '河': 'Kawa', '村': 'Mura', '島': 'Shima',
    '陳': 'Chin',
    '今西': 'Imanishi', '西': 'Nishi', '今': 'Ima',
    '石井': 'Ishii', '石': 'Ishi', '井': 'Ii',
    '小西': 'Konishi', '小': 'Ko',
    '和泉': 'Izumi', '泉': 'Izumi',
    '田中': 'Tanaka', '中': 'Naka',
    '佐藤': 'Satou', '藤': 'Tou', '佐': 'Sa',
    '山田': 'Yamada', '山': 'Yama',
    '鈴木': 'Suzuki', '鈴': 'Suzu', '木': 'Ki',
    '伊藤': 'Itou', '伊': 'I',
    '渡辺': 'Watanabe', '辺': 'Be', '渡': 'Wata',
    '加藤': 'Katou', '加': 'Ka',
    '吉田': 'Yoshida', '吉': 'Yoshi',
    '山本': 'Yamamoto', '本': 'Moto',
    '松本': 'Matsumoto', '松': 'Matsu',
    '井上': 'Inoue', '上': 'Ue',
    '木村': 'Kimura',
    '二村': 'Nimura', '二': 'Ni',
    '原田': 'Harada', '原': 'Hara',
    '槇殿': 'Makidono', '槇': 'Maki', '殿': 'Dono',
    '西村': 'Nishimura',
    '松川': 'Matsukawa',
    '梶': 'Kaji',
    '林': 'Hayashi',
    '森': 'Mori',
    '池田': 'Ikeda', '池': 'Ike',
    '橋本': 'Hashimoto', '橋': 'Hashi',

    // Common given names
    '旬子': 'Junko', '子': 'Ko', '旬': 'Jun',
    '太郎': 'Taro',
    '匡': 'Tadashi',
    '喜彦': 'Yoshihiko', '彦': 'Hiko', '喜': 'Yoshi',
    '皓程': 'Koutei', '程': 'Tei', '皓': 'Kou',
    '亮': 'Ryou',
    '壮彦': 'Takehiko', '壮': 'Take',
    '晴久': 'Haruhisa', '晴': 'Haru', '久': 'Hisa',
    '依君': 'Ikun', '依': 'I', '君': 'Kun',
    '尚実': 'Naomi', '尚': 'Nao', '実': 'Mi',
    '真澄': 'Masumi', '真': 'Masa', '澄': 'Sumi',
    '弘明': 'Hiroaki', '弘': 'Hiro', '明': 'Aki',
    '幸宏': 'Yukihiro', '幸': 'Yuki', '宏': 'Hiro',
    '桂子': 'Keiko', '桂': 'Kei',
    '伸子': 'Nobuko', '伸': 'Nobu',
    '伴子': 'Tomoko', '伴': 'Tomo',
    '藍子': 'Aiko', '藍': 'Ai',
    '杏寧': 'Anna', '杏': 'An', '寧': 'Na',
    '勉': 'Tsutomu',

    // Common Hiragana names (these will mostly be handled by WanaKana, but added for completeness)
    'たかはし': 'Takahashi', 'やぎ': 'Yagi', 'わだ': 'Wada',
    'なかま': 'Nakama', 'かわむら': 'Kawamura', 'いまにし': 'Imanishi',
    'いしい': 'Ishii', 'こにし': 'Konishi', 'いずみ': 'Izumi',
    'たなか': 'Tanaka', 'さとう': 'Satou', 'やまだ': 'Yamada',
    'すずき': 'Suzuki', 'いとう': 'Itou', 'わたなべ': 'Watanabe',

    // Common Katakana names (these will mostly be handled by WanaKana, but added for completeness)
    'タカハシ': 'Takahashi', 'ヤギ': 'Yagi', 'ワダ': 'Wada',
    'ナカマ': 'Nakama', 'カワムラ': 'Kawamura', 'イマニシ': 'Imanishi',
    'イシイ': 'Ishii', 'コニシ': 'Konishi', 'イズミ': 'Izumi',
    'タナカ': 'Tanaka', 'サトウ': 'Satou', 'ヤマダ': 'Yamada',
    'スズキ': 'Suzuki', 'イトウ': 'Itou', 'ワタナベ': 'Watanabe',
    'ケルシー': 'Kelsey', 'オリバー': 'Oliver'
};

const japaneseFullNameMapping = {
    '二村 太郎': 'Nimura Taro',
    '今西 ケルシー オリバー': 'Imanishi Kelsey Oliver',
    '仲間 壮彦': 'Nakama Takehiko',
    '八木 匡': 'Yagi Tadashi',
    '原田 勉': 'Harada Tsutomu',
    '和泉 真澄': 'Izumi Masumi',
    '和田 喜彦': 'Wada Yoshihiko',
    '小西 尚実': 'Konishi Naomi',
    '張 皓程': 'Chou Koutei',
    '槇殿 伴子': 'Makidono Tomoko',
    '河島 伸子': 'Kawashima Nobuko',
    '河村 晴久': 'Kawamura Haruhisa',
    '石井 弘明': 'Ishii Hiroaki',
    '西村 幸宏': 'Nishimura Yukihiro',
    '趙 亮': 'Chou Ryou',
    '鈴木 桂子': 'Suzuki Keiko',
    '陳 依君': 'Chin Ikun',
    '梶 藍子': 'Kaji Aiko',
    '松川 杏寧': 'Matsukawa Anna',
    '津田 太郎': 'Tsuda Taro',
    '髙橋 旬子': 'Takahashi Junko',
    '三牧 聖子': 'Mimaki Seiko',
    '中西 久枝': 'Nakanishi Hisae',
    '南川 文里': 'Minamikawa Fumisato',
    '秋林 こずえ': 'Akibayashi Kozue',
    '菅野 優香': 'Kanno Yuka'
};

const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
const japaneseNameTokenEntries = Object.entries(japaneseNameMapping)
    .filter(([token]) => token.length > 1)
    .sort((left, right) => right[0].length - left[0].length);
const japaneseFullNameLookup = Object.entries(japaneseFullNameMapping).reduce((lookup, [name, romanized]) => {
    const normalizedName = String(name || '').replace(/[　\s]+/g, ' ').trim();
    if (!normalizedName) return lookup;
    lookup[normalizedName] = romanized;
    lookup[normalizedName.replace(/\s+/g, '')] = romanized;
    return lookup;
}, {});

function normalizeProfessorNameInput(name) {
    return String(name || '').replace(/[　\s]+/g, ' ').trim();
}

function romanizeJapaneseNamePart(part) {
    if (!part || !JAPANESE_CHAR_REGEX.test(part)) return part;

    const mappedWholePart = japaneseNameMapping[part];
    if (mappedWholePart) return mappedWholePart;

    const wanaKanaResult = wanakana.toRomaji(part);
    if (wanaKanaResult && !JAPANESE_CHAR_REGEX.test(wanaKanaResult)) {
        return wanaKanaResult;
    }

    let cursor = 0;
    let mappedAny = false;
    let result = '';

    while (cursor < part.length) {
        let matchedToken = false;

        for (const [token, tokenRomaji] of japaneseNameTokenEntries) {
            if (part.startsWith(token, cursor)) {
                result += tokenRomaji;
                cursor += token.length;
                mappedAny = true;
                matchedToken = true;
                break;
            }
        }

        if (matchedToken) continue;

        const char = part[cursor];
        const mappedChar = japaneseNameMapping[char];
        if (mappedChar) {
            result += mappedChar;
            mappedAny = true;
            cursor += 1;
            continue;
        }

        const charRomaji = wanakana.toRomaji(char);
        if (charRomaji && !JAPANESE_CHAR_REGEX.test(charRomaji)) {
            result += charRomaji;
            mappedAny = true;
        } else {
            result += char;
        }
        cursor += 1;
    }

    return mappedAny ? result : part;
}

// Helper function to refresh calendar component
function refreshCalendarComponent() {
    const calendarComponent = document.querySelector('course-calendar');
    if (calendarComponent && calendarComponent.refreshCalendar) {
        calendarComponent.refreshCalendar();
    }

    // Also handle the new calendar-page component
    const calendarPageComponent = document.querySelector('calendar-page');
    if (calendarPageComponent && calendarPageComponent.refreshCalendar) {
        calendarPageComponent.refreshCalendar();
    }
}

// Make refreshCalendarComponent globally accessible
window.refreshCalendarComponent = refreshCalendarComponent;

// Cache for romanized professor names
const romanizedProfessorCache = new Map();

// Clear cache when page loads to ensure fresh romanization
romanizedProfessorCache.clear();

// Helper function to romanize Japanese professor names
function romanizeProfessorName(name) {
    if (!name) return name;
    const normalizedInput = normalizeProfessorNameInput(name);
    if (!normalizedInput) return name;

    // Check cache first
    if (romanizedProfessorCache.has(normalizedInput)) {
        return romanizedProfessorCache.get(normalizedInput);
    }

    // Check if the name contains Japanese characters
    const hasJapanese = JAPANESE_CHAR_REGEX.test(normalizedInput);

    if (!hasJapanese) {
        // Capitalize non-Japanese names properly
        const capitalized = normalizedInput.toUpperCase();
        romanizedProfessorCache.set(normalizedInput, capitalized);
        return capitalized;
    }

    let romanized = normalizedInput;

    try {
        const compactInput = normalizedInput.replace(/\s+/g, '');
        const exactNameMatch = japaneseFullNameLookup[normalizedInput] || japaneseFullNameLookup[compactInput];
        if (exactNameMatch) {
            romanized = exactNameMatch;
        } else {
            // Split by spaces and greedily map longest known tokens.
            const parts = normalizedInput.split(/\s+/);
            const romanizedParts = parts.map((part) => romanizeJapaneseNamePart(part));
            romanized = romanizedParts.join(' ');
        }

        // Clean up and capitalize properly
        romanized = romanized.replace(/\s+/g, ' ').trim();
        // Convert to full caps (uppercase)
        romanized = romanized.toUpperCase();

    } catch (error) {
        console.warn('Error romanizing name:', error);
        romanized = name;
    }

    // Cache the result
    romanizedProfessorCache.set(normalizedInput, romanized);
    return romanized;
}

// Function to pre-romanize all professor names in course data
async function preromanizeCourseData(courses) {
    courses.forEach(course => {
        if (course.professor) {
            course.romanizedProfessor = romanizeProfessorName(course.professor);
        }
    });
    return courses;
}

// Synchronous function to get romanized professor name from cache
function getRomanizedProfessorName(name) {
    const normalizedInput = normalizeProfessorNameInput(name);
    return romanizedProfessorCache.get(normalizedInput) || romanizeProfessorName(normalizedInput);
}

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

function toHexColor(value, fallback = '#E0E0E0') {
    const color = String(value || '').trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;
}

function hexToRgba(hex, alpha = 0.38) {
    const normalized = toHexColor(hex).slice(1);
    const expanded = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;

    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function darkenHexToRgba(hex, darkenFactor = 0.32, alpha = 0.9) {
    const normalized = toHexColor(hex).slice(1);
    const expanded = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;

    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);

    const darkRed = Math.max(0, Math.round(red * (1 - darkenFactor)));
    const darkGreen = Math.max(0, Math.round(green * (1 - darkenFactor)));
    const darkBlue = Math.max(0, Math.round(blue * (1 - darkenFactor)));

    return `rgba(${darkRed}, ${darkGreen}, ${darkBlue}, ${alpha})`;
}

function getCourseCardBorderColor(hex) {
    return darkenHexToRgba(hex, 0.2, 0.68);
}

function getCourseCardHoverBorderColor(hex) {
    return darkenHexToRgba(hex, 0.28, 0.78);
}

// Global sorting state
let currentSortMethod = null;
const SORT_METHOD_LABELS = {
    'title-az': 'Course A-Z',
    'title-za': 'Course Z-A',
    'gpa-a-high': 'Higher % of A',
    'gpa-f-high': 'Higher % of F'
};
const SORT_METHOD_SHORT_LABELS = {
    'title-az': 'A-Z',
    'title-za': 'Z-A',
    'gpa-a-high': 'High A%',
    'gpa-f-high': 'High F%'
};
const RANKING_TOOLTIP_DETAIL = 'Share of students in the previous class offering who received a letter grade of A.';
const NEW_PROFESSOR_TOOLTIP_TITLE = 'New Professor';
const NEW_PROFESSOR_TOOLTIP_DETAIL = 'Compared with the immediately previous offering of this course, the professor has changed.';

// Global search state
let currentSearchQuery = null;
let suggestionsDisplayed = false; // Track if suggestions are currently shown
let desktopSearchDebounceTimer = null;
let courseChipTooltipElement = null;
let activeChipTooltipTarget = null;
let courseEvalPopoverElement = null;
let activeCourseEvalPopoverTrigger = null;
let courseAssessmentLayoutObserver = null;
let courseAssessmentSeparatorUpdateRaf = 0;
let courseRankingVisibilityRaf = 0;
let stickyHeaderObserverCleanup = null;
let activeCoursePresetId = null;
let lastLoadedCoursePlanningContext = {
    statusLookup: new Map(),
    scheduleSignalLookup: new Map(),
    userYearLevel: null,
    hasKnownUserYear: false
};

// Global course loading state management
let isLoadingCourses = false;
let courseLoadRetryCount = 0;
let lastLoadedCourses = null; // Cache the last loaded courses data
let lastLoadedYear = null;
let lastLoadedTerm = null;
let lastLoadedProfessorChanges = new Set(); // Cache professor changes
let courseStatusSyncListenersBound = false;
let courseStatusRefreshTimer = null;
const MAX_COURSE_LOAD_RETRIES = 3;
const HOME_SLOT_PREFILTER_KEY = 'ila_home_slot_prefilter';
const HOME_PREFILTER_MAX_AGE_MS = 10 * 60 * 1000;
const COURSE_PAGE_SEARCH_PREFILL_KEY = 'ila_courses_search_prefill';
const COURSE_PAGE_SEARCH_PREFILL_MAX_AGE_MS = 10 * 60 * 1000;
const COURSE_PAGE_PRESET_PREFILL_KEY = 'ila_courses_preset_prefill';
const COURSE_PAGE_PRESET_PREFILL_MAX_AGE_MS = 10 * 60 * 1000;
const CALENDAR_BUSY_SLOTS_STORAGE_KEY = 'ila_calendar_busy_slots_v1';
const COURSE_DEFAULT_SLOT_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    .flatMap((day) => [1, 2, 3, 4, 5].map((period) => `${day}-${period}`));
const HOME_PREFILTER_PERIOD_TO_TIME = {
    1: '09:00',
    2: '10:45',
    3: '13:10',
    4: '14:55',
    5: '16:40'
};
const HOME_PREFILTER_TYPE_TO_CONCENTRATION = {
    Core: ['culture', 'economy', 'politics', 'seminar'],
    Foundation: ['academic', 'understanding'],
    Elective: ['special'],
    Graduate: ['graduate']
};

const COURSE_SMART_PRESET_CONFIG = {
    'preset-empty-slots': {
        id: 'preset-empty-slots',
        label: 'My empty slots'
    },
    'preset-no-conflicts': {
        id: 'preset-no-conflicts',
        label: 'No conflicts'
    },
    'preset-saved-only': {
        id: 'preset-saved-only',
        label: 'Saved only'
    },
    'preset-registered-only': {
        id: 'preset-registered-only',
        label: 'Registered only'
    },
    'preset-has-presentation': {
        id: 'preset-has-presentation',
        label: 'Has no presentation'
    },
    'preset-has-exam': {
        id: 'preset-has-exam',
        label: 'Has no exam'
    },
    'preset-fits-my-year': {
        id: 'preset-fits-my-year',
        label: 'Fits my year'
    }
};

function consumeHomeSlotPrefilter() {
    try {
        const raw = window.sessionStorage.getItem(HOME_SLOT_PREFILTER_KEY);
        if (!raw) return null;
        window.sessionStorage.removeItem(HOME_SLOT_PREFILTER_KEY);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        const createdAt = Number(parsed.createdAt || 0);
        if (createdAt && (Date.now() - createdAt) > HOME_PREFILTER_MAX_AGE_MS) {
            return null;
        }

        const day = String(parsed.day || '').trim();
        const parsedPeriod = Number(parsed.period);
        const period = Number.isFinite(parsedPeriod) ? parsedPeriod : null;
        const term = String(parsed.term || '').trim();
        const year = Number(parsed.year);
        const time = String(parsed.time || '').trim() || null;
        const typeFilters = Array.isArray(parsed.typeFilters)
            ? Array.from(new Set(parsed.typeFilters
                .map((value) => String(value || '').trim())
                .filter((value) => value === 'Core' || value === 'Foundation' || value === 'Elective')))
            : null;

        if (!day || !term || !Number.isFinite(year)) {
            return null;
        }

        return {
            day,
            period,
            term,
            year,
            time: time || (Number.isFinite(period) ? HOME_PREFILTER_PERIOD_TO_TIME[period] : null) || null,
            typeFilters: typeFilters && typeFilters.length > 0 ? typeFilters : null
        };
    } catch (error) {
        console.warn('Unable to consume home slot prefilter payload:', error);
        return null;
    }
}

function consumeCoursePageSearchPrefill() {
    try {
        const raw = window.sessionStorage.getItem(COURSE_PAGE_SEARCH_PREFILL_KEY);
        if (!raw) return null;
        window.sessionStorage.removeItem(COURSE_PAGE_SEARCH_PREFILL_KEY);

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        const createdAt = Number(parsed.createdAt || 0);
        if (createdAt && (Date.now() - createdAt) > COURSE_PAGE_SEARCH_PREFILL_MAX_AGE_MS) {
            return null;
        }

        const query = String(parsed.query || '').trim();
        const term = String(parsed.term || '').trim();
        const year = Number(parsed.year);

        return {
            query: query || null,
            term: term || null,
            year: Number.isFinite(year) ? year : null
        };
    } catch (error) {
        console.warn('Unable to consume course-page search prefill payload:', error);
        return null;
    }
}

function consumeCoursePagePresetPrefill() {
    try {
        const raw = window.sessionStorage.getItem(COURSE_PAGE_PRESET_PREFILL_KEY);
        if (!raw) return null;
        window.sessionStorage.removeItem(COURSE_PAGE_PRESET_PREFILL_KEY);

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        const createdAt = Number(parsed.createdAt || 0);
        if (createdAt && (Date.now() - createdAt) > COURSE_PAGE_PRESET_PREFILL_MAX_AGE_MS) {
            return null;
        }

        const presetId = String(parsed.presetId || '').trim();
        if (!getCourseSmartPresetConfig(presetId)) {
            return null;
        }

        return { presetId };
    } catch (error) {
        console.warn('Unable to consume course-page preset prefill payload:', error);
        return null;
    }
}

function applyCoursePageSearchPrefillInputs(searchQuery) {
    const normalized = String(searchQuery || '').trim();
    if (!normalized) return;

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = normalized;

    const searchPillInput = document.getElementById('search-pill-input');
    if (searchPillInput) searchPillInput.value = normalized;
}

function applyHomePrefilterSemester(prefilter) {
    if (!prefilter) return;
    const normalizedTermValue = normalizeTermValue(`${prefilter.term}-${prefilter.year}`);
    if (!normalizedTermValue) return;

    const [term, yearText] = normalizedTermValue.split('-');
    const year = parseInt(yearText, 10);
    if (!term || !Number.isFinite(year)) return;

    const termSelect = document.getElementById('term-select');
    const yearSelect = document.getElementById('year-select');
    if (termSelect) termSelect.value = term;
    if (yearSelect) yearSelect.value = String(year);

    const semesterSelect = document.getElementById('semester-select');
    if (semesterSelect) {
        semesterSelect.value = normalizedTermValue;
        syncSemesterDropdowns(normalizedTermValue);
    }

    setPreferredTermValue(normalizedTermValue);
    applyPreferredTermToGlobals(normalizedTermValue);
}

async function applyHomePrefilterFilters(prefilter) {
    if (!prefilter) return;

    const dayValue = prefilter.day;
    const timeValue = Number.isFinite(prefilter.period)
        ? (HOME_PREFILTER_PERIOD_TO_TIME[prefilter.period] || prefilter.time)
        : (prefilter.time || null);

    const dayCheckboxes = document.querySelectorAll('#filter-by-days .filter-checkbox');
    dayCheckboxes.forEach((checkbox) => {
        checkbox.checked = checkbox.value === dayValue;
    });

    const timeCheckboxes = document.querySelectorAll('#filter-by-time .filter-checkbox');
    timeCheckboxes.forEach((checkbox) => {
        checkbox.checked = checkbox.value === timeValue;
    });

    const concentrationCheckboxes = document.querySelectorAll('#filter-by-concentration .filter-checkbox');
    concentrationCheckboxes.forEach((checkbox) => {
        checkbox.checked = false;
    });
    const assessmentCheckboxes = document.querySelectorAll('#filter-by-assessment .filter-checkbox');
    assessmentCheckboxes.forEach((checkbox) => {
        checkbox.checked = false;
    });
    const requiredYearCheckboxes = document.querySelectorAll('#filter-by-required-year .filter-checkbox');
    requiredYearCheckboxes.forEach((checkbox) => {
        checkbox.checked = false;
    });

    if (Array.isArray(prefilter.typeFilters) && prefilter.typeFilters.length > 0) {
        const mappedValues = new Set(
            prefilter.typeFilters.flatMap((typeLabel) => HOME_PREFILTER_TYPE_TO_CONCENTRATION[typeLabel] || [])
        );

        concentrationCheckboxes.forEach((checkbox) => {
            checkbox.checked = mappedValues.has(checkbox.value);
        });
    }

    setActiveCoursePreset(null, { syncOnly: true });
    currentSearchQuery = null;
    updateCourseFilterTriggerCount();
    await applySearchAndFilters(null);
}

function getCourseFilterCheckboxes() {
    return document.querySelectorAll(
        '#filter-by-days .filter-checkbox, #filter-by-time .filter-checkbox, #filter-by-concentration .filter-checkbox, #filter-by-assessment .filter-checkbox, #filter-by-required-year .filter-checkbox'
    );
}

function getCourseSmartPresetConfig(presetId) {
    if (!presetId) return null;
    return COURSE_SMART_PRESET_CONFIG[presetId] || null;
}

function syncCoursePresetButtons() {
    const presetButtons = document.querySelectorAll('[data-course-preset]');
    presetButtons.forEach((button) => {
        const presetId = String(button.dataset.coursePreset || '').trim();
        const isActive = presetId && presetId === activeCoursePresetId;
        button.classList.toggle('is-active', Boolean(isActive));
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setActiveCoursePreset(nextPresetId, { syncOnly = false } = {}) {
    const normalizedPresetId = String(nextPresetId || '').trim();
    const hasValidPreset = Boolean(getCourseSmartPresetConfig(normalizedPresetId));
    activeCoursePresetId = hasValidPreset ? normalizedPresetId : null;

    if (syncOnly || !normalizedPresetId || hasValidPreset || normalizedPresetId === '') {
        syncCoursePresetButtons();
    }
}

function getAppliedCourseFilterCount() {
    const checkboxCount = Array.from(getCourseFilterCheckboxes()).filter((checkbox) => checkbox.checked).length;
    return checkboxCount + (activeCoursePresetId ? 1 : 0);
}

function ensureCourseFilterCountChip(filterBtn) {
    if (!filterBtn) return null;

    let chip = filterBtn.querySelector('.course-filter-count-chip');
    if (!chip) {
        chip = document.createElement('span');
        chip.className = 'calendar-filter-count-chip course-filter-count-chip';
        chip.setAttribute('aria-hidden', 'true');
        chip.hidden = true;
        filterBtn.appendChild(chip);
    }

    return chip;
}

function updateCourseFilterTriggerCount() {
    const filterBtns = document.querySelectorAll('.page-courses .filter-btn');
    if (!filterBtns.length) return;

    const count = getAppliedCourseFilterCount();
    const countLabel = count > 99 ? '99+' : String(count);
    const ariaLabel = count > 0 ? `Filters, ${count} applied` : 'Filters';

    filterBtns.forEach((filterBtn) => {
        const chip = ensureCourseFilterCountChip(filterBtn);
        if (!chip) return;

        if (count > 0) {
            chip.hidden = false;
            chip.textContent = countLabel;
            filterBtn.classList.add('has-active-filters');
        } else {
            chip.hidden = true;
            chip.textContent = '';
            filterBtn.classList.remove('has-active-filters');
        }

        filterBtn.setAttribute('aria-label', ariaLabel);
    });
}

function getSortMethodLabel(method = currentSortMethod) {
    return SORT_METHOD_LABELS[method] || SORT_METHOD_LABELS['title-az'];
}

function getSortMethodShortLabel(method = currentSortMethod) {
    return SORT_METHOD_SHORT_LABELS[method] || SORT_METHOD_SHORT_LABELS['title-az'];
}

function updateSortStatusDisplay() {
    const label = getSortMethodLabel();
    const compactLabel = getSortMethodShortLabel();
    const sortBtns = document.querySelectorAll('.page-courses .sort-btn');
    const sortStatusPills = document.querySelectorAll('.sort-status-pill');

    sortBtns.forEach((sortBtn) => {
        const labelElement = sortBtn.querySelector('.sort-btn-label');
        if (labelElement) {
            labelElement.textContent = compactLabel;
        }
        sortBtn.setAttribute('aria-label', `Sort: ${label}`);
        sortBtn.setAttribute('title', `Sort: ${label}`);
    });

    sortStatusPills.forEach((pill) => {
        pill.textContent = label;
        pill.title = `Current sort: ${label}`;
    });
}

function doesCourseChipNeedWrapping(chipElement) {
    if (!chipElement || chipElement.hidden) return false;

    const styles = window.getComputedStyle(chipElement);
    if (styles.display === 'none' || styles.visibility === 'hidden') return false;

    const chipRect = chipElement.getBoundingClientRect();
    if (chipRect.width <= 1) return false;

    const measureChip = chipElement.cloneNode(true);
    measureChip.style.position = 'absolute';
    measureChip.style.left = '-99999px';
    measureChip.style.top = '-99999px';
    measureChip.style.visibility = 'hidden';
    measureChip.style.pointerEvents = 'none';
    measureChip.style.width = 'auto';
    measureChip.style.maxWidth = 'none';
    measureChip.style.minWidth = '0';
    measureChip.style.whiteSpace = 'nowrap';
    measureChip.style.height = 'auto';
    measureChip.style.display = 'inline-flex';
    document.body.appendChild(measureChip);

    const nowrapWidth = measureChip.getBoundingClientRect().width;
    measureChip.remove();

    return nowrapWidth > (chipRect.width + 0.5);
}

function updateCourseCardRankingChipVisibility() {
    const courseList = document.getElementById('course-list');
    if (!courseList) return;

    const footerRows = courseList.querySelectorAll('.class-outside .course-footer-row--desktop');
    footerRows.forEach((row) => {
        const rankingChip = row.querySelector('.course-chip-ranking');
        if (!rankingChip) return;

        const footerLeft = row.querySelector('.course-footer-left');
        const footerRight = row.querySelector('.course-footer-right');
        if (!footerLeft) return;

        rankingChip.hidden = false;
        rankingChip.removeAttribute('aria-hidden');

        if (row.clientWidth <= 0) return;

        const rowStyles = window.getComputedStyle(row);
        const gapValue = parseFloat(rowStyles.columnGap || rowStyles.gap || '0');
        const rowGap = Number.isFinite(gapValue) ? gapValue : 0;

        const footerRightWidth = footerRight ? footerRight.scrollWidth : 0;
        const requiredWidth = footerLeft.scrollWidth + footerRightWidth + (footerRight ? rowGap : 0);
        const hasHorizontalOverflow = requiredWidth > (row.clientWidth + 0.5);

        const rowChips = Array.from(row.querySelectorAll('.course-chip'))
            .filter((chip) => chip.closest('.course-footer-row--desktop') === row && !chip.hidden);
        const hasAnyMultiLineChip = rowChips.some((chip) => doesCourseChipNeedWrapping(chip));

        if (hasHorizontalOverflow || hasAnyMultiLineChip) {
            rankingChip.hidden = true;
            rankingChip.setAttribute('aria-hidden', 'true');
        }
    });
}

function requestCourseCardRankingChipVisibilityUpdate() {
    if (courseRankingVisibilityRaf) return;
    courseRankingVisibilityRaf = window.requestAnimationFrame(() => {
        courseRankingVisibilityRaf = 0;
        updateCourseCardRankingChipVisibility();
    });
}

function getTotalVisibleCourseCards() {
    const courseList = document.getElementById('course-list');
    if (!courseList) return 0;
    return courseList.querySelectorAll('.class-outside').length;
}

function getFilteredVisibleCourseCards() {
    const courseList = document.getElementById('course-list');
    if (!courseList) return 0;

    return Array.from(courseList.querySelectorAll('.class-outside'))
        .filter((card) => card.style.display !== 'none')
        .length;
}

function getFilterLabelFromCheckbox(checkbox) {
    const id = checkbox?.id;
    if (!id) return String(checkbox?.value || '').trim();

    const labelElement = document.querySelector(`label[for="${id}"]`);
    if (!labelElement) return String(checkbox?.value || '').trim();

    const clone = labelElement.cloneNode(true);
    clone.querySelectorAll('small').forEach((small) => small.remove());
    const normalizedLabel = clone.textContent.replace(/\s+/g, ' ').trim();
    return normalizedLabel || String(checkbox?.value || '').trim();
}

function getAppliedCourseFilters() {
    const checkboxFilters = Array.from(getCourseFilterCheckboxes())
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => ({
            id: checkbox.id,
            label: getFilterLabelFromCheckbox(checkbox),
            type: 'checkbox'
        }));

    const presetConfig = getCourseSmartPresetConfig(activeCoursePresetId);
    if (presetConfig) {
        checkboxFilters.push({
            id: presetConfig.id,
            label: presetConfig.label,
            type: 'preset'
        });
    }

    return checkboxFilters;
}

function updateActiveCourseFilterDisplay() {
    const filterSummary = document.getElementById('course-active-filters');
    const chipsContainer = document.getElementById('course-active-filter-chips');
    const clearButton = document.getElementById('course-clear-active-filters');
    const filterRow = document.getElementById('courses-toolbar-row-b');

    if (!filterSummary || !chipsContainer) return;

    const activeFilters = getAppliedCourseFilters();
    const hasActiveSearch = Boolean(String(currentSearchQuery || '').trim());
    const keepRowForMobileSearchSummary = hasActiveSearch && window.innerWidth <= 1023;
    chipsContainer.innerHTML = '';

    if (activeFilters.length === 0) {
        filterSummary.hidden = true;
        if (clearButton) clearButton.hidden = true;
        if (filterRow) filterRow.hidden = !keepRowForMobileSearchSummary;
        return;
    }

    const chipMarkup = activeFilters
        .map((filter) => {
            const dataAttr = filter.type === 'preset'
                ? `data-preset-id="${escapeCourseMarkup(filter.id)}"`
                : `data-filter-id="${escapeCourseMarkup(filter.id)}"`;
            return `<button type="button" class="course-active-filter-chip" ${dataAttr} aria-label="Remove filter ${escapeCourseMarkup(filter.label)}">${escapeCourseMarkup(filter.label)}<span class="course-active-filter-chip-close" aria-hidden="true">×</span></button>`;
        })
        .join('');
    chipsContainer.innerHTML = chipMarkup;

    filterSummary.hidden = false;
    if (clearButton) clearButton.hidden = activeFilters.length < 2;
    if (filterRow) filterRow.hidden = false;
}

function clearCourseFiltersAndSearchAndRefresh() {
    resetCoursePageFiltersAndSearch();
    hideCourseChipTooltip();
    hideCourseEvalPopover();
    return applySearchAndFilters(null);
}

function clearCourseFiltersOnlyAndRefresh() {
    getCourseFilterCheckboxes().forEach((checkbox) => {
        checkbox.checked = false;
    });
    setActiveCoursePreset(null, { syncOnly: true });

    hideCourseChipTooltip();
    hideCourseEvalPopover();
    updateCourseFilterTriggerCount();
    return applySearchAndFilters(currentSearchQuery);
}

function resetCoursePageFiltersAndSearch() {
    getCourseFilterCheckboxes().forEach((checkbox) => {
        checkbox.checked = false;
    });
    setActiveCoursePreset(null, { syncOnly: true });

    currentSearchQuery = null;
    suggestionsDisplayed = false;

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';

    const searchPillInput = document.getElementById('search-pill-input');
    if (searchPillInput) searchPillInput.value = '';

    const searchAutocomplete = document.getElementById('search-autocomplete');
    if (searchAutocomplete) {
        searchAutocomplete.style.display = 'none';
        searchAutocomplete.innerHTML = '';
    }

    const searchPillAutocomplete = document.getElementById('search-pill-autocomplete');
    if (searchPillAutocomplete) {
        searchPillAutocomplete.style.display = 'none';
        searchPillAutocomplete.innerHTML = '';
    }

    const courseList = document.getElementById('course-list');
    if (courseList) {
        courseList.querySelector('.no-results')?.remove();
        courseList.querySelector('.course-empty-state')?.remove();
    }

    updateCourseFilterTriggerCount();
}

function mapStartTimeToCoursePeriod(startHour, startMinute) {
    const numericStart = (Number(startHour) * 100) + Number(startMinute);
    if (numericStart >= 900 && numericStart < 1030) return 1;
    if (numericStart >= 1045 && numericStart < 1215) return 2;
    if (numericStart >= 1310 && numericStart < 1440) return 3;
    if (numericStart >= 1455 && numericStart < 1625) return 4;
    if (numericStart >= 1640 && numericStart < 1810) return 5;
    return null;
}

function parseCourseMeetingSlots(timeSlot) {
    const raw = String(timeSlot || '').trim();
    if (!raw) return [];

    const slots = [];
    const seen = new Set();
    const addSlot = (day, period) => {
        const normalizedDay = String(day || '').trim();
        const normalizedPeriod = Number(period);
        if (!normalizedDay || !Number.isFinite(normalizedPeriod)) return;
        if (normalizedPeriod < 1 || normalizedPeriod > 5) return;
        const key = `${normalizedDay}-${normalizedPeriod}`;
        if (seen.has(key)) return;
        seen.add(key);
        slots.push({ day: normalizedDay, period: normalizedPeriod, key });
    };

    const jpDayMap = { '月': 'Mon', '火': 'Tue', '水': 'Wed', '木': 'Thu', '金': 'Fri', '土': 'Sat', '日': 'Sun' };
    const jpRegex = /([月火水木金土日])(?:曜日)?\s*([1-5])(?:講時)?/g;
    let jpMatch = jpRegex.exec(raw);
    while (jpMatch) {
        addSlot(jpDayMap[jpMatch[1]], Number(jpMatch[2]));
        jpMatch = jpRegex.exec(raw);
    }

    const enRegex = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\s+(\d{1,2}):(\d{2})/gi;
    let enMatch = enRegex.exec(raw);
    while (enMatch) {
        const period = mapStartTimeToCoursePeriod(parseInt(enMatch[2], 10), parseInt(enMatch[3], 10));
        addSlot(enMatch[1], period);
        enMatch = enRegex.exec(raw);
    }

    return slots;
}

function isIntensiveCourseTimeSlot(timeSlot) {
    const raw = String(timeSlot || '').trim();
    if (!raw) return false;
    return /(集中講義|集中|intensive)/i.test(raw);
}

function getCourseMeetingTimes(courseData) {
    const slots = parseCourseMeetingSlots(courseData?.time_slot);
    if (!slots.length) {
        const fallbackDay = String(courseData?.day || '').trim();
        const fallbackPeriod = Number(courseData?.period);
        if (fallbackDay && Number.isFinite(fallbackPeriod)) {
            return [{ day: fallbackDay, period: fallbackPeriod, key: `${fallbackDay}-${fallbackPeriod}` }];
        }
    }
    return slots;
}

function formatCourseSlotLabel(slot) {
    if (!slot || !slot.day || !Number.isFinite(slot.period)) return '';
    const periodLabelMap = {
        1: '1st',
        2: '2nd',
        3: '3rd',
        4: '4th',
        5: '5th'
    };
    return `${slot.day} ${periodLabelMap[slot.period] || `${slot.period}th`}`;
}

function readCalendarBusySlotsForSemester(year, term) {
    const busySlots = new Set();
    const normalizedYear = Number(year);
    const normalizedTerm = normalizeCourseTermLabel(term);
    if (!Number.isFinite(normalizedYear) || !normalizedTerm) return busySlots;

    const semesterKey = `${Math.trunc(normalizedYear)}-${normalizedTerm}`;
    try {
        const raw = window.localStorage.getItem(CALENDAR_BUSY_SLOTS_STORAGE_KEY);
        if (!raw) return busySlots;
        const parsed = JSON.parse(raw);
        const semesterSlots = Array.isArray(parsed?.[semesterKey]) ? parsed[semesterKey] : [];
        semesterSlots.forEach((value) => {
            const normalized = String(value || '').trim();
            if (!normalized) return;
            busySlots.add(normalized);
        });
    } catch (error) {
        console.warn('Unable to read saved busy slots for courses page:', error);
    }

    return busySlots;
}

const PRESENTATION_KEYWORD_PATTERN = /(?:\bpresent(?:ation|ations|ing|ed)\b|発表)/i;

function textMentionsPresentation(value) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    return PRESENTATION_KEYWORD_PATTERN.test(normalized);
}

function isAdvancedSeminarCourse(course) {
    const normalizedType = String(course?.type || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalizedType) return false;
    if (normalizedType === 'advanced seminars and honors thesis') return true;
    if (normalizedType === 'advanced seminar and honors thesis') return true;
    return normalizedType.includes('advanced seminar');
}

function hasPresentationInEvaluationComponents(components) {
    if (!Array.isArray(components) || components.length === 0) return false;
    return components.some((component) => (
        textMentionsPresentation(component?.name) || textMentionsPresentation(component?.notes)
    ));
}

function deriveDeterministicAssessmentFlags(course) {
    const canonicalTags = new Set();
    getCourseEvaluationTags(course, 10).forEach((tag) => {
        const normalized = String(tag || '').trim().toLowerCase();
        if (normalized) canonicalTags.add(normalized);
    });

    const components = normalizeEvaluationComponents(course);
    components.forEach((component) => {
        const canonical = canonicalEvaluationTagFromName(component?.name);
        const normalized = String(canonical || '').trim().toLowerCase();
        if (normalized) canonicalTags.add(normalized);
    });

    const hasExam = Array.from(canonicalTags).some((tag) => tag.includes('exam') || tag.includes('midterm'));
    const hasPresentationByTags = Array.from(canonicalTags).some((tag) => tag.includes('presentation'));
    const hasPresentationByComponents = hasPresentationInEvaluationComponents(components);
    const hasPresentationByCourseType = isAdvancedSeminarCourse(course);
    const hasPresentation = hasPresentationByTags || hasPresentationByComponents || hasPresentationByCourseType;
    const hasPaper = Array.from(canonicalTags).some((tag) => tag.includes('paper'));
    const hasWeeklyAssignments = Array.from(canonicalTags).some((tag) => tag.includes('weekly'));

    return {
        hasExam,
        hasPresentation,
        hasPaper,
        hasWeeklyAssignments,
        noExam: !hasExam,
        noPresentation: !hasPresentation
    };
}

function getSelectedCourseFilterState() {
    const dayCheckboxes = document.querySelectorAll('#filter-by-days .filter-checkbox');
    const selectedDays = Array.from(dayCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);

    const timeCheckboxes = document.querySelectorAll('#filter-by-time .filter-checkbox');
    const selectedTimes = Array.from(timeCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);

    const concentrationCheckboxes = document.querySelectorAll('#filter-by-concentration .filter-checkbox');
    const selectedConcentrations = Array.from(concentrationCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);

    const assessmentCheckboxes = document.querySelectorAll('#filter-by-assessment .filter-checkbox');
    const selectedAssessmentFilters = Array.from(assessmentCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.dataset.assessmentFilter)
        .filter(Boolean);
    const requiredYearCheckboxes = document.querySelectorAll('#filter-by-required-year .filter-checkbox');
    const selectedRequiredYearMins = Array.from(requiredYearCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => Number.parseInt(checkbox.value, 10))
        .filter((value) => Number.isFinite(value) && value > 0);
    const planningUserYear = Number(lastLoadedCoursePlanningContext?.userYearLevel);
    const normalizedPlanningUserYear = Number.isFinite(planningUserYear) && planningUserYear > 0
        ? Math.trunc(planningUserYear)
        : null;
    const hasKnownUserYear = Boolean(lastLoadedCoursePlanningContext?.hasKnownUserYear && normalizedPlanningUserYear);

    return {
        selectedDays,
        selectedTimes,
        selectedConcentrations,
        selectedAssessmentFilters,
        selectedRequiredYearMins,
        userYearLevel: normalizedPlanningUserYear,
        hasKnownUserYear,
        activePresetId: activeCoursePresetId,
        scheduleSmartFilters: {
            noConflicts: activeCoursePresetId === 'preset-no-conflicts' || undefined,
            emptySlots: activeCoursePresetId === 'preset-empty-slots' || undefined
        }
    };
}

function doesAssessmentFilterMatch(assessmentFlags, filterId) {
    if (!assessmentFlags || !filterId) return false;
    switch (String(filterId)) {
        case 'has-presentation':
            return Boolean(assessmentFlags.hasPresentation);
        case 'has-exam':
            return Boolean(assessmentFlags.hasExam);
        case 'has-paper':
            return Boolean(assessmentFlags.hasPaper);
        case 'has-weekly':
            return Boolean(assessmentFlags.hasWeeklyAssignments);
        case 'no-exam':
            return Boolean(assessmentFlags.noExam);
        case 'no-presentation':
            return Boolean(assessmentFlags.noPresentation);
        default:
            return false;
    }
}

function doesCourseMatchSmartPreset(courseData, selectedFilterState) {
    const presetId = selectedFilterState?.activePresetId;
    if (!presetId) return true;

    const scheduleSignalType = String(courseData?.scheduleSignal?.type || 'none');
    const stateFlags = courseData?.stateFlags || {};
    const assessmentFlags = courseData?.assessmentFlags || deriveDeterministicAssessmentFlags(courseData);
    const presetUserYearLevel = Number.isFinite(Number(selectedFilterState?.userYearLevel))
        ? Math.trunc(Number(selectedFilterState.userYearLevel))
        : null;
    const requiredYearMeta = getCourseRequiredYearMeta(courseData, presetUserYearLevel);

    switch (presetId) {
        case 'preset-empty-slots':
            return scheduleSignalType === 'empty_slot_match';
        case 'preset-no-conflicts':
            return scheduleSignalType !== 'conflict';
        case 'preset-saved-only':
            return Boolean(stateFlags.isSaved);
        case 'preset-registered-only':
            return Boolean(stateFlags.isRegistered);
        case 'preset-has-presentation':
            return !Boolean(assessmentFlags.hasPresentation);
        case 'preset-has-exam':
            return !Boolean(assessmentFlags.hasExam);
        case 'preset-fits-my-year':
            if (!requiredYearMeta.hasRequiredYear) return true;
            if (!requiredYearMeta.hasKnownUserYear) return true;
            return Boolean(requiredYearMeta.meetsRequirement);
        default:
            return true;
    }
}

function getTopGpaChipLabel(course, hasProfessorChanged = false) {
    if (hasProfessorChanged) {
        return "";
    }

    const aRate = Number(course?.gpa_a_percent);
    if (!Number.isFinite(aRate) || aRate <= 0) {
        return "";
    }

    return `A-rate: ${Math.round(aRate)}%`;
}

function getGpaChipMarkup(course, hasProfessorChanged = false) {
    const gpaSummaryLabel = getTopGpaChipLabel(course, hasProfessorChanged);
    if (!gpaSummaryLabel) {
        return "";
    }

    return `<span class="course-chip course-chip-ranking" data-tooltip-title="${gpaSummaryLabel}" data-tooltip-detail="${RANKING_TOOLTIP_DETAIL}">${gpaSummaryLabel}</span>`;
}

function getNewProfessorChipMarkup(hasProfessorChanged = false) {
    if (!hasProfessorChanged) {
        return "";
    }

    return `<span class="course-new-prof-chip" data-tooltip-title="${escapeCourseMarkup(NEW_PROFESSOR_TOOLTIP_TITLE)}" data-tooltip-detail="${escapeCourseMarkup(NEW_PROFESSOR_TOOLTIP_DETAIL)}">New</span>`;
}

function getCourseCreditsBadgeLabel(course) {
    const rawCredits = course && course.credits;
    if (rawCredits === null || rawCredits === undefined || rawCredits === "") {
        return "Credits TBA";
    }

    const normalizedCredits = String(rawCredits).trim();
    if (!normalizedCredits) {
        return "Credits TBA";
    }

    const parsedCredits = parseFloat(normalizedCredits.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsedCredits) && parsedCredits > 0) {
        const formattedCredits = Number.isInteger(parsedCredits)
            ? String(parsedCredits)
            : String(parsedCredits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
        const creditUnit = parsedCredits === 1 ? "Credit" : "Credits";
        return `${formattedCredits} ${creditUnit}`;
    }

    return /credit/i.test(normalizedCredits) ? normalizedCredits : `${normalizedCredits} Credits`;
}

function getCreditsChipMarkup(course) {
    const rawCredits = course && course.credits;
    if (rawCredits === null || rawCredits === undefined || rawCredits === "") return '';

    const normalizedCredits = String(rawCredits).trim();
    if (!normalizedCredits) return '';

    const parsedCredits = parseFloat(normalizedCredits.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsedCredits) && Math.abs(parsedCredits - 1) < 0.0001) {
        return `<span class="course-chip course-chip-credits">1 Credit</span>`;
    }

    if (Number.isFinite(parsedCredits) && parsedCredits >= 3) {
        const formattedCredits = Number.isInteger(parsedCredits)
            ? String(parsedCredits)
            : String(parsedCredits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
        return `<span class="course-chip course-chip-credits">${formattedCredits} Credits</span>`;
    }

    return '';
}

function resolveCourseRequiredYearMeta(course, coursePlanningContext = {}) {
    const fallbackUserYear = Number.isFinite(Number(coursePlanningContext?.userYearLevel))
        ? Math.trunc(Number(coursePlanningContext.userYearLevel))
        : null;
    return getCourseRequiredYearMeta(course, fallbackUserYear);
}

function getRequiredYearChipMarkup(requiredYearMeta, { mobile = false } = {}) {
    if (!requiredYearMeta?.hasRequiredYear) return '';

    const classes = ['course-chip', 'course-chip-required-year'];
    if (requiredYearMeta?.hasKnownUserYear && requiredYearMeta?.meetsRequirement) {
        classes.push('course-chip-required-year-fit');
    } else if (requiredYearMeta?.hasKnownUserYear && !requiredYearMeta?.meetsRequirement) {
        classes.push('course-chip-required-year-blocked');
    }
    if (mobile) {
        classes.push('course-chip-mobile-required-year');
    }

    return `<span class="${classes.join(' ')}">${escapeCourseMarkup(requiredYearMeta.requiredYearLabel || 'Required year')}</span>`;
}

function isYearAwareCoursePreset(presetId) {
    return String(presetId || '').trim() === 'preset-fits-my-year';
}

function showPresetRequiresYearToast() {
    showGlobalToast('Set your current year in Profile to use "Fits my year".');
}

async function resolveCurrentUserYearContext() {
    const cachedYear = Number(lastLoadedCoursePlanningContext?.userYearLevel);
    if (Number.isFinite(cachedYear) && cachedYear > 0) {
        const normalized = Math.trunc(cachedYear);
        lastLoadedCoursePlanningContext = {
            ...lastLoadedCoursePlanningContext,
            userYearLevel: normalized,
            hasKnownUserYear: true
        };
        return { userYearLevel: normalized, hasKnownUserYear: true };
    }

    try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session || null;
        if (!session?.user?.id) {
            lastLoadedCoursePlanningContext = {
                ...lastLoadedCoursePlanningContext,
                userYearLevel: null,
                hasKnownUserYear: false
            };
            return { userYearLevel: null, hasKnownUserYear: false };
        }

        const hasMissingProfileColumnError = (error) => {
            const code = String(error?.code || '').toUpperCase();
            const message = String(error?.message || '').toLowerCase();
            return code === '42703' || (message.includes('column') && message.includes('does not exist'));
        };

        let profileResponse = await supabase
            .from('profiles')
            .select('current_year, year_opt_out, year')
            .eq('id', session.user.id)
            .single();

        if (profileResponse.error && hasMissingProfileColumnError(profileResponse.error)) {
            profileResponse = await supabase
                .from('profiles')
                .select('year')
                .eq('id', session.user.id)
                .single();
        }

        const profile = profileResponse?.data || null;
        const parsedYear = parseProfileCurrentYearLevel(profile);
        const hasKnownUserYear = Number.isFinite(parsedYear);
        const userYearLevel = hasKnownUserYear ? Math.trunc(Number(parsedYear)) : null;

        lastLoadedCoursePlanningContext = {
            ...lastLoadedCoursePlanningContext,
            userYearLevel,
            hasKnownUserYear
        };

        return { userYearLevel, hasKnownUserYear };
    } catch (error) {
        console.warn('Unable to resolve profile year for "Fits my year" preset:', error);
        lastLoadedCoursePlanningContext = {
            ...lastLoadedCoursePlanningContext,
            userYearLevel: null,
            hasKnownUserYear: false
        };
        return { userYearLevel: null, hasKnownUserYear: false };
    }
}

async function canActivateYearAwarePreset() {
    const yearContext = await resolveCurrentUserYearContext();
    if (!yearContext.hasKnownUserYear) {
        showPresetRequiresYearToast();
        return false;
    }
    return true;
}

function normalizeCourseTermLabel(termValue) {
    const raw = String(termValue || '').trim();
    if (!raw) return '';
    if (raw.includes('/')) return normalizeCourseTermLabel(raw.split('/').pop());

    const lowered = raw.toLowerCase();
    if (lowered.includes('fall') || raw.includes('秋')) return 'Fall';
    if (lowered.includes('spring') || raw.includes('春')) return 'Spring';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function buildCourseStatusKey(courseLike = {}, fallbackYear = null, fallbackTerm = null) {
    const code = String(courseLike?.course_code || courseLike?.code || '').trim().toUpperCase();
    if (!code) return '';

    const yearValue = Number(courseLike?.academic_year ?? courseLike?.year ?? fallbackYear);
    const termValue = normalizeCourseTermLabel(courseLike?.term || fallbackTerm);
    if (!Number.isFinite(yearValue) || !termValue) return '';

    return `${code}|${Math.trunc(yearValue)}|${termValue}`;
}

async function buildCourseStatusLookup(courses = [], year, term) {
    const context = {
        statusLookup: new Map(),
        scheduleSignalLookup: new Map(),
        userYearLevel: null,
        hasKnownUserYear: false
    };
    if (!Array.isArray(courses) || courses.length === 0) return context;

    const fallbackYear = Number(year);
    const fallbackTerm = normalizeCourseTermLabel(term);
    if (!Number.isFinite(fallbackYear) || !fallbackTerm) {
        return context;
    }

    let session = null;
    try {
        const { data } = await supabase.auth.getSession();
        session = data?.session || null;
    } catch (error) {
        console.warn('Unable to read auth session for course status chips:', error);
    }

    let savedCourseKeys = new Set();
    if (session?.user?.id) {
        let savedCourses = readSavedCourses(Number.POSITIVE_INFINITY);
        try {
            savedCourses = await syncSavedCoursesForUser(session.user.id);
        } catch (error) {
            console.warn('Unable to sync saved courses for status chips:', error);
        }

        savedCourseKeys = new Set(
            (Array.isArray(savedCourses) ? savedCourses : [])
                .map((entry) => buildCourseStatusKey(entry, fallbackYear, fallbackTerm))
                .filter(Boolean)
        );
    }

    const registeredCourseKeys = new Set();
    const registeredCourseCodes = new Set();
    const registeredSlots = new Set();
    const busySlots = readCalendarBusySlotsForSemester(fallbackYear, fallbackTerm);
    const emptySlots = new Set(COURSE_DEFAULT_SLOT_KEYS.filter((slotKey) => !busySlots.has(slotKey)));

    if (session?.user?.id) {
        try {
            const hasMissingProfileColumnError = (error) => {
                const code = String(error?.code || '').toUpperCase();
                const message = String(error?.message || '').toLowerCase();
                return code === '42703' || (message.includes('column') && message.includes('does not exist'));
            };

            let profileResponse = await supabase
                .from('profiles')
                .select('courses_selection, current_year, year_opt_out, year')
                .eq('id', session.user.id)
                .single();
            if (profileResponse.error && hasMissingProfileColumnError(profileResponse.error)) {
                profileResponse = await supabase
                    .from('profiles')
                    .select('courses_selection')
                    .eq('id', session.user.id)
                    .single();
            }

            if (profileResponse.error) throw profileResponse.error;
            const profileData = profileResponse?.data || null;
            context.userYearLevel = parseProfileCurrentYearLevel(profileData);
            context.hasKnownUserYear = Number.isFinite(context.userYearLevel);

            const selectedCourses = Array.isArray(profileData?.courses_selection)
                ? profileData.courses_selection
                : [];

            selectedCourses.forEach((entry) => {
                const entryYear = Number(entry?.year ?? entry?.academic_year);
                const entryTerm = normalizeCourseTermLabel(entry?.term || fallbackTerm);
                const isMatchingSemester = Number.isFinite(entryYear)
                    && entryYear === fallbackYear
                    && (!entryTerm || entryTerm === fallbackTerm);
                if (!isMatchingSemester) return;

                const normalizedEntry = {
                    ...entry,
                    course_code: entry?.course_code || entry?.code || ''
                };
                const key = buildCourseStatusKey(normalizedEntry, fallbackYear, fallbackTerm);
                if (key) registeredCourseKeys.add(key);

                const code = String(entry?.code || entry?.course_code || '').trim().toUpperCase();
                if (code) registeredCourseCodes.add(code);
            });

            if (registeredCourseCodes.size > 0) {
                const { data: registeredCoursesData, error: registeredCoursesError } = await supabase
                    .from('courses')
                    .select('course_code, time_slot')
                    .in('course_code', Array.from(registeredCourseCodes))
                    .eq('academic_year', fallbackYear)
                    .eq('term', fallbackTerm);

                if (registeredCoursesError) throw registeredCoursesError;

                (Array.isArray(registeredCoursesData) ? registeredCoursesData : []).forEach((registeredCourse) => {
                    const slots = parseCourseMeetingSlots(registeredCourse?.time_slot);
                    slots.forEach((slot) => {
                        registeredSlots.add(slot.key);
                        emptySlots.delete(slot.key);
                    });
                });
            }
        } catch (error) {
            console.warn('Unable to read registered courses for status chips:', error);
        }
    }

    courses.forEach((course) => {
        const key = buildCourseStatusKey(course, fallbackYear, fallbackTerm);
        if (!key) return;

        const code = String(course?.course_code || '').trim().toUpperCase();
        const isRegistered = registeredCourseKeys.has(key);

        if (registeredCourseKeys.has(key)) {
            context.statusLookup.set(key, 'Registered');
        } else if (savedCourseKeys.has(key)) {
            context.statusLookup.set(key, 'Saved');
        }

        const slots = getCourseMeetingTimes(course);
        let scheduleSignal = { type: 'none', label: '' };
        const hasScheduleBaseline = registeredSlots.size > 0 || busySlots.size > 0;

        if (!isRegistered && slots.length > 0) {
            const conflictingSlots = slots.filter((slot) => registeredSlots.has(slot.key));
            if (conflictingSlots.length > 0) {
                const firstConflict = conflictingSlots[0];
                scheduleSignal = {
                    type: 'conflict',
                    label: `Conflicts ${formatCourseSlotLabel(firstConflict)}`,
                    mobileLabel: `Conflicts ${formatCourseSlotLabel(firstConflict)}`
                };
            } else if (hasScheduleBaseline && slots.some((slot) => emptySlots.has(slot.key))) {
                scheduleSignal = {
                    type: 'empty_slot_match',
                    label: 'Fits empty slot',
                    mobileLabel: 'Fits empty slot'
                };
            }
        }

        if (isRegistered && code && registeredCourseCodes.has(code)) {
            scheduleSignal = { type: 'none', label: '' };
        }

        context.scheduleSignalLookup.set(key, scheduleSignal);
    });

    return context;
}

function getMobileCourseTypeChipMarkup(courseTypeLabel) {
    const label = String(courseTypeLabel || '').trim();
    if (!label) return '';
    return `<span class="course-chip course-chip-mobile-type">${escapeCourseMarkup(label)}</span>`;
}

function getRegisteredChipInlineStyle(courseColor) {
    const normalized = toHexColor(courseColor, '#6A9E7B');
    const backgroundColor = darkenHexToRgba(normalized, 0.34, 0.94);
    const borderColor = darkenHexToRgba(normalized, 0.45, 0.98);
    return ` style="background:${backgroundColor}; border-color:${borderColor}; color:rgba(255, 255, 255, 0.97);"`;
}

function getCourseStatusChipMarkup(statusLabel, courseColor = '') {
    const label = String(statusLabel || '').trim();
    if (!label) return '';

    const lower = label.toLowerCase();
    const variantClass = lower === 'registered'
        ? 'course-chip-status-registered'
        : 'course-chip-status-saved';
    const registeredStyle = lower === 'registered' ? getRegisteredChipInlineStyle(courseColor) : '';

    return `<span class="course-chip course-chip-status ${variantClass}"${registeredStyle}>${escapeCourseMarkup(label)}</span>`;
}

function getCourseHelperBadgeMarkup(scheduleSignal = {}, stateFlags = {}) {
    if (!scheduleSignal || scheduleSignal.type === 'none') return '';
    if (stateFlags?.isRegistered) return '';

    if (scheduleSignal.type === 'conflict') {
        const label = scheduleSignal.label || 'Schedule conflict';
        return `<span class="course-chip course-chip-helper course-chip-helper-conflict">${escapeCourseMarkup(label)}</span>`;
    }
    if (scheduleSignal.type === 'empty_slot_match') {
        const label = scheduleSignal.label || 'Fits empty slot';
        return `<span class="course-chip course-chip-helper course-chip-helper-fit">${escapeCourseMarkup(label)}</span>`;
    }
    return '';
}

function getMobilePrimarySignalChipMarkup(statusLabel = '', scheduleSignal = {}, courseColor = '') {
    const normalizedStatus = String(statusLabel || '').trim().toLowerCase();

    if (normalizedStatus === 'registered') {
        const registeredStyle = getRegisteredChipInlineStyle(courseColor);
        return `<span class="course-chip course-chip-status course-chip-status-registered course-chip-mobile-signal"${registeredStyle}>Registered</span>`;
    }

    if (scheduleSignal?.type === 'conflict') {
        let compactLabel = String(scheduleSignal?.mobileLabel || '').trim();
        if (!compactLabel) {
            const fallbackLabel = String(scheduleSignal?.label || '').trim();
            if (fallbackLabel) {
                const normalizedFallback = fallbackLabel.replace(/^Conflicts(?:\s+with)?[:\s]*/i, '').trim();
                compactLabel = normalizedFallback ? `Conflicts ${normalizedFallback}` : 'Conflicts';
            } else {
                compactLabel = 'Conflicts';
            }
        }
        return `<span class="course-chip course-chip-helper course-chip-helper-conflict course-chip-mobile-signal">${escapeCourseMarkup(compactLabel)}</span>`;
    }

    if (scheduleSignal?.type === 'empty_slot_match') {
        const compactLabel = String(scheduleSignal?.mobileLabel || scheduleSignal?.label || 'Fits empty slot').trim();
        return `<span class="course-chip course-chip-helper course-chip-helper-fit course-chip-mobile-signal">${escapeCourseMarkup(compactLabel)}</span>`;
    }

    if (normalizedStatus === 'saved') {
        return '<span class="course-chip course-chip-status course-chip-status-saved course-chip-mobile-signal">Saved</span>';
    }

    return '';
}

function escapeCourseMarkup(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatProfessorCardName(professor) {
    const raw = String(getRomanizedProfessorName(professor) || '').trim();
    if (!raw) return 'TBA';

    const lettersOnly = raw.replace(/[^A-Za-z]/g, '');
    const looksAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
    if (!looksAllCaps) return raw;

    return raw
        .toLowerCase()
        .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function isGraduateCourse(courseLike) {
    const typeLabel = String(courseLike?.type || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (typeLabel === 'graduate courses' || typeLabel === 'graduate course' || typeLabel === 'graduate') return true;
    if (typeLabel.includes('graduate')) return true;

    const tags = Array.isArray(courseLike?.evaluation_tags) ? courseLike.evaluation_tags : [];
    return tags.some((tag) => String(tag || '').trim().toLowerCase() === 'graduate_course');
}

function isGraduateJapaneseTaughtCourse(courseLike) {
    if (!isGraduateCourse(courseLike)) return false;
    return String(courseLike?.class_number || '').trim().toUpperCase() === 'J';
}

function getGraduateLanguageChipMarkup(courseLike, { mobile = false } = {}) {
    if (!isGraduateJapaneseTaughtCourse(courseLike)) return '';
    const className = mobile
        ? 'course-chip course-chip-language-japanese course-chip-mobile-language'
        : 'course-chip course-chip-language-japanese';
    return `<span class="${className}">Japanese</span>`;
}

const GRADUATE_EVALUATION_LABEL_TRANSLATIONS = {
    '平常点': 'Class Participation',
    'プレゼンテーション': 'Presentation',
    '授業への参加': 'Class Participation',
    '中間レポート': 'Midterm Report',
    '期末レポート': 'Final Report',
    '平常点(出席，クラス参加)': 'Attendance and Class Participation',
    '小レポート': 'Short Report',
    '平常点(クラス参加，グループ作業の成果等)': 'Class Participation and Group Work',
    '平常点(クラス参加，グループ作業の成果等': 'Class Participation and Group Work',
    '出席と参加': 'Attendance and Participation',
    '平常点(出席，クラス参加，グループ作業の成果等)': 'Attendance, Class Participation, and Group Work',
    '平常点(出席，クラス参加，グループ作業の': 'Attendance, Class Participation, and Group Work',
    'クラスへの貢献度': 'Contribution to Class',
    '提出物': 'Submitted Work',
    'クラスで発表など': 'Class Presentation',
    '中間レポート試験': 'Midterm Report and Exam',
    '期末レポート試験・論文': 'Final Report, Exam, and Paper',
    'レポート': 'Report'
};

const GRADUATE_EVALUATION_NOTE_TRANSLATIONS = {
    'ジェンダーの視点から平和あるいは平和をめぐる諸問題についての議論': 'Discussion of peace-related issues from a gender perspective',
    'テキストを読み込み，疑問点を明確にした上で参加し，積極的に授業に参加することが求められる。': 'Prepare readings, clarify key questions, and participate actively in class',
    'プレゼンテーション資料も評価対象。': 'Presentation materials are also evaluated',
    '平和研究におけるジェンダー分析の重要性に対する理解': 'Understanding the importance of gender analysis in peace studies',
    '授業内での議論への積極的な参加': 'Active participation in in-class discussion',
    '授業参加，発表，レスポンスの提出など': 'Class participation, presentations, and response submissions',
    '教育をジェンダー分析する意味についての理解': 'Understanding why education should be analyzed through a gender lens',
    '自身が関心を持つ教育とジェンダーに関連する課題の理解': 'Understanding education and gender issues related to your interests',
    '議論への積極的な参加': 'Active participation in discussions'
};

function translateGraduateEvaluationLabel(label) {
    const normalized = String(label || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return GRADUATE_EVALUATION_LABEL_TRANSLATIONS[normalized] || normalized;
}

function translateGraduateEvaluationNote(note) {
    const normalized = String(note || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return GRADUATE_EVALUATION_NOTE_TRANSLATIONS[normalized] || normalized;
}

function translateGraduateEvaluationTag(tag) {
    const normalized = String(tag || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return translateGraduateEvaluationLabel(normalized);
}

function parseEvaluationCriteriaJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

function truncateEvaluationChipLabel(label, maxLength = 20) {
    const normalized = String(label || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;

    const truncated = normalized.slice(0, maxLength + 1);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex >= 10) {
        return `${truncated.slice(0, lastSpaceIndex).trim()}...`;
    }
    return `${truncated.slice(0, maxLength).trim()}...`;
}

const EVALUATION_LABEL_SPELLING_FIXES = [
    [/\bmideterm\b/gi, 'midterm'],
    [/\battendence\b/gi, 'attendance'],
    [/\bpartcipation\b/gi, 'participation'],
    [/\bparticpation\b/gi, 'participation'],
    [/\bparticipaton\b/gi, 'participation'],
    [/\bcontributon\b/gi, 'contribution'],
    [/\bcontributons\b/gi, 'contributions'],
    [/\bcontribitions\b/gi, 'contributions']
];

function correctEvaluationLabelTypos(label) {
    let normalized = String(label || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    EVALUATION_LABEL_SPELLING_FIXES.forEach(([pattern, replacement]) => {
        normalized = normalized.replace(pattern, (match) => {
            if (match === match.toUpperCase()) return replacement.toUpperCase();
            if (match.charAt(0) === match.charAt(0).toUpperCase()) {
                return replacement.charAt(0).toUpperCase() + replacement.slice(1);
            }
            return replacement;
        });
    });

    return normalized
        .replace(/[:：]+\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleCaseEvaluationLabel(label) {
    const normalized = String(label || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized
        .toLowerCase()
        .replace(/(^|[\s\-_/])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function normalizeAssessmentDescriptionText(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const normalized = raw
        .replace(/_+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        .replace(/([,;:!?])(?=\S)/g, '$1 ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s.!?;:：]+$/g, '')
        .trim();

    return normalized ? `${normalized}.` : '';
}

function normalizeEvaluationComponents(course) {
    const parsed = parseEvaluationCriteriaJson(course?.evaluation_criteria_json);
    const rawComponents = Array.isArray(parsed?.components) ? parsed.components : [];
    const graduateCourse = isGraduateCourse(course);
    return rawComponents
        .map((component) => {
            const translatedName = graduateCourse
                ? translateGraduateEvaluationLabel(component?.name)
                : component?.name;
            const name = correctEvaluationLabelTypos(translatedName);
            if (!name) return null;

            const weightValue = Number(component?.weight);
            const hasWeight = Number.isFinite(weightValue);
            const noteSource = graduateCourse
                ? translateGraduateEvaluationNote(component?.notes)
                : component?.notes;
            const notes = normalizeAssessmentDescriptionText(noteSource);

            return {
                name,
                weight: hasWeight ? weightValue : null,
                notes: notes || null
            };
        })
        .filter(Boolean);
}

function normalizeEvaluationLabelPrefix(name) {
    const normalized = correctEvaluationLabelTypos(name);
    if (!normalized) return '';
    const lower = normalized.toLowerCase();
    if (lower.startsWith('presentation')) return 'Presentation';
    if (/^attendance and contributions?\b/.test(lower)) return 'Attendance And Participations';
    return titleCaseEvaluationLabel(normalized);
}

function canonicalEvaluationTagFromName(name) {
    const normalized = normalizeEvaluationLabelPrefix(name);
    if (!normalized) return '';
    if (normalized === 'Presentation' || normalized === 'Attendance And Participations') return normalized;
    const lower = normalized.toLowerCase();
    const quantityMatch = normalized.match(/\b(\d+)\b/);
    const quantity = quantityMatch ? quantityMatch[1] : null;

    if (lower.includes('attendance')) return 'Attendance';
    if (lower.includes('participation')) return 'Participation';
    if (lower.includes('weekly')) return 'Weekly';
    if (lower.includes('midterm')) return 'Midterm';
    if (lower.includes('final presentation') || lower === 'presentation') return 'Presentation';
    if (lower.includes('paper')) return quantity ? `${quantity}x Paper` : 'Paper';
    if (lower.includes('report')) return 'Report';
    if (lower.includes('exam') || lower.includes('test')) return 'Exam';
    if (lower.includes('debate')) return 'Debate';
    if (lower.includes('group')) return 'Group';

    return truncateEvaluationChipLabel(normalized, 20);
}

function deriveEvaluationTagsFromComponents(components, maxTags = 6) {
    if (!Array.isArray(components) || maxTags <= 0) return [];

    const tags = [];
    const seen = new Set();

    const addTag = (value) => {
        const label = String(value || '').replace(/\s+/g, ' ').trim();
        if (!label) return;
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        tags.push(label);
    };

    const sortedComponents = components
        .map((component, index) => ({ component, index }))
        .sort((a, b) => {
            const aWeight = Number.isFinite(a.component.weight) ? a.component.weight : null;
            const bWeight = Number.isFinite(b.component.weight) ? b.component.weight : null;
            if (aWeight === null && bWeight === null) return a.index - b.index;
            if (aWeight === null) return 1;
            if (bWeight === null) return -1;
            if (bWeight !== aWeight) return bWeight - aWeight;
            return a.index - b.index;
        });

    sortedComponents.forEach(({ component }) => {
        addTag(canonicalEvaluationTagFromName(component.name));
    });

    const keywordText = components
        .map((component) => `${component.name || ''} ${component.notes || ''}`)
        .join(' ')
        .toLowerCase();

    const keywordTags = [
        ['presentation', 'Presentation'],
        ['presenting', 'Presentation'],
        ['presented', 'Presentation'],
        ['発表', 'Presentation'],
        ['group', 'Group'],
        ['debate', 'Debate'],
        ['paper', 'Paper'],
        ['report', 'Report'],
        ['exam', 'Exam'],
        ['test', 'Exam']
    ];

    keywordTags.forEach(([keyword, label]) => {
        if (keywordText.includes(keyword)) {
            addTag(label);
        }
    });

    return tags.slice(0, maxTags);
}

function getCourseEvaluationTags(course, maxTags = 6) {
    const graduateCourse = isGraduateCourse(course);
    const dbTags = Array.isArray(course?.evaluation_tags)
        ? course.evaluation_tags
            .filter((tag) => String(tag || '').trim().toLowerCase() !== 'graduate_course')
            .map((tag) => graduateCourse ? translateGraduateEvaluationTag(tag) : tag)
            .map((tag) => normalizeEvaluationLabelPrefix(tag))
            .filter(Boolean)
        : [];

    if (dbTags.length > 0) {
        return Array.from(new Set(dbTags)).slice(0, maxTags);
    }

    const components = normalizeEvaluationComponents(course);
    return deriveEvaluationTagsFromComponents(components, maxTags);
}

function formatEvaluationWeight(weight) {
    if (!Number.isFinite(weight)) return '';
    if (Number.isInteger(weight)) return `${weight}%`;
    return `${weight.toFixed(1).replace(/\.0$/, '')}%`;
}

function getCourseEvaluationBreakdownText(course) {
    const components = normalizeEvaluationComponents(course);
    if (!components.length) return '';

    const breakdown = components.map((component) => {
        const label = normalizeEvaluationLabelPrefix(component.name) || canonicalEvaluationTagFromName(component.name) || component.name;
        const weightText = formatEvaluationWeight(component.weight);
        return weightText ? `${label} ${weightText}` : label;
    });

    return breakdown.join(' • ');
}

function getAssessmentPreviewTagItems(course, maxTags = 6) {
    const components = normalizeEvaluationComponents(course);
    const orderedByWeight = components
        .map((component, index) => ({ component, index }))
        .sort((a, b) => {
            const aWeight = Number.isFinite(a.component.weight) ? a.component.weight : null;
            const bWeight = Number.isFinite(b.component.weight) ? b.component.weight : null;
            if (aWeight === null && bWeight === null) return a.index - b.index;
            if (aWeight === null) return 1;
            if (bWeight === null) return -1;
            if (bWeight !== aWeight) return bWeight - aWeight;
            return a.index - b.index;
        });

    const orderedTags = [];
    const seen = new Set();
    const addTag = (shortLabel, fullLabel = shortLabel) => {
        const normalizedShort = String(shortLabel || '').replace(/\s+/g, ' ').trim();
        if (!normalizedShort) return;
        const key = normalizedShort.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        orderedTags.push({
            label: normalizedShort,
            fullLabel: String(fullLabel || normalizedShort).replace(/\s+/g, ' ').trim() || normalizedShort
        });
    };

    orderedByWeight.forEach(({ component }) => {
        const fullLabel = correctEvaluationLabelTypos(component.name) || component.name;
        addTag(canonicalEvaluationTagFromName(fullLabel), fullLabel);
    });

    if (!orderedTags.length) {
        getCourseEvaluationTags(course, maxTags).forEach((tag) => {
            const fullLabel = correctEvaluationLabelTypos(tag);
            const shortLabel = canonicalEvaluationTagFromName(fullLabel) || normalizeEvaluationLabelPrefix(fullLabel);
            addTag(shortLabel, fullLabel || shortLabel);
        });
    }

    return orderedTags.slice(0, maxTags);
}

function getAssessmentPreviewTags(course, maxTags = 6) {
    return getAssessmentPreviewTagItems(course, maxTags).map((item) => item.label);
}

function getCourseEvaluationChipMarkup(course) {
    const tagItems = getAssessmentPreviewTagItems(course, 6);
    if (!tagItems.length) return '';

    const visibleLimit = 2;
    const visibleTagItems = tagItems.slice(0, visibleLimit);
    const overflowCount = Math.max(0, tagItems.length - visibleTagItems.length);
    const breakdown = getCourseEvaluationBreakdownText(course);
    const tooltipAttrs = breakdown
        ? ` data-tooltip-title="Assessment Breakdown" data-tooltip-detail="${escapeCourseMarkup(breakdown)}"`
        : '';

    const tokenMarkup = visibleTagItems
        .map(({ label }) => {
            const safeLabel = escapeCourseMarkup(label);
            return `<span class="course-assessment-item"><span class="course-assessment-token">${safeLabel}</span></span>`;
        })
        .join('');

    const overflowMarkup = overflowCount > 0
        ? `<span class="course-assessment-item course-assessment-item--overflow"><button
                    type="button"
                    class="course-eval-more-link"
                    data-action="open-evaluation-details"
                    aria-label="Open full assessment breakdown (+${overflowCount})"
                >+${overflowCount}</button></span>`
        : '';

    return `
        <div class="course-assessment-zone"${tooltipAttrs}>
            <p class="course-assessment-inline">
                <span class="course-assessment-icon" aria-hidden="true"></span>
                <span class="course-assessment-values">
                    <span class="course-assessment-primary">${tokenMarkup}${overflowMarkup}</span>
                </span>
            </p>
        </div>
    `;
}

function getCourseTypeLabel(courseType) {
    const typeMap = {
        "Introductory Seminars": "Seminar",
        "Intermediate Seminars": "Seminar",
        "Advanced Seminars and Honors Thesis": "Seminar",
        "Academic and Research Skills": "Foundation",
        "Understanding Japan and Kyoto": "Foundation",
        "Japanese Society and Global Culture Concentration": "Culture",
        "Japanese Business and the Global Economy Concentration": "Business",
        "Japanese Politics and Global Studies Concentration": "Politics",
        "Other Elective Courses": "Elective",
        "Special Lecture Series": "Elective",
        "Graduate courses": "Graduate"
    };

    if (!courseType) return "General";
    return typeMap[courseType] || "Elective";
}

async function showCourse(year, term) {
    // Validate year and term before proceeding
    if (!year || year === '' || year === 'Loading...') {
        console.error('Invalid year value:', year);
        return;
    }

    if (!term || term === '') {
        console.error('Invalid term value:', term);
        return;
    }

    // Get courseList element dynamically to ensure it exists
    const courseList = document.getElementById("course-list");

    // Check if courseList element exists
    if (!courseList) {
        console.error('Course list element not found');
        return;
    }

    // If we have cached courses for the same year/term, render them immediately
    // This handles the case where DOM was replaced but we already have the data
    if (lastLoadedCourses && lastLoadedYear === year && lastLoadedTerm === term && !isLoadingCourses) {
        console.log('Using cached course data for rendering');
        renderCourses(lastLoadedCourses, courseList, year, term, lastLoadedProfessorChanges, lastLoadedCoursePlanningContext);
        return;
    }

    // If already loading the same year/term, wait for it then render
    if (isLoadingCourses && lastLoadedYear === year && lastLoadedTerm === term) {
        console.log('Waiting for in-progress course load to complete');
        // Wait a bit for the loading to complete, then check again
        await new Promise(resolve => setTimeout(resolve, 100));
        if (lastLoadedCourses && lastLoadedYear === year && lastLoadedTerm === term) {
            renderCourses(lastLoadedCourses, courseList, year, term, lastLoadedProfessorChanges, lastLoadedCoursePlanningContext);
        }
        return;
    }

    try {
        const courses = await fetchCourseDataWithRetry(year, term);
        if (!courses || courses.length === 0) {
            console.warn('No courses returned');
            courseList.innerHTML = `
                <div class="course-empty-state no-results">
                    <h3 class="course-empty-title">No courses in ${escapeCourseMarkup(term)} ${escapeCourseMarkup(year)}</h3>
                    <p class="course-empty-message">Try selecting a different semester.</p>
                    <div class="course-empty-actions">
                        <button type="button" class="course-empty-clear-btn control-surface control-surface--secondary" data-action="change-course-term">Change term</button>
                    </div>
                </div>
            `;
            updateCourseFilterParagraph();
            return;
        }

        courses.sort((a, b) => normalizeCourseTitle(a.title).localeCompare(normalizeCourseTitle(b.title)));

        // Pre-romanize all professor names
        preromanizeCourseData(courses);

        // Fetch professor change data for all courses
        const courseCodes = courses.map(c => c.course_code).filter(Boolean);
        const professorChanges = await fetchProfessorChanges(courseCodes, {
            currentCourses: courses,
            currentYear: year,
            currentTerm: term
        });
        const coursePlanningContext = await buildCourseStatusLookup(courses, year, term);

        // Cache the loaded courses and professor changes
        lastLoadedCourses = courses;
        lastLoadedYear = year;
        lastLoadedTerm = term;
        lastLoadedProfessorChanges = professorChanges;
        lastLoadedCoursePlanningContext = coursePlanningContext;

        // Re-get courseList in case DOM changed during fetch
        const currentCourseList = document.getElementById("course-list");
        if (currentCourseList) {
            renderCourses(courses, currentCourseList, year, term, professorChanges, coursePlanningContext);
        }
    } catch (error) {
        console.error('Failed to load courses after all retries:', error);
        showCourseLoadError();
    }
}

// Separate function to render courses to the DOM
function renderCourses(courses, courseList, year, term, professorChanges = new Set(), coursePlanningContext = {}) {
    const days = {
        "月曜日": "Mon", "月": "Mon",
        "火曜日": "Tue", "火": "Tue",
        "水曜日": "Wed", "水": "Wed",
        "木曜日": "Thu", "木": "Thu",
        "金曜日": "Fri", "金": "Fri"
    };
    const times = {
        "1講時": "09:00 - 10:30", "1": "09:00 - 10:30",
        "2講時": "10:45 - 12:15", "2": "10:45 - 12:15",
        "3講時": "13:10 - 14:40", "3": "13:10 - 14:40",
        "4講時": "14:55 - 16:25", "4": "14:55 - 16:25",
        "5講時": "16:40 - 18:10", "5": "16:40 - 18:10"
    };
    const courseStatusLookup = coursePlanningContext?.statusLookup instanceof Map
        ? coursePlanningContext.statusLookup
        : new Map();
    const courseScheduleSignalLookup = coursePlanningContext?.scheduleSignalLookup instanceof Map
        ? coursePlanningContext.scheduleSignalLookup
        : new Map();

    let courseHTML = "";
    courses.forEach(function (course) {
        const rawTimeSlot = course.time_slot || "";
        // Match both full and short Japanese formats: (月曜日1講時) or (木4講時)
        const match = rawTimeSlot.match(/\(?([月火水木金土日](?:曜日)?)([1-5](?:講時)?)\)?/);
        const specialMatch = rawTimeSlot.match(/(月曜日3講時・木曜日3講時)/);

        let displayTimeSlot = rawTimeSlot;
        if (/(集中講義|集中)/.test(rawTimeSlot)) {
            displayTimeSlot = "Intensive";
        } else if (specialMatch) {
            displayTimeSlot = "Mon 13:10 - 14:40<br>Thu 13:10 - 14:40";
        } else if (match) {
            displayTimeSlot = `${days[match[1]]} ${times[match[2]]}`;
        }

        // Get color based on course type
        const courseColor = getCourseColorByType(course.type);
        const courseBorderColor = getCourseCardBorderColor(courseColor);
        const courseHoverBorderColor = getCourseCardHoverBorderColor(courseColor);

        // Check if professor has changed across semesters
        const hasProfessorChanged = professorChanges.has(course.course_code);
        const professorDisplay = formatProfessorCardName(course.professor);
        const creditsChip = getCreditsChipMarkup(course);
        const shouldHideGpaForProfessor = hasProfessorChanged || !isCourseGpaAlignedWithCurrentProfessor(course);
        const gpaSummaryChip = getGpaChipMarkup(course, shouldHideGpaForProfessor);
        const newProfessorChip = getNewProfessorChipMarkup(hasProfessorChanged);
        const evaluationChipRow = getCourseEvaluationChipMarkup(course);
        const courseTypeLabel = getCourseTypeLabel(course.type);
        const requiredYearMeta = resolveCourseRequiredYearMeta(course, coursePlanningContext);
        const requiredYearChip = getRequiredYearChipMarkup(requiredYearMeta);
        const mobileRequiredYearChip = getRequiredYearChipMarkup(requiredYearMeta, { mobile: true });
        const japaneseLanguageChip = getGraduateLanguageChipMarkup(course);
        const mobileJapaneseLanguageChip = getGraduateLanguageChipMarkup(course, { mobile: true });
        const statusKey = buildCourseStatusKey(course, year, term);
        const courseStatusLabel = courseStatusLookup.get(statusKey) || '';
        const scheduleSignal = courseScheduleSignalLookup.get(statusKey) || { type: 'none', label: '' };
        const assessmentPreviewTags = getAssessmentPreviewTagItems(course, 6);
        const assessmentSummary = {
            primary: assessmentPreviewTags.slice(0, 2).map((item) => item.label),
            overflowCount: Math.max(0, assessmentPreviewTags.length - 2),
            workloadLabel: null
        };
        const stateFlags = {
            isRegistered: courseStatusLabel === 'Registered',
            isSaved: courseStatusLabel === 'Saved',
            isHidden: false
        };
        const assessmentFlags = deriveDeterministicAssessmentFlags(course);
        const helperBadge = getCourseHelperBadgeMarkup(scheduleSignal, stateFlags);
        const mobilePrimarySignalChip = getMobilePrimarySignalChipMarkup(courseStatusLabel, scheduleSignal, courseColor);
        const courseStatusChip = getCourseStatusChipMarkup(courseStatusLabel, courseColor);
        const normalizedTitle = normalizeCourseTitle(course.title);
        const timeDisplay = String(displayTimeSlot || '').replace(/ - /g, ' – ');
        const cardAriaLabel = `Open course info for ${normalizedTitle}`.replace(/"/g, '&quot;');
        const hasMobileFooterContent = Boolean(mobileRequiredYearChip || mobileJapaneseLanguageChip || mobilePrimarySignalChip);
        const decoratedCourse = {
            ...course,
            scheduleSignal,
            stateFlags,
            assessmentSummary,
            assessmentFlags,
            requiredYearMin: requiredYearMeta.requiredYearMin,
            requiredYearLabel: requiredYearMeta.requiredYearLabel,
            requiredYearBadgeLabel: requiredYearMeta.requiredYearBadgeLabel,
            requiredYearBucketId: requiredYearMeta.requiredYearBucketId,
            hasRequiredYear: requiredYearMeta.hasRequiredYear,
            hasKnownUserYear: requiredYearMeta.hasKnownUserYear,
            meetsYearRequirement: requiredYearMeta.meetsRequirement,
            isHidden: false
        };

        // Escape the JSON string for safe HTML attribute embedding
        const escapedCourseJSON = JSON.stringify(decoratedCourse).replace(/'/g, '&#39;');

        courseHTML += `
        <div class="class-outside" id="${displayTimeSlot}" data-color='${courseColor}' style="--course-card-border: ${courseBorderColor}; --course-card-border-hover: ${courseHoverBorderColor};" role="button" tabindex="0" aria-label="${cardAriaLabel}">
            <div class="class-container" style="--course-card-accent: ${courseColor}; --course-card-border: ${courseBorderColor}; --course-card-border-hover: ${courseHoverBorderColor};" data-course='${escapedCourseJSON}'>
                <div class="course-card-header"></div>
                <div class="course-top-row">
                    <div class="course-title-block">
                        <h2 id="course-title">${normalizedTitle}</h2>
                    </div>
                    <div class="course-top-badges">
                        <span class="course-top-badge course-type-label">${escapeCourseMarkup(courseTypeLabel)}</span>
                    </div>
                </div>
                <div class="course-info-rows">
                    <h3 id="course-professor">
                        <div class="course-professor-icon"></div>
                        <span class="course-professor-line">
                            <span class="course-professor-name">${escapeCourseMarkup(professorDisplay)}</span>
                            ${newProfessorChip}
                        </span>
                    </h3>
                    <h3 id="course-time"><div class="course-time-icon"></div>${timeDisplay}</h3>
                    ${evaluationChipRow}
                </div>
                <div class="course-footer-row course-footer-row--desktop">
                    <div class="course-footer-left">${creditsChip}${requiredYearChip}${japaneseLanguageChip}${courseStatusChip}${helperBadge}${gpaSummaryChip}</div>
                </div>
                ${hasMobileFooterContent
                ? `<div class="course-footer-row course-footer-row--mobile">
                        <div class="course-mobile-meta">
                            ${(mobileRequiredYearChip || mobileJapaneseLanguageChip) ? `<div class="course-mobile-facts">${mobileRequiredYearChip}${mobileJapaneseLanguageChip}</div>` : ''}
                            ${mobilePrimarySignalChip ? `<div class="course-mobile-signal-row">${mobilePrimarySignalChip}</div>` : ''}
                        </div>
                    </div>`
                : ''}
            </div>
        </div>
        `;
    });

    courseList.innerHTML = courseHTML;

    // Remove loading class to restore normal margin
    courseList.classList.remove('loading');

    // Reset suggestions flag when courses are reloaded
    suggestionsDisplayed = false;

    // Keep active day/time/type filters applied even if another async render completes later.
    Promise.resolve()
        .then(() => applySearchAndFilters(currentSearchQuery))
        .catch((error) => {
            console.warn('Failed to reapply filters after course render:', error);
        });

    requestCourseCardRankingChipVisibilityUpdate();

    console.log(`Successfully rendered ${courses.length} courses for ${term} ${year}`);
}
// Robust course data fetching with retry mechanism
async function fetchCourseDataWithRetry(year, term, retryCount = 0) {
    try {
        showCourseLoadingState();
        const courses = await fetchCourseData(year, term);
        hideCourseLoadingState();

        if (!courses || courses.length === 0) {
            throw new Error('No courses returned from database');
        }

        courseLoadRetryCount = 0; // Reset retry count on success
        return courses;
    } catch (error) {
        console.error(`Course loading attempt ${retryCount + 1} failed:`, error);

        if (retryCount < MAX_COURSE_LOAD_RETRIES) {
            const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
            console.log(`Retrying course loading in ${delay}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchCourseDataWithRetry(year, term, retryCount + 1);
        } else {
            hideCourseLoadingState();
            throw error;
        }
    }
}

// Loading state management
function createSkeletonCourse() {
    return `
        <div class="skeleton-class-outside">
            <div class="skeleton-class-container">
                <div class="skeleton-layout-probe" aria-hidden="true">
                    <h2 class="skeleton-probe-title">Academic Presentations and Debate in Global Contexts</h2>
                    <div class="skeleton-probe-meta-row">
                        <p class="skeleton-probe-section">Foundation</p>
                        <span class="skeleton-probe-type">Foundation</span>
                        <span class="skeleton-probe-type">2 Credits</span>
                    </div>
                    <h3 class="skeleton-probe-professor">Shirah Malka Cohen</h3>
                    <h3 class="skeleton-probe-time">Wed 09:00 – 10:30</h3>
                    <div class="skeleton-probe-chip-row">
                        <span class="skeleton-probe-chip">Assessment</span>
                        <span class="skeleton-probe-chip">Midterm</span>
                        <span class="skeleton-probe-chip">Presentation</span>
                    </div>
                </div>
                <div class="skeleton-title-stack">
                    <div class="skeleton-title-line"></div>
                    <div class="skeleton-title-line short"></div>
                </div>
                <div class="skeleton-meta-row">
                    <div class="skeleton-section-line"></div>
                    <div class="skeleton-type-chip"></div>
                </div>
                <div class="skeleton-info-row">
                    <span class="skeleton-icon-block"></span>
                    <span class="skeleton-info-line"></span>
                </div>
                <div class="skeleton-info-row">
                    <span class="skeleton-icon-block"></span>
                    <span class="skeleton-info-line medium"></span>
                </div>
                <div class="skeleton-chip-row">
                    <div class="skeleton-chip"></div>
                </div>
            </div>
        </div>
    `;
}

function showCourseLoadingState() {
    if (isLoadingCourses) return; // Prevent multiple loading indicators

    isLoadingCourses = true;

    // Get courseList element dynamically
    const courseList = document.getElementById("course-list");
    if (!courseList) return;

    // Add loading class for increased margin during loading
    courseList.classList.add('loading');

    // Create multiple skeleton courses as direct children for grid layout
    let skeletonHTML = '';
    for (let i = 0; i < 6; i++) {
        skeletonHTML += createSkeletonCourse();
    }

    courseList.innerHTML = skeletonHTML;
}

function hideCourseLoadingState() {
    isLoadingCourses = false;
}

function showCourseLoadError() {
    const courseList = document.getElementById("course-list");
    if (!courseList) return;

    courseList.innerHTML = `
        <div class="course-error-state">
            <div>
                <p style="margin-bottom: 15px;">⚠️ Failed to load courses</p>
                <button class="course-retry-button" onclick="retryLoadCourses()">Retry</button>
            </div>
        </div>
    `;
}

// Global retry function
window.retryLoadCourses = function () {
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");
    if (yearSelect && termSelect) {
        const year = yearSelect.value;
        const term = termSelect.value;
        showCourse(year, term);
    }
};

function doesCourseMatchConcentrationFilter(courseType, selectedConcentrations) {
    if (!Array.isArray(selectedConcentrations) || selectedConcentrations.length === 0) {
        return true;
    }

    const normalizedType = String(courseType || '');
    return selectedConcentrations.some((filterValue) => {
        switch (filterValue) {
            case 'culture':
                return normalizedType === 'Japanese Society and Global Culture Concentration';
            case 'economy':
                return normalizedType === 'Japanese Business and the Global Economy Concentration';
            case 'politics':
                return normalizedType === 'Japanese Politics and Global Studies Concentration';
            case 'seminar':
                return normalizedType === 'Introductory Seminars'
                    || normalizedType === 'Intermediate Seminars'
                    || normalizedType === 'Advanced Seminars and Honors Thesis';
            case 'academic':
                return normalizedType === 'Academic and Research Skills';
            case 'understanding':
                return normalizedType === 'Understanding Japan and Kyoto';
            case 'special':
                return normalizedType === 'Other Elective Courses' || normalizedType === 'Special Lecture Series';
            case 'graduate':
                return normalizedType === 'Graduate courses';
            default:
                return false;
        }
    });
}

function doesCourseMatchAssessmentFilters(courseData, selectedAssessmentFilters) {
    if (!Array.isArray(selectedAssessmentFilters) || selectedAssessmentFilters.length === 0) {
        return true;
    }

    const assessmentFlags = courseData?.assessmentFlags || deriveDeterministicAssessmentFlags(courseData);
    return selectedAssessmentFilters.every((filterId) => doesAssessmentFilterMatch(assessmentFlags, filterId));
}

function doesCourseMatchRequiredYearFilters(courseData, selectedRequiredYearMins, selectedFilterState = null) {
    if (!Array.isArray(selectedRequiredYearMins) || selectedRequiredYearMins.length === 0) {
        return true;
    }

    const fallbackUserYear = Number.isFinite(Number(selectedFilterState?.userYearLevel))
        ? Math.trunc(Number(selectedFilterState.userYearLevel))
        : null;
    const requiredYearMeta = getCourseRequiredYearMeta(courseData, fallbackUserYear);
    if (!requiredYearMeta.hasRequiredYear || !Number.isFinite(requiredYearMeta.requiredYearMin)) {
        return false;
    }

    return selectedRequiredYearMins.includes(requiredYearMeta.requiredYearMin);
}

// Helper function to check if a container matches current filters
function containerMatchesFilters(container, courseData = null, selectedFilterState = null) {
    if (!courseData) return true;

    const state = selectedFilterState || getSelectedCourseFilterState();
    const selectedDays = Array.isArray(state.selectedDays) ? state.selectedDays : [];
    const selectedTimes = Array.isArray(state.selectedTimes) ? state.selectedTimes : [];
    const selectedConcentrations = Array.isArray(state.selectedConcentrations) ? state.selectedConcentrations : [];
    const selectedAssessmentFilters = Array.isArray(state.selectedAssessmentFilters) ? state.selectedAssessmentFilters : [];
    const selectedRequiredYearMins = Array.isArray(state.selectedRequiredYearMins) ? state.selectedRequiredYearMins : [];

    const slotMeetings = getCourseMeetingTimes(courseData);
    const meetingDays = slotMeetings.map((slot) => slot.day);
    const meetingTimes = slotMeetings.map((slot) => HOME_PREFILTER_PERIOD_TO_TIME[slot.period]).filter(Boolean);
    const isIntensiveCourse = isIntensiveCourseTimeSlot(courseData?.time_slot);

    if (isIntensiveCourse) {
        meetingDays.push('Intensive');
        meetingTimes.push('Intensive');
    }

    const fallbackId = String(container?.id || '').trim();
    if (!meetingDays.length && fallbackId) {
        const fallbackDay = fallbackId.split(' ')[0];
        if (fallbackDay) meetingDays.push(fallbackDay);
    }
    if (!meetingTimes.length && fallbackId) {
        const fallbackTime = fallbackId.split(' ')[1];
        if (fallbackTime) meetingTimes.push(fallbackTime);
    }

    const dayMatch = selectedDays.length === 0 || meetingDays.some((day) => selectedDays.includes(day));
    const timeMatch = selectedTimes.length === 0 || meetingTimes.some((time) => selectedTimes.includes(time));
    const concentrationMatch = doesCourseMatchConcentrationFilter(courseData.type, selectedConcentrations);
    const assessmentMatch = doesCourseMatchAssessmentFilters(courseData, selectedAssessmentFilters);
    const requiredYearMatch = doesCourseMatchRequiredYearFilters(courseData, selectedRequiredYearMins, state);
    const presetMatch = doesCourseMatchSmartPreset(courseData, state);

    return dayMatch && timeMatch && concentrationMatch && assessmentMatch && requiredYearMatch && presetMatch;
}

function buildNoResultsStateModel(activeSearchQuery, selectedFilterState) {
    const presetId = selectedFilterState?.activePresetId || null;
    const hasSearch = Boolean(activeSearchQuery && activeSearchQuery.trim());
    const hasFilterSelections = Boolean(
        (selectedFilterState?.selectedDays?.length || 0) > 0
        || (selectedFilterState?.selectedTimes?.length || 0) > 0
        || (selectedFilterState?.selectedConcentrations?.length || 0) > 0
        || (selectedFilterState?.selectedAssessmentFilters?.length || 0) > 0
        || (selectedFilterState?.selectedRequiredYearMins?.length || 0) > 0
        || presetId
    );

    const model = {
        title: hasSearch
            ? `No courses match "${activeSearchQuery.trim()}".`
            : 'No courses match the selected filters.',
        message: hasSearch
            ? 'Try a different keyword or remove filters.'
            : 'Try adjusting filters to widen the results.',
        actions: [{ action: 'clear-course-filters', label: 'Clear filters' }]
    };

    if (presetId === 'preset-saved-only') {
        model.title = 'No saved courses in this term.';
        model.message = 'Save courses from course details, then return to this preset.';
        model.actions = [{ action: 'show-all-courses', label: 'Show all courses' }];
        return model;
    }

    if (presetId === 'preset-registered-only') {
        model.title = 'No registered courses in this term.';
        model.message = 'Register courses from course details or switch semesters.';
        model.actions = [{ action: 'show-all-courses', label: 'Show all courses' }];
        return model;
    }

    if (presetId === 'preset-empty-slots') {
        model.title = 'No courses fit your empty slots.';
        model.message = 'Try changing slot filters or review your calendar availability.';
        model.actions = [
            { action: 'show-all-courses', label: 'Show all courses' },
            { action: 'open-calendar-empty-slots', label: 'Open timetable' }
        ];
        return model;
    }

    if (presetId === 'preset-fits-my-year') {
        model.title = 'No courses fit your current year.';
        model.message = 'Try clearing this preset or switching semesters.';
        model.actions = [{ action: 'show-all-courses', label: 'Show all courses' }];
        return model;
    }

    if (hasSearch && !hasFilterSelections) {
        model.actions = [{ action: 'show-all-courses', label: 'Show all courses' }];
        return model;
    }

    return model;
}

function applyFilters() {
    // Use the unified search and filter function
    return applySearchAndFilters(currentSearchQuery);
}

// Unified function that applies both search and filter criteria
async function applySearchAndFilters(searchQuery) {
    updateCourseFilterTriggerCount();
    updateActiveCourseFilterDisplay();
    hideCourseChipTooltip();
    hideCourseEvalPopover();

    // Don't apply filters while courses are still loading
    if (isLoadingCourses) {
        console.log('Skipping filter application - courses still loading');
        return;
    }

    // Get courseList element dynamically
    const courseList = document.getElementById("course-list");
    if (!courseList) return;

    const activeSearchQuery = typeof searchQuery === 'string' ? searchQuery : currentSearchQuery;

    const classContainers = courseList.querySelectorAll(".class-outside");

    // If no course containers exist yet, don't show "no results" message
    // This can happen during initial load or race conditions
    if (classContainers.length === 0) {
        console.log('No course containers found - skipping filter application');
        return;
    }

    const selectedFilterState = getSelectedCourseFilterState();
    let hasResults = false;

    // Remove any existing no-results message
    courseList.querySelector(".no-results")?.remove();
    courseList.querySelector(".course-empty-state")?.remove();

    classContainers.forEach(container => {
        let shouldShow = true;

        // Parse course data from the container
        const courseData = JSON.parse(container.querySelector('.class-container').dataset.course);

        // First check if it matches current filters (pass courseData for type filtering)
        const filterMatches = containerMatchesFilters(container, courseData, selectedFilterState);

        // If there's an active search query, also check search criteria
        if (activeSearchQuery && activeSearchQuery.trim()) {
            const title = normalizeCourseTitle(courseData.title || '').toLowerCase();
            const professorOriginal = (courseData.professor || '').toLowerCase();
            const professorRomanized = romanizeProfessorName(courseData.professor || '').toLowerCase();
            const courseCode = (courseData.course_code || '').toLowerCase();
            const query = activeSearchQuery.toLowerCase().trim();

            const searchMatches = title.includes(query) ||
                professorOriginal.includes(query) ||
                professorRomanized.includes(query) ||
                courseCode.includes(query);

            shouldShow = filterMatches && searchMatches;
        } else {
            shouldShow = filterMatches;
        }

        if (shouldShow) {
            container.style.display = "flex";
            hasResults = true;
        } else {
            container.style.display = "none";
        }
    });

    const courseMainDiv = document.getElementById("course-main-div");
    if (courseMainDiv) {
        courseMainDiv.querySelector('.suggestion-header')?.remove();
    }

    // Handle no results case
    if (!hasResults) {
        const emptyStateModel = buildNoResultsStateModel(activeSearchQuery, selectedFilterState);
        const actionsMarkup = (Array.isArray(emptyStateModel.actions) ? emptyStateModel.actions : [])
            .map((item) => `<button type="button" class="course-empty-clear-btn control-surface control-surface--secondary" data-action="${escapeCourseMarkup(item.action)}">${escapeCourseMarkup(item.label)}</button>`)
            .join('');

        const emptyState = document.createElement("div");
        emptyState.className = "course-empty-state no-results";
        emptyState.innerHTML = `
            <h3 class="course-empty-title">${escapeCourseMarkup(emptyStateModel.title)}</h3>
            <p class="course-empty-message">${escapeCourseMarkup(emptyStateModel.message)}</p>
            <div class="course-empty-actions">${actionsMarkup}</div>
        `;
        courseList.appendChild(emptyState);
    }

    suggestionsDisplayed = false;

    // Update the course filter paragraph after applying filters
    updateCourseFilterParagraph();
    requestCourseCardRankingChipVisibilityUpdate();
}

async function updateCoursesAndFilters() {
    try {
        // If already loading, wait a bit then proceed (data will be cached)
        if (isLoadingCourses) {
            console.log('Course loading already in progress, waiting...');
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Get selectors dynamically
        const yearSelect = document.getElementById("year-select");
        const termSelect = document.getElementById("term-select");
        if (!yearSelect || !termSelect) {
            console.error('Year or term selector not found');
            return;
        }

        // Validate year and term values before fetching
        const year = yearSelect.value;
        const term = termSelect.value;

        if (!year || year === '' || year === 'Loading...') {
            console.log('Year not yet populated, skipping course fetch');
            return;
        }

        if (!term || term === '') {
            console.log('Term not yet populated, skipping course fetch');
            return;
        }

        await showCourse(year, term);

        // Re-apply current sort if one is selected
        if (currentSortMethod) {
            sortCourses(currentSortMethod);
        } else {
            // Apply both current search and filters
            await applySearchAndFilters(currentSearchQuery);
        }

        refreshCalendarComponent(); // Refresh calendar when year/term changes
    } catch (error) {
        console.error('Error updating courses and filters:', error);
        // Don't show error state here as showCourse already handles it
    }
}

async function refreshCourseStatusChips() {
    const courseList = document.getElementById("course-list");
    if (!courseList || !Array.isArray(lastLoadedCourses) || lastLoadedCourses.length === 0) {
        return;
    }

    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");
    const targetYear = yearSelect?.value || lastLoadedYear;
    const targetTerm = termSelect?.value || lastLoadedTerm;

    if (!targetYear || !targetTerm || isLoadingCourses) {
        return;
    }

    try {
        const planningContext = await buildCourseStatusLookup(lastLoadedCourses, targetYear, targetTerm);
        lastLoadedCoursePlanningContext = planningContext;
        renderCourses(
            lastLoadedCourses,
            courseList,
            targetYear,
            targetTerm,
            lastLoadedProfessorChanges,
            planningContext
        );
    } catch (error) {
        console.warn('Unable to refresh course status chips after status update:', error);
    }
}

function scheduleCourseStatusChipRefresh() {
    if (courseStatusRefreshTimer) {
        window.clearTimeout(courseStatusRefreshTimer);
    }
    courseStatusRefreshTimer = window.setTimeout(() => {
        courseStatusRefreshTimer = null;
        refreshCourseStatusChips();
    }, 80);
}

function setupCourseStatusSyncListeners() {
    if (courseStatusSyncListenersBound) return;
    courseStatusSyncListenersBound = true;

    window.addEventListener('saved-courses:changed', scheduleCourseStatusChipRefresh);
    document.addEventListener('course-status-updated', scheduleCourseStatusChipRefresh);
}

function getCourseDataFromCard(cardElement) {
    const container = cardElement?.querySelector('.class-container');
    if (!container?.dataset?.course) return null;

    try {
        return JSON.parse(container.dataset.course);
    } catch (error) {
        console.warn('Failed to parse course card data', error);
        return null;
    }
}

function canShowCourseChipTooltip() {
    return window.innerWidth >= 1024
        && window.matchMedia
        && window.matchMedia('(hover: hover)').matches;
}

function ensureCourseChipTooltip() {
    if (courseChipTooltipElement && document.body.contains(courseChipTooltipElement)) {
        return courseChipTooltipElement;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'calendar-course-tooltip course-chip-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    courseChipTooltipElement = tooltip;
    return tooltip;
}

function positionCourseChipTooltip(clientX, clientY) {
    const tooltip = courseChipTooltipElement;
    if (!tooltip) return;

    const offset = 14;
    const maxX = window.innerWidth - tooltip.offsetWidth - 8;
    const maxY = window.innerHeight - tooltip.offsetHeight - 8;
    const left = Math.max(8, Math.min(clientX + offset, maxX));
    const top = Math.max(8, Math.min(clientY + offset, maxY));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function showCourseChipTooltip(chip, event) {
    if (!canShowCourseChipTooltip()) return;

    const title = String(chip?.dataset?.tooltipTitle || '').trim();
    if (!title) return;

    const tooltip = ensureCourseChipTooltip();
    if (!tooltip) return;

    const detail = String(chip?.dataset?.tooltipDetail || '').trim();
    tooltip.innerHTML = `
        <div class="calendar-course-tooltip-title">${title}</div>
        ${detail ? `<div class="calendar-course-tooltip-detail">${detail}</div>` : ''}
    `;

    tooltip.classList.add('is-visible');
    positionCourseChipTooltip(event.clientX, event.clientY);
    activeChipTooltipTarget = chip;
}

function hideCourseChipTooltip() {
    activeChipTooltipTarget = null;
    if (!courseChipTooltipElement) return;
    courseChipTooltipElement.classList.remove('is-visible');
}

function ensureCourseEvalPopover() {
    if (courseEvalPopoverElement && document.body.contains(courseEvalPopoverElement)) {
        return courseEvalPopoverElement;
    }

    const popover = document.createElement('div');
    popover.className = 'course-eval-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-live', 'polite');
    popover.hidden = true;
    document.body.appendChild(popover);
    courseEvalPopoverElement = popover;
    return popover;
}

function hideCourseEvalPopover() {
    activeCourseEvalPopoverTrigger = null;
    if (!courseEvalPopoverElement) return;
    courseEvalPopoverElement.hidden = true;
    courseEvalPopoverElement.classList.remove('is-visible');
}

function positionCourseEvalPopover(trigger) {
    if (!courseEvalPopoverElement || !trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const maxWidth = courseEvalPopoverElement.offsetWidth;
    const viewportPadding = 10;
    const preferredTop = triggerRect.bottom + 10;
    const preferredLeft = triggerRect.left + (triggerRect.width / 2) - (maxWidth / 2);
    const maxLeft = window.innerWidth - maxWidth - viewportPadding;
    const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));
    const top = Math.max(viewportPadding, preferredTop);

    courseEvalPopoverElement.style.left = `${left}px`;
    courseEvalPopoverElement.style.top = `${top}px`;
}

function toggleCourseEvalPopover(trigger) {
    const breakdown = String(trigger?.dataset?.breakdown || '').trim();
    if (!breakdown) return;

    const popover = ensureCourseEvalPopover();
    if (!popover) return;

    if (activeCourseEvalPopoverTrigger === trigger && !popover.hidden) {
        hideCourseEvalPopover();
        return;
    }

    popover.innerHTML = `
        <p class="course-eval-popover-title">Evaluation Criteria</p>
        <p class="course-eval-popover-detail">${escapeCourseMarkup(breakdown)}</p>
    `;

    popover.hidden = false;
    popover.classList.add('is-visible');
    activeCourseEvalPopoverTrigger = trigger;
    positionCourseEvalPopover(trigger);
}

// Set up course list event listeners dynamically
function setupCourseListClickListener() {
    const courseList = document.getElementById("course-list");
    if (!courseList || courseList.dataset.interactionsAttached === 'true') return;

    courseList.dataset.interactionsAttached = 'true';

    courseList.addEventListener("click", function (event) {
        const clearFiltersButton = event.target.closest('[data-action="clear-course-filters"]');
        if (clearFiltersButton) {
            event.preventDefault();
            clearCourseFiltersAndSearchAndRefresh();
            return;
        }

        const showAllCoursesButton = event.target.closest('[data-action="show-all-courses"]');
        if (showAllCoursesButton) {
            event.preventDefault();
            clearCourseFiltersAndSearchAndRefresh();
            return;
        }

        const openCalendarButton = event.target.closest('[data-action="open-calendar-empty-slots"]');
        if (openCalendarButton) {
            event.preventDefault();
            if (window.router?.navigate) {
                window.router.navigate('/timetable');
            } else {
                window.location.href = withBase('/timetable');
            }
            return;
        }

        const changeTermButton = event.target.closest('[data-action="change-course-term"]');
        if (changeTermButton) {
            event.preventDefault();
            const semesterTrigger = document.querySelector('#filter-year-term .custom-select-trigger');
            if (semesterTrigger) {
                semesterTrigger.focus();
                semesterTrigger.click();
            }
            return;
        }

        const openEvaluationDetailsTrigger = event.target.closest('[data-action="open-evaluation-details"]');
        if (openEvaluationDetailsTrigger) {
            event.preventDefault();
            event.stopPropagation();
            const evaluationCard = openEvaluationDetailsTrigger.closest('.class-outside');
            const courseData = evaluationCard ? getCourseDataFromCard(evaluationCard) : null;
            if (courseData) {
                openCourseInfoMenu(courseData, true, { initialTab: 'overview', focusAssessment: true });
            }
            return;
        }

        const evalPopoverTrigger = event.target.closest('[data-action="toggle-eval-popover"]');
        if (evalPopoverTrigger) {
            event.preventDefault();
            event.stopPropagation();
            toggleCourseEvalPopover(evalPopoverTrigger);
            return;
        }

        if (courseEvalPopoverElement && !courseEvalPopoverElement.hidden) {
            const clickedInsidePopover = event.target.closest('.course-eval-popover');
            if (!clickedInsidePopover) {
                hideCourseEvalPopover();
            }
        }

        const clickedCard = event.target.closest(".class-outside");
        if (!clickedCard || !courseList.contains(clickedCard)) return;

        const courseData = getCourseDataFromCard(clickedCard);
        if (courseData) {
            openCourseInfoMenu(courseData);
        }
    });

    courseList.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest('button, a, input, textarea, select')) return;

        const card = event.target.closest(".class-outside");
        if (!card || !courseList.contains(card)) return;

        event.preventDefault();
        const courseData = getCourseDataFromCard(card);
        if (courseData) {
            openCourseInfoMenu(courseData);
        }
    });

    courseList.addEventListener('pointerover', (event) => {
        const tooltipTarget = event.target.closest('[data-tooltip-title]');
        if (!tooltipTarget || !courseList.contains(tooltipTarget)) return;
        showCourseChipTooltip(tooltipTarget, event);
    });

    courseList.addEventListener('pointermove', (event) => {
        if (!activeChipTooltipTarget) return;
        if (event.target.closest('[data-tooltip-title]') !== activeChipTooltipTarget) return;
        positionCourseChipTooltip(event.clientX, event.clientY);
    });

    courseList.addEventListener('pointerout', (event) => {
        if (!activeChipTooltipTarget) return;
        const leavingChip = event.target.closest('[data-tooltip-title]');
        if (!leavingChip || leavingChip !== activeChipTooltipTarget) return;
        if (event.relatedTarget && leavingChip.contains(event.relatedTarget)) return;
        hideCourseChipTooltip();
    });

    window.addEventListener('resize', () => {
        hideCourseChipTooltip();
        hideCourseEvalPopover();
        requestCourseCardRankingChipVisibilityUpdate();
    });
    window.addEventListener('scroll', () => {
        if (courseEvalPopoverElement && !courseEvalPopoverElement.hidden && activeCourseEvalPopoverTrigger) {
            positionCourseEvalPopover(activeCourseEvalPopoverTrigger);
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideCourseEvalPopover();
        }
    });
}

// Initialize the application
// Initialize courses with robust loading
(async function initializeCourses() {
    try {
        const normalizePath = (path) => {
            const raw = String(path || '/');
            const noQuery = raw.split('?')[0].split('#')[0];
            const trimmed = noQuery.length > 1 ? noQuery.replace(/\/+$/, '') : noQuery;
            return trimmed || '/';
        };

        const isCoursesRoute = (path) => {
            const normalized = normalizePath(path);
            return normalized === '/courses' || normalized === '/dashboard';
        };

        // Skip entirely unless we are actually on the courses route.
        // This avoids race conditions when /course/... is loaded via a courses entrypoint.
        if (!isCoursesRoute(getCurrentAppPath())) {
            return;
        }

        // Only run on courses/index page - check for key element
        const courseMainDiv = document.getElementById("course-main-div");
        if (!courseMainDiv) {
            // Not on courses page, skip initialization silently
            return;
        }

        console.log('Initializing course loading...');

        // Ensure DOM is ready
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });
        }

        // Additional delay to ensure all components and custom elements are mounted
        await new Promise(resolve => setTimeout(resolve, 200));

        // If route changed while waiting (e.g. navigating to /course/...),
        // stop initialization without logging errors.
        if (!isCoursesRoute(getCurrentAppPath()) || !document.getElementById("course-main-div")) {
            return;
        }

        // Find elements dynamically  
        let semesterSelect = document.getElementById("semester-select");
        let yearSelect = document.getElementById("year-select");
        let termSelect = document.getElementById("term-select");
        let courseList = document.getElementById("course-list");

        // Check if required elements exist
        if (!semesterSelect || !courseList) {
            console.error('Required DOM elements not found on first try:', {
                semesterSelect: !!semesterSelect,
                courseList: !!courseList
            });

            // Try to find them again with a longer delay
            await new Promise(resolve => setTimeout(resolve, 500));
            semesterSelect = document.getElementById("semester-select");
            yearSelect = document.getElementById("year-select");
            termSelect = document.getElementById("term-select");
            courseList = document.getElementById("course-list");

            console.log('Second element search:', {
                semesterSelect: !!semesterSelect,
                courseList: !!courseList
            });

            if (!semesterSelect || !courseList) {
                // Route may have changed while retrying; exit quietly in that case.
                if (!isCoursesRoute(getCurrentAppPath()) || !document.getElementById("course-main-div")) {
                    return;
                }
                throw new Error('Critical DOM elements missing after retry');
            }
        }

        // Populate semester dropdown from database before loading courses
        await populateSemesterDropdown();

        // Re-query values after population
        const default_year = document.getElementById("year-select").value || "2025";
        const default_term = document.getElementById("term-select").value || "Fall";

        console.log('Loading courses for:', { year: default_year, term: default_term });

        await showCourse(default_year, default_term);
        console.log('Initial course loading completed successfully');

        // Update the course filter paragraph to show initial state
        updateCourseFilterParagraph();

        // Initialize URL-based course routing after courses are loaded
        initializeCourseRouting();
    } catch (error) {
        console.error('Failed to initialize courses:', error);
        // Show error state but don't prevent rest of app from loading
        showCourseLoadError();
    }
})();

// Set default sort to Course A-Z
currentSortMethod = 'title-az';

// Track if dashboard event listeners have been set up
let dashboardEventListenersInitialized = false;

// Function to set up all dashboard event listeners
function setupDashboardEventListeners() {
    console.log('Setting up dashboard event listeners... already initialized:', dashboardEventListenersInitialized);

    // Set up event listeners for all semester selects (mobile and desktop)
    const semesterSelects = document.querySelectorAll(".semester-select");

    semesterSelects.forEach(semesterSelect => {
        // Check if already initialized using data attribute
        if (semesterSelect.dataset.listenerAttached !== 'true') {
            semesterSelect.addEventListener("change", async (e) => {
                console.log('🔔 SEMESTER CHANGE EVENT FIRED');
                console.log('  → Event target:', e.target.id);
                console.log('  → Selected value:', e.target.value);

                // Parse the semester value and update hidden inputs
                const { term, year } = parseSemesterValue(e.target.value);
                console.log('  → Parsed term:', term);
                console.log('  → Parsed year:', year);

                const normalizedSelection = normalizeTermValue(e.target.value);
                if (normalizedSelection) {
                    setPreferredTermValue(normalizedSelection);
                    applyPreferredTermToGlobals(normalizedSelection);
                }

                const termSelect = document.getElementById("term-select");
                const yearSelect = document.getElementById("year-select");

                if (termSelect) {
                    termSelect.value = term;
                    console.log('  → Updated term-select to:', termSelect.value);
                }
                if (yearSelect) {
                    yearSelect.value = year;
                    console.log('  → Updated year-select to:', yearSelect.value);
                }

                console.log('Semester changed to:', term, year);

                // Sync both dropdowns (mobile and desktop)
                syncSemesterDropdowns(e.target.value);
                console.log('  → Dropdowns synced');

                // Check if we're on the calendar page
                const isCalendarPage = getCurrentAppPath() === '/timetable' || document.querySelector('calendar-page') !== null;
                console.log('  → Is calendar page?', isCalendarPage);
                console.log('  → Current pathname:', getCurrentAppPath());
                console.log('  → Calendar component exists?', !!document.querySelector('calendar-page'));

                if (isCalendarPage) {
                    // On calendar page - refresh the calendar with new semester
                    console.log('✅ CALENDAR PAGE DETECTED - Refreshing for:', year, term);

                    // Update search courses for the new semester
                    console.log('  → Calling getAllCourses()...');
                    await getAllCourses();
                    console.log('  → getAllCourses() completed');

                    const calendarComponent = document.querySelector('calendar-page');
                    console.log('  → Calendar component:', calendarComponent);

                    if (calendarComponent && calendarComponent.showCourseWithRetry) {
                        console.log('  → Calling showCourseWithRetry with:', year, term);
                        await calendarComponent.showCourseWithRetry(year, term);
                        console.log('  → showCourseWithRetry completed');
                    } else {
                        console.error('❌ Calendar component or showCourseWithRetry not found');
                        console.error('   Component:', calendarComponent);
                        console.error('   Method exists:', calendarComponent ? !!calendarComponent.showCourseWithRetry : false);
                    }
                } else {
                    // On courses page - update courses
                    console.log('📄 COURSES PAGE - Calling updateCoursesAndFilters()');

                    // Refresh allCourses for autocomplete with new semester
                    console.log('  → Calling getAllCourses()...');
                    await getAllCourses();
                    console.log('  → getAllCourses() completed');

                    updateCoursesAndFilters();
                }

                console.log('🏁 SEMESTER CHANGE HANDLER COMPLETED');
            });
            semesterSelect.dataset.listenerAttached = 'true';
            console.log('Semester select change listener attached');
        }
    });

    // Set up button event listeners for both mobile and desktop containers
    const filterBtns = document.querySelectorAll(".filter-btn");
    const filterContainer = document.querySelector(".filter-container");
    const filterBackground = document.querySelector(".filter-background");
    const searchBtns = document.querySelectorAll(".search-btn");
    const searchContainer = document.querySelector(".search-container");
    const searchBackground = document.querySelector(".search-background");
    const searchModal = document.querySelector(".search-modal");
    const sortBtns = document.querySelectorAll(".sort-btn");
    const sortDropdowns = document.querySelectorAll(".sort-dropdown");

    // Sort button click handlers - for both mobile and desktop
    sortBtns.forEach(sortBtn => {
        if (sortBtn && filterContainer && sortBtn.dataset.listenerAttached !== 'true') {
            sortBtn.dataset.listenerAttached = 'true';
            sortBtn.setAttribute('aria-label', 'Sort');
            sortBtn.setAttribute('title', 'Sort');
            console.log('Attaching sort button listener');
            sortBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();

                // Close other dropdowns/modals
                if (!filterContainer.classList.contains("hidden")) {
                    filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
                    filterContainer.style.opacity = "0";
                    filterContainer.style.transform = "translateY(-10px)";
                    setTimeout(() => {
                        filterContainer.classList.add("hidden");
                    }, 300);
                }

                // Close any open custom selects
                const customSelects = document.querySelectorAll('.custom-select');
                customSelects.forEach(customSelect => {
                    customSelect.classList.remove('open');
                });

                // Toggle sort dropdown
                const sortWrapper = sortBtn.closest('.sort-wrapper');
                sortWrapper.classList.toggle("open");
            });
        }
    });

    // Sort option selection - for both mobile and desktop
    sortDropdowns.forEach(sortDropdown => {
        if (sortDropdown && sortDropdown.dataset.listenerAttached !== 'true') {
            sortDropdown.dataset.listenerAttached = 'true';
            console.log('Attaching sort dropdown listener');
            sortDropdown.addEventListener("click", (event) => {
                const option = event.target.closest('.sort-option');
                if (!option) return;

                const sortMethod = option.dataset.sort;

                // Update selected state in all sort dropdowns
                document.querySelectorAll('.sort-dropdown').forEach(dropdown => {
                    dropdown.querySelectorAll('.sort-option').forEach(opt => {
                        opt.classList.remove('selected');
                        if (opt.dataset.sort === sortMethod) {
                            opt.classList.add('selected');
                        }
                    });
                });

                // Apply sorting
                currentSortMethod = sortMethod;
                sortCourses(sortMethod);
                updateSortStatusDisplay();

                // Close dropdown
                const sortWrapper = sortDropdown.closest('.sort-wrapper');
                sortWrapper.classList.remove("open");
            });
        }
    });

    // Filter button click handlers - for both mobile and desktop
    filterBtns.forEach(filterBtn => {
        if (filterBtn && filterContainer && filterBtn.dataset.listenerAttached !== 'true') {
            filterBtn.dataset.listenerAttached = 'true';
            console.log('Attaching filter button listener');
            filterBtn.addEventListener("click", () => {
                const filterPopup = filterContainer.querySelector('.filter-popup');

                if (filterContainer.classList.contains("hidden")) {
                    filterContainer.classList.remove("hidden");

                    if (window.innerWidth <= 1023) {
                        // Mobile full-screen animation
                        showModalWithMobileAnimation(filterPopup, filterContainer);
                    } else {
                        // Desktop animation
                        filterContainer.style.opacity = "0";
                        filterContainer.style.transform = "translateY(-10px)";

                        // Simple direct overflow lock for filter modal
                        document.body.style.overflow = "hidden";

                        requestAnimationFrame(() => {
                            filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
                            filterContainer.style.opacity = "1";
                            filterContainer.style.transform = "translateY(0)";
                        });
                    }
                }
            });
        }
    });
    updateCourseFilterTriggerCount();
    updateSortStatusDisplay();
    updateActiveCourseFilterDisplay();
    syncCoursePresetButtons();

    const clearActiveFiltersBtn = document.getElementById('course-clear-active-filters');
    if (clearActiveFiltersBtn && clearActiveFiltersBtn.dataset.listenerAttached !== 'true') {
        clearActiveFiltersBtn.dataset.listenerAttached = 'true';
        clearActiveFiltersBtn.addEventListener('click', async () => {
            await clearCourseFiltersOnlyAndRefresh();
        });
    }

    const activeFilterChips = document.getElementById('course-active-filter-chips');
    if (activeFilterChips && activeFilterChips.dataset.listenerAttached !== 'true') {
        activeFilterChips.dataset.listenerAttached = 'true';
        activeFilterChips.addEventListener('click', async (event) => {
            const chip = event.target.closest('.course-active-filter-chip');
            if (!chip) return;

            const filterId = String(chip.dataset.filterId || '').trim();
            const presetId = String(chip.dataset.presetId || '').trim();

            if (filterId) {
                const targetCheckbox = document.getElementById(filterId);
                if (!targetCheckbox) return;
                targetCheckbox.checked = false;
            } else if (presetId && presetId === activeCoursePresetId) {
                setActiveCoursePreset(null, { syncOnly: true });
            } else {
                return;
            }

            await applySearchAndFilters(currentSearchQuery);
        });
    }

    const smartPresetButtons = document.querySelectorAll('[data-course-preset]');
    smartPresetButtons.forEach((presetButton) => {
        if (presetButton.dataset.listenerAttached === 'true') return;
        presetButton.dataset.listenerAttached = 'true';
        presetButton.addEventListener('click', async () => {
            const presetId = String(presetButton.dataset.coursePreset || '').trim();
            if (!getCourseSmartPresetConfig(presetId)) return;
            if (activeCoursePresetId === presetId) {
                setActiveCoursePreset(null, { syncOnly: true });
            } else {
                if (isYearAwareCoursePreset(presetId)) {
                    const canActivate = await canActivateYearAwarePreset();
                    if (!canActivate) return;
                }
                setActiveCoursePreset(presetId, { syncOnly: true });
            }
            await applySearchAndFilters(currentSearchQuery);
        });
    });

    // Close filter modal when clicking outside
    if (filterBackground) {
        filterBackground.addEventListener("click", (event) => {
            if (event.target === filterBackground) {
                if (window.innerWidth <= 1023) {
                    // Mobile handling
                    const filterPopup = filterContainer.querySelector('.filter-popup');
                    hideModalWithMobileAnimation(filterPopup, filterContainer, () => {
                        filterContainer.classList.add("hidden");
                    });
                } else {
                    // Desktop handling
                    filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
                    filterContainer.style.opacity = "0";
                    filterContainer.style.transform = "translateY(-10px)";

                    setTimeout(() => {
                        filterContainer.classList.add("hidden");
                        // Simple direct overflow unlock for filter modal
                        document.body.style.overflow = "";
                        console.log('Filter modal closed by outside click, body overflow restored');
                    }, 300);
                }
            }
        });
    }

    // Set up filter action buttons
    const seeResultsBtn = document.getElementById("see-results-btn");
    const clearAllBtn = document.getElementById("clear-all-btn");

    if (seeResultsBtn && filterContainer) {
        seeResultsBtn.addEventListener("click", () => {
            if (window.innerWidth <= 1023) {
                // Mobile handling
                const filterPopup = filterContainer.querySelector('.filter-popup');
                hideModalWithMobileAnimation(filterPopup, filterContainer, () => {
                    filterContainer.classList.add("hidden");
                });
            } else {
                // Desktop handling
                filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
                filterContainer.style.opacity = "0";
                filterContainer.style.transform = "translateY(-10px)";

                setTimeout(() => {
                    filterContainer.classList.add("hidden");
                    filterContainer.style.transition = "";
                    filterContainer.style.opacity = "";
                    filterContainer.style.transform = "";
                    // Restore body overflow
                    document.body.style.overflow = "";
                    console.log('See results button clicked, body overflow restored');
                }, 300);
            }
        });
    }

    if (clearAllBtn) {
        clearAllBtn.addEventListener("click", async () => {
            // Get filter elements dynamically
            const filterByDays = document.getElementById("filter-by-days");
            const filterByTime = document.getElementById("filter-by-time");
            const filterByConcentration = document.getElementById("filter-by-concentration");
            const filterByAssessment = document.getElementById("filter-by-assessment");
            const filterByRequiredYear = document.getElementById("filter-by-required-year");

            // Clear day filters
            if (filterByDays) {
                const dayCheckboxes = filterByDays.querySelectorAll("input[type='checkbox']");
                dayCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                });
            }

            // Clear time filters  
            if (filterByTime) {
                const timeCheckboxes = filterByTime.querySelectorAll("input[type='checkbox']");
                timeCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                });
            }

            // Clear concentration filters
            if (filterByConcentration) {
                const concentrationCheckboxes = filterByConcentration.querySelectorAll("input[type='checkbox']");
                concentrationCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                });
            }

            // Clear assessment filters
            if (filterByAssessment) {
                const assessmentCheckboxes = filterByAssessment.querySelectorAll("input[type='checkbox']");
                assessmentCheckboxes.forEach((checkbox) => {
                    checkbox.checked = false;
                });
            }

            // Clear required year filters
            if (filterByRequiredYear) {
                const requiredYearCheckboxes = filterByRequiredYear.querySelectorAll("input[type='checkbox']");
                requiredYearCheckboxes.forEach((checkbox) => {
                    checkbox.checked = false;
                });
            }

            setActiveCoursePreset(null, { syncOnly: true });

            // Reset custom dropdowns to default values
            const termSelect = document.getElementById("term-select");
            const yearSelect = document.getElementById("year-select");
            const termCustomSelect = document.querySelector('[data-target="term-select"]');
            const yearCustomSelect = document.querySelector('[data-target="year-select"]');

            if (termCustomSelect) {
                const termValue = termCustomSelect.querySelector('.custom-select-value');
                const termOptions = termCustomSelect.querySelectorAll('.custom-select-option');
                termOptions.forEach(option => option.classList.remove('selected'));

                // Set default to Fall
                const fallOption = termCustomSelect.querySelector('[data-value="Fall"]');
                if (fallOption) {
                    fallOption.classList.add('selected');
                    if (termValue) termValue.textContent = 'Fall';
                    termSelect.value = 'Fall';
                }
            }

            if (yearCustomSelect) {
                const yearValue = yearCustomSelect.querySelector('.custom-select-value');
                const yearOptions = yearCustomSelect.querySelectorAll('.custom-select-option');
                yearOptions.forEach(option => option.classList.remove('selected'));

                // Set default to current year (2025)
                const currentYearOption = yearCustomSelect.querySelector('[data-value="2025"]');
                if (currentYearOption) {
                    currentYearOption.classList.add('selected');
                    if (yearValue) yearValue.textContent = '2025';
                    yearSelect.value = '2025';
                }
            }

            // Reset sorting to default (Course A-Z)
            currentSortMethod = 'title-az';
            const sortOptions = document.querySelectorAll('.sort-option');
            sortOptions.forEach(option => option.classList.remove('selected'));
            const defaultSortOption = document.querySelector('.sort-option[data-sort="title-az"]');
            if (defaultSortOption) {
                defaultSortOption.classList.add('selected');
            }
            updateSortStatusDisplay();

            // Clear search input and search state
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = "";
            }

            // Clear desktop search pill input
            const searchPillInput = document.getElementById('search-pill-input');
            if (searchPillInput) {
                searchPillInput.value = "";
            }

            // Clear global search state
            currentSearchQuery = null;
            updateCourseFilterTriggerCount();

            // Update course filter paragraph to show default text
            updateCourseFilterParagraph();

            // Apply filters (this will show all courses since no filters are active and search is cleared)
            await applySearchAndFilters();
        });
    }

    // Search button and modal setup - for both mobile and desktop
    searchBtns.forEach(searchBtn => {
        if (searchBtn && searchContainer && searchModal && searchBtn.dataset.listenerAttached !== 'true') {
            searchBtn.dataset.listenerAttached = 'true';
            searchBtn.addEventListener("click", async () => {
                if (searchContainer.classList.contains("hidden")) {
                    searchContainer.classList.remove("hidden");

                    if (window.innerWidth <= 1023) {
                        // Mobile full-screen animation
                        showModalWithMobileAnimation(searchModal, searchContainer);
                    } else {
                        // Desktop animation
                        searchContainer.style.opacity = "0";
                        searchModal.style.transform = "translate(-50%, -60%)";
                        lockBodyScroll();

                        requestAnimationFrame(() => {
                            searchContainer.style.transition = "opacity 0.3s ease";
                            searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
                            searchContainer.style.opacity = "1";
                            searchModal.style.transform = "translate(-50%, -50%)";
                        });
                    }

                    // Load courses for autocomplete
                    await getAllCourses();

                    // Focus on search input after animation
                    setTimeout(() => {
                        const searchInput = document.getElementById('search-input');
                        if (searchInput) searchInput.focus();
                    }, 100);
                }
            });
        }
    });

    // Set up additional search event listeners (only once, not per button)
    if (searchContainer && searchModal) {
        const searchSubmit = document.getElementById('search-submit');
        const searchCancel = document.getElementById('search-cancel');
        const searchInput = document.getElementById('search-input');
        const searchAutocomplete = document.getElementById('search-autocomplete');

        if (searchSubmit) {
            searchSubmit.addEventListener("click", async () => {
                const searchQuery = searchInput ? searchInput.value : '';
                await performSearch(searchQuery);

                if (window.innerWidth <= 1023) {
                    // Mobile full-screen animation
                    hideModalWithMobileAnimation(searchModal, searchContainer, () => {
                        searchContainer.classList.add("hidden");
                    });
                } else {
                    // Desktop animation - Close search modal with animation
                    searchContainer.style.transition = "opacity 0.3s ease";
                    searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
                    searchContainer.style.opacity = "0";
                    searchModal.style.transform = "translate(-50%, -60%)";

                    setTimeout(() => {
                        searchContainer.classList.add("hidden");
                        unlockBodyScroll();
                    }, 300);
                }
            });
        }

        if (searchCancel) {
            searchCancel.addEventListener("click", () => {
                if (window.innerWidth <= 1023) {
                    // Mobile full-screen animation
                    hideModalWithMobileAnimation(searchModal, searchContainer, () => {
                        searchContainer.classList.add("hidden");
                    });
                } else {
                    // Desktop animation - Close search modal with animation
                    searchContainer.style.transition = "opacity 0.3s ease";
                    searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
                    searchContainer.style.opacity = "0";
                    searchModal.style.transform = "translate(-50%, -60%)";

                    setTimeout(() => {
                        searchContainer.classList.add("hidden");
                        unlockBodyScroll();
                    }, 300);
                }
            });
        }

        // Close search modal when clicking outside
        if (searchBackground) {
            searchBackground.addEventListener("click", (event) => {
                if (event.target === searchBackground) {
                    if (window.innerWidth <= 1023) {
                        // Mobile handling
                        hideModalWithMobileAnimation(searchModal, searchContainer, () => {
                            searchContainer.classList.add("hidden");
                        });
                    } else {
                        // Desktop handling
                        searchContainer.style.transition = "opacity 0.3s ease";
                        searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
                        searchContainer.style.opacity = "0";
                        searchModal.style.transform = "translate(-50%, -60%)";

                        setTimeout(() => {
                            searchContainer.classList.add("hidden");
                            unlockBodyScroll();
                        }, 300);
                    }
                }
            });
        }

        // Search input and autocomplete
        if (searchInput && searchAutocomplete) {
            setupSearchAutocomplete(searchInput, searchAutocomplete);
        }
    }

    // Desktop Search Pill Setup
    setupDesktopSearchPill();

    // Initialize custom select dropdowns and filter checkboxes
    initializeCustomSelects();
    initializeFilterCheckboxes();

    dashboardEventListenersInitialized = true;
    console.log('Dashboard event listeners initialization complete');
}

// Function to set up search autocomplete event listeners
function setupSearchAutocomplete(searchInput, searchAutocomplete) {
    if (!searchInput || !searchAutocomplete) return;

    // Search input event handlers for autocomplete
    searchInput.addEventListener("input", (event) => {
        showAutocomplete(event.target.value, searchAutocomplete);
    });

    // Show autocomplete when clicking in search input (if there's content)
    searchInput.addEventListener("click", (event) => {
        if (event.target.value.trim() && event.target.value.length >= 2) {
            showAutocomplete(event.target.value, searchAutocomplete);
        }
    });

    // Focus event to show autocomplete when tabbing into input
    searchInput.addEventListener("focus", (event) => {
        if (event.target.value.trim() && event.target.value.length >= 2) {
            showAutocomplete(event.target.value, searchAutocomplete);
        }
    });

    // Allow Enter key to submit search and handle autocomplete navigation
    searchInput.addEventListener("keydown", async (event) => {
        if (searchAutocomplete.style.display === 'block' &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            handleAutocompleteNavigation(event, searchAutocomplete);
        } else if (event.key === "Enter") {
            event.preventDefault();

            // If search is empty, clear the search and show all courses
            if (!searchInput.value.trim()) {
                searchAutocomplete.style.display = 'none';
                currentHighlightIndex = -1;

                // Clear search state
                currentSearchQuery = null;

                // Apply filters which will reload courses if suggestions were displayed
                await applySearchAndFilters();

                // Close the search modal
                const searchContainer = document.querySelector(".search-container");
                const searchModal = document.querySelector(".search-modal");
                if (window.innerWidth <= 1023) {
                    hideModalWithMobileAnimation(searchModal, searchContainer, () => {
                        searchContainer.classList.add("hidden");
                    });
                } else {
                    searchContainer.style.transition = "opacity 0.3s ease";
                    searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
                    searchContainer.style.opacity = "0";
                    searchModal.style.transform = "translate(-50%, -60%)";
                    setTimeout(() => {
                        searchContainer.classList.add("hidden");
                        unlockBodyScroll();
                    }, 300);
                }
                return;
            }

            if (searchAutocomplete.style.display === 'block' && currentHighlightIndex >= 0) {
                const items = searchAutocomplete.querySelectorAll('.search-autocomplete-item');
                if (items[currentHighlightIndex]) {
                    items[currentHighlightIndex].click();
                    return;
                }
            }
            const searchSubmit = document.getElementById('search-submit');
            if (searchSubmit) searchSubmit.click();
        } else if (event.key === "Escape") {
            event.preventDefault();
            if (searchAutocomplete.style.display === 'block') {
                searchAutocomplete.style.display = 'none';
                currentHighlightIndex = -1;
            } else {
                const searchCancel = document.getElementById('search-cancel');
                if (searchCancel) searchCancel.click();
            }
        }
    });
}

// Desktop Search Pill - inline search with autocomplete
let desktopSearchPillInitialized = false;
let desktopHighlightIndex = -1;

function setupDesktopSearchPill() {
    const searchPillInput = document.getElementById('search-pill-input');
    const searchPillAutocomplete = document.getElementById('search-pill-autocomplete');

    if (!searchPillInput || !searchPillAutocomplete) {
        console.log('Desktop search pill elements not found');
        return;
    }

    if (desktopSearchPillInitialized && searchPillInput.dataset.listenerAttached === 'true') {
        console.log('Desktop search pill already initialized');
        return;
    }

    console.log('Initializing desktop search pill');
    searchPillInput.dataset.listenerAttached = 'true';

    // Load courses for autocomplete when user starts typing
    let coursesLoaded = false;

    // Input event for autocomplete
    searchPillInput.addEventListener("input", async (event) => {
        const query = event.target.value;

        // Load courses on first interaction if not already loaded
        if (!coursesLoaded && query.length >= 1) {
            await getAllCourses();
            coursesLoaded = true;
        }

        showDesktopPillAutocomplete(query, searchPillAutocomplete);

        window.clearTimeout(desktopSearchDebounceTimer);
        desktopSearchDebounceTimer = window.setTimeout(() => {
            performSearch(query);
        }, 120);
    });

    // Focus event - load courses and show autocomplete if has content
    searchPillInput.addEventListener("focus", async (event) => {
        if (!coursesLoaded) {
            await getAllCourses();
            coursesLoaded = true;
        }

        if (event.target.value.trim() && event.target.value.length >= 2) {
            showDesktopPillAutocomplete(event.target.value, searchPillAutocomplete);
        }
    });

    // Click event - show autocomplete if has content
    searchPillInput.addEventListener("click", (event) => {
        if (event.target.value.trim() && event.target.value.length >= 2) {
            showDesktopPillAutocomplete(event.target.value, searchPillAutocomplete);
        }
    });

    // Keyboard navigation
    searchPillInput.addEventListener("keydown", async (event) => {
        if (searchPillAutocomplete.style.display === 'block' &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            handleDesktopPillAutocompleteNavigation(event, searchPillAutocomplete);
        } else if (event.key === "Enter") {
            event.preventDefault();

            // If autocomplete is open and item is highlighted, select it
            if (searchPillAutocomplete.style.display === 'block' && desktopHighlightIndex >= 0) {
                const items = searchPillAutocomplete.querySelectorAll('.search-autocomplete-item');
                if (items[desktopHighlightIndex]) {
                    items[desktopHighlightIndex].click();
                    return;
                }
            }

            // Otherwise perform search
            const searchQuery = searchPillInput.value.trim();
            if (searchQuery) {
                window.clearTimeout(desktopSearchDebounceTimer);
                performSearch(searchQuery);
                searchPillAutocomplete.style.display = 'none';
                desktopHighlightIndex = -1;
            } else {
                // Empty search - clear search and show all courses
                window.clearTimeout(desktopSearchDebounceTimer);
                searchPillAutocomplete.style.display = 'none';
                desktopHighlightIndex = -1;
                currentSearchQuery = null;
                await applySearchAndFilters();
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            searchPillAutocomplete.style.display = 'none';
            desktopHighlightIndex = -1;
            searchPillInput.blur();
        }
    });

    // Close autocomplete when clicking outside
    document.addEventListener("click", (event) => {
        const searchPillContainer = document.querySelector('.search-pill-container');
        if (searchPillContainer && !searchPillContainer.contains(event.target)) {
            searchPillAutocomplete.style.display = 'none';
            desktopHighlightIndex = -1;
        }
    });

    desktopSearchPillInitialized = true;
    console.log('Desktop search pill initialized');
}

// Show autocomplete for desktop search pill
function showDesktopPillAutocomplete(query, autocompleteContainer) {
    if (!autocompleteContainer) return;

    if (!query.trim() || query.length < 2) {
        autocompleteContainer.style.display = 'none';
        return;
    }

    const normalizedQuery = query.toLowerCase().trim();

    // First, try exact substring matches
    let suggestions = allCourses.filter(course => {
        const title = normalizeCourseTitle(course.title || '').toLowerCase();
        const professor = romanizeProfessorName(course.professor || '').toLowerCase();
        const courseCode = (course.course_code || '').toLowerCase();

        return title.includes(normalizedQuery) ||
            professor.includes(normalizedQuery) ||
            courseCode.includes(normalizedQuery);
    }).slice(0, 6);

    // If no exact matches found, use fuzzy matching
    if (suggestions.length === 0) {
        const coursesWithRelevance = allCourses.map(course => {
            const relevance = calculateCourseRelevance(normalizedQuery, course);
            return { course, relevance };
        })
            .filter(item => item.relevance > 0.15)
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 6);

        suggestions = coursesWithRelevance.map(item => item.course);
    }

    if (suggestions.length === 0) {
        autocompleteContainer.style.display = 'none';
        return;
    }

    // Create inner wrapper for proper scrolling with inner shadow
    autocompleteContainer.innerHTML = '<div class="search-pill-autocomplete-inner"></div>';
    const innerContainer = autocompleteContainer.querySelector('.search-pill-autocomplete-inner');

    suggestions.forEach((course, index) => {
        const item = document.createElement('div');
        item.className = 'search-autocomplete-item';

        // Highlight matching parts in the title
        const title = course.title || '';
        const highlightedTitle = highlightMatches(title, query);

        item.innerHTML = `
            <div class="item-title">${highlightedTitle}</div>
            <div class="item-details">
                <span class="item-code">${course.course_code}</span>
                <span class="item-professor">${romanizeProfessorName(course.professor)}</span>
            </div>
        `;

        item.addEventListener('click', () => {
            const searchPillInput = document.getElementById('search-pill-input');
            if (searchPillInput) {
                searchPillInput.value = course.title;
            }
            autocompleteContainer.style.display = 'none';
            desktopHighlightIndex = -1;

            // Check if we're on the calendar page
            const isCalendarPage = getCurrentAppPath() === '/timetable' || document.querySelector('calendar-page') !== null;

            if (isCalendarPage) {
                // On calendar page - open course info modal directly without navigation
                if (window.openCourseInfoMenu) {
                    window.openCourseInfoMenu(course);
                }
            } else {
                // On courses page - perform search as normal
                window.clearTimeout(desktopSearchDebounceTimer);
                performSearch(course.title);
            }
        });

        innerContainer.appendChild(item);
    });

    autocompleteContainer.style.display = 'block';
    desktopHighlightIndex = -1;
}

// Handle keyboard navigation for desktop pill autocomplete
function handleDesktopPillAutocompleteNavigation(event, autocompleteContainer) {
    if (!autocompleteContainer) return;

    // Look for items inside the inner container
    const innerContainer = autocompleteContainer.querySelector('.search-pill-autocomplete-inner');
    const items = innerContainer ? innerContainer.querySelectorAll('.search-autocomplete-item') : autocompleteContainer.querySelectorAll('.search-autocomplete-item');

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        desktopHighlightIndex = Math.min(desktopHighlightIndex + 1, items.length - 1);
        updateDesktopPillHighlight(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        desktopHighlightIndex = Math.max(desktopHighlightIndex - 1, -1);
        updateDesktopPillHighlight(items);
    }
}

// Update highlight for desktop pill autocomplete
function updateDesktopPillHighlight(items) {
    items.forEach((item, index) => {
        if (index === desktopHighlightIndex) {
            item.classList.add('highlighted');
        } else {
            item.classList.remove('highlighted');
        }
    });
}

// Track if custom selects have been initialized
let customSelectsInitialized = false;

// Function to sync all semester dropdowns (mobile and desktop)
function syncSemesterDropdowns(value) {
    const semesterSelects = document.querySelectorAll('.semester-select');
    semesterSelects.forEach(select => {
        if (select.value !== value) {
            select.value = value;
        }
    });

    // Also sync the custom dropdown visual states
    const customSelects = document.querySelectorAll('.custom-select[data-target^="semester-select"]');
    customSelects.forEach(customSelect => {
        const valueElement = customSelect.querySelector('.custom-select-value');
        const options = customSelect.querySelectorAll('.custom-select-option');

        options.forEach(option => {
            option.classList.remove('selected');
            if (option.dataset.value === value) {
                option.classList.add('selected');
                if (valueElement) valueElement.textContent = option.textContent;
            }
        });
    });
}

// Function to populate the semester dropdown dynamically from the database
async function populateSemesterDropdown() {
    const semesters = await fetchAvailableSemesters();
    console.log('Populating semester dropdown with semesters:', semesters);

    // Get all semester selects (mobile and desktop)
    const semesterSelects = document.querySelectorAll('.semester-select');
    const termSelect = document.getElementById('term-select');
    const yearSelect = document.getElementById('year-select');

    // Get all custom select dropdowns for semester
    const customSelects = document.querySelectorAll('.custom-select[data-target^="semester-select"]');

    if (semesterSelects.length === 0 || customSelects.length === 0) {
        console.error('Semester select elements not found');
        return;
    }

    const semesterValues = semesters.map((semester) => `${semester.term}-${semester.year}`);
    const selectedSemesterValue = resolvePreferredTermForAvailableSemesters(semesterValues)
        || semesterValues[0]
        || null;
    const selectedSemester = semesters.find((semester) => `${semester.term}-${semester.year}` === selectedSemesterValue) || semesters[0] || null;

    // Populate each semester select (hidden <select> elements)
    semesterSelects.forEach(semesterSelect => {
        semesterSelect.innerHTML = '';

        semesters.forEach((semester) => {
            const value = `${semester.term}-${semester.year}`;
            const option = document.createElement('option');
            option.value = value;
            option.textContent = semester.label;
            if (value === selectedSemesterValue) option.selected = true;
            semesterSelect.appendChild(option);
        });

        if (selectedSemesterValue) {
            semesterSelect.value = selectedSemesterValue;
        }
    });

    // Populate each custom dropdown
    customSelects.forEach(customSelect => {
        const optionsContainer = customSelect.querySelector('.custom-select-options');
        const valueElement = customSelect.querySelector('.custom-select-value');

        if (!optionsContainer || !valueElement) return;

        optionsContainer.innerHTML = '';

        semesters.forEach((semester) => {
            const value = `${semester.term}-${semester.year}`;
            const customOption = document.createElement('div');
            customOption.className = 'ui-select__option custom-select-option' + (value === selectedSemesterValue ? ' selected' : '');
            customOption.dataset.value = value;
            customOption.textContent = semester.label;
            optionsContainer.appendChild(customOption);
        });

        // Set the displayed value for the selected semester
        if (selectedSemester) {
            valueElement.textContent = selectedSemester.label;
        }
    });

    // Update hidden term/year and preferred term for the selected semester
    if (selectedSemester) {
        if (termSelect) termSelect.value = selectedSemester.term;
        if (yearSelect) yearSelect.value = selectedSemester.year;

        if (selectedSemesterValue) {
            setPreferredTermValue(selectedSemesterValue);
            applyPreferredTermToGlobals(selectedSemesterValue);
        }
    }

    console.log('Semester dropdown populated successfully');
}

// Helper function to parse semester value into term and year
function parseSemesterValue(value) {
    if (!value || value === '' || value === 'Loading...') {
        return { term: null, year: null };
    }
    const parts = value.split('-');
    if (parts.length === 2) {
        return { term: parts[0], year: parts[1] };
    }
    return { term: null, year: null };
}

// Function to initialize custom select dropdowns
function initializeCustomSelects() {
    const customSelects = document.querySelectorAll('.custom-select');
    if (customSelects.length === 0) {
        console.log('No custom selects found');
        return;
    }

    console.log('Initializing custom selects:', customSelects.length, 'already initialized:', customSelectsInitialized);

    const isSemesterLikeTarget = (targetId) => {
        const normalized = String(targetId || '').trim();
        return normalized === 'semester-select'
            || normalized === 'semester-select-mobile'
            || normalized === 'course-page-semester-select'
            || normalized === 'term-select'
            || normalized === 'year-select';
    };

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

    customSelects.forEach(customSelect => {
        const trigger = customSelect.querySelector('.custom-select-trigger');
        const options = customSelect.querySelector('.custom-select-options');
        const targetSelectId = customSelect.dataset.target;
        const targetSelect = document.getElementById(targetSelectId);

        if (!trigger || !options || !targetSelect) {
            console.log('Missing elements for custom select:', targetSelectId);
            return;
        }

        // Skip if already initialized (check for marker)
        if (customSelect.dataset.initialized === 'true') {
            console.log('Custom select already initialized:', targetSelectId);
            return;
        }

        console.log('Setting up custom select for:', targetSelectId);
        if (isSemesterLikeTarget(targetSelectId)) {
            bindContainedScroll(options);
        }

        // Mark as initialized
        customSelect.dataset.initialized = 'true';

        // Click handler for opening/closing dropdown
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();

            if (openSemesterMobileSheet({ targetSelect })) {
                customSelect.classList.remove('open');
                return;
            }

            // Close other custom selects
            document.querySelectorAll('.custom-select').forEach(otherSelect => {
                if (otherSelect !== customSelect) {
                    otherSelect.classList.remove('open');
                }
            });

            customSelect.classList.toggle('open');
            console.log('Custom select toggled:', targetSelectId, customSelect.classList.contains('open'));
        });

        // Option selection handler
        options.addEventListener('click', (e) => {
            const option = e.target.closest('.custom-select-option');
            if (!option) return;

            const value = option.dataset.value;
            const text = option.textContent;

            console.log('Custom select option clicked:', targetSelectId, value);

            // Update visual state
            options.querySelectorAll('.custom-select-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');

            // Update trigger text
            const valueElement = trigger.querySelector('.custom-select-value');
            if (valueElement) valueElement.textContent = text;

            // Update actual select
            console.log('  → Setting', targetSelectId, 'value to:', value);
            targetSelect.value = value;
            console.log('  → Value set. Current value:', targetSelect.value);

            // Trigger change event with bubbles: true
            console.log('  → Dispatching change event on', targetSelectId);
            const changeEvent = new Event('change', { bubbles: true });
            targetSelect.dispatchEvent(changeEvent);
            console.log('  → Change event dispatched');

            // Close dropdown
            customSelect.classList.remove('open');
        });
    });

    // Close dropdowns when clicking outside (only add once)
    if (!customSelectsInitialized) {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.custom-select')) {
                document.querySelectorAll('.custom-select').forEach(customSelect => {
                    customSelect.classList.remove('open');
                });
            }

            // Close all sort dropdowns when clicking outside
            if (!e.target.closest('.sort-wrapper')) {
                document.querySelectorAll('.sort-wrapper').forEach(sortWrapper => {
                    sortWrapper.classList.remove("open");
                });
            }
        });
    }

    customSelectsInitialized = true;
    console.log('Custom selects initialization complete');
}

// Function to initialize filter checkboxes
function initializeFilterCheckboxes() {
    const filterCheckboxes = document.querySelectorAll('.filter-checkbox');

    filterCheckboxes.forEach(checkbox => {
        if (checkbox.dataset.listenerAttached === 'true') return;
        checkbox.dataset.listenerAttached = 'true';
        checkbox.addEventListener('change', async () => {
            // Apply filters when any checkbox changes
            updateCourseFilterTriggerCount();
            await applySearchAndFilters();
        });
    });

    updateCourseFilterTriggerCount();
}

// Responsive courses toolbar layout is handled via CSS.
// No JavaScript DOM manipulation is needed for toolbar structure changes.

async function calendarSchedule(year, term) {
    displayedYear = year;
    displayedTerm = term;

    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('courses_selection')
            .eq('id', user.id)
            .single();

        if (profileError) {
            throw profileError;
        }

        const selectedCourses = profile?.courses_selection || [];

        // Filter to only show courses for the current year and term being displayed
        const currentDisplayCourses = selectedCourses.filter(course => {
            return course.year === parseInt(year) && (!course.term || course.term === term);
        });

        calendar.querySelectorAll('tbody td .course-cell').forEach(el => el.remove());

        if (currentDisplayCourses.length === 0) {
            calendar.querySelectorAll('tbody tr td:not(:first-child)').forEach(cell => {
                if (!cell.querySelector('.course-cell')) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.textContent = 'EMPTY';
                    emptyDiv.classList.add('course-cell', 'empty-cell');
                    cell.appendChild(emptyDiv);
                }
            });
            return;
        }

        const allCoursesInSemester = await fetchCourseData(year, term);

        const coursesToShow = allCoursesInSemester.filter(course =>
            currentDisplayCourses.some((profileCourse) =>
                profileCourse.code === course.course_code
            )
        );

        coursesToShow.forEach(course => {
            // Match both full and short Japanese formats: (月曜日1講時) or (木4講時)
            const match = course.time_slot.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
            if (!match) return;

            const dayJP = match[1];
            const period = parseInt(match[2], 10);
            const dayMap = { "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat", "日": "Sun" };
            const dayEN = dayMap[dayJP];
            if (!dayEN) return;

            let colIndex = -1;
            calendarHeader.forEach((header, idx) => {
                if (header.textContent.trim().startsWith(dayEN)) colIndex = idx;
            });
            if (colIndex === -1) return;

            let rowIndex = -1;
            calendar.querySelectorAll("tbody tr").forEach((row, idx) => {
                const periodCell = row.querySelector("td");
                if (periodCell) {
                    const p = periodCell.querySelector("p");
                    if (p) {
                        const periodMatch = p.textContent.match(/period\s*(\d+)/i);
                        if (periodMatch && parseInt(periodMatch[1], 10) === period) {
                            rowIndex = idx;
                        }
                    }
                }
            });
            if (rowIndex === -1) return;

            const cell = calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
            if (cell) {
                const div = document.createElement("div");
                const div_title = document.createElement("div");
                const div_classroom = document.createElement("div");
                div_classroom.textContent = ""; // To be changed
                div_title.textContent = course.title_short.normalize("NFKC").toUpperCase();
                div.classList.add("course-cell");
                div_title.classList.add("course-title");
                div_classroom.classList.add("course-classroom");
                if (div_classroom.textContent === "") {
                    div_classroom.classList.add("empty-classroom");
                    div_title.classList.add("empty-classroom-title");
                }
                div.style.backgroundColor = getCourseColorByType(course.type);
                div.dataset.courseIdentifier = course.course_code;
                cell.appendChild(div);
                div.appendChild(div_title);
                div.appendChild(div_classroom);
            }
        });

        calendar.querySelectorAll('tbody tr td:not(:first-child)').forEach(cell => {
            if (!cell.querySelector('.course-cell')) {
                const emptyDiv = document.createElement('div');
                emptyDiv.textContent = 'EMPTY';
                emptyDiv.classList.add('course-cell', 'empty-cell');
                cell.appendChild(emptyDiv);
            }
        });
    } catch (error) {
        console.error('An unexpected error occurred while showing courses:', error);
    }
}

// Initialize sticky observer when DOM is loaded
// NOTE: Custom dropdowns are initialized via initializeCustomSelects() called from setupDashboardEventListeners()
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, initializing sticky observer...');
        initStickyObserver();
    });
} else {
    // DOM is already loaded
    console.log('DOM already loaded, initializing sticky observer immediately...');
    setTimeout(() => {
        initStickyObserver();
    }, 100); // Small delay to ensure elements are rendered
}

// Sticky header scroll state for courses page
function initStickyObserver() {
    if (typeof stickyHeaderObserverCleanup === 'function') {
        stickyHeaderObserverCleanup();
        stickyHeaderObserverCleanup = null;
    }

    const stickyHeaders = Array.from(document.querySelectorAll('.page-courses .courses-toolbar-shell, .page-courses .courses-sticky-header'));
    if (!stickyHeaders.length) return;

    const appContent = document.getElementById('app-content');
    let rafId = 0;

    const getScrollTop = () => {
        const windowScrollY = window.scrollY || window.pageYOffset || 0;
        const rootScrollY = document.documentElement?.scrollTop || 0;
        const bodyScrollY = document.body?.scrollTop || 0;
        const contentScrollY = appContent ? appContent.scrollTop : 0;
        return Math.max(windowScrollY, rootScrollY, bodyScrollY, contentScrollY);
    };

    const applyScrollState = () => {
        rafId = 0;
        const isScrolled = getScrollTop() > 0;
        stickyHeaders.forEach((header) => {
            header.classList.toggle('is-scrolled', isScrolled);
        });
    };

    const requestApply = () => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(applyScrollState);
    };

    window.addEventListener('scroll', requestApply, { passive: true });
    appContent?.addEventListener('scroll', requestApply, { passive: true });
    document.addEventListener('scroll', requestApply, { passive: true, capture: true });
    window.addEventListener('resize', requestApply);
    applyScrollState();

    stickyHeaderObserverCleanup = () => {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        window.removeEventListener('scroll', requestApply);
        appContent?.removeEventListener('scroll', requestApply);
        document.removeEventListener('scroll', requestApply, true);
        window.removeEventListener('resize', requestApply);
    };
}

// Function to handle mobile modal animations and scroll prevention
let scrollPosition = 0;
let modalCount = 0; // Track how many modals are open

function lockBodyScroll() {
    modalCount++;
    console.log('Lock body scroll called, modal count:', modalCount);

    if (window.innerWidth <= 1023) {
        if (modalCount === 1) { // Only lock on first modal
            scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
            document.body.classList.add('modal-open');
            document.body.style.top = `-${scrollPosition}px`;

            // Additional prevention for iOS
            document.addEventListener('touchmove', preventBodyScroll, { passive: false });
        }
    } else {
        if (modalCount === 1) { // Only lock on first modal
            document.body.style.overflow = "hidden";
        }
    }
}

function unlockBodyScroll() {
    modalCount = Math.max(0, modalCount - 1);
    console.log('Unlock body scroll called, modal count:', modalCount);

    if (modalCount > 0) return; // Don't unlock if other modals are open

    if (window.innerWidth <= 1023) {
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
        document.body.style.overflow = '';

        // Restore scroll position
        window.scrollTo(0, scrollPosition);

        // Remove iOS prevention
        document.removeEventListener('touchmove', preventBodyScroll);

        // Force a repaint to ensure styles are applied
        document.body.offsetHeight;
    } else {
        document.body.style.overflow = "";
        document.body.style.position = "";
        document.body.style.width = "";
        document.body.style.height = "";

        // Force style recalculation
        document.body.offsetHeight;
        console.log('Body overflow reset to:', document.body.style.overflow);
    }
}

function preventBodyScroll(e) {
    // Allow scrolling inside modal elements
    const target = e.target;
    const modal = target.closest('.filter-popup, .search-modal');

    if (!modal) {
        e.preventDefault();
        return false;
    }
}

function showModalWithMobileAnimation(modal, container, callback = null) {
    const isMobile = window.innerWidth <= 1023;

    if (isMobile) {
        const background = container.querySelector('.filter-background, .search-background');

        // Reset transient swipe styles before each open.
        modal.classList.remove('swiping');
        modal.style.removeProperty('--modal-translate-y');
        modal.style.transition = '';
        modal.style.opacity = '';

        if (background) {
            background.style.transition = 'opacity 220ms ease';
            background.style.opacity = '0';
        }

        modal.classList.add('show');
        lockBodyScroll();

        requestAnimationFrame(() => {
            if (background) {
                background.style.opacity = '1';
            }
        });

        if (background && typeof window.addSwipeToCloseSimple === 'function') {
            window.addSwipeToCloseSimple(modal, background, () => {
                container.classList.add('hidden');
                unlockBodyScroll();
                background.style.opacity = '';
                background.style.transition = '';
            });
        }

        if (callback) callback();
    } else {
        // Desktop animation logic
        lockBodyScroll();
        if (callback) callback();
    }
}

function hideModalWithMobileAnimation(modal, container, callback = null) {
    const isMobile = window.innerWidth <= 1023;

    if (isMobile) {
        const background = container.querySelector('.filter-background, .search-background');

        modal.classList.remove('show', 'swiping');
        modal.style.removeProperty('--modal-translate-y');
        modal.style.transition = '';
        modal.style.opacity = '';

        if (background) {
            background.style.transition = 'opacity 220ms ease';
            background.style.opacity = '0';
        }

        setTimeout(() => {
            unlockBodyScroll();
            if (background) {
                background.style.opacity = '';
                background.style.transition = '';
            }
            if (callback) callback();
        }, 320);
    } else {
        // Desktop animation logic
        unlockBodyScroll();
        if (callback) callback();
    }
}

// Function to sort courses based on selected method
function sortCourses(method) {
    const courseList = document.getElementById("course-list");
    if (!courseList) return;

    const courseContainers = Array.from(courseList.querySelectorAll(".class-outside"));

    courseContainers.sort((a, b) => {
        const courseA = JSON.parse(a.querySelector('.class-container').dataset.course);
        const courseB = JSON.parse(b.querySelector('.class-container').dataset.course);

        switch (method) {
            case 'title-az':
                return normalizeCourseTitle(courseA.title || '').localeCompare(normalizeCourseTitle(courseB.title || ''));
            case 'title-za':
                return normalizeCourseTitle(courseB.title || '').localeCompare(normalizeCourseTitle(courseA.title || ''));
            case 'gpa-a-high':
                return (courseB.gpa_a_percent || 0) - (courseA.gpa_a_percent || 0);
            case 'gpa-f-high':
                return (courseB.gpa_f_percent || 0) - (courseA.gpa_f_percent || 0);
            default:
                return 0;
        }
    });

    // Clear and re-append sorted courses
    courseList.innerHTML = '';
    courseContainers.forEach(container => {
        courseList.appendChild(container);
    });

    // Re-apply current filters after sorting
    applyFilters();
}

// Search modal functionality
let originalCourses = []; // Store original courses for search
let allCourses = []; // Store all courses for autocomplete
let currentHighlightIndex = -1;

// Function to get all courses for autocomplete
async function getAllCourses() {
    try {
        console.log('📚 getAllCourses() called');
        const yearSelect = document.getElementById("year-select");
        const termSelect = document.getElementById("term-select");
        console.log('  → year-select element:', yearSelect);
        console.log('  → term-select element:', termSelect);

        if (!yearSelect || !termSelect) {
            console.error('  ❌ Year or term select not found!');
            return [];
        }

        const year = yearSelect.value;
        const term = termSelect.value;
        console.log('  → Year value:', year);
        console.log('  → Term value:', term);
        console.log('  → Fetching courses for:', year, term);

        const courses = await fetchCourseData(year, term);
        console.log('  → Fetched courses count:', courses.length);
        allCourses = courses;
        console.log('  → allCourses updated with', allCourses.length, 'courses');
        return courses;
    } catch (error) {
        console.error('❌ Error fetching courses for autocomplete:', error);
        return [];
    }
}

// Enhanced autocomplete function with fuzzy matching
function showAutocomplete(query, searchAutocomplete) {
    if (!searchAutocomplete) {
        searchAutocomplete = document.getElementById('search-autocomplete');
    }

    if (!query.trim() || query.length < 2) {
        if (searchAutocomplete) searchAutocomplete.style.display = 'none';
        return;
    }

    const normalizedQuery = query.toLowerCase().trim();

    // First, try exact substring matches
    let suggestions = allCourses.filter(course => {
        const title = normalizeCourseTitle(course.title || '').toLowerCase();
        const professor = romanizeProfessorName(course.professor || '').toLowerCase();
        const courseCode = (course.course_code || '').toLowerCase();

        return title.includes(normalizedQuery) ||
            professor.includes(normalizedQuery) ||
            courseCode.includes(normalizedQuery);
    }).slice(0, 5);

    // If no exact matches found, use fuzzy matching
    if (suggestions.length === 0) {
        const coursesWithRelevance = allCourses.map(course => {
            const relevance = calculateCourseRelevance(normalizedQuery, course);
            return { course, relevance };
        })
            .filter(item => item.relevance > 0.15) // Threshold for autocomplete suggestions
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 6); // Get more fuzzy matches

        suggestions = coursesWithRelevance.map(item => item.course);
    }

    if (suggestions.length === 0) {
        if (searchAutocomplete) searchAutocomplete.style.display = 'none';
        return;
    }

    if (!searchAutocomplete) return;

    searchAutocomplete.innerHTML = '';
    suggestions.forEach((course, index) => {
        const item = document.createElement('div');
        item.className = 'search-autocomplete-item';

        // Highlight matching parts in the title
        const title = course.title || '';
        const highlightedTitle = highlightMatches(title, query);

        item.innerHTML = `
            <div class="item-title">${highlightedTitle}</div>
            <div class="item-details">
                <span class="item-code">${course.course_code}</span>
                <span class="item-professor">${romanizeProfessorName(course.professor)}</span>
            </div>
        `;

        item.addEventListener('click', () => {
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = course.title;
            if (searchAutocomplete) searchAutocomplete.style.display = 'none';
            currentHighlightIndex = -1;

            // Check if we're on the calendar page
            const isCalendarPage = getCurrentAppPath() === '/timetable' || document.querySelector('calendar-page') !== null;

            if (isCalendarPage) {
                // On calendar page - open course info modal directly without navigation
                if (window.openCourseInfoMenu) {
                    window.openCourseInfoMenu(course);
                }
            } else {
                // On courses page - perform search
                performSearch(course.title);
            }
        });

        searchAutocomplete.appendChild(item);
    });

    searchAutocomplete.style.display = 'block';
    currentHighlightIndex = -1;
}

// Function to highlight matching characters in text
function highlightMatches(text, query) {
    if (!query || query.length < 2) return text;

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Simple highlighting for substring matches
    if (textLower.includes(queryLower)) {
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark style="background: #E3D5E9; padding: 0 2px; border-radius: 3px;">$1</mark>');
    }

    // For fuzzy matches, highlight individual matching characters
    let result = '';
    let queryIndex = 0;

    for (let i = 0; i < text.length && queryIndex < query.length; i++) {
        if (textLower[i] === queryLower[queryIndex]) {
            result += `<mark style="background: #E3D5E9; padding: 0 1px; border-radius: 2px;">${text[i]}</mark>`;
            queryIndex++;
        } else {
            result += text[i];
        }
    }

    // Add remaining characters
    if (queryIndex < query.length || result.length < text.length) {
        result += text.slice(result.replace(/<[^>]*>/g, '').length);
    }

    return result;
}

// Function to handle keyboard navigation in autocomplete
function handleAutocompleteNavigation(event, searchAutocomplete) {
    if (!searchAutocomplete) {
        searchAutocomplete = document.getElementById('search-autocomplete');
    }
    if (!searchAutocomplete) return;

    const items = searchAutocomplete.querySelectorAll('.search-autocomplete-item');

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        currentHighlightIndex = Math.min(currentHighlightIndex + 1, items.length - 1);
        updateHighlight(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        currentHighlightIndex = Math.max(currentHighlightIndex - 1, -1);
        updateHighlight(items);
    } else if (event.key === 'Enter') {
        if (currentHighlightIndex >= 0 && items[currentHighlightIndex]) {
            event.preventDefault();
            items[currentHighlightIndex].click();
        }
    }
}

// Function to update highlight in autocomplete
function updateHighlight(items) {
    items.forEach((item, index) => {
        if (index === currentHighlightIndex) {
            item.classList.add('highlighted');
        } else {
            item.classList.remove('highlighted');
        }
    });
}

// Enhanced similarity functions for better fuzzy matching

// Calculate Levenshtein distance
function levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,     // deletion
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j - 1] + 1  // substitution
                );
            }
        }
    }

    return matrix[len1][len2];
}

// Calculate character-based similarity
function characterSimilarity(str1, str2) {
    const chars1 = str1.toLowerCase().split('');
    const chars2 = str2.toLowerCase().split('');

    const set1 = new Set(chars1);
    const set2 = new Set(chars2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
}

// Calculate substring similarity (how much one string contains the other)
function substringSimilarity(query, target) {
    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();

    // Check if query is a substring of target
    if (targetLower.includes(queryLower)) {
        return queryLower.length / targetLower.length;
    }

    // Check if target is a substring of query
    if (queryLower.includes(targetLower)) {
        return targetLower.length / queryLower.length;
    }

    return 0;
}

// Enhanced word similarity with multiple algorithms
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const query = str1.toLowerCase().trim();
    const target = str2.toLowerCase().trim();

    // Exact match gets highest score
    if (query === target) return 1.0;

    // Substring match gets high score
    const substringScore = substringSimilarity(query, target);
    if (substringScore > 0) return 0.8 + (substringScore * 0.2);

    // Calculate different similarity metrics
    const maxLength = Math.max(query.length, target.length);
    const levenshteinScore = maxLength === 0 ? 0 : 1 - (levenshteinDistance(query, target) / maxLength);
    const charScore = characterSimilarity(query, target);

    // Word-based Jaccard similarity
    const words1 = query.split(/\s+/).filter(word => word.length > 1);
    const words2 = target.split(/\s+/).filter(word => word.length > 1);
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    const jaccardScore = union.size === 0 ? 0 : intersection.size / union.size;

    // Combine scores with different weights
    const combinedScore = (levenshteinScore * 0.4) + (charScore * 0.3) + (jaccardScore * 0.3);

    return Math.max(combinedScore, 0);
}

// Advanced fuzzy matching for course fields
function calculateCourseRelevance(query, course) {
    if (!query.trim()) return 0;

    const normalizedQuery = query.toLowerCase().trim();
    const title = normalizeCourseTitle(course.title || '').toLowerCase();
    const professorOriginal = (course.professor || '').toLowerCase();
    const professorRomanized = romanizeProfessorName(course.professor || '').toLowerCase();
    const courseCode = (course.course_code || '').toLowerCase();

    // Exact matches get bonus scores
    if (title.includes(normalizedQuery) ||
        professorOriginal.includes(normalizedQuery) ||
        professorRomanized.includes(normalizedQuery) ||
        courseCode.includes(normalizedQuery)) {
        return 0.9;
    }

    // Calculate similarity for each field
    const titleSimilarity = calculateSimilarity(normalizedQuery, title);
    const professorOriginalSimilarity = calculateSimilarity(normalizedQuery, professorOriginal);
    const professorRomanizedSimilarity = calculateSimilarity(normalizedQuery, professorRomanized);
    const codeSimilarity = calculateSimilarity(normalizedQuery, courseCode);

    // Take the best professor similarity score (either original or romanized)
    const professorSimilarity = Math.max(professorOriginalSimilarity, professorRomanizedSimilarity);

    // Special handling for course codes (they're often abbreviated)
    let codeBonus = 0;
    if (normalizedQuery.length >= 2 && courseCode.includes(normalizedQuery.substring(0, 2))) {
        codeBonus = 0.3;
    }

    // Weight different fields differently
    const overallSimilarity = Math.max(
        titleSimilarity * 0.6,
        professorSimilarity * 0.4,
        codeSimilarity * 0.5 + codeBonus
    );

    return overallSimilarity;
}

// Enhanced function to find similar courses with better fuzzy matching
function findSimilarCourses(searchQuery, courses, limit = 8) {
    if (!searchQuery.trim() || courses.length === 0) return [];

    const coursesWithRelevance = courses.map(course => {
        const relevance = calculateCourseRelevance(searchQuery, course);
        return { course, relevance };
    })
        .filter(item => item.relevance > 0.05) // Lower threshold for more inclusive results
        .sort((a, b) => b.relevance - a.relevance) // Sort by relevance descending
        .slice(0, limit); // Limit results

    return coursesWithRelevance.map(item => ({
        course: item.course,
        relevanceScore: item.relevance
    }));
}

// Function to display suggested courses with relevance information
function displaySuggestedCourses(coursesWithRelevance, searchQuery) {
    const courseList = document.getElementById("course-list");
    const courseMainDiv = document.getElementById("course-main-div");

    if (coursesWithRelevance.length === 0) {
        courseList.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <h3 style="color: #666; margin-bottom: 10px;">No courses found</h3>
                <p style="color: #999;">No courses match your search for "${searchQuery}"</p>
                <p style="color: #aaa; font-size: 14px; margin-top: 15px;">Try:</p>
                <ul style="color: #aaa; font-size: 14px; text-align: left; max-width: 300px; margin: 10px auto;">
                    <li>Checking your spelling</li>
                    <li>Using fewer or different keywords</li>
                    <li>Searching for a professor's name</li>
                    <li>Using course codes (e.g., "MATH", "ENG")</li>
                </ul>
            </div>
        `;
        // Remove any existing suggestion header
        const existingHeader = courseMainDiv.querySelector('.suggestion-header');
        if (existingHeader) existingHeader.remove();
        return;
    }

    // Create or update the suggestion header outside course-list
    let suggestionHeader = courseMainDiv.querySelector('.suggestion-header');
    if (!suggestionHeader) {
        suggestionHeader = document.createElement('div');
        suggestionHeader.className = 'suggestion-header';
        courseMainDiv.insertBefore(suggestionHeader, courseList);
    }

    suggestionHeader.innerHTML = `
        <div class="no-courses-container">
            <h3>No exact matches found for "${searchQuery}"</h3>
            <p>Here are the most similar courses we found:</p>
        </div>
    `;

    let coursesHTML = '';
    const statusLookup = lastLoadedCoursePlanningContext?.statusLookup instanceof Map
        ? lastLoadedCoursePlanningContext.statusLookup
        : new Map();
    const scheduleLookup = lastLoadedCoursePlanningContext?.scheduleSignalLookup instanceof Map
        ? lastLoadedCoursePlanningContext.scheduleSignalLookup
        : new Map();

    coursesWithRelevance.forEach(function ({ course }) {
        const days = {
            "月曜日": "Mon", "月": "Mon",
            "火曜日": "Tue", "火": "Tue",
            "水曜日": "Wed", "水": "Wed",
            "木曜日": "Thu", "木": "Thu",
            "金曜日": "Fri", "金": "Fri"
        };
        const times = {
            "1講時": "09:00 - 10:30", "1": "09:00 - 10:30",
            "2講時": "10:45 - 12:15", "2": "10:45 - 12:15",
            "3講時": "13:10 - 14:40", "3": "13:10 - 14:40",
            "4講時": "14:55 - 16:25", "4": "14:55 - 16:25",
            "5講時": "16:40 - 18:10", "5": "16:40 - 18:10"
        };

        const rawTimeSlot = course.time_slot || "";
        let timeSlot = rawTimeSlot;
        // Match both full and short Japanese formats: (月曜日1講時) or (木4講時)
        const match = rawTimeSlot.match(/\(?([月火水木金土日](?:曜日)?)([1-5](?:講時)?)\)?/);
        const specialMatch = rawTimeSlot.match(/(月曜日3講時・木曜日3講時)/);

        if (/(集中講義|集中)/.test(rawTimeSlot)) {
            timeSlot = "Intensive";
        } else if (specialMatch) {
            timeSlot = "Mon 13:10 - 14:40<br>Thu 13:10 - 14:40";
        } else if (match) {
            timeSlot = `${days[match[1]]} ${times[match[2]]}`;
        }

        const suggestedCourseColor = getCourseColorByType(course.type);
        const suggestedCourseBorderColor = getCourseCardBorderColor(suggestedCourseColor);
        const suggestedCourseHoverBorderColor = getCourseCardHoverBorderColor(suggestedCourseColor);
        const hasProfessorChanged = lastLoadedProfessorChanges.has(course.course_code);
        const creditsChip = getCreditsChipMarkup(course);
        const shouldHideGpaForProfessor = hasProfessorChanged || !isCourseGpaAlignedWithCurrentProfessor(course);
        const gpaSummaryChip = getGpaChipMarkup(course, shouldHideGpaForProfessor);
        const newProfessorChip = getNewProfessorChipMarkup(hasProfessorChanged);
        const evaluationChipRow = getCourseEvaluationChipMarkup(course);
        const professorDisplay = formatProfessorCardName(course.professor);
        const courseTypeLabel = getCourseTypeLabel(course.type);
        const mobileTypeChip = getMobileCourseTypeChipMarkup(courseTypeLabel);
        const requiredYearMeta = resolveCourseRequiredYearMeta(course, lastLoadedCoursePlanningContext);
        const requiredYearChip = getRequiredYearChipMarkup(requiredYearMeta);
        const mobileRequiredYearChip = getRequiredYearChipMarkup(requiredYearMeta, { mobile: true });
        const japaneseLanguageChip = getGraduateLanguageChipMarkup(course);
        const mobileJapaneseLanguageChip = getGraduateLanguageChipMarkup(course, { mobile: true });
        const statusKey = buildCourseStatusKey(course, lastLoadedYear, lastLoadedTerm);
        const courseStatusLabel = statusLookup.get(statusKey) || '';
        const scheduleSignal = scheduleLookup.get(statusKey) || { type: 'none', label: '' };
        const stateFlags = {
            isRegistered: courseStatusLabel === 'Registered',
            isSaved: courseStatusLabel === 'Saved',
            isHidden: false
        };
        const courseStatusChip = getCourseStatusChipMarkup(courseStatusLabel, suggestedCourseColor);
        const helperBadge = getCourseHelperBadgeMarkup(scheduleSignal, stateFlags);
        const mobilePrimarySignalChip = getMobilePrimarySignalChipMarkup(courseStatusLabel, scheduleSignal, suggestedCourseColor);
        const suggestedTitle = normalizeCourseTitle(course.title);
        const timeDisplay = String(timeSlot || '').replace(/ - /g, ' – ');
        const suggestedCardAriaLabel = `Open course info for ${suggestedTitle}`.replace(/"/g, '&quot;');
        const suggestedAssessmentPreview = getAssessmentPreviewTagItems(course, 6);
        const decoratedCourse = {
            ...course,
            scheduleSignal,
            stateFlags,
            assessmentSummary: {
                primary: suggestedAssessmentPreview.slice(0, 2).map((item) => item.label),
                overflowCount: Math.max(0, suggestedAssessmentPreview.length - 2),
                workloadLabel: null
            },
            assessmentFlags: deriveDeterministicAssessmentFlags(course),
            requiredYearMin: requiredYearMeta.requiredYearMin,
            requiredYearLabel: requiredYearMeta.requiredYearLabel,
            requiredYearBadgeLabel: requiredYearMeta.requiredYearBadgeLabel,
            requiredYearBucketId: requiredYearMeta.requiredYearBucketId,
            hasRequiredYear: requiredYearMeta.hasRequiredYear,
            hasKnownUserYear: requiredYearMeta.hasKnownUserYear,
            meetsYearRequirement: requiredYearMeta.meetsRequirement,
            isHidden: false
        };
        // Escape the JSON string for safe HTML attribute embedding
        const escapedCourseJSON = JSON.stringify(decoratedCourse).replace(/'/g, '&#39;');

        coursesHTML += `
        <div class="class-outside suggested-course" id="${timeSlot}" data-color='${suggestedCourseColor}' style="--course-card-border: ${suggestedCourseBorderColor}; --course-card-border-hover: ${suggestedCourseHoverBorderColor}; opacity: 0.9; border: 2px dashed #BDAAC6; position: relative;" role="button" tabindex="0" aria-label="${suggestedCardAriaLabel}">
            <div class="class-container" style="--course-card-accent: ${suggestedCourseColor}; --course-card-border: ${suggestedCourseBorderColor}; position: relative;" data-course='${escapedCourseJSON}'>
                <div class="class-suggestion">
                    <div class="class-suggestion-label">
                        Suggested
                    </div>
                </div>
                <div class="course-card-header"></div>
                <div class="course-top-row">
                    <div class="course-title-block">
                        <h2 id="course-title">${suggestedTitle}</h2>
                    </div>
                    <div class="course-top-badges">
                        <span class="course-top-badge course-type-label">${escapeCourseMarkup(courseTypeLabel)}</span>
                    </div>
                </div>
                <div class="course-info-rows">
                    <h3 id="course-professor">
                        <div class="course-professor-icon"></div>
                        <span class="course-professor-line">
                            <span class="course-professor-name">${escapeCourseMarkup(professorDisplay)}</span>
                            ${newProfessorChip}
                        </span>
                    </h3>
                    <h3 id="course-time"><div class="course-time-icon"></div>${timeDisplay}</h3>
                    ${evaluationChipRow}
                </div>
                <div class="course-footer-row course-footer-row--desktop">
                    <div class="course-footer-left">${mobileTypeChip}${creditsChip}${requiredYearChip}${japaneseLanguageChip}${courseStatusChip}${helperBadge}${gpaSummaryChip}</div>
                </div>
                <div class="course-footer-row course-footer-row--mobile">
                    <div class="course-mobile-meta">
                        <div class="course-mobile-facts">${mobileTypeChip}${creditsChip}${mobileRequiredYearChip}${mobileJapaneseLanguageChip}</div>
                        ${mobilePrimarySignalChip ? `<div class="course-mobile-signal-row">${mobilePrimarySignalChip}</div>` : ''}
                    </div>
                </div>
            </div>
        </div>
        `;
    });

    courseList.innerHTML = coursesHTML;
}

// Function to perform search
function performSearch(searchQuery) {
    // Check if we're on the calendar page
    const isCalendarPage = getCurrentAppPath() === '/timetable' || document.querySelector('calendar-page') !== null;

    if (!isCalendarPage) {
        // Update the global search state (only on courses page)
        currentSearchQuery = searchQuery && searchQuery.trim() ? searchQuery : null;

        // Update the course filter paragraph to show search status
        updateCourseFilterParagraph();

        // Use the unified search and filter function
        return applySearchAndFilters(currentSearchQuery);
    }
    // On calendar page, don't perform search
}

// Mobile navigation positioning fix
function ensureMobileNavigationPositioning() {
    const appNavigation = document.querySelector('app-navigation');
    if (!appNavigation) return;

    if (window.innerWidth <= 1023) {
        const navHeight = Math.ceil(appNavigation.getBoundingClientRect().height || 0);
        if (navHeight > 0) {
            document.documentElement.style.setProperty('--mobile-nav-safe-height', `${navHeight + 8}px`);
        }
    } else {
        document.documentElement.style.removeProperty('--mobile-nav-safe-height');
        document.body.classList.remove('keyboard-visible');
    }
}

// Function to restructure review dates ONLY on mobile
function restructureReviewDatesForMobile() {
    if (window.innerWidth <= 1023) {
        const reviewContainers = document.querySelectorAll('.review-dates');

        reviewContainers.forEach(container => {
            // Skip if already restructured
            if (container.dataset.mobileRestructured === 'true') return;

            const reviewDate = container.querySelector('.review-date');
            const reviewHeader = container.closest('.review-header');
            const reviewActions = reviewHeader ? reviewHeader.querySelector('.review-actions') : null;

            if (reviewDate && reviewHeader) {
                // Create a new wrapper div for mobile
                const mobileWrapper = document.createElement('div');
                mobileWrapper.className = 'review-mobile-date-actions';
                mobileWrapper.dataset.mobileRestructured = 'true';

                // Clone the review-date element
                const clonedReviewDate = reviewDate.cloneNode(true);
                clonedReviewDate.dataset.mobileRestructured = 'true';
                mobileWrapper.appendChild(clonedReviewDate);

                // If review-actions exists, clone and add it to the wrapper
                if (reviewActions) {
                    const clonedReviewActions = reviewActions.cloneNode(true);
                    clonedReviewActions.dataset.mobileRestructured = 'true';
                    mobileWrapper.appendChild(clonedReviewActions);

                    // Remove original review-actions
                    reviewActions.remove();
                }

                // Insert the wrapper after the review-header
                reviewHeader.parentNode.insertBefore(mobileWrapper, reviewHeader.nextSibling);

                // Remove the original review-date from inside the container
                reviewDate.remove();

                // Mark as restructured
                container.dataset.mobileRestructured = 'true';
            }
        });
    } else {
        // Restore original structure on desktop
        const mobileWrappers = document.querySelectorAll('.review-mobile-date-actions[data-mobile-restructured="true"]');

        mobileWrappers.forEach(wrapper => {
            const reviewDate = wrapper.querySelector('.review-date[data-mobile-restructured="true"]');
            const reviewActions = wrapper.querySelector('.review-actions[data-mobile-restructured="true"]');

            // Find the corresponding review item
            const reviewItem = wrapper.closest('.review-item') || wrapper.parentNode.closest('.review-item');
            if (reviewItem) {
                const reviewDatesContainer = reviewItem.querySelector('.review-dates[data-mobile-restructured="true"]');
                const reviewHeader = reviewItem.querySelector('.review-header');

                if (reviewDate && reviewDatesContainer) {
                    // Move the review-date back inside the review-dates container
                    reviewDatesContainer.appendChild(reviewDate);
                    delete reviewDate.dataset.mobileRestructured;
                }

                if (reviewActions && reviewHeader) {
                    // Move the review-actions back inside the review-header
                    reviewHeader.appendChild(reviewActions);
                    delete reviewActions.dataset.mobileRestructured;
                }

                if (reviewDatesContainer) {
                    delete reviewDatesContainer.dataset.mobileRestructured;
                }

                // Remove the mobile wrapper
                wrapper.remove();
            }
        });
    }
}

// Make function globally available
window.restructureReviewDatesForMobile = restructureReviewDatesForMobile;

// Initialize mobile navigation positioning
document.addEventListener('DOMContentLoaded', ensureMobileNavigationPositioning);

// Also run after page load to catch any late-loaded elements
window.addEventListener('load', ensureMobileNavigationPositioning);

// Handle window resize to restructure when switching between mobile/desktop
window.addEventListener('resize', () => {
    restructureReviewDatesForMobile();
    ensureMobileNavigationPositioning();
});

// Export initialization functions for the router
export async function initializeDashboard() {
    console.log('initializeDashboard called');

    // Re-run mobile navigation positioning
    ensureMobileNavigationPositioning();
    restructureReviewDatesForMobile();
    setViewportHeight();

    // Initialize sticky observer for filter buttons
    initStickyObserver();
    setupCourseStatusSyncListeners();

    // Reset the custom select initialization flags so they can be reinitialized (for both mobile and desktop)
    const semesterCustomSelects = document.querySelectorAll('.custom-select[data-target^="semester-select"]');
    semesterCustomSelects.forEach(customSelect => {
        customSelect.dataset.initialized = 'false';
    });

    // Reset semester select listener flags (for both mobile and desktop)
    const semesterSelects = document.querySelectorAll('.semester-select');
    semesterSelects.forEach(select => {
        select.dataset.listenerAttached = 'false';
    });

    // Reset sort button and dropdown listener flags (for both mobile and desktop)
    const sortBtns = document.querySelectorAll('.sort-btn');
    const sortDropdowns = document.querySelectorAll('.sort-dropdown');
    sortBtns.forEach(btn => btn.dataset.listenerAttached = 'false');
    sortDropdowns.forEach(dropdown => dropdown.dataset.listenerAttached = 'false');

    // Reset filter button listener flags (for both mobile and desktop)
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => btn.dataset.listenerAttached = 'false');

    // Reset search button listener flags (for both mobile and desktop)
    const searchBtns = document.querySelectorAll('.search-btn');
    searchBtns.forEach(btn => btn.dataset.listenerAttached = 'false');

    // Reset desktop search pill listener flag
    const searchPillInput = document.getElementById('search-pill-input');
    if (searchPillInput) {
        searchPillInput.dataset.listenerAttached = 'false';
    }
    desktopSearchPillInitialized = false;

    // Populate semester dropdown (this also sets term/year hidden inputs)
    await populateSemesterDropdown();

    // Initialize custom selects (dropdown behavior)
    initializeCustomSelects();

    const pendingHomePrefilter = consumeHomeSlotPrefilter();
    const pendingCoursePageSearchPrefill = !pendingHomePrefilter ? consumeCoursePageSearchPrefill() : null;
    const pendingCoursePagePresetPrefill = (!pendingHomePrefilter && !pendingCoursePageSearchPrefill)
        ? consumeCoursePagePresetPrefill()
        : null;
    if (pendingHomePrefilter) {
        applyHomePrefilterSemester(pendingHomePrefilter);
    } else if (pendingCoursePageSearchPrefill?.term && pendingCoursePageSearchPrefill?.year) {
        applyHomePrefilterSemester(pendingCoursePageSearchPrefill);
    } else {
        resetCoursePageFiltersAndSearch();
    }

    // Set up course list click listener
    setupCourseListClickListener();

    // Set up button event listeners for router-based navigation
    setupDashboardEventListeners();

    // Load courses with current semester values
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");
    console.log('Loading courses with:', { year: yearSelect?.value, term: termSelect?.value });

    if (yearSelect && termSelect && yearSelect.value && termSelect.value) {
        await showCourse(yearSelect.value, termSelect.value);
    }

    if (pendingHomePrefilter) {
        await applyHomePrefilterFilters(pendingHomePrefilter);
    } else if (pendingCoursePageSearchPrefill?.query) {
        applyCoursePageSearchPrefillInputs(pendingCoursePageSearchPrefill.query);
        await performSearch(pendingCoursePageSearchPrefill.query);
    } else if (pendingCoursePagePresetPrefill?.presetId) {
        let shouldApplyPresetPrefill = true;
        if (isYearAwareCoursePreset(pendingCoursePagePresetPrefill.presetId)) {
            const canActivate = await canActivateYearAwarePreset();
            if (!canActivate) {
                console.info('Skipped year-aware preset prefill because profile year is unknown.');
                shouldApplyPresetPrefill = false;
            }
        }
        if (shouldApplyPresetPrefill) {
            setActiveCoursePreset(pendingCoursePagePresetPrefill.presetId, { syncOnly: true });
            await applySearchAndFilters(currentSearchQuery);
        }
    }

    // Update the course filter paragraph to show current state
    updateCourseFilterParagraph();

    console.log('initializeDashboard completed');
}

export function reinitializeMainJS() {
    // Re-run all main initialization
    setViewportHeight();
    ensureMobileNavigationPositioning();
    restructureReviewDatesForMobile();
}

// Export search function for global use
window.performSearch = performSearch;
window.applySearchAndFilters = applySearchAndFilters;
window.initializeDashboard = initializeDashboard;
window.updateCoursesAndFilters = updateCoursesAndFilters;
window.showCourse = showCourse;
window.populateSemesterDropdown = populateSemesterDropdown;
window.initializeCustomSelects = initializeCustomSelects;
window.setupDashboardEventListeners = setupDashboardEventListeners;
window.parseSemesterValue = parseSemesterValue;
window.getAllCourses = getAllCourses;

// Create initializeSearch wrapper function
window.initializeSearch = function () {
    console.log('Initializing search...');
    const searchInput = document.getElementById('search-input');
    const searchAutocomplete = document.getElementById('search-autocomplete');
    const searchPillInput = document.getElementById('search-pill-input');
    const searchPillAutocomplete = document.getElementById('search-pill-autocomplete');

    if (searchInput && searchAutocomplete) {
        setupSearchAutocomplete(searchInput, searchAutocomplete);
    }

    if (searchPillInput && searchPillAutocomplete) {
        setupSearchAutocomplete(searchPillInput, searchPillAutocomplete);
    }

    setupDesktopSearchPill();
    console.log('Search initialized');
};

// Export search state for global access
Object.defineProperty(window, 'currentSearchQuery', {
    get: () => currentSearchQuery,
    set: (value) => { currentSearchQuery = value; },
    enumerable: true,
    configurable: true
});

// Function to update the course filter paragraph with search/filter info
function updateCourseFilterParagraph() {
    updateCourseFilterTriggerCount();
    updateActiveCourseFilterDisplay();

    const courseFilterParagraphs = document.querySelectorAll(".course-filter-paragraph");
    if (courseFilterParagraphs.length === 0) return;

    const totalCount = getTotalVisibleCourseCards();
    const visibleCount = getFilteredVisibleCourseCards();
    const activeFilters = getAppliedCourseFilters();
    const activeSearch = String(currentSearchQuery || '').trim();
    const hasQuery = Boolean(activeSearch);
    const hasFilters = activeFilters.length > 0;

    const visibleLabel = `${visibleCount} course${visibleCount === 1 ? '' : 's'}`;
    let message = `Showing ${visibleLabel}`;

    if (hasQuery || hasFilters) {
        const detailParts = [];
        if (hasQuery) {
            detailParts.push(`"${activeSearch}"`);
        }
        if (hasFilters) {
            const filterLabels = activeFilters
                .map((filter) => String(filter?.label || '').trim().toLowerCase())
                .filter(Boolean);
            const preview = filterLabels.slice(0, 2).join(' + ');
            const overflowCount = Math.max(0, filterLabels.length - 2);
            if (preview) {
                detailParts.push(overflowCount > 0 ? `${preview} +${overflowCount}` : preview);
            }
        }

        if (detailParts.length > 0) {
            message = `${visibleLabel} matching ${detailParts.join(' + ')}`;
        }
    } else if (totalCount > 0 && visibleCount !== totalCount) {
        message = `Showing ${visibleLabel} • ${totalCount} total`;
    }

    courseFilterParagraphs.forEach(paragraph => {
        paragraph.textContent = message;
    });
}

// Export the update function globally
window.updateCourseFilterParagraph = updateCourseFilterParagraph;
