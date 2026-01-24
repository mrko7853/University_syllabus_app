import { supabase } from "/supabase.js";
import { fetchCourseData, getCourseColorByType } from '/js/shared.js';
import { openCourseInfoMenu, initializeCourseRouting, checkTimeConflict, showTimeConflictModal } from '/js/shared.js';
import * as wanakana from 'wanakana';

// Import components to ensure web components are defined
import '/js/components.js';

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

// Additional mobile-specific viewport handling
if (window.innerWidth <= 780) {
    // Handle virtual keyboard appearance/disappearance
    let initialViewportHeight = window.innerHeight;
    
    window.addEventListener('resize', () => {
        const currentHeight = window.innerHeight;
        const heightDifference = initialViewportHeight - currentHeight;
        
        // If height difference is significant (likely keyboard), maintain app positioning
        if (heightDifference > 150) {
            // Virtual keyboard is probably visible
            document.body.classList.add('keyboard-visible');
        } else {
            // Virtual keyboard is probably hidden
            document.body.classList.remove('keyboard-visible');
            setTimeout(setViewportHeight, 100); // Recalculate after keyboard hides
        }
    });
    
    // Force proper positioning on focus/blur of input elements
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, textarea, select')) {
            setTimeout(() => {
                // Ensure navigation stays at bottom during keyboard interaction
                const nav = document.querySelector('app-navigation');
                if (nav) {
                    nav.style.position = 'fixed';
                    nav.style.bottom = '0';
                    nav.style.transform = 'translateZ(0)';
                }
            }, 100);
        }
    });
    
    document.addEventListener('focusout', (e) => {
        if (e.target.matches('input, textarea, select')) {
            setTimeout(() => {
                setViewportHeight();
                // Reset navigation positioning
                const nav = document.querySelector('app-navigation');
                if (nav) {
                    nav.style.bottom = 'env(safe-area-inset-bottom, 0)';
                }
            }, 300);
        }
    });
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
    '鈴木': 'Suzuki', '鈴': 'Suzu', '木': 'Ki',
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
    return romanizedProfessorCache.get(name) || romanizeProfessorName(name);
}

