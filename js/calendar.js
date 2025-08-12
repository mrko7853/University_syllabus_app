import { supabase } from "/supabase.js";
import { fetchCourseData, openCourseInfoMenu } from "/js/shared.js";

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
            if (selectedCourses.length === 0) {
                return;
            }

            const allCoursesInSemester = await fetchCourseData(year, term);

            const coursesToShow = allCoursesInSemester.filter(course =>
                selectedCourses.some((profileCourse) => 
                    profileCourse.code === course.course_code && profileCourse.year == year
                )
            );

            coursesToShow.forEach(course => {
                const match = course.time_slot.match(/\((\S+)曜日(\d+)講時\)/);
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
                        // Try to extract period number from <p>period N</p>
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
                    div.textContent = course.title_short.normalize("NFKC").toUpperCase();
                    div.classList.add("course-cell");
                    div.style.backgroundColor = course.color || "#E3D5E9";
                    div.dataset.courseIdentifier = course.course_code;
                    cell.appendChild(div);
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

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    let term = "春学期/Spring";
    if (currentMonth >= 8 || currentMonth <= 2) {
        term = "秋学期/Fall";
    }

    clearCourseCells();
    showCourse(currentYear, term);
});

const pushBtn = document.getElementById("push-button");
pushBtn.addEventListener("click", async function() {
    const courseCode = "12001311-000";
    const courseYear = "2025";

    const { error } = await supabase.rpc('add_course_to_selection', {
        p_year: courseYear,
        p_code: courseCode
    });

    if (error) {
        console.error("Error:", error);
        alert("Failed");
    } else {
        alert("Success");
        showCourse(currentYear, term);
    }
});