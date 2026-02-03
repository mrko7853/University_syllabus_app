import { supabase } from "/supabase.js";
import * as wanakana from 'wanakana';

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

const courseCache = {};

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
    const baseURL = window.location.origin;
    // Clean the course code for URL: remove special characters, convert spaces to underscores, lowercase
    const cleanCode = courseCode
        .replace(/[^\w\s]/g, '') // Remove special characters except word chars and spaces
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .toLowerCase();
    const encodedCourseCode = encodeURIComponent(cleanCode);
    const encodedYear = encodeURIComponent(academicYear);
    const encodedTerm = encodeURIComponent(term.toLowerCase().replace(/.*\//, '')); // Extract just Fall/Spring
    return `${baseURL}/course/${encodedCourseCode}/${encodedYear}/${encodedTerm}`;
}

// Export function to generate course URLs for external use
export function getCourseURL(course) {
    if (!course.course_code || !course.academic_year || !course.term) {
        console.warn('Course missing required fields for URL generation:', course);
        return window.location.pathname;
    }
    return generateCourseURL(course.course_code, course.academic_year, course.term);
}

// Helper function to parse course URL parameters
function parseCourseURL() {
    const path = window.location.pathname;
    // Look for clean URL pattern: /course/courseCode/year/term
    const match = path.match(/^\/course\/([^\/]+)\/(\d{4})\/([^\/]+)\/?$/);
    
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

export async function fetchCourseData(year, term) {
    const cacheKey = `${year}-${term}`;
    if (courseCache[cacheKey]) {
        console.log(`Using cached courses for ${term} ${year}`);
        return courseCache[cacheKey];
    }
    
    try {
        console.log(`Fetching courses for ${term} ${year}...`);
        
        // Skip the problematic RPC and use direct table queries instead
        return await fetchCourseDataFallback(year, term);
        
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
        console.error(`Error fetching course data for ${term} ${year}:`, error);
        
        // Check if we have stale cache data as fallback
        if (courseCache[cacheKey]) {
            console.log(`Using stale cached data as fallback for ${term} ${year}`);
            return courseCache[cacheKey];
        }
        
        // Re-throw the error for retry mechanisms to handle
        throw error;
    }
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
        
        const cacheKey = `${year}-${term}`;
        courseCache[cacheKey] = courses;
        
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
                
                const cacheKey = `${year}-${term}`;
                courseCache[cacheKey] = minimalProcessed;
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

export async function openCourseInfoMenu(course, updateURL = true) {
    console.log('Opening course info menu for:', course);
    
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
    const classContent = document.getElementById("class-content");
    const classGPA = document.getElementById("class-gpa-graph");
    const classReview = document.getElementById("class-review");
    const classClose = document.getElementById("class-close");

    if (!classInfo || !classContent || !classClose) {
        console.error("Could not find the class info menu elements in the HTML.");
        console.error("classInfo:", classInfo);
        console.error("classContent:", classContent); 
        console.error("classClose:", classClose);
        
        // Try to wait a bit for DOM to be ready and retry once
        setTimeout(() => {
            console.log('Retrying after DOM delay...');
            const retryClassInfo = document.getElementById("class-info");
            const retryClassContent = document.getElementById("class-content");
            const retryClassClose = document.getElementById("class-close");
            
            if (retryClassInfo && retryClassContent && retryClassClose) {
                openCourseInfoMenu(course, updateURL);
            } else {
                console.error("Still cannot find course modal elements after retry");
            }
        }, 1000);
        return;
    }

    // Update URL if requested (default behavior)
    if (updateURL && course.course_code && course.academic_year && course.term) {
        const newURL = generateCourseURL(course.course_code, course.academic_year, course.term);
        window.history.pushState({ course: course }, '', newURL);
    }

    // Create or get the background overlay
    let classInfoBackground = document.getElementById("class-info-background");
    if (!classInfoBackground) {
        classInfoBackground = document.createElement("div");
        classInfoBackground.id = "class-info-background";
        document.body.appendChild(classInfoBackground);
        
        // Close menu when clicking background
        classInfoBackground.addEventListener("click", function() {
            // Use smooth closing animation by removing show class
            classInfo.classList.remove("show");
            
            setTimeout(() => {
                document.body.style.overflow = "auto";
                // Clear URL when closing - go back to home
                window.history.pushState({}, '', '/');
                
                // Reset any inline styles before removing
                classInfo.style.transform = '';
                classInfo.style.transition = '';
                classInfo.style.opacity = '';
                
                if (classInfoBackground.parentNode) {
                    classInfoBackground.parentNode.removeChild(classInfoBackground);
                }
            }, 400); // Match the CSS transition duration
        });
    }

    // Get course color from the course data based on type
    const courseColor = getCourseColorByType(course.type);
    
    // Use the type directly from the database
    const courseType = course.type || 'General';

    // Check if course is already selected by user (for time slot background color)
    let isAlreadySelected = false;
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        const { data: profileData } = await supabase
            .from('profiles')
            .select('courses_selection')
            .eq('id', session.user.id)
            .single();
        
        if (profileData?.courses_selection) {
            // Filter courses by current year and term, then check if this course is selected
            const currentYearCourses = filterCoursesByCurrentYearTerm(profileData.courses_selection);
            isAlreadySelected = currentYearCourses.some(selected => 
                selected.code === course.course_code
            );
        }
    }
    
    // Set background color based on selection status and whether modifications are allowed
    let timeBackgroundColor;
    const canModify = window.isCurrentSemester ? window.isCurrentSemester() : true; // Default to true if function not available yet
    
    if (!canModify) {
        // Gray for non-current semesters (locked)
        timeBackgroundColor = isAlreadySelected ? '#B0B0B0' : '#D3D3D3';
    } else {
        // Red for already selected, Green for available
        timeBackgroundColor = isAlreadySelected ? '#ED7F81' : '#92ECB0';
    }
    
    // Reference to the exported checkTimeConflict function defined later in the file
    const checkTimeConflictForModal = async (timeSlot, courseCode, academicYear) => {
        // This will reference the exported function defined at the bottom of the file
        return await window.checkTimeConflictExported(timeSlot, courseCode, academicYear);
    };

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
            
            if (isCurrentlySelected) {
                button.textContent = "Remove Course";
                button.style.background = "#ED7F81";
                button.style.color = "white";
                button.style.cursor = "pointer";
                button.disabled = false;
            } else {
                button.textContent = "Add Course";
                button.style.background = "#92ECB0";
                button.style.color = "white";
                button.style.cursor = "pointer";
                button.disabled = false;
            }
        } catch (error) {
            console.error('Error updating course button state:', error);
        }
    };

    classContent.innerHTML = `
        <div class="course-header">
            <div class="course-title"><h2>${normalizeCourseTitle(course.title)}</h2></div>
            ${!canModify ? '' : ''}
            <button onclick="shareCourseURL()" title="Share this course"><div class="button-icon"><p>Share</p><div class="share-icon"></div></div></button>
        </div>
        <div class="class-info-container">
            <div class="class-info-1">
                <div class="class-component"><p>Professor</p><h3>${getRomanizedProfessorName(course.professor)}</h3></div>
                <div class="class-component"><p>Course Code</p><h3>${course.course_code}</h3></div>
                <div class="class-component"><p>Time</p><div class="class-component-label" style="background: ${timeBackgroundColor};">${formatTimeSlot(course.time_slot)}</div></div>
                <div class="class-component"><p>Location</p><h3>${course.location || 'TBA'}</h3></div>
            </div>
            <div class="class-info-2">
                <div class="class-component"><p>Course Type</p><div class="class-component-label" style="background: ${courseColor};">${courseType}</div></div>
                <div class="class-component"><p>Syllabus Link</p><button id="external-link-btn" onclick="window.open('${course.url}', '_blank')">
                    <div class="button-icon">
                        <p>University Link</p>
                        <div class="external-link-icon"></div>
                    </div>
                </button></div>
            </div>
        </div>
    `;

    const gpaA = "#92ECB0";
    const gpaB = "#D1E7C9";
    const gpaC = "#F6EBC1";
    const gpaD = "#FFDD55";
    const gpaF = "#ED7F81";

    // Always clear the GPA element first to prevent content from previous courses
    if (classGPA) {
        classGPA.innerHTML = '';
        classGPA.style.display = 'none';
        classGPA.removeAttribute('id');
        
        // Also clear any nested elements that might have been created
        while (classGPA.firstChild) {
            classGPA.removeChild(classGPA.firstChild);
        }
        
        // Force DOM update to ensure changes are applied
        void classGPA.offsetHeight;
    }

    // Also clear any other elements that might have GPA content
    const gpaElements = document.querySelectorAll('.class-gpa-graph, [id*="gpa"], .gpa-container');
    gpaElements.forEach(el => {
        if (el !== classGPA) {
            el.innerHTML = '';
            el.style.display = 'none';
        }
    });

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
        // Show the GPA element and restore the id if it was removed
        if (classGPA) {
            classGPA.style.display = 'block';
            classGPA.id = 'class-gpa-graph'; // Restore the id attribute
            
            // Force DOM update before setting innerHTML
            void classGPA.offsetHeight;
            
            classGPA.innerHTML = `
                <p class="class-subtitle">Grade Point Average</p>
                <div class="class-info-container gpa-layout">
                    <div class="gpa-container"><h3>A</h3><div class="gpa-bar-graph" style="background: ${gpaA}; width: ${course.gpa_a_percent}%;"><h3>${course.gpa_a_percent}%</h3></div></div>
                    <div class="gpa-container"><h3>B</h3><div class="gpa-bar-graph" style="background: ${gpaB}; width: ${course.gpa_b_percent}%;"><h3>${course.gpa_b_percent}%</h3></div></div>
                    <div class="gpa-container"><h3>C</h3><div class="gpa-bar-graph" style="background: ${gpaC}; width: ${course.gpa_c_percent}%;"><h3>${course.gpa_c_percent}%</h3></div></div>
                    <div class="gpa-container"><h3>D</h3><div class="gpa-bar-graph" style="background: ${gpaD}; width: ${course.gpa_d_percent}%;"><h3>${course.gpa_d_percent}%</h3></div></div>
                    <div class="gpa-container"><h3>F</h3><div class="gpa-bar-graph" style="background: ${gpaF}; width: ${course.gpa_f_percent}%;"><h3>${course.gpa_f_percent}%</h3></div></div>
                </div>
            `;
        }
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
                console.error('Error loading profiles after all attempts:', profilesError);
                // Continue without profile data
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
                totalReviews: 0,
                ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
            };
        }

        const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
        const averageRating = (totalRating / reviews.length).toFixed(2);
        
        const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        reviews.forEach(review => {
            ratingDistribution[review.rating]++;
        });

        return {
            averageRating: parseFloat(averageRating),
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
        
        // Use provided anonymous name and avatar, or create defaults
        const displayName = anonymousName || (review.profiles?.display_name || 'Anonymous User');
        const avatarUrl = avatarSrc || (review.profiles?.avatar_url || createAvatarPlaceholder(displayName));
        const isOwnReview = currentUserId && review.user_id === currentUserId;
        
        return `
            <div class="review-item">
                <div class="review-header">
                    <img src="${avatarUrl}" alt="${displayName}" class="review-avatar">
                    <div class="review-user-info">
                        <h4 class="review-user-name">${displayName}</h4>
                        <div class="review-rating">${renderStarRating(review.rating)}</div>
                    </div>
                    <div class="review-dates">
                        <p class="review-date">Reviewed on ${formatDate(review.created_at)}</p>
                        <p class="review-course-date"><div class="term-label">${review.term.includes('/') ? review.term.split('/')[1] : review.term} ${review.academic_year}</div></p>
                    </div>
                    ${isOwnReview ? `
                        <div class="review-actions">
                            <button class="edit-review-btn" onclick="openEditReviewModal('${review.id}', '${review.course_code}', '${review.term}', ${review.rating}, '${(review.content || '').replace(/'/g, "\\'")}', ${review.academic_year})">
                                <div class="button-icon">
                                    <p>Edit</p>
                                    <div class="edit-icon"></div>
                                </div>
                            </button>
                        </div>
                    ` : ''}
                </div>
                <div class="review-content">
                    <p>${review.content || 'No written review provided.'}</p>
                </div>
            </div>
        `;
    }

    // Load reviews for this course (from all years, just matching course code and term)
    const allReviews = await loadCourseReviews(course.course_code, null, course.term);
    
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
    const reviewsToShow = sortedReviews.slice(0, initialReviewsToShow);
    const hasMoreReviews = sortedReviews.length > initialReviewsToShow;

    classReview.innerHTML = `
        <div class="class-subtitle-review">
            <p class="subtitle-opacity">Course Reviews</p>
            ${!userHasReviewed ? `
                <button class="add-review-btn" onclick="openAddReviewModal('${course.course_code}', ${course.academic_year}, '${course.term}', '${course.title}')">
                    <div class="button-icon">
                        <p>Write a Review</p>
                        <div class="add-icon"></div>
                    </div>
                </button>
            ` : ''}
        </div>
        
        ${stats.totalReviews > 0 ? `
            <!-- Average Rating Section -->
            <div class="review-summary">
                <div class="average-rating">
                    <div>
                        <h3>Average Rating</h3>
                    </div>
                    <div></div>
                    <div class="rating-stars">${renderStarRating(Math.round(stats.averageRating), 'large')}</div>
                    <div>
                        <p class="total-reviews">${stats.totalReviews} review${stats.totalReviews !== 1 ? 's' : ''}</p>
                        <div class="rating-display">
                            <p class="rating-total">${stats.averageRating} out of 5</p>
                        </div>
                    </div>
                </div>
                
                <!-- Rating Distribution -->
                <div class="rating-distribution">
                    ${[5, 4, 3, 2, 1].map(rating => {
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
            
            <!-- Individual Reviews -->
            <div class="reviews-container">
                <h3 class="reviews-header">Reviews</h3>
                <div class="reviews-list" id="reviews-list-${course.course_code}">
                    ${reviewsToShow.map((review, index) => {
            const isOwnReview = currentUserId && review.user_id === currentUserId;
            // Count only non-user reviews for Student numbering
            const nonUserReviewsBeforeThis = reviewsToShow.slice(0, index).filter(r => !(currentUserId && r.user_id === currentUserId)).length;
            const anonymousName = isOwnReview ? "Your review" : `Student ${nonUserReviewsBeforeThis + 1}`;
            const avatarSrc = "/user.svg";  // Use user icon for all reviews
            
            return renderReview(review, currentUserId, anonymousName, avatarSrc);
        }).join('')}
                </div>
                
                ${hasMoreReviews ? `
                    <button class="load-more-reviews" onclick="loadMoreReviews('${course.course_code}', null, '${course.term}', ${initialReviewsToShow})">
                        Load More Reviews (${reviews.length - initialReviewsToShow} more)
                    </button>
                ` : ''}
            </div>
        ` : `
            <div class="no-reviews">
                <p>No reviews available for this course yet.</p>
                <p>Be the first to share your experience!</p>
            </div>
        `}
    `;

    classInfo.classList.add("show");
    
    // On mobile, start in semi-open state; on desktop, no change needed
    if (window.innerWidth <= 780) {
        // Remove fully-open class in case it was set previously
        classInfo.classList.remove("fully-open");
    }
    
    document.body.style.overflow = "hidden";
    
    // Reset any leftover inline styles from previous interactions
    classInfo.style.transform = '';
    classInfo.style.transition = '';
    classInfo.style.opacity = '';
    
    // Add mobile swipe-to-close functionality
    if (window.innerWidth <= 780) {
        addSwipeToClose(classInfo, classInfoBackground);
    }
    
    // Restructure review dates for mobile after modal content is loaded
    if (typeof restructureReviewDatesForMobile === 'function') {
        setTimeout(() => restructureReviewDatesForMobile(), 10);
    }
    
    // Show background with fade-in animation
    setTimeout(() => {
        classInfoBackground.style.opacity = "1";
    }, 10);

    // Set up add/remove course button functionality
    const addRemoveButton = document.getElementById("class-add-remove");
    
    if (addRemoveButton) {
        // Always remove existing listener and set up fresh
        const newButton = addRemoveButton.cloneNode(true);
        addRemoveButton.parentNode.replaceChild(newButton, addRemoveButton);
        
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
            
            if (!canModify) {
                // For non-current semesters, show a disabled state
                newButton.textContent = "Semester Locked";
                newButton.style.background = "#cccccc";
                newButton.style.color = "#666666";
                newButton.style.cursor = "not-allowed";
                newButton.disabled = true;
            } else if (isSelected) {
                newButton.textContent = "Remove Course";
                newButton.style.background = "#ED7F81";
                newButton.style.color = "white";
                newButton.style.cursor = "pointer";
                newButton.disabled = false;
            } else {
                newButton.textContent = "Add Course";
                newButton.style.background = "#92ECB0";
                newButton.style.color = "white";
                newButton.style.cursor = "pointer";
                newButton.disabled = false;
            }
        }
        
        // Set initial button state
        await updateButton();
        
        // Add click handler
        newButton.addEventListener("click", async function(e) {
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
                
                // Filter to get only courses for current year and term
                const currentYearCourses = filterCoursesByCurrentYearTerm(currentSelection);
                const isCurrentlySelected = currentYearCourses.some(selected => 
                    selected.code === course.course_code
                );
                
                if (isCurrentlySelected) {
                    // Remove course - remove from the full selection, not just current year
                    const updatedSelection = currentSelection.filter(selected => 
                        !(selected.code === course.course_code && selected.year === getCurrentYear() && (!selected.term || selected.term === getCurrentTerm()))
                    );
                    
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
                        showTimeConflictModal(conflictResult.conflictingCourses, course, async (shouldReplace, conflictingCourses) => {
                            if (shouldReplace) {
                                // Remove conflicting courses and add new one
                                let updatedSelection = currentSelection.filter(selected => {
                                    return !conflictingCourses.some(conflict => {
                                        // Remove conflicting courses from current year/term only
                                        return conflict.course_code === selected.code && 
                                               selected.year === getCurrentYear() && 
                                               (!selected.term || selected.term === getCurrentTerm());
                                    });
                                });
                                
                                // Add the new course with current year and term
                                updatedSelection = [
                                    ...updatedSelection,
                                    {
                                        code: course.course_code,
                                        year: getCurrentYear(),
                                        term: getCurrentTerm()
                                    }
                                ];
                                
                                const { error } = await supabase
                                    .from('profiles')
                                    .update({ courses_selection: updatedSelection })
                                    .eq('id', session.user.id);
                                
                                if (error) {
                                    console.error('Error updating courses:', error);
                                    alert('Failed to update courses. Please try again.');
                                    return;
                                }
                                
                                alert('Course replaced successfully!');
                                await updateButton();
                                // Also update the button state specifically
                                await updateCourseButtonState(course, newButton);
                                if (window.refreshCalendarComponent) {
                                    window.refreshCalendarComponent();
                                }
                            }
                        });
                        return;
                    }
                    
                    // Add course with current year and term
                    const updatedSelection = [
                        ...currentSelection,
                        {
                            code: course.course_code,
                            year: getCurrentYear(),
                            term: getCurrentTerm()
                        }
                    ];
                    
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

    if (!classClose.dataset.listenerAttached) {
        classClose.addEventListener("click", function() {
            const currentBackground = document.getElementById("class-info-background");
            
            // Use smooth closing animation by removing show class
            classInfo.classList.remove("show");
            
            setTimeout(() => {
                document.body.style.overflow = "auto";
                // Clear URL when closing - go back to home
                window.history.pushState({}, '', '/');
                
                // Reset any inline styles before removing
                classInfo.style.transform = '';
                classInfo.style.transition = '';
                classInfo.style.opacity = '';
                
                if (currentBackground && currentBackground.parentNode) {
                    currentBackground.parentNode.removeChild(currentBackground);
                }
            }, 400); // Match the CSS transition duration
        });
        classClose.dataset.listenerAttached = "true";
    }
}

// Global function to load more reviews
window.loadMoreReviews = async function(courseCode, academicYear, term, currentlyShowing) {
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
            const nextBatch = sortedReviews.slice(currentlyShowing, currentlyShowing + 3);
            
            // Count non-user reviews that have already been shown to continue numbering correctly
            const reviewsShownSoFar = sortedReviews.slice(0, currentlyShowing);
            const nonUserReviewsShownSoFar = reviewsShownSoFar.filter(r => !(currentUserId && r.user_id === currentUserId)).length;
            
            nextBatch.forEach((review, index) => {
                const isOwnReview = currentUserId && review.user_id === currentUserId;
                // Count non-user reviews in the current batch before this one
                const nonUserReviewsInBatchBeforeThis = nextBatch.slice(0, index).filter(r => !(currentUserId && r.user_id === currentUserId)).length;
                const studentNumber = nonUserReviewsShownSoFar + nonUserReviewsInBatchBeforeThis + 1;
                const anonymousName = isOwnReview ? "Your review" : `Student ${studentNumber}`;
                const avatarSrc = "/user.svg";
                
                const reviewElement = document.createElement('div');
                reviewElement.innerHTML = renderReview(review, currentUserId, anonymousName, avatarSrc);
                reviewsList.appendChild(reviewElement.firstElementChild);
            });
            
            const newCurrentlyShowing = currentlyShowing + nextBatch.length;
            
            if (newCurrentlyShowing >= sortedReviews.length) {
                loadMoreBtn.remove();
            } else {
                loadMoreBtn.textContent = `Load More Reviews (${sortedReviews.length - newCurrentlyShowing} more)`;
                loadMoreBtn.onclick = () => loadMoreReviews(courseCode, academicYear, term, newCurrentlyShowing);
            }
        }
    } catch (error) {
        console.error('Error loading more reviews:', error);
    }
};

// Global function to open add review modal
window.openAddReviewModal = async function(courseCode, academicYear, term, courseTitle) {
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
            if (confirm('You have already reviewed this course. Would you like to edit your existing review?')) {
                // Open the edit modal instead
                openEditReviewModal(
                    existingReview.id,
                    existingReview.course_code,
                    existingReview.term,
                    existingReview.rating,
                    existingReview.content || '',
                    existingReview.academic_year
                );
                return;
            } else {
                return;
            }
        }

        // Create and show add review modal
        const modal = document.createElement('div');
        modal.className = 'review-modal';
        
        modal.innerHTML = `
            <div class="review-modal-content">
                <div class="review-modal-header">
                    <h3>Write a Review for ${courseTitle}</h3>
                    <button class="close-modal" onclick="closeReviewModal()">&times;</button>
                </div>
                <div class="review-modal-body">
                    <div class="year-input">
                        <label for="course-year">When did you take this course?</label>
                        <select id="course-year">
                            <option value="">Select year...</option>
                            ${(() => {
                                const currentYear = new Date().getFullYear();
                                let options = '';
                                for (let year = currentYear; year >= currentYear - 10; year--) {
                                    const selected = year === academicYear ? 'selected' : '';
                                    options += `<option value="${year}" ${selected}>${year}</option>`;
                                }
                                return options;
                            })()}
                        </select>
                        <div class="review-field-error" id="course-year-error" style="display: none;"></div>
                    </div>
                    <div class="rating-input">
                        <label>Rating:</label>
                        <div class="star-rating-input" id="star-rating-input">
                            ${[1, 2, 3, 4, 5].map(rating => 
                                `<span class="star-input" data-rating="${rating}" onclick="setRating(${rating})" onmouseover="hoverRating(${rating})" onmouseout="unhoverRating()">☆</span>`
                            ).join('')}
                        </div>
                        <div class="review-field-error" id="star-rating-error" style="display: none;"></div>
                    </div>
                    <div class="review-text-input">
                        <label for="review-content">Your Review:</label>
                        <textarea id="review-content" placeholder="Share your experience with this course..." rows="6"></textarea>
                        <div class="review-field-error" id="review-content-error" style="display: none;"></div>
                    </div>
                </div>
                <div class="review-modal-footer">
                    <button class="cancel-review" onclick="closeReviewModal()">Cancel</button>
                    <button class="submit-review" onclick="submitReview('${courseCode}', ${academicYear}, '${term}')">Submit Review</button>
                </div>
            </div>
        `;

        console.log('Adding modal to body');
        modal.classList.add('hidden'); // Start hidden for animation
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Trigger animation by removing hidden class (same as search modal pattern)
        setTimeout(() => {
            modal.classList.remove('hidden');
        }, 10);
        
    } catch (error) {
        console.error('Error opening review modal:', error);
        alert('Error opening review form. Please try again.');
    }
};

