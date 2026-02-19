import { supabase } from "../supabase.js";
import { fetchCourseData, openCourseInfoMenu } from "./shared.js";

// Import components to ensure web components are defined
import './components.js';

function checkMobile() {
    window.isMobile = window.innerWidth <= 1023;
}
window.addEventListener("load", checkMobile);
window.addEventListener("resize", checkMobile);

function generateMobileButtons() {
    const mobileButtonsContainer = document.querySelector(".mobile-day-buttons");
    if (!mobileButtonsContainer) return;

    mobileButtonsContainer.innerHTML = "";

    const dayHeaders = document.querySelectorAll("#calendar thead th");
    dayHeaders.forEach((header, index) => {
        
        if (index === 0) return;
        
        const button = document.createElement("div");
        button.className = "day-button";
        button.textContent = header.textContent.trim().substring(0, 1);
        button.dataset.day = header.textContent.trim();
        mobileButtonsContainer.appendChild(button);

        button.addEventListener("click", () => showDay(header.textContent.trim()));
    });
}

function showDay(day) {
    if (!window.isMobile) return;

    const dayHeaders = document.querySelectorAll("#calendar thead th");
    const dayButtons = document.querySelectorAll(".day-button");

    let columnIndexToShow = -1;

    dayHeaders.forEach((header, index) => {
        if (header.textContent.trim() === day) {
            columnIndexToShow = index;
        }
    });

    if (columnIndexToShow === -1) return;

    document.querySelectorAll("#calendar tr").forEach(row => {
        Array.from(row.cells).forEach((cell, cellIndex) => {
            if (cellIndex === 0 || cellIndex === columnIndexToShow) {
                cell.style.display = "table-cell";
            } else {
                cell.style.display = "none";
            }
        });
    });

    dayButtons.forEach(btn => {
        btn.classList.remove("active");
        if (btn.dataset.day === day) {
            btn.classList.add("active");
        }
    });
}

