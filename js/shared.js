import { supabase } from "../supabase.js";
import * as wanakana from 'wanakana';
import { getCurrentAppPath, stripBase, toAppUrl, withBase } from './path-utils.js';
import { isCourseSaved, readSavedCourses, syncSavedCoursesForUser, toggleSavedCourse } from './saved-courses.js';

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
const SLOT_ALLOWED_TYPE_FILTERS = new Set(['Core', 'Foundation', 'Elective']);
const SLOT_ALLOWED_TIMES = new Set(Object.values(SLOT_PERIOD_TO_TIME));

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
    '張': 'Chou',
    '趙': 'Chou',
    '仲間': 'Nakama', '間': 'Ma', '仲': 'Naka',
    '河村': 'Kawamura', '村': 'Mura', '河': 'Kawa',
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
    '林': 'Hayashi',
    '森': 'Mori',
    '池田': 'Ikeda', '池': 'Ike',
    '橋本': 'Hashimoto', '橋': 'Hashi',

    // Common given names
    '旬子': 'Junko', '子': 'Ko', '旬': 'Jun',
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
    'スズキ': 'Suzuki', 'イトウ': 'Itou', 'ワタナベ': 'Watanabe'
};

// Cache for romanized professor names
const romanizedProfessorCache = new Map();

// Clear cache when page loads to ensure fresh romanization
romanizedProfessorCache.clear();

// Helper function to romanize Japanese professor names
function romanizeProfessorName(name) {
    if (!name) return name;

    // Check cache first
    if (romanizedProfessorCache.has(name)) {
        return romanizedProfessorCache.get(name);
    }

    // Check if the name contains Japanese characters
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(name);

    if (!hasJapanese) {
        // Capitalize non-Japanese names properly
        const capitalized = name.toUpperCase();
        romanizedProfessorCache.set(name, capitalized);
        return capitalized;
    }

    let romanized = name;

    try {
        // Split the name and process each part
        let parts = name.split(/[\s　]+/); // Split on regular and full-width spaces
        let romanizedParts = [];

        for (let part of parts) {
            let romanizedPart = part;

            // First, try WanaKana for Hiragana/Katakana conversion
            const wanaKanaResult = wanakana.toRomaji(part);

            // If WanaKana converted it (no more Japanese characters), use that
            if (!/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(wanaKanaResult)) {
                romanizedPart = wanaKanaResult;
            } else {
                // Still has Kanji, try our custom mapping

                // Try exact match first
                if (japaneseNameMapping[part]) {
                    romanizedPart = japaneseNameMapping[part];
                } else {
                    // Try character by character mapping
                    let characterMapped = '';
                    for (let char of part) {
                        if (japaneseNameMapping[char]) {
                            characterMapped += japaneseNameMapping[char];
                        } else {
                            // Try WanaKana on individual character
                            const charRomaji = wanakana.toRomaji(char);
                            if (!/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(charRomaji)) {
                                characterMapped += charRomaji;
                            } else {
                                characterMapped += char;
                            }
                        }
                    }
                    romanizedPart = characterMapped;
                }
            }

            romanizedParts.push(romanizedPart);
        }

        romanized = romanizedParts.join(' ');

        // Clean up and capitalize properly
        romanized = romanized.replace(/\s+/g, ' ').trim();
        // Convert to full caps (uppercase)
        romanized = romanized.toUpperCase();

    } catch (error) {
        console.warn('Error romanizing name:', error);
        romanized = name;
    }

    // Cache the result
    romanizedProfessorCache.set(name, romanized);
    return romanized;
}

