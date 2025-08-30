import { supabase } from "/supabase.js";
import { fetchCourseData, openCourseInfoMenu } from "/js/shared.js";

function checkMobile() {
    window.isMobile = window.innerWidth <= 780;
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

document.addEventListener("DOMContentLoaded", async function () {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "login.html";
        return;
    }

    const user = session.user;

    const calendar = document.getElementById("calendar");
    const calendarHeader = calendar.querySelectorAll("thead th");
    const previousBtn = document.getElementById("previous");
    
    let displayedYear;
    let displayedTerm;

    window.addEventListener("resize", function() {
        if (window.currentDay) {
            highlightDay(window.currentDay);
        }
    });

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

    function highlightDay(day) {
        window.currentDay = day;
        const table = document.getElementById("calendar");
        const headers = table.querySelectorAll("thead th");
        const calendar = document.getElementById("calendar");
        const container = document.querySelector(".main-container");

        const observer = new MutationObserver(() => {
            if (window.currentDay) {
                highlightDay(window.currentDay);
            }
        });

        const tbody = calendar.querySelector("tbody");
        observer.observe(tbody, {
            childList: true,
            subtree: true
        });

        const columnIndex = Array.from(headers)
            .findIndex(h => h.textContent.trim() === day);
        if (columnIndex === -1) return;

        let highlight = document.querySelector(".highlight-column");
        if (!highlight) {
            highlight = document.createElement("div");
            highlight.className = "highlight-column";
            container.appendChild(highlight);
            }

            const targetHeader = headers[columnIndex];
            const rect = targetHeader.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            const left = rect.left - containerRect.left + container.scrollLeft;
            
            highlight.style.left = left + "px";
            highlight.style.width = rect.width + "px";
    }

    function highlightPeriod() {
        const periodIndex = Array.from(calendarHeader).findIndex(header => header.textContent.trim() === previousBtn);
        if (periodIndex === -1) return;
        calendarHeader[periodIndex].classList.add("calendar-first");
        calendar.querySelectorAll("tbody tr").forEach(row => {
            const cell = row.querySelector(`td:nth-child(${periodIndex + 1})`);
            if (cell) cell.classList.add("calendar-first");
        });
    }

    function clearCourseCells() {
        calendar.querySelectorAll("td.course-cell").forEach(cell => {
            cell.textContent = "";
            cell.classList.remove("course-cell");
        });
    }

async function showCourse(year, term) {
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
        
        // Filter to only show courses for the current year and term
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


    calendar.addEventListener("click", async function(event) {
        const clickedCell = event.target.closest("div.course-cell");
        if (!clickedCell) return;

        const courseCode = clickedCell.dataset.courseIdentifier;
        
        if (!displayedYear || !displayedTerm) {
            console.error("The currently displayed year and term are unknown.");
            return;
        }

        const courses = await fetchCourseData(displayedYear, displayedTerm);
        const clickedCourse = courses.find(course => course.course_code === courseCode);

        if (clickedCourse) {
            openCourseInfoMenu(clickedCourse);
        }
    });

    highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
    highlightPeriod();

    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
        const currentMonth = new Date().getMonth() + 1;
        return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();

    clearCourseCells();
    showCourse(currentYear, currentTerm);
});