// Global function to close review modal
window.closeReviewModal = function() {
    const modal = document.querySelector('.review-modal');
    if (modal) {
        modal.classList.add('hidden');
        
        // Remove modal after animation completes (300ms to match CSS)
        setTimeout(() => {
            modal.remove();
        }, 300);
        
        // Only restore body overflow if the main course info modal is not open
        const classInfo = document.getElementById("class-info");
        if (!classInfo || !classInfo.classList.contains("show")) {
            document.body.style.overflow = 'auto';
        }
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
    const fieldIds = ['course-year', 'star-rating', 'review-content'];
    fieldIds.forEach(fieldId => {
        const errorElement = document.getElementById(`${fieldId}-error`);
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    });
}

// Global function to open edit review modal
window.openEditReviewModal = async function(reviewId, courseCode, term, currentRating, currentContent, currentYear) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
            alert('Please log in to edit your review.');
            return;
        }

        // Create and show edit review modal
        const modal = document.createElement('div');
        modal.className = 'review-modal';
        
        modal.innerHTML = `
            <div class="review-modal-content">
                <div class="review-modal-header">
                    <h3>Edit Your Review for ${courseCode}</h3>
                    <button class="close-modal" onclick="closeReviewModal()">&times;</button>
                </div>
                <div class="review-modal-body">
                    <div class="year-input">
                        <label for="course-year-edit">When did you take this course?</label>
                        <select id="course-year-edit">
                            <option value="">Select year...</option>
                            ${(() => {
                                const currentYearDate = new Date().getFullYear();
                                let options = '';
                                for (let year = currentYearDate; year >= currentYearDate - 10; year--) {
                                    const selected = year === currentYear ? 'selected' : '';
                                    options += `<option value="${year}" ${selected}>${year}</option>`;
                                }
                                return options;
                            })()}
                        </select>
                    </div>
                    <div class="rating-input">
                        <label>Rating:</label>
                        <div class="star-rating-input" id="star-rating-input-edit" data-selected-rating="${currentRating}">
                            ${[1, 2, 3, 4, 5].map(rating => 
                                `<span class="star-input ${rating <= currentRating ? 'selected' : ''}" data-rating="${rating}" onclick="setEditRating(${rating})" onmouseover="hoverEditRating(${rating})" onmouseout="unhoverEditRating()">${rating <= currentRating ? '★' : '☆'}</span>`
                            ).join('')}
                        </div>
                    </div>
                    <div class="review-text-input">
                        <label for="review-content-edit">Your Review:</label>
                        <textarea id="review-content-edit" placeholder="Share your experience with this course..." rows="6">${currentContent}</textarea>
                    </div>
                </div>
                <div class="review-modal-footer space-between">
                    <button class="delete-review" onclick="deleteReview('${reviewId}')">Delete Review</button>
                    <div class="button-group">
                        <button class="cancel-review" onclick="closeReviewModal()">Cancel</button>
                        <button class="update-review" onclick="updateReview('${reviewId}')">Update Review</button>
                    </div>
                </div>
            </div>
        `;

        modal.classList.add('hidden'); // Start hidden for animation  
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Trigger animation by removing hidden class (same as search modal pattern)
        setTimeout(() => {
            modal.classList.remove('hidden');
        }, 10);
        
    } catch (error) {
        console.error('Error opening edit review modal:', error);
        alert('Error opening edit form. Please try again.');
    }
};