export async function showCourse(year, term) {
    console.log(`showCourse called with: ${year} ${term}`);
    
    try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Calendar.js - Session check:', session ? 'Session found' : 'No session');
        
        if (!session) {
            console.error('No session found in showCourse');
            return;
        }
        
        const user = session.user;
        console.log('Calendar.js - User ID:', user.id);
        
        const calendar = document.getElementById("calendar");
        if (!calendar) {
            console.error('Calendar table not found');
            return;
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('courses_selection')
            .eq('id', user.id)
            .single();

        if (profileError) {
            console.error('Calendar.js - Profile fetch error:', profileError);
            throw profileError;
        }

        const selectedCourses = profile?.courses_selection || [];
        console.log('Calendar.js - Total selected courses:', selectedCourses.length);
        
        // Filter to only show courses for the current year and term
        const currentDisplayCourses = selectedCourses.filter(course => {
            return course.year === parseInt(year) && (!course.term || course.term === term);
        });

        console.log(`Calendar.js - Courses for ${year} ${term}:`, currentDisplayCourses.length);
        console.log('Calendar.js - Current display courses:', currentDisplayCourses);

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

        console.log(`Found ${coursesToShow.length} courses to display`);

        coursesToShow.forEach((course, courseIndex) => {
            console.log(`Calendar.js - Processing course ${courseIndex + 1}:`, course.course_code, course.time_slot);
            
            // Try Japanese format first: (月曜日1講時) or (月1講時) or (木4講時)
            let match = course.time_slot?.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
            let dayEN, period;
            
            if (match) {
                // Japanese format
                const dayJP = match[1];
                period = parseInt(match[2], 10);
                const dayMap = { "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat", "日": "Sun" };
                dayEN = dayMap[dayJP];
                console.log(`Calendar.js - Course ${course.course_code}: ${dayJP} (${dayEN}) period ${period}`);
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
                    
                    console.log(`Calendar.js - Course ${course.course_code}: ${dayEN} period ${period} (from ${startHour}:${startMin.toString().padStart(2, '0')})`);
                }
            }
            
            if (!match && !englishMatch) {
                console.log(`Calendar.js - No time slot match for course:`, course.course_code);
                return;
            }
            
            if (!dayEN || !period || period < 1) {
                console.log(`Calendar.js - Invalid day/period for course:`, course.course_code, dayEN, period);
                return;
            }

            const calendarHeader = calendar.querySelectorAll("thead th");
            let colIndex = -1;
            calendarHeader.forEach((header, idx) => {
                if (header.textContent.trim().startsWith(dayEN)) colIndex = idx;
            });
            console.log(`Calendar.js - Column index for ${dayEN}:`, colIndex);
            if (colIndex === -1) {
                console.log(`Calendar.js - No column found for day:`, dayEN);
                return;
            }

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
            console.log(`Calendar.js - Row index for period ${period}:`, rowIndex);
            if (rowIndex === -1) {
                console.log(`Calendar.js - No row found for period:`, period);
                return;
            }

            const cell = calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
            console.log(`Calendar.js - Target cell found:`, !!cell);
            
            if (cell) {
                console.log(`Calendar.js - Rendering course ${course.course_code} to cell`);
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
                div.style.backgroundColor = course.color || "#E3D5E9";
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

document.addEventListener("DOMContentLoaded", async function () {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "login.html";
        return;
    }

    const calendar = document.getElementById("calendar");
    if (!calendar) {
        console.log('Calendar table not found on page load');
        return;
    }

    checkMobile();
    if (window.isMobile) {
        generateMobileButtons();
        showDay("Mon"); 
    }

    window.addEventListener("resize", function() {
        checkMobile();
        if (window.isMobile) {
            generateMobileButtons();
            showDay("Mon");
        } else {
            document.querySelectorAll("#calendar td, #calendar th").forEach(cell => {
                cell.style.display = "";
            });
        }
    });

    // Set up click handler for course cells
    calendar.addEventListener("click", async function(event) {
        const clickedCell = event.target.closest("div.course-cell");
        if (!clickedCell) return;

        const courseCode = clickedCell.dataset.courseIdentifier;
        
        const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
        const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
            const currentMonth = new Date().getMonth() + 1;
            return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
        })();

        try {
            const courses = await fetchCourseData(currentYear, currentTerm);
            const clickedCourse = courses.find(course => course.course_code === courseCode);

            if (clickedCourse) {
                openCourseInfoMenu(clickedCourse);
            }
        } catch (error) {
            console.error('Error loading course info:', error);
        }
    });

    // Initialize with current year/term
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
        const currentMonth = new Date().getMonth() + 1;
        return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();

    console.log(`DOMContentLoaded: Loading calendar with ${currentYear} ${currentTerm}`);
    await showCourse(currentYear, currentTerm);
});

// Export initialization functions for the router
export function initializeCalendar() {
    console.log('Calendar.js: initializeCalendar called by router');
    
    // Check if calendar table exists
    const calendar = document.getElementById("calendar");
    if (!calendar) {
        console.error('Calendar.js: Calendar table not found in DOM');
        return;
    }
    
    checkMobile();
    generateMobileButtons();
    
    // Set up click handler for course cells only if not already set
    if (!calendar.hasAttribute('data-router-initialized')) {
        calendar.setAttribute('data-router-initialized', 'true');
        
        calendar.addEventListener("click", async function(event) {
            const clickedCell = event.target.closest("div.course-cell");
            if (!clickedCell) return;

            const courseCode = clickedCell.dataset.courseIdentifier;
            
            const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
            const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
                const currentMonth = new Date().getMonth() + 1;
                return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
            })();

            try {
                const courses = await fetchCourseData(currentYear, currentTerm);
                const clickedCourse = courses.find(course => course.course_code === courseCode);

                if (clickedCourse) {
                    openCourseInfoMenu(clickedCourse);
                }
            } catch (error) {
                console.error('Error loading course info:', error);
            }
        });
    }
    
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
        const currentMonth = new Date().getMonth() + 1;
        return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();
    
    console.log(`Calendar.js: Initializing calendar with ${currentYear} ${currentTerm}`);
    console.log('Calendar.js: Year/term sources:', {
        yearSelectExists: !!document.getElementById('year-select'),
        termSelectExists: !!document.getElementById('term-select'),
        yearSelectValue: document.getElementById('year-select')?.value,
        termSelectValue: document.getElementById('term-select')?.value,
        globalCurrentYear: window.globalCurrentYear,
        globalCurrentTerm: window.globalCurrentTerm,
        getCurrentYearExists: !!window.getCurrentYear,
        getCurrentTermExists: !!window.getCurrentTerm
    });
    
    // Clear any existing courses first
    calendar.querySelectorAll('tbody td .course-cell').forEach(el => el.remove());
    
    // Call showCourse to populate the static table
    setTimeout(async () => {
        try {
            // Wait a bit more to ensure navigation component is fully loaded
            await new Promise(resolve => setTimeout(resolve, 50));
            
            await showCourse(currentYear, currentTerm);
            console.log(`Calendar.js: Successfully loaded courses for ${currentYear} ${currentTerm}`);
        } catch (error) {
            console.error('Calendar.js: Error loading courses:', error);
        }
    }, 150);
}

// Global refresh function
window.refreshStaticCalendar = async () => {
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
        const currentMonth = new Date().getMonth() + 1;
        return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();
    
    console.log(`Refreshing static calendar with ${currentYear} ${currentTerm}`);
    await showCourse(currentYear, currentTerm);
};