// Helper function to normalize course titles
function normalizeCourseTitle(title) {
    if (!title) return title;
    
    // Convert full-width characters to normal characters
    let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(char) {
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

// Global sorting state
let currentSortMethod = null;

// Global search state
let currentSearchQuery = null;
let suggestionsDisplayed = false; // Track if suggestions are currently shown

// Global course loading state management
let isLoadingCourses = false;
let courseLoadRetryCount = 0;
let lastLoadedCourses = null; // Cache the last loaded courses data
let lastLoadedYear = null;
let lastLoadedTerm = null;
const MAX_COURSE_LOAD_RETRIES = 3;

async function showCourse(year, term) {
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
        renderCourses(lastLoadedCourses, courseList, year, term);
        return;
    }
    
    // If already loading the same year/term, wait for it then render
    if (isLoadingCourses && lastLoadedYear === year && lastLoadedTerm === term) {
        console.log('Waiting for in-progress course load to complete');
        // Wait a bit for the loading to complete, then check again
        await new Promise(resolve => setTimeout(resolve, 100));
        if (lastLoadedCourses && lastLoadedYear === year && lastLoadedTerm === term) {
            renderCourses(lastLoadedCourses, courseList, year, term);
        }
        return;
    }
    
    try {
        const courses = await fetchCourseDataWithRetry(year, term);
        if (!courses || courses.length === 0) {
            console.warn('No courses returned');
            courseList.innerHTML = `
                <div class="course-error-state">
                    <div>
                        <p>No courses found for ${term} ${year}</p>
                    </div>
                </div>
            `;
            return;
        }
        
        courses.sort((a, b) => normalizeCourseTitle(a.title).localeCompare(normalizeCourseTitle(b.title)));
        
        // Pre-romanize all professor names
        preromanizeCourseData(courses);
        
        // Cache the loaded courses
        lastLoadedCourses = courses;
        lastLoadedYear = year;
        lastLoadedTerm = term;
        
        // Re-get courseList in case DOM changed during fetch
        const currentCourseList = document.getElementById("course-list");
        if (currentCourseList) {
            renderCourses(courses, currentCourseList, year, term);
        }
    } catch (error) {
        console.error('Failed to load courses after all retries:', error);
        showCourseLoadError();
    }
}

// Separate function to render courses to the DOM
function renderCourses(courses, courseList, year, term) {
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
    
    let courseHTML = "";
    courses.forEach(function(course) {
        // Match both full and short Japanese formats: (月曜日1講時) or (木4講時)
        const match = course.time_slot.match(/\(?([月火水木金土日](?:曜日)?)([1-5](?:講時)?)\)?/);
        const specialMatch = course.time_slot.match(/(月曜日3講時・木曜日3講時)/);
        
        let displayTimeSlot = course.time_slot;
        if (specialMatch) {
            displayTimeSlot = "Mon 13:10 - 14:40<br>Thu 13:10 - 14:40";
        } else if (match) {
            displayTimeSlot = `${days[match[1]]} ${times[match[2]]}`;
        }

        // Get color based on course type
        const courseColor = getCourseColorByType(course.type);

        courseHTML += `
        <div class="class-outside" id="${displayTimeSlot}" data-color='${courseColor}'>
            <div class="class-container" style="background-color: ${courseColor}" data-course='${JSON.stringify(course)}'>
                <p id="course-code">${course.course_code}</p>
                <h2 id="course-title">${normalizeCourseTitle(course.title)}</h2>
                <p id="course-professor-small">Professor</p>
                <h3 id="course-professor"><div class="course-professor-icon"></div>${getRomanizedProfessorName(course.professor)}</h3>
                <div class="class-space"></div>
                <p id="course-time-small">Time</p>
                <h3 id="course-time"><div class="course-time-icon"></div>${displayTimeSlot}</h3>
            </div>
            <!-- Mobile GPA bar outside class-container -->
            <div class="gpa-bar-mobile ${course.gpa_a_percent === null ? "gpa-null" : ""}">
                <div class="gpa-fill-mobile" style="width: ${course.gpa_a_percent !== null ? course.gpa_a_percent : 20}%"><p>A</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_b_percent !== null ? course.gpa_b_percent : 20}%"><p>B</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_c_percent !== null ? course.gpa_c_percent : 20}%"><p>C</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_d_percent !== null ? course.gpa_d_percent : 20}%"><p>D</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_f_percent !== null ? course.gpa_f_percent : 20}%"><p>F</p></div>
            </div>
            <!-- Desktop GPA bar outside class-container -->
            <div class="gpa-bar gpa-bar-desktop ${course.gpa_a_percent === null ? "gpa-null" : ""}">
                <div class="gpa-fill"><p>A ${course.gpa_a_percent}%</p></div>
                <div class="gpa-fill"><p>B ${course.gpa_b_percent}%</p></div>
                <div class="gpa-fill"><p>C ${course.gpa_c_percent}%</p></div>
                <div class="gpa-fill"><p>D ${course.gpa_d_percent}%</p></div>
                <div class="gpa-fill"><p>F ${course.gpa_f_percent}%</p></div>
            </div>
        </div>
        `;
    });
    
    courseList.innerHTML = courseHTML;
    
    // Remove loading class to restore normal margin
    courseList.classList.remove('loading');
    
    // Reset suggestions flag when courses are reloaded
    suggestionsDisplayed = false;
    
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
                <p style="visibility: hidden; margin: 5px 0;">12001104-003</p>
                <h2 style="visibility: hidden; margin: 5px 0 40px 0;">Academic Writing</h2>
                <p style="visibility: hidden; margin: 5px 0;">Professor</p>
                <h3 style="visibility: hidden; margin: 5px 0;">MICHAEL GRECO</h3>
                <div style="margin: 40px 0;"></div>
                <p style="visibility: hidden; margin: 5px 0;">Time</p>
                <h3 style="visibility: hidden; margin: 5px 0;">Thu 14:55 - 16:25</h3>
            </div>
            <div class="skeleton-gpa-bar">
                <div class="skeleton-gpa-section"></div>
                <div class="skeleton-gpa-section"></div>
                <div class="skeleton-gpa-section"></div>
                <div class="skeleton-gpa-section"></div>
                <div class="skeleton-gpa-section"></div>
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
window.retryLoadCourses = function() {
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");
    if (yearSelect && termSelect) {
        const year = yearSelect.value;
        const term = termSelect.value;
        showCourse(year, term);
    }
};

// Helper function to convert course time slot to container ID format
function convertTimeSlotToContainerFormat(timeSlot) {
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
    
    // Match both full and short Japanese formats: (月曜日1講時) or (木4講時)
    const match = timeSlot.match(/\(?([月火水木金土日](?:曜日)?)([1-5](?:講時)?)\)?/);
    const specialMatch = timeSlot.match(/(月曜日3講時・木曜日3講時)/);
    
    if (specialMatch) {
        return "Mon 13:10 - 14:40"; // Just return the first occurrence for filter matching
    } else if (match) {
        return `${days[match[1]]} ${times[match[2]]}`;
    }
    return timeSlot; // Return as-is if no match
}

// Helper function to check if a container matches current filters
function containerMatchesFilters(container) {
    // Get filter elements dynamically
    const filterByDays = document.getElementById("filter-by-days");
    const filterByTime = document.getElementById("filter-by-time");  
    const filterByConcentration = document.getElementById("filter-by-concentration");
    
    if (!filterByDays || !filterByTime || !filterByConcentration) {
        // Filter elements not found, show all courses
        return true;
    }
    
    // Days filter
    const dayCheckboxes = filterByDays.querySelectorAll(".filter-checkbox");
    const selectedDays = Array.from(dayCheckboxes)
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.value);

    // Time filter
    const timeCheckboxes = filterByTime.querySelectorAll(".filter-checkbox");
    const selectedTimes = Array.from(timeCheckboxes)
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.value);

    // Concentration filter
    const concCheckboxes = filterByConcentration.querySelectorAll(".filter-checkbox");
    const selectedConcentrations = Array.from(concCheckboxes)
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.value);

    // Day logic
    const timeSlot = container.id;
    const day = timeSlot ? timeSlot.split(" ")[0] : '';

    // Time logic
    const time = timeSlot ? timeSlot.split(" ")[1] : '';

    // Check if matches day filter
    const dayMatch = selectedDays.length === 0 || selectedDays.includes(day);

    // Check if matches time filter
    const timeMatch = selectedTimes.length === 0 || selectedTimes.includes(time);

    // Concentration/Type filter - if no filters selected, show all courses
    const concMatch = selectedConcentrations.length === 0;

    return dayMatch && timeMatch && concMatch;
}

function applyFilters() {
    // Use the unified search and filter function
    return applySearchAndFilters(currentSearchQuery);
}