// Global function to set rating in edit modal
window.setEditRating = function(rating) {
    const stars = document.querySelectorAll('#star-rating-input-edit .star-input');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.textContent = '★';
            star.style.color = '#ffc107'; // Gold color for selected stars
            star.classList.add('selected');
        } else {
            star.textContent = '☆';
            star.style.color = '#ddd'; // Gray color for unselected stars
            star.classList.remove('selected');
        }
    });
    
    // Store the selected rating
    document.getElementById('star-rating-input-edit').dataset.selectedRating = rating;
};

// Global function to handle star hover in edit modal
window.hoverEditRating = function(rating) {
    const stars = document.querySelectorAll('#star-rating-input-edit .star-input');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.textContent = '★';
            star.style.color = '#ffc107';
        } else {
            star.textContent = '☆';
            star.style.color = '#ddd';
        }
    });
};

// Global function to remove hover effect in edit modal
window.unhoverEditRating = function() {
    const ratingInput = document.getElementById('star-rating-input-edit');
    const selectedRating = parseInt(ratingInput?.dataset.selectedRating || 0);
    
    if (selectedRating > 0) {
        setEditRating(selectedRating); // Restore the selected rating
    } else {
        // Reset all stars to empty if no rating selected
        const stars = document.querySelectorAll('#star-rating-input-edit .star-input');
        stars.forEach(star => {
            star.textContent = '☆';
            star.style.color = '#ddd';
        });
    }
};
window.setRating = function(rating) {
    const stars = document.querySelectorAll('.star-input');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.textContent = '★';
            star.style.color = '#ffc107'; // Gold color for selected stars
            star.classList.add('selected');
        } else {
            star.textContent = '☆';
            star.style.color = '#ddd'; // Gray color for unselected stars
            star.classList.remove('selected');
        }
    });
    
    // Store the selected rating
    document.getElementById('star-rating-input').dataset.selectedRating = rating;
};

