import { supabase } from "/supabase.js";
import { fetchCourseData } from "/js/shared.js";

document.addEventListener("DOMContentLoaded", async function () {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "login.html";
        return;
    }

    const user = session.user;

    const calendar = document.getElementById("calendar");
    const calendarHeader = calendar.querySelectorAll("thead th");
    
    let displayedYear;
    let displayedTerm;

    function highlightDay(day) {
        const columnIndex = Array.from(calendarHeader).findIndex(header => header.textContent.trim() === day);
        if (columnIndex === -1) return;
        calendarHeader[columnIndex].classList.add("highlight");
        calendar.querySelectorAll("tbody tr").forEach(row => {
            const cell = row.querySelector(`td:nth-child(${columnIndex + 1})`);
            if (cell) cell.classList.add("highlight");
        });
    }

    function highlightPeriod() {
        const periodIndex = Array.from(calendarHeader).findIndex(header => header.textContent.trim() === "Period");
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
                    if (periodCell && periodCell.textContent.trim() == period) rowIndex = idx;
                });
                
                if (rowIndex === -1) return;
                
                const cell = calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
                if (cell) {
                    cell.textContent = course.course_code;
                    cell.classList.add("course-cell");
                }
            });
        } catch (error) {
            console.error('An unexpected error occurred while showing courses:', error);
        }
    }

    calendar.addEventListener("click", async function(event) {
        const clickedCell = event.target.closest("td.course-cell");
        if (!clickedCell) return;

        const courseCode = clickedCell.textContent;
        
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
    const courseCode = "12001104-003";
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