// Unified function that applies both search and filter criteria
async function applySearchAndFilters(searchQuery) {
    // Don't apply filters while courses are still loading
    if (isLoadingCourses) {
        console.log('Skipping filter application - courses still loading');
        return;
    }
    
    // Get courseList element dynamically
    const courseList = document.getElementById("course-list");
    if (!courseList) return;
    
    // Get yearSelect and termSelect dynamically
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");
    if (!yearSelect || !termSelect) return;
    
    // If suggestions are currently displayed, reload the courses first
    if (suggestionsDisplayed) {
        await showCourse(yearSelect.value, termSelect.value);
        suggestionsDisplayed = false;
        
        // Re-apply current sort if one is selected
        if (currentSortMethod) {
            sortCourses(currentSortMethod);
        }
    }
    
    const classContainers = courseList.querySelectorAll(".class-outside");
    
    // If no course containers exist yet, don't show "no results" message
    // This can happen during initial load or race conditions
    if (classContainers.length === 0) {
        console.log('No course containers found - skipping filter application');
        return;
    }
    
    let hasResults = false;
    
    // Remove any existing no-results message
    const existingNoResults = courseList.querySelector(".no-results");
    if (existingNoResults) existingNoResults.remove();
    
    classContainers.forEach(container => {
        let shouldShow = true;
        
        // First check if it matches current filters
        const filterMatches = containerMatchesFilters(container);
        
        // If there's an active search query, also check search criteria
        if (searchQuery && searchQuery.trim()) {
            const courseData = JSON.parse(container.querySelector('.class-container').dataset.course);
            
            const title = normalizeCourseTitle(courseData.title || '').toLowerCase();
            const professorOriginal = (courseData.professor || '').toLowerCase();
            const professorRomanized = romanizeProfessorName(courseData.professor || '').toLowerCase();
            const courseCode = (courseData.course_code || '').toLowerCase();
            const query = searchQuery.toLowerCase().trim();
            
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
    
    // Handle no results case
    if (!hasResults) {
        if (searchQuery && searchQuery.trim()) {
            // If we have a search query but no results, show suggestions from filtered courses
            if (allCourses && allCourses.length > 0) {
                const filteredCourses = allCourses.filter(course => {
                    const convertedTimeSlot = convertTimeSlotToContainerFormat(course.time_slot);
                    const tempContainer = {
                        id: convertedTimeSlot,
                        dataset: { color: getCourseColorByType(course.type) }
                    };
                    return containerMatchesFilters(tempContainer);
                });
                
                const similarCoursesWithRelevance = findSimilarCourses(searchQuery, filteredCourses, 8);
                displaySuggestedCourses(similarCoursesWithRelevance, searchQuery);
                suggestionsDisplayed = true;
            } else {
                // Show simple no results message if allCourses not available
                let noResults = courseList.querySelector(".no-results");
                if (!noResults) {
                    noResults = document.createElement("p");
                    noResults.className = "no-results";
                    noResults.textContent = `No courses found for "${searchQuery}".`;
                    courseList.appendChild(noResults);
                } else {
                    noResults.textContent = `No courses found for "${searchQuery}".`;
                    noResults.style.display = "block";
                }
            }
        } else {
            // No search query, just show standard no results message
            let noResults = courseList.querySelector(".no-results");
            if (!noResults) {
                noResults = document.createElement("p");
                noResults.className = "no-results";
                noResults.textContent = "No courses found for the selected filters.";
                noResults.style.display = "none";
                courseList.appendChild(noResults);
            }
            noResults.style.display = "block";
        }
    }
    
    // Update the course filter paragraph after applying filters
    updateCourseFilterParagraph();
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
        
        await showCourse(yearSelect.value, termSelect.value);
        
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

// Set up course list click event listener dynamically
function setupCourseListClickListener() {
    const courseList = document.getElementById("course-list");
    if (courseList) {
        courseList.addEventListener("click", function(event) {
            const clickedContainer = event.target.closest(".class-container");
            if (clickedContainer) {
                // Parse the course data and open the shared menu
                const courseData = JSON.parse(clickedContainer.dataset.course);
                openCourseInfoMenu(courseData);
            }
        });
    }
}

// Initialize the application
// Initialize courses with robust loading
(async function initializeCourses() {
    try {
        console.log('Initializing course loading...');
        
        // Ensure DOM is ready
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });
        }
        
        // Additional delay to ensure all components and custom elements are mounted
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Find elements dynamically  
        let yearSelect = document.getElementById("year-select");
        let termSelect = document.getElementById("term-select");
        let courseList = document.getElementById("course-list");
        
        // Check if required elements exist
        if (!yearSelect || !termSelect || !courseList) {
            console.error('Required DOM elements not found on first try:', {
                yearSelect: !!yearSelect,
                termSelect: !!termSelect, 
                courseList: !!courseList
            });
            
            // Try to find them again with a longer delay
            await new Promise(resolve => setTimeout(resolve, 500));
            yearSelect = document.getElementById("year-select");
            termSelect = document.getElementById("term-select");
            courseList = document.getElementById("course-list");
            
            console.log('Second element search:', {
                yearSelect: !!yearSelect,
                termSelect: !!termSelect,
                courseList: !!courseList
            });
            
            if (!yearSelect || !termSelect || !courseList) {
                throw new Error('Critical DOM elements missing after retry');
            }
        }
        
        const default_year = yearSelect.value || "2025";
        const default_term = termSelect.value || "Fall";
        
        console.log('Loading courses for:', { year: default_year, term: default_term });
        
        await showCourse(default_year, default_term);
        console.log('Initial course loading completed successfully');
        
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

// Function to set up all dashboard event listeners
function setupDashboardEventListeners() {
    // Set up event listeners dynamically
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");

    if (yearSelect && termSelect) {
        yearSelect.addEventListener("change", updateCoursesAndFilters);
        termSelect.addEventListener("change", updateCoursesAndFilters);
    }
    
    // Set up button event listeners
    const filterBtn = document.getElementById("filter-btn");
    const filterContainer = document.querySelector(".filter-container");
    const filterBackground = document.querySelector(".filter-background");
    const searchBtn = document.getElementById("search-btn");
    const searchContainer = document.querySelector(".search-container");
    const searchBackground = document.querySelector(".search-background");
    const searchModal = document.querySelector(".search-modal");
    const sortBtn = document.getElementById("sort-btn");
    const sortDropdown = document.getElementById("sort-dropdown");
    
    // Sort button click handler
    if (sortBtn && filterContainer) {
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
    
    // Sort option selection
    if (sortDropdown && sortBtn) {
        sortDropdown.addEventListener("click", (event) => {
            const option = event.target.closest('.sort-option');
            if (!option) return;
            
            const sortMethod = option.dataset.sort;
            
            // Update selected state
            sortDropdown.querySelectorAll('.sort-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            
            // Apply sorting
            currentSortMethod = sortMethod;
            sortCourses(sortMethod);
            
            // Close dropdown
            const sortWrapper = sortBtn.closest('.sort-wrapper');
            sortWrapper.classList.remove("open");
        });
    }
    
    // Filter button click handler
    if (filterBtn && filterContainer) {
        filterBtn.addEventListener("click", () => {
            const filterPopup = filterContainer.querySelector('.filter-popup');
            
            if (filterContainer.classList.contains("hidden")) {
                filterContainer.classList.remove("hidden");
                
                if (window.innerWidth <= 780) {
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
        
        // Close filter modal when clicking outside
        filterBackground.addEventListener("click", (event) => {
            if (event.target === filterBackground) {
                if (window.innerWidth <= 780) {
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
            if (window.innerWidth <= 780) {
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
            
            // Clear search input and search state
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = "";
            }
            
            // Clear global search state
            currentSearchQuery = null;
            
            // Update course filter paragraph to show default text
            updateCourseFilterParagraph();
            
            // Apply filters (this will show all courses since no filters are active and search is cleared)
            await applySearchAndFilters();
        });
    }
    
    // Search button and modal setup
    if (searchBtn && searchContainer && searchModal) {
        searchBtn.addEventListener("click", async () => {
            if (searchContainer.classList.contains("hidden")) {
                searchContainer.classList.remove("hidden");
                
                if (window.innerWidth <= 780) {
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
        
        // Set up additional search event listeners
        const searchSubmit = document.getElementById('search-submit');
        const searchCancel = document.getElementById('search-cancel');
        const searchInput = document.getElementById('search-input');
        const searchAutocomplete = document.getElementById('search-autocomplete');
        
        if (searchSubmit) {
            searchSubmit.addEventListener("click", async () => {
                const searchQuery = searchInput ? searchInput.value : '';
                await performSearch(searchQuery);
                
                if (window.innerWidth <= 780) {
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
                if (window.innerWidth <= 780) {
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
                    if (window.innerWidth <= 780) {
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
    
    // Initialize custom select dropdowns and filter checkboxes
    initializeCustomSelects();
    initializeFilterCheckboxes();
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
    searchInput.addEventListener("keydown", (event) => {
        if (searchAutocomplete.style.display === 'block' && 
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            handleAutocompleteNavigation(event, searchAutocomplete);
        } else if (event.key === "Enter") {
            event.preventDefault();
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

// Function to initialize custom select dropdowns
function initializeCustomSelects() {
    const customSelects = document.querySelectorAll('.custom-select');
    
    customSelects.forEach(customSelect => {
        const trigger = customSelect.querySelector('.custom-select-trigger');
        const options = customSelect.querySelector('.custom-select-options');
        const targetSelectId = customSelect.dataset.target;
        const targetSelect = document.getElementById(targetSelectId);
        
        if (!trigger || !options || !targetSelect) return;
        
        // Click handler for opening/closing dropdown
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close other custom selects
            customSelects.forEach(otherSelect => {
                if (otherSelect !== customSelect) {
                    otherSelect.classList.remove('open');
                }
            });
            
            customSelect.classList.toggle('open');
        });
        
        // Option selection handler
        options.addEventListener('click', (e) => {
            const option = e.target.closest('.custom-select-option');
            if (!option) return;
            
            const value = option.dataset.value;
            const text = option.textContent;
            
            // Update visual state
            options.querySelectorAll('.custom-select-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            
            // Update trigger text
            const valueElement = trigger.querySelector('.custom-select-value');
            if (valueElement) valueElement.textContent = text;
            
            // Update actual select
            targetSelect.value = value;
            
            // Trigger change event
            targetSelect.dispatchEvent(new Event('change'));
            
            // Close dropdown
            customSelect.classList.remove('open');
        });
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        customSelects.forEach(customSelect => {
            customSelect.classList.remove('open');
        });
    });
}

// Function to initialize filter checkboxes
function initializeFilterCheckboxes() {
    const filterCheckboxes = document.querySelectorAll('.filter-checkbox');
    
    filterCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', async () => {
            // Apply filters when any checkbox changes
            await applySearchAndFilters();
        });
    });
}

document.addEventListener("DOMContentLoaded", async function () {
    // Set up event listeners dynamically
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");

    if (yearSelect && termSelect) {
        yearSelect.addEventListener("change", updateCoursesAndFilters);
        termSelect.addEventListener("change", updateCoursesAndFilters);
    }
    
    // Set up button event listeners
    const filterBtn = document.getElementById("filter-btn");
    const filterContainer = document.querySelector(".filter-container");
    const filterBackground = document.querySelector(".filter-background");
    const searchBtn = document.getElementById("search-btn");
    const searchContainer = document.querySelector(".search-container");
    const searchBackground = document.querySelector(".search-background");
    const searchModal = document.querySelector(".search-modal");
    const sortBtn = document.getElementById("sort-btn");
    const sortDropdown = document.getElementById("sort-dropdown");
    
    // Sort button click handler
    if (sortBtn && filterContainer) {
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
    
    // Sort option selection
    if (sortDropdown && sortBtn) {
        sortDropdown.addEventListener("click", (event) => {
            const option = event.target.closest('.sort-option');
            if (!option) return;
            
            const sortMethod = option.dataset.sort;
            
            // Update selected state
            sortDropdown.querySelectorAll('.sort-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            
            // Apply sorting
            currentSortMethod = sortMethod;
            sortCourses(sortMethod);
            
            // Close dropdown
            const sortWrapper = sortBtn.closest('.sort-wrapper');
            sortWrapper.classList.remove("open");
        });
    }
    
    // Filter button click handler
    if (filterBtn && filterContainer) {
        filterBtn.addEventListener("click", () => {
            const filterPopup = filterContainer.querySelector('.filter-popup');
            
            if (filterContainer.classList.contains("hidden")) {
                filterContainer.classList.remove("hidden");
                
                if (window.innerWidth <= 780) {
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
            } else {
                if (window.innerWidth <= 780) {
                    // Mobile full-screen animation
                    hideModalWithMobileAnimation(filterPopup, filterContainer, () => {
                        filterContainer.classList.add("hidden");
                    });
                } else {
                    // Desktop animation
                    filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
                    filterContainer.style.opacity = "0";
                    filterContainer.style.transform = "translateY(-10px)";
                    
                    setTimeout(() => {
                        filterContainer.classList.add("hidden");
                        // Simple direct overflow unlock for filter modal
                        document.body.style.overflow = "";
                        console.log('Filter modal closed, body overflow restored');
                    }, 300);
                }
            }
        });
        
        // Document click listener for closing filter
        document.addEventListener("click", (event) => {
            // Check if filter menu is visible
            if (filterContainer.classList.contains("hidden")) {
                return;
            }
            
            // Get the actual filter popup/content div (child of filter-container)
            const filterPopup = filterContainer.querySelector('.filter-popup, .filter-content, [class*="filter"]:not(.filter-container):not(.filter-background)');
            
            // Check if click is inside the filter popup content
            const isInsideFilterPopup = filterPopup && filterPopup.contains(event.target);
            
            // Check if click is on the filter button
            const isFilterButton = filterBtn.contains(event.target);
            
            // Only close if click is NOT on the button and NOT inside the filter popup
            if (!isFilterButton && !isInsideFilterPopup) {
                if (window.innerWidth <= 780) {
                    // Mobile full-screen animation
                    hideModalWithMobileAnimation(filterPopup, filterContainer, () => {
                        filterContainer.classList.add("hidden");
                    });
                } else {
                    // Desktop animation
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
            if (window.innerWidth <= 780) {
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
            
            // Clear day checkboxes
            if (filterByDays) {
                const dayCheckboxes = filterByDays.querySelectorAll(".filter-checkbox");
                dayCheckboxes.forEach(checkbox => checkbox.checked = false);
            }
            
            // Clear time checkboxes
            if (filterByTime) {
                const timeCheckboxes = filterByTime.querySelectorAll(".filter-checkbox");
                timeCheckboxes.forEach(checkbox => checkbox.checked = false);
            }
            
            // Clear concentration checkboxes
            if (filterByConcentration) {
                const concCheckboxes = filterByConcentration.querySelectorAll(".filter-checkbox");
                concCheckboxes.forEach(checkbox => checkbox.checked = false);
            }

            // Reset course filter paragraph
            value.length = 0;
            updateCourseFilterParagraph();
            
            // Reset custom dropdowns to default values
            const termSelect = document.getElementById("term-select");
            const yearSelect = document.getElementById("year-select");
            const termCustomSelect = document.querySelector('[data-target="term-select"]');
            const yearCustomSelect = document.querySelector('[data-target="year-select"]');
            
            if (termCustomSelect) {
                const termValue = termCustomSelect.querySelector('.custom-select-value');
                const termOptions = termCustomSelect.querySelectorAll('.custom-select-option');
                termOptions.forEach(option => option.classList.remove('selected'));
                const fallOption = termCustomSelect.querySelector('[data-value="Fall"]');
                if (fallOption) {
                    fallOption.classList.add('selected');
                    termValue.textContent = 'Fall';
                    termSelect.value = 'Fall';
                }
            }
            
            if (yearCustomSelect) {
                const yearValue = yearCustomSelect.querySelector('.custom-select-value');
                const yearOptions = yearCustomSelect.querySelectorAll('.custom-select-option');
                yearOptions.forEach(option => option.classList.remove('selected'));
                const currentYearOption = yearCustomSelect.querySelector('[data-value="2025"]');
                if (currentYearOption) {
                    currentYearOption.classList.add('selected');
                    yearValue.textContent = '2025';
                    yearSelect.value = '2025';
                }
            }
            
            // Reset sorting
            currentSortMethod = null;
            const sortOptions = document.querySelectorAll('.sort-option');
            sortOptions.forEach(option => option.classList.remove('selected'));
            
            // Reset search
            currentSearchQuery = null;
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
            
            // Apply filters to update the display
            await applyFilters();
            await updateCoursesAndFilters();
        });
    }
    
    // Set up search functionality
    if (searchBtn && searchContainer && searchModal) {
        searchBtn.addEventListener("click", async () => {
            if (searchContainer.classList.contains("hidden")) {
                searchContainer.classList.remove("hidden");
                
                if (window.innerWidth <= 780) {
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
        
        // Set up additional search event listeners
        const searchSubmit = document.getElementById('search-submit');
        const searchCancel = document.getElementById('search-cancel');
        const searchInput = document.getElementById('search-input');
        const searchAutocomplete = document.getElementById('search-autocomplete');
        
        if (searchSubmit) {
            searchSubmit.addEventListener("click", async () => {
                const searchQuery = searchInput ? searchInput.value : '';
                await performSearch(searchQuery);
                
                if (window.innerWidth <= 780) {
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
                        // Reset styles
                        searchContainer.style.transition = "";
                        searchModal.style.transition = "";
                        searchContainer.style.opacity = "";
                        searchModal.style.transform = "";
                    }, 300);
                }
            });
        }
        
        if (searchCancel) {
            searchCancel.addEventListener("click", async () => {
                if (searchInput) searchInput.value = ""; // Clear search input
                if (searchAutocomplete) searchAutocomplete.style.display = 'none';
                currentHighlightIndex = -1;
                
                if (window.innerWidth <= 780) {
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
                        // Reset styles
                        searchContainer.style.transition = "";
                        searchModal.style.transition = "";
                        searchContainer.style.opacity = "";
                        searchModal.style.transform = "";
                    }, 300);
                }
                
                // Clear search state and restore filtered state
                currentSearchQuery = null;
                updateCourseFilterParagraph(); // Update paragraph when search is cleared
                await applySearchAndFilters(null);
            });
        }
    }
    
    // Set up filter event listeners
    const filterByDays = document.getElementById("filter-by-days");
    const filterByTime = document.getElementById("filter-by-time");
    const filterByConcentration = document.getElementById("filter-by-concentration");

    if (filterByDays) filterByDays.addEventListener("change", applyFilters);
    if (filterByTime) filterByTime.addEventListener("change", applyFilters);
    if (filterByConcentration) filterByConcentration.addEventListener("change", applyFilters);
    
    // Initialize filter checkbox functionality
    const filterDaysDiv = document.getElementById("filter-by-days");
    if (filterDaysDiv) {
        const value = [];
        const inputElements = filterDaysDiv.querySelectorAll("input[type='checkbox']");
        const courseFilterParagraph = document.getElementById("course-filter-paragraph");
        updateCourseFilterParagraph(); // Initialize the paragraph
        inputElements.forEach((input) => {
            input.addEventListener("change", () => {
                value.length = 0; // Clear the array
                inputElements.forEach((el) => {
                    if (el.checked) {
                        if (el.value === "Mon") {
                            const newValue = "Monday";
                            value.push(newValue);
                        } else if (el.value === "Tue") {
                            const newValue = "Tuesday";
                            value.push(newValue);
                        } else if (el.value === "Wed") {
                            const newValue = "Wednesday";
                            value.push(newValue);
                        } else if (el.value === "Thu") {
                            const newValue = "Thursday";
                            value.push(newValue);
                        } else if (el.value === "Fri") {
                            const newValue = "Friday";
                            value.push(newValue);
                        }
                    }
                });
                updateCourseFilterParagraph(); // Use the new function
            });
        });
    }
    
    // Handle responsive layout for all users (authenticated or not)
    // Add a small delay to ensure all elements are rendered
    setTimeout(handleResponsiveLayout, 100);
    
    // Listen for window resize to adjust layout  
    window.addEventListener('resize', handleResponsiveLayout);
    
    const { data: { session } } = await supabase.auth.getSession();

    // Hide/show .top-content based on authentication status
    const topContent = document.querySelector('.top-content');
    
    if (!session) {
        // Hide top-content for non-authenticated users but still load courses
        if (topContent) {
            topContent.style.display = 'none';
        }
        
        // Load courses for guest users
        console.log('Loading courses for guest user');
        try {
            await updateCoursesAndFilters();
        } catch (error) {
            console.error('Error loading courses for guest user:', error);
        }
        return;
    }

    // Show top-content for authenticated users with grid layout
    if (topContent) {
        topContent.style.display = 'grid';
    }

    const user = session.user;

    console.log(user.email, user.id);

    const profileButton = document.getElementById("profile");
    if (profileButton) {
        profileButton.addEventListener("click", function() {
            window.location.href = `/profile/${user.id}`;
        });
    }

    // Load courses for authenticated users
    try {
        await updateCoursesAndFilters();
    } catch (error) {
        console.error('Error loading courses for authenticated user:', error);
    }

    // Keep navigation text as "Profile" - don't change it to show email
});

// Function to handle responsive layout changes
function handleResponsiveLayout() {
    const containerAbove = document.querySelector('.container-above');
    const mainContent = document.querySelector('.main-content');
    
    console.log('handleResponsiveLayout called');
    console.log('containerAbove found:', !!containerAbove);
    console.log('mainContent found:', !!mainContent);
    
    if (!containerAbove || !mainContent) {
        console.log('Elements not found for responsive layout');
        return;
    }
    
    // Find the specific main-container that contains container-above
    // Use the specific ID for reliable detection
    const targetMainContainer = document.getElementById('course-main-div');
    
    console.log('targetMainContainer found:', !!targetMainContainer);
    console.log('Current parent:', containerAbove.parentElement?.className);
    console.log('Screen width:', window.innerWidth);
    
    if (!targetMainContainer) {
        console.log('Target main container not found');
        return;
    }
    
    if (window.innerWidth <= 780) {
        // Mobile: move container-above outside of main-container
        if (containerAbove.parentElement === targetMainContainer) {
            console.log('Moving container-above outside main-container for mobile');
            // Insert before the main-container that used to contain it
            mainContent.insertBefore(containerAbove, targetMainContainer);
            console.log('After move - new parent:', containerAbove.parentElement?.className);
        } else {
            console.log('Container-above is already outside main-container');
        }
    } else {
        // Desktop: move container-above back inside main-container
        if (containerAbove.parentElement === mainContent) {
            console.log('Moving container-above back inside main-container for desktop');
            // Insert as first child of main-container (before course-list)
            const courseList = document.getElementById('course-list');
            targetMainContainer.insertBefore(containerAbove, courseList);
            console.log('After move - new parent:', containerAbove.parentElement?.className);
        } else {
            console.log('Container-above is already inside main-container');
        }
    }
}

// Test function to manually trigger mobile layout - call testMobileLayout() in console
window.testMobileLayout = function() {
    const containerAbove = document.querySelector('.container-above');
    const mainContent = document.querySelector('.main-content');
    const mainContainer = containerAbove?.closest('.main-container');
    
    console.log('Manual test - elements found:', {
        containerAbove: !!containerAbove,
        mainContent: !!mainContent, 
        mainContainer: !!mainContainer
    });
    
    if (containerAbove && mainContent && mainContainer) {
        console.log('Before move - parent:', containerAbove.parentElement?.className);
        mainContent.insertBefore(containerAbove, mainContainer);
        console.log('After move - parent:', containerAbove.parentElement?.className);
    }
};

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

// Custom dropdown functionality
function initCustomDropdowns() {
    const customSelects = document.querySelectorAll('.custom-select');
    console.log('Found custom selects:', customSelects.length);
    
    customSelects.forEach(customSelect => {
        const trigger = customSelect.querySelector('.custom-select-trigger');
        const options = customSelect.querySelectorAll('.custom-select-option');
        const valueDisplay = customSelect.querySelector('.custom-select-value');
        const hiddenSelect = document.getElementById(customSelect.dataset.target);
        
        console.log('Initializing dropdown for:', customSelect.dataset.target);
        
        // Toggle dropdown
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('Dropdown clicked, current state:', customSelect.classList.contains('open'));
            
            // Close other dropdowns
            customSelects.forEach(other => {
                if (other !== customSelect) {
                    other.classList.remove('open');
                }
            });
            
            customSelect.classList.toggle('open');
            console.log('New state:', customSelect.classList.contains('open'));
        });
        
        // Handle keyboard navigation
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                customSelect.classList.toggle('open');
            } else if (e.key === 'Escape') {
                customSelect.classList.remove('open');
            }
        });
        
        // Handle option selection
        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                
                console.log('Option selected:', option.textContent);
                
                // Update selected state
                options.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                // Update display value
                valueDisplay.textContent = option.textContent;
                
                // Update hidden select value
                if (hiddenSelect) {
                    hiddenSelect.value = option.dataset.value;
                    // Trigger change event on hidden select
                    hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Close dropdown
                customSelect.classList.remove('open');
            });
        });
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select')) {
            customSelects.forEach(customSelect => {
                customSelect.classList.remove('open');
            });
        }
        
        // Close sort dropdown when clicking outside
        const sortWrapper = document.querySelector('.sort-wrapper');
        if (sortWrapper && !sortWrapper.contains(e.target)) {
            sortWrapper.classList.remove("open");
        }
    });
}

// Initialize custom dropdowns when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, initializing dropdowns...');
        initCustomDropdowns();
        initStickyObserver();
    });
} else {
    // DOM is already loaded
    console.log('DOM already loaded, initializing dropdowns immediately...');
    setTimeout(() => {
        initCustomDropdowns();
        initStickyObserver();
    }, 100); // Small delay to ensure elements are rendered
}

// Simple sticky observer for visual effects
function initStickyObserver() {
    const containerAbove = document.querySelector('.container-above');
    if (!containerAbove) return;

    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.intersectionRatio < 1) {
                containerAbove.classList.add('scrolled');
            } else {
                containerAbove.classList.remove('scrolled');
            }
        },
        { threshold: [1] }
    );

    observer.observe(containerAbove);
}

// Function to handle mobile modal animations and scroll prevention
let scrollPosition = 0;
let modalCount = 0; // Track how many modals are open

function lockBodyScroll() {
    modalCount++;
    console.log('Lock body scroll called, modal count:', modalCount);
    
    if (window.innerWidth <= 780) {
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
    
    if (window.innerWidth <= 780) {
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
    const isMobile = window.innerWidth <= 780;
    
    if (isMobile) {
        modal.classList.add('show');
        lockBodyScroll();
        
        // Add swipe functionality for filter and search modals
        if (modal.classList.contains('filter-popup')) {
            console.log('Adding swipe to filter modal');
            const background = container.querySelector('.filter-background');
            if (typeof addSwipeToCloseSimple === 'function') {
                addSwipeToCloseSimple(modal, background, () => {
                    // Direct close without animation to avoid conflict
                    container.classList.add('hidden');
                    unlockBodyScroll();
                });
            } else {
                console.error('addSwipeToCloseSimple function not found');
            }
        } else if (modal.classList.contains('search-modal')) {
            console.log('Adding swipe to search modal');
            const background = container.querySelector('.search-background');
            if (typeof addSwipeToCloseSimple === 'function') {
                addSwipeToCloseSimple(modal, background, () => {
                    // Direct close without animation to avoid conflict
                    container.classList.add('hidden');
                    unlockBodyScroll();
                });
            } else {
                console.error('addSwipeToCloseSimple function not found');
            }
        }
        
        if (callback) callback();
    } else {
        // Desktop animation logic
        lockBodyScroll();
        if (callback) callback();
    }
}

function hideModalWithMobileAnimation(modal, container, callback = null) {
    const isMobile = window.innerWidth <= 780;
    
    if (isMobile) {
        modal.classList.remove('show');
        setTimeout(() => {
            unlockBodyScroll();
            if (callback) callback();
        }, 400); // Match the CSS transition duration
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
        
        switch(method) {
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
        const yearSelect = document.getElementById("year-select");
        const termSelect = document.getElementById("term-select");
        if (!yearSelect || !termSelect) return [];
        
        const year = yearSelect.value;
        const term = termSelect.value;
        const courses = await fetchCourseData(year, term);
        allCourses = courses;
        return courses;
    } catch (error) {
        console.error('Error fetching courses for autocomplete:', error);
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
        return;
    }
    
    let suggestionsHTML = `
        <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #E3D5E9; margin-bottom: 20px;">
            <h3 style="color: #666; margin-bottom: 10px;">No exact matches found for "${searchQuery}"</h3>
            <p style="color: #999; margin-bottom: 0;">Here are the most similar courses we found:</p>
        </div>
    `;
    
    coursesWithRelevance.forEach(function({ course, relevanceScore }) {
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
        
        let timeSlot = course.time_slot;
        // Match both full and short Japanese formats: (月曜日1講時) or (木4講時)
        const match = course.time_slot.match(/\(?([月火水木金土日](?:曜日)?)([1-5](?:講時)?)\)?/);
        const specialMatch = course.time_slot.match(/(月曜日3講時・木曜日3講時)/);
        
        if (specialMatch) {
            timeSlot = "Mon 13:10 - 14:40<br>Thu 13:10 - 14:40";
        } else if (match) {
            timeSlot = `${days[match[1]]} ${times[match[2]]}`;
        }

        // Calculate relevance percentage for display
        const relevancePercent = Math.round(relevanceScore * 100);
        const matchQuality = relevanceScore > 0.7 ? "High" : relevanceScore > 0.4 ? "Medium" : "Low";
        const matchColor = relevanceScore > 0.7 ? "#4CAF50" : relevanceScore > 0.4 ? "#FF9800" : "#757575";

        const suggestedCourseColor = getCourseColorByType(course.type);
        suggestionsHTML += `
        <div class="class-outside suggested-course" id="${timeSlot}" data-color='${suggestedCourseColor}' style="opacity: 0.9; border: 2px dashed #BDAAC6; position: relative;">
            <div class="class-container" style="background-color: ${suggestedCourseColor}; position: relative;" data-course='${JSON.stringify(course)}'>
                <div class="class-suggestion">
                    <div class="class-suggestion-label">
                        Suggested
                    </div>
                </div>
                <p>${course.course_code}</p>
                <h2>${normalizeCourseTitle(course.title)}</h2>
                <p>Professor</p>
                <h3>${romanizeProfessorName(course.professor)}</h3>
                <div class="class-space"></div>
                <p>Time</p>
                <h3>${timeSlot}</h3>
            </div>
            <!-- Mobile GPA bar outside class-container -->
            <div class="gpa-bar-mobile ${course.gpa_a_percent === null ? "gpa-null" : ""}">
                <div class="gpa-fill-mobile" style="width: ${course.gpa_a_percent !== null ? course.gpa_a_percent : 20}%"><p>A</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_b_percent !== null ? course.gpa_b_percent : 20}%"><p>B</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_c_percent !== null ? course.gpa_c_percent : 20}%"><p>C</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_d_percent !== null ? course.gpa_d_percent : 20}%"><p>D</p></div>
                <div class="gpa-fill-mobile" style="width: ${course.gpa_f_percent !== null ? course.gpa_f_percent : 20}%"><p>F</p></div>
            </div>
            <!-- Desktop GPA bar outside class-container -->
            <div class="gpa-bar gpa-bar-desktop ${course.gpa_a_percent === null ? "gpa-null" : ""}">
                <div class="gpa-fill"><p>A ${course.gpa_a_percent}%</p></div>
                <div class="gpa-fill"><p>B ${course.gpa_b_percent}%</p></div>
                <div class="gpa-fill"><p>C ${course.gpa_c_percent}%</p></div>
                <div class="gpa-fill"><p>D ${course.gpa_d_percent}%</p></div>
                <div class="gpa-fill"><p>F ${course.gpa_f_percent}%</p></div>
            </div>
        </div>
        `;
    });
    
    courseList.innerHTML = suggestionsHTML;
}

// Function to perform search
function performSearch(searchQuery) {
    // Update the global search state
    currentSearchQuery = searchQuery && searchQuery.trim() ? searchQuery : null;
    
    // Update the course filter paragraph to show search status
    updateCourseFilterParagraph();
    
    // Use the unified search and filter function
    return applySearchAndFilters(currentSearchQuery);
}

// Mobile navigation positioning fix
function ensureMobileNavigationPositioning() {
    const appNavigation = document.querySelector('app-navigation');
    if (!appNavigation) return;
    
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 780;
    
    if (isMobile) {
        // Force bottom positioning with JavaScript
        appNavigation.style.position = 'fixed';
        appNavigation.style.bottom = '0';
        appNavigation.style.left = '0';
        appNavigation.style.right = '0';
        appNavigation.style.width = '100%';
        appNavigation.style.zIndex = '10000';
        
        // Force hardware acceleration
        appNavigation.style.transform = 'translateZ(0)';
        appNavigation.style.webkitTransform = 'translateZ(0)';
        
        // Ensure it stays at the bottom during scroll
        const forceBottomPosition = () => {
            if (window.innerWidth <= 780) {
                appNavigation.style.bottom = '0px';
                appNavigation.style.position = 'fixed';
            }
        };
        
        // Apply on scroll events
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(forceBottomPosition, 10);
        }, { passive: true });
        
        // Apply on orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(forceBottomPosition, 100);
        });
        
        // Apply on resize
        window.addEventListener('resize', () => {
            setTimeout(forceBottomPosition, 50);
        });
        
        // Initial positioning
        forceBottomPosition();
    }
}

// Function to restructure review dates ONLY on mobile
function restructureReviewDatesForMobile() {
    if (window.innerWidth <= 780) {
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
window.addEventListener('resize', restructureReviewDatesForMobile);

// Export initialization functions for the router
export function initializeDashboard() {
  // Re-run mobile navigation positioning
  ensureMobileNavigationPositioning();
  restructureReviewDatesForMobile();
  setViewportHeight();
  
  // Set up course list click listener
  setupCourseListClickListener();
  
  // Set up button event listeners for router-based navigation
  setupDashboardEventListeners();
  
  // Handle responsive layout for container-above positioning
  setTimeout(handleResponsiveLayout, 100);
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

// Export search state for global access
Object.defineProperty(window, 'currentSearchQuery', {
  get: () => currentSearchQuery,
  set: (value) => { currentSearchQuery = value; },
  enumerable: true,
  configurable: true
});

// Function to update the course filter paragraph with search/filter info
function updateCourseFilterParagraph() {
  const courseFilterParagraph = document.getElementById("course-filter-paragraph");
  if (!courseFilterParagraph) return;
  
  let message = "";
  
  // Check if there's an active search
  if (currentSearchQuery && currentSearchQuery.trim()) {
    const searchTerm = currentSearchQuery.trim();
    
    // Check if there are active day filters
    const filterDaysDiv = document.getElementById("filter-by-days");
    const activeDays = [];
    
    if (filterDaysDiv) {
      const checkedInputs = filterDaysDiv.querySelectorAll("input[type='checkbox']:checked");
      checkedInputs.forEach((input) => {
        if (input.value === "Mon") activeDays.push("Monday");
        else if (input.value === "Tue") activeDays.push("Tuesday");
        else if (input.value === "Wed") activeDays.push("Wednesday");
        else if (input.value === "Thu") activeDays.push("Thursday");
        else if (input.value === "Fri") activeDays.push("Friday");
      });
    }
    
    // Construct message for search results
    if (activeDays.length > 0) {
      message = `Showing searched courses for "${searchTerm}" on ${activeDays.join(", ")}`;
    } else {
      message = `Showing searched courses for "${searchTerm}"`;
    }
  } else {
    // No search, show filter info
    const filterDaysDiv = document.getElementById("filter-by-days");
    const activeDays = [];
    
    if (filterDaysDiv) {
      const checkedInputs = filterDaysDiv.querySelectorAll("input[type='checkbox']:checked");
      checkedInputs.forEach((input) => {
        if (input.value === "Mon") activeDays.push("Monday");
        else if (input.value === "Tue") activeDays.push("Tuesday");
        else if (input.value === "Wed") activeDays.push("Wednesday");
        else if (input.value === "Thu") activeDays.push("Thursday");
        else if (input.value === "Fri") activeDays.push("Friday");
      });
    }
    
    message = `Showing ${activeDays.join(", ") || "All Days"} Courses`;
  }
  
  courseFilterParagraph.innerHTML = message;
}

// Export the update function globally
window.updateCourseFilterParagraph = updateCourseFilterParagraph;