// Global function to handle star hover
window.hoverRating = function(rating) {
    const stars = document.querySelectorAll('.star-input');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.textContent = '★';
            star.style.color = '#ffc107';
        } else {
            star.textContent = '☆';
            star.style.color = '#ddd';
        }
    });
};

// Global function to remove hover effect
window.unhoverRating = function() {
    const ratingInput = document.getElementById('star-rating-input');
    const selectedRating = parseInt(ratingInput?.dataset.selectedRating || 0);
    
    if (selectedRating > 0) {
        setRating(selectedRating); // Restore the selected rating
    } else {
        // Reset all stars to empty if no rating selected
        const stars = document.querySelectorAll('.star-input');
        stars.forEach(star => {
            star.textContent = '☆';
            star.style.color = '#ddd';
        });
    }
};

// Global function to update review
window.updateReview = async function(reviewId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
            alert('Please log in to update your review.');
            return;
        }

        const ratingInput = document.getElementById('star-rating-input-edit');
        const contentInput = document.getElementById('review-content-edit');
        const yearInput = document.getElementById('course-year-edit');
        
        const rating = parseInt(ratingInput.dataset.selectedRating);
        const content = contentInput.value.trim();
        const selectedYear = parseInt(yearInput.value);
        
        if (!rating) {
            alert('Please select a rating.');
            return;
        }
        
        if (!selectedYear) {
            alert('Please select the year when you took this course.');
            return;
        }

        const updateBtn = document.querySelector('.update-review');
        updateBtn.disabled = true;
        updateBtn.textContent = 'Updating...';

        const { data, error } = await supabase
            .from('course_reviews')
            .update({
                rating: rating,
                content: content,
                academic_year: selectedYear
            })
            .eq('id', reviewId)
            .eq('user_id', session.user.id); // Double-check ownership

        if (error) {
            console.error('Error updating review:', error);
            alert('Error updating review. Please try again.');
            updateBtn.disabled = false;
            updateBtn.textContent = 'Update Review';
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
window.deleteReview = async function(reviewId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
            alert('Please log in to delete your review.');
            return;
        }

        if (!confirm('Are you sure you want to delete this review? This action cannot be undone.')) {
            return;
        }

        const deleteBtn = document.querySelector('.delete-review');
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
            deleteBtn.textContent = 'Delete Review';
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
            console.log('Handling route change for path:', window.location.pathname);
            
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
            const target = event.target.closest('a[href*="/course/"]');
            if (target) {
                event.preventDefault();
                const url = target.getAttribute('href');
                window.history.pushState({}, '', url);
                handleRouteChange();
            }
        });
        
        console.log('Course routing initialized successfully');
        
    } catch (error) {
        console.error('Error initializing course routing:', error);
    }
}