// Synchronous function to get romanized professor name from cache
function getRomanizedProfessorName(name) {
    return romanizedProfessorCache.get(name) || romanizeProfessorName(name);
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

function formatCourseTimeCompactLabel(rawTimeSlot) {
    const raw = String(rawTimeSlot || '').trim();
    if (!raw) return 'TBA';
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

const COURSE_INFO_ACTIVE_TAB_KEY = 'ila_course_info_active_tab_v1';
const COURSE_INFO_TAB_VALUES = new Set(['overview', 'assignments', 'reviews']);
const COURSE_INFO_MOBILE_BREAKPOINT = 1023;
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let activeCourseInfoTabController = null;
let courseInfoOpenRequestVersion = 0;
let courseInfoBodyLockSnapshot = null;
let courseInfoBodyLockScrollY = 0;

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

function showGlobalToast(message, durationMs = 2200) {
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

function CourseInfoContent(model, options = {}) {
    const isMobile = options.isMobile === true;
    const badges = Array.isArray(model?.badges) ? model.badges : [];
    const detailRows = Array.isArray(model?.detailRows) ? model.detailRows : [];
    const heroActions = Array.isArray(model?.heroActions) ? model.heroActions : [];
    const placeConflictInsideTimeRow = isMobile && detailRows.some((row) => String(row?.label || '').trim().toLowerCase() === 'time');

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
                            ${(placeConflictInsideTimeRow && String(row?.label || '').trim().toLowerCase() === 'time')
            ? (model?.conflictPreview
                ? `<div class="course-info-inline-warning" id="course-conflict-preview">${escapeHtml(model.conflictPreview)}</div>`
                : '<div class="course-info-inline-warning" id="course-conflict-preview" style="display:none;"></div>')
            : ''}
                        </div>
                    `).join('')}
                    </div>
                    ${placeConflictInsideTimeRow
            ? ''
            : (model?.conflictPreview
                ? `<div class="course-info-inline-warning" id="course-conflict-preview">${escapeHtml(model.conflictPreview)}</div>`
                : '<div class="course-info-inline-warning" id="course-conflict-preview" style="display:none;"></div>')}
                </div>
            </section>
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
    const headerTitle = containerEl.querySelector('.class-header h2');
    if (headerTitle) headerTitle.textContent = model?.headerTitle || 'Class Info';
}

function CourseInfoPage(containerEl, model) {
    if (!containerEl) return;
    containerEl.classList.add('sheet', 'course-info-page-shell', 'courseinfo-sheet');
    containerEl.querySelector('.class-info-header')?.classList.add('courseinfo-header');
    containerEl.querySelector('.swipe-indicator')?.classList.add('courseinfo-grabber');
    (containerEl.querySelector('.sheet-body') || containerEl.querySelector('.class-content-wrapper'))?.classList.add('courseinfo-body');
    containerEl.querySelector('#course-info-peek')?.classList.add('courseinfo-peek');
    const headerTitle = containerEl.querySelector('.class-header h2');
    if (headerTitle) headerTitle.textContent = model?.headerTitle || 'Class Info';
}

function syncCourseInfoHeaderPresentation(containerEl, model, options = {}) {
    if (!containerEl) return;

    const isMobile = options.isMobile === true;
    const classHeader = containerEl.querySelector('.class-header');
    const headerWrap = containerEl.querySelector('.class-info-header');
    const headerTitle = classHeader?.querySelector('h2');
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

function openDsModal({ title, subtitle = '', bodyHtml = '', footerHtml = '', onMount = null, onClose = null, className = '', modalKind = 'ds' }) {
    const existing = document.querySelector(`.modal[data-modal-kind="${modalKind}"]`);
    if (existing) existing.remove();

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

    let isClosed = false;
    let focusTrapCleanup = null;
    const requestClose = () => {
        if (typeof modal.__requestClose === 'function') {
            const handled = modal.__requestClose();
            if (handled === true) return;
        }
        close();
    };

    const close = () => {
        if (isClosed) return;
        isClosed = true;
        modal.classList.add('hidden');
        if (typeof focusTrapCleanup === 'function') {
            focusTrapCleanup();
            focusTrapCleanup = null;
        }
        setTimeout(() => {
            try {
                modal.querySelector('.modal-dialog')?._swipeCleanup?.();
            } catch (_) { }
            modal.remove();
            if (typeof onClose === 'function') {
                onClose();
            } else {
                document.body.style.overflow = 'auto';
            }
        }, 220);
    };

    modal.addEventListener('click', (event) => {
        if (event.target === modal || event.target?.dataset?.action === 'close-modal') {
            requestClose();
        }
    });

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    const dialog = modal.querySelector('.modal-dialog');
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
    return { modal, close };
}

function openConfirmModal({ title = 'Confirm', message = 'Are you sure?', confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false }) {
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

    // Check if GPA data is present (checking for non-null AND non-zero values)
    const coursesWithGPA = courses.filter(course => {
        const hasValidGPA = (
            (course.gpa_a_percent !== null && course.gpa_a_percent !== 0) ||
            (course.gpa_b_percent !== null && course.gpa_b_percent !== 0) ||
            (course.gpa_c_percent !== null && course.gpa_c_percent !== 0) ||
            (course.gpa_d_percent !== null && course.gpa_d_percent !== 0) ||
            (course.gpa_f_percent !== null && course.gpa_f_percent !== 0)
        );
        return hasValidGPA;
    });

    const coursesWithoutGPA = courses.filter(course => {
        const hasValidGPA = (
            (course.gpa_a_percent !== null && course.gpa_a_percent !== 0) ||
            (course.gpa_b_percent !== null && course.gpa_b_percent !== 0) ||
            (course.gpa_c_percent !== null && course.gpa_c_percent !== 0) ||
            (course.gpa_d_percent !== null && course.gpa_d_percent !== 0) ||
            (course.gpa_f_percent !== null && course.gpa_f_percent !== 0)
        );
        return !hasValidGPA;
    });

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

// Cache for professor change data
let professorChangeCache = {};

// Function to clear professor change cache (call when semester changes)
export function clearProfessorChangeCache() {
    professorChangeCache = {};
    console.log('Professor change cache cleared');
}

// Function to check which courses have professor changes across semesters
// Returns a Set of course_codes that have had professor changes
export async function fetchProfessorChanges(courseCodes) {
    if (!courseCodes || courseCodes.length === 0) {
        return new Set();
    }

    // Check cache first - filter out already cached course codes
    const uncachedCodes = courseCodes.filter(code => !(code in professorChangeCache));

    if (uncachedCodes.length === 0) {
        // All codes are cached, build result from cache
        const changedCourses = new Set();
        courseCodes.forEach(code => {
            if (professorChangeCache[code] === true) {
                changedCourses.add(code);
            }
        });
        return changedCourses;
    }

    try {
        console.log(`Checking professor changes for ${uncachedCodes.length} courses...`);

        // Fetch all instances of these courses across all semesters
        const { data: courseHistory, error } = await supabase
            .from('courses')
            .select('course_code, professor, academic_year, term')
            .in('course_code', uncachedCodes)
            .order('academic_year', { ascending: false })
            .order('term', { ascending: false });

        if (error) {
            console.error('Error fetching professor history:', error);
            return new Set();
        }

        if (!courseHistory || courseHistory.length === 0) {
            // No history found, cache as no change
            uncachedCodes.forEach(code => {
                professorChangeCache[code] = false;
            });
            return new Set();
        }

        // Group courses by course_code
        const coursesByCode = {};
        courseHistory.forEach(course => {
            if (!coursesByCode[course.course_code]) {
                coursesByCode[course.course_code] = [];
            }
            coursesByCode[course.course_code].push(course);
        });

        // Check each course code for professor changes
        const changedCourses = new Set();

        Object.entries(coursesByCode).forEach(([code, instances]) => {
            if (instances.length <= 1) {
                // Only one instance, no change possible
                professorChangeCache[code] = false;
                return;
            }

            // Get unique professors for this course (normalize for comparison)
            const professors = new Set(
                instances
                    .map(i => i.professor)
                    .filter(p => p && p.trim() !== '')
                    .map(p => p.trim().toLowerCase())
            );

            // If there's more than one unique professor, mark as changed
            if (professors.size > 1) {
                changedCourses.add(code);
                professorChangeCache[code] = true;
                console.log(`Professor change detected for ${code}:`, [...professors]);
            } else {
                professorChangeCache[code] = false;
            }
        });

        // Cache any codes that weren't found as no change
        uncachedCodes.forEach(code => {
            if (!(code in professorChangeCache)) {
                professorChangeCache[code] = false;
            }
        });

        console.log(`Found ${changedCourses.size} courses with professor changes`);
        return changedCourses;

    } catch (error) {
        console.error('Error checking professor changes:', error);
        return new Set();
    }
}

export async function openCourseInfoMenu(course, updateURL = true, options = {}) {
    console.log('Opening course info menu for:', course);
    const requestVersion = ++courseInfoOpenRequestVersion;
    cleanupActiveCourseInfoTabController();
    const requestedInitialTab = normalizeCourseInfoTab(options?.initialTab || readStoredCourseInfoTab());
    const isMobileCourseInfo = isCourseInfoMobileViewport();

    // Function to properly format time slots from Japanese to English
    function formatTimeSlot(timeSlot) {
        if (!timeSlot) return 'TBA';

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

        // Try to match Japanese format: (月曜日1講時) or variants
        let match = timeSlot.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
        if (match) {
            const dayChar = match[1];
            const period = match[2];
            const dayName = dayMap[dayChar];
            const timeRange = timeMap[period];

            if (dayName && timeRange) {
                return `${dayName} ${timeRange}`;
            }
        }

        // Try to match English format that's already converted: "Mon 10:45 - 12:15" etc
        const englishMatch = timeSlot.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})/);
        if (englishMatch) {
            const dayAbbr = englishMatch[1];
            const timeRange = englishMatch[2];
            const fullDayMap = {
                "Mon": "Monday",
                "Tue": "Tuesday",
                "Wed": "Wednesday",
                "Thu": "Thursday",
                "Fri": "Friday",
                "Sat": "Saturday",
                "Sun": "Sunday"
            };
            return `${fullDayMap[dayAbbr]} ${timeRange}`;
        }

        // If it's already in a good format or unrecognized, return as-is
        return timeSlot;
    }

    const classInfo = document.getElementById("class-info");
    const courseInfoBody = document.getElementById("course-info-body");
    const courseInfoContentRoot = document.getElementById("course-info-content-root");
    const courseInfoActions = document.getElementById("course-info-actions");
    const courseInfoPeek = document.getElementById("course-info-peek");
    const classClose = document.getElementById("class-close");
    const isStaleRequest = () => requestVersion !== courseInfoOpenRequestVersion;

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
    if (typeof classInfo._classInfoSwipeCleanup === 'function') {
        classInfo._classInfoSwipeCleanup();
        classInfo._classInfoSwipeCleanup = null;
    }
    resetSwipeHandlers(classInfo, '_classInfoSwipeHandlers');
    classInfo._classInfoSwipeHandlers = null;

    const isDedicatedCoursePage = options.presentation === 'page' ||
        (document.body.classList.contains('course-page-mode') && /^\/courses?\//.test(getCurrentAppPath()));

    const modalReturnPath = !isDedicatedCoursePage ? rememberCourseModalReturnPath(getCurrentAppPath(), classInfo) : null;

    if (isDedicatedCoursePage) {
        CourseInfoPage(classInfo, { headerTitle: 'Class Info' });
    } else {
        CourseInfoSheet(classInfo, { headerTitle: 'Class Info' });
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
            cleanupActiveCourseInfoTabController();

            if (activeBackground && activeBackground.parentNode) {
                activeBackground.parentNode.removeChild(activeBackground);
            }
            classInfoBackground = null;
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
    const courseType = course.type || 'General';

    // Check if course is already selected by user (for time slot background color)
    let isAlreadySelected = false;
    let savedCoursesList = readSavedCourses(Number.POSITIVE_INFINITY);
    let isSavedForLater = isCourseSaved(course, savedCoursesList);
    const { data: { session } } = await supabase.auth.getSession();
    if (isStaleRequest()) return;
    if (session) {
        const { data: profileData } = await supabase
            .from('profiles')
            .select('courses_selection, saved_courses')
            .eq('id', session.user.id)
            .single();
        if (isStaleRequest()) return;

        if (profileData?.courses_selection) {
            // Filter courses by current year and term, then check if this course is selected
            const currentYearCourses = filterCoursesByCurrentYearTerm(profileData.courses_selection);
            isAlreadySelected = currentYearCourses.some(selected =>
                selected.code === course.course_code
            );
        }

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
    const canModifyCourseSelection = typeof isCurrentSemester === 'function' ? isCurrentSemester() : true;

    // Reference to the exported checkTimeConflict function defined later in the file
    const checkTimeConflictForModal = async (timeSlot, courseCode, academicYear) => {
        // This will reference the exported function defined at the bottom of the file
        return await window.checkTimeConflictExported(timeSlot, courseCode, academicYear);
    };
    let updateFooterActionLayout = () => { };

    function applyClassInfoCourseActionButtonState(button, state) {
        if (!button) return;

        button.classList.add('control-surface', 'class-info-course-action');
        button.classList.remove('is-add', 'is-remove', 'is-locked');
        button.style.background = '';
        button.style.color = '';
        button.style.cursor = '';

        if (state === 'locked') {
            button.textContent = "Semester Locked";
            button.classList.add('is-locked');
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

            const { data: profile } = await supabase
                .from('profiles')
                .select('courses_selection')
                .eq('id', session.user.id)
                .single();

            const currentSelection = profile?.courses_selection || [];
            const currentYearCourses = filterCoursesByCurrentYearTerm(currentSelection);
            const isCurrentlySelected = currentYearCourses.some(selected =>
                selected.code === course.course_code
            );
            isAlreadySelected = isCurrentlySelected;
            updateFooterActionLayout(isCurrentlySelected);

            if (isCurrentlySelected) {
                applyClassInfoCourseActionButtonState(button, 'remove');
            } else {
                applyClassInfoCourseActionButtonState(button, 'add');
            }
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
    const visibleBadges = [
        ...(session ? [{
            label: isAlreadySelected ? 'Registered' : 'Not registered',
            variant: isAlreadySelected ? 'success' : 'muted',
            role: 'registration-status'
        }] : []),
        ...(isMobileCourseInfo
            ? (isSavedForLater ? [{ label: 'Saved', variant: 'success', role: 'saved-status' }] : [])
            : ((session || isSavedForLater) ? [{
                label: isSavedForLater ? 'Saved' : 'Not saved',
                variant: isSavedForLater ? 'success' : 'muted',
                role: 'saved-status'
            }] : [])),
        ...(formatCourseCreditsLabel(course.credits) ? [{ label: formatCourseCreditsLabel(course.credits), variant: 'default' }] : []),
        { label: courseType, variant: 'default', dotColor: courseColor }
    ];
    const courseInfoModel = {
        headerTitle: 'Class Info',
        title: normalizeCourseTitle(course.title) || course.course_code || 'Course',
        titleDotColor: courseColor,
        subline: heroSubline,
        badges: visibleBadges,
        heroActions: [
            { label: 'Share', action: 'share-course', variant: 'secondary', icon: 'pill-icon--share' },
            ...(course.url ? [{ label: 'Syllabus', action: 'open-syllabus', href: course.url, variant: 'secondary', icon: 'pill-icon--external' }] : [])
        ],
        detailRows: [
            { label: 'Professor', value: getRomanizedProfessorName(course.professor) || 'TBA' },
            { label: 'Course Code', value: courseCodeValue },
            { label: 'Course Type', value: courseType },
            ...(course.credits ? [{ label: 'Credits', value: formatCourseCreditsLabel(course.credits) }] : []),
            { label: 'Time', value: timeDetailLabel },
            { label: 'Term', value: formatCourseTermYearLabel(course) },
            ...(locationValue ? [{ label: 'Location', value: locationValue }] : [])
        ]
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
    let guestAssignmentsModalOverlayEnabled = false;
    let syncGuestAssignmentsModalOverlayForTab = () => {
        classInfo.classList.remove('courseinfo-guest-assignments-preview');
    };

    if (!classContent || !classGPA || !classReview || !classAssignments) {
        console.error("Course info internal sections failed to mount.");
        return;
    }

    classContent.innerHTML = CourseInfoContent(courseInfoModel, { isMobile: isMobileCourseInfo && !isDedicatedCoursePage });

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
            const professorChanges = await fetchProfessorChanges([course.course_code]);
            if (isStaleRequest()) return;
            hasProfessorChanged = professorChanges.has(course.course_code);
        } catch (error) {
            console.warn('Could not check professor changes:', error);
        }
    }

    console.log('Course GPA data check:', {
        courseCode: course.course_code,
        gpa_a_percent: course.gpa_a_percent,
        gpa_b_percent: course.gpa_b_percent,
        gpa_c_percent: course.gpa_c_percent,
        gpa_d_percent: course.gpa_d_percent,
        gpa_f_percent: course.gpa_f_percent,
        hasValidGpaData,
        hasProfessorChanged
    });

    // Show GPA only if we have valid data AND professor hasn't changed
    if (hasValidGpaData && !hasProfessorChanged) {
        classGPA.style.display = 'block';
        const useDsCardGpa = isMobileCourseInfo || !isDedicatedCoursePage;
        classGPA.classList.toggle('ds-card', useDsCardGpa);
        classGPA.innerHTML = `
            ${useDsCardGpa
                ? '<div class="ds-card-header"><h3>Grade Distribution</h3></div>'
                : '<p class="class-subtitle">Grade Distribution</p>'}
            <div class="class-info-container gpa-layout">
                <div class="gpa-container"><h3>A</h3><div class="gpa-bar-graph" style="background: ${gpaA}; width: ${course.gpa_a_percent}%;"><h3>${course.gpa_a_percent}%</h3></div></div>
                <div class="gpa-container"><h3>B</h3><div class="gpa-bar-graph" style="background: ${gpaB}; width: ${course.gpa_b_percent}%;"><h3>${course.gpa_b_percent}%</h3></div></div>
                <div class="gpa-container"><h3>C</h3><div class="gpa-bar-graph" style="background: ${gpaC}; width: ${course.gpa_c_percent}%;"><h3>${course.gpa_c_percent}%</h3></div></div>
                <div class="gpa-container"><h3>D</h3><div class="gpa-bar-graph" style="background: ${gpaD}; width: ${course.gpa_d_percent}%;"><h3>${course.gpa_d_percent}%</h3></div></div>
                <div class="gpa-container"><h3>F</h3><div class="gpa-bar-graph" style="background: ${gpaF}; width: ${course.gpa_f_percent}%;"><h3>${course.gpa_f_percent}%</h3></div></div>
            </div>
        `;
    } else {
        // If no valid GPA data or professor has changed, ensure the element stays hidden
        const reason = hasProfessorChanged ? 'new professor (previous GPA not applicable)' : 'no valid GPA data';
        console.log(`GPA hidden for course ${course.course_code}: ${reason}`);
    }

    // Function to load course reviews
    async function loadCourseReviews(courseCode, academicYear, term) {
        try {
            // Build the query - if academicYear is null, get reviews from all years
            let query = supabase
                .from('course_reviews')
                .select('*')
                .eq('course_code', courseCode)
                .eq('term', term)
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
        const shouldClampText = hasWrittenContent && (rawContent.trim().length > 180 || rawContent.includes('\n'));
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
                        <p class="course-review-text-excerpt is-own-review${shouldClampText ? ' is-clamped' : ''}">${safeContent}</p>
                        ${shouldClampText ? '<button type="button" class="course-review-inline-action" data-action="review-show-more" aria-expanded="false">Show More</button>' : ''}
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
        const shouldClampText = hasWrittenContent && (rawContent.trim().length > 180 || rawContent.includes('\n'));
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
                        <p class="your-review-text course-review-text-excerpt${shouldClampText ? ' is-clamped' : ''}">${safeContent}</p>
                        ${shouldClampText ? '<button type="button" class="course-review-inline-action" data-action="your-review-show-more" aria-expanded="false">Read More</button>' : ''}
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

    // Load reviews for this course (from all years, just matching course code and term)
    const allReviews = await loadCourseReviews(course.course_code, null, course.term);
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

    classReview.classList.add('ds-card');
    if (!isMobileCourseInfo) {
        const desktopReviewCtaLabel = userReview ? 'Edit Review' : 'Write Review';
        const desktopReviewCtaIcon = userReview ? '<span class="pill-icon pill-icon--edit" aria-hidden="true"></span>' : '';
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
        classReview.innerHTML = `
            <div class="course-info-reviews-header">
                <div class="course-info-reviews-title">
                    <h3>Course Reviews</h3>
                    <p class="total-reviews">${stats.totalReviews} review${stats.totalReviews !== 1 ? 's' : ''}</p>
                </div>
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
        classAssignments.classList.add('ds-card');
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
            cleanupActiveCourseInfoTabController();
            if (classInfoBackground?.parentNode) {
                classInfoBackground.parentNode.removeChild(classInfoBackground);
                classInfoBackground = null;
            }
            unlockBodyScrollForCourseInfoSheet();
            window.location.href = url || buildCourseAssignmentsPageURL();
        };

        const renderAssignmentsEmptyState = (message, options = {}) => {
            classAssignments.classList.remove('course-assignments-guest-mode');
            setGuestAssignmentsModalOverlay(false);
            const showLink = options.showLink !== false;
            const linkText = options.linkText || 'Open assignments';
            const linkId = options.linkId || 'add-assignment-link';
            const targetHref = options.targetHref || buildCourseAssignmentsPageURL();

            classAssignments.style.display = 'block';
            classAssignments.innerHTML = `
                <div class="class-subtitle-assignments">
                    <p class="subtitle-opacity">Your Assignments</p>
                    ${showLink ? `
                        <a href="${targetHref}" class="add-assignment-link" id="${linkId}">${linkText}</a>
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
                    <p class="subtitle-opacity">Your Assignments</p>
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
                    classAssignments.classList.remove('course-assignments-guest-mode');
                    setGuestAssignmentsModalOverlay(false);
                    classAssignments.innerHTML = '';
                    classAssignments.style.display = 'none';
                    updateOverviewAssignmentsShortcut(0);
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
                                if (dueMeta.daysUntilDue === 0 && String(assignment?.status || '') !== 'completed') {
                                    return { text: 'Due today', class: 'status-due-today' };
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
                                    <p class="subtitle-opacity">Your Assignments</p>
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
                                linkText: 'Add an assignment'
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

        const panelMap = new Map([
            ['overview', overviewPanel],
            ['assignments', assignmentsPanel],
            ['reviews', reviewsPanel]
        ]);
        const tabsBodyScroller = classInfo.querySelector('.sheet-body') || classInfo.querySelector('.class-content-wrapper');
        let activeTab = requestedInitialTab;

        const applyCourseInfoTabState = (nextTab) => {
            const normalizedTab = normalizeCourseInfoTab(nextTab);
            activeTab = normalizedTab;
            classInfo.dataset.activeCourseInfoTab = normalizedTab;
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

        const switchCourseInfoTab = (nextTab, { persist = true, scrollTop = false, focusButton = false } = {}) => {
            const normalizedTab = normalizeCourseInfoTab(nextTab);
            applyCourseInfoTabState(normalizedTab);
            if (persist) {
                writeStoredCourseInfoTab(normalizedTab);
            }
            if (scrollTop && tabsBodyScroller) {
                tabsBodyScroller.scrollTop = 0;
            }
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

        const handleCourseInfoResize = () => {
            applyCourseInfoTabState(activeTab);
        };
        window.addEventListener('resize', handleCourseInfoResize);
        classInfo._mobileTabsResizeCleanup = () => {
            window.removeEventListener('resize', handleCourseInfoResize);
        };

        activeCourseInfoTabController = {
            setActiveTab: switchCourseInfoTab,
            cleanup: () => {
                window.removeEventListener('resize', handleCourseInfoResize);
                panelMap.forEach((panelEl) => {
                    panelEl.hidden = false;
                    panelEl.removeAttribute('aria-hidden');
                });
                if (tabsWrap.parentNode) {
                    tabsWrap.parentNode.removeChild(tabsWrap);
                }
                delete classInfo.dataset.activeCourseInfoTab;
            }
        };
        classInfo._courseInfoTabCleanup = () => {
            cleanupActiveCourseInfoTabController();
        };

        switchCourseInfoTab(requestedInitialTab, { persist: false });
    } else {
        courseInfoBody.querySelector('.course-info-mobile-tabs')?.remove();
        courseInfoContentRoot.replaceChildren(classContent, classGPA, classAssignments, classReview);
        releaseCourseInfoResizeObserver();
        cleanupActiveCourseInfoTabController();
        classInfo.classList.remove('courseinfo-guest-assignments-preview');
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

    const hideFooterForGuest = !session && !isDedicatedCoursePage;
    classInfo.classList.toggle('courseinfo-guest-hide-footer', hideFooterForGuest);

    courseInfoActions.innerHTML = hideFooterForGuest ? '' : `
        <div class="course-info-footer-layout">
            <div class="course-info-footer-secondary">
                <button type="button" class="btn-secondary" data-action="toggle-save-course">${isSavedForLater ? 'Unsave' : 'Save'}</button>
            </div>
            <div class="course-info-footer-primary">
                <button id="class-add-remove"></button>
            </div>
        </div>
    `;

    const saveToggleBtn = courseInfoActions.querySelector('[data-action="toggle-save-course"]');
    const footerLayout = courseInfoActions.querySelector('.course-info-footer-layout');
    const footerSecondary = footerLayout?.querySelector('.course-info-footer-secondary');
    updateFooterActionLayout = (isSelected) => {
        if (footerSecondary) {
            footerSecondary.hidden = !!isSelected;
        }
        if (footerLayout) {
            footerLayout.classList.toggle('is-primary-only', !!isSelected);
        }
        if (saveToggleBtn) {
            saveToggleBtn.textContent = isSavedForLater ? 'Unsave' : 'Save';
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
                saveToggleBtn.textContent = isSavedForLater ? 'Unsave' : 'Save';
                syncSavedStatusBadge();
                updateFooterActionLayout(isAlreadySelected);
            } catch (saveError) {
                console.error('Error toggling saved course:', saveError);
                alert('Unable to update saved course right now. Please try again.');
            } finally {
                saveToggleBtn.disabled = false;
            }
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
                const timeText = formatCourseTimeCompactLabel(firstConflict?.time_slot || course.time_slot);
                previewTarget.textContent = `Conflicts with ${timeText} course`;
                previewTarget.style.display = 'block';
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

        // Simple function to check if course is selected
        async function isCourseSelected(courseCode, year) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return false;

            const { data: profile } = await supabase
                .from('profiles')
                .select('courses_selection')
                .eq('id', session.user.id)
                .single();

            if (!profile?.courses_selection) return false;

            // Filter by current year and term, then check for the course
            const currentYearCourses = filterCoursesByCurrentYearTerm(profile.courses_selection);
            return currentYearCourses.some(selected => selected.code === courseCode);
        }

        // Simple function to update button appearance
        async function updateButton() {
            const isSelected = await isCourseSelected(course.course_code, course.academic_year);
            const canModify = isCurrentSemester();
            isAlreadySelected = isSelected;
            updateFooterActionLayout(isSelected);

            if (!canModify) {
                applyClassInfoCourseActionButtonState(newButton, 'locked');
            } else if (isSelected) {
                applyClassInfoCourseActionButtonState(newButton, 'remove');
            } else {
                applyClassInfoCourseActionButtonState(newButton, 'add');
            }
        }

        // Set initial button state
        await updateButton();

        // Add click handler
        newButton.addEventListener("click", async function (e) {
            e.preventDefault();

            // Check if we can modify courses for this semester
            if (!isCurrentSemester()) {
                alert('You can only add or remove courses for the current semester. Please switch to the current semester to make changes.');
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
                    alert('Please log in to manage courses.');
                }
                return;
            }

            try {
                // Get current profile
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('courses_selection')
                    .eq('id', session.user.id)
                    .single();

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
                        alert(
                            `Minimum limit: You must register for at least ${SEMESTER_MIN_CREDITS} credits per semester. ` +
                            `This change would leave you with ${formatCreditsValue(removalStats.totalCredits)} credits.`
                        );
                        return;
                    }

                    const { error } = await supabase
                        .from('profiles')
                        .update({ courses_selection: updatedSelection })
                        .eq('id', session.user.id);

                    if (error) {
                        console.error('Error removing course:', error);
                        alert('Failed to remove course. Please try again.');
                        return;
                    }

                    alert('Course removed successfully!');
                    // Update button state after successful removal
                    await updateCourseButtonState(course, newButton);
                } else {
                    // Check for conflicts first
                    console.log('Checking for conflicts for course:', course.course_code, 'time:', course.time_slot);
                    const conflictResult = await checkTimeConflictForModal(course.time_slot, course.course_code, course.academic_year);
                    console.log('Conflict result:', conflictResult);

                    if (conflictResult.hasConflict) {
                        console.log('Conflict detected, showing modal');
                        showTimeConflictModal(conflictResult.conflictingCourses, course, async (shouldReplace, conflictingCourses, actionType = 'dismiss') => {
                            if (shouldReplace) {
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
                                    alert(
                                        `Maximum limit: You can register for up to ${SEMESTER_MAX_CREDITS} credits per semester. ` +
                                        `This change would bring you to ${formatCreditsValue(replacementStats.totalCredits)} credits.`
                                    );
                                    return;
                                }

                                if (replacementStats.selectedCount > 0 && replacementStats.totalCredits < SEMESTER_MIN_CREDITS) {
                                    alert(
                                        `Minimum limit: You must register for at least ${SEMESTER_MIN_CREDITS} credits per semester. ` +
                                        `This change would leave you with ${formatCreditsValue(replacementStats.totalCredits)} credits.`
                                    );
                                    return;
                                }

                                const { error } = await supabase
                                    .from('profiles')
                                    .update({ courses_selection: updatedSelection })
                                    .eq('id', session.user.id);

                                if (error) {
                                    console.error('Error updating courses:', error);
                                    alert('Failed to update courses. Please try again.');
                                    return;
                                }

                                showCourseActionToast(`Replaced course in ${formatConflictSlotForToast(course.time_slot)}.`);
                                await updateButton();
                                // Also update the button state specifically
                                await updateCourseButtonState(course, newButton);
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
                        alert(
                            `Maximum limit: You can register for up to ${SEMESTER_MAX_CREDITS} credits per semester. ` +
                            `This change would bring you to ${formatCreditsValue(additionStats.totalCredits)} credits.`
                        );
                        return;
                    }

                    if (additionStats.selectedCount > 0 && additionStats.totalCredits < SEMESTER_MIN_CREDITS) {
                        alert(
                            `Minimum limit: You must register for at least ${SEMESTER_MIN_CREDITS} credits per semester. ` +
                            `This change would leave you with ${formatCreditsValue(additionStats.totalCredits)} credits.`
                        );
                        return;
                    }

                    const { error } = await supabase
                        .from('profiles')
                        .update({ courses_selection: updatedSelection })
                        .eq('id', session.user.id);

                    if (error) {
                        console.error('Error adding course:', error);
                        alert('Failed to add course. Please try again.');
                        return;
                    }

                    alert('Course added successfully!');
                }

                // Update button and refresh calendar
                await updateButton();
                // Also update the button state specifically
                await updateCourseButtonState(course, newButton);
                if (window.refreshCalendarComponent) {
                    window.refreshCalendarComponent();
                }

            } catch (error) {
                console.error('Error managing course:', error);
                alert('An error occurred. Please try again.');
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
        // Build the query - if academicYear is null, get reviews from all years
        let query = supabase
            .from('course_reviews')
            .select('*')
            .eq('course_code', courseCode)
            .eq('term', term)
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
            wrapper.className = 'review-form-custom-select profile-custom-select';
            wrapper.dataset.target = nativeSelect.id || '';

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'custom-select-trigger control-surface';
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');

            const valueEl = document.createElement('span');
            valueEl.className = 'custom-select-value';
            const arrowEl = document.createElement('span');
            arrowEl.className = 'custom-select-arrow';
            arrowEl.setAttribute('aria-hidden', 'true');
            trigger.append(valueEl, arrowEl);

            const optionsEl = document.createElement('div');
            optionsEl.className = 'custom-select-options';
            const optionsInnerEl = document.createElement('div');
            optionsInnerEl.className = 'custom-select-options-inner';
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
                optionEl.className = 'custom-select-option';
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
            <div class="review-form-row">
                <label for="review-content${suffix}">Written review</label>
                <textarea id="review-content${suffix}" class="review-form-textarea" maxlength="800" placeholder="Share your experience with this course...">${escapeHtml(content || '')}</textarea>
                <div class="review-char-count" data-role="review-char-count${suffix}">0/800</div>
                <div class="review-field-error" id="review-content-error${isEdit ? '-edit' : ''}" style="display:none;"></div>
            </div>
        </div>
    `;

    const footerHtml = `
        <button type="button" class="btn-secondary" data-action="cancel-review-form">Cancel</button>
        <button type="button" class="btn-primary ${isEdit ? 'update-review' : 'submit-review'}" data-action="${isEdit ? 'update-review-submit' : 'submit-review-submit'}" ${isEdit ? `data-review-id="${escapeHtml(reviewId || '')}"` : ''} data-course-code="${escapeHtml(courseCode || '')}" data-course-year="${escapeHtml(defaultYear || '')}" data-course-term="${escapeHtml(defaultTerm || '')}">${submitLabel}</button>
    `;

    const modalSession = openDsModal({
        title: modalTitle,
        subtitle: courseTitle || courseCode || '',
        bodyHtml,
        footerHtml,
        className: 'review-modal-host modal--dialog-mobile-sheet',
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
                const closeBtn = header?.querySelector('.modal-close-btn');
                if (header && closeBtn) {
                    let actions = header.querySelector('.modal-header-actions');
                    if (!actions) {
                        actions = document.createElement('div');
                        actions.className = 'modal-header-actions';
                        header.insertBefore(actions, closeBtn);
                        actions.appendChild(closeBtn);
                    }
                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'btn-destructive review-delete-btn review-delete-btn--header';
                    deleteBtn.dataset.action = 'delete-review';
                    deleteBtn.dataset.reviewId = String(reviewId || '');
                    deleteBtn.dataset.defaultText = 'Delete';
                    deleteBtn.setAttribute('aria-label', 'Delete review');
                    deleteBtn.textContent = 'Delete';
                    actions.insertBefore(deleteBtn, closeBtn);
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

            const modalDialog = modal.querySelector('.modal-dialog');
            if (isCourseInfoMobileViewport() && modalDialog && typeof window.addSwipeToCloseSimple === 'function') {
                window.addSwipeToCloseSimple(modalDialog, modal, () => {
                    modal.__requestClose?.();
                });
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
                alert('Please log in to write a review.');
            }
            return;
        }

        ensureCourseInfoReviewsTabActive({ scrollTop: true });

        // Check if user has already reviewed this course (same code and term, any year)
        const { data: existingReviews, error } = await supabase
            .from('course_reviews')
            .select('*')
            .eq('user_id', session.user.id)
            .eq('course_code', courseCode)
            .eq('term', term);

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
        alert('Error opening review form. Please try again.');
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
            alert('Please log in to edit your review.');
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
        alert('Error opening edit form. Please try again.');
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
            alert('Please log in to update your review.');
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
            alert('Please select a quality rating.');
            return;
        }
        if (!difficultyRating) {
            alert('Please select a difficulty rating.');
            return;
        }

        if (!selectedYear) {
            alert('Please select the year when you took this course.');
            return;
        }
        if (!selectedTerm) {
            alert('Please select the term when you took this course.');
            return;
        }
        if (content.length > 800) {
            alert('Review is too long. Please keep it under 800 characters.');
            return;
        }

        const updateBtn = document.querySelector('.update-review, [data-action="update-review-submit"]');
        updateBtn.disabled = true;
        updateBtn.textContent = 'Saving...';

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
            alert('Error updating review. Please try again.');
            updateBtn.disabled = false;
            updateBtn.textContent = 'Save changes';
            return;
        }

        alert('Review updated successfully!');
        closeReviewModal();

        // Reload the page to show updated review
        window.location.reload();

    } catch (error) {
        console.error('Error updating review:', error);
        alert('Error updating review. Please try again.');
    }
};

// Global function to delete review
window.deleteReview = async function (reviewId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            alert('Please log in to delete your review.');
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
            alert('Error deleting review. Please try again.');
            deleteBtn.disabled = false;
            deleteBtn.textContent = deleteBtnDefaultText;
            return;
        }

        alert('Review deleted successfully!');
        closeReviewModal();

        // Reload the page to show updated reviews
        window.location.reload();

    } catch (error) {
        console.error('Error deleting review:', error);
        alert('Error deleting review. Please try again.');
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
                alert('Please log in to submit a review.');
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
            alert('Please select the term when you took this course.');
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
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

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
            alert('Error submitting review. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit review';
            return;
        }

        alert('Review submitted successfully!');
        closeReviewModal();

        // Refresh the course info to show updated reviews
        // You might want to reload the modal content here

    } catch (error) {
        console.error('Error submitting review:', error);
        alert('Error submitting review. Please try again.');
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
                .select('course_code, title, time_slot, professor, academic_year, term, type, credits')
                .in('course_code', selectedCourseCodes)
                .eq('academic_year', currentYear)
                .eq('term', currentTerm);

            console.log('Fetched courses data:', coursesData);
            console.log('Looking for conflicts with new course:', courseCode, 'with time slot:', timeSlot);

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

    // Final fallback to current year
    return new Date().getFullYear();
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

    // Final fallback to current term logic
    const currentMonth = new Date().getMonth() + 1;
    return currentMonth >= 8 || currentMonth <= 2 ? 'Fall' : 'Spring';
}

// Check if the currently selected year/term is the current semester
function isCurrentSemester() {
    const selectedYear = getCurrentYear();
    const selectedTerm = getCurrentTerm();

    // Normalize selectedTerm (handle both "Fall" and "秋学期/Fall" formats)
    const normalizedSelectedTerm = selectedTerm.includes('/') ? selectedTerm.split('/')[1] : selectedTerm;

    const today = new Date();

    // Calculate semester start and end dates
    let semesterStart, semesterEnd;

    if (normalizedSelectedTerm === 'Spring') {
        // Spring: April 1 - July 31
        semesterStart = new Date(selectedYear, 3, 1); // April 1 (month is 0-indexed)
        semesterEnd = new Date(selectedYear, 6, 31, 23, 59, 59); // July 31
    } else {
        // Fall: October 1 - January 31 (next year)
        semesterStart = new Date(selectedYear, 9, 1); // October 1
        semesterEnd = new Date(selectedYear + 1, 1, 28, 23, 59, 59); // January 31 next year
    }

    // Check if today is within the semester date range
    return today >= semesterStart && today <= semesterEnd;
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
window.filterCoursesByCurrentYearTerm = filterCoursesByCurrentYearTerm;

// Function to show time conflict modal (similar to search modal)
export function showTimeConflictModal(conflictingCourses, newCourse, onResolve) {
    // Remove any existing conflict modal
    const existingModal = document.querySelector('.conflict-container');
    if (existingModal) {
        existingModal.remove();
    }
    document.body.classList.remove('modal-open');
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const safeConflictingCourses = Array.isArray(conflictingCourses) ? conflictingCourses : [];

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
        const normalized = getRomanizedProfessorName(courseEntry?.professor || 'TBA');
        return toDisplayText(normalized || 'TBA', 'TBA');
    };

    const toDisplayCredits = (courseEntry) => {
        const raw = courseEntry?.credits;
        if (raw === null || raw === undefined || raw === '') {
            return `<span class="conflict-empty-value">Not listed</span>`;
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

    const toDisplayTerm = (courseEntry) => {
        const term = String(courseEntry?.term || '').trim();
        const year = String(courseEntry?.academic_year || '').trim();
        if (term && year) return `${escapeHtml(term)} ${escapeHtml(year)}`;
        if (term) return escapeHtml(term);
        if (year) return escapeHtml(year);
        return '<span class="conflict-empty-value">Current semester</span>';
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

    const buildCourseCardMarkup = (courseEntry, badge, modifierClass) => {
        const accentHex = toHexColor(getCourseColorByType(courseEntry?.type));
        const accentBorder = hexToRgba(accentHex, 0.38);
        return `
        <article class="conflict-course-card ${modifierClass}" style="--conflict-card-accent: ${accentHex}; --conflict-card-border: ${accentBorder};">
            <div class="conflict-course-card-header">
                <h4>${toDisplayTitle(courseEntry)}</h4>
                <span class="conflict-course-card-badge">${escapeHtml(badge)}</span>
            </div>
            <dl class="conflict-course-card-meta">
                <div class="conflict-course-card-meta-row conflict-course-card-meta-row--time conflict-meta-primary">
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
                    <div class="conflict-course-card-meta-row conflict-meta-secondary">
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

    // Create modal container
    const modalContainer = document.createElement('div');
    modalContainer.className = 'conflict-container hidden';

    modalContainer.innerHTML = `
        <div class="conflict-backdrop">
            <div class="conflict-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-modal-title">
                <div class="conflict-modal-head">
                    <h2 class="conflict-modal-title" id="conflict-modal-title">
                        <span class="conflict-modal-heading-icon" aria-hidden="true"></span>
                        Schedule Conflict
                    </h2>
                    <button class="assignment-modal-close conflict-modal-close" type="button" aria-label="Close conflict modal"></button>
                </div>
                <div class="conflict-content">
                    <p class="conflict-intro">This course conflicts with a course you already registered for.
                    </p>
                    <div class="conflict-comparison-grid">
                        <section class="conflict-comparison-column">
                            <h3 class="conflict-column-title">Currently registered</h3>
                            <div class="conflict-course-stack">
                                ${safeConflictingCourses.length
            ? safeConflictingCourses
                .map((courseEntry) => buildCourseCardMarkup(courseEntry, 'Registered', 'conflict-course-card--existing'))
                .join('')
            : '<p class="conflict-empty">No registered course details found.</p>'}
                            </div>
                        </section>
                        <section class="conflict-comparison-column">
                            <h3 class="conflict-column-title">New selection</h3>
                            <div class="conflict-course-stack">
                                ${buildCourseCardMarkup(newCourse || {}, 'Selected', 'conflict-course-card--new')}
                            </div>
                        </section>
                    </div>
                    <div class="conflict-question">
                        <p>Choose what to keep for this time slot.</p>
                    </div>
                </div>
                <div class="conflict-actions">
                    <button class="conflict-cancel" type="button">Keep Registered Course</button>
                    <button class="conflict-replace" type="button">Replace & Register</button>
                </div>
            </div>
        </div>
    `;

    // Add to body
    document.body.appendChild(modalContainer);
    document.body.classList.add('modal-open');

    // Add event listeners
    const cancelBtn = modalContainer.querySelector('.conflict-cancel');
    const replaceBtn = modalContainer.querySelector('.conflict-replace');
    const closeBtn = modalContainer.querySelector('.conflict-modal-close');
    const background = modalContainer.querySelector('.conflict-backdrop');
    const detailsToggleButtons = modalContainer.querySelectorAll('.conflict-more-details');
    let resolved = false;

    const handleEscape = (event) => {
        if (event.key === 'Escape') {
            resolveConflict(false, 'dismiss');
        }
    };

    function closeModal() {
        modalContainer.classList.remove('show');
        modalContainer.classList.add('hidden');
        document.body.classList.remove('modal-open');
        setTimeout(() => {
            modalContainer.remove();
            if (previousFocusedElement && typeof previousFocusedElement.focus === 'function') {
                previousFocusedElement.focus();
            }
        }, 300);
    }

    function resolveConflict(shouldReplace, actionType = 'dismiss') {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', handleEscape);
        closeModal();
        if (onResolve) {
            onResolve(Boolean(shouldReplace), safeConflictingCourses, actionType);
        }
    }

    cancelBtn.addEventListener('click', () => resolveConflict(false, 'keep'));
    replaceBtn.addEventListener('click', () => resolveConflict(true, 'replace'));
    if (closeBtn) {
        closeBtn.addEventListener('click', () => resolveConflict(false, 'dismiss'));
    }
    detailsToggleButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const parentCard = button.closest('.conflict-course-card');
            if (!parentCard) return;

            const isExpanded = parentCard.classList.toggle('is-expanded');
            button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            button.textContent = isExpanded ? 'Hide details' : 'More details';
        });
    });
    background.addEventListener('click', (e) => {
        if (e.target === background) {
            resolveConflict(false, 'dismiss');
        }
    });
    document.addEventListener('keydown', handleEscape);

    requestAnimationFrame(() => {
        modalContainer.classList.remove('hidden');
        if (closeBtn) {
            closeBtn.focus();
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
        if (pointerId !== null) {
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

    function handlePointerDown(event) {
        if (isDestroyed || closing) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;
        if (event.button !== undefined && event.button !== 0) return;

        const dragTarget = resolveDragTarget(event.target);
        if (!dragTarget) return;

        pointerId = event.pointerId;
        dragFromBody = !!dragTarget.fromBody;
        dragging = false;
        startX = event.clientX;
        startY = event.clientY;
        startSheetY = currentY;
        moveSamples = [{ y: startY, t: performance.now() }];
        modal.setPointerCapture?.(pointerId);
    }

    function handlePointerMove(event) {
        if (isDestroyed || pointerId === null || event.pointerId !== pointerId) return;
        if (!isCourseInfoMobileViewport() || modal.classList.contains('course-fullscreen')) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const bodyScroller = modal.querySelector('.courseinfo-body');

        if (!dragging) {
            if (absDeltaY < SWIPE_START_THRESHOLD) return;
            if (absDeltaY < absDeltaX * SWIPE_AXIS_LOCK_RATIO) {
                resetDragState();
                return;
            }

            if (dragFromBody) {
                if (!bodyScroller || bodyScroller.scrollTop > 1) {
                    resetDragState();
                    return;
                }
            }

            dragging = true;
            modal.classList.add('is-dragging');
            modal.classList.remove('is-snapping');
            clearSnapTimer();
        }

        if (dragFromBody && bodyScroller && bodyScroller.scrollTop > 1 && deltaY > 0) {
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
        modal.releasePointerCapture?.(pointerId);
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
            applySheetY(pendingY);
        }
        finalizeDrag();
    }

    function handlePointerCancel(event) {
        if (isDestroyed || pointerId === null || event.pointerId !== pointerId) return;
        modal.releasePointerCapture?.(pointerId);
        if (dragging) {
            snapTo(findNearestState(currentY, getMetrics()), { animate: true });
        }
        resetDragState();
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
    let closing = false;
    let settleTimer = null;
    let closeTimer = null;

    const velocityThreshold = 0.55;
    const closeDistance = () => Math.min(230, Math.max(96, window.innerHeight * 0.16));

    function getScrollableElement() {
        return modal.querySelector('.filter-content') ||
            modal.querySelector('.profile-modal-body') ||
            modal.querySelector('.class-content-wrapper') ||
            modal;
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

        startX = point.clientX;
        startY = point.clientY;
        currentY = startY;
        startTime = Date.now();
        dragging = false;
        axisLocked = false;
        cancelled = false;
        clearTimers();
        modal.style.transition = '';
        background.style.transition = '';
    }

    function handleTouchMove(event) {
        if (!isMobileSheet() || closing || cancelled) return;

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
    }

    function handleTouchCancel() {
        if (!isMobileSheet() || closing) return;

        if (dragging) {
            animateBackOpen();
        }

        dragging = false;
        axisLocked = false;
        cancelled = false;
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
