import { supabase } from "../supabase.js";
import * as wanakana from 'wanakana';
import { getCurrentAppPath, stripBase, toAppUrl, withBase } from './path-utils.js';
import { openSemesterMobileSheet } from './semester-mobile-sheet.js';
import { isCourseSaved, readSavedCourses, syncSavedCoursesForUser, toggleSavedCourse } from './saved-courses.js';
import { inferCurrentSemesterValue } from './preferences.js';

// Course type to color mapping
const courseTypeColors = {
    'Introductory Seminars': '#FFFF89',                              // Placeholder - Gold
    'Intermediate Seminars': '#FFFF89',                              // Placeholder - Orange
    'Advanced Seminars and Honors Thesis': '#FFFF89',                // Placeholder - Tomato
    'Academic and Research Skills': '#A0BEE8',                       // Placeholder - Medium Purple
    'Understanding Japan and Kyoto': '#AED3F2',                      // Light Blue (as specified)
    'Japanese Society and Global Culture Concentration': '#C1E0C8',  // Placeholder - Pale Green
    'Japanese Business and the Global Economy Concentration': '#EFDC8F', // Placeholder - Moccasin
    'Japanese Politics and Global Studies Concentration': '#E6A4AE', // Placeholder - Light Pink
    'Other Elective Courses': '#CCCCFF',                             // Placeholder - Light Gray
    'Graduate courses': '#E8CFA2',                                   // Warm Sand
};

// Default color for unknown types
const defaultCourseColor = '#E0E0E0';

const SLOT_PREFILTER_KEY = 'ila_home_slot_prefilter';
const SLOT_PERIOD_TO_TIME = {
    1: '09:00',
    2: '10:45',
    3: '13:10',
    4: '14:55',
    5: '16:40'
};
const SLOT_ALLOWED_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const SLOT_ALLOWED_TYPE_FILTERS = new Set(['Core', 'Foundation', 'Elective', 'Graduate']);
const SLOT_ALLOWED_TIMES = new Set(Object.values(SLOT_PERIOD_TO_TIME));
let courseEvalTooltipElement = null;
let activeCourseEvalTooltipTarget = null;
let courseEvalInfoPopoverElement = null;
let activeCourseEvalInfoTrigger = null;
const MOBILE_ROTATION_BLOCK_CLASS = 'mobile-rotation-blocked';

function isMobileDeviceForOrientationPolicy() {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;

    const userAgent = String(navigator.userAgent || '');
    const looksLikeMobileUA = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(userAgent);
    const isIpadDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

    return Boolean(looksLikeMobileUA || isIpadDesktopUA);
}

function setMobileLandscapeBlockState() {
    if (!document.body) return;

    const shouldBlock = isMobileDeviceForOrientationPolicy()
        && window.matchMedia
        && window.matchMedia('(orientation: landscape)').matches;

    document.body.classList.toggle(MOBILE_ROTATION_BLOCK_CLASS, shouldBlock);
}

async function enforcePortraitOrientationOnMobile() {
    if (!isMobileDeviceForOrientationPolicy()) return;

    let lockSucceeded = false;
    const orientationController = window.screen && window.screen.orientation;
    if (orientationController && typeof orientationController.lock === 'function') {
        try {
            await orientationController.lock('portrait');
            lockSucceeded = true;
        } catch (error) {
            lockSucceeded = false;
        }
    }

    if (!lockSucceeded) {
        setMobileLandscapeBlockState();
    } else if (document.body) {
        document.body.classList.remove(MOBILE_ROTATION_BLOCK_CLASS);
    }
}

function initMobileOrientationPolicy() {
    if (!isMobileDeviceForOrientationPolicy()) return;

    void enforcePortraitOrientationOnMobile();

    window.addEventListener('orientationchange', setMobileLandscapeBlockState);
    window.addEventListener('resize', setMobileLandscapeBlockState);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            void enforcePortraitOrientationOnMobile();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileOrientationPolicy, { once: true });
} else {
    initMobileOrientationPolicy();
}

function normalizeSlotDay(day) {
    const raw = String(day || '').trim();
    if (!raw) return null;

    const dayMap = {
        Mon: 'Mon',
        Monday: 'Mon',
        Tue: 'Tue',
        Tuesday: 'Tue',
        Wed: 'Wed',
        Wednesday: 'Wed',
        Thu: 'Thu',
        Thursday: 'Thu',
        Fri: 'Fri',
        Friday: 'Fri'
    };

    return dayMap[raw] || null;
}

function normalizeSlotPeriod(period) {
    if (period === null || period === undefined || period === '') return null;
    const parsed = parseInt(period, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) return null;
    return parsed;
}

function normalizeSlotTime(timeValue) {
    const raw = String(timeValue || '').trim();
    if (!raw) return null;
    return SLOT_ALLOWED_TIMES.has(raw) ? raw : null;
}

function normalizeSlotTerm(term) {
    const raw = String(term || '').trim();
    if (!raw) return null;

    const lower = raw.toLowerCase();
    if (lower.includes('fall') || raw.includes('秋')) return 'Fall';
    if (lower.includes('spring') || raw.includes('春')) return 'Spring';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function normalizeSlotTypeFilters(typeFilters) {
    if (!Array.isArray(typeFilters)) return null;

    const normalized = typeFilters
        .map((value) => String(value || '').trim())
        .filter((value) => SLOT_ALLOWED_TYPE_FILTERS.has(value));

    if (!normalized.length) return null;
    return Array.from(new Set(normalized));
}

function storeSlotPrefilterPayload(payload) {
    try {
        window.sessionStorage.setItem(SLOT_PREFILTER_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Unable to store slot prefilter payload:', error);
    }
}

function navigateToCoursesForSlot() {
    if (window.router?.navigate) {
        window.router.navigate('/courses');
        return;
    }
    window.location.href = withBase('/courses');
}

export function openCourseSearchForSlot(payload = {}) {
    const day = normalizeSlotDay(payload.day);
    const period = normalizeSlotPeriod(payload.period);
    const normalizedTimeFromPayload = normalizeSlotTime(payload.time);
    const term = normalizeSlotTerm(payload.term);
    const year = parseInt(payload.year, 10);

    const hasProvidedPeriod = payload.period !== null && payload.period !== undefined && payload.period !== '';
    if (!day || !SLOT_ALLOWED_DAYS.has(day) || !term || !Number.isFinite(year)) {
        console.warn('openCourseSearchForSlot: invalid payload', payload);
        navigateToCoursesForSlot();
        return null;
    }

    if (hasProvidedPeriod && !period) {
        console.warn('openCourseSearchForSlot: invalid payload', payload);
        navigateToCoursesForSlot();
        return null;
    }

    const normalized = {
        day,
        term,
        year,
        source: payload.source ? String(payload.source) : 'slot-intent',
        createdAt: Date.now()
    };

    if (period) {
        normalized.period = period;
        normalized.time = SLOT_PERIOD_TO_TIME[period] || null;
    } else if (normalizedTimeFromPayload) {
        normalized.time = normalizedTimeFromPayload;
    }

    const normalizedTypeFilters = normalizeSlotTypeFilters(payload.typeFilters);
    if (normalizedTypeFilters && normalizedTypeFilters.length > 0) {
        normalized.typeFilters = normalizedTypeFilters;
    }

    storeSlotPrefilterPayload(normalized);
    navigateToCoursesForSlot();
    return normalized;
}

// Function to get color based on course type
export function getCourseColorByType(courseType) {
    if (!courseType) return defaultCourseColor;
    return courseTypeColors[courseType] || defaultCourseColor;
}

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
    '鈴木': 'Suzuki', '鈴': 'Suzu',
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

// Synchronous function to get romanized professor name from cache
function getRomanizedProfessorName(name) {
    const normalizedInput = normalizeProfessorNameInput(name);
    return romanizedProfessorCache.get(normalizedInput) || romanizeProfessorName(normalizedInput);
}

export function formatProfessorDisplayName(name) {
    const raw = String(getRomanizedProfessorName(name) || '').trim();
    if (!raw) return 'TBA';

    const upper = raw.toUpperCase();
    if (upper === 'TBA' || upper === 'N/A') return upper;

    const lettersOnly = raw.replace(/[^A-Za-z]/g, '');
    const looksAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
    if (!looksAllCaps) return raw;

    return raw
        .toLowerCase()
        .replace(/\b([a-z])/g, (match) => match.toUpperCase());
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

function getCourseDisplayTitle(course) {
    if (!course || typeof course !== 'object') return '';

    const rawTitle = String(
        course.title
        || course.course_title
        || course.course_name
        || course.name
        || ''
    ).trim();

    const normalizedTitle = normalizeCourseTitle(rawTitle);
    if (normalizedTitle) return normalizedTitle;
    if (rawTitle) return rawTitle;

    return String(course.course_code || '').trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCourseCreditsLabel(credits) {
    if (credits === null || credits === undefined || credits === '') return null;
    const matched = String(credits).match(/(\d+(\.\d+)?)/);
    if (!matched) return String(credits);
    const parsed = parseFloat(matched[1]);
    if (!Number.isFinite(parsed)) return String(credits);
    const formatted = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
    return `${formatted} credit${parsed === 1 ? '' : 's'}`;
}

function formatCourseTermYearLabel(course) {
    const term = normalizeCourseTerm(course?.term);
    const year = normalizeCourseYear(course?.academic_year);
    if (term && year) return `${term} ${year}`;
    if (term) return term;
    if (year) return String(year);
    return 'Current semester';
}

function formatOrdinalYearLabel(yearLevel) {
    const normalized = Number.parseInt(yearLevel, 10);
    if (!Number.isFinite(normalized) || normalized <= 0) return '';
    if (normalized === 1) return '1st';
    if (normalized === 2) return '2nd';
    if (normalized === 3) return '3rd';
    return `${normalized}th`;
}

function isGraduateCourse(courseLike) {
    const typeLabel = String(courseLike?.type || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (typeLabel === 'graduate courses' || typeLabel === 'graduate course' || typeLabel === 'graduate') return true;
    if (typeLabel.includes('graduate')) return true;

    const tags = Array.isArray(courseLike?.evaluation_tags) ? courseLike.evaluation_tags : [];
    return tags.some((tag) => String(tag || '').trim().toLowerCase() === 'graduate_course');
}

function isAdvancedSeminarCourse(courseLike) {
    const normalizedType = String(courseLike?.type || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalizedType === 'advanced seminars and honors thesis') return true;
    if (normalizedType === 'advanced seminar and honors thesis') return true;
    if (normalizedType.includes('advanced seminar')) return true;
    return false;
}

function isGraduateJapaneseTaughtCourse(courseLike) {
    if (!isGraduateCourse(courseLike)) return false;
    return String(courseLike?.class_number || '').trim().toUpperCase() === 'J';
}

function getGraduateRequiredYearOverride(courseLike) {
    if (!isGraduateCourse(courseLike)) return null;
    return 3;
}

function getAdvancedSeminarRequiredYearOverride(courseLike) {
    if (!isAdvancedSeminarCourse(courseLike)) return null;
    return 4;
}

export function parseRequiredYearMinimum(requiredYearValue) {
    const raw = String(requiredYearValue ?? '').trim();
    if (!raw) return null;

    const match = raw.match(/[1-9]/);
    if (!match) return null;

    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatRequiredYearLabel(requiredYearValue, { fallbackLabel = 'Not specified' } = {}) {
    const requiredYearMin = parseRequiredYearMinimum(requiredYearValue);
    if (!requiredYearMin) return fallbackLabel;
    const ordinal = formatOrdinalYearLabel(requiredYearMin);
    return ordinal ? `${ordinal} year+` : fallbackLabel;
}

export function parseProfileCurrentYearLevel(profileRow) {
    if (!profileRow || typeof profileRow !== 'object') return null;
    if (profileRow?.year_opt_out === true) return null;

    const candidateValues = [
        profileRow?.current_year,
        profileRow?.year_level,
        profileRow?.year,
        profileRow?.program_year
    ];

    for (const candidate of candidateValues) {
        if (candidate === null || candidate === undefined || candidate === '') continue;

        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            return Math.trunc(candidate);
        }

        const raw = String(candidate).trim();
        if (!raw) continue;

        const lowered = raw.toLowerCase();
        if (lowered.includes('prefer not to answer')) continue;

        const match = lowered.match(/[1-9]/);
        if (!match) continue;

        const parsed = Number.parseInt(match[0], 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return null;
}

export function getCourseRequiredYearMeta(courseLike, userYearLevel = null) {
    const requiredYearRaw = courseLike?.required_year ?? courseLike?.requiredYear ?? null;
    const overrideCandidates = [
        getGraduateRequiredYearOverride(courseLike),
        getAdvancedSeminarRequiredYearOverride(courseLike)
    ].filter((value) => Number.isFinite(value) && value > 0);
    const requiredYearOverride = overrideCandidates.length > 0
        ? Math.max(...overrideCandidates)
        : null;
    const parsedRequiredYear = parseRequiredYearMinimum(requiredYearRaw);
    const requiredYearMin = Number.isFinite(requiredYearOverride) && requiredYearOverride > 0
        ? requiredYearOverride
        : parsedRequiredYear;
    const hasRequiredYear = Number.isFinite(requiredYearMin) && requiredYearMin > 0;
    const requiredYearLabelValue = hasRequiredYear
        ? `${formatOrdinalYearLabel(requiredYearMin)} year+`
        : '';
    const requiredYearLabel = hasRequiredYear
        ? requiredYearLabelValue
        : 'Open to all years';

    const normalizedUserYear = Number.isFinite(Number(userYearLevel)) && Number(userYearLevel) > 0
        ? Math.trunc(Number(userYearLevel))
        : null;
    const hasKnownUserYear = Number.isFinite(normalizedUserYear);
    const eligibilityKnown = hasRequiredYear && hasKnownUserYear;
    const meetsRequirement = !eligibilityKnown || normalizedUserYear >= requiredYearMin;
    const isBelowRequirement = eligibilityKnown && normalizedUserYear < requiredYearMin;
    const userYearLabel = hasKnownUserYear
        ? `${formatOrdinalYearLabel(normalizedUserYear)} year`
        : '';

    return {
        requiredYearRaw,
        requiredYearMin: hasRequiredYear ? requiredYearMin : null,
        hasRequiredYear,
        requiredYearLabel,
        requiredYearBadgeLabel: hasRequiredYear ? `Req: ${requiredYearLabel}` : 'Open to all years',
        requiredYearBucketId: hasRequiredYear ? `required-year-${requiredYearMin}` : '',
        userYearLevel: hasKnownUserYear ? normalizedUserYear : null,
        userYearLabel,
        hasKnownUserYear,
        eligibilityKnown,
        meetsRequirement,
        isBelowRequirement,
        isEligibleForRegistration: !hasRequiredYear || !hasKnownUserYear || meetsRequirement
    };
}

function formatCourseTimeCompactLabel(rawTimeSlot) {
    const raw = String(rawTimeSlot || '').trim();
    if (!raw) return 'TBA';
    if (/(集中講義|集中)/.test(raw)) return 'Intensive';
    const jp = raw.match(/([月火水木金土日])(?:曜日)?\s*([1-5])(?:講時)?/);
    if (jp) {
        const dayMap = { 月: 'Mon', 火: 'Tue', 水: 'Wed', 木: 'Thu', 金: 'Fri', 土: 'Sat', 日: 'Sun' };
        const timeMap = {
            '1': '09:00–10:30',
            '2': '10:45–12:15',
            '3': '13:10–14:40',
            '4': '14:55–16:25',
            '5': '16:40–18:10'
        };
        const day = dayMap[jp[1]] || jp[1];
        return `${day} P${jp[2]} · ${timeMap[jp[2]] || ''}`.trim();
    }

    const en = raw.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/i);
    if (en) {
        const day = en[1].charAt(0).toUpperCase() + en[1].slice(1).toLowerCase();
        const start = en[2];
        const periodByStart = { '09:00': '1', '10:45': '2', '13:10': '3', '14:55': '4', '16:40': '5' };
        const period = periodByStart[start];
        return period ? `${day} P${period} · ${start}–${en[3]}` : `${day} ${start}–${en[3]}`;
    }

    return raw.replace(/\s*-\s*/g, '–');
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

function normalizeCourseEvaluationComponents(course) {
    const parsed = parseEvaluationCriteriaJson(course?.evaluation_criteria_json);
    const components = Array.isArray(parsed?.components) ? parsed.components : [];
    const graduateCourse = isGraduateCourse(course);
    return components
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

    const sorted = components
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

    sorted.forEach(({ component }) => {
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

    keywordTags.forEach(([keyword, tag]) => {
        if (keywordText.includes(keyword)) {
            addTag(tag);
        }
    });

    return tags.slice(0, maxTags);
}

function formatEvaluationWeight(weight) {
    if (!Number.isFinite(weight)) return '';
    if (Number.isInteger(weight)) return `${weight}%`;
    return `${weight.toFixed(1).replace(/\.0$/, '')}%`;
}

function getCourseEvaluationMeta(course) {
    const maxStoredTags = 12;
    const graduateCourse = isGraduateCourse(course);
    const dbTags = Array.isArray(course?.evaluation_tags)
        ? course.evaluation_tags
            .filter((tag) => String(tag || '').trim().toLowerCase() !== 'graduate_course')
            .map((tag) => graduateCourse ? translateGraduateEvaluationTag(tag) : tag)
            .map((tag) => normalizeEvaluationLabelPrefix(tag))
            .filter(Boolean)
        : [];

    const components = normalizeCourseEvaluationComponents(course);
    const tags = dbTags.length > 0
        ? Array.from(new Set(dbTags)).slice(0, maxStoredTags)
        : deriveEvaluationTagsFromComponents(components, maxStoredTags);

    const normalizedComponents = components.map((component) => {
        const displayLabel = normalizeEvaluationLabelPrefix(component.name) || canonicalEvaluationTagFromName(component.name);
        return {
            ...component,
            displayLabel
        };
    });

    const breakdown = normalizedComponents
        .map((component) => {
            const label = component.displayLabel || canonicalEvaluationTagFromName(component.name) || component.name;
            const weight = formatEvaluationWeight(component.weight);
            return weight ? `${label} ${weight}` : label;
        })
        .join(' • ');

    return {
        tags,
        breakdown,
        components: normalizedComponents
    };
}

function extractGraduateRequirementsText(courseLike) {
    const raw = String(courseLike?.evaluation_criteria_raw || '').trim();
    if (!raw) return '';

    const lines = raw.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean);
    const requirementLine = lines.find(
        (line) => /^registration requirements:/i.test(line) || /^graduate requirements:/i.test(line)
    );
    if (!requirementLine) return '';

    const normalized = requirementLine.replace(/\s+/g, ' ').trim();
    const normalizedPrefix = normalized.replace(/^graduate requirements:/i, 'Registration requirements:');
    return normalizedPrefix.replace(/[.。]\s*$/g, '');
}

function extractGraduateRegistrationWindowText(courseLike) {
    const fromColumn = String(courseLike?.graduate_registration_window || '').replace(/\s+/g, ' ').trim();
    if (fromColumn) return fromColumn;

    const raw = String(courseLike?.evaluation_criteria_raw || '').trim();
    if (!raw) return '';

    const lines = raw.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean);
    const registrationLine = lines.find((line) => /^registration window:/i.test(line));
    if (!registrationLine) return '';

    return registrationLine.replace(/^registration window:/i, '').replace(/\s+/g, ' ').trim();
}

function extractGraduateRegistrationMethodText(courseLike) {
    const normalizeMethodText = (value) => {
        const normalizedMethod = String(value || '')
            .replace(/^how to register:/i, '')
            .replace(/^how to apply:/i, '')
            .replace(/\bforms\b/gi, 'form')
            .replace(/[.。]\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        return normalizedMethod || '';
    };

    const fromColumn = String(courseLike?.graduate_registration_method || '').replace(/\s+/g, ' ').trim();
    if (fromColumn) return normalizeMethodText(fromColumn);

    const raw = String(courseLike?.evaluation_criteria_raw || '').trim();
    if (!raw) return '';

    const lines = raw.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean);
    const methodLine = lines.find((line) => /^how to register:/i.test(line) || /^how to apply:/i.test(line));
    if (!methodLine) return '';

    return normalizeMethodText(methodLine);
}

function extractGraduateRegistrationUrl(courseLike) {
    const fromColumn = String(courseLike?.graduate_registration_url || '').trim();
    const safeFromColumn = /^https?:\/\//i.test(fromColumn) ? fromColumn : '';
    if (safeFromColumn) return safeFromColumn;

    const raw = String(courseLike?.evaluation_criteria_raw || '').trim();
    if (!raw) return '';

    const line = raw
        .split(/\r?\n/)
        .map((value) => String(value || '').trim())
        .find((value) => /^registration form:/i.test(value));

    const urlMatch = String(line || '').match(/https?:\/\/[^\s)]+/i);
    return urlMatch ? urlMatch[0].trim() : '';
}

function formatConflictPreviewTimeLabel(rawTimeSlot, options = {}) {
    const expanded = !!options.expanded;
    const raw = String(rawTimeSlot || '').trim();
    if (!raw) return 'TBA';

    const dayMapJPToAbbr = { 月: 'Mon', 火: 'Tue', 水: 'Wed', 木: 'Thu', 金: 'Fri', 土: 'Sat', 日: 'Sun' };
    const dayMapAbbrToFull = {
        Mon: 'Monday',
        Tue: 'Tuesday',
        Wed: 'Wednesday',
        Thu: 'Thursday',
        Fri: 'Friday',
        Sat: 'Saturday',
        Sun: 'Sunday'
    };
    const dayMapFullToAbbr = {
        Monday: 'Mon',
        Tuesday: 'Tue',
        Wednesday: 'Wed',
        Thursday: 'Thu',
        Friday: 'Fri',
        Saturday: 'Sat',
        Sunday: 'Sun'
    };
    const periodOrdinals = {
        '1': '1st',
        '2': '2nd',
        '3': '3rd',
        '4': '4th',
        '5': '5th'
    };
    const periodByStart = { '09:00': '1', '10:45': '2', '13:10': '3', '14:55': '4', '16:40': '5' };
    const timeMap = {
        '1': '09:00 - 10:30',
        '2': '10:45 - 12:15',
        '3': '13:10 - 14:40',
        '4': '14:55 - 16:25',
        '5': '16:40 - 18:10'
    };

    const buildLabel = (dayAbbr, period, timeRange) => {
        if (expanded) {
            const fullDay = dayMapAbbrToFull[dayAbbr] || dayAbbr;
            const periodOrdinal = period ? periodOrdinals[period] : '';
            if (periodOrdinal && timeRange) return `${fullDay} ${periodOrdinal} period · ${timeRange}`;
            if (periodOrdinal) return `${fullDay} ${periodOrdinal} period`;
            if (timeRange) return `${fullDay} · ${timeRange}`;
            return fullDay;
        }

        if (period && timeRange) return `${dayAbbr} P${period} · ${timeRange}`;
        if (period) return `${dayAbbr} P${period}`;
        if (timeRange) return `${dayAbbr} ${timeRange}`;
        return dayAbbr;
    };

    const jpMatch = raw.match(/([月火水木金土日])(?:曜日)?\s*([1-5])(?:講時)?/);
    if (jpMatch) {
        const dayAbbr = dayMapJPToAbbr[jpMatch[1]] || jpMatch[1];
        const period = jpMatch[2];
        return buildLabel(dayAbbr, period, timeMap[period] || '');
    }

    const enFullMatch = raw.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/i);
    if (enFullMatch) {
        const normalizedDay = enFullMatch[1].charAt(0).toUpperCase() + enFullMatch[1].slice(1).toLowerCase();
        const dayAbbr = dayMapFullToAbbr[normalizedDay] || normalizedDay;
        const start = enFullMatch[2];
        const end = enFullMatch[3];
        return buildLabel(dayAbbr, periodByStart[start], `${start} - ${end}`);
    }

    const enAbbrMatch = raw.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/i);
    if (enAbbrMatch) {
        const dayAbbr = enAbbrMatch[1].charAt(0).toUpperCase() + enAbbrMatch[1].slice(1).toLowerCase();
        const start = enAbbrMatch[2];
        const end = enAbbrMatch[3];
        return buildLabel(dayAbbr, periodByStart[start], `${start} - ${end}`);
    }

    return raw.replace(/\s*[–—-]\s*/g, ' - ');
}

const COURSE_INFO_ACTIVE_TAB_KEY = 'ila_course_info_active_tab_v1';
const COURSE_INFO_TAB_VALUES = new Set(['overview', 'assignments', 'reviews']);
const COURSE_INFO_MOBILE_BREAKPOINT = 1023;
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let activeCourseInfoTabController = null;
let courseInfoOpenRequestVersion = 0;
let courseInfoBodyLockSnapshot = null;
let courseInfoBodyLockScrollY = 0;
let dsModalBodyLockDepth = 0;
let dsModalBodyLockSnapshot = null;
let dsModalBodyLockScrollY = 0;

function isCourseInfoMobileViewport() {
    return window.innerWidth <= COURSE_INFO_MOBILE_BREAKPOINT;
}

function normalizeCourseInfoTab(tab) {
    const normalized = String(tab || '').trim().toLowerCase();
    return COURSE_INFO_TAB_VALUES.has(normalized) ? normalized : 'overview';
}

function readStoredCourseInfoTab() {
    try {
        return normalizeCourseInfoTab(window.sessionStorage.getItem(COURSE_INFO_ACTIVE_TAB_KEY));
    } catch (_) {
        return 'overview';
    }
}

function writeStoredCourseInfoTab(tab) {
    try {
        window.sessionStorage.setItem(COURSE_INFO_ACTIVE_TAB_KEY, normalizeCourseInfoTab(tab));
    } catch (_) { }
}

function cleanupActiveCourseInfoTabController() {
    if (activeCourseInfoTabController && typeof activeCourseInfoTabController.cleanup === 'function') {
        activeCourseInfoTabController.cleanup();
    }
    activeCourseInfoTabController = null;
}

function setActiveCourseInfoTab(tab, options = {}) {
    const normalized = normalizeCourseInfoTab(tab);
    if (activeCourseInfoTabController && typeof activeCourseInfoTabController.setActiveTab === 'function') {
        activeCourseInfoTabController.setActiveTab(normalized, options);
        return;
    }
    if (options.persist !== false) {
        writeStoredCourseInfoTab(normalized);
    }
}

function ensureCourseInfoReviewsTabActive(options = {}) {
    setActiveCourseInfoTab('reviews', { persist: true, scrollTop: options.scrollTop === true });
}

function getVisibleCourseInfoCourseContext() {
    const classInfo = document.getElementById('class-info');
    if (!classInfo || !classInfo.classList.contains('show')) {
        return { classInfo: null, course: null };
    }
    return {
        classInfo,
        course: classInfo._activeCourseInfoCourse || null
    };
}

async function refreshVisibleCourseInfoReviewsAfterMutation({ courseCode = '' } = {}) {
    const { classInfo, course } = getVisibleCourseInfoCourseContext();
    if (!classInfo || !course) return false;

    const activeCourseCode = String(course?.course_code || '').trim();
    const normalizedTargetCode = String(courseCode || '').trim();

    if (normalizedTargetCode && activeCourseCode && normalizedTargetCode !== activeCourseCode) return false;

    const previousSheetState = String(classInfo.dataset.sheetState || '').trim();
    await openCourseInfoMenu(course, false, { initialTab: 'reviews' });

    const nextClassInfo = document.getElementById('class-info');
    const nextController = nextClassInfo?._courseInfoSheetController;
    if (
        nextController &&
        (previousSheetState === 'full' || previousSheetState === 'collapsed')
    ) {
        nextController.snapTo(previousSheetState, { animate: false });
    }

    ensureCourseInfoReviewsTabActive({ scrollTop: true });
    return true;
}

async function finalizeReviewMutationSuccess({ message, courseCode = '' } = {}) {
    if (typeof window.closeReviewModal === 'function') {
        window.closeReviewModal();
    } else {
        document.querySelector('.review-modal, .review-modal-host')?.remove();
    }

    await new Promise((resolve) => window.setTimeout(resolve, 240));
    await refreshVisibleCourseInfoReviewsAfterMutation({ courseCode });
    showGlobalToast(message || 'Saved.');
}

function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hasAttribute('hidden')) return false;
        if (element.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
    });
}

function createFocusTrap(container, { onEscape = null } = {}) {
    if (!container) return () => { };

    const handleKeydown = (event) => {
        const visibleDialogs = Array.from(document.querySelectorAll('.modal:not(.hidden) .modal-dialog'));
        const topDialog = visibleDialogs.length ? visibleDialogs[visibleDialogs.length - 1] : null;
        if (topDialog && !container.contains(topDialog)) {
            return;
        }

        if (event.key === 'Escape') {
            if (typeof onEscape === 'function') {
                event.preventDefault();
                onEscape();
            }
            return;
        }

        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(container);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;

        if (event.shiftKey) {
            if (activeElement === first || !container.contains(activeElement)) {
                event.preventDefault();
                last.focus();
            }
            return;
        }

        if (activeElement === last || !container.contains(activeElement)) {
            event.preventDefault();
            first.focus();
        }
    };

    document.addEventListener('keydown', handleKeydown, true);
    return () => {
        document.removeEventListener('keydown', handleKeydown, true);
    };
}

function lockBodyScrollForCourseInfoSheet() {
    if (courseInfoBodyLockSnapshot && !document.body.classList.contains('modal-open')) {
        courseInfoBodyLockSnapshot = null;
        courseInfoBodyLockScrollY = 0;
    }
    if (courseInfoBodyLockSnapshot) return;

    const body = document.body;
    courseInfoBodyLockScrollY = window.scrollY || window.pageYOffset || 0;
    courseInfoBodyLockSnapshot = {
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
        hadModalOpen: body.classList.contains('modal-open')
    };

    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${courseInfoBodyLockScrollY}px`;
    body.style.width = '100%';
    body.classList.add('modal-open');
}

function unlockBodyScrollForCourseInfoSheet() {
    if (!courseInfoBodyLockSnapshot) {
        return;
    }

    const body = document.body;
    const previousSnapshot = courseInfoBodyLockSnapshot;
    const previousScrollY = courseInfoBodyLockScrollY;

    if (previousSnapshot) {
        body.style.overflow = previousSnapshot.overflow;
        body.style.position = previousSnapshot.position;
        body.style.top = previousSnapshot.top;
        body.style.width = previousSnapshot.width;
    } else {
        body.style.overflow = '';
        body.style.position = '';
        body.style.top = '';
        body.style.width = '';
    }

    if (previousSnapshot.hadModalOpen) {
        body.classList.add('modal-open');
    } else {
        body.classList.remove('modal-open');
    }
    courseInfoBodyLockSnapshot = null;
    courseInfoBodyLockScrollY = 0;

    if (previousSnapshot) {
        window.scrollTo(0, previousScrollY);
    }
}

function lockBodyScrollForDsModal() {
    const body = document.body;
    dsModalBodyLockDepth += 1;

    if (dsModalBodyLockDepth === 1) {
        const bodyAlreadyLocked = courseInfoBodyLockSnapshot || body.style.position === 'fixed';
        if (!bodyAlreadyLocked) {
            dsModalBodyLockScrollY = window.scrollY || window.pageYOffset || 0;
            dsModalBodyLockSnapshot = {
                overflow: body.style.overflow,
                position: body.style.position,
                top: body.style.top,
                width: body.style.width
            };
            body.style.overflow = 'hidden';
            body.style.position = 'fixed';
            body.style.top = `-${dsModalBodyLockScrollY}px`;
            body.style.width = '100%';
        } else {
            dsModalBodyLockSnapshot = null;
            dsModalBodyLockScrollY = 0;
        }
    }

    body.classList.add('modal-open');
}

function unlockBodyScrollForDsModal() {
    if (dsModalBodyLockDepth <= 0) return;

    dsModalBodyLockDepth -= 1;
    if (dsModalBodyLockDepth > 0) return;

    const body = document.body;
    if (dsModalBodyLockSnapshot) {
        const previousSnapshot = dsModalBodyLockSnapshot;
        const previousScrollY = dsModalBodyLockScrollY;
        body.style.overflow = previousSnapshot.overflow;
        body.style.position = previousSnapshot.position;
        body.style.top = previousSnapshot.top;
        body.style.width = previousSnapshot.width;
        window.scrollTo(0, previousScrollY);
    }

    dsModalBodyLockSnapshot = null;
    dsModalBodyLockScrollY = 0;
    syncModalOpenClass();
}

function syncModalOpenClass() {
    const hasOpenModal = Boolean(document.querySelector(
        '.profile-modal.profile-modal--swipe.show,' +
        ' .semester-mobile-sheet.show,' +
        ' .search-modal.show,' +
        ' .filter-popup.show,' +
        ' .class-info:not(.course-fullscreen).show,' +
        ' .modal:not(.hidden),' +
        ' .conflict-container:not(.hidden)'
    ));

    document.body.classList.toggle('modal-open', hasOpenModal);
}

export function showGlobalToast(message, durationMs = 2200) {
    if (!message) return;

    const existingToast = document.getElementById('link-copied-notification');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'link-copied-notification';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, durationMs);
}

function emitCourseStatusUpdated(detail = {}) {
    document.dispatchEvent(new CustomEvent('course-status-updated', {
        detail: {
            ...detail,
            updatedAt: Date.now()
        }
    }));
}

async function copyTextToClipboard(value) {
    const text = String(value || '').trim();
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) { }
    }

    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
    } catch (_) {
        return false;
    }
}

function renderCourseActionPill(label, options = {}) {
    const cls = options.variant === 'primary'
        ? 'btn-primary'
        : options.variant === 'destructive'
            ? 'btn-destructive'
            : 'btn-secondary';
    const attrs = [
        `type="${options.type || 'button'}"`,
        `class="${cls}${options.className ? ` ${options.className}` : ''}"`,
        options.id ? `id="${escapeHtml(options.id)}"` : '',
        options.href ? `data-href="${escapeHtml(options.href)}"` : '',
        options.action ? `data-action="${escapeHtml(options.action)}"` : '',
        options.disabled ? 'disabled' : ''
    ].filter(Boolean).join(' ');
    const icon = options.icon ? `<span class="pill-icon ${escapeHtml(options.icon)}" aria-hidden="true"></span>` : '';
    return `<button ${attrs}>${icon}<span>${escapeHtml(label)}</span></button>`;
}

function canShowCourseEvaluationHoverTooltip() {
    return window.innerWidth >= 1024
        && window.matchMedia
        && window.matchMedia('(hover: hover)').matches;
}

function ensureCourseEvaluationTooltip() {
    if (courseEvalTooltipElement && document.body.contains(courseEvalTooltipElement)) {
        return courseEvalTooltipElement;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'calendar-course-tooltip course-chip-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    courseEvalTooltipElement = tooltip;
    return tooltip;
}

function positionCourseEvaluationTooltip(clientX, clientY) {
    if (!courseEvalTooltipElement) return;
    const offset = 14;
    const maxX = window.innerWidth - courseEvalTooltipElement.offsetWidth - 8;
    const maxY = window.innerHeight - courseEvalTooltipElement.offsetHeight - 8;
    const left = Math.max(8, Math.min(clientX + offset, maxX));
    const top = Math.max(8, Math.min(clientY + offset, maxY));
    courseEvalTooltipElement.style.left = `${left}px`;
    courseEvalTooltipElement.style.top = `${top}px`;
}

function hideCourseEvaluationTooltip() {
    activeCourseEvalTooltipTarget = null;
    if (!courseEvalTooltipElement) return;
    courseEvalTooltipElement.classList.remove('is-visible');
}

function showCourseEvaluationTooltip(target, event) {
    if (!canShowCourseEvaluationHoverTooltip()) return;
    const breakdown = String(target?.dataset?.courseEvalBreakdown || '').trim();
    if (!breakdown) return;
    const tooltip = ensureCourseEvaluationTooltip();
    if (!tooltip) return;

    tooltip.innerHTML = `
        <div class="calendar-course-tooltip-title">Evaluation Criteria</div>
        <div class="calendar-course-tooltip-detail">${escapeHtml(breakdown)}</div>
    `;
    tooltip.classList.add('is-visible');
    positionCourseEvaluationTooltip(event.clientX, event.clientY);
    activeCourseEvalTooltipTarget = target;
}

function ensureCourseEvaluationInfoPopover() {
    if (courseEvalInfoPopoverElement && document.body.contains(courseEvalInfoPopoverElement)) {
        return courseEvalInfoPopoverElement;
    }

    const popover = document.createElement('div');
    popover.className = 'course-eval-popover';
    popover.setAttribute('role', 'dialog');
    popover.hidden = true;
    document.body.appendChild(popover);
    courseEvalInfoPopoverElement = popover;
    return popover;
}

function hideCourseEvaluationInfoPopover() {
    activeCourseEvalInfoTrigger = null;
    if (!courseEvalInfoPopoverElement) return;
    courseEvalInfoPopoverElement.hidden = true;
    courseEvalInfoPopoverElement.classList.remove('is-visible');
}

function positionCourseEvaluationInfoPopover(trigger) {
    if (!courseEvalInfoPopoverElement || !trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const width = courseEvalInfoPopoverElement.offsetWidth;
    const padding = 10;
    const left = Math.max(
        padding,
        Math.min(triggerRect.left + (triggerRect.width / 2) - (width / 2), window.innerWidth - width - padding)
    );
    const top = Math.max(padding, triggerRect.bottom + 10);
    courseEvalInfoPopoverElement.style.left = `${left}px`;
    courseEvalInfoPopoverElement.style.top = `${top}px`;
}

function toggleCourseEvaluationInfoPopover(trigger) {
    const breakdown = String(trigger?.dataset?.courseEvalBreakdown || '').trim();
    if (!breakdown) return;
    const popover = ensureCourseEvaluationInfoPopover();
    if (!popover) return;

    if (activeCourseEvalInfoTrigger === trigger && !popover.hidden) {
        hideCourseEvaluationInfoPopover();
        return;
    }

    popover.innerHTML = `
        <p class="course-eval-popover-title">Evaluation Criteria</p>
        <p class="course-eval-popover-detail">${escapeHtml(breakdown)}</p>
    `;
    popover.hidden = false;
    popover.classList.add('is-visible');
    activeCourseEvalInfoTrigger = trigger;
    positionCourseEvaluationInfoPopover(trigger);
}

function bindCourseEvaluationOverviewInteractions(classContent, classInfo) {
    if (!classContent || !classInfo) return () => { };

    hideCourseEvaluationTooltip();
    hideCourseEvaluationInfoPopover();

    const pointerOverHandler = (event) => {
        const target = event.target.closest('[data-course-eval-tooltip]');
        if (!target || !classContent.contains(target)) return;
        showCourseEvaluationTooltip(target, event);
    };

    const pointerMoveHandler = (event) => {
        if (!activeCourseEvalTooltipTarget) return;
        if (event.target.closest('[data-course-eval-tooltip]') !== activeCourseEvalTooltipTarget) return;
        positionCourseEvaluationTooltip(event.clientX, event.clientY);
    };

    const pointerOutHandler = (event) => {
        if (!activeCourseEvalTooltipTarget) return;
        const leaving = event.target.closest('[data-course-eval-tooltip]');
        if (!leaving || leaving !== activeCourseEvalTooltipTarget) return;
        if (event.relatedTarget && leaving.contains(event.relatedTarget)) return;
        hideCourseEvaluationTooltip();
    };

    const clickHandler = (event) => {
        const trigger = event.target.closest('[data-action="course-eval-more"]');
        if (trigger && classContent.contains(trigger)) {
            event.preventDefault();
            event.stopPropagation();
            toggleCourseEvaluationInfoPopover(trigger);
            return;
        }

        const clickedInsidePopover = event.target.closest('.course-eval-popover');
        if (!clickedInsidePopover) {
            hideCourseEvaluationInfoPopover();
        }
    };

    const keydownHandler = (event) => {
        if (event.key === 'Escape') {
            hideCourseEvaluationInfoPopover();
        }
    };

    const resizeHandler = () => {
        hideCourseEvaluationTooltip();
        hideCourseEvaluationInfoPopover();
    };

    classContent.addEventListener('pointerover', pointerOverHandler);
    classContent.addEventListener('pointermove', pointerMoveHandler);
    classContent.addEventListener('pointerout', pointerOutHandler);
    classInfo.addEventListener('click', clickHandler);
    document.addEventListener('keydown', keydownHandler);
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, true);

    return () => {
        classContent.removeEventListener('pointerover', pointerOverHandler);
        classContent.removeEventListener('pointermove', pointerMoveHandler);
        classContent.removeEventListener('pointerout', pointerOutHandler);
        classInfo.removeEventListener('click', clickHandler);
        document.removeEventListener('keydown', keydownHandler);
        window.removeEventListener('resize', resizeHandler);
        window.removeEventListener('scroll', resizeHandler, true);
        hideCourseEvaluationTooltip();
        hideCourseEvaluationInfoPopover();
    };
}

function bindAssessmentBreakdownAccordionAnimations(classContent) {
    if (!classContent) return () => { };

    const accordions = Array.from(classContent.querySelectorAll('.course-assessment-breakdown-accordion'));
    if (!accordions.length) return () => { };

    const reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    const prefersReducedMotion = () => Boolean(reduceMotionQuery?.matches);
    const cleanupFns = [];

    accordions.forEach((accordion) => {
        const summary = accordion.querySelector('.course-assessment-breakdown-summary');
        const panel = accordion.querySelector('.course-assessment-breakdown-panel');
        if (!summary || !panel) return;
        const warningContainer = accordion.closest('.course-info-inline-warning--expandable');

        accordion.open = false;
        accordion.classList.remove('is-expanded');
        panel.style.height = '0px';

        let isAnimating = false;
        let transitionHandler = null;

        const clearTransitionHandler = () => {
            if (!transitionHandler) return;
            panel.removeEventListener('transitionend', transitionHandler);
            transitionHandler = null;
        };

        const openAccordion = () => {
            if (accordion.classList.contains('is-expanded') && !isAnimating) return;

            clearTransitionHandler();

            if (prefersReducedMotion()) {
                accordion.open = true;
                accordion.classList.add('is-expanded');
                panel.style.height = 'auto';
                isAnimating = false;
                return;
            }

            isAnimating = true;
            const startHeight = panel.getBoundingClientRect().height;
            accordion.open = true;
            accordion.classList.add('is-expanded');
            panel.style.height = `${startHeight}px`;
            void panel.offsetHeight;
            const targetHeight = panel.scrollHeight;
            panel.style.height = `${targetHeight}px`;

            transitionHandler = (event) => {
                if (event.propertyName !== 'height') return;
                clearTransitionHandler();
                isAnimating = false;
                panel.style.height = 'auto';
            };
            panel.addEventListener('transitionend', transitionHandler);
        };

        const closeAccordion = () => {
            if (!accordion.classList.contains('is-expanded') && !isAnimating) return;

            clearTransitionHandler();

            if (prefersReducedMotion()) {
                accordion.classList.remove('is-expanded');
                accordion.open = false;
                panel.style.height = '0px';
                isAnimating = false;
                return;
            }

            isAnimating = true;
            const startHeight = panel.getBoundingClientRect().height || panel.scrollHeight;
            panel.style.height = `${startHeight}px`;
            void panel.offsetHeight;
            accordion.classList.remove('is-expanded');
            panel.style.height = '0px';

            transitionHandler = (event) => {
                if (event.propertyName !== 'height') return;
                clearTransitionHandler();
                accordion.open = false;
                isAnimating = false;
                panel.style.height = '0px';
            };
            panel.addEventListener('transitionend', transitionHandler);
        };

        const summaryClickHandler = (event) => {
            event.preventDefault();
            if (isAnimating) return;
            if (accordion.classList.contains('is-expanded')) closeAccordion();
            else openAccordion();
        };

        summary.addEventListener('click', summaryClickHandler);

        const warningContainerClickHandler = (event) => {
            if (!warningContainer) return;
            if (isAnimating) return;
            if (accordion.classList.contains('is-expanded')) return;

            const target = event.target;
            if (!(target instanceof Element)) return;
            if (summary.contains(target)) return;
            if (target.closest('a, button, input, textarea, select, label')) return;

            openAccordion();
        };

        if (warningContainer) {
            warningContainer.addEventListener('click', warningContainerClickHandler);
        }

        cleanupFns.push(() => {
            clearTransitionHandler();
            summary.removeEventListener('click', summaryClickHandler);
            if (warningContainer) {
                warningContainer.removeEventListener('click', warningContainerClickHandler);
            }
            panel.style.height = accordion.classList.contains('is-expanded') ? 'auto' : '0px';
        });
    });

    return () => {
        cleanupFns.forEach((cleanupFn) => cleanupFn());
    };
}

function CourseInfoContent(model, options = {}) {
    const isMobile = options.isMobile === true;
    const badges = Array.isArray(model?.badges) ? model.badges : [];
    const detailRows = Array.isArray(model?.detailRows) ? model.detailRows : [];
    const heroActions = Array.isArray(model?.heroActions) ? model.heroActions : [];
    const inlineWarnings = Array.isArray(model?.inlineWarnings) ? model.inlineWarnings : [];
    const inlineWarningsMarkup = inlineWarnings
        .map((warning) => {
            const kind = String(warning?.kind || 'warning').trim().toLowerCase();
            const normalizedKind = kind === 'error' ? 'error' : 'warning';
            const expandable = warning?.expandable === true;

            if (expandable) {
                const title = String(warning?.title || 'Registration details').trim();
                const items = Array.isArray(warning?.items)
                    ? warning.items.map((item) => String(item || '').trim()).filter(Boolean)
                    : [];
                const linkHrefRaw = String(warning?.link?.href || '').trim();
                const linkLabel = String(warning?.link?.label || 'Open registration form').trim() || 'Open registration form';
                const safeLinkHref = /^https?:\/\//i.test(linkHrefRaw) ? linkHrefRaw : '';

                if (!title && items.length === 0 && !safeLinkHref) return '';

                const itemMarkup = items
                    .map((item) => `<div class="course-info-warning-disclosure-item">${escapeHtml(item)}</div>`)
                    .join('');
                const linkMarkup = safeLinkHref
                    ? `<div class="course-info-warning-disclosure-link"><span>Registration form:</span> <a href="${escapeHtml(safeLinkHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a></div>`
                    : '';

                return `
                    <div class="course-info-inline-warning course-info-inline-warning--${normalizedKind} course-info-inline-warning--expandable">
                        <details class="course-info-warning-disclosure course-assessment-breakdown-accordion">
                            <summary class="course-info-warning-disclosure-summary course-assessment-breakdown-summary">
                                <div class="course-assessment-breakdown-main">
                                    <span class="course-info-warning-disclosure-title course-assessment-breakdown-name">${escapeHtml(title)}</span>
                                </div>
                                <span class="course-info-warning-disclosure-chevron course-assessment-breakdown-chevron" aria-hidden="true"></span>
                            </summary>
                            <div class="course-info-warning-disclosure-panel course-assessment-breakdown-panel">
                                <div class="course-info-warning-disclosure-content">
                                    ${itemMarkup}
                                    ${linkMarkup}
                                </div>
                            </div>
                        </details>
                    </div>
                `;
            }

            const text = String(warning?.text || '').trim();
            if (!text) return '';
            return `<div class="course-info-inline-warning course-info-inline-warning--${normalizedKind}">${escapeHtml(text)}</div>`;
        })
        .join('');
    const evaluationComponents = Array.isArray(model?.evaluation?.components) ? model.evaluation.components : [];
    const assessmentBreakdownSection = evaluationComponents.length
        ? `
            <section class="ds-card course-assessment-breakdown-card" id="course-assessment-breakdown" tabindex="-1">
                <div class="ds-card-header">
                    <h3>Assessment Breakdown</h3>
                </div>
                <div class="course-assessment-breakdown-list">
                    ${evaluationComponents.map((component) => {
                        const weightText = formatEvaluationWeight(component.weight);
                        const detailsText = normalizeAssessmentDescriptionText(component.notes);
                        const displayLabel = normalizeEvaluationLabelPrefix(component.displayLabel || component.name)
                            || String(component.displayLabel || component.name || 'Component').replace(/[:：]+\s*$/g, '').trim()
                            || 'Component';
                        return `
                            <details class="course-assessment-breakdown-accordion">
                                <summary class="course-assessment-breakdown-summary">
                                    <div class="course-assessment-breakdown-main">
                                        <span class="course-assessment-breakdown-name">${escapeHtml(displayLabel)}</span>
                                        <span class="course-assessment-breakdown-weight">${escapeHtml(weightText || '—')}</span>
                                    </div>
                                    <span class="course-assessment-breakdown-chevron" aria-hidden="true"></span>
                                </summary>
                                <div class="course-assessment-breakdown-panel">
                                    ${detailsText
                ? `<p class="course-assessment-breakdown-notes">${escapeHtml(detailsText)}</p>`
                : '<p class="course-assessment-breakdown-notes course-assessment-breakdown-notes--empty">No additional details provided.</p>'}
                                </div>
                            </details>
                        `;
                    }).join('')}
                </div>
            </section>
        `
        : '';
    const conflictPreviewMarkup = model?.conflictPreview
        ? `<div class="course-info-inline-warning" id="course-conflict-preview">${escapeHtml(model.conflictPreview)}</div>`
        : '<div class="course-info-inline-warning" id="course-conflict-preview" style="display:none;"></div>';

    return `
        <div class="course-info-stack">
            ${isMobile ? '' : `
                <section class="ds-card">
                    <div class="course-info-hero">
                        <div class="course-info-hero-main">
                            <div class="course-info-title-row">
                                ${model?.titleDotColor ? `<span class="course-info-title-dot" style="background:${escapeHtml(model.titleDotColor)}" aria-hidden="true"></span>` : ''}
                                <h2 class="course-info-title">${escapeHtml(model?.title || 'Course')}</h2>
                            </div>
                            ${model?.subline ? `<p class="course-info-subline">${escapeHtml(model.subline)}</p>` : ''}
                            <div class="ds-badges">
                                ${badges.map((badge) => `
                                    <span class="ds-badge ds-badge--${escapeHtml(badge.variant || 'default')}"${badge.role ? ` data-badge-role="${escapeHtml(badge.role)}"` : ''}>
                                        ${badge.dotColor ? `<span class="ds-badge-dot" style="background:${escapeHtml(badge.dotColor)}"></span>` : ''}
                                        ${escapeHtml(badge.label || '')}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                        <div class="course-info-hero-actions">
                            ${heroActions.map((btn) => renderCourseActionPill(btn.label, { ...btn, className: (btn.className || '').trim() })).join('')}
                        </div>
                    </div>
                </section>
            `}
            ${inlineWarningsMarkup ? `<div class="course-info-inline-warnings">${inlineWarningsMarkup}</div>` : ''}
            ${conflictPreviewMarkup}

            <section class="ds-card">
                <div class="ds-card-header">
                    <h3>Key Details</h3>
                </div>
                <div class="key-details-inner">
                    <div class="course-info-details-grid">
                    ${detailRows.map((row) => `
                        <div class="ds-row course-detail-row key-row">
                            <div class="course-detail-meta">
                                <div class="ds-row-label course-detail-label">${escapeHtml(row.label)}</div>
                                ${row.helper ? `<div class="course-detail-helper">${escapeHtml(row.helper)}</div>` : ''}
                            </div>
                            <div class="ds-row-value course-detail-value ${row.subtle ? 'ds-row-subtle' : ''} ${row.pill ? 'course-detail-value--pill' : ''}">${row.html ?? escapeHtml(row.value || '—')}</div>
                        </div>
                    `).join('')}
                    </div>
                </div>
            </section>

            ${assessmentBreakdownSection}
        </div>
    `;
}

function CourseInfoSheet(containerEl, model) {
    if (!containerEl) return;
    containerEl.classList.add('sheet', 'courseinfo-sheet');
    containerEl.classList.remove('course-info-page-shell');
    containerEl.querySelector('.class-info-header')?.classList.add('courseinfo-header');
    containerEl.querySelector('.swipe-indicator')?.classList.add('courseinfo-grabber');
    (containerEl.querySelector('.sheet-body') || containerEl.querySelector('.class-content-wrapper'))?.classList.add('courseinfo-body');
    containerEl.querySelector('#course-info-peek')?.classList.add('courseinfo-peek');
    const headerTitle = containerEl.querySelector('.class-header h2, .class-header h3');
    if (headerTitle) headerTitle.textContent = model?.headerTitle || 'Class Info';
}

function CourseInfoPage(containerEl, model) {
    if (!containerEl) return;
    containerEl.classList.add('sheet', 'course-info-page-shell', 'courseinfo-sheet');
    containerEl.querySelector('.class-info-header')?.classList.add('courseinfo-header');
    containerEl.querySelector('.swipe-indicator')?.classList.add('courseinfo-grabber');
    (containerEl.querySelector('.sheet-body') || containerEl.querySelector('.class-content-wrapper'))?.classList.add('courseinfo-body');
    containerEl.querySelector('#course-info-peek')?.classList.add('courseinfo-peek');
    const headerTitle = containerEl.querySelector('.class-header h2, .class-header h3');
    if (headerTitle) headerTitle.textContent = model?.headerTitle || 'Class Info';
}

function syncCourseInfoHeaderPresentation(containerEl, model, options = {}) {
    if (!containerEl) return;

    const isMobile = options.isMobile === true;
    const classHeader = containerEl.querySelector('.class-header');
    const headerWrap = containerEl.querySelector('.class-info-header');
    const headerTitle = classHeader?.querySelector('h2, h3');
    const closeBtn = classHeader?.querySelector('#class-close');
    const existingActions = classHeader?.querySelector('[data-courseinfo-header-actions]');
    const existingTags = headerWrap?.querySelector('[data-courseinfo-header-tags]');

    existingActions?.remove();
    existingTags?.remove();

    if (!headerTitle) return;

    if (!isMobile) {
        headerTitle.textContent = model?.headerTitle || 'Class Info';
        return;
    }

    headerTitle.textContent = model?.title || model?.headerTitle || 'Course';

    const badges = Array.isArray(model?.badges) ? model.badges : [];
    if (headerWrap && badges.length) {
        const tagsWrap = document.createElement('div');
        tagsWrap.className = 'courseinfo-header-tags ds-badges';
        tagsWrap.dataset.courseinfoHeaderTags = 'true';
        tagsWrap.innerHTML = badges.map((badge) => `
            <span class="ds-badge ds-badge--${escapeHtml(badge?.variant || 'default')}"${badge?.role ? ` data-badge-role="${escapeHtml(badge.role)}"` : ''}>
                ${badge?.dotColor ? `<span class="ds-badge-dot" style="background:${escapeHtml(badge.dotColor)}"></span>` : ''}
                ${escapeHtml(badge?.label || '')}
            </span>
        `).join('');
        classHeader?.insertAdjacentElement('afterend', tagsWrap);
    }

    if (!classHeader || !closeBtn) return;

    const heroActions = Array.isArray(model?.heroActions) ? model.heroActions : [];
    const mobileActions = heroActions
        .filter((action) => action?.action === 'share-course' || action?.action === 'open-syllabus')
        .slice(0, 2);

    if (!mobileActions.length) return;

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'courseinfo-header-actions';
    actionsWrap.dataset.courseinfoHeaderActions = 'true';

    mobileActions.forEach((action) => {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'courseinfo-header-action-btn';
        actionBtn.setAttribute('aria-label', String(action.label || '').trim() || 'Action');
        actionBtn.setAttribute('title', String(action.label || '').trim() || 'Action');
        if (action.action) {
            actionBtn.dataset.action = String(action.action);
        }
        if (action.href) {
            actionBtn.dataset.href = String(action.href);
        }
        const iconClass = action.icon ? `pill-icon ${String(action.icon)}` : 'pill-icon';
        actionBtn.innerHTML = `<span class="${escapeHtml(iconClass)}" aria-hidden="true"></span>`;
        actionsWrap.appendChild(actionBtn);
    });

    classHeader.insertBefore(actionsWrap, closeBtn);
}

function openDsModal({
    title,
    subtitle = '',
    bodyHtml = '',
    footerHtml = '',
    onMount = null,
    onClose = null,
    className = '',
    modalKind = 'ds',
    mobileSwipe = null
}) {
    const existing = document.querySelector(`.modal[data-modal-kind="${modalKind}"]`);
    if (existing) {
        if (typeof existing.__closeModal === 'function') {
            existing.__closeModal({ immediate: true });
        } else {
            existing.remove();
            unlockBodyScrollForDsModal();
        }
    }

    const modal = document.createElement('div');
    modal.className = `modal ${className}`.trim();
    modal.dataset.modalKind = modalKind;
    modal.innerHTML = `
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title || 'Modal')}">
            <div class="modal-header">
                <div>
                    <h3>${escapeHtml(title || 'Modal')}</h3>
                    ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                </div>
                <button type="button" class="modal-close-btn" data-action="close-modal" aria-label="Close">Close</button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            ${footerHtml ? `<div class="modal-footer-sticky">${footerHtml}</div>` : ''}
        </div>
    `;

    const dialog = modal.querySelector('.modal-dialog');
    const autoEnableMobileSwipeSheet = isCourseInfoMobileViewport() &&
        (modal.classList.contains('review-modal-host') || modal.classList.contains('modal--confirm'));
    const enableMobileSwipeSheet = typeof mobileSwipe === 'boolean'
        ? mobileSwipe
        : autoEnableMobileSwipeSheet;
    const closeDelayMs = enableMobileSwipeSheet ? (SWIPE_CLOSE_DURATION_MS + 20) : 220;

    if (enableMobileSwipeSheet && dialog) {
        modal.classList.add('modal--mobile-swipe');
        dialog.classList.add('mobile-swipe-sheet');
        if (!dialog.querySelector('.swipe-indicator')) {
            const indicator = document.createElement('div');
            indicator.className = 'swipe-indicator ui-swipe-sheet__handle';
            indicator.setAttribute('aria-hidden', 'true');
            dialog.insertBefore(indicator, dialog.firstChild);
        }
        dialog.style.setProperty('--modal-translate-y', '100vh');
    }

    let isClosed = false;
    let focusTrapCleanup = null;
    const requestClose = ({ immediate = false } = {}) => {
        if (typeof modal.__requestClose === 'function') {
            const handled = modal.__requestClose();
            if (handled === true) return false;
        }
        close({ immediate });
        return true;
    };

    const close = ({ immediate = false } = {}) => {
        if (isClosed) return;
        isClosed = true;

        const finalizeClose = () => {
            try {
                dialog?._swipeCleanup?.();
            } catch (_) { }
            modal.remove();
            unlockBodyScrollForDsModal();
            if (typeof onClose === 'function') {
                onClose();
            }
        };

        if (typeof focusTrapCleanup === 'function') {
            focusTrapCleanup();
            focusTrapCleanup = null;
        }

        if (immediate) {
            finalizeClose();
            return;
        }

        modal.classList.add('hidden');
        if (enableMobileSwipeSheet && dialog) {
            dialog.style.setProperty('--modal-translate-y', '100vh');
        }

        setTimeout(finalizeClose, closeDelayMs);
    };

    modal.addEventListener('click', (event) => {
        if (event.target === modal || event.target?.dataset?.action === 'close-modal') {
            requestClose();
        }
    });

    modal.__closeModal = close;
    document.body.appendChild(modal);
    lockBodyScrollForDsModal();
    if (enableMobileSwipeSheet) {
        requestAnimationFrame(() => {
            dialog?.style.setProperty('--modal-translate-y', '0px');
        });
    }

    focusTrapCleanup = createFocusTrap(dialog, { onEscape: requestClose });

    window.setTimeout(() => {
        const preferredFocus = modal.querySelector('[data-autofocus], .modal-close-btn');
        if (preferredFocus instanceof HTMLElement) {
            preferredFocus.focus({ preventScroll: true });
            return;
        }
        const firstFocusable = getFocusableElements(dialog)[0];
        firstFocusable?.focus?.({ preventScroll: true });
    }, 20);

    if (typeof onMount === 'function') onMount(modal, close);

    if (enableMobileSwipeSheet && dialog && typeof window.addSwipeToCloseSimple === 'function') {
        window.addSwipeToCloseSimple(dialog, modal, () => {
            requestClose({ immediate: true });
        });
    }

    return { modal, close };
}

export function openConfirmModal({ title = 'Confirm', message = 'Are you sure?', confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false }) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const bodyHtml = `<div class="ds-card"><p style="margin:0;font-family:var(--font-ui);">${escapeHtml(message)}</p></div>`;
        const footerHtml = `
            <button type="button" class="btn-secondary" data-action="cancel-confirm">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="${destructive ? 'btn-destructive' : 'btn-primary'}" data-action="confirm-confirm">${escapeHtml(confirmLabel)}</button>
        `;
        const { modal, close } = openDsModal({
            title,
            bodyHtml,
            footerHtml,
            className: 'modal--confirm',
            modalKind: 'confirm',
            onMount: (root) => {
                const cancelBtn = root.querySelector('[data-action="cancel-confirm"]');
                const confirmBtn = root.querySelector('[data-action="confirm-confirm"]');
                cancelBtn?.addEventListener('click', () => {
                    settle(false);
                    close();
                });
                confirmBtn?.addEventListener('click', () => {
                    settle(true);
                    close();
                });
            },
            onClose: () => {
                settle(false);
                document.body.style.overflow = document.body.classList.contains('modal-open') ? 'hidden' : 'auto';
            }
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                settle(false);
            }
        });
    });
}

const courseCache = {};
const courseCacheMeta = {};
const courseCacheInFlight = {};
const COURSE_CACHE_TTL_MS = 5 * 60 * 1000;
const COURSE_CACHE_FULL_RESYNC_MS = 30 * 60 * 1000;

let supportsCoursesUpdatedAt = true;

let coursesRealtimeSubscriptionInitialized = false;
let coursesRealtimeChannel = null;

function normalizeCourseYear(year) {
    const parsed = parseInt(year, 10);
    return Number.isFinite(parsed) ? parsed : year;
}

function normalizeCourseTerm(term) {
    if (term === null || term === undefined) return '';

    const rawTerm = String(term).trim();
    const lowerTerm = rawTerm.toLowerCase();

    if (lowerTerm.includes('fall') || rawTerm.includes('秋')) return 'Fall';
    if (lowerTerm.includes('spring') || rawTerm.includes('春')) return 'Spring';

    return rawTerm;
}

function normalizeCourseCodeForReview(codeValue) {
    return String(codeValue || '').trim().toUpperCase();
}

function getCourseCodeFamily(codeValue) {
    const normalizedCode = normalizeCourseCodeForReview(codeValue);
    if (!normalizedCode) return '';
    const sectionMatch = normalizedCode.match(/^(.+)-([0-9]{2,4})$/);
    return sectionMatch ? String(sectionMatch[1] || '').trim() : normalizedCode;
}

function normalizeCourseTitleForReview(titleValue) {
    return String(titleValue || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isSectionSpecificCourseForReviews({ courseTitle = '' } = {}) {
    const normalizedTitle = normalizeCourseTitleForReview(courseTitle);
    if (!normalizedTitle) return false;
    return /\bseminar\b/.test(normalizedTitle) || /\bthesis\b/.test(normalizedTitle);
}

function sanitizeCourseCodeFilterToken(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, '');
}

function addEquivalentCourseCodesFromRows(codeSet, rows) {
    if (!codeSet || !(codeSet instanceof Set) || !Array.isArray(rows)) return;
    rows.forEach((row) => {
        const normalizedCode = normalizeCourseCodeForReview(row?.course_code);
        if (!normalizedCode) return;
        codeSet.add(normalizedCode);
        const family = getCourseCodeFamily(normalizedCode);
        if (family) codeSet.add(family);
    });
}

const courseReviewEquivalentCodeCache = new Map();

async function resolveEquivalentCourseCodesForReviews({ courseCode = '', courseTitle = '' } = {}) {
    const normalizedCode = normalizeCourseCodeForReview(courseCode);
    const codeFamily = getCourseCodeFamily(normalizedCode);
    const normalizedTitle = normalizeCourseTitleForReview(courseTitle);
    const sectionSpecificCourse = isSectionSpecificCourseForReviews({ courseTitle });
    const cacheKey = `${codeFamily}::${normalizedTitle}`;
    if (cacheKey && courseReviewEquivalentCodeCache.has(cacheKey)) {
        return [...courseReviewEquivalentCodeCache.get(cacheKey)];
    }

    if (sectionSpecificCourse) {
        const exactCodeOnly = normalizedCode ? [normalizedCode] : [];
        if (cacheKey) {
            courseReviewEquivalentCodeCache.set(cacheKey, exactCodeOnly);
        }
        return exactCodeOnly;
    }

    const equivalentCodes = new Set();
    if (normalizedCode) equivalentCodes.add(normalizedCode);
    if (codeFamily) equivalentCodes.add(codeFamily);

    const familyFilterToken = sanitizeCourseCodeFilterToken(codeFamily);
    const titleFilterValue = String(courseTitle || '').trim().replace(/\s+/g, ' ');

    if (familyFilterToken) {
        try {
            const { data: familyOfferings, error: familyOfferingsError } = await supabase
                .from('courses')
                .select('course_code')
                .or(`course_code.eq.${familyFilterToken},course_code.ilike.${familyFilterToken}-%`)
                .limit(500);
            if (familyOfferingsError) {
                console.warn('Unable to resolve equivalent course codes by family:', familyOfferingsError);
            } else {
                addEquivalentCourseCodesFromRows(equivalentCodes, familyOfferings);
            }
        } catch (error) {
            console.warn('Error resolving equivalent course codes by family:', error);
        }
    }

    if (titleFilterValue) {
        try {
            const { data: titleOfferings, error: titleOfferingsError } = await supabase
                .from('courses')
                .select('course_code')
                .ilike('title', titleFilterValue)
                .limit(500);
            if (titleOfferingsError) {
                console.warn('Unable to resolve equivalent course codes by title:', titleOfferingsError);
            } else {
                addEquivalentCourseCodesFromRows(equivalentCodes, titleOfferings);
            }
        } catch (error) {
            console.warn('Error resolving equivalent course codes by title:', error);
        }
    }

    if (familyFilterToken && equivalentCodes.size <= 2) {
        try {
            const { data: reviewedVariants, error: reviewedVariantsError } = await supabase
                .from('course_reviews')
                .select('course_code')
                .or(`course_code.eq.${familyFilterToken},course_code.ilike.${familyFilterToken}-%`)
                .limit(500);
            if (!reviewedVariantsError) {
                addEquivalentCourseCodesFromRows(equivalentCodes, reviewedVariants);
            }
        } catch (_) {
            // Ignore fallback lookup errors and continue with known course codes.
        }
    }

    const resolvedCodes = [...equivalentCodes].filter(Boolean);
    if (cacheKey) {
        courseReviewEquivalentCodeCache.set(cacheKey, resolvedCodes);
    }
    return resolvedCodes;
}

function applyCourseReviewCodeFilter(query, equivalentCodes, fallbackCourseCode = '') {
    const normalizedCodes = [...new Set((equivalentCodes || [])
        .map((code) => normalizeCourseCodeForReview(code))
        .filter(Boolean))];

    if (normalizedCodes.length === 0) {
        const fallbackCode = normalizeCourseCodeForReview(fallbackCourseCode);
        if (fallbackCode) {
            return query.eq('course_code', fallbackCode);
        }
        return query;
    }

    if (normalizedCodes.length === 1) {
        return query.eq('course_code', normalizedCodes[0]);
    }

    return query.in('course_code', normalizedCodes);
}

function hasAnyGpaSignal(course) {
    if (!course) return false;
    return (
        (course.gpa_a_percent !== null && course.gpa_a_percent !== 0) ||
        (course.gpa_b_percent !== null && course.gpa_b_percent !== 0) ||
        (course.gpa_c_percent !== null && course.gpa_c_percent !== 0) ||
        (course.gpa_d_percent !== null && course.gpa_d_percent !== 0) ||
        (course.gpa_f_percent !== null && course.gpa_f_percent !== 0)
    );
}

function normalizeProfessorForComparison(name) {
    return String(name || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function isCourseGpaAlignedWithCurrentProfessor(course) {
    if (!course) return false;

    const currentProfessor = normalizeProfessorForComparison(course.professor);
    const gpaSourceProfessor = normalizeProfessorForComparison(course.gpa_professor_source);

    // If GPA source professor is known, require an exact normalized match.
    if (gpaSourceProfessor) {
        if (!currentProfessor) return false;
        return gpaSourceProfessor === currentProfessor;
    }

    const sourceYearRaw = course.gpa_year_source;
    const sourceTermRaw = course.gpa_term_source;
    const hasSourceOfferingContext = (
        sourceYearRaw !== null && sourceYearRaw !== undefined && String(sourceYearRaw).trim() !== ''
    ) || (
        sourceTermRaw !== null && sourceTermRaw !== undefined && String(sourceTermRaw).trim() !== ''
    );

    // No source context means GPA belongs to the current row; keep behavior unchanged.
    if (!hasSourceOfferingContext) return true;

    const sourceYear = normalizeCourseYear(sourceYearRaw);
    const sourceTerm = normalizeCourseTerm(sourceTermRaw);
    const currentYear = normalizeCourseYear(course.academic_year);
    const currentTerm = normalizeCourseTerm(course.term);

    const sameYear = String(sourceYear) === String(currentYear);
    const sameTerm = String(sourceTerm) === String(currentTerm);

    // If source offering differs and source professor is unknown, hide GPA conservatively.
    if (!sameYear || !sameTerm) {
        return false;
    }

    return true;
}

function getCourseCacheKey(year, term) {
    const normalizedYear = normalizeCourseYear(year);
    const normalizedTerm = normalizeCourseTerm(term);
    return `${normalizedYear}-${normalizedTerm}`;
}

function getCourseIdentity(course) {
    return `${course.course_code}::${normalizeCourseYear(course.academic_year)}::${normalizeCourseTerm(course.term)}`;
}

function getLatestCourseUpdatedAt(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return null;

    let maxMillis = 0;

    courses.forEach((course) => {
        const updatedAt = course?.updated_at;
        if (!updatedAt) return;

        const millis = Date.parse(updatedAt);
        if (!Number.isNaN(millis)) {
            maxMillis = Math.max(maxMillis, millis);
        }
    });

    if (!maxMillis) return null;
    return new Date(maxMillis).toISOString();
}

function mergeCourseUpdates(existingCourses, changedCourses) {
    const mergedMap = new Map();

    existingCourses.forEach((course) => {
        mergedMap.set(getCourseIdentity(course), course);
    });

    changedCourses.forEach((course) => {
        mergedMap.set(getCourseIdentity(course), course);
    });

    return Array.from(mergedMap.values());
}

function setCourseCacheEntry(year, term, courses, options = {}) {
    const cacheKey = getCourseCacheKey(year, term);
    const now = Date.now();

    courseCache[cacheKey] = courses;
    courseCacheMeta[cacheKey] = {
        fetchedAt: now,
        fullSyncAt: options.fullSyncAt ?? now,
        updatedAtIso: options.updatedAtIso ?? getLatestCourseUpdatedAt(courses),
        requiresFullSync: options.requiresFullSync === true
    };

    return cacheKey;
}

function getCourseCacheEntry(year, term) {
    const cacheKey = getCourseCacheKey(year, term);
    const cachedCourses = courseCache[cacheKey];
    if (!cachedCourses) return null;

    return {
        cacheKey,
        courses: cachedCourses,
        fetchedAt: courseCacheMeta[cacheKey]?.fetchedAt || 0,
        fullSyncAt: courseCacheMeta[cacheKey]?.fullSyncAt || 0,
        updatedAtIso: courseCacheMeta[cacheKey]?.updatedAtIso || null,
        requiresFullSync: courseCacheMeta[cacheKey]?.requiresFullSync === true
    };
}

function isCourseCacheFresh(cacheEntry) {
    if (!cacheEntry) return false;
    return Date.now() - cacheEntry.fetchedAt < COURSE_CACHE_TTL_MS;
}

function clearAvailableCourseDimensionCaches() {
    availableSemestersCache = null;
    availableYearsCache = null;
}

function hasCoursesUpdatedAtError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('updated_at') && (message.includes('column') || message.includes('does not exist'));
}

function invalidateCourseCacheEntry(year, term) {
    const cacheKey = getCourseCacheKey(year, term);
    delete courseCache[cacheKey];
    delete courseCacheMeta[cacheKey];
    delete courseCacheInFlight[cacheKey];
    return cacheKey;
}

function markCourseCacheEntryStale(year, term, { requiresFullSync = false } = {}) {
    const cacheKey = getCourseCacheKey(year, term);
    const meta = courseCacheMeta[cacheKey];
    if (!meta) return false;

    meta.fetchedAt = 0;

    if (requiresFullSync) {
        meta.requiresFullSync = true;
        meta.fullSyncAt = 0;
    }

    return true;
}

async function fetchDeltaCoursesSince(year, term, sinceIso) {
    if (!supportsCoursesUpdatedAt || !sinceIso) return null;

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
        .eq('academic_year', year)
        .eq('term', term)
        .gt('updated_at', sinceIso);

    if (error) {
        if (hasCoursesUpdatedAtError(error)) {
            supportsCoursesUpdatedAt = false;
            console.warn('courses.updated_at is unavailable; falling back to full fetch strategy');
            return null;
        }
        throw new Error(`Delta courses query failed: ${error.message}`);
    }

    return data || [];
}

async function fetchCourseDataWithDelta(year, term, cacheEntry) {
    const cacheKey = getCourseCacheKey(year, term);
    const shouldDoFullResync = (
        !cacheEntry ||
        cacheEntry.requiresFullSync ||
        !cacheEntry.fullSyncAt ||
        (Date.now() - cacheEntry.fullSyncAt > COURSE_CACHE_FULL_RESYNC_MS)
    );

    if (!shouldDoFullResync && cacheEntry?.updatedAtIso && supportsCoursesUpdatedAt) {
        const changedCourses = await fetchDeltaCoursesSince(year, term, cacheEntry.updatedAtIso);
        if (changedCourses !== null) {
            if (changedCourses.length > 0) {
                await applyHistoricalGpaFallback(changedCourses);
                const mergedCourses = mergeCourseUpdates(cacheEntry.courses, changedCourses);
                setCourseCacheEntry(year, term, mergedCourses, {
                    fullSyncAt: cacheEntry.fullSyncAt,
                    requiresFullSync: false
                });
                console.log(`Delta sync applied for ${term} ${year}: ${changedCourses.length} updated rows`);
                return mergedCourses;
            }

            setCourseCacheEntry(year, term, cacheEntry.courses, {
                fullSyncAt: cacheEntry.fullSyncAt,
                updatedAtIso: cacheEntry.updatedAtIso,
                requiresFullSync: false
            });
            return cacheEntry.courses;
        }
    }

    const fullCourses = await fetchCourseDataFallback(year, term);
    const meta = courseCacheMeta[cacheKey] || {};
    setCourseCacheEntry(year, term, fullCourses, {
        fullSyncAt: Date.now(),
        updatedAtIso: meta.updatedAtIso || getLatestCourseUpdatedAt(fullCourses),
        requiresFullSync: false
    });
    return fullCourses;
}

function refreshCourseDataInBackground(year, term, cacheKey, cacheEntry = null) {
    if (courseCacheInFlight[cacheKey]) {
        return courseCacheInFlight[cacheKey];
    }

    const refreshPromise = fetchCourseDataWithDelta(year, term, cacheEntry)
        .catch((error) => {
            console.warn(`Background refresh failed for ${term} ${year}:`, error);
            return null;
        })
        .finally(() => {
            delete courseCacheInFlight[cacheKey];
        });

    courseCacheInFlight[cacheKey] = refreshPromise;
    return refreshPromise;
}

function ensureCoursesRealtimeInvalidation() {
    if (coursesRealtimeSubscriptionInitialized) return;
    coursesRealtimeSubscriptionInitialized = true;

    try {
        coursesRealtimeChannel = supabase
            .channel('courses-cache-invalidation')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'courses' },
                (payload) => {
                    const row = payload?.new || payload?.old || null;
                    const changedYear = row?.academic_year;
                    const changedTerm = row?.term;
                    const normalizedTerm = normalizeCourseTerm(changedTerm);
                    const isDeleteEvent = payload?.eventType === 'DELETE';

                    clearAvailableCourseDimensionCaches();

                    if (changedYear !== undefined && changedYear !== null && normalizedTerm) {
                        const marked = markCourseCacheEntryStale(changedYear, normalizedTerm, {
                            requiresFullSync: isDeleteEvent
                        });
                        if (marked) {
                            console.log(`Realtime cache marked stale for ${normalizedTerm} ${changedYear}`);
                        }
                    } else {
                        Object.keys(courseCacheMeta).forEach((key) => {
                            courseCacheMeta[key].fetchedAt = 0;
                            if (isDeleteEvent) {
                                courseCacheMeta[key].requiresFullSync = true;
                                courseCacheMeta[key].fullSyncAt = 0;
                            }
                        });
                        console.log('Realtime cache marked stale for all course cache entries');
                    }

                    window.dispatchEvent(new CustomEvent('coursesCacheInvalidated', {
                        detail: {
                            eventType: payload?.eventType || 'unknown',
                            year: changedYear ?? null,
                            term: normalizedTerm || null
                        }
                    }));
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('Subscribed to realtime course cache invalidation');
                }
            });
    } catch (error) {
        console.warn('Failed to initialize realtime course cache invalidation:', error);
    }
}

export function invalidateCourseCache(year = null, term = null) {
    clearAvailableCourseDimensionCaches();

    if (year !== null && year !== undefined && term !== null && term !== undefined) {
        const removedKey = invalidateCourseCacheEntry(year, term);
        return { removedKeys: [removedKey] };
    }

    const removedKeys = Object.keys(courseCache);
    removedKeys.forEach((key) => {
        delete courseCache[key];
        delete courseCacheMeta[key];
        delete courseCacheInFlight[key];
    });

    return { removedKeys };
}

// Helper function to convert RGB to hex
function rgbToHex(rgb) {
    const result = rgb.match(/\d+/g);
    if (result && result.length >= 3) {
        return "#" + ((1 << 24) + (parseInt(result[0]) << 16) + (parseInt(result[1]) << 8) + parseInt(result[2])).toString(16).slice(1).toUpperCase();
    }
    return rgb; // Return original if conversion fails
}

// Helper function to generate course URL
function generateCourseURL(courseCode, academicYear, term) {
    // Clean the course code for URL: remove special characters, convert spaces to underscores, lowercase
    const cleanCode = courseCode
        .replace(/[^\w\s]/g, '') // Remove special characters except word chars and spaces
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .toLowerCase();
    const encodedCourseCode = encodeURIComponent(cleanCode);
    const encodedYear = encodeURIComponent(academicYear);
    const encodedTerm = encodeURIComponent(term.toLowerCase().replace(/.*\//, '')); // Extract just Fall/Spring
    // Canonical course detail route lives under /courses/... (nav-enabled SPA shell).
    return toAppUrl(`/courses/${encodedCourseCode}/${encodedYear}/${encodedTerm}`);
}

function isCourseDetailPath(path) {
    return /^\/courses?\/[^\/]+\/\d{4}\/[^\/]+\/?$/.test(String(path || ''));
}

function normalizeModalReturnPath(path) {
    const raw = String(path || '').trim();
    if (!raw || isCourseDetailPath(raw)) return null;
    return raw;
}

function rememberCourseModalReturnPath(path, modal = null) {
    const normalized = normalizeModalReturnPath(path);
    if (!normalized) return null;

    window.__ilaCourseModalReturnPath = normalized;

    const classInfo = modal || document.getElementById('class-info');
    if (classInfo?.dataset) {
        classInfo.dataset.returnPath = normalized;
    }

    return normalized;
}

function resolveCourseModalReturnPath(modal = null) {
    const classInfo = modal || document.getElementById('class-info');
    const datasetPath = normalizeModalReturnPath(classInfo?.dataset?.returnPath);
    if (datasetPath) return datasetPath;

    const statePath = normalizeModalReturnPath(window.history.state?.courseModalReturnPath);
    if (statePath) return statePath;

    const globalPath = normalizeModalReturnPath(window.__ilaCourseModalReturnPath);
    if (globalPath) return globalPath;

    const routerPath = normalizeModalReturnPath(window.router?.currentPath);
    if (routerPath) return routerPath;

    return '/courses';
}

function restoreCourseModalReturnURL(modal = null) {
    const classInfo = modal || document.getElementById('class-info');
    const returnPath = resolveCourseModalReturnPath(classInfo);

    if (classInfo?.dataset) {
        delete classInfo.dataset.returnPath;
    }

    window.history.replaceState({}, '', withBase(returnPath));
}

// Export function to generate course URLs for external use
export function getCourseURL(course) {
    if (!course.course_code || !course.academic_year || !course.term) {
        console.warn('Course missing required fields for URL generation:', course);
        return getCurrentAppPath();
    }
    return generateCourseURL(course.course_code, course.academic_year, course.term);
}

// Helper function to parse course URL parameters
function parseCourseURL() {
    const path = getCurrentAppPath();
    // Look for clean URL pattern: /course/courseCode/year/term (also supports /courses alias)
    const match = path.match(/^\/courses?\/([^\/]+)\/(\d{4})\/([^\/]+)\/?$/);

    if (match) {
        const courseCode = decodeURIComponent(match[1]).replace(/_/g, ' ');
        const year = parseInt(match[2]);
        const termParam = match[3].toLowerCase();
        const term = termParam === 'fall' ? 'Fall' : 'Spring';

        return { courseCode, year, term };
    }

    return null;
}

// Helper function to find course by code, year, and term
async function findCourseByParams(courseCode, year, term) {
    try {
        console.log('Searching for course:', { courseCode, year, term });
        const courses = await fetchCourseData(year, term);
        console.log('Total courses available:', courses.length);

        // Try exact match first (case insensitive)
        let course = courses.find(c =>
            c.course_code && c.course_code.toLowerCase() === courseCode.toLowerCase()
        );
        console.log('Exact match result:', course);

        // If not found, try partial match on title
        if (!course) {
            const searchTerm = courseCode.toLowerCase().replace(/_/g, ' ');
            course = courses.find(c =>
                (c.title && c.title.toLowerCase().includes(searchTerm)) ||
                (c.title && c.title.toLowerCase().replace(/\s+/g, '_').includes(courseCode.toLowerCase()))
            );
            console.log('Title match result:', course);
        }

        // If still not found, try matching by course code parts or containing
        if (!course) {
            course = courses.find(c =>
                (c.course_code && c.course_code.toLowerCase().includes(courseCode.toLowerCase())) ||
                (c.course_code && courseCode.toLowerCase().includes(c.course_code.toLowerCase()))
            );
            console.log('Partial code match result:', course);
        }

        // If still not found, try to find by any numeric match (for codes like 12001104003)
        if (!course && /^\d+$/.test(courseCode)) {
            course = courses.find(c =>
                c.course_code && c.course_code.replace(/[^\d]/g, '') === courseCode
            );
            console.log('Numeric match result:', course);
        }

        // Log all available course codes for debugging
        if (!course) {
            console.log('Available course codes:', courses.slice(0, 10).map(c => c.course_code));
        }

        return course;
    } catch (error) {
        console.error('Error finding course:', error);
        return null;
    }
}

// Cache for available years
let availableYearsCache = null;

// Cache for available semesters (term + year combinations)
let availableSemestersCache = null;

// Fetch available semesters (term + year combinations) from the database
export async function fetchAvailableSemesters() {
    ensureCoursesRealtimeInvalidation();

    // Return cached data if available
    if (availableSemestersCache) {
        console.log('Using cached available semesters:', availableSemestersCache);
        return availableSemestersCache;
    }

    try {
        console.log('Fetching available semesters from database...');

        // Query distinct term and academic_year combinations from courses table
        const { data, error } = await supabase
            .from('courses')
            .select('term, academic_year')
            .order('academic_year', { ascending: false });

        if (error) {
            console.error('Error fetching available semesters:', error);
            // Return default semesters if query fails
            return [
                { term: 'Fall', year: 2025, label: 'Fall 2025' },
                { term: 'Spring', year: 2025, label: 'Spring 2025' },
                { term: 'Fall', year: 2024, label: 'Fall 2024' }
            ];
        }

        if (!data || data.length === 0) {
            console.warn('No semesters found in database, using defaults');
            return [
                { term: 'Fall', year: 2025, label: 'Fall 2025' },
                { term: 'Spring', year: 2025, label: 'Spring 2025' }
            ];
        }

        // Extract unique term-year combinations
        const semesterMap = new Map();
        data.forEach(item => {
            if (item.term && item.academic_year) {
                const key = `${item.term}-${item.academic_year}`;
                if (!semesterMap.has(key)) {
                    semesterMap.set(key, {
                        term: item.term,
                        year: item.academic_year,
                        label: `${item.term} ${item.academic_year}`
                    });
                }
            }
        });

        // Convert to array and sort: by year descending, then Fall before Spring
        const semesters = Array.from(semesterMap.values()).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            // Fall comes before Spring in the same year
            if (a.term === 'Fall' && b.term === 'Spring') return -1;
            if (a.term === 'Spring' && b.term === 'Fall') return 1;
            return 0;
        });

        console.log('Available semesters from database:', semesters);

        // Cache the result
        availableSemestersCache = semesters;

        return semesters;
    } catch (error) {
        console.error('Error in fetchAvailableSemesters:', error);
        return [
            { term: 'Fall', year: 2025, label: 'Fall 2025' },
            { term: 'Spring', year: 2025, label: 'Spring 2025' }
        ];
    }
}

// Fetch available years from the database
export async function fetchAvailableYears() {
    ensureCoursesRealtimeInvalidation();

    // Return cached data if available
    if (availableYearsCache) {
        console.log('Using cached available years:', availableYearsCache);
        return availableYearsCache;
    }

    try {
        console.log('Fetching available years from database...');

        // Query distinct academic_year values from courses table
        const { data, error } = await supabase
            .from('courses')
            .select('academic_year')
            .order('academic_year', { ascending: false });

        if (error) {
            console.error('Error fetching available years:', error);
            // Return default years if query fails
            return [2025, 2024];
        }

        if (!data || data.length === 0) {
            console.warn('No years found in database, using defaults');
            return [2025, 2024];
        }

        // Extract unique years and sort descending
        const uniqueYears = [...new Set(data.map(item => item.academic_year))]
            .filter(year => year !== null)
            .sort((a, b) => b - a);

        console.log('Available years from database:', uniqueYears);

        // Cache the result
        availableYearsCache = uniqueYears;

        return uniqueYears;
    } catch (error) {
        console.error('Error in fetchAvailableYears:', error);
        return [2025, 2024];
    }
}

export async function fetchCourseData(year, term, options = {}) {
    ensureCoursesRealtimeInvalidation();

    const normalizedYear = normalizeCourseYear(year);
    const normalizedTerm = normalizeCourseTerm(term);
    const cacheKey = getCourseCacheKey(normalizedYear, normalizedTerm);
    const forceRefresh = options?.forceRefresh === true;

    const cachedEntry = getCourseCacheEntry(normalizedYear, normalizedTerm);
    if (cachedEntry && !forceRefresh) {
        if (isCourseCacheFresh(cachedEntry)) {
            console.log(`Using cached courses for ${normalizedTerm} ${normalizedYear}`);
            return cachedEntry.courses;
        }

        console.log(`Using stale cached courses for ${normalizedTerm} ${normalizedYear}, refreshing in background`);
        refreshCourseDataInBackground(normalizedYear, normalizedTerm, cacheKey, cachedEntry);
        return cachedEntry.courses;
    }

    if (courseCacheInFlight[cacheKey]) {
        return courseCacheInFlight[cacheKey];
    }

    const fetchPromise = (async () => {
        try {
            console.log(`Fetching courses for ${normalizedTerm} ${normalizedYear}...`);

            return await fetchCourseDataWithDelta(normalizedYear, normalizedTerm, cachedEntry);
        } catch (error) {
            console.error(`Error fetching course data for ${normalizedTerm} ${normalizedYear}:`, error);

            // Check if we have stale cache data as fallback
            if (courseCache[cacheKey]) {
                console.log(`Using stale cached data as fallback for ${normalizedTerm} ${normalizedYear}`);
                return courseCache[cacheKey];
            }

            // Re-throw the error for retry mechanisms to handle
            throw error;
        } finally {
            delete courseCacheInFlight[cacheKey];
        }
    })();

    courseCacheInFlight[cacheKey] = fetchPromise;

    try {
        return await fetchPromise;

        /* Original RPC call - disabled due to temp_courses permission issues
        const { data: courses, error } = await supabase.rpc('get_courses_with_fallback_gpa', {
            p_year: year,
            p_term: term
        });

        if (error) {
            console.error("Supabase RPC error:", error.message, error.details, error.hint);
            
            // Handle specific permission errors with temp_courses table
            if (error.message?.includes('must be owner of table temp_courses')) {
                console.warn('Database permissions issue detected. Trying fallback method...');
                return await fetchCourseDataFallback(year, term);
            }
            
            throw new Error(`Database query failed: ${error.message}`);
        }
        
        if (!courses) {
            console.warn(`No courses data returned for ${term} ${year}`);
            return [];
        }
        
        if (courses.length === 0) {
            console.warn(`Empty courses array returned for ${term} ${year}`);
            return [];
        }
        
        console.log(`Successfully fetched ${courses.length} courses for ${term} ${year}`);
        courseCache[cacheKey] = courses;
        return courses;
        */
    } catch (error) {
        throw error;
    }
}

async function applyHistoricalGpaFallback(courses) {
    if (!courses || courses.length === 0) return courses;

    // Normalize explicit source metadata for rows that already have GPA values.
    courses.forEach((course) => {
        if (!hasAnyGpaSignal(course)) return;

        if (course.gpa_year_source === undefined || course.gpa_year_source === null || course.gpa_year_source === '') {
            course.gpa_year_source = course.academic_year ?? null;
        }
        if (course.gpa_term_source === undefined || course.gpa_term_source === null || course.gpa_term_source === '') {
            course.gpa_term_source = course.term ?? null;
        }
        if (course.gpa_professor_source === undefined || course.gpa_professor_source === null || course.gpa_professor_source === '') {
            course.gpa_professor_source = course.professor ?? null;
        }
    });

    const coursesWithGPA = courses.filter((course) => hasAnyGpaSignal(course));
    const coursesWithoutGPA = courses.filter((course) => !hasAnyGpaSignal(course));

    if (coursesWithGPA.length > 0) {
        console.log(`Found GPA data for ${coursesWithGPA.length} out of ${courses.length} courses`);
    }

    if (coursesWithoutGPA.length > 0) {
        console.log(`${coursesWithoutGPA.length} courses missing GPA data - attempting to find historical GPA data...`);

        // Get historical GPA data for courses that don't have current GPA data
        const historicalGpaData = await fetchHistoricalGpaData(coursesWithoutGPA.map(c => c.course_code));

        // Apply historical GPA data to courses that need it
        coursesWithoutGPA.forEach(course => {
            const historicalGpa = historicalGpaData[course.course_code];
            if (historicalGpa) {
                course.gpa_a_percent = historicalGpa.gpa_a_percent;
                course.gpa_b_percent = historicalGpa.gpa_b_percent;
                course.gpa_c_percent = historicalGpa.gpa_c_percent;
                course.gpa_d_percent = historicalGpa.gpa_d_percent;
                course.gpa_f_percent = historicalGpa.gpa_f_percent;
                course.gpa_year_source = historicalGpa.academic_year; // Track where GPA came from
                course.gpa_term_source = historicalGpa.term;
                course.gpa_professor_source = historicalGpa.professor || null;
            }
        });

        const coursesWithHistoricalGpa = coursesWithoutGPA.filter(course => course.gpa_year_source);
        if (coursesWithHistoricalGpa.length > 0) {
            console.log(`Found historical GPA data for ${coursesWithHistoricalGpa.length} additional courses`);
            console.log('Sample course with historical GPA:', coursesWithHistoricalGpa[0]);
        } else {
            console.log('No historical GPA data found for courses missing current GPA');
        }
    }

    return courses;
}

// Fallback method for when RPC permissions fail
async function fetchCourseDataFallback(year, term) {
    try {
        console.log(`Attempting fallback fetch for term="${term}" year=${year}...`);

        // First, let's see what terms actually exist in the database
        const { data: termCheck, error: termError } = await supabase
            .from('courses')
            .select('term')
            .eq('academic_year', year)
            .limit(5);

        if (termCheck && termCheck.length > 0) {
            console.log('Sample terms in database for year', year, ':', termCheck.map(c => c.term));
        } else {
            console.log('No courses found for year', year, 'at all');
        }

        // First, try to get courses WITH GPA columns directly
        const { data: courses, error: coursesError } = await supabase
            .from('courses')
            .select(`
                *,
                gpa_a_percent,
                gpa_b_percent, 
                gpa_c_percent,
                gpa_d_percent,
                gpa_f_percent
            `)
            .eq('academic_year', year)
            .eq('term', term);

        if (coursesError) {
            console.error("Courses fallback query error:", coursesError);
            throw new Error(`Courses fallback query failed: ${coursesError.message}`);
        }

        if (!courses || courses.length === 0) {
            console.warn(`No courses found in fallback method for term="${term}" year=${year}`);
            return [];
        }

        console.log(`Successfully fetched ${courses.length} courses with embedded GPA data for ${term} ${year}`);

        // Debug: Let's see what the first course looks like
        if (courses.length > 0) {
            console.log('Sample course data structure:', courses[0]);
            console.log('Available columns:', Object.keys(courses[0]));
            console.log('GPA values in sample course:', {
                gpa_a_percent: courses[0].gpa_a_percent,
                gpa_b_percent: courses[0].gpa_b_percent,
                gpa_c_percent: courses[0].gpa_c_percent,
                gpa_d_percent: courses[0].gpa_d_percent,
                gpa_f_percent: courses[0].gpa_f_percent
            });
        }

        await applyHistoricalGpaFallback(courses);

        setCourseCacheEntry(year, term, courses);

        return courses;
    } catch (error) {
        console.error(`Fallback method failed for ${term} ${year}:`, error);

        // Last resort: return courses with minimal data structure
        try {
            console.log('Attempting minimal fallback...');
            const { data: minimalCourses, error: minimalError } = await supabase
                .from('courses')
                .select(`
                    course_code,
                    title,
                    professor,
                    academic_year,
                    term,
                    time_slot,
                    location,
                    url,
                    color
                `)
                .eq('academic_year', year)
                .eq('term', term);

            if (!minimalError && minimalCourses && minimalCourses.length > 0) {
                console.log(`Minimal fallback successful: ${minimalCourses.length} courses`);
                const minimalProcessed = minimalCourses.map(course => ({
                    ...course,
                    gpa_a_percent: null,
                    gpa_b_percent: null,
                    gpa_c_percent: null,
                    gpa_d_percent: null,
                    gpa_f_percent: null
                }));

                setCourseCacheEntry(year, term, minimalProcessed);
                return minimalProcessed;
            }
        } catch (minimalFallbackError) {
            console.error('Even minimal fallback failed:', minimalFallbackError);
        }

        throw error;
    }
}

// Helper function to fetch historical GPA data for courses that don't have current GPA
async function fetchHistoricalGpaData(courseCodes) {
    try {
        if (courseCodes.length === 0) return {};

        console.log(`Fetching historical GPA data for ${courseCodes.length} course codes...`);

        // Query for historical GPA data, ordered by most recent first
        const { data: historicalData, error } = await supabase
            .from('courses')
            .select(`
                course_code,
                academic_year,
                term,
                professor,
                gpa_a_percent,
                gpa_b_percent,
                gpa_c_percent,
                gpa_d_percent,
                gpa_f_percent
            `)
            .in('course_code', courseCodes)
            .not('gpa_a_percent', 'is', null)
            .order('academic_year', { ascending: false })
            .order('term', { ascending: false });

        if (error) {
            console.error('Error fetching historical GPA data:', error);
            return {};
        }

        if (!historicalData || historicalData.length === 0) {
            console.log('No historical GPA data found');
            return {};
        }

        const termRank = (term) => {
            const normalized = normalizeCourseTerm(term);
            if (normalized === 'Fall') return 4;
            if (normalized === 'Summer') return 3;
            if (normalized === 'Spring') return 2;
            if (normalized === 'Winter') return 1;
            return 0;
        };

        historicalData.sort((a, b) => {
            const yearA = Number.parseInt(a?.academic_year, 10);
            const yearB = Number.parseInt(b?.academic_year, 10);
            const hasYearA = Number.isFinite(yearA);
            const hasYearB = Number.isFinite(yearB);

            if (hasYearA && hasYearB && yearA !== yearB) return yearB - yearA;
            if (hasYearA !== hasYearB) return hasYearA ? -1 : 1;

            const rankDiff = termRank(b?.term) - termRank(a?.term);
            if (rankDiff !== 0) return rankDiff;
            return String(b?.term || '').localeCompare(String(a?.term || ''));
        });

        // Create a map of course_code to most recent GPA data
        const gpaMap = {};
        historicalData.forEach(course => {
            // Only take the first (most recent) entry for each course code
            if (!gpaMap[course.course_code]) {
                // Verify this course actually has GPA data
                const hasValidGPA = (
                    (course.gpa_a_percent !== null && course.gpa_a_percent !== 0) ||
                    (course.gpa_b_percent !== null && course.gpa_b_percent !== 0) ||
                    (course.gpa_c_percent !== null && course.gpa_c_percent !== 0) ||
                    (course.gpa_d_percent !== null && course.gpa_d_percent !== 0) ||
                    (course.gpa_f_percent !== null && course.gpa_f_percent !== 0)
                );

                if (hasValidGPA) {
                    gpaMap[course.course_code] = course;
                }
            }
        });

        console.log(`Found historical GPA data for ${Object.keys(gpaMap).length} courses`);
        return gpaMap;

    } catch (error) {
        console.error('Failed to fetch historical GPA data:', error);
        return {};
    }
}

// Cache for professor change data.
// Keyed by course_code + current offering context so each semester is evaluated independently.
let professorChangeCache = {};

function normalizeProfessorComparisonName(name) {
    return String(name || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function getNormalizedTermSortRank(term) {
    const normalized = normalizeCourseTerm(term);
    if (normalized === 'Fall') return 4;
    if (normalized === 'Summer') return 3;
    if (normalized === 'Spring') return 2;
    if (normalized === 'Winter') return 1;
    return 0;
}

function compareOfferingsDesc(a, b) {
    const yearA = Number.parseInt(a?.academic_year, 10);
    const yearB = Number.parseInt(b?.academic_year, 10);
    const hasYearA = Number.isFinite(yearA);
    const hasYearB = Number.isFinite(yearB);

    if (hasYearA && hasYearB && yearA !== yearB) {
        return yearB - yearA;
    }
    if (hasYearA !== hasYearB) {
        return hasYearA ? -1 : 1;
    }

    const termRankDiff = getNormalizedTermSortRank(b?.term) - getNormalizedTermSortRank(a?.term);
    if (termRankDiff !== 0) return termRankDiff;

    const termA = String(normalizeCourseTerm(a?.term) || '');
    const termB = String(normalizeCourseTerm(b?.term) || '');
    if (termA !== termB) return termB.localeCompare(termA);

    const normalizedYearA = String(normalizeCourseYear(a?.academic_year) ?? '');
    const normalizedYearB = String(normalizeCourseYear(b?.academic_year) ?? '');
    return normalizedYearB.localeCompare(normalizedYearA);
}

function buildProfessorChangeCacheKey(courseCode, context = null) {
    const normalizedCode = String(courseCode || '').trim();
    const normalizedYear = context?.academic_year != null ? String(normalizeCourseYear(context.academic_year)) : '*';
    const normalizedTerm = context?.term ? String(normalizeCourseTerm(context.term)) : '*';
    const normalizedProfessor = context?.professor
        ? normalizeProfessorComparisonName(context.professor)
        : '*';
    return `${normalizedCode}::${normalizedYear}::${normalizedTerm}::${normalizedProfessor || '*'}`;
}

// Function to clear professor change cache (call when semester changes)
export function clearProfessorChangeCache() {
    professorChangeCache = {};
    console.log('Professor change cache cleared');
}

// Determine whether each current course has a different professor compared to
// the immediately previous offering of that same course code.
// Returns a Set of changed course codes.
export async function fetchProfessorChanges(courseCodes, options = {}) {
    if (!courseCodes || courseCodes.length === 0) {
        return new Set();
    }

    const normalizedCodes = Array.from(new Set(
        courseCodes
            .map((code) => String(code || '').trim())
            .filter(Boolean)
    ));
    if (normalizedCodes.length === 0) return new Set();

    const currentCourses = Array.isArray(options?.currentCourses) ? options.currentCourses : [];
    const currentContextByCode = new Map();

    currentCourses.forEach((course) => {
        const code = String(course?.course_code || '').trim();
        if (!code || currentContextByCode.has(code)) return;
        currentContextByCode.set(code, {
            academic_year: course?.academic_year ?? options?.currentYear ?? null,
            term: course?.term ?? options?.currentTerm ?? null,
            professor: course?.professor ?? null
        });
    });

    // If explicit year/term context was provided but no full course objects were,
    // still scope the cache key by that offering.
    if (currentContextByCode.size === 0 && (options?.currentYear != null || options?.currentTerm != null)) {
        normalizedCodes.forEach((code) => {
            currentContextByCode.set(code, {
                academic_year: options?.currentYear ?? null,
                term: options?.currentTerm ?? null,
                professor: null
            });
        });
    }

    const cacheKeyByCode = new Map();
    normalizedCodes.forEach((code) => {
        const context = currentContextByCode.get(code) || null;
        cacheKeyByCode.set(code, buildProfessorChangeCacheKey(code, context));
    });

    const uncachedCodes = normalizedCodes.filter((code) => {
        const cacheKey = cacheKeyByCode.get(code);
        return !(cacheKey in professorChangeCache);
    });

    if (uncachedCodes.length > 0) {
        try {
            console.log(`Checking professor changes for ${uncachedCodes.length} courses...`);

            const { data: courseHistory, error } = await supabase
                .from('courses')
                .select('course_code, professor, academic_year, term')
                .in('course_code', uncachedCodes);

            if (error) {
                console.error('Error fetching professor history:', error);
                return new Set();
            }

            const coursesByCode = {};
            (courseHistory || []).forEach((course) => {
                const code = String(course?.course_code || '').trim();
                if (!code) return;
                if (!coursesByCode[code]) coursesByCode[code] = [];
                coursesByCode[code].push(course);
            });

            uncachedCodes.forEach((code) => {
                const context = currentContextByCode.get(code) || null;
                const cacheKey = cacheKeyByCode.get(code);
                const instances = Array.isArray(coursesByCode[code]) ? coursesByCode[code].slice() : [];

                if (instances.length <= 1) {
                    professorChangeCache[cacheKey] = false;
                    return;
                }

                instances.sort(compareOfferingsDesc);

                const offeringsByKey = new Map();
                instances.forEach((instance) => {
                    const offeringYear = normalizeCourseYear(instance?.academic_year);
                    const offeringTerm = normalizeCourseTerm(instance?.term);
                    const offeringKey = `${offeringYear}::${offeringTerm}`;
                    if (!offeringsByKey.has(offeringKey)) {
                        offeringsByKey.set(offeringKey, {
                            academic_year: offeringYear,
                            term: offeringTerm,
                            professors: new Set()
                        });
                    }
                    const professorName = normalizeProfessorComparisonName(instance?.professor);
                    if (professorName) {
                        offeringsByKey.get(offeringKey).professors.add(professorName);
                    }
                });

                const offerings = Array.from(offeringsByKey.values()).sort(compareOfferingsDesc);
                if (offerings.length <= 1) {
                    professorChangeCache[cacheKey] = false;
                    return;
                }

                let currentOfferingIndex = 0;
                if (context?.academic_year != null && context?.term != null) {
                    const targetYear = normalizeCourseYear(context.academic_year);
                    const targetTerm = normalizeCourseTerm(context.term);
                    const matchedIndex = offerings.findIndex((offering) => (
                        String(normalizeCourseYear(offering.academic_year)) === String(targetYear)
                        && String(normalizeCourseTerm(offering.term)) === String(targetTerm)
                    ));
                    if (matchedIndex >= 0) {
                        currentOfferingIndex = matchedIndex;
                    }
                }

                const currentOffering = offerings[currentOfferingIndex];
                const previousOffering = offerings
                    .slice(currentOfferingIndex + 1)
                    .find((offering) => offering.professors.size > 0) || null;

                if (!currentOffering || !previousOffering) {
                    professorChangeCache[cacheKey] = false;
                    return;
                }

                const contextProfessor = normalizeProfessorComparisonName(context?.professor);
                let hasProfessorChanged = false;

                if (contextProfessor) {
                    hasProfessorChanged = !previousOffering.professors.has(contextProfessor);
                } else if (currentOffering.professors.size > 0) {
                    // Fallback when no explicit current professor was provided.
                    hasProfessorChanged = Array.from(currentOffering.professors)
                        .every((name) => !previousOffering.professors.has(name));
                }

                professorChangeCache[cacheKey] = hasProfessorChanged;
                if (hasProfessorChanged) {
                    console.log(`Professor change detected for ${code}:`, {
                        currentOffering,
                        previousOffering
                    });
                }
            });
        } catch (error) {
            console.error('Error checking professor changes:', error);
            return new Set();
        }
    }

    const changedCourses = new Set();
    normalizedCodes.forEach((code) => {
        const cacheKey = cacheKeyByCode.get(code);
        if (professorChangeCache[cacheKey] === true) {
            changedCourses.add(code);
        }
    });

    console.log(`Found ${changedCourses.size} courses with professor changes`);
    return changedCourses;
}

export async function openCourseInfoMenu(course, updateURL = true, options = {}) {
    console.log('Opening course info menu for:', course);
    const requestVersion = ++courseInfoOpenRequestVersion;
    cleanupActiveCourseInfoTabController();
    const requestedInitialTab = normalizeCourseInfoTab(options?.initialTab || readStoredCourseInfoTab());
    const shouldFocusAssessment = options?.focusAssessment === true;
    const isMobileCourseInfo = isCourseInfoMobileViewport();
    const requestedCourseTitle = getCourseDisplayTitle(course) || 'Course';
    const modalSheetHeaderTitle = 'Course Info';

    // Function to properly format time slots from Japanese to English
    function formatTimeSlot(timeSlot) {
        if (!timeSlot) return 'TBA';
        const raw = String(timeSlot).trim();
        if (!raw) return 'TBA';
        if (/(集中講義|集中)/.test(raw)) return 'Intensive';

        // Japanese day mappings
        const dayMap = {
            "月": "Monday",
            "火": "Tuesday",
            "水": "Wednesday",
            "木": "Thursday",
            "金": "Friday",
            "土": "Saturday",
            "日": "Sunday"
        };

        // Period time mappings
        const timeMap = {
            "1": "09:00 - 10:30",
            "2": "10:45 - 12:15",
            "3": "13:10 - 14:40",
            "4": "14:55 - 16:25",
            "5": "16:40 - 18:10"
        };

        const normalizedDayMap = {
            Mon: "Monday",
            Tue: "Tuesday",
            Wed: "Wednesday",
            Thu: "Thursday",
            Fri: "Friday",
            Sat: "Saturday",
            Sun: "Sunday",
            Monday: "Monday",
            Tuesday: "Tuesday",
            Wednesday: "Wednesday",
            Thursday: "Thursday",
            Friday: "Friday",
            Saturday: "Saturday",
            Sunday: "Sunday"
        };

        const collected = [];
        const seen = new Set();
        const addSlot = (dayName, timeRange) => {
            const normalizedDay = String(dayName || "").trim();
            const normalizedRange = String(timeRange || "").replace(/\s*[–—-]\s*/g, " - ").trim();
            if (!normalizedDay) return;
            const entry = normalizedRange ? `${normalizedDay} ${normalizedRange}` : normalizedDay;
            const key = entry.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            collected.push(entry);
        };

        // Collect Japanese slots: 月曜日3講時・木曜日3講時, (月1講時), etc.
        const japaneseSlots = [...raw.matchAll(/([月火水木金土日])(?:曜日)?\s*([1-5])(?:講時)?/g)];
        japaneseSlots.forEach((slot) => {
            const dayName = dayMap[slot[1]] || slot[1];
            const timeRange = timeMap[slot[2]] || "";
            addSlot(dayName, timeRange);
        });

        // Collect English slots: Mon 13:10 - 14:40 / Thursday 13:10 - 14:40, etc.
        const englishSlots = [...raw.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/gi)];
        englishSlots.forEach((slot) => {
            const dayToken = slot[1];
            const normalizedDay = normalizedDayMap[dayToken] || normalizedDayMap[dayToken.charAt(0).toUpperCase() + dayToken.slice(1).toLowerCase()] || dayToken;
            addSlot(normalizedDay, `${slot[2]} - ${slot[3]}`);
        });

        if (collected.length > 0) {
            return collected.join(" / ");
        }

        // If it's already in a good format or unrecognized, return as-is
        return raw;
    }

    const classInfo = document.getElementById("class-info");
    const courseInfoBody = document.getElementById("course-info-body");
    const courseInfoContentRoot = document.getElementById("course-info-content-root");
    const courseInfoActions = document.getElementById("course-info-actions");
    const courseInfoPeek = document.getElementById("course-info-peek");
    const classClose = document.getElementById("class-close");
    const initialAppPath = getCurrentAppPath();
    const isDedicatedCoursePageRequest = options.presentation === 'page' ||
        (document.body.classList.contains('course-page-mode') && /^\/courses?\//.test(initialAppPath));
    const isStaleRequest = () => {
        if (requestVersion !== courseInfoOpenRequestVersion) return true;
        if (!isDedicatedCoursePageRequest) return false;

        const currentAppPath = getCurrentAppPath();
        const isStillDedicatedRoute =
            /^\/courses?\//.test(currentAppPath) &&
            document.body.classList.contains('course-page-mode');
        return !isStillDedicatedRoute || currentAppPath !== initialAppPath;
    };

    if (!classInfo || !classClose || !courseInfoBody || !courseInfoContentRoot || !courseInfoActions || !courseInfoPeek) {
        console.error("Could not find the class info menu elements in the HTML.");
        console.error("classInfo:", classInfo);
        console.error("courseInfoContentRoot:", courseInfoContentRoot);
        console.error("classClose:", classClose);

        // Try to wait a bit for DOM to be ready and retry once
        setTimeout(() => {
            console.log('Retrying after DOM delay...');
            const retryClassInfo = document.getElementById("class-info");
            const retryCourseInfoContentRoot = document.getElementById("course-info-content-root");
            const retryClassClose = document.getElementById("class-close");
            const retryCourseInfoBody = document.getElementById("course-info-body");
            const retryCourseInfoActions = document.getElementById("course-info-actions");
            const retryCourseInfoPeek = document.getElementById("course-info-peek");

            if (retryClassInfo && retryClassClose && retryCourseInfoBody && retryCourseInfoContentRoot && retryCourseInfoActions && retryCourseInfoPeek) {
                openCourseInfoMenu(course, updateURL, options);
            } else {
                console.error("Still cannot find course modal elements after retry");
            }
        }, 1000);
        return;
    }

    classInfo._activeCourseInfoCourse = { ...course };
    classInfo.dataset.courseInfoRequestVersion = String(requestVersion);
    classInfo.classList.add('courseinfo-sheet');
    classInfo.setAttribute('role', 'dialog');
    classInfo.setAttribute('aria-modal', 'true');
    classInfo.style.removeProperty('--sheet-y');
    classInfo.style.removeProperty('--sheet-radius');

    if (typeof classInfo._courseInfoSheetController?.destroy === 'function') {
        classInfo._courseInfoSheetController.destroy();
    }
    classInfo._courseInfoSheetController = null;

    if (typeof classInfo._focusTrapCleanup === 'function') {
        classInfo._focusTrapCleanup();
        classInfo._focusTrapCleanup = null;
    }
    if (typeof classInfo._mobileTabsResizeCleanup === 'function') {
        classInfo._mobileTabsResizeCleanup();
        classInfo._mobileTabsResizeCleanup = null;
    }
    if (typeof classInfo._courseInfoTabCleanup === 'function') {
        classInfo._courseInfoTabCleanup();
        classInfo._courseInfoTabCleanup = null;
    }
    if (typeof classInfo._courseInfoExternalModalWatchCleanup === 'function') {
        classInfo._courseInfoExternalModalWatchCleanup();
        classInfo._courseInfoExternalModalWatchCleanup = null;
    }
    if (typeof classInfo._courseEvalInteractionsCleanup === 'function') {
        classInfo._courseEvalInteractionsCleanup();
        classInfo._courseEvalInteractionsCleanup = null;
    }
    if (typeof classInfo._courseAssessmentAccordionCleanup === 'function') {
        classInfo._courseAssessmentAccordionCleanup();
        classInfo._courseAssessmentAccordionCleanup = null;
    }
    if (typeof classInfo._classInfoSwipeCleanup === 'function') {
        classInfo._classInfoSwipeCleanup();
        classInfo._classInfoSwipeCleanup = null;
    }
    resetSwipeHandlers(classInfo, '_classInfoSwipeHandlers');
    classInfo._classInfoSwipeHandlers = null;

    const isDedicatedCoursePage = isDedicatedCoursePageRequest;

    const modalReturnPath = !isDedicatedCoursePage ? rememberCourseModalReturnPath(getCurrentAppPath(), classInfo) : null;

    if (isDedicatedCoursePage) {
        CourseInfoPage(classInfo, { headerTitle: requestedCourseTitle });
    } else {
        CourseInfoSheet(classInfo, { headerTitle: modalSheetHeaderTitle });
    }

    const releaseCourseInfoFocusTrap = () => {
        if (typeof classInfo._focusTrapCleanup === 'function') {
            classInfo._focusTrapCleanup();
            classInfo._focusTrapCleanup = null;
        }
    };

    const releaseCourseInfoResizeObserver = () => {
        if (typeof classInfo._mobileTabsResizeCleanup === 'function') {
            classInfo._mobileTabsResizeCleanup();
            classInfo._mobileTabsResizeCleanup = null;
        }
    };

    const releaseCourseInfoExternalModalWatch = () => {
        if (typeof classInfo._courseInfoExternalModalWatchCleanup === 'function') {
            classInfo._courseInfoExternalModalWatchCleanup();
            classInfo._courseInfoExternalModalWatchCleanup = null;
        }
    };

    const releaseCourseInfoHeaderTagsCollapse = () => {
        if (typeof classInfo._courseInfoHeaderTagsCollapseCleanup === 'function') {
            classInfo._courseInfoHeaderTagsCollapseCleanup();
            classInfo._courseInfoHeaderTagsCollapseCleanup = null;
        }
        classInfo.classList.remove('courseinfo-header-tags-collapsed');
    };

    const setupCourseInfoHeaderTagsCollapse = () => {
        releaseCourseInfoHeaderTagsCollapse();

        if (!isCourseInfoMobileViewport()) return;

        const tagsWrap = classInfo.querySelector('[data-courseinfo-header-tags]');
        const scrollHost = classInfo.querySelector('.sheet-body')
            || classInfo.querySelector('.courseinfo-body')
            || classInfo.querySelector('.class-content-wrapper');

        if (!tagsWrap || !scrollHost) return;

        let collapsed = false;
        let rafId = 0;
        let stateObserver = null;

        const applyState = () => {
            rafId = 0;
            const top = Number(scrollHost.scrollTop) || 0;
            const sheetState = String(
                classInfo.dataset.sheetState
                || classInfo._courseInfoSheetController?.getState?.()
                || ''
            );
            const canCollapse = sheetState === 'full';
            const nextCollapsed = canCollapse ? (collapsed ? top > 4 : top > 12) : false;
            if (nextCollapsed === collapsed) return;
            collapsed = nextCollapsed;
            classInfo.classList.toggle('courseinfo-header-tags-collapsed', collapsed);
        };

        const onScroll = () => {
            if (rafId) return;
            rafId = window.requestAnimationFrame(applyState);
        };

        scrollHost.addEventListener('scroll', onScroll, { passive: true });

        if (typeof MutationObserver === 'function') {
            stateObserver = new MutationObserver(() => {
                if (rafId) return;
                rafId = window.requestAnimationFrame(applyState);
            });
            stateObserver.observe(classInfo, {
                attributes: true,
                attributeFilter: ['data-sheet-state']
            });
        }

        applyState();

        classInfo._courseInfoHeaderTagsCollapseCleanup = () => {
            scrollHost.removeEventListener('scroll', onScroll);
            if (stateObserver) {
                stateObserver.disconnect();
                stateObserver = null;
            }
            if (rafId) {
                window.cancelAnimationFrame(rafId);
                rafId = 0;
            }
            classInfo.classList.remove('courseinfo-header-tags-collapsed');
        };
    };

    const releaseCourseEvalOverviewInteractions = () => {
        if (typeof classInfo._courseEvalInteractionsCleanup === 'function') {
            classInfo._courseEvalInteractionsCleanup();
            classInfo._courseEvalInteractionsCleanup = null;
        }
    };
    const releaseCourseAssessmentAccordionInteractions = () => {
        if (typeof classInfo._courseAssessmentAccordionCleanup === 'function') {
            classInfo._courseAssessmentAccordionCleanup();
            classInfo._courseAssessmentAccordionCleanup = null;
        }
    };

    let classInfoBackground = document.getElementById("class-info-background");

    const closeCourseInfoSheet = ({ restoreURL = true, immediate = false } = {}) => {
        const activeBackground = document.getElementById('class-info-background');
        if (typeof classInfo._courseInfoSheetController?.destroy === 'function') {
            classInfo._courseInfoSheetController.destroy();
            classInfo._courseInfoSheetController = null;
        }
        if (activeBackground) {
            activeBackground.style.opacity = '0';
        }
        classInfo.classList.remove("show", "fully-open", "swiping", "is-snapping", "is-dragging");
        delete classInfo.dataset.sheetState;
        classInfo.style.removeProperty('--modal-translate-y');
        classInfo.style.removeProperty('--sheet-y');
        classInfo.style.removeProperty('--sheet-radius');

        const finalizeClose = () => {
            unlockBodyScrollForCourseInfoSheet();
            if (restoreURL && !isDedicatedCoursePage) {
                restoreCourseModalReturnURL(classInfo);
            }

            classInfo.style.transform = '';
            classInfo.style.transition = '';
            classInfo.style.opacity = '';

            releaseCourseInfoFocusTrap();
            releaseCourseInfoResizeObserver();
            releaseCourseInfoExternalModalWatch();
            releaseCourseInfoHeaderTagsCollapse();
            releaseCourseEvalOverviewInteractions();
            releaseCourseAssessmentAccordionInteractions();
            cleanupActiveCourseInfoTabController();

            if (activeBackground && activeBackground.parentNode) {
                activeBackground.parentNode.removeChild(activeBackground);
            }
            classInfoBackground = null;
            classInfo._activeCourseInfoCourse = null;
        };

        if (immediate) {
            finalizeClose();
            return;
        }
        setTimeout(finalizeClose, 400);
    };

    const setupCollapsedCourseInfoAutoCloseWatch = () => {
        if (isDedicatedCoursePage || !isCourseInfoMobileViewport()) return () => { };

        let rafCheck = 0;
        const hasExternalModalOpen = () => {
            if (document.body.classList.contains('modal-open')) return true;
            if (document.querySelector('.semester-mobile-sheet-layer.show, .semester-mobile-sheet.show')) return true;
            if (document.querySelector('.filter-popup.show, .search-modal.show')) return true;
            if (document.querySelector('.modal:not(.hidden), .conflict-container:not(.hidden)')) return true;
            return false;
        };

        const checkAndClose = () => {
            rafCheck = 0;
            if (!classInfo.classList.contains('show')) return;
            const controller = classInfo._courseInfoSheetController;
            if (!controller || controller.getState?.() !== 'collapsed') return;
            if (!hasExternalModalOpen()) return;
            closeCourseInfoSheet({ restoreURL: true, immediate: true });
        };

        const queueCheck = () => {
            if (rafCheck) return;
            rafCheck = window.requestAnimationFrame(checkAndClose);
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' || mutation.type === 'childList') {
                    queueCheck();
                    break;
                }
            }
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true
        });

        document.addEventListener('click', queueCheck, true);

        return () => {
            if (rafCheck) {
                window.cancelAnimationFrame(rafCheck);
                rafCheck = 0;
            }
            observer.disconnect();
            document.removeEventListener('click', queueCheck, true);
        };
    };

    // Update URL if requested (default behavior)
    if (updateURL && course.course_code && course.academic_year && course.term) {
        const newURL = generateCourseURL(course.course_code, course.academic_year, course.term);
        const historyState = { course: course };
        if (!isDedicatedCoursePage && modalReturnPath) {
            historyState.courseModalReturnPath = modalReturnPath;
        }
        window.history.pushState(historyState, '', newURL);
    }

    // Create or get the background overlay (modal mode only)
    if (!isDedicatedCoursePage) {
        if (!classInfoBackground) {
            classInfoBackground = document.createElement("div");
            classInfoBackground.id = "class-info-background";
            classInfoBackground.classList.add('courseinfo-backdrop');
            document.body.appendChild(classInfoBackground);

            // Close menu when clicking background
            classInfoBackground.addEventListener("click", function () {
                const state = classInfo._courseInfoSheetController?.getState?.();
                if (!state || state === 'half' || state === 'full') {
                    closeCourseInfoSheet({ restoreURL: true });
                }
            });
        }
    } else if (classInfoBackground && classInfoBackground.parentNode) {
        classInfoBackground.parentNode.removeChild(classInfoBackground);
        classInfoBackground = null;
    }
    if (classInfoBackground) {
        classInfoBackground.classList.add('courseinfo-backdrop');
    }

    // Get course color from the course data based on type
    const courseColor = getCourseColorByType(course.type);

    // Use the type directly from the database
    const courseType = isGraduateCourse(course)
        ? 'Graduate'
        : (course.type || 'General');

    // Check if course is already selected by user (for time slot background color)
    let isAlreadySelected = false;
    let savedCoursesList = [];
    let isSavedForLater = false;
    let profileData = null;
    let currentUserYearLevel = null;
    let requiredYearMeta = getCourseRequiredYearMeta(course, null);
    let shouldBlockRegistrationByYear = false;
    let shouldWarnUnknownYear = false;
    const hasMissingProfileColumnError = (error) => {
        const code = String(error?.code || '').toUpperCase();
        const message = String(error?.message || '').toLowerCase();
        return code === '42703' || (message.includes('column') && message.includes('does not exist'));
    };
    const { data: { session } } = await supabase.auth.getSession();
    if (isStaleRequest()) return;
    if (session) {
        savedCoursesList = readSavedCourses(Number.POSITIVE_INFINITY);
        let profileResponse = await supabase
            .from('profiles')
            .select('courses_selection, saved_courses, current_year, year_opt_out, year')
            .eq('id', session.user.id)
            .single();
        if (profileResponse.error && hasMissingProfileColumnError(profileResponse.error)) {
            profileResponse = await supabase
                .from('profiles')
                .select('courses_selection, saved_courses')
                .eq('id', session.user.id)
                .single();
        }

        profileData = profileResponse?.data || null;
        if (isStaleRequest()) return;

        if (profileData?.courses_selection) {
            // Filter courses by current year and term, then check if this course is selected
            const currentYearCourses = filterCoursesByCurrentYearTerm(profileData.courses_selection);
            isAlreadySelected = currentYearCourses.some(selected =>
                selected.code === course.course_code
            );
        }

        currentUserYearLevel = parseProfileCurrentYearLevel(profileData);
        requiredYearMeta = getCourseRequiredYearMeta(course, currentUserYearLevel);
        shouldBlockRegistrationByYear = requiredYearMeta.hasRequiredYear
            && requiredYearMeta.hasKnownUserYear
            && !requiredYearMeta.meetsRequirement;
        shouldWarnUnknownYear = requiredYearMeta.hasRequiredYear && !requiredYearMeta.hasKnownUserYear;

        try {
            savedCoursesList = await syncSavedCoursesForUser(session.user.id);
            if (isStaleRequest()) return;
            isSavedForLater = isCourseSaved(course, savedCoursesList);
        } catch (savedSyncError) {
            console.warn('Unable to sync saved courses for course info:', savedSyncError);
            const profileSaved = Array.isArray(profileData?.saved_courses) ? profileData.saved_courses : [];
            savedCoursesList = [...savedCoursesList, ...profileSaved];
            isSavedForLater = isCourseSaved(course, savedCoursesList);
        }
    }
    // Reference to the exported checkTimeConflict function defined later in the file
    const checkTimeConflictForModal = async (timeSlot, courseCode, academicYear) => {
        // This will reference the exported function defined at the bottom of the file
        return await window.checkTimeConflictExported(timeSlot, courseCode, academicYear);
    };
    let updateFooterActionLayout = () => { };
    let syncRegistrationStatusBadge = () => { };

    function applyClassInfoCourseActionButtonState(button, state) {
        if (!button) return;

        button.classList.add('control-surface', 'class-info-course-action');
        button.classList.remove('is-add', 'is-remove', 'is-locked', 'is-ineligible');
        button.style.background = '';
        button.style.color = '';
        button.style.cursor = '';

        if (state === 'locked') {
            button.textContent = "Registration Closed";
            button.classList.add('is-locked');
            button.disabled = true;
            button.style.cursor = "not-allowed";
            return;
        }

        if (state === 'ineligible') {
            button.textContent = "Ineligible";
            button.classList.add('is-ineligible');
            button.disabled = true;
            button.style.cursor = "not-allowed";
            return;
        }

        if (state === 'remove') {
            button.textContent = "Remove Course";
            button.classList.add('is-remove');
        } else {
            button.textContent = "Register";
            button.classList.add('is-add');
        }

        button.disabled = false;
        button.style.cursor = "pointer";
    }

    // Function to update course button state after authentication
    const updateCourseButtonState = async (course, button) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

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
            const profile = profileResponse?.data || null;

            const currentSelection = profile?.courses_selection || [];
            currentUserYearLevel = parseProfileCurrentYearLevel(profile);
            requiredYearMeta = getCourseRequiredYearMeta(course, currentUserYearLevel);
            shouldBlockRegistrationByYear = requiredYearMeta.hasRequiredYear
                && requiredYearMeta.hasKnownUserYear
                && !requiredYearMeta.meetsRequirement;
            shouldWarnUnknownYear = requiredYearMeta.hasRequiredYear && !requiredYearMeta.hasKnownUserYear;

            const currentYearCourses = filterCoursesByCurrentYearTerm(currentSelection);
            const isCurrentlySelected = currentYearCourses.some(selected =>
                selected.code === course.course_code
            );
            isAlreadySelected = isCurrentlySelected;
            updateFooterActionLayout(isCurrentlySelected);

            if (!isCurrentSemester()) {
                applyClassInfoCourseActionButtonState(button, 'locked');
            } else if (isCurrentlySelected) {
                applyClassInfoCourseActionButtonState(button, 'remove');
            } else if (shouldBlockRegistrationByYear) {
                applyClassInfoCourseActionButtonState(button, 'ineligible');
            } else {
                applyClassInfoCourseActionButtonState(button, 'add');
            }
            syncRegistrationStatusBadge();
        } catch (error) {
            console.error('Error updating course button state:', error);
        }
    };

    const locationValue = course.location || course.classroom || course.room || null;
    const compactTimeLabel = formatCourseTimeCompactLabel(course.time_slot);
    const fullTimeLabel = formatTimeSlot(course.time_slot);
    const heroSubline = course.department || course.track || course.category || '';
    const courseCodeValue = String(course.course_code || '').trim() || 'N/A';
    const timeDetailLabel = fullTimeLabel || compactTimeLabel || 'TBA';
    const evaluationMeta = getCourseEvaluationMeta(course);
    const courseInfoInlineWarnings = [];
    const graduateRequirementsText = extractGraduateRequirementsText(course);
    const graduateRegistrationMethod = extractGraduateRegistrationMethodText(course);
    const graduateRegistrationWindow = extractGraduateRegistrationWindowText(course);
    const graduateRegistrationUrl = extractGraduateRegistrationUrl(course);
    const graduateRegistrationDetails = [
        graduateRequirementsText,
        graduateRegistrationMethod ? `How to register: ${graduateRegistrationMethod}` : '',
        graduateRegistrationWindow ? `Registration window: ${graduateRegistrationWindow}` : ''
    ].filter(Boolean);
    if (graduateRegistrationDetails.length > 0) {
        courseInfoInlineWarnings.push({
            kind: 'warning',
            expandable: true,
            title: 'Class Registration Details',
            items: graduateRegistrationDetails,
            link: graduateRegistrationUrl
                ? {
                    href: graduateRegistrationUrl,
                    label: 'Open registration form'
                }
                : null
        });
    }
    if (session && requiredYearMeta.hasRequiredYear && requiredYearMeta.hasKnownUserYear && !requiredYearMeta.meetsRequirement) {
        if (isAlreadySelected) {
            courseInfoInlineWarnings.push({
                kind: 'error',
                text: `Your profile is set to ${requiredYearMeta.userYearLabel}, but this course requires ${requiredYearMeta.requiredYearLabel} for new registrations.`
            });
        } else {
            courseInfoInlineWarnings.push({
                kind: 'error',
                text: `Your profile is set to ${requiredYearMeta.userYearLabel}, but this course requires ${requiredYearMeta.requiredYearLabel}`
            });
        }
    } else if (session && shouldWarnUnknownYear) {
        courseInfoInlineWarnings.push({
            kind: 'warning',
            text: `We could not verify your current year. You can still register, but this course requires ${requiredYearMeta.requiredYearLabel}`
        });
    }
    const visibleBadges = [
        ...(session ? [{
            label: isAlreadySelected ? 'Registered' : 'Not registered',
            variant: isAlreadySelected ? 'success' : 'muted',
            role: 'registration-status'
        }] : []),
        ...(requiredYearMeta.hasRequiredYear
            ? [{
                label: `Required: ${requiredYearMeta.requiredYearLabel}`,
                variant: (session && requiredYearMeta.hasKnownUserYear)
                    ? (requiredYearMeta.meetsRequirement ? 'success' : 'muted')
                    : 'default',
                role: 'required-year-status'
            }]
            : [{
                label: 'Open to all years',
                variant: 'default',
                role: 'required-year-status'
            }]),
        ...(isMobileCourseInfo
            ? (isSavedForLater ? [{ label: 'Saved', variant: 'success', role: 'saved-status' }] : [])
            : (session ? [{
                label: isSavedForLater ? 'Saved' : 'Not saved',
                variant: isSavedForLater ? 'success' : 'muted',
                role: 'saved-status'
            }] : [])),
        ...(formatCourseCreditsLabel(course.credits) ? [{ label: formatCourseCreditsLabel(course.credits), variant: 'default' }] : []),
        { label: courseType, variant: 'default', dotColor: courseColor }
    ];
    const resolvedCourseTitle = getCourseDisplayTitle(course) || 'Course';
    const courseInfoModel = {
        headerTitle: isDedicatedCoursePage ? resolvedCourseTitle : modalSheetHeaderTitle,
        title: resolvedCourseTitle,
        titleDotColor: courseColor,
        subline: heroSubline,
        badges: visibleBadges,
        heroActions: [
            { label: 'Share', action: 'share-course', variant: 'secondary', icon: 'pill-icon--share' },
            ...(course.url ? [{ label: 'Syllabus', action: 'open-syllabus', href: course.url, variant: 'secondary', icon: 'pill-icon--external' }] : [])
        ],
        evaluation: evaluationMeta,
        detailRows: [
            { label: 'Professor', value: formatProfessorDisplayName(course.professor) },
            { label: 'Course Code', value: courseCodeValue },
            { label: 'Course Type', value: courseType },
            ...(isGraduateJapaneseTaughtCourse(course) ? [{ label: 'Language', value: 'Japanese' }] : []),
            { label: 'Required year', value: requiredYearMeta.requiredYearLabel },
            ...(course.credits ? [{ label: 'Credits', value: formatCourseCreditsLabel(course.credits) }] : []),
            { label: 'Time', value: timeDetailLabel },
            { label: 'Term', value: formatCourseTermYearLabel(course) },
            ...(locationValue ? [{ label: 'Location', value: locationValue }] : [])
        ],
        inlineWarnings: courseInfoInlineWarnings
    };
    if (isStaleRequest()) return;
    syncCourseInfoHeaderPresentation(classInfo, courseInfoModel, { isMobile: isMobileCourseInfo && !isDedicatedCoursePage });

    courseInfoPeek.classList.add('courseinfo-peek');
    courseInfoPeek.hidden = !isMobileCourseInfo;
    courseInfoPeek.setAttribute('aria-hidden', isMobileCourseInfo ? 'false' : 'true');

    courseInfoContentRoot.innerHTML = `
        <div class="class-content" id="class-content"></div>
        <div class="class-content" id="class-gpa-graph"></div>
        <div class="class-content" id="class-assignments"></div>
        <div class="class-content" id="class-review"></div>
    `;

    const classContent = courseInfoContentRoot.querySelector("#class-content");
    const classGPA = courseInfoContentRoot.querySelector("#class-gpa-graph");
    const classReview = courseInfoContentRoot.querySelector("#class-review");
    const classAssignments = courseInfoContentRoot.querySelector("#class-assignments");
    const resetCourseInfoBodyScroll = () => {
        const bodyScroller = classInfo.querySelector('.sheet-body')
            || classInfo.querySelector('.courseinfo-body')
            || classInfo.querySelector('.class-content-wrapper');

        if (bodyScroller) {
            bodyScroller.scrollTop = 0;
        }

        if (courseInfoBody) {
            courseInfoBody.scrollTop = 0;
        }

        if (courseInfoContentRoot) {
            courseInfoContentRoot.scrollTop = 0;
            courseInfoContentRoot.querySelectorAll('.course-info-tab-panel').forEach((panel) => {
                panel.scrollTop = 0;
            });
        }
    };
    let guestAssignmentsModalOverlayEnabled = false;
    let syncGuestAssignmentsModalOverlayForTab = () => {
        classInfo.classList.remove('courseinfo-guest-assignments-preview');
    };

    if (!classContent || !classGPA || !classReview || !classAssignments) {
        console.error("Course info internal sections failed to mount.");
        return;
    }

    classContent.innerHTML = CourseInfoContent(courseInfoModel, {
        isMobile: isMobileCourseInfo && !isDedicatedCoursePage,
        placeConflictInsideTimeRowOnMobile: isMobileCourseInfo
    });
    releaseCourseEvalOverviewInteractions();
    releaseCourseAssessmentAccordionInteractions();
    classInfo._courseEvalInteractionsCleanup = bindCourseEvaluationOverviewInteractions(classContent, classInfo);
    classInfo._courseAssessmentAccordionCleanup = bindAssessmentBreakdownAccordionAnimations(classContent);
    const focusAssessmentBreakdown = () => {
        if (!shouldFocusAssessment) return;
        const target = classContent.querySelector('#course-assessment-breakdown');
        if (!target) return;
        target.classList.add('is-targeted');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => target.classList.remove('is-targeted'), 1200);
    };

    syncRegistrationStatusBadge = () => {
        const badgesWrap = classContent.querySelector('.ds-badges') || classInfo.querySelector('[data-courseinfo-header-tags]');
        if (!badgesWrap) return;

        let registrationBadge = badgesWrap.querySelector('[data-badge-role="registration-status"]');
        if (!session) {
            registrationBadge?.remove();
            return;
        }

        if (!registrationBadge) {
            registrationBadge = document.createElement('span');
            registrationBadge.dataset.badgeRole = 'registration-status';
            badgesWrap.insertBefore(registrationBadge, badgesWrap.firstChild || null);
        }

        registrationBadge.className = `ds-badge ${isAlreadySelected ? 'ds-badge--success' : 'ds-badge--muted'}`;
        registrationBadge.textContent = isAlreadySelected ? 'Registered' : 'Not registered';
    };
    syncRegistrationStatusBadge();

    const syncSavedStatusBadge = () => {
        const badgesWrap = classContent.querySelector('.ds-badges') || classInfo.querySelector('[data-courseinfo-header-tags]');
        if (!badgesWrap) return;

        let savedBadge = badgesWrap.querySelector('[data-badge-role="saved-status"]');
        if ((!session && !isSavedForLater) || (isMobileCourseInfo && !isSavedForLater)) {
            savedBadge?.remove();
            return;
        }

        if (!savedBadge) {
            savedBadge = document.createElement('span');
            savedBadge.dataset.badgeRole = 'saved-status';
            badgesWrap.insertBefore(savedBadge, badgesWrap.children[1] || null);
        }

        savedBadge.className = `ds-badge ${isSavedForLater ? 'ds-badge--success' : 'ds-badge--muted'}`;
        savedBadge.textContent = isSavedForLater ? 'Saved' : 'Not saved';
    };
    syncSavedStatusBadge();

    classContent.querySelectorAll('[data-action="share-course"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (typeof window.shareCourseURL === 'function') {
                window.shareCourseURL();
            }
        });
    });
    classContent.querySelectorAll('[data-action="open-syllabus"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const href = btn.getAttribute('data-href');
            if (href) window.open(href, '_blank');
        });
    });

    classInfo.querySelectorAll('.courseinfo-header-actions [data-action="share-course"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (typeof window.shareCourseURL === 'function') {
                window.shareCourseURL();
            }
        });
    });
    classInfo.querySelectorAll('.courseinfo-header-actions [data-action="open-syllabus"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const href = btn.getAttribute('data-href');
            if (href) window.open(href, '_blank');
        });
    });

    const updateOverviewAssignmentsShortcut = () => { };

    const gpaA = "#92ECB0";
    const gpaB = "#D1E7C9";
    const gpaC = "#F6EBC1";
    const gpaD = "#FFDD55";
    const gpaF = "#ED7F81";

    // Reset GPA section for the newly mounted course-info render tree
    classGPA.innerHTML = '';
    classGPA.style.display = 'none';
    classGPA.classList.remove('ds-card');

    // Check if we have valid GPA data (all percentages must be non-null)
    const hasValidGpaData = course.gpa_a_percent !== null &&
        course.gpa_b_percent !== null &&
        course.gpa_c_percent !== null &&
        course.gpa_d_percent !== null &&
        course.gpa_f_percent !== null;

    // Check if professor has changed (new professor means GPA from previous semester not applicable)
    let hasProfessorChanged = false;
    if (course.course_code) {
        try {
            const professorChanges = await fetchProfessorChanges([course.course_code], {
                currentCourses: [course],
                currentYear: course?.academic_year ?? null,
                currentTerm: course?.term ?? null
            });
            if (isStaleRequest()) return;
            hasProfessorChanged = professorChanges.has(course.course_code);
        } catch (error) {
            console.warn('Could not check professor changes:', error);
        }
    }
    const isGpaProfessorAligned = isCourseGpaAlignedWithCurrentProfessor(course);

    console.log('Course GPA data check:', {
        courseCode: course.course_code,
        gpa_a_percent: course.gpa_a_percent,
        gpa_b_percent: course.gpa_b_percent,
        gpa_c_percent: course.gpa_c_percent,
        gpa_d_percent: course.gpa_d_percent,
        gpa_f_percent: course.gpa_f_percent,
        hasValidGpaData,
        hasProfessorChanged,
        isGpaProfessorAligned,
        gpa_professor_source: course.gpa_professor_source,
        gpa_year_source: course.gpa_year_source,
        gpa_term_source: course.gpa_term_source
    });

    // Show GPA only if we have valid data, previous-offering professor compatibility,
    // and the GPA source professor matches the current professor.
    if (hasValidGpaData && !hasProfessorChanged && isGpaProfessorAligned) {
        const clampGpaPercent = (value) => {
            const parsed = Number.parseFloat(value);
            if (!Number.isFinite(parsed)) return 0;
            return Math.max(0, Math.min(100, parsed));
        };
        const formatGpaPercent = (value) => {
            const clamped = clampGpaPercent(value);
            return Number.isInteger(clamped)
                ? String(clamped)
                : clamped.toFixed(1).replace(/\.0$/, '');
        };

        const gpaAValue = formatGpaPercent(course.gpa_a_percent);
        const gpaBValue = formatGpaPercent(course.gpa_b_percent);
        const gpaCValue = formatGpaPercent(course.gpa_c_percent);
        const gpaDValue = formatGpaPercent(course.gpa_d_percent);
        const gpaFValue = formatGpaPercent(course.gpa_f_percent);

        classGPA.style.display = 'block';
        const useDsCardGpa = true;
        classGPA.classList.toggle('ds-card', useDsCardGpa);
        classGPA.innerHTML = `
            ${useDsCardGpa
                ? '<div class="ds-card-header"><h3>Grade Distribution</h3></div>'
                : '<p class="class-subtitle">Grade Distribution</p>'}
            <div class="class-info-container gpa-layout">
                <div class="gpa-container"><h3>A</h3><div class="gpa-bar-graph" style="background: ${gpaA}; width: ${gpaAValue}%;"><h3>${gpaAValue}%</h3></div></div>
                <div class="gpa-container"><h3>B</h3><div class="gpa-bar-graph" style="background: ${gpaB}; width: ${gpaBValue}%;"><h3>${gpaBValue}%</h3></div></div>
                <div class="gpa-container"><h3>C</h3><div class="gpa-bar-graph" style="background: ${gpaC}; width: ${gpaCValue}%;"><h3>${gpaCValue}%</h3></div></div>
                <div class="gpa-container"><h3>D</h3><div class="gpa-bar-graph" style="background: ${gpaD}; width: ${gpaDValue}%;"><h3>${gpaDValue}%</h3></div></div>
                <div class="gpa-container"><h3>F</h3><div class="gpa-bar-graph" style="background: ${gpaF}; width: ${gpaFValue}%;"><h3>${gpaFValue}%</h3></div></div>
            </div>
        `;
    } else {
        // If no valid GPA data or professor has changed, ensure the element stays hidden
        const reason = hasProfessorChanged
            ? 'new professor compared to previous offering (previous GPA not applicable)'
            : (!isGpaProfessorAligned
                ? 'latest available GPA source belongs to a different professor'
                : 'no valid GPA data');
        console.log(`GPA hidden for course ${course.course_code}: ${reason}`);
    }

    // Function to load course reviews
    async function loadCourseReviews(courseCode, academicYear, courseTitle = '') {
        try {
            const equivalentCourseCodes = await resolveEquivalentCourseCodesForReviews({
                courseCode,
                courseTitle
            });

            // Build the query - if academicYear is null, get reviews from all years
            let query = applyCourseReviewCodeFilter(
                supabase
                .from('course_reviews')
                .select('*'),
                equivalentCourseCodes,
                courseCode
            )
                .order('created_at', { ascending: false });

            // Only filter by academic year if it's provided
            if (academicYear !== null) {
                query = query.eq('academic_year', academicYear);
            }

            const { data: reviews, error: reviewsError } = await query;

            if (reviewsError) {
                console.error('Error loading reviews:', reviewsError);
                return [];
            }

            if (!reviews || reviews.length === 0) {
                return [];
            }

            // Then, get user profiles for each review
            const userIds = reviews.map(review => review.user_id);

            // Get user profiles from profiles table
            let profiles = null;
            let profilesError = null;

            // Try common column name variations for profiles table
            const possibleSelects = [
                'id, display_name, avatar_url',
                'id, name, avatar_url',
                'id, full_name, avatar_url',
                'id, username, avatar_url',
                'id, email, avatar_url',
                '*'
            ];

            for (let selectString of possibleSelects) {
                const { data: profilesData, error: err } = await supabase
                    .from('profiles')
                    .select(selectString)
                    .in('id', userIds);

                if (!err) {
                    profiles = profilesData;
                    break;
                } else {
                    profilesError = err;
                }
            }

            // If still no profiles, try getting current user info differently
            if (!profiles || profiles.length === 0) {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    // Create a mock profile for the current user if their review is in the list
                    if (userIds.includes(session.user.id)) {
                        profiles = [{
                            id: session.user.id,
                            display_name: session.user.user_metadata?.display_name ||
                                session.user.user_metadata?.name ||
                                session.user.user_metadata?.full_name ||
                                session.user.email?.split('@')[0] ||
                                'Current User',
                            avatar_url: session.user.user_metadata?.avatar_url || null,
                            email: session.user.email
                        }];
                    }
                }
            }

            if (!profiles || profiles.length === 0) {
                // Guest users can legitimately have no readable profile rows.
                if (profilesError) {
                    console.warn('Profiles unavailable for course reviews; using anonymous fallback.', profilesError);
                }
                return reviews.map(review => ({
                    ...review,
                    profiles: { display_name: 'Anonymous User', avatar_url: null }
                }));
            }

            // Get current session once for all reviews
            const { data: { session } } = await supabase.auth.getSession();

            // Combine reviews with profile data
            const reviewsWithProfiles = reviews.map(review => {
                const profile = profiles?.find(p => p.id === review.user_id);

                if (profile) {
                    // Try different possible column names for the display name
                    let displayName = profile.display_name ||
                        profile.name ||
                        profile.full_name ||
                        profile.username ||
                        profile.email;

                    // If display_name is null/undefined and we still don't have a name, try to get it from session
                    if (!displayName || displayName === null) {
                        if (session && session.user && session.user.id === review.user_id) {
                            displayName = session.user.email?.split('@')[0] || 'Current User';
                        } else {
                            displayName = 'Anonymous User';
                        }
                    }

                    return {
                        ...review,
                        profiles: {
                            display_name: displayName,
                            avatar_url: profile.avatar_url || null
                        }
                    };
                } else {
                    // If no profile found, try to get current user info
                    if (session && session.user && session.user.id === review.user_id) {
                        const displayName = session.user.email?.split('@')[0] || 'Current User';
                        return {
                            ...review,
                            profiles: {
                                display_name: displayName,
                                avatar_url: null
                            }
                        };
                    }

                    return {
                        ...review,
                        profiles: { display_name: 'Anonymous User', avatar_url: null }
                    };
                }
            });

            return reviewsWithProfiles;

        } catch (error) {
            console.error('Error loading course reviews:', error);
            return [];
        }
    }

    // Function to calculate review statistics
    function calculateReviewStats(reviews) {
        if (!reviews || reviews.length === 0) {
            return {
                averageRating: 0,
                averageQualityRating: 0,
                averageDifficultyRating: 0,
                totalReviews: 0,
                ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
            };
        }

        const totalQualityRating = reviews.reduce((sum, review) => sum + getReviewQualityRating(review), 0);
        const totalDifficultyRating = reviews.reduce((sum, review) => sum + getReviewDifficultyRating(review), 0);
        const averageQualityRating = (totalQualityRating / reviews.length).toFixed(2);
        const averageDifficultyRating = (totalDifficultyRating / reviews.length).toFixed(2);

        const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        reviews.forEach(review => {
            const qualityRating = getReviewQualityRating(review);
            if (qualityRating >= 1 && qualityRating <= 5) {
                ratingDistribution[qualityRating]++;
            }
        });

        return {
            averageRating: parseFloat(averageQualityRating),
            averageQualityRating: parseFloat(averageQualityRating),
            averageDifficultyRating: parseFloat(averageDifficultyRating),
            totalReviews: reviews.length,
            ratingDistribution
        };
    }

    // Function to render star rating
    function renderStarRating(rating, size = 'small') {
        const stars = [];
        const sizeClass = size === 'large' ? 'star-large' : 'star-small';

        for (let i = 1; i <= 5; i++) {
            if (i <= rating) {
                stars.push(`<span class="star ${sizeClass} filled"></span>`);
            } else {
                stars.push(`<span class="star ${sizeClass}"></span>`);
            }
        }
        return stars.join('');
    }

    // Function to format date
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    // Function to render individual review
    function renderReview(review, currentUserId = null, anonymousName = null, avatarSrc = null) {
        const isOwnReview = currentUserId && review.user_id === currentUserId;
        const qualityRating = getReviewQualityRating(review);
        const difficultyRating = getReviewDifficultyRating(review);
        const rawContent = String(review.content || '');
        const safeContent = escapeHtml(rawContent).replace(/\n/g, '<br>');
        const safeCourseTermLabel = `${review.term?.includes('/') ? review.term.split('/')[1] : review.term || 'Term'} ${review.academic_year || ''}`.trim();
        const safeDate = formatDate(review.created_at);
        const hasWrittenContent = rawContent.trim().length > 0;
        const isGuestViewer = !currentUserId;
        const shouldClampText = !isGuestViewer && hasWrittenContent && (rawContent.trim().length > 180 || rawContent.includes('\n'));
        const reviewId = String(review.id || '');
        const escapedCourseTitle = String(course.title || '').replace(/'/g, "\\'");
        const escapedContentForEdit = rawContent.replace(/'/g, "\\'");
        const editArgs = `'${review.id}', '${review.course_code}', '${review.term}', ${qualityRating}, ${difficultyRating}, '${escapedContentForEdit}', ${review.academic_year}, '${escapedCourseTitle}'`;
        const cardAriaLabel = isOwnReview ? `Edit your review from ${safeCourseTermLabel}` : '';
        const ownReviewBody = `
            <div class="course-review-card-body-stack">
                <div class="review-stats-row" aria-label="Review ratings summary">
                    <div class="review-stat-cell review-stat-cell--quality" aria-label="Quality rating ${qualityRating} out of 5">
                        <span class="review-rating-label">Quality</span>
                        <span class="review-rating-inline">
                            <span class="review-rating-stars" aria-hidden="true">${renderStarRating(qualityRating, 'small')}</span>
                            <span class="review-rating-count">
                                <span class="review-rating-count-main">${qualityRating}</span>
                                <span class="review-rating-count-suffix">/5</span>
                            </span>
                        </span>
                    </div>
                    <div class="review-stat-cell review-stat-cell--difficulty" aria-label="Difficulty rating ${difficultyRating} out of 5">
                        <span class="review-rating-label">Difficulty</span>
                        <span class="review-difficulty-score" aria-hidden="true">
                            <span class="review-difficulty-score-main">${difficultyRating}</span><span class="review-difficulty-score-max">/5</span>
                        </span>
                    </div>
                </div>
                <div class="review-note-row${hasWrittenContent ? '' : ' review-note-row--empty'}">
                    ${hasWrittenContent ? `
                        <p class="course-review-text-excerpt is-own-review">${safeContent}</p>
                    ` : `
                        <p class="course-review-text-empty">No written review provided.</p>
                        <button type="button" class="course-review-inline-action course-review-inline-action--pill" data-action="review-add-note">Write Review</button>
                    `}
                </div>
            </div>
        `;
        const peerReviewBody = `
            <div class="course-review-card-body-stack">
                <div class="review-stats-row" aria-label="Review ratings summary">
                    <div class="review-stat-cell review-stat-cell--quality" aria-label="Quality rating ${qualityRating} out of 5">
                        <span class="review-rating-label">Quality</span>
                        <span class="review-rating-inline">
                            <span class="review-rating-stars" aria-hidden="true">${renderStarRating(qualityRating, 'small')}</span>
                            <span class="review-rating-count">
                                <span class="review-rating-count-main">${qualityRating}</span>
                                <span class="review-rating-count-suffix">/5</span>
                            </span>
                        </span>
                    </div>
                    <div class="review-stat-cell review-stat-cell--difficulty" aria-label="Difficulty rating ${difficultyRating} out of 5">
                        <span class="review-rating-label">Difficulty</span>
                        <span class="review-difficulty-score" aria-hidden="true">
                            <span class="review-difficulty-score-main">${difficultyRating}</span><span class="review-difficulty-score-max">/5</span>
                        </span>
                    </div>
                </div>
                <div class="review-note-row${hasWrittenContent ? '' : ' review-note-row--empty'}">
                    ${hasWrittenContent ? `
                        <p class="course-review-text-excerpt${shouldClampText ? ' is-clamped' : ''}">${safeContent}</p>
                        ${shouldClampText ? '<button type="button" class="course-review-inline-action" data-action="review-show-more" aria-expanded="false">Show More</button>' : ''}
                    ` : `
                        <p class="course-review-text-empty">No written review provided.</p>
                    `}
                </div>
            </div>
        `;
        return `
            <div class="review-item course-review-card${isOwnReview ? ' course-review-card--own' : ''}" data-review-id="${escapeHtml(reviewId)}" data-review-owned="${isOwnReview ? 'true' : 'false'}"${isOwnReview ? ` tabindex="0" role="button" aria-label="${escapeHtml(cardAriaLabel)}"` : ''}>
                <div class="review-header course-review-card-header">
                    <div class="course-review-card-meta">
                        ${isOwnReview ? '<span class="course-review-own-badge">Your Review</span>' : ''}
                        <span class="term-label">${escapeHtml(safeCourseTermLabel)}</span>
                    </div>
                    <div class="course-review-card-trailing">
                        <p class="review-date course-review-card-date">${escapeHtml(safeDate)}</p>
                        ${isOwnReview ? `
                            <button type="button" class="btn-secondary review-card-edit-btn" data-action="edit-review-card" onclick="event.stopPropagation(); openEditReviewModal(${editArgs});">
                                <span class="pill-icon--edit" aria-hidden="true"></span>
                                <span>Edit</span>
                            </button>
                        ` : ''}
                    </div>
                </div>
                ${isOwnReview ? ownReviewBody : peerReviewBody}
            </div>
        `;
    }

    function renderOwnReviewCard(review) {
        if (!currentUserId) return '';

        if (!review) {
            return `
                <section class="your-review-card">
                    <div class="ds-card-header">
                        <h3>Your Review</h3>
                        <button type="button" class="btn-secondary review-card-edit-btn" data-action="your-review-write">
                            <span>Write Review</span>
                        </button>
                    </div>
                    <p class="course-review-text-empty">No written review provided.</p>
                </section>
            `;
        }

        const qualityRating = getReviewQualityRating(review);
        const difficultyRating = getReviewDifficultyRating(review);
        const rawContent = String(review.content || '');
        const safeContent = escapeHtml(rawContent).replace(/\n/g, '<br>');
        const hasWrittenContent = rawContent.trim().length > 0;
        const ratingRows = `
            <div class="review-rating-lines course-review-card-ratings course-review-card-ratings--compact" aria-label="Your review ratings">
                <div class="review-rating-line review-rating-line--quality" aria-label="Quality rating ${qualityRating} out of 5">
                    <span class="review-rating-label">Quality</span>
                    <span class="review-rating-inline">
                        <span class="review-rating-stars" aria-hidden="true">${renderStarRating(qualityRating, 'small')}</span>
                        <span class="review-rating-count">
                            <span class="review-rating-count-main">${qualityRating}</span>
                            <span class="review-rating-count-suffix">/5</span>
                        </span>
                    </span>
                </div>
                <div class="review-rating-line review-rating-line--difficulty" aria-label="Difficulty rating ${difficultyRating} out of 5">
                    <span class="review-rating-label">Difficulty</span>
                    <span class="review-difficulty-score" aria-hidden="true">
                        <span class="review-difficulty-score-main">${difficultyRating}</span><span class="review-difficulty-score-max">/5</span>
                    </span>
                </div>
            </div>
        `;

        return `
            <section class="your-review-card">
                <div class="ds-card-header">
                    <h3>Your Review</h3>
                    <button type="button" class="btn-secondary review-card-edit-btn" data-action="your-review-edit">
                        <span class="pill-icon--edit" aria-hidden="true"></span>
                        <span>Edit</span>
                    </button>
                </div>
                ${ratingRows}
                ${hasWrittenContent ? `
                    <div class="your-review-text-wrap">
                        <p class="your-review-text course-review-text-excerpt">${safeContent}</p>
                    </div>
                ` : `
                    <div class="your-review-empty-state">
                        <p class="course-review-text-empty">No written review provided.</p>
                        <button type="button" class="btn-primary course-review-inline-action--pill" data-action="your-review-edit">Write Review</button>
                    </div>
                `}
            </section>
        `;
    }

    // Load reviews for this course from all terms/years.
    const allReviews = await loadCourseReviews(course.course_code, null, String(course.title || ''));
    if (isStaleRequest()) return;

    // Get current user ID for edit functionality (using session already declared above)
    const currentUserId = session?.user?.id;

    // Check if current user has already written a review for this course
    const userHasReviewed = currentUserId && allReviews.some(review => review.user_id === currentUserId);

    // Sort reviews to put user's own review first, then by creation date
    const sortedReviews = allReviews.sort((a, b) => {
        const aIsOwn = currentUserId && a.user_id === currentUserId;
        const bIsOwn = currentUserId && b.user_id === currentUserId;

        if (aIsOwn && !bIsOwn) return -1;  // User's review goes first
        if (!aIsOwn && bIsOwn) return 1;   // Other user's review goes second

        // If both are user's or both are others', sort by date (newest first)
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const stats = calculateReviewStats(sortedReviews);
    const initialReviewsToShow = 3;
    const reviewListKey = String(course.course_code || '').replace(/[^A-Za-z0-9_-]/g, '-') || 'course';
    const userReview = userHasReviewed ? sortedReviews.find((review) => review.user_id === currentUserId) : null;
    const reviewsForFeed = sortedReviews.filter((review) => !(currentUserId && review.user_id === currentUserId));

    const openOwnReviewEditor = () => {
        if (!userReview) return;
        window.openEditReviewModal(
            userReview.id,
            userReview.course_code,
            userReview.term,
            getReviewQualityRating(userReview),
            getReviewDifficultyRating(userReview),
            userReview.content || '',
            userReview.academic_year,
            String(course.title || '')
        );
    };

    const bindReviewShowMoreButtons = (containerEl, labels = {}) => {
        if (!containerEl) return;
        const expandedLabel = labels.expanded || 'Show Less';
        const collapsedLabel = labels.collapsed || 'Show More';
        containerEl.querySelectorAll('[data-action="review-show-more"]').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const cardEl = event.currentTarget.closest('.course-review-card');
                const excerptEl = cardEl?.querySelector('.course-review-text-excerpt');
                if (!excerptEl) return;
                const isExpanded = excerptEl.classList.toggle('is-expanded');
                if (isExpanded) {
                    excerptEl.classList.remove('is-clamped');
                } else {
                    excerptEl.classList.add('is-clamped');
                }
                event.currentTarget.textContent = isExpanded ? expandedLabel : collapsedLabel;
                event.currentTarget.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            });
        });
    };

    if (isDedicatedCoursePage) {
        classReview.classList.remove('ds-card');
    } else {
        classReview.classList.add('ds-card');
    }
    if (!isMobileCourseInfo) {
        const desktopReviewCtaLabel = userReview ? 'Edit Review' : 'Write Review';
        const desktopReviewCtaIcon = '<span class="pill-icon pill-icon--edit" aria-hidden="true"></span>';
        classReview.innerHTML = `
            <div class="course-info-reviews-header">
                <div class="course-info-reviews-title">
                    <h3>Course Reviews</h3>
                    <p class="total-reviews">${stats.totalReviews} review${stats.totalReviews !== 1 ? 's' : ''}</p>
                </div>
                ${currentUserId ? `
                    <button type="button" class="btn-secondary add-review-btn" data-action="desktop-review-cta">
                        ${desktopReviewCtaIcon}
                        <span>${desktopReviewCtaLabel}</span>
                    </button>
                ` : ''}
            </div>
            ${stats.totalReviews > 0 ? `
                <div class="review-summary">
                    <div class="average-rating" style="grid-template-columns:1fr;">
                        <div class="course-review-summary-panel">
                            <p class="course-review-metric-label">Quality</p>
                            <div class="course-review-summary-inline">
                                <div class="rating-stars">${renderStarRating(Math.round(stats.averageQualityRating), 'large')}</div>
                                <p class="rating-total course-review-summary-inline-text">${stats.averageQualityRating} out of 5</p>
                            </div>
                        </div>
                        <div class="course-review-summary-panel">
                            <p class="course-review-metric-label">Difficulty</p>
                            <p class="course-review-difficulty-value" aria-label="Average difficulty rating ${stats.averageDifficultyRating} out of 5">
                                <span class="course-review-difficulty-value-main">${stats.averageDifficultyRating}</span><span class="course-review-difficulty-value-max">/5</span>
                            </p>
                        </div>
                    </div>
                    <div class="course-review-summary-panel">
                        <p class="total-reviews" style="margin:0 0 8px 0;">Quality rating distribution</p>
                        <div class="rating-distribution">
                            ${[5, 4, 3, 2, 1].map((rating) => {
            const count = stats.ratingDistribution[rating];
            const percentage = stats.totalReviews > 0 ? (count / stats.totalReviews * 100).toFixed(1) : 0;
            return `
                                <div class="rating-bar">
                                    <span class="rating-label"><p>${rating}</p> <div class="star star-extrasmall"></div></span>
                                    <div class="bar-container">
                                        <div class="bar-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    <span class="rating-count">${count}</span>
                                </div>
                            `;
        }).join('')}
                        </div>
                    </div>
                </div>
            ` : `
                <div class="course-review-empty ds-card">
                    <p>No reviews yet.</p>
                </div>
            `}
            ${stats.totalReviews > 0 ? `
                <div class="reviews-container" style="margin:14px 0 0 0;">
                    <h3 class="reviews-header" style="padding-bottom:0;">Reviews</h3>
                    <div class="reviews-list" id="reviews-list-${escapeHtml(reviewListKey)}"></div>
                    <div class="course-review-list-footer" id="reviews-footer-${escapeHtml(reviewListKey)}"></div>
                </div>
            ` : ''}
        `;

        classReview.querySelector('[data-action="desktop-review-cta"]')?.addEventListener('click', (event) => {
            event.preventDefault();
            if (userReview) {
                openOwnReviewEditor();
            } else {
                window.openAddReviewModal(course.course_code, course.academic_year, course.term, String(course.title || ''));
            }
        });

        const desktopReviewsListEl = classReview.querySelector(`#reviews-list-${reviewListKey}`);
        const desktopReviewsFooterEl = classReview.querySelector(`#reviews-footer-${reviewListKey}`);
        let desktopVisibleCount = initialReviewsToShow;

        const bindDesktopReviewInteractions = () => {
            if (!desktopReviewsListEl) return;
            bindReviewShowMoreButtons(desktopReviewsListEl, { collapsed: 'Show More', expanded: 'Show Less' });

            desktopReviewsListEl.querySelectorAll('[data-action="review-add-note"]').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (userReview) {
                        openOwnReviewEditor();
                    } else {
                        window.openAddReviewModal(course.course_code, course.academic_year, course.term, String(course.title || ''));
                    }
                });
            });

            desktopReviewsListEl.querySelectorAll('.course-review-card--own').forEach((card) => {
                const handleOpen = (event) => {
                    if (event.target.closest('button, a')) return;
                    openOwnReviewEditor();
                };
                card.addEventListener('click', handleOpen);
                card.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    openOwnReviewEditor();
                });
            });
        };

        const renderDesktopReviews = () => {
            if (!desktopReviewsListEl || !desktopReviewsFooterEl) return;
            if (!sortedReviews.length) {
                desktopReviewsListEl.innerHTML = `
                    <div class="no-reviews course-review-empty-inline">
                        <p>No reviews yet.</p>
                    </div>
                `;
                desktopReviewsFooterEl.innerHTML = '';
                return;
            }

            let studentCounter = 0;
            const visibleReviews = sortedReviews.slice(0, desktopVisibleCount);
            desktopReviewsListEl.innerHTML = visibleReviews.map((review) => {
                const isOwn = !!(currentUserId && review.user_id === currentUserId);
                const anonymousName = isOwn ? 'You' : `Student ${++studentCounter}`;
                return renderReview(review, currentUserId, anonymousName, '/user.svg');
            }).join('');

            bindDesktopReviewInteractions();

            if (visibleReviews.length < sortedReviews.length) {
                const remaining = sortedReviews.length - visibleReviews.length;
                desktopReviewsFooterEl.innerHTML = `
                    <button type="button" class="load-more-reviews btn-secondary" data-action="load-more-desktop-reviews">
                        Load More Reviews (${remaining} More)
                    </button>
                `;
                desktopReviewsFooterEl.querySelector('[data-action="load-more-desktop-reviews"]')?.addEventListener('click', () => {
                    desktopVisibleCount += initialReviewsToShow;
                    renderDesktopReviews();
                });
            } else {
                desktopReviewsFooterEl.innerHTML = '';
            }
        };

        renderDesktopReviews();
    } else {
        const shouldShowMobileReviewCta = !!(currentUserId && !userReview);
        classReview.innerHTML = `
            <div class="course-info-reviews-header">
                <div class="course-info-reviews-title">
                    <h3>Course Reviews</h3>
                    <p class="total-reviews">${stats.totalReviews} review${stats.totalReviews !== 1 ? 's' : ''}</p>
                </div>
                ${shouldShowMobileReviewCta ? `
                    <button type="button" class="btn-secondary add-review-btn" data-action="mobile-review-cta">
                        <span class="pill-icon pill-icon--edit" aria-hidden="true"></span>
                        <span>Write Review</span>
                    </button>
                ` : ''}
            </div>
            ${stats.totalReviews > 0 ? `
                <div class="course-review-summary-stack">
                    <div class="course-review-summary-panel">
                        <p class="course-review-metric-label">Quality</p>
                        <div class="course-review-summary-inline">
                            <div class="rating-stars">${renderStarRating(Math.round(stats.averageQualityRating), 'large')}</div>
                            <p class="rating-total course-review-summary-inline-text">${stats.averageQualityRating} out of 5</p>
                        </div>
                    </div>
                    <div class="course-review-summary-panel">
                        <p class="course-review-metric-label">Difficulty</p>
                        <p class="course-review-difficulty-value" aria-label="Average difficulty rating ${stats.averageDifficultyRating} out of 5">
                            <span class="course-review-difficulty-value-main">${stats.averageDifficultyRating}</span><span class="course-review-difficulty-value-max">/5</span>
                        </p>
                    </div>
                    <div class="course-review-summary-panel">
                        <p class="total-reviews" style="margin:0 0 8px 0;">Quality rating distribution</p>
                        <div class="rating-distribution">
                            ${[5, 4, 3, 2, 1].map((rating) => {
            const count = stats.ratingDistribution[rating];
            const percentage = stats.totalReviews > 0 ? (count / stats.totalReviews * 100).toFixed(1) : 0;
            return `
                                <div class="rating-bar">
                                    <span class="rating-label"><p>${rating}</p> <div class="star star-extrasmall"></div></span>
                                    <div class="bar-container">
                                        <div class="bar-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    <span class="rating-count">${count}</span>
                                </div>
                            `;
        }).join('')}
                        </div>
                    </div>
                </div>
            ` : `
                <div class="course-review-empty ds-card">
                    <p>No reviews yet.</p>
                </div>
            `}
            ${stats.totalReviews > 0 ? `
                <div class="reviews-container" style="margin:14px 0 0 0;">
                    <div class="course-review-student-header">
                        <h3 class="reviews-header" style="padding-bottom:0;">Reviews</h3>
                        <div class="course-review-tools" id="course-review-tools-${escapeHtml(reviewListKey)}"></div>
                    </div>
                    <div class="reviews-list" id="reviews-list-${escapeHtml(reviewListKey)}"></div>
                    <div class="course-review-list-footer" id="reviews-footer-${escapeHtml(reviewListKey)}"></div>
                </div>
            ` : ''}
        `;

        classReview.querySelector('[data-action="mobile-review-cta"]')?.addEventListener('click', (event) => {
            event.preventDefault();
            window.openAddReviewModal(course.course_code, course.academic_year, course.term, String(course.title || ''));
        });

        const reviewsListEl = classReview.querySelector(`#reviews-list-${reviewListKey}`);
        const reviewsFooterEl = classReview.querySelector(`#reviews-footer-${reviewListKey}`);
        const reviewToolsEl = classReview.querySelector(`#course-review-tools-${reviewListKey}`);
        const reviewsFeedSource = currentUserId ? sortedReviews : reviewsForFeed;

        const reviewState = {
            visibleCount: initialReviewsToShow,
            semester: 'all',
            publication: 'newest',
            quality: 'none',
            difficulty: 'none'
        };

        const getSemesterKey = (review) => {
            const normalizedTerm = normalizeCourseTerm(review?.term) || String(review?.term || '').trim() || 'Unknown';
            const yearValue = review?.academic_year != null ? String(review.academic_year) : '';
            return `${normalizedTerm}::${yearValue}`;
        };

        const getSemesterLabel = (review) => {
            const normalizedTerm = normalizeCourseTerm(review?.term) || String(review?.term || '').trim() || 'Unknown';
            const yearValue = review?.academic_year != null ? String(review.academic_year) : '';
            return yearValue ? `${normalizedTerm} ${yearValue}` : normalizedTerm;
        };

        const semesterOptions = [];
        const seenSemesterKeys = new Set();
        reviewsFeedSource.forEach((review) => {
            const key = getSemesterKey(review);
            if (seenSemesterKeys.has(key)) return;
            seenSemesterKeys.add(key);
            semesterOptions.push({
                value: key,
                label: getSemesterLabel(review)
            });
        });

        const distinctQualityRatings = new Set(reviewsFeedSource.map((review) => getReviewQualityRating(review)).filter(Boolean));
        const distinctDifficultyRatings = new Set(reviewsFeedSource.map((review) => getReviewDifficultyRating(review)).filter(Boolean));
        const showPublicationFilter = reviewsFeedSource.length > 1;
        const showQualityFilter = reviewsFeedSource.length > 1 && distinctQualityRatings.size > 1;
        const showDifficultyFilter = reviewsFeedSource.length > 1 && distinctDifficultyRatings.size > 1;
        const showSemesterFilter = semesterOptions.length > 1;

        const renderReviewControls = () => {
            if (!reviewToolsEl) return;
            const controls = [];

            if (showPublicationFilter) {
                controls.push(`
                    <label class="course-review-filter-group">
                        <span>Published</span>
                        <select class="course-review-filter-select" data-review-filter="publication">
                            <option value="newest"${reviewState.publication === 'newest' ? ' selected' : ''}>Newest first</option>
                            <option value="oldest"${reviewState.publication === 'oldest' ? ' selected' : ''}>Oldest first</option>
                        </select>
                    </label>
                `);
            }

            if (showQualityFilter) {
                controls.push(`
                    <label class="course-review-filter-group">
                        <span>Quality</span>
                        <select class="course-review-filter-select" data-review-filter="quality">
                            <option value="none"${reviewState.quality === 'none' ? ' selected' : ''}>Default</option>
                            <option value="high-to-low"${reviewState.quality === 'high-to-low' ? ' selected' : ''}>High to low</option>
                            <option value="low-to-high"${reviewState.quality === 'low-to-high' ? ' selected' : ''}>Low to high</option>
                        </select>
                    </label>
                `);
            }

            if (showDifficultyFilter) {
                controls.push(`
                    <label class="course-review-filter-group">
                        <span>Difficulty</span>
                        <select class="course-review-filter-select" data-review-filter="difficulty">
                            <option value="none"${reviewState.difficulty === 'none' ? ' selected' : ''}>Default</option>
                            <option value="high-to-low"${reviewState.difficulty === 'high-to-low' ? ' selected' : ''}>High to low</option>
                            <option value="low-to-high"${reviewState.difficulty === 'low-to-high' ? ' selected' : ''}>Low to high</option>
                        </select>
                    </label>
                `);
            }

            if (showSemesterFilter) {
                controls.push(`
                    <label class="course-review-filter-group">
                        <span>Semester</span>
                        <select class="course-review-filter-select" data-review-filter="semester">
                            <option value="all"${reviewState.semester === 'all' ? ' selected' : ''}>All semesters</option>
                            ${semesterOptions.map((option) => `
                                <option value="${escapeHtml(option.value)}"${reviewState.semester === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>
                            `).join('')}
                        </select>
                    </label>
                `);
            }

            reviewToolsEl.innerHTML = controls.length
                ? `<div class="course-review-filter-grid">${controls.join('')}</div>`
                : '';

            reviewToolsEl.querySelectorAll('[data-review-filter]').forEach((select) => {
                if (select.dataset.listenerAttached === 'true') return;
                select.dataset.listenerAttached = 'true';
                select.addEventListener('change', (event) => {
                    const target = event.currentTarget;
                    const filterType = target.dataset.reviewFilter;
                    const nextValue = target.value;

                    if (filterType === 'publication') reviewState.publication = nextValue;
                    if (filterType === 'quality') reviewState.quality = nextValue;
                    if (filterType === 'difficulty') reviewState.difficulty = nextValue;
                    if (filterType === 'semester') reviewState.semester = nextValue;

                    reviewState.visibleCount = initialReviewsToShow;
                    renderStudentReviewsList();
                });
            });
        };

        const compareReviewSort = (a, b) => {
            if (reviewState.quality !== 'none') {
                const direction = reviewState.quality === 'high-to-low' ? -1 : 1;
                const qualityDelta = (getReviewQualityRating(a) - getReviewQualityRating(b)) * direction;
                if (qualityDelta !== 0) return qualityDelta;
            }

            if (reviewState.difficulty !== 'none') {
                const direction = reviewState.difficulty === 'high-to-low' ? -1 : 1;
                const difficultyDelta = (getReviewDifficultyRating(a) - getReviewDifficultyRating(b)) * direction;
                if (difficultyDelta !== 0) return difficultyDelta;
            }

            const timeDelta = new Date(a.created_at) - new Date(b.created_at);
            if (timeDelta !== 0) {
                return reviewState.publication === 'oldest' ? timeDelta : -timeDelta;
            }

            return 0;
        };

        const getFilteredReviews = () => {
            const filtered = reviewsFeedSource.filter((review) => (
                reviewState.semester === 'all' || getSemesterKey(review) === reviewState.semester
            ));
            return filtered.sort(compareReviewSort);
        };

        const renderStudentReviewsList = () => {
            if (!reviewsListEl || !reviewsFooterEl) return;

            if (!reviewsFeedSource.length) {
                reviewsListEl.innerHTML = `
                    <div class="no-reviews course-review-empty-inline">
                        <p>No reviews yet.</p>
                    </div>
                `;
                reviewsFooterEl.innerHTML = '';
                return;
            }

            const filteredReviews = getFilteredReviews();
            const visibleReviews = filteredReviews.slice(0, reviewState.visibleCount);

            if (visibleReviews.length === 0) {
                reviewsListEl.innerHTML = `
                    <div class="no-reviews course-review-empty-inline">
                        <p>No reviews match the selected filters.</p>
                    </div>
                `;
                reviewsFooterEl.innerHTML = '';
                return;
            }

            let studentCounter = 0;
            reviewsListEl.innerHTML = visibleReviews.map((review) => {
                const isOwn = !!(currentUserId && review.user_id === currentUserId);
                const anonymousName = isOwn ? 'You' : `Student ${++studentCounter}`;
                return renderReview(review, currentUserId, anonymousName, '/user.svg');
            }).join('');

            bindReviewShowMoreButtons(reviewsListEl, { collapsed: 'Show More', expanded: 'Show Less' });

            if (visibleReviews.length < filteredReviews.length) {
                const remaining = filteredReviews.length - visibleReviews.length;
                reviewsFooterEl.innerHTML = `
                    <button type="button" class="load-more-reviews btn-secondary" data-action="load-more-filtered-reviews">
                        Load More Reviews (${remaining} More)
                    </button>
                `;
                const loadMoreBtn = reviewsFooterEl.querySelector('[data-action="load-more-filtered-reviews"]');
                loadMoreBtn?.addEventListener('click', () => {
                    reviewState.visibleCount += initialReviewsToShow;
                    renderStudentReviewsList();
                });
            } else {
                reviewsFooterEl.innerHTML = '';
            }
        };

        renderReviewControls();
        renderStudentReviewsList();
    }

    // Load and display assignments for this course
    if (classAssignments) {
        classInfo.classList.remove('courseinfo-guest-assignments-preview');
        if (isDedicatedCoursePage) {
            classAssignments.classList.remove('ds-card');
        } else {
            classAssignments.classList.add('ds-card');
        }
        const setGuestAssignmentsModalOverlay = (enabled) => {
            guestAssignmentsModalOverlayEnabled = !!enabled;
            syncGuestAssignmentsModalOverlayForTab();
        };
        syncGuestAssignmentsModalOverlayForTab = () => {
            const activeTab = normalizeCourseInfoTab(classInfo.dataset.activeCourseInfoTab || requestedInitialTab);
            const showOverlay = !!guestAssignmentsModalOverlayEnabled && isMobileCourseInfo && activeTab === 'assignments';
            classInfo.classList.toggle('courseinfo-guest-assignments-preview', showOverlay);
        };
        const buildCourseAssignmentsPageURL = (options = {}) => {
            const params = new URLSearchParams();
            if (course.course_code) params.set('courseCode', String(course.course_code));
            if (course.academic_year != null) params.set('year', String(course.academic_year));
            if (course.term) params.set('term', String(normalizeCourseTerm(course.term) || course.term));
            if (course.title) params.set('courseTitle', String(course.title));
            const query = params.toString();
            const hash = options.hash ? `#${options.hash}` : '';
            return `${withBase('/assignments')}${query ? `?${query}` : ''}${hash}`;
        };

        const navigateToCourseAssignmentsPage = (url) => {
            const classInfo = document.getElementById('class-info');
            if (classInfo) {
                if (typeof classInfo._courseInfoSheetController?.destroy === 'function') {
                    classInfo._courseInfoSheetController.destroy();
                    classInfo._courseInfoSheetController = null;
                }
                classInfo.classList.remove('show', 'fully-open', 'swiping', 'is-snapping', 'is-dragging');
                classInfo.style.removeProperty('--modal-translate-y');
                classInfo.style.removeProperty('--sheet-y');
                classInfo.style.removeProperty('--sheet-radius');
                delete classInfo.dataset.sheetState;
            }
            releaseCourseInfoFocusTrap();
            releaseCourseInfoResizeObserver();
            releaseCourseInfoHeaderTagsCollapse();
            cleanupActiveCourseInfoTabController();
            if (classInfoBackground?.parentNode) {
                classInfoBackground.parentNode.removeChild(classInfoBackground);
                classInfoBackground = null;
            }
            unlockBodyScrollForCourseInfoSheet();
            window.location.href = url || buildCourseAssignmentsPageURL();
        };

        const formatCourseAssignmentCountLabel = (count) => {
            const numericCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
            return `${numericCount} assignment${numericCount === 1 ? '' : 's'}`;
        };

        const renderAssignmentsEmptyState = (message, options = {}) => {
            classAssignments.classList.remove('course-assignments-guest-mode');
            setGuestAssignmentsModalOverlay(false);
            const showLink = options.showLink !== false;
            const linkText = options.linkText || 'Open assignments';
            const linkIcon = options.linkIcon || null;
            const linkId = options.linkId || 'add-assignment-link';
            const targetHref = options.targetHref || buildCourseAssignmentsPageURL();
            const assignmentCount = Number.isFinite(Number(options.assignmentCount))
                ? Math.max(0, Math.floor(Number(options.assignmentCount)))
                : 0;

            classAssignments.style.display = 'block';
            classAssignments.innerHTML = `
                <div class="class-subtitle-assignments">
                    <div class="course-assignments-title">
                        <p class="subtitle-opacity">Your Assignments</p>
                        <p class="course-assignments-total">${formatCourseAssignmentCountLabel(assignmentCount)}</p>
                    </div>
                    ${showLink ? `
                        <a href="${targetHref}" class="add-assignment-link${linkIcon ? ' add-assignment-link--icon' : ''}" id="${linkId}">
                            ${linkIcon === 'plus' ? '<span class="add-assignment-link-icon" aria-hidden="true"></span>' : ''}
                            <span>${linkText}</span>
                        </a>
                    ` : ''}
                </div>
                <div class="no-course-assignments">
                    <p>${message}</p>
                </div>
            `;
            updateOverviewAssignmentsShortcut(0);

            if (showLink) {
                const actionLink = document.getElementById(linkId);
                if (actionLink) {
                    actionLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        navigateToCourseAssignmentsPage(targetHref);
                    });
                }
            }
        };

        const renderGuestAssignmentsPreview = () => {
            classAssignments.classList.add('course-assignments-guest-mode');
            setGuestAssignmentsModalOverlay(true);
            classAssignments.style.display = 'block';
            classAssignments.innerHTML = `
                <div class="class-subtitle-assignments class-subtitle-assignments--guest">
                    <div class="course-assignments-title">
                        <p class="subtitle-opacity">Your Assignments</p>
                        <p class="course-assignments-total">${formatCourseAssignmentCountLabel(0)}</p>
                    </div>
                </div>
                <div class="course-assignments-list course-assignments-list--guest">
                    <div class="course-assignment-item course-assignment-item--preview" aria-hidden="true">
                        <div class="assignment-item-left">
                            <span class="assignment-item-icon">📄</span>
                            <div class="assignment-item-details">
                                <p class="assignment-item-title">Reflection Paper</p>
                                <div class="assignment-item-meta">
                                    <p class="assignment-item-due">Due Mar 6, 2026</p>
                                    <span class="assignment-item-urgency">Due in 2 days</span>
                                </div>
                            </div>
                        </div>
                        <div class="assignment-item-right">
                            <span class="status-badge status-ongoing">In Progress</span>
                        </div>
                    </div>
                    <div class="course-assignment-item course-assignment-item--preview" aria-hidden="true">
                        <div class="assignment-item-left">
                            <span class="assignment-item-icon">🧪</span>
                            <div class="assignment-item-details">
                                <p class="assignment-item-title">Lab Report</p>
                                <div class="assignment-item-meta">
                                    <p class="assignment-item-due">Due Mar 9, 2026</p>
                                </div>
                            </div>
                        </div>
                        <div class="assignment-item-right">
                            <span class="status-badge status-not-started">Not Started</span>
                        </div>
                    </div>
                </div>
                <div class="course-assignments-guest-personalize">
                    <p class="course-assignments-guest-text">Want to keep track of your assignments?</p>
                    <button type="button" class="course-assignments-guest-cta">Sign Up</button>
                </div>
            `;
            updateOverviewAssignmentsShortcut(0);

            const cta = classAssignments.querySelector('.course-assignments-guest-cta');
            cta?.addEventListener('click', (event) => {
                event.preventDefault();
                if (window.router?.navigate) {
                    window.router.navigate('/register');
                    return;
                }
                window.location.href = withBase('/register');
            });
        };

        const normalizeCourseCodeMatch = (value) =>
            String(value || '')
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '');

        // Check if user is logged in
        const { data: { session: assignmentSession } } = await supabase.auth.getSession();
        if (isStaleRequest()) return;

        if (assignmentSession?.user) {
            try {
                // Only registered courses should show the assignments block.
                const { data: userProfile } = await supabase
                    .from('profiles')
                    .select('courses_selection')
                    .eq('id', assignmentSession.user.id)
                    .single();
                if (isStaleRequest()) return;

                const targetCode = normalizeCourseCodeMatch(course.course_code);
                const targetYear = normalizeCourseYear(course.academic_year);
                const targetTerm = normalizeCourseTerm(course.term);

                const userCourseSelections = Array.isArray(userProfile?.courses_selection) ? userProfile.courses_selection : [];
                const isRegisteredForCourse = userCourseSelections.some((selection) => (
                    normalizeCourseCodeMatch(selection?.code || selection?.course_code) === targetCode &&
                    (
                        selection?.year == null &&
                        selection?.academic_year == null &&
                        selection?.course_year == null
                    ? true
                    : normalizeCourseYear(selection?.year ?? selection?.academic_year ?? selection?.course_year) === targetYear
                    ) &&
                    (
                        selection?.term == null &&
                        selection?.course_term == null
                    ? true
                    : normalizeCourseTerm(selection?.term ?? selection?.course_term) === targetTerm
                    )
                ));

                if (!isRegisteredForCourse) {
                    renderAssignmentsEmptyState('Add this course to your schedule to start adding assignments to it.', {
                        showLink: false
                    });
                } else {
                    // Fetch by user + course code (not exact year/term) and match in JS to tolerate missing metadata.
                    const { data: userAssignments, error: assignmentsError } = await supabase
                        .from('assignments')
                        .select('*')
                        .eq('user_id', assignmentSession.user.id)
                        .eq('course_code', course.course_code)
                        .order('due_date', { ascending: true });
                    if (isStaleRequest()) return;

                    if (assignmentsError) {
                        console.error('Error loading course assignments:', assignmentsError);
                        renderAssignmentsEmptyState('Unable to load assignments right now. Please try again.', {
                            linkText: 'Open assignments'
                        });
                    } else {
                        const matchingAssignments = (userAssignments || []).filter((assignment) => (
                            normalizeCourseCodeMatch(assignment?.course_code) === targetCode &&
                            (
                                assignment?.course_year == null
                                    ? true
                                    : normalizeCourseYear(assignment?.course_year) === targetYear
                            ) &&
                            (
                                assignment?.course_term == null
                                    ? true
                                    : normalizeCourseTerm(assignment?.course_term) === targetTerm
                            )
                        ));

                        if (matchingAssignments.length > 0) {
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
                                const dueDate = parseDueDate(assignment?.due_date);
                                if (!dueDate) {
                                    return {
                                        dueDate: null,
                                        isOverdue: false,
                                        daysUntilDue: null,
                                        urgencyLabel: '',
                                        sortBucket: 2,
                                        sortTime: Number.POSITIVE_INFINITY
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
                                    urgencyLabel,
                                    sortBucket: isOverdue ? 0 : 1,
                                    sortTime: dueDate.getTime()
                                };
                            };

                            const sortAssignmentsForPreview = (assignments) => {
                                return [...assignments].sort((a, b) => {
                                    const metaA = getAssignmentDueMeta(a);
                                    const metaB = getAssignmentDueMeta(b);

                                    if (metaA.sortBucket !== metaB.sortBucket) {
                                        return metaA.sortBucket - metaB.sortBucket;
                                    }

                                    if (metaA.sortBucket === 0) {
                                        // Overdue first, closest missed deadline first
                                        if (metaA.sortTime !== metaB.sortTime) return metaB.sortTime - metaA.sortTime;
                                    } else {
                                        // Upcoming/no-date: soonest due first
                                        if (metaA.sortTime !== metaB.sortTime) return metaA.sortTime - metaB.sortTime;
                                    }

                                    return String(a?.title || '').localeCompare(String(b?.title || ''));
                                });
                            };

                            const previewLimit = 3;
                            const sortedAssignments = sortAssignmentsForPreview(matchingAssignments);
                            const previewAssignments = sortedAssignments.slice(0, previewLimit);
                            const getStatusInfo = (status, assignment = null) => {
                                const dueMeta = getAssignmentDueMeta(assignment);
                                const statusMap = {
                                    'not_started': { text: 'Not Started', class: 'status-not-started' },
                                    'ongoing': { text: 'In Progress', class: 'status-ongoing' },
                                    'in_progress': { text: 'In Progress', class: 'status-ongoing' },
                                    'completed': { text: 'Completed', class: 'status-completed' }
                                };
                                if (dueMeta.isOverdue) {
                                    return { text: 'Overdue', class: 'status-overdue' };
                                }
                                return statusMap[status] || { text: status ? String(status) : 'Not Started', class: 'status-not-started' };
                            };

                            const formatDueDate = (dateStr) => {
                                if (!dateStr) return 'No due date';
                                const date = new Date(dateStr);
                                return `Due ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                            };
                            const viewAllLabel = matchingAssignments.length <= 1 ? 'Open Assignments' : `View All (${matchingAssignments.length})`;

                            classAssignments.style.display = 'block';
                            classAssignments.classList.remove('course-assignments-guest-mode');
                            setGuestAssignmentsModalOverlay(false);
                            classAssignments.innerHTML = `
                                <div class="class-subtitle-assignments">
                                    <div class="course-assignments-title">
                                        <p class="subtitle-opacity">Your Assignments</p>
                                        <p class="course-assignments-total">${formatCourseAssignmentCountLabel(matchingAssignments.length)}</p>
                                    </div>
                                    <a href="${buildCourseAssignmentsPageURL()}" class="view-all-assignments-btn" id="view-all-assignments-link">
                                        <div class="button-icon">
                                            <p>${viewAllLabel}</p>
                                            <div class="course-assignments-nav-icon" aria-hidden="true"></div>
                                        </div>
                                    </a>
                                </div>
                                <div class="course-assignments-list">
                                    ${previewAssignments.map(assignment => {
                                const statusInfo = getStatusInfo(assignment.status, assignment);
                                const dueMeta = getAssignmentDueMeta(assignment);
                                return `
                                            <div class="course-assignment-item" data-assignment-id="${assignment.id}" style="cursor: pointer;">
                                                <div class="assignment-item-left">
                                                    <span class="assignment-item-icon">${escapeHtml(assignment.assignment_icon || '📄')}</span>
                                                    <div class="assignment-item-details">
                                                        <p class="assignment-item-title">${assignment.title || 'Untitled'}</p>
                                                        <div class="assignment-item-meta">
                                                            <p class="assignment-item-due">${formatDueDate(assignment.due_date)}</p>
                                                            ${dueMeta.urgencyLabel ? `<span class="assignment-item-urgency">${escapeHtml(dueMeta.urgencyLabel)}</span>` : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="assignment-item-right">
                                                    <span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>
                                                    <span class="assignment-item-hover-action" aria-hidden="true">Open</span>
                                                    <span class="assignment-item-chevron" aria-hidden="true">›</span>
                                                </div>
                                            </div>
                                        `;
                            }).join('')}
                                </div>
                            `;
                            updateOverviewAssignmentsShortcut(matchingAssignments.length);

                            classAssignments.querySelectorAll('.course-assignment-item').forEach(item => {
                                item.addEventListener('click', async (e) => {
                                    e.preventDefault();
                                    const assignmentId = item.dataset.assignmentId;
                                    navigateToCourseAssignmentsPage(buildCourseAssignmentsPageURL({ hash: `assignment-${assignmentId}` }));
                                });
                            });

                            const viewAllLink = document.getElementById('view-all-assignments-link');
                            if (viewAllLink) {
                                viewAllLink.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    navigateToCourseAssignmentsPage(buildCourseAssignmentsPageURL());
                                });
                            }
                        } else {
                            renderAssignmentsEmptyState('No assignments for this course yet.', {
                                linkText: 'Add Assignment',
                                linkIcon: 'plus'
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading assignments:', error);
                renderAssignmentsEmptyState('Unable to load assignments right now. Please try again.', {
                    linkText: 'Open assignments'
                });
            }
        } else {
            renderGuestAssignmentsPreview();
            updateOverviewAssignmentsShortcut(0);
        }
    }

    if (isMobileCourseInfo) {
        const overviewPanel = document.createElement('section');
        overviewPanel.id = 'course-info-panel-overview';
        overviewPanel.className = 'course-info-tab-panel';
        overviewPanel.dataset.courseInfoTabPanel = 'overview';
        overviewPanel.setAttribute('role', 'tabpanel');
        overviewPanel.setAttribute('aria-label', 'Overview');
        overviewPanel.appendChild(classContent);
        overviewPanel.appendChild(classGPA);

        const assignmentsPanel = document.createElement('section');
        assignmentsPanel.id = 'course-info-panel-assignments';
        assignmentsPanel.className = 'course-info-tab-panel';
        assignmentsPanel.dataset.courseInfoTabPanel = 'assignments';
        assignmentsPanel.setAttribute('role', 'tabpanel');
        assignmentsPanel.setAttribute('aria-label', 'Assignments');
        assignmentsPanel.appendChild(classAssignments);

        const reviewsPanel = document.createElement('section');
        reviewsPanel.id = 'course-info-panel-reviews';
        reviewsPanel.className = 'course-info-tab-panel';
        reviewsPanel.dataset.courseInfoTabPanel = 'reviews';
        reviewsPanel.setAttribute('role', 'tabpanel');
        reviewsPanel.setAttribute('aria-label', 'Reviews');
        reviewsPanel.appendChild(classReview);

        courseInfoContentRoot.replaceChildren(overviewPanel, assignmentsPanel, reviewsPanel);

        courseInfoBody.querySelector('.course-info-mobile-tabs')?.remove();
        const tabsWrap = document.createElement('div');
        tabsWrap.className = 'course-info-mobile-tabs courseinfo-tabs';
        tabsWrap.setAttribute('role', 'tablist');
        tabsWrap.setAttribute('aria-label', 'Course sections');
        tabsWrap.innerHTML = `
            <button type="button" class="course-info-mobile-tab-btn" data-course-info-tab="overview" role="tab" aria-controls="course-info-panel-overview">Overview</button>
            <button type="button" class="course-info-mobile-tab-btn" data-course-info-tab="assignments" role="tab" aria-controls="course-info-panel-assignments">Assignments</button>
            <button type="button" class="course-info-mobile-tab-btn" data-course-info-tab="reviews" role="tab" aria-controls="course-info-panel-reviews">Reviews</button>
        `;
        courseInfoBody.insertBefore(tabsWrap, courseInfoContentRoot);

        let tabPanelsViewport = courseInfoBody.querySelector('.course-info-tab-panels-viewport');
        if (!tabPanelsViewport) {
            tabPanelsViewport = document.createElement('div');
            tabPanelsViewport.className = 'course-info-tab-panels-viewport';
            courseInfoBody.insertBefore(tabPanelsViewport, courseInfoContentRoot);
        }
        if (courseInfoContentRoot.parentNode !== tabPanelsViewport) {
            tabPanelsViewport.appendChild(courseInfoContentRoot);
        }
        courseInfoContentRoot.classList.add('course-info-tab-panels-active');
        tabPanelsViewport.querySelectorAll('.course-info-tab-panel-swipe-preview').forEach((node) => node.remove());

        const tabOrder = ['overview', 'assignments', 'reviews'];
        tabsWrap.style.setProperty('--tab-count', String(tabOrder.length));
        const panelMap = new Map([
            ['overview', overviewPanel],
            ['assignments', assignmentsPanel],
            ['reviews', reviewsPanel]
        ]);
        if (isDedicatedCoursePage) {
            tabsWrap.classList.add('course-info-mobile-tabs--dedicated');
            tabPanelsViewport.classList.add('course-info-tab-panels-viewport--dedicated');
            courseInfoContentRoot.classList.add('course-info-tab-panels-active--dedicated');
            panelMap.forEach((panelEl) => {
                panelEl.classList.add('course-info-tab-panel--dedicated');
            });
        }
        const tabsBodyScroller = classInfo.querySelector('.sheet-body') || classInfo.querySelector('.class-content-wrapper');
        const tabBodySurface = classInfo.querySelector('.courseinfo-body') || tabsBodyScroller || tabPanelsViewport;
        let activeTab = requestedInitialTab;
        const shouldMeasureTabViewport = !isDedicatedCoursePage;
        const tabSwipePanelGap = isDedicatedCoursePage ? 15 : 0;

        let tabSwipePreview = null;
        let tabSwipePreviewTab = null;
        let tabSwipeDirection = 0;
        let tabSwipeSettleTimer = null;
        let tabSwipeAnimating = false;
        let tabTouchInProgress = false;
        let tabTouchIgnoreSwipe = false;
        let tabTouchAxisLock = null;
        let tabTouchStartX = 0;
        let tabTouchStartY = 0;
        let tabTouchStartTime = 0;
        let tabPointerId = null;
        let tabPointerInProgress = false;
        let tabPointerIgnoreSwipe = false;
        let tabPointerAxisLock = null;
        let tabPointerStartX = 0;
        let tabPointerStartY = 0;
        let tabPointerStartTime = 0;
        let tabPointerCaptured = false;
        let tabViewportResizeObserver = null;

        const isTabSwipeEnabled = () => {
            const state = String(classInfo.dataset.sheetState || '').trim();
            return !state || state === 'full';
        };

        const getTabIndex = (tabKey) => {
            const normalized = normalizeCourseInfoTab(tabKey);
            const index = tabOrder.indexOf(normalized);
            return index < 0 ? 0 : index;
        };

        const getTabViewportWidth = () => {
            if (!tabPanelsViewport && !courseInfoContentRoot) return 0;
            const rectWidth = tabPanelsViewport?.getBoundingClientRect?.().width
                || courseInfoContentRoot?.getBoundingClientRect?.().width
                || 0;
            if (rectWidth > 0) return rectWidth;
            return tabPanelsViewport?.clientWidth || courseInfoContentRoot?.clientWidth || 0;
        };

        const measureTabPanelHeight = (panelEl) => {
            if (!panelEl) return 0;
            const rectHeight = panelEl.getBoundingClientRect?.().height || 0;
            const scrollHeight = panelEl.scrollHeight || 0;
            return Math.max(rectHeight, scrollHeight);
        };

        const updateDedicatedTabViewportMinHeight = (previewPanelEl = null) => {
            if (!isDedicatedCoursePage || !tabPanelsViewport) return;
            const activePanelHeight = measureTabPanelHeight(panelMap.get(activeTab));
            const previewPanelHeight = measureTabPanelHeight(previewPanelEl);
            const nextMinHeight = Math.max(activePanelHeight, previewPanelHeight, 0);
            if (nextMinHeight <= 0) {
                tabPanelsViewport.style.removeProperty('--course-info-tab-panels-min-height');
                return;
            }
            const nextMinHeightValue = `${Math.round(nextMinHeight)}px`;
            if (tabPanelsViewport.style.getPropertyValue('--course-info-tab-panels-min-height') === nextMinHeightValue) {
                return;
            }
            tabPanelsViewport.style.setProperty('--course-info-tab-panels-min-height', nextMinHeightValue);
        };

        const updateTabPanelsViewportMinHeight = () => {
            if (!tabPanelsViewport || !tabBodySurface || !tabsWrap) return;
            if (!shouldMeasureTabViewport) {
                updateDedicatedTabViewportMinHeight();
                return;
            }
            const surfaceHeight = tabBodySurface.clientHeight
                || tabBodySurface.getBoundingClientRect?.().height
                || 0;
            const tabsHeight = tabsWrap.getBoundingClientRect?.().height
                || tabsWrap.offsetHeight
                || 0;
            const nextMinHeight = Math.max(0, Math.round(surfaceHeight - tabsHeight));
            const nextMinHeightValue = `${nextMinHeight}px`;
            if (tabPanelsViewport.style.getPropertyValue('--course-info-tab-panels-min-height') === nextMinHeightValue) {
                return;
            }
            tabPanelsViewport.style.setProperty('--course-info-tab-panels-min-height', nextMinHeightValue);
        };

        const getSwipeTargetTab = (direction) => {
            const nextIndex = getTabIndex(activeTab) + direction;
            if (nextIndex < 0 || nextIndex >= tabOrder.length) return null;
            return tabOrder[nextIndex] || null;
        };

        const clearTabSwipeSettleTimer = () => {
            if (!tabSwipeSettleTimer) return;
            clearTimeout(tabSwipeSettleTimer);
            tabSwipeSettleTimer = null;
        };

        const cleanupTabSwipePreview = () => {
            if (tabSwipePreview?.parentElement) {
                tabSwipePreview.remove();
            }
            tabSwipePreview = null;
            tabSwipePreviewTab = null;
            tabSwipeDirection = 0;
        };

        const resetTabSwipeTransforms = ({ instant = false } = {}) => {
            if (!courseInfoContentRoot) return;
            if (instant) {
                courseInfoContentRoot.classList.add('is-swipe-dragging');
            }
            courseInfoContentRoot.classList.remove('is-swipe-settling');
            if (!instant) {
                courseInfoContentRoot.classList.remove('is-swipe-dragging');
            }
            courseInfoContentRoot.style.transform = '';
            courseInfoContentRoot.style.opacity = '';
            if (tabSwipePreview) {
                if (instant) {
                    tabSwipePreview.classList.add('is-swipe-dragging');
                }
                tabSwipePreview.classList.remove('is-swipe-settling');
                if (!instant) {
                    tabSwipePreview.classList.remove('is-swipe-dragging');
                }
                tabSwipePreview.style.transform = '';
                tabSwipePreview.style.opacity = '';
            }
            if (instant) {
                void courseInfoContentRoot.offsetWidth;
                courseInfoContentRoot.classList.remove('is-swipe-dragging');
                tabSwipePreview?.classList.remove('is-swipe-dragging');
            }
        };

        const createSwipePreviewFromPanel = (panelEl) => {
            if (!panelEl) return null;
            const preview = panelEl.cloneNode(true);
            preview.classList.add('course-info-tab-panel-swipe-preview');
            preview.removeAttribute('hidden');
            preview.hidden = false;
            preview.setAttribute('aria-hidden', 'true');
            const viewportWidth = getTabViewportWidth();
            if (viewportWidth > 0) {
                preview.style.width = `${viewportWidth}px`;
                preview.style.minWidth = `${viewportWidth}px`;
            }
            return preview;
        };

        const ensureTabSwipePreview = (targetTab, direction) => {
            if (!tabPanelsViewport || !courseInfoContentRoot) return null;
            if (!targetTab) {
                cleanupTabSwipePreview();
                return null;
            }
            if (tabSwipePreview && tabSwipePreviewTab === targetTab && tabSwipeDirection === direction) {
                return tabSwipePreview;
            }

            cleanupTabSwipePreview();
            const sourcePanel = panelMap.get(targetTab);
            if (!sourcePanel) return null;

            const preview = createSwipePreviewFromPanel(sourcePanel);
            if (!preview) return null;

            tabPanelsViewport.appendChild(preview);
            tabSwipePreview = preview;
            tabSwipePreviewTab = targetTab;
            tabSwipeDirection = direction;
            return preview;
        };

        const applyTabSwipeDrag = (deltaX) => {
            if (!courseInfoContentRoot || !tabPanelsViewport) return;
            const width = getTabViewportWidth() || 1;
            if (width <= 0) return;

            const direction = deltaX < 0 ? 1 : -1;
            const targetTab = getSwipeTargetTab(direction);
            const boundedDeltaX = Math.max(-width, Math.min(width, deltaX));
            const translateX = !targetTab ? boundedDeltaX * 0.32 : boundedDeltaX;
            const progress = Math.min(Math.abs(translateX) / width, 1);

            courseInfoContentRoot.classList.add('is-swipe-dragging');
            courseInfoContentRoot.style.transform = `translate3d(${translateX}px, 0, 0)`;
            courseInfoContentRoot.style.opacity = String(Math.max(0.68, 1 - (progress * 0.32)));

            const preview = ensureTabSwipePreview(targetTab, direction);
            if (!preview) return;

            preview.classList.add('is-swipe-dragging');
            const previewBaseX = direction > 0
                ? width + tabSwipePanelGap
                : -(width + tabSwipePanelGap);
            const previewX = previewBaseX + translateX;
            preview.style.transform = `translate3d(${previewX}px, 0, 0)`;
            preview.style.opacity = String(Math.min(1, 0.58 + (progress * 0.42)));
            updateDedicatedTabViewportMinHeight(preview);
        };

        const settleTabSwipe = ({ targetTab = null, direction = 0, commit = false } = {}) => {
            if (!courseInfoContentRoot || !tabPanelsViewport) {
                cleanupTabSwipePreview();
                return;
            }

            const width = getTabViewportWidth() || 1;
            const preview = tabSwipePreview;
            const validDirection = direction === 1 || direction === -1 ? direction : tabSwipeDirection;

            courseInfoContentRoot.classList.remove('is-swipe-dragging');
            courseInfoContentRoot.classList.add('is-swipe-settling');
            if (preview) {
                preview.classList.remove('is-swipe-dragging');
                preview.classList.add('is-swipe-settling');
            }

            if (commit && targetTab) {
                tabSwipeAnimating = true;
                const currentTargetX = validDirection > 0
                    ? -(width + tabSwipePanelGap)
                    : width + tabSwipePanelGap;
                courseInfoContentRoot.style.transform = `translate3d(${currentTargetX}px, 0, 0)`;
                courseInfoContentRoot.style.opacity = '0.72';
                if (preview) {
                    preview.style.transform = 'translate3d(0px, 0, 0)';
                    preview.style.opacity = '1';
                }

                clearTabSwipeSettleTimer();
                tabSwipeSettleTimer = window.setTimeout(() => {
                    tabSwipeSettleTimer = null;
                    cleanupTabSwipePreview();
                    switchCourseInfoTab(targetTab, {
                        persist: true,
                        scrollTop: true,
                        preserveSwipeState: true
                    });
                    resetTabSwipeTransforms({ instant: true });
                    tabSwipeAnimating = false;
                }, 230);
                return;
            }

            courseInfoContentRoot.style.transform = 'translate3d(0px, 0, 0)';
            courseInfoContentRoot.style.opacity = '1';
            if (preview) {
                const previewBaseX = validDirection > 0
                    ? width + tabSwipePanelGap
                    : -(width + tabSwipePanelGap);
                preview.style.transform = `translate3d(${previewBaseX}px, 0, 0)`;
                preview.style.opacity = '0.58';
            }

            clearTabSwipeSettleTimer();
            tabSwipeSettleTimer = window.setTimeout(() => {
                tabSwipeSettleTimer = null;
                cleanupTabSwipePreview();
                resetTabSwipeTransforms();
                updateDedicatedTabViewportMinHeight();
            }, 220);
        };

        const applyCourseInfoTabState = (nextTab) => {
            const normalizedTab = normalizeCourseInfoTab(nextTab);
            activeTab = normalizedTab;
            classInfo.dataset.activeCourseInfoTab = normalizedTab;
            tabsWrap.dataset.activeCourseInfoTab = normalizedTab;
            tabsWrap.style.setProperty('--course-info-tab-index', String(getTabIndex(normalizedTab)));
            syncGuestAssignmentsModalOverlayForTab();

            panelMap.forEach((panelEl, tabKey) => {
                const isActive = tabKey === normalizedTab;
                panelEl.hidden = !isActive;
                panelEl.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            });

            tabsWrap.querySelectorAll('[data-course-info-tab]').forEach((button) => {
                const isActive = button.getAttribute('data-course-info-tab') === normalizedTab;
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                button.classList.toggle('is-active', isActive);
                button.setAttribute('tabindex', isActive ? '0' : '-1');
            });
        };

        const switchCourseInfoTab = (
            nextTab,
            { persist = true, scrollTop = false, focusButton = false, preserveSwipeState = false } = {}
        ) => {
            const normalizedTab = normalizeCourseInfoTab(nextTab);
            if (!preserveSwipeState) {
                clearTabSwipeSettleTimer();
                cleanupTabSwipePreview();
                resetTabSwipeTransforms();
                tabSwipeAnimating = false;
            }
            applyCourseInfoTabState(normalizedTab);
            if (persist) {
                writeStoredCourseInfoTab(normalizedTab);
            }
            if (scrollTop && tabsBodyScroller) {
                tabsBodyScroller.scrollTop = 0;
            }
            updateDedicatedTabViewportMinHeight();
            if (focusButton) {
                const activeButton = tabsWrap.querySelector(`[data-course-info-tab="${normalizedTab}"]`);
                activeButton?.focus({ preventScroll: true });
            }
        };

        tabsWrap.querySelectorAll('[data-course-info-tab]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                switchCourseInfoTab(button.getAttribute('data-course-info-tab') || 'overview', {
                    persist: true,
                    scrollTop: true
                });
            });
        });

        tabsWrap.addEventListener('keydown', (event) => {
            if (event.defaultPrevented) return;
            const activeIndex = getTabIndex(activeTab);
            let nextIndex = null;

            if (event.key === 'ArrowRight') {
                nextIndex = Math.min(tabOrder.length - 1, activeIndex + 1);
            } else if (event.key === 'ArrowLeft') {
                nextIndex = Math.max(0, activeIndex - 1);
            } else if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = tabOrder.length - 1;
            }

            if (nextIndex === null) return;
            event.preventDefault();
            switchCourseInfoTab(tabOrder[nextIndex], {
                persist: true,
                scrollTop: true,
                focusButton: true
            });
        });

        const isHorizontalBadgeScrollTarget = (target) => {
            const targetEl = target instanceof Element
                ? target
                : (target && target.nodeType === Node.TEXT_NODE ? target.parentElement : null);
            if (!(targetEl instanceof Element)) return false;
            const scrollRow = targetEl.closest('.course-info-hero-main .ds-badges, .courseinfo-header-tags');
            return scrollRow instanceof HTMLElement;
        };

        const handlePanelsTouchStart = (event) => {
            if (tabSwipeAnimating) return;
            if (!isTabSwipeEnabled()) return;
            tabTouchIgnoreSwipe = isHorizontalBadgeScrollTarget(event.target);
            if (tabTouchIgnoreSwipe) {
                tabTouchInProgress = false;
                tabTouchAxisLock = null;
                return;
            }
            const touch = event.touches?.[0];
            if (!touch) return;

            clearTabSwipeSettleTimer();
            cleanupTabSwipePreview();
            resetTabSwipeTransforms();
            tabTouchStartX = touch.clientX;
            tabTouchStartY = touch.clientY;
            tabTouchStartTime = Date.now();
            tabTouchInProgress = true;
            tabTouchAxisLock = null;
        };

        const handlePanelsTouchMove = (event) => {
            if (tabTouchIgnoreSwipe) return;
            if (!tabTouchInProgress || tabSwipeAnimating) return;
            const touch = event.touches?.[0];
            if (!touch) return;

            const deltaX = touch.clientX - tabTouchStartX;
            const deltaY = touch.clientY - tabTouchStartY;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);

            if (!tabTouchAxisLock) {
                if (absDeltaX < 8 && absDeltaY < 8) return;
                if (absDeltaY > absDeltaX * 1.1) {
                    tabTouchInProgress = false;
                    tabTouchAxisLock = 'y';
                    return;
                }
                tabTouchAxisLock = 'x';
            }

            if (tabTouchAxisLock !== 'x') return;
            event.preventDefault();
            applyTabSwipeDrag(deltaX);
        };

        const handlePanelsTouchCancel = () => {
            if (tabTouchIgnoreSwipe) {
                tabTouchIgnoreSwipe = false;
                return;
            }
            if (!tabTouchInProgress) return;
            tabTouchInProgress = false;
            if (tabTouchAxisLock === 'x') {
                settleTabSwipe({ commit: false });
            }
            tabTouchAxisLock = null;
        };

        const handlePanelsTouchEnd = (event) => {
            if (tabTouchIgnoreSwipe) {
                tabTouchIgnoreSwipe = false;
                return;
            }
            if (!tabTouchInProgress || tabSwipeAnimating) return;
            const touch = event.changedTouches?.[0];
            if (!touch) return;

            const deltaX = touch.clientX - tabTouchStartX;
            const deltaY = touch.clientY - tabTouchStartY;
            tabTouchInProgress = false;

            if (tabTouchAxisLock !== 'x') {
                tabTouchAxisLock = null;
                return;
            }

            const width = getTabViewportWidth() || 1;
            const durationMs = Math.max(1, Date.now() - tabTouchStartTime);
            const velocityX = deltaX / durationMs;
            const swipeDirection = deltaX < 0 ? 1 : -1;
            const targetTab = getSwipeTargetTab(swipeDirection);
            const shouldCommit = targetTab && (
                Math.abs(deltaX) >= width * 0.22
                || Math.abs(velocityX) > 0.42
            ) && Math.abs(deltaY) < Math.abs(deltaX) * 1.2;

            settleTabSwipe({
                targetTab: shouldCommit ? targetTab : null,
                direction: swipeDirection,
                commit: Boolean(shouldCommit)
            });
            tabTouchAxisLock = null;
        };

        const isPointerTabSwipeTarget = (event) => {
            if (!event) return false;
            if (tabSwipeAnimating) return false;
            if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
            if (event.button !== undefined && event.button !== 0) return false;
            if (!isCourseInfoMobileViewport()) return false;
            if (!isTabSwipeEnabled()) return false;

            const pointerType = String(event.pointerType || '').toLowerCase();
            if (pointerType && pointerType !== 'mouse' && pointerType !== 'pen') return false;
            const targetEl = event.target instanceof Element ? event.target : null;
            if (!targetEl) return false;
            if (!targetEl.closest('.courseinfo-body, .course-info-mobile-tabs, .course-info-tab-panels-viewport')) return false;
            if (targetEl.closest('button, a, input, textarea, select, label')) return false;
            if (isHorizontalBadgeScrollTarget(targetEl)) return false;
            return true;
        };

        const handlePanelsPointerDown = (event) => {
            tabPointerIgnoreSwipe = isHorizontalBadgeScrollTarget(event.target);
            if (tabPointerIgnoreSwipe) {
                tabPointerId = event.pointerId;
                tabPointerCaptured = false;
                tabPointerInProgress = false;
                tabPointerAxisLock = null;
                return;
            }
            if (!isPointerTabSwipeTarget(event)) return;

            clearTabSwipeSettleTimer();
            cleanupTabSwipePreview();
            resetTabSwipeTransforms();
            tabPointerId = event.pointerId;
            tabPointerStartX = event.clientX;
            tabPointerStartY = event.clientY;
            tabPointerStartTime = Date.now();
            tabPointerInProgress = true;
            tabPointerAxisLock = null;
            tabPointerCaptured = false;
        };

        const handlePanelsPointerMove = (event) => {
            if (tabPointerIgnoreSwipe) return;
            if (!tabPointerInProgress || tabSwipeAnimating || tabPointerId === null) return;
            if (event.pointerId !== tabPointerId) return;

            const deltaX = event.clientX - tabPointerStartX;
            const deltaY = event.clientY - tabPointerStartY;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);

            if (!tabPointerAxisLock) {
                if (absDeltaX < 8 && absDeltaY < 8) return;
                if (absDeltaY > absDeltaX * 1.1) {
                    tabPointerInProgress = false;
                    tabPointerAxisLock = 'y';
                    if (tabPointerCaptured) {
                        try {
                            if (tabBodySurface?.hasPointerCapture?.(tabPointerId)) {
                                tabBodySurface.releasePointerCapture(tabPointerId);
                            }
                        } catch (_) { }
                    }
                    tabPointerCaptured = false;
                    tabPointerId = null;
                    return;
                }
                tabPointerAxisLock = 'x';
                if (!tabPointerCaptured) {
                    try {
                        tabBodySurface?.setPointerCapture?.(tabPointerId);
                        tabPointerCaptured = true;
                    } catch (_) {
                        tabPointerCaptured = false;
                    }
                }
            }

            if (tabPointerAxisLock !== 'x') return;
            if (event.cancelable) {
                event.preventDefault();
            }
            applyTabSwipeDrag(deltaX);
        };

        const handlePanelsPointerCancel = (event) => {
            if (tabPointerIgnoreSwipe) {
                if (event.pointerId !== tabPointerId) return;
                tabPointerIgnoreSwipe = false;
                tabPointerCaptured = false;
                tabPointerId = null;
                tabPointerInProgress = false;
                tabPointerAxisLock = null;
                return;
            }
            if (!tabPointerInProgress || tabPointerId === null) return;
            if (event.pointerId !== tabPointerId) return;
            if (tabPointerAxisLock === 'x') {
                settleTabSwipe({ commit: false });
            }
            if (tabPointerCaptured) {
                try {
                    if (tabBodySurface?.hasPointerCapture?.(tabPointerId)) {
                        tabBodySurface.releasePointerCapture(tabPointerId);
                    }
                } catch (_) { }
            }
            tabPointerCaptured = false;
            tabPointerId = null;
            tabPointerInProgress = false;
            tabPointerAxisLock = null;
        };

        const handlePanelsPointerUp = (event) => {
            if (tabPointerIgnoreSwipe) {
                if (event.pointerId !== tabPointerId) return;
                tabPointerIgnoreSwipe = false;
                tabPointerCaptured = false;
                tabPointerId = null;
                tabPointerInProgress = false;
                tabPointerAxisLock = null;
                return;
            }
            if (!tabPointerInProgress || tabSwipeAnimating || tabPointerId === null) return;
            if (event.pointerId !== tabPointerId) return;

            const deltaX = event.clientX - tabPointerStartX;
            const deltaY = event.clientY - tabPointerStartY;
            tabPointerInProgress = false;

            if (tabPointerCaptured) {
                try {
                    if (tabBodySurface?.hasPointerCapture?.(tabPointerId)) {
                        tabBodySurface.releasePointerCapture(tabPointerId);
                    }
                } catch (_) { }
            }
            tabPointerCaptured = false;
            tabPointerId = null;

            if (tabPointerAxisLock !== 'x') {
                tabPointerAxisLock = null;
                return;
            }

            const width = getTabViewportWidth() || 1;
            const durationMs = Math.max(1, Date.now() - tabPointerStartTime);
            const velocityX = deltaX / durationMs;
            const swipeDirection = deltaX < 0 ? 1 : -1;
            const targetTab = getSwipeTargetTab(swipeDirection);
            const shouldCommit = targetTab && (
                Math.abs(deltaX) >= width * 0.22
                || Math.abs(velocityX) > 0.42
            ) && Math.abs(deltaY) < Math.abs(deltaX) * 1.2;

            settleTabSwipe({
                targetTab: shouldCommit ? targetTab : null,
                direction: swipeDirection,
                commit: Boolean(shouldCommit)
            });
            tabPointerAxisLock = null;
        };

        const tabSwipeSurface = isDedicatedCoursePage
            ? (tabBodySurface || tabPanelsViewport)
            : (tabPanelsViewport || tabBodySurface);
        tabSwipeSurface?.addEventListener('touchstart', handlePanelsTouchStart, { passive: true });
        tabSwipeSurface?.addEventListener('touchmove', handlePanelsTouchMove, { passive: false });
        tabSwipeSurface?.addEventListener('touchend', handlePanelsTouchEnd, { passive: true });
        tabSwipeSurface?.addEventListener('touchcancel', handlePanelsTouchCancel, { passive: true });
        tabSwipeSurface?.addEventListener('pointerdown', handlePanelsPointerDown, true);
        tabSwipeSurface?.addEventListener('pointermove', handlePanelsPointerMove, { passive: false, capture: true });
        tabSwipeSurface?.addEventListener('pointerup', handlePanelsPointerUp, true);
        tabSwipeSurface?.addEventListener('pointercancel', handlePanelsPointerCancel, true);

        const detachPanelsSwipeHandlers = () => {
            tabSwipeSurface?.removeEventListener('touchstart', handlePanelsTouchStart);
            tabSwipeSurface?.removeEventListener('touchmove', handlePanelsTouchMove);
            tabSwipeSurface?.removeEventListener('touchend', handlePanelsTouchEnd);
            tabSwipeSurface?.removeEventListener('touchcancel', handlePanelsTouchCancel);
            tabSwipeSurface?.removeEventListener('pointerdown', handlePanelsPointerDown, true);
            tabSwipeSurface?.removeEventListener('pointermove', handlePanelsPointerMove, true);
            tabSwipeSurface?.removeEventListener('pointerup', handlePanelsPointerUp, true);
            tabSwipeSurface?.removeEventListener('pointercancel', handlePanelsPointerCancel, true);
        };

        const handleCourseInfoResize = () => {
            clearTabSwipeSettleTimer();
            cleanupTabSwipePreview();
            resetTabSwipeTransforms();
            updateTabPanelsViewportMinHeight();
            applyCourseInfoTabState(activeTab);
        };
        window.addEventListener('resize', handleCourseInfoResize);
        if (typeof ResizeObserver === 'function') {
            tabViewportResizeObserver = new ResizeObserver(() => {
                updateTabPanelsViewportMinHeight();
            });
            if (shouldMeasureTabViewport && tabBodySurface) {
                tabViewportResizeObserver.observe(tabBodySurface);
                tabViewportResizeObserver.observe(tabsWrap);
            } else {
                panelMap.forEach((panelEl) => {
                    tabViewportResizeObserver.observe(panelEl);
                });
                if (courseInfoContentRoot) {
                    tabViewportResizeObserver.observe(courseInfoContentRoot);
                }
            }
        }
        updateTabPanelsViewportMinHeight();
        classInfo._mobileTabsResizeCleanup = () => {
            window.removeEventListener('resize', handleCourseInfoResize);
            if (tabViewportResizeObserver) {
                tabViewportResizeObserver.disconnect();
                tabViewportResizeObserver = null;
            }
        };

        activeCourseInfoTabController = {
            setActiveTab: switchCourseInfoTab,
            cleanup: () => {
                clearTabSwipeSettleTimer();
                detachPanelsSwipeHandlers();
                cleanupTabSwipePreview();
                resetTabSwipeTransforms({ instant: true });
                window.removeEventListener('resize', handleCourseInfoResize);
                if (tabViewportResizeObserver) {
                    tabViewportResizeObserver.disconnect();
                    tabViewportResizeObserver = null;
                }
                panelMap.forEach((panelEl) => {
                    panelEl.hidden = false;
                    panelEl.removeAttribute('aria-hidden');
                });
                if (tabPanelsViewport && tabPanelsViewport.parentNode) {
                    tabPanelsViewport.parentNode.insertBefore(courseInfoContentRoot, tabPanelsViewport);
                    tabPanelsViewport.remove();
                }
                courseInfoContentRoot.classList.remove('course-info-tab-panels-active', 'is-swipe-dragging', 'is-swipe-settling');
                courseInfoContentRoot.classList.remove('course-info-tab-panels-active--dedicated');
                courseInfoContentRoot.style.transform = '';
                courseInfoContentRoot.style.opacity = '';
                courseInfoContentRoot.style.minHeight = '';
                tabPanelsViewport?.style.removeProperty('--course-info-tab-panels-min-height');
                tabPanelsViewport?.classList.remove('course-info-tab-panels-viewport--dedicated');
                panelMap.forEach((panelEl) => {
                    panelEl.classList.remove('course-info-tab-panel--dedicated');
                });
                tabTouchIgnoreSwipe = false;
                tabPointerIgnoreSwipe = false;
                tabTouchInProgress = false;
                tabPointerInProgress = false;
                tabTouchAxisLock = null;
                tabPointerAxisLock = null;
                tabPointerId = null;
                tabPointerCaptured = false;
                if (tabsWrap.parentNode) {
                    tabsWrap.classList.remove('course-info-mobile-tabs--dedicated');
                    tabsWrap.parentNode.removeChild(tabsWrap);
                }
                delete classInfo.dataset.activeCourseInfoTab;
            }
        };
        classInfo._courseInfoTabCleanup = () => {
            cleanupActiveCourseInfoTabController();
        };

        switchCourseInfoTab(requestedInitialTab, { persist: false, scrollTop: true });
        courseInfoContentRoot.style.minHeight = shouldMeasureTabViewport ? '100%' : '';
        resetCourseInfoBodyScroll();
    } else {
        courseInfoBody.querySelector('.course-info-mobile-tabs')?.remove();
        courseInfoContentRoot.replaceChildren(classContent, classGPA, classAssignments, classReview);
        releaseCourseInfoResizeObserver();
        cleanupActiveCourseInfoTabController();
        classInfo.classList.remove('courseinfo-guest-assignments-preview');
        resetCourseInfoBodyScroll();
        activeCourseInfoTabController = {
            setActiveTab: () => { },
            cleanup: () => {
                delete classInfo.dataset.activeCourseInfoTab;
            }
        };
    }

    classInfo.classList.remove('fully-open', 'swiping', 'is-snapping', 'is-dragging');

    // Reset any leftover inline styles from previous interactions
    classInfo.style.removeProperty('--modal-translate-y');
    classInfo.style.removeProperty('--sheet-y');
    classInfo.style.transform = '';
    classInfo.style.transition = '';
    classInfo.style.opacity = '';
    classInfo.classList.add("show");
    window.requestAnimationFrame(() => {
        resetCourseInfoBodyScroll();
    });

    if (isMobileCourseInfo && !isDedicatedCoursePage) {
        window.requestAnimationFrame(() => {
            setupCourseInfoHeaderTagsCollapse();
        });
    } else {
        releaseCourseInfoHeaderTagsCollapse();
    }

    if (isDedicatedCoursePage) {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.classList.remove('modal-open');
        classInfo.removeAttribute('aria-modal');
    } else {
        lockBodyScrollForCourseInfoSheet();

        releaseCourseInfoFocusTrap();
        classInfo._focusTrapCleanup = createFocusTrap(classInfo, {
            onEscape: () => closeCourseInfoSheet({ restoreURL: true })
        });
        if (!isCourseInfoMobileViewport()) {
            window.setTimeout(() => {
                classClose?.focus?.({ preventScroll: true });
            }, 20);
        }
        if (isMobileCourseInfo && classInfoBackground) {
            classInfo._courseInfoSheetController = createCourseInfoMobileSheetController(classInfo, classInfoBackground, {
                onRequestClose: () => closeCourseInfoSheet({ restoreURL: true, immediate: true })
            });
            classInfo._courseInfoSheetController?.setPeekContent(courseInfoModel);
            classInfo._courseInfoSheetController?.openHalf();
            releaseCourseInfoExternalModalWatch();
            classInfo._courseInfoExternalModalWatchCleanup = setupCollapsedCourseInfoAutoCloseWatch();
        } else {
            classInfo._courseInfoSheetController = null;
            releaseCourseInfoExternalModalWatch();
        }
    }

    // Show background with fade-in animation
    if (!isDedicatedCoursePage && classInfoBackground) {
        if (!isMobileCourseInfo) {
            setTimeout(() => {
                classInfoBackground.style.opacity = "1";
            }, 10);
        }
    }
    window.setTimeout(focusAssessmentBreakdown, 80);

    const hideFooterForGuest = !session;
    classInfo.classList.toggle('courseinfo-guest-hide-footer', hideFooterForGuest);

    courseInfoActions.innerHTML = hideFooterForGuest ? '' : `
        <div class="course-info-footer-layout">
            <div class="course-info-footer-secondary">
                <button type="button" class="btn-secondary course-info-save-btn" data-action="toggle-save-course" aria-label="Save Course" title="Save Course">
                    <span class="course-info-save-icon" aria-hidden="true"></span>
                    <span class="course-info-save-label">Save</span>
                </button>
                <button type="button" class="btn-secondary course-info-write-review-btn" data-action="write-review-footer" hidden>Write Review</button>
            </div>
            <div class="course-info-footer-primary">
                <button id="class-add-remove"></button>
            </div>
        </div>
    `;

    const saveToggleBtn = courseInfoActions.querySelector('[data-action="toggle-save-course"]');
    const writeReviewFooterBtn = courseInfoActions.querySelector('[data-action="write-review-footer"]');
    const footerLayout = courseInfoActions.querySelector('.course-info-footer-layout');
    const footerSecondary = footerLayout?.querySelector('.course-info-footer-secondary');
    updateFooterActionLayout = (isSelected) => {
        const shouldShowWriteReview = !!(session && isSelected && !userHasReviewed);
        const shouldShowSecondary = true;

        if (footerSecondary) {
            footerSecondary.hidden = !shouldShowSecondary;
        }
        if (footerLayout) {
            footerLayout.classList.toggle('is-primary-only', !shouldShowSecondary);
            footerLayout.classList.toggle('has-write-review', shouldShowWriteReview);
        }
        if (saveToggleBtn) {
            saveToggleBtn.hidden = false;
            saveToggleBtn.classList.toggle('is-saved', !!isSavedForLater);
            saveToggleBtn.setAttribute('aria-label', isSavedForLater ? 'Unsave Course' : 'Save Course');
            saveToggleBtn.setAttribute('title', isSavedForLater ? 'Unsave Course' : 'Save Course');
        }
        if (writeReviewFooterBtn) {
            writeReviewFooterBtn.hidden = !shouldShowWriteReview;
        }
    };
    updateFooterActionLayout(isAlreadySelected);

    if (saveToggleBtn) {
        saveToggleBtn.addEventListener('click', async () => {
            try {
                saveToggleBtn.disabled = true;
                const result = await toggleSavedCourse({
                    course_code: course.course_code,
                    title: course.title,
                    academic_year: course.academic_year,
                    term: course.term,
                    time_slot: course.time_slot,
                    type: course.type,
                    credits: course.credits
                });
                isSavedForLater = !!result?.saved;
                syncSavedStatusBadge();
                updateFooterActionLayout(isAlreadySelected);
                emitCourseStatusUpdated({
                    action: isSavedForLater ? 'saved' : 'unsaved',
                    courseCode: String(course.course_code || '').trim(),
                    year: Number(course.academic_year) || null,
                    term: normalizeCourseTerm(course.term || '')
                });
            } catch (saveError) {
                console.error('Error toggling saved course:', saveError);
                showGlobalToast('Unable to update saved course right now. Please try again.');
            } finally {
                saveToggleBtn.disabled = false;
            }
        });
    }

    if (writeReviewFooterBtn) {
        writeReviewFooterBtn.addEventListener('click', (event) => {
            event.preventDefault();
            window.openAddReviewModal(course.course_code, course.academic_year, course.term, String(course.title || ''));
        });
    }

    if (session && !isAlreadySelected && course.time_slot) {
        setTimeout(async () => {
            if (isStaleRequest()) return;
            try {
                const previewTarget = document.getElementById('course-conflict-preview');
                if (!previewTarget) return;
                const conflictResult = await checkTimeConflictForModal(course.time_slot, course.course_code, course.academic_year);
                if (isStaleRequest()) return;
                if (!conflictResult?.hasConflict || !Array.isArray(conflictResult.conflictingCourses) || !conflictResult.conflictingCourses.length) {
                    return;
                }
                const firstConflict = conflictResult.conflictingCourses[0];
                const timeText = formatConflictPreviewTimeLabel(
                    firstConflict?.time_slot || course.time_slot,
                    { expanded: !isCourseInfoMobileViewport() }
                );
                const [slotTextRaw, timeRangeRaw = ''] = String(timeText || '').split(/\s*·\s*/, 2);
                const slotText = String(slotTextRaw || '').trim() || 'this timeslot';
                const timeRange = String(timeRangeRaw || '').trim();
                previewTarget.textContent = timeRange
                    ? `Conflicts with ${slotText} course (${timeRange})`
                    : `Conflicts with ${slotText} course`;
                previewTarget.style.display = 'flex';
            } catch (previewError) {
                console.warn('Unable to load course conflict preview:', previewError);
            }
        }, 0);
    }

    // Set up add/remove course button functionality
    const addRemoveButton = document.getElementById("class-add-remove");

    if (addRemoveButton) {
        // Always remove existing listener and set up fresh
        const newButton = addRemoveButton.cloneNode(true);
        addRemoveButton.parentNode.replaceChild(newButton, addRemoveButton);

        const SEMESTER_MAX_CREDITS = 24;
        const SEMESTER_MIN_CREDITS = 2;

        function parseCreditsValue(rawCredits) {
            if (rawCredits === null || rawCredits === undefined || rawCredits === '') return 0;
            if (typeof rawCredits === 'number') return Number.isFinite(rawCredits) ? rawCredits : 0;

            const matched = String(rawCredits).match(/(\d+(\.\d+)?)/);
            if (!matched) return 0;

            const parsed = parseFloat(matched[1]);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function formatCreditsValue(credits) {
            const normalized = Number(credits);
            if (!Number.isFinite(normalized)) return '0';
            if (Number.isInteger(normalized)) return String(normalized);
            return normalized.toFixed(1).replace(/\.0$/, '');
        }

        function isCourseSelectionInSemester(selectionEntry, year, term) {
            if (!selectionEntry?.code) return false;

            const selectionYear = parseInt(selectionEntry.year, 10);
            const targetYear = parseInt(year, 10);
            if (!Number.isFinite(selectionYear) || selectionYear !== targetYear) return false;

            if (!selectionEntry.term) return true;

            return normalizeCourseTerm(selectionEntry.term) === normalizeCourseTerm(term);
        }

        function getSemesterCreditStats(selectionEntries, creditsByCode, year, term) {
            const selectedCodes = new Set();

            (Array.isArray(selectionEntries) ? selectionEntries : []).forEach((selectionEntry) => {
                if (!isCourseSelectionInSemester(selectionEntry, year, term)) return;

                const normalizedCode = String(selectionEntry.code || '').trim();
                if (!normalizedCode) return;

                selectedCodes.add(normalizedCode);
            });

            let totalCredits = 0;
            selectedCodes.forEach((code) => {
                totalCredits += creditsByCode.get(code) || 0;
            });

            return {
                totalCredits,
                selectedCount: selectedCodes.size
            };
        }

        function showCourseActionToast(message, durationMs = 2200) {
            showGlobalToast(message, durationMs);
        }

        function formatConflictSlotForToast(timeSlot) {
            const raw = String(timeSlot || '').trim();
            if (!raw) return 'selected slot';

            const dayMapJPToAbbr = {
                '月': 'Mon',
                '火': 'Tue',
                '水': 'Wed',
                '木': 'Thu',
                '金': 'Fri',
                '土': 'Sat',
                '日': 'Sun'
            };
            const fullDayToAbbr = {
                Monday: 'Mon',
                Tuesday: 'Tue',
                Wednesday: 'Wed',
                Thursday: 'Thu',
                Friday: 'Fri',
                Saturday: 'Sat',
                Sunday: 'Sun'
            };
            const periodMap = {
                '1': '09:00-10:30',
                '2': '10:45-12:15',
                '3': '13:10-14:40',
                '4': '14:55-16:25',
                '5': '16:40-18:10'
            };

            const jpMatch = raw.match(/([月火水木金土日])(?:曜日)?\s*([1-5])(?:講時)?/);
            if (jpMatch) {
                const day = dayMapJPToAbbr[jpMatch[1]] || jpMatch[1];
                const timeWindow = periodMap[jpMatch[2]];
                if (timeWindow) return `${day} ${timeWindow}`;
                return day;
            }

            const englishFullMatch = raw.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/i);
            if (englishFullMatch) {
                const normalizedDay = englishFullMatch[1].charAt(0).toUpperCase() + englishFullMatch[1].slice(1).toLowerCase();
                const day = fullDayToAbbr[normalizedDay] || normalizedDay;
                return `${day} ${englishFullMatch[2]}\u2013${englishFullMatch[3]}`;
            }

            const englishAbbrMatch = raw.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/i);
            if (englishAbbrMatch) {
                const day = englishAbbrMatch[1].charAt(0).toUpperCase() + englishAbbrMatch[1].slice(1).toLowerCase();
                return `${day} ${englishAbbrMatch[2]}\u2013${englishAbbrMatch[3]}`;
            }

            return raw.replace(/\s*-\s*/g, '\u2013');
        }

        function getConflictReplacementToast(conflictingCourses, timeSlot) {
            const safeConflictingCourses = Array.isArray(conflictingCourses) ? conflictingCourses : [];
            const hasSectionConflict = safeConflictingCourses.some((courseEntry) => (
                String(courseEntry?.conflict_type || '') === 'same-course-section'
            ));
            const hasTimeConflict = safeConflictingCourses.some((courseEntry) => (
                String(courseEntry?.conflict_type || '') !== 'same-course-section'
            ));

            if (hasSectionConflict && hasTimeConflict) {
                return 'Replaced conflicting course and duplicate section.';
            }

            if (hasSectionConflict) {
                return 'Replaced duplicate course section.';
            }

            return `Replaced course in ${formatConflictSlotForToast(timeSlot)}.`;
        }

        async function fetchRegistrationProfile(userId) {
            let profileResponse = await supabase
                .from('profiles')
                .select('courses_selection, current_year, year_opt_out, year')
                .eq('id', userId)
                .single();

            if (profileResponse.error && hasMissingProfileColumnError(profileResponse.error)) {
                profileResponse = await supabase
                    .from('profiles')
                    .select('courses_selection')
                    .eq('id', userId)
                    .single();
            }

            return profileResponse?.data || null;
        }

        function syncRequiredYearEligibilityFromProfile(profileRow) {
            currentUserYearLevel = parseProfileCurrentYearLevel(profileRow);
            requiredYearMeta = getCourseRequiredYearMeta(course, currentUserYearLevel);
            shouldBlockRegistrationByYear = requiredYearMeta.hasRequiredYear
                && requiredYearMeta.hasKnownUserYear
                && !requiredYearMeta.meetsRequirement;
            shouldWarnUnknownYear = requiredYearMeta.hasRequiredYear && !requiredYearMeta.hasKnownUserYear;
        }

        // Simple function to check if course is selected
        async function isCourseSelected(courseCode, year) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return { selected: false, profile: null };

            const profile = await fetchRegistrationProfile(session.user.id);
            syncRequiredYearEligibilityFromProfile(profile);

            if (!profile?.courses_selection) {
                return { selected: false, profile };
            }

            // Filter by current year and term, then check for the course
            const currentYearCourses = filterCoursesByCurrentYearTerm(profile.courses_selection);
            return {
                selected: currentYearCourses.some(selected => selected.code === courseCode),
                profile
            };
        }

        // Simple function to update button appearance
        async function updateButton() {
            const selectionState = await isCourseSelected(course.course_code, course.academic_year);
            const isSelected = Boolean(selectionState?.selected);
            const canModify = isCurrentSemester();
            isAlreadySelected = isSelected;
            updateFooterActionLayout(isSelected);

            if (!canModify) {
                applyClassInfoCourseActionButtonState(newButton, 'locked');
            } else if (isSelected) {
                applyClassInfoCourseActionButtonState(newButton, 'remove');
            } else if (shouldBlockRegistrationByYear) {
                applyClassInfoCourseActionButtonState(newButton, 'ineligible');
            } else {
                applyClassInfoCourseActionButtonState(newButton, 'add');
            }
            syncRegistrationStatusBadge();
        }

        // Set initial button state
        await updateButton();

        // Add click handler
        newButton.addEventListener("click", async function (e) {
            e.preventDefault();

            // Check if we can modify courses for this semester
            if (!isCurrentSemester()) {
                showCourseActionToast('Registration is closed for this semester.');
                return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                // Use authentication modal system
                if (window.requireAuth) {
                    window.requireAuth('add this course to your schedule', async () => {
                        // After successful authentication, update the UI and check course status
                        await updateCourseButtonState(course, newButton);
                        // Then trigger the add course action
                        newButton.click();
                    });
                } else {
                    showCourseActionToast('Please log in to manage courses.');
                }
                return;
            }

            try {
                // Get current profile
                const profile = await fetchRegistrationProfile(session.user.id);
                syncRequiredYearEligibilityFromProfile(profile);

                const currentSelection = profile?.courses_selection || [];
                const currentYear = getCurrentYear();
                const currentTerm = getCurrentTerm();
                const normalizedCurrentTerm = normalizeCourseTerm(currentTerm);

                const semesterCourses = await fetchCourseData(currentYear, normalizedCurrentTerm);
                const semesterCreditsByCode = new Map();

                (Array.isArray(semesterCourses) ? semesterCourses : []).forEach((semesterCourse) => {
                    const courseCode = String(semesterCourse?.course_code || '').trim();
                    if (!courseCode || semesterCreditsByCode.has(courseCode)) return;

                    semesterCreditsByCode.set(courseCode, parseCreditsValue(semesterCourse?.credits));
                });

                const currentCourseCode = String(course.course_code || '').trim();
                if (currentCourseCode && !semesterCreditsByCode.has(currentCourseCode)) {
                    semesterCreditsByCode.set(currentCourseCode, parseCreditsValue(course.credits));
                }

                const isCurrentlySelected = currentSelection.some((selected) =>
                    isCourseSelectionInSemester(selected, currentYear, currentTerm) &&
                    String(selected.code || '').trim() === currentCourseCode
                );
                let didShowUnknownYearWarning = false;
                const enforceRequiredYearEligibility = ({ showUnknownWarning = false } = {}) => {
                    if (requiredYearMeta.hasRequiredYear && requiredYearMeta.hasKnownUserYear && !requiredYearMeta.meetsRequirement) {
                        showCourseActionToast(
                            `This course requires ${requiredYearMeta.requiredYearLabel}. Your profile is set to ${requiredYearMeta.userYearLabel}.`,
                            3600
                        );
                        return false;
                    }

                    if (
                        showUnknownWarning &&
                        shouldWarnUnknownYear &&
                        !didShowUnknownYearWarning
                    ) {
                        didShowUnknownYearWarning = true;
                        showCourseActionToast(
                            `We could not verify your current year. Registration is allowed, but this course requires ${requiredYearMeta.requiredYearLabel}.`,
                            3600
                        );
                    }

                    return true;
                };

                if (isCurrentlySelected) {
                    const shouldRemove = await openConfirmModal({
                        title: 'Remove course',
                        message: 'Remove this course from your schedule?',
                        confirmLabel: 'Remove',
                        cancelLabel: 'Cancel',
                        destructive: true
                    });
                    if (!shouldRemove) {
                        return;
                    }

                    // Remove course - remove from the full selection, not just current year
                    const updatedSelection = currentSelection.filter(selected =>
                        !(
                            String(selected.code || '').trim() === currentCourseCode &&
                            isCourseSelectionInSemester(selected, currentYear, currentTerm)
                        )
                    );

                    const removalStats = getSemesterCreditStats(
                        updatedSelection,
                        semesterCreditsByCode,
                        currentYear,
                        currentTerm
                    );

                    if (removalStats.selectedCount > 0 && removalStats.totalCredits < SEMESTER_MIN_CREDITS) {
                        showCourseActionToast(
                            `Minimum limit: You must register for at least ${SEMESTER_MIN_CREDITS} credits per semester. ` +
                            `This change would leave you with ${formatCreditsValue(removalStats.totalCredits)} credits.`,
                            3600
                        );
                        return;
                    }

                    const { error } = await supabase
                        .from('profiles')
                        .update({ courses_selection: updatedSelection })
                        .eq('id', session.user.id);

                    if (error) {
                        console.error('Error removing course:', error);
                        showCourseActionToast('Failed to remove course. Please try again.');
                        return;
                    }

                    showCourseActionToast('Course removed successfully!');
                    // Update button state after successful removal
                    await updateCourseButtonState(course, newButton);
                } else {
                    if (!enforceRequiredYearEligibility({ showUnknownWarning: true })) {
                        return;
                    }

                    // Check for conflicts first
                    console.log('Checking for conflicts for course:', course.course_code, 'time:', course.time_slot);
                    const conflictResult = await checkTimeConflictForModal(course.time_slot, course.course_code, course.academic_year);
                    console.log('Conflict result:', conflictResult);

                    if (conflictResult.hasConflict) {
                        console.log('Conflict detected, showing modal');
                        showTimeConflictModal(conflictResult.conflictingCourses, course, async (shouldReplace, conflictingCourses, actionType = 'dismiss') => {
                            if (shouldReplace) {
                                if (!enforceRequiredYearEligibility()) {
                                    return;
                                }

                                // Remove conflicting courses and add new one
                                let updatedSelection = currentSelection.filter(selected => {
                                    return !conflictingCourses.some(conflict => {
                                        // Remove conflicting courses from current year/term only
                                        return String(conflict.course_code || '').trim() === String(selected.code || '').trim() &&
                                            isCourseSelectionInSemester(selected, currentYear, currentTerm);
                                    });
                                });

                                // Add the new course with current year and term
                                updatedSelection = [
                                    ...updatedSelection,
                                    {
                                        code: currentCourseCode,
                                        year: currentYear,
                                        term: currentTerm
                                    }
                                ];

                                const replacementStats = getSemesterCreditStats(
                                    updatedSelection,
                                    semesterCreditsByCode,
                                    currentYear,
                                    currentTerm
                                );

                                if (replacementStats.totalCredits > SEMESTER_MAX_CREDITS) {
                                    showCourseActionToast(
                                        `Maximum limit: You can register for up to ${SEMESTER_MAX_CREDITS} credits per semester. ` +
                                        `This change would bring you to ${formatCreditsValue(replacementStats.totalCredits)} credits.`,
                                        3600
                                    );
                                    return;
                                }

                                if (replacementStats.selectedCount > 0 && replacementStats.totalCredits < SEMESTER_MIN_CREDITS) {
                                    showCourseActionToast(
                                        `Minimum limit: You must register for at least ${SEMESTER_MIN_CREDITS} credits per semester. ` +
                                        `This change would leave you with ${formatCreditsValue(replacementStats.totalCredits)} credits.`,
                                        3600
                                    );
                                    return;
                                }

                                // TODO(back-end): move registration mutations to a validated RPC
                                // that enforces required_year on the server side.
                                const { error } = await supabase
                                    .from('profiles')
                                    .update({ courses_selection: updatedSelection })
                                    .eq('id', session.user.id);

                                if (error) {
                                    console.error('Error updating courses:', error);
                                    showCourseActionToast('Failed to update courses. Please try again.');
                                    return;
                                }

                                showCourseActionToast(getConflictReplacementToast(conflictingCourses, course.time_slot));
                                await updateButton();
                                // Also update the button state specifically
                                await updateCourseButtonState(course, newButton);
                                emitCourseStatusUpdated({
                                    action: 'registered',
                                    courseCode: currentCourseCode,
                                    year: currentYear,
                                    term: currentTerm
                                });
                                if (window.refreshCalendarComponent) {
                                    window.refreshCalendarComponent();
                                }
                                return;
                            }

                            if (actionType === 'keep') {
                                showCourseActionToast('Kept current course.');
                            }
                        });
                        return;
                    }

                    if (!enforceRequiredYearEligibility()) {
                        return;
                    }

                    // Add course with current year and term
                    const updatedSelection = [
                        ...currentSelection,
                        {
                            code: currentCourseCode,
                            year: currentYear,
                            term: currentTerm
                        }
                    ];

                    const additionStats = getSemesterCreditStats(
                        updatedSelection,
                        semesterCreditsByCode,
                        currentYear,
                        currentTerm
                    );

                    if (additionStats.totalCredits > SEMESTER_MAX_CREDITS) {
                        showCourseActionToast(
                            `Maximum limit: You can register for up to ${SEMESTER_MAX_CREDITS} credits per semester. ` +
                            `This change would bring you to ${formatCreditsValue(additionStats.totalCredits)} credits.`,
                            3600
                        );
                        return;
                    }

                    if (additionStats.selectedCount > 0 && additionStats.totalCredits < SEMESTER_MIN_CREDITS) {
                        showCourseActionToast(
                            `Minimum limit: You must register for at least ${SEMESTER_MIN_CREDITS} credits per semester. ` +
                            `This change would leave you with ${formatCreditsValue(additionStats.totalCredits)} credits.`,
                            3600
                        );
                        return;
                    }

                    // TODO(back-end): move registration mutations to a validated RPC
                    // that enforces required_year on the server side.
                    const { error } = await supabase
                        .from('profiles')
                        .update({ courses_selection: updatedSelection })
                        .eq('id', session.user.id);

                    if (error) {
                        console.error('Error adding course:', error);
                        showCourseActionToast('Failed to add course. Please try again.');
                        return;
                    }

                    showCourseActionToast('Course added successfully!');
                }

                // Update button and refresh calendar
                await updateButton();
                // Also update the button state specifically
                await updateCourseButtonState(course, newButton);
                if (window.refreshCalendarComponent) {
                    window.refreshCalendarComponent();
                }
                emitCourseStatusUpdated({
                    action: isCurrentlySelected ? 'unregistered' : 'registered',
                    courseCode: currentCourseCode,
                    year: currentYear,
                    term: currentTerm
                });

            } catch (error) {
                console.error('Error managing course:', error);
                showCourseActionToast('An error occurred. Please try again.');
            }
        });
    }

    if (!isDedicatedCoursePage && !classClose.dataset.listenerAttached) {
        classClose.addEventListener("click", function () {
            closeCourseInfoSheet({ restoreURL: true });
        });
        classClose.dataset.listenerAttached = "true";
    }
}

// Global function to load more reviews
window.loadMoreReviews = async function (courseCode, academicYear, term, currentlyShowing) {
    try {
        const { course: visibleCourse } = getVisibleCourseInfoCourseContext();
        const requestedFamily = getCourseCodeFamily(courseCode);
        const visibleFamily = getCourseCodeFamily(visibleCourse?.course_code || '');
        const titleForMatching = requestedFamily && visibleFamily && requestedFamily === visibleFamily
            ? String(visibleCourse?.title || '')
            : '';
        const equivalentCourseCodes = await resolveEquivalentCourseCodesForReviews({
            courseCode,
            courseTitle: titleForMatching
        });

        // Build the query - if academicYear is null, get reviews from all years
        let query = applyCourseReviewCodeFilter(
            supabase
            .from('course_reviews')
            .select('*'),
            equivalentCourseCodes,
            courseCode
        )
            .order('created_at', { ascending: false });

        // Only filter by academic year if it's provided
        if (academicYear !== null) {
            query = query.eq('academic_year', academicYear);
        }

        const { data: reviews, error: reviewsError } = await query;

        if (reviewsError) {
            console.error('Error loading more reviews:', reviewsError);
            return;
        }

        if (!reviews || reviews.length === 0) {
            return;
        }

        // Then, get user profiles for each review
        const userIds = reviews.map(review => review.user_id);

        // Get user profiles from profiles table  
        let profiles = null;
        let profilesError = null;

        // Try common column name variations
        const possibleSelects = [
            'id, display_name, avatar_url',
            'id, name, avatar_url',
            'id, full_name, avatar_url',
            'id, username, avatar_url',
            'id, email, avatar_url',
            '*'
        ];

        for (let selectString of possibleSelects) {
            const { data: profilesData, error: err } = await supabase
                .from('profiles')
                .select(selectString)
                .in('id', userIds);

            if (!err) {
                profiles = profilesData;
                break;
            } else {
                profilesError = err;
            }
        }

        if (profilesError && !profiles) {
            console.error('Error loading profiles:', profilesError);
        }

        // Get current session once for all reviews
        const { data: { session } } = await supabase.auth.getSession();

        // Combine reviews with profile data (but we'll anonymize them later)
        const reviewsWithProfiles = reviews.map(review => {
            const profile = profiles?.find(p => p.id === review.user_id);

            if (profile) {
                // Try different possible column names for the display name
                let displayName = profile.display_name ||
                    profile.name ||
                    profile.full_name ||
                    profile.username ||
                    profile.email;

                // If display_name is null/undefined and we still don't have a name, try to get it from session
                if (!displayName || displayName === null) {
                    if (session && session.user && session.user.id === review.user_id) {
                        displayName = session.user.email?.split('@')[0] || 'Current User';
                    } else {
                        displayName = 'Anonymous User';
                    }
                }

                return {
                    ...review,
                    profiles: {
                        display_name: displayName,
                        avatar_url: profile.avatar_url || null
                    }
                };
            } else {
                // If no profile found, try to get current user info
                if (session && session.user && session.user.id === review.user_id) {
                    const displayName = session.user.email?.split('@')[0] || 'Current User';
                    return {
                        ...review,
                        profiles: {
                            display_name: displayName,
                            avatar_url: null
                        }
                    };
                }

                return {
                    ...review,
                    profiles: { display_name: 'Anonymous User', avatar_url: null }
                };
            }
        });

        // Use the session already obtained above for current user ID
        const currentUserId = session?.user?.id;

        // Sort reviews to put user's own review first, then by creation date
        const sortedReviews = reviewsWithProfiles.sort((a, b) => {
            const aIsOwn = currentUserId && a.user_id === currentUserId;
            const bIsOwn = currentUserId && b.user_id === currentUserId;

            if (aIsOwn && !bIsOwn) return -1;  // User's review goes first
            if (!aIsOwn && bIsOwn) return 1;   // Other user's review goes second

            // If both are user's or both are others', sort by date (newest first)
            return new Date(b.created_at) - new Date(a.created_at);
        });

        const reviewsList = document.getElementById(`reviews-list-${courseCode}`);
        const loadMoreBtn = document.querySelector('.load-more-reviews');

        if (reviewsList && sortedReviews) {
            const nonUserReviews = sortedReviews.filter((review) => !(currentUserId && review.user_id === currentUserId));
            const nextBatch = nonUserReviews.slice(currentlyShowing, currentlyShowing + 3);

            // Count non-user reviews that have already been shown to continue numbering correctly
            const nonUserReviewsShownSoFar = currentlyShowing;

            nextBatch.forEach((review, index) => {
                const studentNumber = nonUserReviewsShownSoFar + index + 1;
                const anonymousName = `Student ${studentNumber}`;
                const avatarSrc = "/user.svg";

                const reviewElement = document.createElement('div');
                reviewElement.innerHTML = renderReview(review, currentUserId, anonymousName, avatarSrc);
                reviewsList.appendChild(reviewElement.firstElementChild);
            });

            const newCurrentlyShowing = currentlyShowing + nextBatch.length;

            if (newCurrentlyShowing >= nonUserReviews.length) {
                loadMoreBtn?.remove();
            } else {
                if (loadMoreBtn) {
                    loadMoreBtn.textContent = `Load More Reviews (${nonUserReviews.length - newCurrentlyShowing} more)`;
                    loadMoreBtn.onclick = () => loadMoreReviews(courseCode, academicYear, term, newCurrentlyShowing);
                }
            }
        }
    } catch (error) {
        console.error('Error loading more reviews:', error);
    }
};

function normalizeReviewRatingValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const rounded = Math.round(parsed);
    return rounded >= 1 && rounded <= 5 ? rounded : 0;
}

function getReviewQualityRating(review) {
    return normalizeReviewRatingValue(review?.quality_rating ?? review?.rating);
}

function getReviewDifficultyRating(review) {
    // Fall back to the legacy single rating so older reviews still render two lines.
    return normalizeReviewRatingValue(review?.difficulty_rating ?? review?.rating);
}

function formatReviewRatingLine(label, rating) {
    const safeLabel = label || 'Rating';
    const safeRating = normalizeReviewRatingValue(rating);
    return `${safeLabel} ${safeRating} out of 5`;
}

function isMissingDualReviewRatingColumnsError(error) {
    const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return raw.includes('quality_rating') || raw.includes('difficulty_rating');
}

function buildCourseReviewWritePayload({ userId = null, courseCode = null, academicYear, term, qualityRating, difficultyRating, content }) {
    const payload = {
        academic_year: academicYear,
        term,
        rating: qualityRating,
        quality_rating: qualityRating,
        difficulty_rating: difficultyRating,
        content
    };
    if (userId) payload.user_id = userId;
    if (courseCode) payload.course_code = courseCode;
    return payload;
}

function reviewModalSupportsHover() {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function buildReviewYearOptions(selectedYear) {
    const currentYear = new Date().getFullYear();
    let options = '<option value="">Select year...</option>';
    for (let year = currentYear; year >= currentYear - 10; year--) {
        const selected = year === Number(selectedYear) ? 'selected' : '';
        options += `<option value="${year}" ${selected}>${year}</option>`;
    }
    return options;
}

function buildReviewTermOptions(selectedTerm) {
    const normalized = normalizeCourseTerm(selectedTerm) || '';
    return `
        <option value="">Select term...</option>
        <option value="Fall" ${normalized === 'Fall' ? 'selected' : ''}>Fall</option>
        <option value="Spring" ${normalized === 'Spring' ? 'selected' : ''}>Spring</option>
    `;
}

function formatDifficultyRatingLabel(rating) {
    const safeRating = normalizeReviewRatingValue(rating);
    if (!safeRating) return 'Select difficulty';
    const labels = {
        1: 'Very Easy',
        2: 'Easy',
        3: 'Moderate',
        4: 'Difficult',
        5: 'Very Difficult'
    };
    return `${safeRating} - ${labels[safeRating] || 'Difficulty'}`;
}

function getDifficultyRatingTone(rating) {
    const safeRating = normalizeReviewRatingValue(rating);
    if (!safeRating) return '';
    if (safeRating <= 2) return 'easy';
    if (safeRating <= 4) return 'medium';
    return 'hard';
}

function setDifficultyRatingLabelVisualState(valueElement, rating) {
    if (!valueElement) return;
    const tone = getDifficultyRatingTone(rating);
    if (tone) {
        valueElement.dataset.difficultyTone = tone;
    } else {
        delete valueElement.dataset.difficultyTone;
    }
}

function attachReviewModalFormEnhancements(root, { isEdit = false, initialQualityRating = 0, initialDifficultyRating = 0 } = {}) {
    const suffix = isEdit ? '-edit' : '';
    const textarea = root.querySelector(`#review-content${suffix}`);
    const counter = root.querySelector(`[data-role="review-char-count${suffix}"]`);
    const qualityRatingInput = root.querySelector(`#quality-rating-input${suffix}`);
    const qualityRatingValue = root.querySelector(`[data-role="quality-review-rating-value${suffix}"]`);
    const difficultyRatingInput = root.querySelector(`#difficulty-rating-input${suffix}`);
    const difficultyRatingValue = root.querySelector(`[data-role="difficulty-review-rating-value${suffix}"]`);
    const cleanupFns = [];

    if (textarea && counter) {
        let textareaMinHeight = 0;
        const resizeTextarea = () => {
            if (!textarea.isConnected) return;
            if (!textareaMinHeight) {
                const computedMinHeight = parseFloat(window.getComputedStyle(textarea).minHeight || '0');
                textareaMinHeight = Number.isFinite(computedMinHeight) ? computedMinHeight : 0;
            }
            textarea.style.height = 'auto';
            const nextHeight = Math.max(textarea.scrollHeight, textareaMinHeight || 0);
            textarea.style.height = `${nextHeight}px`;
            textarea.style.overflowY = 'hidden';
        };
        const updateCounter = () => {
            counter.textContent = `${textarea.value.length}/800`;
        };
        const handleTextareaInput = () => {
            updateCounter();
            resizeTextarea();
        };
        textarea.addEventListener('input', handleTextareaInput);
        handleTextareaInput();
        cleanupFns.push(() => {
            textarea.removeEventListener('input', handleTextareaInput);
        });
    }

    if (qualityRatingValue) {
        const rating = Number(initialQualityRating) || 0;
        qualityRatingValue.textContent = rating ? `${rating}/5` : '0/5';
    }

    if (difficultyRatingValue) {
        const rating = Number(initialDifficultyRating) || 0;
        difficultyRatingValue.textContent = formatDifficultyRatingLabel(rating);
        setDifficultyRatingLabelVisualState(difficultyRatingValue, rating);
    }

    if (qualityRatingInput && Number(initialQualityRating) > 0) {
        qualityRatingInput.dataset.selectedRating = String(initialQualityRating);
    }

    if (difficultyRatingInput && Number(initialDifficultyRating) > 0) {
        difficultyRatingInput.dataset.selectedRating = String(initialDifficultyRating);
    }

    const reviewSelects = Array.from(root.querySelectorAll('.review-form-select'));
    if (reviewSelects.length) {
        const closeAllReviewCustomSelects = (except = null) => {
            root.querySelectorAll('.review-form-custom-select.open').forEach((customSelect) => {
                if (except && customSelect === except) return;
                customSelect.classList.remove('open');
                const trigger = customSelect.querySelector('.custom-select-trigger');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            });
        };

        const buildReviewCustomSelect = (nativeSelect) => {
            if (!nativeSelect || nativeSelect.dataset.customSelectMounted === 'true') return;
            nativeSelect.dataset.customSelectMounted = 'true';
            nativeSelect.classList.add('review-form-native-select');

            const wrapper = document.createElement('div');
            wrapper.className = 'ui-select custom-select review-form-custom-select profile-custom-select';
            wrapper.dataset.target = nativeSelect.id || '';

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'ui-select__trigger custom-select-trigger control-surface';
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');

            const valueEl = document.createElement('span');
            valueEl.className = 'ui-select__value custom-select-value';
            const arrowEl = document.createElement('span');
            arrowEl.className = 'ui-select__arrow custom-select-arrow';
            arrowEl.setAttribute('aria-hidden', 'true');
            trigger.append(valueEl, arrowEl);

            const optionsEl = document.createElement('div');
            optionsEl.className = 'ui-select__menu custom-select-options';
            const optionsInnerEl = document.createElement('div');
            optionsInnerEl.className = 'ui-select__options-inner custom-select-options-inner';
            optionsEl.appendChild(optionsInnerEl);

            const syncFromNative = () => {
                const selectedValue = nativeSelect.value;
                const selectedOption = Array.from(nativeSelect.options).find((option) => option.value === selectedValue) || nativeSelect.options[0];
                valueEl.textContent = selectedOption?.textContent || '';
                optionsInnerEl.querySelectorAll('.custom-select-option').forEach((optEl) => {
                    const isSelected = optEl.dataset.value === selectedValue;
                    optEl.classList.toggle('selected', isSelected);
                    optEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                });
            };

            Array.from(nativeSelect.options).forEach((option) => {
                const optionEl = document.createElement('button');
                optionEl.type = 'button';
                optionEl.className = 'ui-select__option custom-select-option';
                optionEl.dataset.value = option.value;
                optionEl.setAttribute('role', 'option');
                optionEl.setAttribute('aria-selected', 'false');
                optionEl.textContent = option.textContent || '';
                optionEl.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    nativeSelect.value = option.value;
                    nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    syncFromNative();
                    wrapper.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                    trigger.focus();
                });
                optionsInnerEl.appendChild(optionEl);
            });

            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const isYearSelect = /course-year/i.test(nativeSelect.id || '');
                const openedMobileSheet = openSemesterMobileSheet({
                    targetSelect: nativeSelect,
                    force: true,
                    title: isYearSelect ? 'Select year' : 'Select term',
                    description: ''
                });
                if (openedMobileSheet) {
                    closeAllReviewCustomSelects();
                    return;
                }
                const willOpen = !wrapper.classList.contains('open');
                closeAllReviewCustomSelects(wrapper);
                wrapper.classList.toggle('open', willOpen);
                trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });

            trigger.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    wrapper.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    closeAllReviewCustomSelects(wrapper);
                    wrapper.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                    optionsInnerEl.querySelector('.custom-select-option.selected, .custom-select-option')?.focus();
                }
            });

            optionsInnerEl.addEventListener('keydown', (event) => {
                const current = event.target.closest('.custom-select-option');
                if (!current) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    wrapper.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                    trigger.focus();
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const options = Array.from(optionsInnerEl.querySelectorAll('.custom-select-option'));
                    const index = options.indexOf(current);
                    const nextIndex = event.key === 'ArrowDown'
                        ? Math.min(options.length - 1, index + 1)
                        : Math.max(0, index - 1);
                    options[nextIndex]?.focus();
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    current.click();
                }
            });

            nativeSelect.addEventListener('change', syncFromNative);
            wrapper.append(trigger, optionsEl);
            nativeSelect.insertAdjacentElement('afterend', wrapper);
            syncFromNative();

            cleanupFns.push(() => {
                nativeSelect.removeEventListener('change', syncFromNative);
                wrapper.remove();
                delete nativeSelect.dataset.customSelectMounted;
                nativeSelect.classList.remove('review-form-native-select');
            });
        };

        reviewSelects.forEach(buildReviewCustomSelect);

        const handleDocumentClick = (event) => {
            if (!root.isConnected) return;
            if (!event.target.closest('.review-form-custom-select')) {
                closeAllReviewCustomSelects();
            }
        };
        const handleRootFocusOut = (event) => {
            if (!root.contains(event.relatedTarget)) {
                closeAllReviewCustomSelects();
            }
        };
        document.addEventListener('click', handleDocumentClick, true);
        root.addEventListener('focusout', handleRootFocusOut);
        cleanupFns.push(() => {
            document.removeEventListener('click', handleDocumentClick, true);
            root.removeEventListener('focusout', handleRootFocusOut);
        });
    }

    return () => {
        cleanupFns.forEach((fn) => {
            try { fn(); } catch (_) { }
        });
    };
}

function attachReviewModalKeyboardSafety(modalRoot) {
    if (!modalRoot) return () => { };
    if (!isCourseInfoMobileViewport()) return () => { };

    const modalDialog = modalRoot.querySelector('.modal-dialog');
    const viewport = window.visualViewport;
    if (!modalDialog || !viewport) return () => { };

    const updateInsets = () => {
        const overlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        modalDialog.style.setProperty('--keyboard-inset', `${Math.round(overlap)}px`);
    };

    const handleFocusIn = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('textarea, input, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
        window.setTimeout(() => {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 120);
    };

    updateInsets();
    viewport.addEventListener('resize', updateInsets);
    viewport.addEventListener('scroll', updateInsets);
    modalRoot.addEventListener('focusin', handleFocusIn, true);

    return () => {
        viewport.removeEventListener('resize', updateInsets);
        viewport.removeEventListener('scroll', updateInsets);
        modalRoot.removeEventListener('focusin', handleFocusIn, true);
        modalDialog.style.removeProperty('--keyboard-inset');
    };
}

function openReviewFormModal({
    mode = 'add',
    courseCode,
    courseTitle,
    defaultYear,
    defaultTerm,
    reviewId = null,
    qualityRating = 0,
    difficultyRating = 0,
    rating = 0,
    content = ''
}) {
    const isEdit = mode === 'edit';
    const suffix = isEdit ? '-edit' : '';
    const modalTitle = isEdit ? 'Edit review' : 'Write a review';
    const submitLabel = isEdit ? 'Save changes' : 'Submit review';
    const initialQualityRating = Number(qualityRating || rating) || 0;
    const initialDifficultyRating = Number(difficultyRating || rating) || 0;

    const buildStarRatingField = ({ label, kind, selectedRating, errorId, setterName, hoverName, unhoverName }) => `
        <div class="review-form-row">
            <label>${label}</label>
            <div class="review-rating-input">
                <div class="star-rating-input" id="${kind}-rating-input${suffix}" data-selected-rating="${Number(selectedRating) || 0}">
                    ${[1, 2, 3, 4, 5].map(starValue => {
        const filled = starValue <= Number(selectedRating || 0);
        const attrs = [
            `class="star-input ${filled ? 'selected' : ''}"`,
            `data-rating="${starValue}"`,
            `onclick="${setterName}(${starValue})"`,
            reviewModalSupportsHover() ? `onmouseover="${hoverName}(${starValue})" onmouseout="${unhoverName}()"` : ''
        ].filter(Boolean).join(' ');
        return `<span ${attrs} aria-hidden="true"></span>`;
    }).join('')}
                </div>
                <span class="review-rating-value" data-role="${kind}-review-rating-value${suffix}">${Number(selectedRating) ? `${Number(selectedRating)}/5` : '0/5'}</span>
            </div>
            <div class="review-field-error" id="${errorId}${isEdit ? '-edit' : ''}" style="display:none;"></div>
        </div>
    `;

    const buildDifficultyRatingField = ({ selectedRating, errorId, setterName, hoverName, unhoverName }) => `
        <div class="review-form-row">
            <label>Difficulty rating</label>
            <div class="review-rating-input review-rating-input--difficulty">
                <div class="difficulty-scale-input" id="difficulty-rating-input${suffix}" data-selected-rating="${Number(selectedRating) || 0}">
                    ${[1, 2, 3, 4, 5].map((difficultyValue) => {
        const filled = difficultyValue <= Number(selectedRating || 0);
        const attrs = [
            `class="difficulty-segment-input difficulty-segment-input--${difficultyValue} ${filled ? 'selected' : ''}"`,
            `data-rating="${difficultyValue}"`,
            `tabindex="0"`,
            `role="button"`,
            `aria-label="Set difficulty rating to ${difficultyValue}"`,
            `aria-pressed="${filled ? 'true' : 'false'}"`,
            `onclick="${setterName}(${difficultyValue})"`,
            `onkeydown="${isEdit ? 'handleEditDifficultyRatingKeydown' : 'handleDifficultyRatingKeydown'}(event, ${difficultyValue})"`,
            reviewModalSupportsHover() ? `onmouseover="${hoverName}(${difficultyValue})" onmouseout="${unhoverName}()"` : ''
        ].filter(Boolean).join(' ');
        return `<span ${attrs} aria-hidden="true"></span>`;
    }).join('')}
                </div>
                <span class="review-rating-value review-rating-value--difficulty" data-role="difficulty-review-rating-value${suffix}">${formatDifficultyRatingLabel(selectedRating)}</span>
            </div>
            <div class="review-field-error" id="${errorId}${isEdit ? '-edit' : ''}" style="display:none;"></div>
        </div>
    `;

    const bodyHtml = `
        <div class="review-form-grid">
            <section class="review-form-section review-form-section--meta">
                <div class="review-form-row">
                    <label>Term taken</label>
                    <div class="review-form-inline">
                        <select id="review-term${suffix}" class="review-form-select">${buildReviewTermOptions(defaultTerm)}</select>
                        <select id="course-year${suffix}" class="review-form-select">${buildReviewYearOptions(defaultYear)}</select>
                    </div>
                    <div class="review-field-error" id="course-year-error${isEdit ? '-edit' : ''}" style="display:none;"></div>
                </div>
                ${buildStarRatingField({
        label: 'Quality rating',
        kind: 'quality',
        selectedRating: initialQualityRating,
        errorId: 'quality-rating-error',
        setterName: isEdit ? 'setEditQualityRating' : 'setQualityRating',
        hoverName: isEdit ? 'hoverEditQualityRating' : 'hoverQualityRating',
        unhoverName: isEdit ? 'unhoverEditQualityRating' : 'unhoverQualityRating'
    })}
                ${buildDifficultyRatingField({
        selectedRating: initialDifficultyRating,
        errorId: 'difficulty-rating-error',
        setterName: isEdit ? 'setEditDifficultyRating' : 'setDifficultyRating',
        hoverName: isEdit ? 'hoverEditDifficultyRating' : 'hoverDifficultyRating',
        unhoverName: isEdit ? 'unhoverEditDifficultyRating' : 'unhoverDifficultyRating'
    })}
            </section>
            <section class="review-form-section review-form-section--notes">
                <div class="review-form-row">
                    <label for="review-content${suffix}">Written review</label>
                    <textarea id="review-content${suffix}" class="review-form-textarea" maxlength="800" placeholder="Share your experience with this course...">${escapeHtml(content || '')}</textarea>
                    <div class="review-char-count" data-role="review-char-count${suffix}">0/800</div>
                    <div class="review-field-error" id="review-content-error${isEdit ? '-edit' : ''}" style="display:none;"></div>
                </div>
            </section>
        </div>
    `;

    const footerHtml = `
        <button type="button" class="btn-secondary review-form-cancel-btn" data-action="cancel-review-form">Cancel</button>
        <button type="button" class="btn-primary review-form-save-btn ${isEdit ? 'update-review' : 'submit-review'}" data-action="${isEdit ? 'update-review-submit' : 'submit-review-submit'}" ${isEdit ? `data-review-id="${escapeHtml(reviewId || '')}"` : ''} data-course-code="${escapeHtml(courseCode || '')}" data-course-year="${escapeHtml(defaultYear || '')}" data-course-term="${escapeHtml(defaultTerm || '')}">${submitLabel}</button>
    `;

    const modalSession = openDsModal({
        title: modalTitle,
        subtitle: courseTitle || courseCode || '',
        bodyHtml,
        footerHtml,
        className: 'review-modal-host review-modal--assignment',
        mobileSwipe: false,
        onMount: (modal, close) => {
            window.__closeReviewModal = close;
            const readReviewFormState = () => ({
                term: modal.querySelector(`#review-term${suffix}`)?.value || '',
                year: modal.querySelector(`#course-year${suffix}`)?.value || '',
                quality: modal.querySelector(`#quality-rating-input${suffix}`)?.dataset?.selectedRating || '0',
                difficulty: modal.querySelector(`#difficulty-rating-input${suffix}`)?.dataset?.selectedRating || '0',
                content: modal.querySelector(`#review-content${suffix}`)?.value || ''
            });
            const initialReviewFormState = readReviewFormState();
            let closeConfirmInFlight = false;
            const hasReviewFormChanges = () => {
                const current = readReviewFormState();
                return Object.keys(initialReviewFormState).some((key) => String(current[key] ?? '') !== String(initialReviewFormState[key] ?? ''));
            };
            const attemptCloseReviewForm = async () => {
                if (closeConfirmInFlight) return;
                if (!hasReviewFormChanges()) {
                    close();
                    return;
                }
                closeConfirmInFlight = true;
                try {
                    const shouldDiscard = await openConfirmModal({
                        title: 'Discard changes?',
                        message: 'You have unsaved changes to this review.',
                        confirmLabel: 'Discard',
                        cancelLabel: 'Keep editing',
                        destructive: true
                    });
                    if (shouldDiscard) close();
                } finally {
                    closeConfirmInFlight = false;
                }
            };
            if (isEdit) {
                const header = modal.querySelector('.modal-header');
                if (header) {
                    let topActions = modal.querySelector('.review-modal-top-actions');
                    if (!topActions) {
                        topActions = document.createElement('div');
                        topActions.className = 'review-modal-top-actions';
                        header.insertAdjacentElement('afterend', topActions);
                    }
                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'btn-destructive review-delete-btn review-delete-btn--top';
                    deleteBtn.dataset.action = 'delete-review';
                    deleteBtn.dataset.reviewId = String(reviewId || '');
                    deleteBtn.dataset.defaultText = 'Delete';
                    deleteBtn.setAttribute('aria-label', 'Delete review');
                    deleteBtn.textContent = 'Delete';
                    topActions.replaceChildren(deleteBtn);
                }
            }
            modal.querySelector('[data-action="cancel-review-form"]')?.addEventListener('click', (event) => {
                event.preventDefault();
                attemptCloseReviewForm();
            });
            modal.__requestClose = () => {
                attemptCloseReviewForm();
                return true;
            };

            const cleanupEnhancements = attachReviewModalFormEnhancements(modal, {
                isEdit,
                initialQualityRating,
                initialDifficultyRating
            });
            if (typeof cleanupEnhancements === 'function') {
                modal.__reviewFormEnhancementsCleanup = cleanupEnhancements;
            }

            const cleanupKeyboardSafety = attachReviewModalKeyboardSafety(modal);
            if (typeof cleanupKeyboardSafety === 'function') {
                modal.__reviewKeyboardSafetyCleanup = cleanupKeyboardSafety;
            }

            modal.querySelector('[data-action="submit-review-submit"]')?.addEventListener('click', () => {
                window.submitReview(courseCode, defaultYear, defaultTerm);
            });
            modal.querySelector('[data-action="update-review-submit"]')?.addEventListener('click', () => {
                window.updateReview(String(reviewId || ''));
            });
            modal.querySelector('[data-action="delete-review"]')?.addEventListener('click', () => {
                window.deleteReview(String(reviewId || ''));
            });
        },
        onClose: () => {
            try { modalSession?.modal?.__reviewFormEnhancementsCleanup?.(); } catch (_) { }
            try { modalSession?.modal?.__reviewKeyboardSafetyCleanup?.(); } catch (_) { }
            window.__closeReviewModal = null;
            const classInfo = document.getElementById("class-info");
            if (!classInfo || !classInfo.classList.contains("show")) {
                document.body.style.overflow = 'auto';
            }
        }
    });

    return modalSession;
}

// Global function to open add review modal
window.openAddReviewModal = async function (courseCode, academicYear, term, courseTitle) {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            // Use authentication modal system
            if (window.requireAuth) {
                window.requireAuth('write a review for this course', () => {
                    // Re-trigger the review modal after authentication
                    window.openAddReviewModal(courseCode, academicYear, term, courseTitle);
                });
            } else {
                showGlobalToast('Please log in to write a review.');
            }
            return;
        }

        ensureCourseInfoReviewsTabActive({ scrollTop: true });

        // Check if user has already reviewed this course regardless of term/year.
        const equivalentCourseCodes = await resolveEquivalentCourseCodesForReviews({
            courseCode,
            courseTitle
        });
        const existingReviewQuery = applyCourseReviewCodeFilter(
            supabase
                .from('course_reviews')
                .select('*')
                .eq('user_id', session.user.id),
            equivalentCourseCodes,
            courseCode
        );
        const { data: existingReviews, error } = await existingReviewQuery
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error checking existing reviews:', error);
            // Continue anyway - user can still try to submit
        }

        if (existingReviews && existingReviews.length > 0) {
            const existingReview = existingReviews[0];
            const shouldEdit = await openConfirmModal({
                title: 'Review already exists',
                message: 'You already reviewed this course. Edit your existing review instead?',
                confirmLabel: 'Edit review',
                cancelLabel: 'Cancel'
            });
            if (!shouldEdit) return;
            openEditReviewModal(
                existingReview.id,
                existingReview.course_code,
                existingReview.term,
                getReviewQualityRating(existingReview),
                getReviewDifficultyRating(existingReview),
                existingReview.content || '',
                existingReview.academic_year,
                courseTitle
            );
            return;
        }

        document.body.style.overflow = 'hidden';
        openReviewFormModal({
            mode: 'add',
            courseCode,
            courseTitle,
            defaultYear: academicYear,
            defaultTerm: term
        });

    } catch (error) {
        console.error('Error opening review modal:', error);
        showGlobalToast('Error opening review form. Please try again.');
    }
};

// Global function to close review modal
window.closeReviewModal = function () {
    if (typeof window.__closeReviewModal === 'function') {
        window.__closeReviewModal();
        return;
    }
    const modal = document.querySelector('.review-modal, .review-modal-host');
    if (modal) {
        modal.classList.add('hidden');
        setTimeout(() => modal.remove(), 220);
    }
    const classInfo = document.getElementById("class-info");
    if (!classInfo || !classInfo.classList.contains("show")) {
        document.body.style.overflow = 'auto';
    }
};

// Helper functions for review form validation
function showReviewFieldError(fieldId, message) {
    const errorElement = document.getElementById(`${fieldId}-error`);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
}

function clearReviewFieldErrors() {
    const fieldIds = ['course-year', 'quality-rating', 'difficulty-rating', 'review-content'];
    fieldIds.forEach(fieldId => {
        const errorElement = document.getElementById(`${fieldId}-error`);
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    });
}

// Global function to open edit review modal
window.openEditReviewModal = async function (
    reviewId,
    courseCode,
    term,
    currentQualityRating,
    currentDifficultyRating,
    currentContent,
    currentYear,
    courseTitle = ''
) {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            showGlobalToast('Please log in to edit your review.');
            return;
        }

        ensureCourseInfoReviewsTabActive({ scrollTop: true });

        document.body.style.overflow = 'hidden';
        openReviewFormModal({
            mode: 'edit',
            reviewId,
            courseCode,
            courseTitle: courseTitle || courseCode,
            defaultYear: currentYear,
            defaultTerm: term,
            qualityRating: currentQualityRating,
            difficultyRating: currentDifficultyRating,
            rating: currentQualityRating,
            content: currentContent
        });

    } catch (error) {
        console.error('Error opening edit review modal:', error);
        showGlobalToast('Error opening edit form. Please try again.');
    }
};

function getReviewRatingFieldSelectors(kind, isEdit = false) {
    const suffix = isEdit ? '-edit' : '';
    return {
        inputId: `${kind}-rating-input${suffix}`,
        valueSelector: `[data-role="${kind}-review-rating-value${suffix}"]`
    };
}

function setReviewModalRating(kind, rating, { isEdit = false } = {}) {
    const safeRating = normalizeReviewRatingValue(rating);
    const { inputId, valueSelector } = getReviewRatingFieldSelectors(kind, isEdit);
    const options = document.querySelectorAll(`#${inputId} [data-rating]`);
    options.forEach((star, index) => {
        const isSelected = index < safeRating;
        star.classList.toggle('selected', isSelected);
        star.classList.remove('is-preview');
        if (star.hasAttribute && star.hasAttribute('aria-pressed')) {
            star.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        }
    });

    const input = document.getElementById(inputId);
    if (input) input.dataset.selectedRating = String(safeRating);
    const ratingValue = document.querySelector(valueSelector);
    if (ratingValue) {
        ratingValue.textContent = kind === 'difficulty'
            ? formatDifficultyRatingLabel(safeRating)
            : `${safeRating}/5`;
        if (kind === 'difficulty') {
            setDifficultyRatingLabelVisualState(ratingValue, safeRating);
        }
    }
}

function handleReviewRatingKeydown(kind, event, rating, { isEdit = false } = {}) {
    if (!event) return;
    const key = event.key;
    const safeRating = normalizeReviewRatingValue(rating);

    if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        setReviewModalRating(kind, safeRating, { isEdit });
        return;
    }

    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
        return;
    }

    event.preventDefault();
    const step = (key === 'ArrowRight' || key === 'ArrowUp') ? 1 : -1;
    const nextRating = normalizeReviewRatingValue(safeRating + step);
    setReviewModalRating(kind, nextRating, { isEdit });

    const currentEl = event.currentTarget;
    const nextEl = currentEl?.parentElement?.querySelector?.(`[data-rating="${nextRating}"]`);
    nextEl?.focus?.();
}

function hoverReviewModalRating(kind, rating, { isEdit = false } = {}) {
    if (!reviewModalSupportsHover()) return;
    const safeRating = normalizeReviewRatingValue(rating);
    const { inputId, valueSelector } = getReviewRatingFieldSelectors(kind, isEdit);
    const options = document.querySelectorAll(`#${inputId} [data-rating]`);
    options.forEach((star, index) => {
        star.classList.toggle('is-preview', index < safeRating);
    });
    if (kind === 'difficulty') {
        const ratingValue = document.querySelector(valueSelector);
        if (ratingValue) {
            ratingValue.textContent = formatDifficultyRatingLabel(safeRating);
            setDifficultyRatingLabelVisualState(ratingValue, safeRating);
        }
    }
}

function unhoverReviewModalRating(kind, { isEdit = false } = {}) {
    if (!reviewModalSupportsHover()) return;
    const { inputId } = getReviewRatingFieldSelectors(kind, isEdit);
    const ratingInput = document.getElementById(inputId);
    const selectedRating = parseInt(ratingInput?.dataset.selectedRating || 0, 10);

    if (selectedRating > 0) {
        setReviewModalRating(kind, selectedRating, { isEdit });
        return;
    }

    const options = document.querySelectorAll(`#${inputId} [data-rating]`);
    options.forEach(star => {
        star.classList.remove('is-preview');
        star.classList.remove('selected');
    });
    if (kind === 'difficulty') {
        const { valueSelector } = getReviewRatingFieldSelectors(kind, isEdit);
        const ratingValue = document.querySelector(valueSelector);
        if (ratingValue) {
            ratingValue.textContent = formatDifficultyRatingLabel(0);
            setDifficultyRatingLabelVisualState(ratingValue, 0);
        }
    }
}

// Backward-compatible aliases for legacy single-rating calls
window.setRating = function (rating) { setReviewModalRating('quality', rating, { isEdit: false }); };
window.setEditRating = function (rating) { setReviewModalRating('quality', rating, { isEdit: true }); };
window.hoverRating = function (rating) { hoverReviewModalRating('quality', rating, { isEdit: false }); };
window.hoverEditRating = function (rating) { hoverReviewModalRating('quality', rating, { isEdit: true }); };
window.unhoverRating = function () { unhoverReviewModalRating('quality', { isEdit: false }); };
window.unhoverEditRating = function () { unhoverReviewModalRating('quality', { isEdit: true }); };

window.setQualityRating = function (rating) { setReviewModalRating('quality', rating, { isEdit: false }); };
window.setEditQualityRating = function (rating) { setReviewModalRating('quality', rating, { isEdit: true }); };
window.hoverQualityRating = function (rating) { hoverReviewModalRating('quality', rating, { isEdit: false }); };
window.hoverEditQualityRating = function (rating) { hoverReviewModalRating('quality', rating, { isEdit: true }); };
window.unhoverQualityRating = function () { unhoverReviewModalRating('quality', { isEdit: false }); };
window.unhoverEditQualityRating = function () { unhoverReviewModalRating('quality', { isEdit: true }); };

window.setDifficultyRating = function (rating) { setReviewModalRating('difficulty', rating, { isEdit: false }); };
window.setEditDifficultyRating = function (rating) { setReviewModalRating('difficulty', rating, { isEdit: true }); };
window.hoverDifficultyRating = function (rating) { hoverReviewModalRating('difficulty', rating, { isEdit: false }); };
window.hoverEditDifficultyRating = function (rating) { hoverReviewModalRating('difficulty', rating, { isEdit: true }); };
window.unhoverDifficultyRating = function () { unhoverReviewModalRating('difficulty', { isEdit: false }); };
window.unhoverEditDifficultyRating = function () { unhoverReviewModalRating('difficulty', { isEdit: true }); };
window.handleDifficultyRatingKeydown = function (event, rating) { handleReviewRatingKeydown('difficulty', event, rating, { isEdit: false }); };
window.handleEditDifficultyRatingKeydown = function (event, rating) { handleReviewRatingKeydown('difficulty', event, rating, { isEdit: true }); };

// Global function to update review
window.updateReview = async function (reviewId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            showGlobalToast('Please log in to update your review.');
            return;
        }

        const qualityRatingInput = document.getElementById('quality-rating-input-edit');
        const difficultyRatingInput = document.getElementById('difficulty-rating-input-edit');
        const contentInput = document.getElementById('review-content-edit');
        const yearInput = document.getElementById('course-year-edit');
        const termInput = document.getElementById('review-term-edit');

        const qualityRating = parseInt(qualityRatingInput?.dataset.selectedRating || '0', 10);
        const difficultyRating = parseInt(difficultyRatingInput?.dataset.selectedRating || '0', 10);
        const content = contentInput.value.trim();
        const selectedYear = parseInt(yearInput.value);
        const selectedTerm = normalizeCourseTerm(termInput?.value || '');

        if (!qualityRating) {
            showGlobalToast('Please select a quality rating.');
            return;
        }
        if (!difficultyRating) {
            showGlobalToast('Please select a difficulty rating.');
            return;
        }

        if (!selectedYear) {
            showGlobalToast('Please select the year when you took this course.');
            return;
        }
        if (!selectedTerm) {
            showGlobalToast('Please select the term when you took this course.');
            return;
        }
        if (content.length > 800) {
            showGlobalToast('Review is too long. Please keep it under 800 characters.');
            return;
        }

        const updateBtn = document.querySelector('.update-review, [data-action="update-review-submit"]');
        const updateBtnDefaultText = updateBtn?.dataset?.defaultText || updateBtn?.textContent || 'Save changes';
        if (updateBtn) {
            updateBtn.dataset.defaultText = updateBtnDefaultText;
            updateBtn.disabled = true;
            updateBtn.textContent = 'Saving...';
        }
        const { course: visibleCourse } = getVisibleCourseInfoCourseContext();
        const courseCodeForRefresh = String(
            updateBtn?.dataset?.courseCode ||
            visibleCourse?.course_code ||
            ''
        ).trim();
        const dualPayload = buildCourseReviewWritePayload({
            academicYear: selectedYear,
            term: selectedTerm,
            qualityRating,
            difficultyRating,
            content
        });

        const legacyPayload = {
            rating: qualityRating,
            content,
            academic_year: selectedYear,
            term: selectedTerm
        };

        const runUpdate = (payload) => supabase
            .from('course_reviews')
            .update(payload)
            .eq('id', reviewId)
            .eq('user_id', session.user.id);

        let { data, error } = await runUpdate(dualPayload);
        if (error && isMissingDualReviewRatingColumnsError(error)) {
            console.warn('Dual review rating columns unavailable; falling back to legacy single rating column.');
            ({ data, error } = await runUpdate(legacyPayload));
        }

        if (error) {
            console.error('Error updating review:', error);
            showGlobalToast('Error updating review. Please try again.');
            if (updateBtn) {
                updateBtn.disabled = false;
                updateBtn.textContent = updateBtnDefaultText;
            }
            return;
        }

        await finalizeReviewMutationSuccess({
            message: 'Review updated successfully.',
            courseCode: courseCodeForRefresh
        });

    } catch (error) {
        console.error('Error updating review:', error);
        showGlobalToast('Error updating review. Please try again.');
    }
};

// Global function to delete review
window.deleteReview = async function (reviewId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            showGlobalToast('Please log in to delete your review.');
            return;
        }

        const shouldDelete = await openConfirmModal({
            title: 'Delete review',
            message: 'Delete review?',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            destructive: true
        });
        if (!shouldDelete) {
            return;
        }

        const deleteBtn = document.querySelector('.delete-review, [data-action="delete-review"]');
        const deleteBtnDefaultText = deleteBtn?.dataset?.defaultText || deleteBtn?.textContent || 'Delete review';
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';

        const { data, error } = await supabase
            .from('course_reviews')
            .delete()
            .eq('id', reviewId)
            .eq('user_id', session.user.id); // Double-check ownership

        if (error) {
            console.error('Error deleting review:', error);
            showGlobalToast('Error deleting review. Please try again.');
            deleteBtn.disabled = false;
            deleteBtn.textContent = deleteBtnDefaultText;
            return;
        }

        showGlobalToast('Review deleted successfully!');
        closeReviewModal();

        // Reload the page to show updated reviews
        window.location.reload();

    } catch (error) {
        console.error('Error deleting review:', error);
        showGlobalToast('Error deleting review. Please try again.');
    }
};

// Function to initialize URL-based course routing
export async function initializeCourseRouting() {
    console.log('Initializing course routing with History API...');

    try {
        // Handle route changes (both initial load and popstate events)
        const handleRouteChange = async () => {
            console.log('Handling route change for path:', getCurrentAppPath());

            const params = parseCourseURL();
            if (params) {
                console.log('Found course parameters in URL:', params);

                console.log('Searching for course...');
                const course = await findCourseByParams(params.courseCode, params.year, params.term);

                if (course) {
                    console.log('Course found:', course.title);
                    await openCourseInfoMenu(course, false); // false to prevent URL update loop
                } else {
                    console.warn('Course not found for parameters:', params);
                    console.log('Available courses:', await fetchCourseData(params.year, params.term));
                }
            } else {
                console.log('No course parameters found in URL path');
                // Close modal if open and we're not on a course URL
                const classInfo = document.getElementById("class-info");
                if (classInfo && classInfo.classList.contains("show")) {
                    const classClose = document.getElementById("class-close");
                    if (classClose) {
                        classClose.click();
                    }
                }
            }
        };

        // Listen for popstate events (back/forward button)
        window.addEventListener('popstate', handleRouteChange);

        // Handle initial page load
        await handleRouteChange();

        // Intercept clicks on course links to use History API
        document.addEventListener('click', (event) => {
            const target = event.target.closest('a[href]');
            if (!target) return;

            const url = target.getAttribute('href');
            if (!url) return;

            const appPath = stripBase(url);
            if (!isCourseDetailPath(appPath)) return;

            event.preventDefault();
            window.history.pushState({}, '', withBase(appPath));
            handleRouteChange();
        });

        console.log('Course routing initialized successfully');

    } catch (error) {
        console.error('Error initializing course routing:', error);
    }
}

// Debug function to test course routing manually
window.testCourseRouting = function () {
    console.log('Testing course routing...');
    console.log('Current path:', getCurrentAppPath());

    const params = parseCourseURL();
    if (params) {
        console.log('Parsed parameters:', params);
        findCourseByParams(params.courseCode, params.year, params.term)
            .then(course => {
                if (course) {
                    console.log('Found course:', course);
                } else {
                    console.log('No course found');
                }
            });
    } else {
        console.log('No course parameters found in URL');
    }
};

// Global function to share course URL
window.shareCourseURL = function () {
    const currentURL = window.location.href;

    // Simple notification function
    function showNotification(message) {
        const notification = document.createElement('div');
        notification.id = 'link-copied-notification';
        notification.textContent = message;
        notification.classList.add('show');
        document.body.appendChild(notification);

        // Remove after 2 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 2000);
    }

    // Try to copy URL to clipboard
    if (navigator.clipboard) {
        navigator.clipboard.writeText(currentURL).then(() => {
            showNotification('Link copied!');
        }).catch(() => {
            showNotification('Failed to copy link');
        });
    } else {
        // Fallback for older browsers
        try {
            const textArea = document.createElement('textarea');
            textArea.value = currentURL;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showNotification('Link copied!');
        } catch (err) {
            showNotification('Failed to copy link');
        }
    }
};

// Global function to open course by URL programmatically
window.openCourseByURL = function (courseCode, academicYear, term) {
    const courseURL = generateCourseURL(courseCode, academicYear, term);
    const currentPath = getCurrentAppPath();
    const state = {};
    const returnPath = normalizeModalReturnPath(currentPath);
    if (returnPath) {
        state.courseModalReturnPath = returnPath;
        rememberCourseModalReturnPath(returnPath);
    }
    window.history.pushState(state, '', courseURL);

    // Trigger route change handling
    const params = parseCourseURL();
    if (params) {
        findCourseByParams(params.courseCode, params.year, params.term)
            .then(course => {
                if (course) {
                    openCourseInfoMenu(course, false);
                }
            })
            .catch(console.error);
    }
};
window.submitReview = async function (courseCode, academicYear, term) {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            // Use auth modal instead of alert
            if (window.authManager) {
                authManager.requireAuth('submit a review');
            } else {
                showGlobalToast('Please log in to submit a review.');
            }
            return;
        }

        const qualityRatingInput = document.getElementById('quality-rating-input');
        const difficultyRatingInput = document.getElementById('difficulty-rating-input');
        const contentInput = document.getElementById('review-content');
        const yearInput = document.getElementById('course-year');
        const termInput = document.getElementById('review-term');

        const qualityRating = parseInt(qualityRatingInput?.dataset.selectedRating || '0', 10);
        const difficultyRating = parseInt(difficultyRatingInput?.dataset.selectedRating || '0', 10);
        const content = contentInput.value.trim();
        const selectedYear = parseInt(yearInput.value);
        const selectedTerm = normalizeCourseTerm(termInput?.value || term);

        // Clear previous errors
        clearReviewFieldErrors();

        let hasErrors = false;

        // Validate rating
        if (!qualityRating) {
            showReviewFieldError('quality-rating', 'Please select a quality rating.');
            hasErrors = true;
        }

        if (!difficultyRating) {
            showReviewFieldError('difficulty-rating', 'Please select a difficulty rating.');
            hasErrors = true;
        }

        // Validate year
        if (!selectedYear) {
            showReviewFieldError('course-year', 'Please select the year when you took this course.');
            hasErrors = true;
        }

        if (!selectedTerm) {
            showGlobalToast('Please select the term when you took this course.');
            hasErrors = true;
        }

        if (content.length > 800) {
            showReviewFieldError('review-content', 'Please keep the review under 800 characters.');
            hasErrors = true;
        }

        // Content is optional, so we don't validate it

        if (hasErrors) {
            return;
        }

        const submitBtn = document.querySelector('.submit-review, [data-action="submit-review-submit"]');
        const submitBtnDefaultText = submitBtn?.dataset?.defaultText || submitBtn?.textContent || 'Submit review';
        if (submitBtn) {
            submitBtn.dataset.defaultText = submitBtnDefaultText;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
        }

        const dualPayload = buildCourseReviewWritePayload({
            userId: session.user.id,
            courseCode,
            academicYear: selectedYear,
            term: selectedTerm,
            qualityRating,
            difficultyRating,
            content
        });
        const legacyPayload = {
            user_id: session.user.id,
            course_code: courseCode,
            academic_year: selectedYear,
            term: selectedTerm,
            rating: qualityRating,
            content
        };

        let { data, error } = await supabase
            .from('course_reviews')
            .insert(dualPayload);

        if (error && isMissingDualReviewRatingColumnsError(error)) {
            console.warn('Dual review rating columns unavailable; falling back to legacy single rating column.');
            ({ data, error } = await supabase
                .from('course_reviews')
                .insert(legacyPayload));
        }

        if (error) {
            console.error('Error submitting review:', error);
            showGlobalToast('Error submitting review. Please try again.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = submitBtnDefaultText;
            }
            return;
        }

        await finalizeReviewMutationSuccess({
            message: 'Review submitted successfully.',
            courseCode
        });

    } catch (error) {
        console.error('Error submitting review:', error);
        showGlobalToast('Error submitting review. Please try again.');
    }
};

// Helper function to render review (make it global for loadMoreReviews)
window.renderReview = function (review, currentUserId = null, anonymousName = null, avatarSrc = null) {
    // Create a simple data URL for avatar placeholder instead of external URL
    const createAvatarPlaceholder = (name) => {
        const initial = name.charAt(0).toUpperCase();
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');

        // Create a circular background
        ctx.fillStyle = '#cccccc';
        ctx.fillRect(0, 0, 40, 40);

        // Add initial text
        ctx.fillStyle = '#666666';
        ctx.font = '18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial, 20, 20);

        return canvas.toDataURL();
    };

    const displayName = anonymousName || 'Anonymous student';
    const avatarUrl = avatarSrc || '/user.svg';
    const isOwnReview = currentUserId && review.user_id === currentUserId;
    const qualityRating = getReviewQualityRating(review);
    const difficultyRating = getReviewDifficultyRating(review);

    function renderStarRating(rating, size = 'small') {
        const stars = [];
        const sizeClass = size === 'large' ? 'star-large' : 'star-small';

        for (let i = 1; i <= 5; i++) {
            if (i <= rating) {
                stars.push(`<span class="star ${sizeClass} filled">★</span>`);
            } else {
                stars.push(`<span class="star ${sizeClass}">☆</span>`);
            }
        }
        return stars.join('');
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    return `
        <div class="review-item">
            <div class="review-header">
                <img src="${avatarUrl}" alt="${displayName}" class="review-avatar">
                <div class="review-user-info">
                    <h4 class="review-user-name">${displayName}</h4>
                    <div class="review-rating-lines">
                        <p class="review-rating-line">${escapeHtml(formatReviewRatingLine('Quality rating', qualityRating))}</p>
                        <p class="review-rating-line">${escapeHtml(formatReviewRatingLine('Difficulty rating', difficultyRating))}</p>
                    </div>
                </div>
                <div class="review-dates">
                    <p class="review-date">Reviewed: ${formatDate(review.created_at)}</p>
                    <p class="review-course-date">Took course: ${review.term} ${review.academic_year}</p>
                </div>
                ${isOwnReview ? `
                    <div class="review-actions">
                        <button class="edit-review-btn" onclick="openEditReviewModal('${review.id}', '${review.course_code}', '${review.term}', ${qualityRating}, ${difficultyRating}, '${(review.content || '').replace(/'/g, "\\'")}', ${review.academic_year})" style="
                            padding: 5px 10px;
                            border: 1px solid #007bff;
                            background: white;
                            color: #007bff;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            width: auto;
                            height: auto;
                        ">Edit</button>
                    </div>
                ` : ''}
            </div>
            <div class="review-content">
                <p>${review.content || 'No written review provided.'}</p>
            </div>
        </div>
    `;
};

// Export the existing checkTimeConflict function with enhanced conflict resolution
export async function checkTimeConflict(timeSlot, courseCode, academicYear) {
    console.log('checkTimeConflict called with:', { timeSlot, courseCode, academicYear });
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            console.log('No session found');
            return { hasConflict: false, conflictingCourses: [] };
        }

        // Get user profile with selected courses
        const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('courses_selection')
            .eq('id', session.user.id)
            .single();

        console.log('Profile data:', profileData);

        if (!profileData || !profileData.courses_selection || profileData.courses_selection.length === 0) {
            console.log('No courses selected yet');
            return { hasConflict: false, conflictingCourses: [] };
        }

        // Filter courses by current year and term only
        const currentYearCourses = filterCoursesByCurrentYearTerm(profileData.courses_selection);

        if (currentYearCourses.length === 0) {
            console.log('No courses selected for current year and term');
            return { hasConflict: false, conflictingCourses: [] };
        }

        // Function to parse time slot to day and period
        function parseTimeSlot(slot) {
            console.log('Parsing time slot:', slot);
            if (!slot) return null;

            // Japanese day mappings
            const dayMap = {
                "月": "Monday",
                "火": "Tuesday",
                "水": "Wednesday",
                "木": "Thursday",
                "金": "Friday",
                "土": "Saturday",
                "日": "Sunday"
            };

            // Try to match Japanese format: (月曜日1講時) or variants
            let match = slot.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
            if (match) {
                const dayChar = match[1];
                const period = match[2];
                const result = {
                    day: dayMap[dayChar] || dayChar,
                    period: period,
                    original: slot
                };
                console.log('Japanese format matched:', result);
                return result;
            }

            // Try to match English format: "Monday 09:00 - 10:30" etc (both full and abbreviated day names)
            const englishMatch = slot.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2}\s*-?\s*\d{2}:\d{2})/);
            if (englishMatch) {
                const dayMap = {
                    'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
                    'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
                };
                const fullDay = dayMap[englishMatch[1]] || englishMatch[1];
                const result = {
                    day: fullDay,
                    timeRange: englishMatch[2],
                    original: slot
                };
                console.log('English format matched:', result);
                return result;
            }

            console.log('No format matched, returning original:', slot);
            return { original: slot };
        }

        const newTimeSlot = parseTimeSlot(timeSlot);
        console.log('Parsed new time slot:', newTimeSlot);
        if (!newTimeSlot) return { hasConflict: false, conflictingCourses: [] };

        // Get the current year and term from global variables or the course being checked
        const currentYear = academicYear;
        const currentTerm = getCurrentTerm(); // We'll need this function
        console.log('Current year/term:', currentYear, currentTerm);

        // Fetch actual course details for selected courses to get their time slots
        const selectedCourseCodes = currentYearCourses.map(course => course.code);
        console.log('Selected course codes for current year/term:', selectedCourseCodes);

        let conflictingCourseDetails = [];

        if (selectedCourseCodes.length > 0) {
            // Fetch actual course data to get time slots
            console.log('Fetching course data for conflict check...');
            const { data: coursesData } = await supabase
                .from('courses')
                .select('course_code, title, time_slot, professor, academic_year, term, type, class_number, credits')
                .in('course_code', selectedCourseCodes)
                .eq('academic_year', currentYear)
                .eq('term', currentTerm);

            console.log('Fetched courses data:', coursesData);
            console.log('Looking for conflicts with new course:', courseCode, 'with time slot:', timeSlot, '.');

            if (coursesData) {
                console.log('Processing', coursesData.length, 'courses for conflicts');
                // Check for time conflicts with fetched course data
                conflictingCourseDetails = coursesData.filter(courseData => {
                    console.log('=== CHECKING COURSE FOR CONFLICT ===');
                    console.log('Course being checked:', courseData.course_code, courseData.title);
                    console.log('Course time slot:', courseData.time_slot);
                    console.log('New course being added:', courseCode);
                    console.log('New course time slot:', timeSlot);

                    // Skip if it's the same course
                    if (courseData.course_code === courseCode) {
                        console.log('✓ Skipping same course (codes match):', courseData.course_code);
                        return false;
                    }

                    // Same base course code (different section) is also a conflict at ILA.
                    const existingCode = String(courseData.course_code || '').trim();
                    const newCode = String(courseCode || '').trim();
                    const existingFamily = getCourseCodeFamily(existingCode);
                    const newFamily = getCourseCodeFamily(newCode);
                    if (existingFamily && newFamily && existingFamily === newFamily) {
                        console.log('❌ Same-course section conflict detected:', { existingCode, newCode, family: newFamily });
                        courseData.conflict_type = 'same-course-section';
                        return true;
                    }

                    const existingTimeSlot = parseTimeSlot(courseData.time_slot);
                    console.log('Parsed existing time slot:', JSON.stringify(existingTimeSlot));
                    console.log('Parsed new time slot:', JSON.stringify(newTimeSlot));

                    if (!existingTimeSlot) {
                        console.log('✗ Could not parse existing time slot');
                        return false;
                    }

                    // Check for time conflicts
                    if (newTimeSlot.day && existingTimeSlot.day) {
                        console.log('Comparing days:', newTimeSlot.day, 'vs', existingTimeSlot.day);
                        if (newTimeSlot.day === existingTimeSlot.day) {
                            console.log('✓ Same day detected!');
                            // If both have periods, compare periods
                            if (newTimeSlot.period && existingTimeSlot.period) {
                                const newPeriod = parseInt(newTimeSlot.period);
                                const existingPeriod = parseInt(existingTimeSlot.period);
                                console.log('Comparing periods (parsed):', newPeriod, 'vs', existingPeriod);
                                const isConflict = newPeriod === existingPeriod;
                                console.log('Period conflict result:', isConflict ? '❌ CONFLICT!' : '✓ No conflict');
                                if (isConflict) {
                                    courseData.conflict_type = 'time-overlap';
                                    console.log('🔍 CONFLICT DETAILS:');
                                    console.log('  - Existing course:', courseData.title, '(' + courseData.course_code + ')');
                                    console.log('  - Period:', existingPeriod);
                                    console.log('  - New course period:', newPeriod);
                                }
                                return isConflict;
                            }
                            // If both have time ranges, they conflict (same day)
                            if (newTimeSlot.timeRange && existingTimeSlot.timeRange) {
                                console.log('❌ Both have time ranges, conflict detected');
                                courseData.conflict_type = 'time-overlap';
                                return true;
                            }
                            // If one has period and one has time range, we need to convert to compare
                            if ((newTimeSlot.period && existingTimeSlot.timeRange) || (newTimeSlot.timeRange && existingTimeSlot.period)) {
                                console.log('⚠️ Mixed time formats detected, attempting to convert for comparison');

                                // Convert time ranges to periods for comparison
                                const convertTimeRangeToPeriod = (timeRange) => {
                                    if (!timeRange) return null;
                                    // Extract start time
                                    const startTimeMatch = timeRange.match(/(\d{2}):(\d{2})/);
                                    if (!startTimeMatch) return null;

                                    const startHour = parseInt(startTimeMatch[1]);
                                    const startMinute = parseInt(startTimeMatch[2]);

                                    // Convert to period based on typical Japanese university schedule
                                    // Period 1: 09:00-10:30, Period 2: 10:45-12:15, Period 3: 13:15-14:45, Period 4: 15:00-16:30, Period 5: 16:45-18:15
                                    if (startHour === 9) return 1;
                                    if (startHour === 10 && startMinute >= 45) return 2;
                                    if (startHour === 13) return 3;
                                    if (startHour === 14 && startMinute >= 45) return 4;
                                    if (startHour === 15) return 4;  // 14:55-16:25 would be period 4
                                    if (startHour === 16 && startMinute >= 45) return 5;

                                    return null;
                                };

                                let newPeriod = newTimeSlot.period ? parseInt(newTimeSlot.period) : convertTimeRangeToPeriod(newTimeSlot.timeRange);
                                let existingPeriod = existingTimeSlot.period ? parseInt(existingTimeSlot.period) : convertTimeRangeToPeriod(existingTimeSlot.timeRange);

                                console.log('Converted periods - New:', newPeriod, 'Existing:', existingPeriod);

                                if (newPeriod && existingPeriod) {
                                    const isConflict = newPeriod === existingPeriod;
                                    console.log('Mixed format conflict result:', isConflict ? '❌ CONFLICT!' : '✓ No conflict');
                                    if (isConflict) {
                                        courseData.conflict_type = 'time-overlap';
                                    }
                                    return isConflict;
                                } else {
                                    console.log('⚠️ Could not convert time formats, assuming no conflict');
                                    return false;
                                }
                            }

                            console.log('⚠️ Unknown time format combination, assuming no conflict');
                            return false;
                        } else {
                            console.log('✓ Different days, no conflict');
                        }
                    } else {
                        console.log('⚠️ Missing day information');
                    }

                    console.log('✓ No conflict found for course:', courseData.course_code);
                    return false;
                });

                console.log('Found conflicts:', conflictingCourseDetails);
            }
        }

        const result = {
            hasConflict: conflictingCourseDetails.length > 0,
            conflictingCourses: conflictingCourseDetails
        };

        console.log('Final conflict result:', result);
        return result;

    } catch (error) {
        console.error('Error checking time conflict:', error);
        return { hasConflict: false, conflictingCourses: [] };
    }
}

// Make the function available globally for internal use
window.checkTimeConflictExported = checkTimeConflict;

// Utility functions to get current year and term from UI
function getCurrentYear() {
    const yearSelect = document.getElementById('year-select');
    if (yearSelect && yearSelect.value) {
        return parseInt(yearSelect.value);
    }

    // On full course page URLs, use the URL semester context
    const courseParams = parseCourseURL();
    if (courseParams && courseParams.year) {
        return courseParams.year;
    }

    // Fallback to router-global state if available
    if (typeof window.globalCurrentYear === 'number' && !Number.isNaN(window.globalCurrentYear)) {
        return window.globalCurrentYear;
    }

    // Final fallback to inferred active semester year
    return inferCurrentSemesterValue().year;
}

function getCurrentTerm() {
    const termSelect = document.getElementById('term-select');
    if (termSelect && termSelect.value) {
        return termSelect.value;
    }

    // On full course page URLs, use the URL semester context
    const courseParams = parseCourseURL();
    if (courseParams && courseParams.term) {
        return courseParams.term;
    }

    // Fallback to router-global state if available
    if (typeof window.globalCurrentTerm === 'string' && window.globalCurrentTerm) {
        return window.globalCurrentTerm;
    }

    // Final fallback to inferred active semester term
    return inferCurrentSemesterValue().term;
}

// Registration lock override is disabled in production and development.
function shouldForceSemesterActiveForTesting() {
    return false;
}

function getRegistrationLockDateForSemester(selectedYear, selectedTerm) {
    const normalizedYear = Number.parseInt(selectedYear, 10);
    if (!Number.isFinite(normalizedYear)) return null;

    const normalizedTerm = normalizeCourseTerm(selectedTerm);
    if (normalizedTerm === 'Spring') {
        // Spring registration closes on August 1 (same year).
        return new Date(normalizedYear, 7, 1, 0, 0, 0, 0);
    }

    if (normalizedTerm === 'Fall') {
        // Fall registration closes on March 1 (next year).
        return new Date(normalizedYear + 1, 2, 1, 0, 0, 0, 0);
    }

    return null;
}

function isCurrentSemester() {
    if (shouldForceSemesterActiveForTesting()) {
        return true;
    }

    const now = new Date();
    const selectedYear = Number.parseInt(getCurrentYear(), 10);
    const selectedTerm = getCurrentTerm();

    // Do not allow pre-registering future academic years.
    if (!Number.isFinite(selectedYear) || selectedYear > now.getFullYear()) {
        return false;
    }

    const lockDate = getRegistrationLockDateForSemester(selectedYear, selectedTerm);
    if (!lockDate) {
        return false;
    }

    // Open until the lock date.
    return now < lockDate;
}

// Filter courses selection by current year and term
function filterCoursesByCurrentYearTerm(coursesSelection) {
    const currentYear = getCurrentYear();
    const currentTerm = getCurrentTerm();

    return coursesSelection.filter(course => {
        // Match by year, and if term is specified in the selection, match by term too
        return course.year === currentYear && (!course.term || course.term === currentTerm);
    });
}

// Make utility functions globally available
window.getCurrentYear = getCurrentYear;
window.getCurrentTerm = getCurrentTerm;
window.isCurrentSemester = isCurrentSemester;
window.isCourseRegistrationOpen = isCurrentSemester;
window.filterCoursesByCurrentYearTerm = filterCoursesByCurrentYearTerm;

// Function to show time conflict modal in the shared app modal system.
export function showTimeConflictModal(conflictingCourses, newCourse, onResolve) {
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const safeConflictingCourses = Array.isArray(conflictingCourses) ? conflictingCourses : [];

    const hasSectionConflict = safeConflictingCourses.some((courseEntry) => (
        String(courseEntry?.conflict_type || '') === 'same-course-section'
    ));
    const hasTimeConflict = safeConflictingCourses.some((courseEntry) => (
        String(courseEntry?.conflict_type || '') !== 'same-course-section'
    ));

    const introCopy = hasSectionConflict && hasTimeConflict
        ? 'This selection overlaps your schedule and also duplicates a section of a class you already registered for.'
        : (hasSectionConflict
            ? 'This selection is another section of a class you already registered for. You can keep only one section.'
            : 'This course conflicts with a course you already registered for.');
    const questionCopy = hasSectionConflict
        ? 'Choose which course section to keep in your schedule.'
        : 'Choose what to keep for this time slot.';

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const toDisplayText = (value, fallback = 'Not available') => {
        const raw = String(value ?? '').trim();
        return raw ? escapeHtml(raw) : `<span class="conflict-empty-value">${escapeHtml(fallback)}</span>`;
    };

    const toDisplayTitle = (courseEntry) => {
        const normalized = normalizeCourseTitle(courseEntry?.title || '');
        const rawTitle = String(courseEntry?.title || '').trim();
        const title = String(normalized || rawTitle || 'Untitled course').trim();
        return escapeHtml(title);
    };

    const toDisplayProfessor = (courseEntry) => {
        const normalized = formatProfessorDisplayName(courseEntry?.professor || 'TBA');
        return toDisplayText(normalized || 'TBA', 'TBA');
    };

    const toDisplayCredits = (courseEntry) => {
        const raw = courseEntry?.credits;
        if (raw === null || raw === undefined || raw === '') {
            return '<span class="conflict-empty-value">Not listed</span>';
        }

        if (typeof raw === 'number' && Number.isFinite(raw)) {
            const value = Number.isInteger(raw) ? raw.toFixed(0) : raw.toFixed(1).replace(/\.0$/, '');
            return `${escapeHtml(value)} credit${Number(raw) === 1 ? '' : 's'}`;
        }

        const matched = String(raw).match(/(\d+(\.\d+)?)/);
        if (!matched) {
            return toDisplayText(raw, 'Not listed');
        }

        const parsed = parseFloat(matched[1]);
        if (!Number.isFinite(parsed)) {
            return toDisplayText(raw, 'Not listed');
        }

        const value = Number.isInteger(parsed) ? parsed.toFixed(0) : parsed.toFixed(1).replace(/\.0$/, '');
        return `${escapeHtml(value)} credit${parsed === 1 ? '' : 's'}`;
    };

    const toDisplayType = (courseEntry) => {
        const rawType = String(courseEntry?.type || '').trim();
        return rawType ? escapeHtml(rawType) : '<span class="conflict-empty-value">General</span>';
    };

    const toDisplayTimeSlot = (courseEntry) => {
        const raw = String(courseEntry?.time_slot || '').trim();
        if (!raw) return '<span class="conflict-empty-value">Not set</span>';

        const dayMapJPToAbbr = {
            月: 'Mon',
            火: 'Tue',
            水: 'Wed',
            木: 'Thu',
            金: 'Fri',
            土: 'Sat',
            日: 'Sun'
        };
        const fullDayToAbbr = {
            Monday: 'Mon',
            Tuesday: 'Tue',
            Wednesday: 'Wed',
            Thursday: 'Thu',
            Friday: 'Fri',
            Saturday: 'Sat',
            Sunday: 'Sun'
        };
        const periodToRange = {
            '1': '09:00 - 10:30',
            '2': '10:45 - 12:15',
            '3': '13:10 - 14:40',
            '4': '14:55 - 16:25',
            '5': '16:40 - 18:10'
        };

        const jpSlots = [...raw.matchAll(/([月火水木金土日])(?:曜日)?\s*([1-5])(?:講時)?/g)];
        if (jpSlots.length > 0) {
            return jpSlots.map((slot) => {
                const day = dayMapJPToAbbr[slot[1]] || slot[1];
                const periodRange = periodToRange[slot[2]] || '';
                return escapeHtml(periodRange ? `${day} ${periodRange}` : day);
            }).join('<br>');
        }

        const englishFullMatch = raw.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})$/i);
        if (englishFullMatch) {
            const dayRaw = englishFullMatch[1];
            const day = fullDayToAbbr[dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1).toLowerCase()] || dayRaw;
            return `${escapeHtml(day)} ${escapeHtml(englishFullMatch[2].replace(/\s+/g, ' ').trim())}`;
        }

        const englishAbbrMatch = raw.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})$/i);
        if (englishAbbrMatch) {
            return `${escapeHtml(englishAbbrMatch[1])} ${escapeHtml(englishAbbrMatch[2].replace(/\s+/g, ' ').trim())}`;
        }

        return escapeHtml(raw);
    };

    const toHexColor = (value, fallback = '#E0E0E0') => {
        const color = String(value || '').trim();
        return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;
    };

    const hexToRgba = (hex, alpha = 0.34) => {
        const normalized = toHexColor(hex).slice(1);
        const expanded = normalized.length === 3
            ? normalized.split('').map((char) => char + char).join('')
            : normalized;
        const red = parseInt(expanded.slice(0, 2), 16);
        const green = parseInt(expanded.slice(2, 4), 16);
        const blue = parseInt(expanded.slice(4, 6), 16);
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    };

    const buildCourseCardMarkup = (courseEntry, badge, modifierClass, options = {}) => {
        const emphasisMode = options.emphasisMode === 'code' ? 'code' : 'time';
        const timeRowClass = emphasisMode === 'time'
            ? 'conflict-course-card-meta-row conflict-course-card-meta-row--emphasis conflict-meta-primary'
            : 'conflict-course-card-meta-row conflict-meta-primary';
        const codeRowClass = emphasisMode === 'code'
            ? 'conflict-course-card-meta-row conflict-course-card-meta-row--emphasis conflict-meta-secondary'
            : 'conflict-course-card-meta-row conflict-meta-secondary';
        const accentHex = toHexColor(getCourseColorByType(courseEntry?.type));
        const accentBorder = hexToRgba(accentHex, 0.38);
        return `
        <article class="conflict-course-card ${modifierClass}" style="--conflict-card-accent: ${accentHex}; --conflict-card-border: ${accentBorder};">
            <div class="conflict-course-card-header">
                <h4>${toDisplayTitle(courseEntry)}</h4>
                <span class="conflict-course-card-badge">${escapeHtml(badge)}</span>
            </div>
            <dl class="conflict-course-card-meta">
                <div class="${timeRowClass}">
                    <dt>Time</dt>
                    <dd>${toDisplayTimeSlot(courseEntry)}</dd>
                </div>
                <div class="conflict-course-card-meta-row conflict-meta-primary">
                    <dt>Professor</dt>
                    <dd>${toDisplayProfessor(courseEntry)}</dd>
                </div>
                <div class="conflict-course-card-meta-row conflict-meta-primary">
                    <dt>Credits</dt>
                    <dd>${toDisplayCredits(courseEntry)}</dd>
                </div>
            </dl>
            <div class="conflict-card-details">
                <div class="conflict-meta-secondary-wrap">
                    <div class="${codeRowClass}">
                        <dt>Code</dt>
                        <dd>${toDisplayText(courseEntry?.course_code, 'N/A')}</dd>
                    </div>
                    <div class="conflict-course-card-meta-row conflict-meta-secondary">
                        <dt>Type</dt>
                        <dd>${toDisplayType(courseEntry)}</dd>
                    </div>
                </div>
                <button type="button" class="conflict-more-details" aria-expanded="false">More details</button>
            </div>
        </article>
    `;
    };

    const bodyHtml = `
        <div class="conflict-content">
            <p class="conflict-intro">${escapeHtml(introCopy)}</p>
            <div class="conflict-comparison-grid">
                <section class="conflict-comparison-column">
                    <h3 class="conflict-column-title">Currently registered</h3>
                    <div class="conflict-course-stack">
                        ${safeConflictingCourses.length
            ? safeConflictingCourses
                .map((courseEntry) => {
                    const isSectionConflict = String(courseEntry?.conflict_type || '') === 'same-course-section';
                    return buildCourseCardMarkup(
                        courseEntry,
                        'Registered',
                        'conflict-course-card--existing',
                        { emphasisMode: isSectionConflict ? 'code' : 'time' }
                    );
                })
                .join('')
            : '<p class="conflict-empty">No registered course details found.</p>'}
                    </div>
                </section>
                <section class="conflict-comparison-column">
                    <h3 class="conflict-column-title">New selection</h3>
                    <div class="conflict-course-stack">
                        ${buildCourseCardMarkup(
                            newCourse || {},
                            'Selected',
                            'conflict-course-card--new',
                            { emphasisMode: hasSectionConflict && !hasTimeConflict ? 'code' : 'time' }
                        )}
                    </div>
                </section>
            </div>
            <div class="conflict-question">
                <p>${escapeHtml(questionCopy)}</p>
            </div>
        </div>
    `;

    const footerHtml = `
        <button type="button" class="btn-secondary conflict-cancel" data-action="conflict-keep">Keep Registered Course</button>
        <button type="button" class="btn-primary conflict-replace" data-action="conflict-replace">Replace & Register</button>
    `;

    let resolved = false;
    const settle = (shouldReplace, actionType = 'dismiss') => {
        if (resolved) return;
        resolved = true;
        if (typeof onResolve === 'function') {
            onResolve(Boolean(shouldReplace), safeConflictingCourses, actionType);
        }
    };

    openDsModal({
        title: 'Schedule Conflict',
        bodyHtml,
        footerHtml,
        className: 'modal--conflict',
        modalKind: 'conflict',
        mobileSwipe: isMobileSheet(),
        onMount: (root, close) => {
            const dialog = root.querySelector('.modal-dialog');
            dialog?.classList.add('conflict-modal-dialog');

            root.querySelector('[data-action="conflict-keep"]')?.addEventListener('click', () => {
                settle(false, 'keep');
                close();
            });
            root.querySelector('[data-action="conflict-replace"]')?.addEventListener('click', () => {
                settle(true, 'replace');
                close();
            });

            root.querySelectorAll('.conflict-more-details').forEach((button) => {
                button.addEventListener('click', () => {
                    const parentCard = button.closest('.conflict-course-card');
                    if (!parentCard) return;
                    const isExpanded = parentCard.classList.toggle('is-expanded');
                    button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                    button.textContent = isExpanded ? 'Hide details' : 'More details';
                });
            });
        },
        onClose: () => {
            settle(false, 'dismiss');
            if (previousFocusedElement && typeof previousFocusedElement.focus === 'function') {
                previousFocusedElement.focus();
            }
            document.body.style.overflow = document.body.classList.contains('modal-open') ? 'hidden' : 'auto';
        }
    });
}

const MOBILE_SHEET_BREAKPOINT = 1023;
const SWIPE_START_THRESHOLD = 8;
const SWIPE_AXIS_LOCK_RATIO = 1.2;
const SWIPE_CLOSE_DURATION_MS = 320;

function isMobileSheet() {
    return window.innerWidth <= MOBILE_SHEET_BREAKPOINT;
}

function getTouchPoint(event) {
    return event.touches?.[0] || event.changedTouches?.[0] || null;
}

function isAtTop(scrollElement) {
    return !scrollElement || scrollElement.scrollTop <= 1;
}

function applyDragResistance(deltaY) {
    if (deltaY <= 0) return 0;
    if (deltaY <= 140) return deltaY * 0.88;
    return 123.2 + ((deltaY - 140) * 0.34);
}

function resetSwipeHandlers(modal, key) {
    const previousHandlers = modal?.[key];
    if (!previousHandlers) return;

    modal.removeEventListener('touchstart', previousHandlers.touchstart);
    modal.removeEventListener('touchmove', previousHandlers.touchmove);
    modal.removeEventListener('touchend', previousHandlers.touchend);
    modal.removeEventListener('touchcancel', previousHandlers.touchcancel);
}

function clearSheetInlineStyles(modal, background, options = {}) {
    const preserveBackgroundOpacity = options.preserveBackgroundOpacity === true;
    const preserveTranslateY = options.preserveTranslateY === true;

    modal.classList.remove('swiping');
    if (!preserveTranslateY) {
        modal.style.removeProperty('--modal-translate-y');
    }
    modal.style.transition = '';
    modal.style.opacity = '';

    if (background) {
        background.style.transition = '';
        if (!preserveBackgroundOpacity) {
            background.style.opacity = '';
        }
    }
}

function readNumericCssVar(varName) {
    const rawValue = window.getComputedStyle(document.documentElement).getPropertyValue(varName);
    const parsed = Number.parseFloat(String(rawValue || '').replace('px', '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

function createCourseInfoMobileSheetController(modal, background, options = {}) {
    if (!modal || !background) return null;

    const onRequestClose = typeof options.onRequestClose === 'function' ? options.onRequestClose : () => { };
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const collapsedHeight = 144;
    const velocitySnapThreshold = 0.48;
    const bodyScrollTopTolerance = 16;
    const TOUCH_POINTER_ID = -1;
    let currentState = 'half';
    let currentY = window.innerHeight;
    let pointerId = null;
    let dragFromBody = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startSheetY = 0;
    let moveSamples = [];
    let rafId = 0;
    let pendingY = currentY;
    let snapTimer = null;
    let closing = false;
    let isDestroyed = false;
    let stableViewportHeight = Math.max(window.innerHeight || 0, 320);
    let stableViewportWidth = Math.max(window.innerWidth || 0, 0);

    function clearSnapTimer() {
        if (snapTimer) {
            window.clearTimeout(snapTimer);
            snapTimer = null;
        }
    }

    function refreshStableViewport(force = false) {
        const nextWidth = Math.max(window.innerWidth || 0, 0);
        const nextHeight = Math.max(window.innerHeight || 0, 320);
        const widthChanged = Math.abs(nextWidth - stableViewportWidth) >= 20;
        const heightChanged = Math.abs(nextHeight - stableViewportHeight) >= 120;
        if (force || widthChanged || heightChanged) {
            stableViewportWidth = nextWidth;
            stableViewportHeight = nextHeight;
            return true;
        }
        return false;
    }

    function getMetrics() {
        const vh = stableViewportHeight;
        const minGap = 44;
        const fullY = 0;
        const requestedHalfY = Math.round(vh - (vh * 0.55));
        const halfY = Math.max(fullY + minGap, Math.min(vh - 220, requestedHalfY));
        const collapsedY = Math.max(halfY + minGap, Math.round(vh - collapsedHeight));
        const dismissedY = vh + 96;
        return { vh, fullY, halfY, collapsedY, dismissedY };
    }

    function getStateY(metrics, state) {
        if (state === 'full') return metrics.fullY;
        if (state === 'half') return metrics.halfY;
        if (state === 'collapsed') return metrics.collapsedY;
        return metrics.dismissedY;
    }

    function updateBackground(y, metrics) {
        if (!background) return;
        if (currentState === 'collapsed' && !dragging) {
            background.style.opacity = '0';
            background.style.pointerEvents = 'none';
            return;
        }

        const progress = (y - metrics.fullY) / Math.max(metrics.collapsedY - metrics.fullY, 1);
        const fade = Math.max(0, Math.min(1, progress));
        const opacity = Math.max(0.24, 1 - (fade * 0.55));
        background.style.opacity = String(opacity);
        background.style.pointerEvents = 'auto';
    }

    function applySheetY(y, { metrics = null } = {}) {
        currentY = y;
        modal.style.setProperty('--sheet-y', `${Math.round(y)}px`);
        modal.style.setProperty('--modal-translate-y', `${Math.round(y)}px`);
        updateBackground(y, metrics || getMetrics());
    }

    function queueSheetY(y) {
        pendingY = y;
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
            rafId = 0;
            applySheetY(pendingY);
        });
    }

    function setStateVisibility(nextState) {
        currentState = nextState;
        modal.dataset.sheetState = nextState;
        modal.style.setProperty('--sheet-radius', nextState === 'full' ? '0px' : '26px');
        if (nextState === 'collapsed') {
            unlockBodyScrollForCourseInfoSheet();
        } else {
            lockBodyScrollForCourseInfoSheet();
        }
        updateBackground(currentY, getMetrics());
    }

    function removeSnappingClass() {
        clearSnapTimer();
        modal.classList.remove('is-snapping');
    }

    function snapTo(nextState, options = {}) {
        if (isDestroyed) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;

        const animate = options.animate !== false && !prefersReducedMotion;
        const metrics = getMetrics();
        const targetY = getStateY(metrics, nextState);
        setStateVisibility(nextState);

        if (animate) {
            modal.classList.add('is-snapping');
            clearSnapTimer();
            snapTimer = window.setTimeout(() => {
                modal.classList.remove('is-snapping');
                snapTimer = null;
            }, 240);
        } else {
            removeSnappingClass();
        }

        applySheetY(targetY, { immediate: !animate });
    }

    function openHalf() {
        snapTo('half', { animate: !prefersReducedMotion });
    }

    function close() {
        if (closing || isDestroyed) return;
        closing = true;
        removeSnappingClass();
        modal.classList.add('is-snapping');
        const metrics = getMetrics();
        applySheetY(metrics.dismissedY, { metrics });
        background.style.pointerEvents = 'none';
        background.style.opacity = '0';

        const closeDelayMs = prefersReducedMotion ? 0 : 220;
        window.setTimeout(() => {
            closing = false;
            onRequestClose();
        }, closeDelayMs);
    }

    function findNearestState(y, metrics) {
        const distances = [
            { state: 'full', delta: Math.abs(y - metrics.fullY) },
            { state: 'half', delta: Math.abs(y - metrics.halfY) },
            { state: 'collapsed', delta: Math.abs(y - metrics.collapsedY) }
        ];
        distances.sort((a, b) => a.delta - b.delta);
        return distances[0]?.state || 'half';
    }

    function moveStateTowardVelocity(baseState, velocity) {
        if (velocity <= -velocitySnapThreshold) {
            if (baseState === 'collapsed') return 'half';
            if (baseState === 'half') return 'full';
            return 'full';
        }
        if (velocity >= velocitySnapThreshold) {
            if (baseState === 'full') return 'half';
            if (baseState === 'half') return 'collapsed';
            return 'collapsed';
        }
        return baseState;
    }

    function computeVelocity() {
        if (moveSamples.length < 2) return 0;
        const sampleWindow = moveSamples.slice(-5);
        const first = sampleWindow[0];
        const last = sampleWindow[sampleWindow.length - 1];
        const dt = Math.max(last.t - first.t, 1);
        return (last.y - first.y) / dt;
    }

    function resetDragState() {
        if (pointerId !== null && pointerId >= 0) {
            try {
                if (modal.hasPointerCapture?.(pointerId)) {
                    modal.releasePointerCapture(pointerId);
                }
            } catch (_) { }
        }
        pointerId = null;
        dragFromBody = false;
        dragging = false;
        startX = 0;
        startY = 0;
        startSheetY = currentY;
        moveSamples = [];
        modal.classList.remove('is-dragging');
    }

    function resolveDragTarget(target) {
        if (!(target instanceof Element)) return null;
        if (target.closest('#class-close, .course-info-mobile-tab-btn, button, a, input, textarea, select, label')) {
            return null;
        }
        if (target.closest('.courseinfo-grabber, .courseinfo-header, .courseinfo-tabs')) {
            return { fromBody: false };
        }
        if (target.closest('.courseinfo-body')) {
            return { fromBody: true };
        }
        return null;
    }

    function beginSheetDrag({ gesturePointerId, target, clientX, clientY }) {
        const dragTarget = resolveDragTarget(target);
        if (!dragTarget) return false;

        pointerId = gesturePointerId;
        dragFromBody = !!dragTarget.fromBody;
        dragging = false;
        startX = clientX;
        startY = clientY;
        startSheetY = currentY;
        moveSamples = [{ y: startY, t: performance.now() }];

        if (pointerId >= 0) {
            modal.setPointerCapture?.(pointerId);
        }
        return true;
    }

    function handlePointerDown(event) {
        if (isDestroyed || closing) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;
        if (String(event.pointerType || '').toLowerCase() === 'touch') return;
        if (event.button !== undefined && event.button !== 0) return;
        beginSheetDrag({
            gesturePointerId: event.pointerId,
            target: event.target,
            clientX: event.clientX,
            clientY: event.clientY
        });
    }

    function handlePointerMove(event) {
        if (isDestroyed || pointerId === null || event.pointerId !== pointerId) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const bodyScroller = modal.querySelector('.courseinfo-body');
        const bodyScrollTop = Math.max(0, Number(bodyScroller?.scrollTop) || 0);
        const isNearTop = bodyScrollTop <= bodyScrollTopTolerance;
        const isExpandingFromHalfOrCollapsed = deltaY < 0 && currentState !== 'full';
        const isDraggingDown = deltaY > 0;

        if (!dragging) {
            if (absDeltaY < SWIPE_START_THRESHOLD) return;
            if (absDeltaY < absDeltaX * SWIPE_AXIS_LOCK_RATIO) {
                resetDragState();
                return;
            }

            if (dragFromBody) {
                if (!bodyScroller) {
                    resetDragState();
                    return;
                }
                let allowSheetDrag = false;
                if (currentState === 'full') {
                    allowSheetDrag = isDraggingDown && isNearTop;
                } else {
                    allowSheetDrag = isExpandingFromHalfOrCollapsed || isNearTop;
                }
                if (!allowSheetDrag) {
                    resetDragState();
                    return;
                }
                if (isNearTop && bodyScrollTop > 0) {
                    bodyScroller.scrollTop = 0;
                }
            }

            dragging = true;
            modal.classList.add('is-dragging');
            modal.classList.remove('is-snapping');
            clearSnapTimer();
        }

        if (dragFromBody && bodyScroller && isDraggingDown && bodyScroller.scrollTop > bodyScrollTopTolerance) {
            resetDragState();
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }

        const metrics = getMetrics();
        const nextY = Math.min(metrics.dismissedY, Math.max(metrics.fullY, startSheetY + deltaY));
        queueSheetY(nextY);
        moveSamples.push({ y: event.clientY, t: performance.now() });
        if (moveSamples.length > 8) {
            moveSamples.shift();
        }
    }

    function finalizeDrag() {
        if (isDestroyed || pointerId === null) {
            resetDragState();
            return;
        }

        if (!dragging) {
            resetDragState();
            return;
        }

        const metrics = getMetrics();
        const velocity = computeVelocity();
        const closeThreshold = metrics.collapsedY + Math.min(126, Math.max(84, metrics.vh * 0.14));
        const shouldDismiss = currentY >= closeThreshold || (currentState === 'collapsed' && velocity > 0.9);

        if (shouldDismiss) {
            resetDragState();
            close();
            return;
        }

        const nearestState = findNearestState(currentY, metrics);
        const nextState = moveStateTowardVelocity(nearestState, velocity);

        resetDragState();
        snapTo(nextState, { animate: true });
    }

    function handlePointerUp(event) {
        if (isDestroyed || pointerId === null || event.pointerId !== pointerId) return;
        if (pointerId >= 0) {
            modal.releasePointerCapture?.(pointerId);
        }
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
            applySheetY(pendingY);
        }
        finalizeDrag();
    }

    function handlePointerCancel(event) {
        if (isDestroyed || pointerId === null || event.pointerId !== pointerId) return;
        if (pointerId >= 0) {
            modal.releasePointerCapture?.(pointerId);
        }
        if (dragging) {
            snapTo(findNearestState(currentY, getMetrics()), { animate: true });
        }
        resetDragState();
    }

    function handleTouchStart(event) {
        if (isDestroyed || closing) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;
        if (pointerId !== null) return;
        const touch = getTouchPoint(event);
        if (!touch) return;
        beginSheetDrag({
            gesturePointerId: TOUCH_POINTER_ID,
            target: event.target,
            clientX: touch.clientX,
            clientY: touch.clientY
        });
    }

    function handleTouchMove(event) {
        if (isDestroyed || pointerId !== TOUCH_POINTER_ID) return;
        const touch = getTouchPoint(event);
        if (!touch) return;
        handlePointerMove({
            pointerId: TOUCH_POINTER_ID,
            clientX: touch.clientX,
            clientY: touch.clientY,
            cancelable: event.cancelable,
            preventDefault: () => {
                if (event.cancelable) {
                    event.preventDefault();
                }
            }
        });
    }

    function handleTouchEnd(event) {
        if (isDestroyed || pointerId !== TOUCH_POINTER_ID) return;
        const touch = getTouchPoint(event);
        if (!touch) {
            handlePointerCancel({ pointerId: TOUCH_POINTER_ID });
            return;
        }
        handlePointerUp({
            pointerId: TOUCH_POINTER_ID,
            clientX: touch.clientX,
            clientY: touch.clientY
        });
    }

    function handleTouchCancel() {
        if (isDestroyed || pointerId !== TOUCH_POINTER_ID) return;
        handlePointerCancel({ pointerId: TOUCH_POINTER_ID });
    }

    function handleResize() {
        if (isDestroyed) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;
        if (!refreshStableViewport(false)) return;
        snapTo(currentState, { animate: false });
    }

    function handleOrientationChange() {
        if (isDestroyed) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;
        refreshStableViewport(true);
        snapTo(currentState, { animate: false });
    }

    function setPeekContent() {
        // Keep interface shape stable; content is intentionally unchanged across sheet states.
    }

    function destroy() {
        if (isDestroyed) return;
        isDestroyed = true;
        clearSnapTimer();
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        modal.removeEventListener('pointerdown', handlePointerDown, true);
        modal.removeEventListener('pointermove', handlePointerMove, true);
        modal.removeEventListener('pointerup', handlePointerUp, true);
        modal.removeEventListener('pointercancel', handlePointerCancel, true);
        modal.removeEventListener('touchstart', handleTouchStart);
        modal.removeEventListener('touchmove', handleTouchMove);
        modal.removeEventListener('touchend', handleTouchEnd);
        modal.removeEventListener('touchcancel', handleTouchCancel);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleOrientationChange);
        modal.classList.remove('is-dragging', 'is-snapping');
        delete modal.dataset.sheetState;
        modal.style.removeProperty('--sheet-y');
        modal.style.removeProperty('--sheet-radius');
        resetDragState();
    }

    modal.addEventListener('pointerdown', handlePointerDown, true);
    modal.addEventListener('pointermove', handlePointerMove, { passive: false, capture: true });
    modal.addEventListener('pointerup', handlePointerUp, true);
    modal.addEventListener('pointercancel', handlePointerCancel, true);
    modal.addEventListener('touchstart', handleTouchStart, { passive: true });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: true });
    modal.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    refreshStableViewport(true);

    setStateVisibility('half');
    snapTo('half', { animate: false });

    return {
        openHalf,
        snapTo,
        close,
        destroy,
        setPeekContent,
        setStateVisibility,
        getState: () => currentState
    };
}

// Swipe behavior for class-info modal with collapsed/expanded states on mobile
function addSwipeToClose(modal, background, onClose = null) {
    if (!modal || !background) return;

    if (typeof modal._classInfoSwipeCleanup === 'function') {
        modal._classInfoSwipeCleanup();
    }

    resetSwipeHandlers(modal, '_classInfoSwipeHandlers');

    const contentWrapper = modal.querySelector('.sheet-body') || modal.querySelector('.class-content-wrapper');
    const velocityThreshold = 0.55;

    let startX = 0;
    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let dragging = false;
    let axisLocked = false;
    let cancelled = false;
    let closing = false;
    let swipeGestureAllowed = false;
    let gestureState = 'collapsed'; // 'collapsed' | 'expanded'
    let settleTimer = null;
    let closeTimer = null;

    const collapsedOffsetPx = () => Math.round(window.innerHeight * 0.38);
    const expandedOffsetPx = () => 0;
    const expandDistance = () => Math.min(180, Math.max(90, window.innerHeight * 0.14));
    const closeDistance = () => Math.min(280, Math.max(120, window.innerHeight * 0.22));
    const collapseDistance = () => Math.min(180, Math.max(90, window.innerHeight * 0.14));

    function isExpanded() {
        return modal.classList.contains('fully-open');
    }

    function isSwipeHandleTarget(target) {
        if (!(target instanceof Element)) return false;
        return !!target.closest('.class-info-header, .swipe-indicator');
    }

    function clearTimers() {
        if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
        }
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    }

    function animateToState(nextState) {
        clearTimers();

        modal.classList.remove('swiping');
        modal.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease';
        background.style.transition = 'opacity 220ms ease';
        background.style.opacity = '1';
        modal.style.opacity = '1';

        if (nextState === 'expanded') {
            modal.classList.add('fully-open');
            modal.style.setProperty('--modal-translate-y', `${expandedOffsetPx()}px`);
        } else {
            modal.classList.remove('fully-open');
            modal.style.setProperty('--modal-translate-y', `${collapsedOffsetPx()}px`);
        }

        settleTimer = setTimeout(() => {
            if (closing) return;
            clearSheetInlineStyles(modal, background, {
                preserveBackgroundOpacity: true,
                preserveTranslateY: true
            });
        }, 320);
    }

    function closeModalWithSwipe() {
        if (closing) return;
        closing = true;
        clearTimers();

        modal.classList.remove('swiping');
        modal.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease';
        background.style.transition = 'opacity 260ms ease';
        modal.style.setProperty('--modal-translate-y', '100vh');
        modal.style.opacity = '0.35';
        background.style.opacity = '0';

        closeTimer = setTimeout(() => {
            if (typeof onClose === 'function') {
                onClose();
            } else {
                document.body.style.overflow = 'auto';
                restoreCourseModalReturnURL(modal);

                if (background.parentNode) {
                    background.parentNode.removeChild(background);
                }

                modal.classList.remove('show', 'fully-open', 'swiping');
                clearSheetInlineStyles(modal, background, { preserveBackgroundOpacity: true });
            }
            closing = false;
            closeTimer = null;
        }, SWIPE_CLOSE_DURATION_MS);
    }

    function handleTouchStart(event) {
        if (!isMobileSheet() || closing) return;
        const point = getTouchPoint(event);
        if (!point) return;

        startX = point.clientX;
        startY = point.clientY;
        currentY = startY;
        startTime = Date.now();
        dragging = false;
        axisLocked = false;
        cancelled = false;
        swipeGestureAllowed = isSwipeHandleTarget(event.target);
        gestureState = isExpanded() ? 'expanded' : 'collapsed';
        clearTimers();

        modal.style.transition = '';
        background.style.transition = '';
    }

    function handleTouchMove(event) {
        if (!isMobileSheet() || closing || cancelled) return;
        if (!swipeGestureAllowed && !dragging) return;

        const point = getTouchPoint(event);
        if (!point) return;

        currentY = point.clientY;
        const deltaX = point.clientX - startX;
        const deltaY = currentY - startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const atTop = isAtTop(contentWrapper);

        if (!axisLocked) {
            if (absDeltaX < SWIPE_START_THRESHOLD && absDeltaY < SWIPE_START_THRESHOLD) return;

            axisLocked = true;
            const mostlyVertical = absDeltaY >= absDeltaX * SWIPE_AXIS_LOCK_RATIO;
            const validDirection = gestureState === 'collapsed'
                ? (deltaY < 0 && atTop) || (deltaY > 0 && atTop)
                : (deltaY > 0 && atTop);

            if (!mostlyVertical || !validDirection) {
                cancelled = true;
                return;
            }

            dragging = true;
            modal.classList.add('swiping');
            modal.style.transition = 'none';
            background.style.transition = 'none';
        }

        if (!dragging) return;
        if (deltaY > 0 && !atTop) {
            cancelled = true;
            animateToState(gestureState);
            return;
        }

        event.preventDefault();

        const collapsedOffset = collapsedOffsetPx();

        if (gestureState === 'collapsed') {
            if (deltaY < 0) {
                const nextY = Math.max(expandedOffsetPx(), collapsedOffset + deltaY);
                modal.style.setProperty('--modal-translate-y', `${nextY}px`);
                modal.style.opacity = '1';
                background.style.opacity = '1';
                return;
            }

            const resisted = applyDragResistance(deltaY);
            const nextY = collapsedOffset + resisted;
            const progress = Math.min(resisted / Math.max(window.innerHeight * 0.55, 260), 1);
            modal.style.setProperty('--modal-translate-y', `${nextY}px`);
            modal.style.opacity = `${Math.max(0.3, 1 - progress * 0.75)}`;
            background.style.opacity = `${Math.max(0.15, 1 - progress * 0.85)}`;
            return;
        }

        if (deltaY <= 0) return;
        const resisted = applyDragResistance(deltaY);
        modal.style.setProperty('--modal-translate-y', `${Math.min(collapsedOffset + 90, expandedOffsetPx() + resisted)}px`);
        modal.style.opacity = '1';
        background.style.opacity = '1';
    }

    function handleTouchEnd() {
        if (!isMobileSheet() || closing) return;

        if (!dragging) {
            dragging = false;
            axisLocked = false;
            cancelled = false;
            swipeGestureAllowed = false;
            return;
        }

        const deltaY = currentY - startY;
        const duration = Math.max(Date.now() - startTime, 1);
        const velocity = deltaY / duration;

        if (gestureState === 'collapsed') {
            if (deltaY < 0) {
                const shouldExpand = Math.abs(deltaY) > expandDistance() || velocity < -velocityThreshold;
                animateToState(shouldExpand ? 'expanded' : 'collapsed');
            } else {
                const shouldClose = deltaY > closeDistance() || velocity > velocityThreshold;
                if (shouldClose) {
                    closeModalWithSwipe();
                } else {
                    animateToState('collapsed');
                }
            }
        } else {
            const shouldCollapse = deltaY > collapseDistance() || velocity > velocityThreshold;
            animateToState(shouldCollapse ? 'collapsed' : 'expanded');
        }

        dragging = false;
        axisLocked = false;
        cancelled = false;
        swipeGestureAllowed = false;
    }

    function handleTouchCancel() {
        if (!isMobileSheet() || closing) return;

        if (dragging) {
            animateToState(gestureState);
        }

        dragging = false;
        axisLocked = false;
        cancelled = false;
        swipeGestureAllowed = false;
    }

    modal.addEventListener('touchstart', handleTouchStart, { passive: false });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: false });
    modal.addEventListener('touchcancel', handleTouchCancel, { passive: false });

    modal._classInfoSwipeHandlers = {
        touchstart: handleTouchStart,
        touchmove: handleTouchMove,
        touchend: handleTouchEnd,
        touchcancel: handleTouchCancel
    };

    modal._classInfoSwipeCleanup = clearTimers;
}

// Swipe behavior for filter/search mobile sheets
function addSwipeToCloseSimple(modal, background, closeCallback) {
    if (!modal || !background) return;

    if (typeof modal._swipeCleanup === 'function') {
        modal._swipeCleanup();
    }

    resetSwipeHandlers(modal, '_swipeHandlers');

    let startX = 0;
    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let dragging = false;
    let axisLocked = false;
    let cancelled = false;
    let lockedToInnerScroll = false;
    let closing = false;
    let settleTimer = null;
    let closeTimer = null;

    const velocityThreshold = 0.55;
    const closeDistance = () => Math.min(230, Math.max(96, window.innerHeight * 0.16));

    function getScrollableElement() {
        return modal.querySelector('.semester-mobile-sheet-options') ||
            modal.querySelector('.filter-content') ||
            modal.querySelector('.profile-modal-body') ||
            modal.querySelector('.modal-body') ||
            modal.querySelector('.conflict-content') ||
            modal.querySelector('.class-content-wrapper') ||
            modal;
    }

    function isInsideSwipeLockTarget(target) {
        const lockSelector = String(modal.dataset.swipeLockSelector || '').trim();
        if (!lockSelector) return false;
        if (!(target instanceof Element)) return false;
        return !!target.closest(lockSelector);
    }

    function clearTimers() {
        if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
        }
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    }

    function animateBackOpen() {
        clearTimers();

        modal.classList.remove('swiping');
        modal.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
        background.style.transition = 'opacity 220ms ease';
        modal.style.setProperty('--modal-translate-y', '0px');
        background.style.opacity = '1';
        modal.style.opacity = '1';

        settleTimer = setTimeout(() => {
            if (closing) return;
            clearSheetInlineStyles(modal, background);
        }, 260);
    }

    function closeWithSwipe() {
        if (closing) return;
        closing = true;
        clearTimers();

        modal.classList.remove('swiping');
        modal.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
        background.style.transition = 'opacity 260ms ease';
        modal.style.setProperty('--modal-translate-y', '100vh');
        background.style.opacity = '0';

        closeTimer = setTimeout(() => {
            closeCallback?.();
            clearSheetInlineStyles(modal, background);
            modal.classList.remove('show');
            closing = false;
            closeTimer = null;
        }, SWIPE_CLOSE_DURATION_MS);
    }

    function handleTouchStart(event) {
        if (!isMobileSheet() || closing) return;
        const point = getTouchPoint(event);
        if (!point) return;

        if (isInsideSwipeLockTarget(event.target)) {
            lockedToInnerScroll = true;
            dragging = false;
            axisLocked = false;
            cancelled = true;
            return;
        }

        startX = point.clientX;
        startY = point.clientY;
        currentY = startY;
        startTime = Date.now();
        dragging = false;
        axisLocked = false;
        cancelled = false;
        lockedToInnerScroll = false;
        clearTimers();
        modal.style.transition = '';
        background.style.transition = '';
    }

    function handleTouchMove(event) {
        if (!isMobileSheet() || closing || cancelled || lockedToInnerScroll) return;

        const point = getTouchPoint(event);
        if (!point) return;

        currentY = point.clientY;
        const deltaX = point.clientX - startX;
        const deltaY = currentY - startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const atTop = isAtTop(getScrollableElement());

        if (!axisLocked) {
            if (absDeltaX < SWIPE_START_THRESHOLD && absDeltaY < SWIPE_START_THRESHOLD) return;

            axisLocked = true;
            const mostlyVertical = absDeltaY >= absDeltaX * SWIPE_AXIS_LOCK_RATIO;
            if (!mostlyVertical || deltaY <= 0 || !atTop) {
                cancelled = true;
                return;
            }

            dragging = true;
            modal.classList.add('swiping');
            modal.style.transition = 'none';
            background.style.transition = 'none';
        }

        if (!dragging) return;
        if (!atTop) {
            cancelled = true;
            animateBackOpen();
            return;
        }

        event.preventDefault();

        const resisted = applyDragResistance(deltaY);
        const progress = Math.min(resisted / Math.max(window.innerHeight * 0.55, 260), 1);
        modal.style.setProperty('--modal-translate-y', `${resisted}px`);
        background.style.opacity = `${Math.max(0.18, 1 - progress * 0.82)}`;
    }

    function handleTouchEnd() {
        if (!isMobileSheet() || closing) return;

        if (!dragging) {
            dragging = false;
            axisLocked = false;
            cancelled = false;
            lockedToInnerScroll = false;
            return;
        }

        const deltaY = currentY - startY;
        const duration = Math.max(Date.now() - startTime, 1);
        const velocity = deltaY / duration;
        const shouldClose = deltaY > closeDistance() || velocity > velocityThreshold;

        if (shouldClose) {
            closeWithSwipe();
        } else {
            animateBackOpen();
        }

        dragging = false;
        axisLocked = false;
        cancelled = false;
        lockedToInnerScroll = false;
    }

    function handleTouchCancel() {
        if (!isMobileSheet() || closing) return;

        if (dragging) {
            animateBackOpen();
        }

        dragging = false;
        axisLocked = false;
        cancelled = false;
        lockedToInnerScroll = false;
    }

    modal.addEventListener('touchstart', handleTouchStart, { passive: false });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: false });
    modal.addEventListener('touchcancel', handleTouchCancel, { passive: false });

    modal._swipeHandlers = {
        touchstart: handleTouchStart,
        touchmove: handleTouchMove,
        touchend: handleTouchEnd,
        touchcancel: handleTouchCancel
    };

    modal._swipeCleanup = clearTimers;
}

// Make it globally available
window.addSwipeToCloseSimple = addSwipeToCloseSimple;
window.fetchCourseData = fetchCourseData;
window.invalidateCourseCache = invalidateCourseCache;
window.fetchProfessorChanges = fetchProfessorChanges;
window.clearProfessorChangeCache = clearProfessorChangeCache;
window.openCourseInfoMenu = openCourseInfoMenu;