// Debug function to test course routing manually
window.testCourseRouting = function() {
    console.log('Testing course routing...');
    console.log('Current path:', window.location.pathname);
    
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
window.shareCourseURL = function() {
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
window.openCourseByURL = function(courseCode, academicYear, term) {
    const courseURL = generateCourseURL(courseCode, academicYear, term);
    window.history.pushState({}, '', courseURL);
    
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
window.submitReview = async function(courseCode, academicYear, term) {
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

        const ratingInput = document.getElementById('star-rating-input');
        const contentInput = document.getElementById('review-content');
        const yearInput = document.getElementById('course-year');
        
        const rating = parseInt(ratingInput.dataset.selectedRating);
        const content = contentInput.value.trim();
        const selectedYear = parseInt(yearInput.value);
        
        // Clear previous errors
        clearReviewFieldErrors();
        
        let hasErrors = false;
        
        // Validate rating
        if (!rating) {
            showReviewFieldError('star-rating', 'Please select a rating.');
            hasErrors = true;
        }
        
        // Validate year
        if (!selectedYear) {
            showReviewFieldError('course-year', 'Please select the year when you took this course.');
            hasErrors = true;
        }
        
        // Content is optional, so we don't validate it
        
        if (hasErrors) {
            return;
        }

        const submitBtn = document.querySelector('.submit-review');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        const { data, error } = await supabase
            .from('course_reviews')
            .insert({
                user_id: session.user.id,
                course_code: courseCode,
                academic_year: selectedYear,
                term: term,
                rating: rating,
                content: content
            });

        if (error) {
            console.error('Error submitting review:', error);
            alert('Error submitting review. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Review';
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
window.renderReview = function(review, currentUserId = null) {
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
    
    const displayName = review.profiles?.display_name || 'Anonymous User';
    const avatarUrl = review.profiles?.avatar_url || createAvatarPlaceholder(displayName);
    const isOwnReview = currentUserId && review.user_id === currentUserId;
    
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
                    <div class="review-rating">${renderStarRating(review.rating)}</div>
                </div>
                <div class="review-dates">
                    <p class="review-date">Reviewed: ${formatDate(review.created_at)}</p>
                    <p class="review-course-date">Took course: ${review.term} ${review.academic_year}</p>
                </div>
                ${isOwnReview ? `
                    <div class="review-actions">
                        <button class="edit-review-btn" onclick="openEditReviewModal('${review.id}', '${review.course_code}', '${review.term}', ${review.rating}, '${(review.content || '').replace(/'/g, "\\'")}', ${review.academic_year})" style="
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
                .select('course_code, title, time_slot, professor, academic_year, term')
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
    // Fallback to current year
    return new Date().getFullYear();
}

function getCurrentTerm() {
    const termSelect = document.getElementById('term-select');
    if (termSelect && termSelect.value) {
        return termSelect.value;
    }
    // Fallback to current term logic
    return 'Fall'; // Adjust as needed
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
    
    // Create modal container
    const modalContainer = document.createElement('div');
    modalContainer.className = 'conflict-container hidden';
    
    modalContainer.innerHTML = `
        <div class="search-background">
            <div class="search-modal">
                <h2><div></div>Time Slot Conflict</h2>
                <div class="conflict-content">
                    <p>You are trying to add <strong>${normalizeCourseTitle(newCourse.title)}</strong> but there's already a course scheduled at the same time:</p>
                    
                    ${conflictingCourses.map(course => `
                        <div class="conflicting-course">
                            <div class="course-details">
                                <h3>${normalizeCourseTitle(course.title)}</h3>
                                <p><strong>Course Code:</strong> ${course.course_code}</p>
                                <p><strong>Time:</strong> ${course.time_slot}</p>
                                <p><strong>Professor:</strong> ${getRomanizedProfessorName(course.professor || 'TBA')}</p>
                            </div>
                        </div>
                    `).join('')}
                    
                    <div class="conflict-question">
                        <p>Would you like to remove the conflicting course and add the new one?</p>
                    </div>
                </div>
                <div class="search-buttons">
                    <button class="search-cancel conflict-cancel">Cancel</button>
                    <button class="search-submit conflict-replace">Replace Course</button>
                </div>
            </div>
        </div>
    `;
    
    // Add to body
    document.body.appendChild(modalContainer);
    
    // Add event listeners
    const cancelBtn = modalContainer.querySelector('.conflict-cancel');
    const replaceBtn = modalContainer.querySelector('.conflict-replace');
    const background = modalContainer.querySelector('.search-background');
    
    function closeModal() {
        modalContainer.classList.add('hidden');
        setTimeout(() => {
            modalContainer.remove();
        }, 300);
        if (onResolve) onResolve(false);
    }
    
    function replaceAndAdd() {
        modalContainer.classList.add('hidden');
        setTimeout(() => {
            modalContainer.remove();
        }, 300);
        if (onResolve) onResolve(true, conflictingCourses);
    }
    
    cancelBtn.addEventListener('click', closeModal);
    replaceBtn.addEventListener('click', replaceAndAdd);
    background.addEventListener('click', (e) => {
        if (e.target === background) {
            closeModal();
        }
    });
}

// Instagram-style modal functionality for class-info modal
function addSwipeToClose(modal, background) {
    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let isDragging = false;
    let modalState = 'semi-open'; // 'semi-open', 'fully-open', 'closed'
    let dragStarted = false;
    
    const threshold = 200; // Much higher threshold - user must swipe almost all the way down
    const velocityThreshold = 1.5; // Much higher velocity threshold - prevents quick small swipes
    
    // Get the content wrapper for scroll detection
    const contentWrapper = modal.querySelector('.class-content-wrapper');
    
    // Check if we're on mobile
    const isMobile = () => window.innerWidth <= 780;
    
    function handleTouchStart(e) {
        if (!isMobile()) return;
        
        startY = e.touches[0].clientY;
        currentY = startY;
        startTime = Date.now();
        isDragging = false;
        dragStarted = false;
        
        // Determine current modal state
        if (modal.classList.contains('fully-open')) {
            modalState = 'fully-open';
        } else if (modal.classList.contains('show')) {
            modalState = 'semi-open';
        }
        
        console.log('Touch start, modalState:', modalState);
    }
    
    function handleTouchMove(e) {
        if (!isMobile()) return;
        
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        const absDeltaY = Math.abs(deltaY);
        
        // Check if content can scroll
        const isAtTop = contentWrapper ? contentWrapper.scrollTop <= 0 : true;
        const isAtBottom = contentWrapper ? 
            contentWrapper.scrollTop + contentWrapper.clientHeight >= contentWrapper.scrollHeight - 1 : true;
        const hasScrollableContent = contentWrapper ? 
            contentWrapper.scrollHeight > contentWrapper.clientHeight : false;
        
        // Determine if we should handle this gesture
        let shouldHandleGesture = false;
        
        if (deltaY < 0) {
            // Swiping up
            if (modalState === 'semi-open' && isAtTop) {
                // Can expand to fully open
                shouldHandleGesture = true;
            } else if (modalState === 'fully-open' && !hasScrollableContent) {
                // No content to scroll, allow rubber band effect
                shouldHandleGesture = true;
            }
        } else if (deltaY > 0) {
            // Swiping down
            if (modalState === 'fully-open' && isAtTop) {
                // Can collapse to semi-open or close
                shouldHandleGesture = true;
            } else if (modalState === 'semi-open' && isAtTop) {
                // Can close modal
                shouldHandleGesture = true;
            } else if (!hasScrollableContent) {
                // No content to scroll
                shouldHandleGesture = true;
            }
        }
        
        if (shouldHandleGesture && absDeltaY > 5) { // 5px threshold to start gesture
            if (!dragStarted) {
                dragStarted = true;
                isDragging = true;
                modal.classList.add('swiping');
                console.log('Started gesture, direction:', deltaY < 0 ? 'up' : 'down');
            }
            
            // Prevent scrolling when we're handling the gesture
            e.preventDefault();
            
            // Apply transform based on gesture using CSS custom properties
            if (deltaY < 0 && modalState === 'semi-open') {
                // Expanding from semi-open to fully-open
                const progress = Math.min(Math.abs(deltaY) / 200, 1);
                const translateY = 20 - (20 * progress);
                modal.style.setProperty('--modal-translate-y', `${translateY}vh`);
                modal.style.transition = 'none';
                
            } else if (deltaY > 0) {
                // Collapsing or closing - use consistent maxDrag like search-modal
                const maxDrag = 300; // Same as search-modal for consistent velocity
                const progress = Math.min(deltaY / maxDrag, 1);
                
                if (modalState === 'fully-open') {
                    // From fully-open to semi-open - NO fading, just transform
                    const translateY = 0 + (20 * progress);
                    modal.style.setProperty('--modal-translate-y', `${translateY}vh`);
                    
                } else if (modalState === 'semi-open') {
                    // From semi-open to closing - fade the MODAL itself like search-modal
                    const translateY = 20 + (80 * progress);
                    modal.style.setProperty('--modal-translate-y', `${translateY}vh`);
                    
                    // Fade the modal itself (not background) - same calculation as search-modal
                    const opacity = Math.max(0.2, 1 - progress * 0.8);
                    modal.style.opacity = opacity;
                }
                modal.style.transition = 'none';
            }
        } else if (dragStarted && !shouldHandleGesture) {
            // User started gesture but now content should scroll - release gesture
            isDragging = false;
            dragStarted = false;
            modal.classList.remove('swiping');
            
            // Snap back to current state using CSS custom properties
            modal.style.transition = 'transform 0.3s ease-out';
            if (modalState === 'fully-open') {
                modal.style.setProperty('--modal-translate-y', '0');
            } else if (modalState === 'semi-open') {
                modal.style.setProperty('--modal-translate-y', '20vh');
            }
            modal.style.opacity = '1'; // Reset modal opacity
            
            console.log('Released gesture, allowing content scroll');
        }
        
        // If we're not handling the gesture, allow natural scrolling (don't preventDefault)
    }
    
    function handleTouchEnd(e) {
        if (!isMobile() || !dragStarted) return;
        
        const deltaY = currentY - startY;
        const duration = Date.now() - startTime;
        const velocity = Math.abs(deltaY) / duration; // pixels per ms
        
        modal.classList.remove('swiping');
        modal.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)'; // Instagram-like easing
        
        console.log('Touch end - deltaY:', deltaY, 'velocity:', velocity, 'modalState:', modalState);
        
        // Determine final state based on distance and velocity using CSS custom properties
        if (deltaY < 0 && modalState === 'semi-open') {
            // Swiping up from semi-open
            if (Math.abs(deltaY) > threshold || velocity > velocityThreshold) {
                // Expand to fully open
                modal.classList.add('fully-open');
                modal.style.setProperty('--modal-translate-y', '0');
                modalState = 'fully-open';
                console.log('Expanded to fully open');
            } else {
                // Snap back to semi-open
                modal.style.setProperty('--modal-translate-y', '20vh');
                modal.style.opacity = '1'; // Reset opacity when snapping back
                console.log('Snapped back to semi-open');
            }
            
        } else if (deltaY > 0) {
            // Swiping down
            if (modalState === 'fully-open') {
                if (deltaY > threshold || velocity > velocityThreshold) {
                    // Collapse to semi-open
                    modal.classList.remove('fully-open');
                    modal.style.setProperty('--modal-translate-y', '20vh');
                    modalState = 'semi-open';
                    console.log('Collapsed to semi-open');
                } else {
                    // Snap back to fully open
                    modal.style.setProperty('--modal-translate-y', '0');
                    console.log('Snapped back to fully open');
                }
                
            } else if (modalState === 'semi-open') {
                if (deltaY > threshold || velocity > velocityThreshold) {
                    // Close modal with same animation as search-modal
                    modal.style.setProperty('--modal-translate-y', '100vh');
                    background.style.opacity = '0';
                    background.style.transition = 'opacity 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                    
                    setTimeout(() => {
                        document.body.style.overflow = "auto";
                        window.history.pushState({}, '', '/');
                        
                        if (background.parentNode) {
                            background.parentNode.removeChild(background);
                        }
                        
                        // Reset all styles after closing
                        modal.style.removeProperty('--modal-translate-y');
                        modal.style.transition = '';
                        modal.style.transform = '';
                        background.style.opacity = '';
                        background.style.transition = '';
                        modal.classList.remove('show', 'fully-open');
                    }, 400);
                    
                    console.log('Closed class-info modal with swipe');
                    return;
                } else {
                    // Snap back to semi-open
                    modal.style.setProperty('--modal-translate-y', '20vh');
                    modal.style.opacity = '1'; // Reset opacity when snapping back
                    console.log('Snapped back to semi-open');
                }
            }
        }
        
        // Reset modal opacity and clear inline styles after animation
        modal.style.opacity = '1';
        setTimeout(() => {
            if (modal.style.transition) {
                modal.style.transition = '';
            }
            // Clean up any inline custom property overrides
            if (modal.style.getPropertyValue('--modal-translate-y')) {
                modal.style.removeProperty('--modal-translate-y');
            }
        }, 400);
        
        isDragging = false;
        dragStarted = false;
    }
    
    function closeModal() {
        console.log('Closing class-info modal');
        const isMobile = window.innerWidth <= 780;
        
        if (isMobile) {
            // Use same closing animation as search-modal - apply CSS custom property for smooth exit
            modal.style.setProperty('--modal-translate-y', '100vh');
            background.style.opacity = '0';
            background.style.transition = 'opacity 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            
            setTimeout(() => {
                document.body.style.overflow = "auto";
                window.history.pushState({}, '', '/');
                
                if (background.parentNode) {
                    background.parentNode.removeChild(background);
                }
                
                // Reset all styles after closing
                modal.style.removeProperty('--modal-translate-y');
                modal.style.transition = '';
                modal.style.transform = '';
                background.style.opacity = '';
                background.style.transition = '';
                modal.classList.remove('show', 'fully-open');
            }, 400);
        } else {
            // Desktop close
            modal.classList.remove("show");
            
            setTimeout(() => {
                document.body.style.overflow = "auto";
                window.history.pushState({}, '', '/');
                
                if (background.parentNode) {
                    background.parentNode.removeChild(background);
                }
                
                // Clean up all styles
                modal.style.removeProperty('--modal-translate-y');
                modal.style.transform = '';
                modal.style.transition = '';
                modal.style.opacity = '';
                background.style.opacity = '';
                background.style.transition = '';
                modal.classList.remove('fully-open');
            }, 400);
        }
    }
    
    // Add touch event listeners
    modal.addEventListener('touchstart', handleTouchStart, { passive: false });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    // Clean up listeners when modal is removed
    const originalRemove = background.remove || background.parentNode?.removeChild?.bind(background.parentNode);
    if (originalRemove) {
        background.remove = function() {
            modal.removeEventListener('touchstart', handleTouchStart);
            modal.removeEventListener('touchmove', handleTouchMove);
            modal.removeEventListener('touchend', handleTouchEnd);
            return originalRemove.call(this);
        };
    }
}

// Instagram-style modal functionality for simple modals (filter, search)
function addSwipeToCloseSimple(modal, background, closeCallback) {
    console.log('addSwipeToCloseSimple called for modal:', modal.className);
    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let isDragging = false;
    let dragStarted = false;
    
    const threshold = 200; // Much higher threshold - user must swipe almost all the way down
    const velocityThreshold = 1.5; // Much higher velocity threshold - prevents quick small swipes
    
    // Check if we're on mobile
    const isMobile = () => window.innerWidth <= 780;
    
    function handleTouchStart(e) {
        if (!isMobile()) return;
        
        startY = e.touches[0].clientY;
        currentY = startY;
        startTime = Date.now();
        isDragging = false;
        dragStarted = false;
        
        console.log('Simple modal touch start on:', modal.className);
    }
    
    function handleTouchMove(e) {
        if (!isMobile()) return;
        
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        const absDeltaY = Math.abs(deltaY);
        
        // Find the scrollable content element - for filter modal it's .filter-content
        let scrollableElement = modal.querySelector('.filter-content') || modal;
        
        // Check if modal content can scroll
        const hasScrollableContent = scrollableElement.scrollHeight > scrollableElement.clientHeight;
        const isAtTop = scrollableElement.scrollTop <= 0;
        const isAtBottom = scrollableElement.scrollTop + scrollableElement.clientHeight >= scrollableElement.scrollHeight - 1;
        
        // Only handle gestures appropriately based on scroll position and direction
        let shouldHandleGesture = false;
        if (deltaY > 0) {
            // Swiping down - can close modal only when at top or no scrollable content
            shouldHandleGesture = isAtTop || !hasScrollableContent;
        }
        // Note: Upward swipes (deltaY < 0) are never handled - let content scroll naturally
        
        console.log('Touch move - deltaY:', deltaY, 'shouldHandle:', shouldHandleGesture, 'isAtTop:', isAtTop, 'hasScrollable:', hasScrollableContent);
        
        if (shouldHandleGesture && absDeltaY > 5) { // 5px threshold to start gesture
            if (!dragStarted) {
                dragStarted = true;
                isDragging = true;
                modal.classList.add('swiping');
                console.log('Started simple modal gesture');
            }
            
            // Prevent scrolling when we're handling the gesture
            e.preventDefault();
            
            // Apply transform using CSS custom property to bypass !important
            const translateY = `${deltaY}px`;
            modal.style.setProperty('--modal-translate-y', translateY);
            
            // Fade background
            const maxDrag = 300;
            const progress = Math.min(deltaY / maxDrag, 1);
            const opacity = Math.max(0.2, 1 - progress * 0.8);
            background.style.opacity = opacity;
            
        } else if (dragStarted && !shouldHandleGesture) {
            // User started gesture but now content should scroll - release gesture
            isDragging = false;
            dragStarted = false;
            modal.classList.remove('swiping');
            
            // Snap back to normal position using CSS custom property
            modal.style.setProperty('--modal-translate-y', '0');
            background.style.opacity = '1';
            
            console.log('Released simple modal gesture, allowing content scroll');
        }
        
        // If we're not handling the gesture, allow natural scrolling (don't preventDefault)
    }
    
    function handleTouchEnd(e) {
        if (!isMobile() || !dragStarted) return;
        
        const deltaY = currentY - startY;
        const duration = Date.now() - startTime;
        const velocity = Math.abs(deltaY) / duration; // pixels per ms
        
        modal.classList.remove('swiping');
        
        console.log('Simple modal touch end - deltaY:', deltaY, 'velocity:', velocity);
        
        // Determine if should close based on distance and velocity
        if (deltaY > threshold || velocity > velocityThreshold) {
            // Close the modal with swipe animation - use CSS custom property
            modal.style.setProperty('--modal-translate-y', '100vh');
            background.style.opacity = '0';
            background.style.transition = 'opacity 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            
            setTimeout(() => {
                // Call the callback directly to avoid double animation
                closeCallback();
                // Reset styles after closing
                modal.style.removeProperty('--modal-translate-y');
                background.style.opacity = '';
                background.style.transition = '';
                modal.classList.remove('show');
            }, 400);
            
            console.log('Closed simple modal');
        } else {
            // Snap back to normal position using CSS custom property
            modal.style.setProperty('--modal-translate-y', '0');
            background.style.opacity = '1';
            
            console.log('Snapped simple modal back');
        }
        
        // Clear transition after animation
        setTimeout(() => {
            if (modal.style.transition) {
                modal.style.transition = '';
            }
        }, 400);
        
        isDragging = false;
        dragStarted = false;
    }
    
    // Attach event listeners
    console.log('Attaching touch event listeners to modal:', modal.className);
    modal.addEventListener('touchstart', handleTouchStart, { passive: false });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    // Store references for cleanup if needed
    modal._swipeHandlers = {
        touchstart: handleTouchStart,
        touchmove: handleTouchMove,
        touchend: handleTouchEnd
    };
}

// Make it globally available
window.addSwipeToCloseSimple = addSwipeToCloseSimple;
window.fetchCourseData = fetchCourseData;
window.fetchProfessorChanges = fetchProfessorChanges;
window.clearProfessorChangeCache = clearProfessorChangeCache;
window.openCourseInfoMenu = openCourseInfoMenu;
