import { supabase } from "/supabase.js";
import { fetchCourseData } from '/js/shared.js';
import { openCourseInfoMenu } from '/js/shared.js';

// Helper function to refresh calendar component
function refreshCalendarComponent() {
    const calendarComponent = document.querySelector('course-calendar');
    if (calendarComponent && calendarComponent.refreshCalendar) {
        calendarComponent.refreshCalendar();
    }
}

const courseList = document.getElementById("course-list");
const yearSelect = document.getElementById("year-select");
const termSelect = document.getElementById("term-select");
const filterByDays = document.getElementById("filter-by-days");
const filterByTime = document.getElementById("filter-by-time");
const filterByConcentration = document.getElementById("filter-by-concentration");

async function showCourse(year, term) {

    const courses = await fetchCourseData(year, term);
    courses.sort((a, b) => a.title.localeCompare(b.title));
    
    let courseHTML = "";
    courses.forEach(function(course) {
        const days = {
            "月曜日": "Mon",
            "火曜日": "Tue",
            "水曜日": "Wed",
            "木曜日": "Thu",
            "金曜日": "Fri"
        };
        const times = {
            "1講時": "09:00 - 10:30",
            "2講時": "10:45 - 12:15",
            "3講時": "13:10 - 14:40",
            "4講時": "14:55 - 16:25",
            "5講時": "16:40 - 18:10"
        };
        const match = course.time_slot.match(/(月曜日|火曜日|水曜日|木曜日|金曜日)([1-5]講時)/);
        const specialMatch = course.time_slot.match(/(月曜日3講時・木曜日3講時)/);
        if (specialMatch) {
            course.time_slot = "Mon 13:10 - 14:40\nThu 13:10 - 14:40";
            course.time_slot = course.time_slot.replace(/\n/g, "<br>");
        } else if (match) {
            course.time_slot = `${days[match[1]]} ${times[match[2]]}`;
        }

        courseHTML += `
        <div class="class-outside" id="${course.time_slot}" data-color='${course.color}'>
            <div class="class-container" style="background-color: ${course.color}" data-course='${JSON.stringify(course)}'>
                <p>${course.course_code}</p>
                <h2>${course.title}</h2>
                <p>Professor</p>
                <h3>${course.professor}</h3>
                <div class="class-space"></div>
                <p>Time</p>
                <h3>${course.time_slot}</h3>
            </div>
            <div class="gpa-bar ${course.gpa_a_percent === null ? "gpa-null" : ""}">
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
}

function applyFilters() {
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

    const classContainers = courseList.querySelectorAll(".class-outside");
    classContainers.forEach(container => {
        // Day logic
        const timeSlot = container.id;
        const day = timeSlot.split(" ")[0];

        // Time logic
        const time = timeSlot.split(" ")[1];

        // Concentration logic
        const courseColor = container.dataset.color;
        const cultureColor = "#C6E0B4";
        const economyColor = "#FFE699";
        const politicsColor = "#FFCCCC";

        // Check if matches day filter
        const dayMatch = selectedDays.length === 0 || selectedDays.includes(day);

        // Check if matches time filter
        const timeMatch = selectedTimes.length === 0 || selectedTimes.includes(time);

        // Check if matches concentration filter
        const concMatch =
            selectedConcentrations.length === 0 ||
            (selectedConcentrations.includes("culture") && courseColor === cultureColor) ||
            (selectedConcentrations.includes("economy") && courseColor === economyColor) ||
            (selectedConcentrations.includes("politics") && courseColor === politicsColor);

        // Show only if matches all filters
        if (dayMatch && timeMatch && concMatch) {
            container.style.display = "flex";
        } else {
            container.style.display = "none";
        }
    });

    // After filtering, check if all containers are hidden
    const allHidden = Array.from(classContainers).every(container => container.style.display === "none");

    // Toggle a non-destructive "no results" message instead of replacing the list
    let noResults = courseList.querySelector(".no-results");
    if (!noResults) {
        noResults = document.createElement("p");
        noResults.className = "no-results";
        noResults.textContent = "No courses found for the selected filters.";
        noResults.style.display = "none";
        courseList.appendChild(noResults);
    }
    noResults.style.display = allHidden ? "block" : "none";
}

async function updateCoursesAndFilters() {
    await showCourse(yearSelect.value, termSelect.value);
    applyFilters();
    
    // Also update the calendar component if it exists
    const calendarComponent = document.querySelector('course-calendar');
    if (calendarComponent && calendarComponent.showTerm) {
        calendarComponent.showTerm(yearSelect.value, termSelect.value);
    }
}

filterByDays.addEventListener("change", applyFilters);
filterByTime.addEventListener("change", applyFilters);
filterByConcentration.addEventListener("change", applyFilters);

// Filter action buttons functionality
const seeResultsBtn = document.getElementById("see-results-btn");
const clearAllBtn = document.getElementById("clear-all-btn");

// See Results button - close filter menu
seeResultsBtn.addEventListener("click", () => {
    const filterContainer = document.querySelector(".filter-container");
    const pageBody = document.body;
    
    filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    filterContainer.style.opacity = "0";
    filterContainer.style.transform = "translateY(-10px)";
    pageBody.style.overflow = "auto";
    
    setTimeout(() => {
        filterContainer.classList.add("hidden");
        filterContainer.style.transition = "";
        filterContainer.style.opacity = "";
        filterContainer.style.transform = "";
    }, 300);
});

// Clear All button - reset all filters
clearAllBtn.addEventListener("click", () => {
    // Clear day checkboxes
    const dayCheckboxes = filterByDays.querySelectorAll(".filter-checkbox");
    dayCheckboxes.forEach(checkbox => checkbox.checked = false);
    
    // Clear time checkboxes
    const timeCheckboxes = filterByTime.querySelectorAll(".filter-checkbox");
    timeCheckboxes.forEach(checkbox => checkbox.checked = false);
    
    // Clear concentration checkboxes
    const concCheckboxes = filterByConcentration.querySelectorAll(".filter-checkbox");
    concCheckboxes.forEach(checkbox => checkbox.checked = false);
    
    // Reset custom dropdowns to default values
    const termSelect = document.getElementById("term-select");
    const yearSelect = document.getElementById("year-select");
    const termCustomSelect = document.querySelector('[data-target="term-select"]');
    const yearCustomSelect = document.querySelector('[data-target="year-select"]');
    
    if (termCustomSelect) {
        const termValue = termCustomSelect.querySelector('.custom-select-value');
        const termOptions = termCustomSelect.querySelectorAll('.custom-select-option');
        termOptions.forEach(option => option.classList.remove('selected'));
        const fallOption = termCustomSelect.querySelector('[data-value="秋学期/Fall"]');
        if (fallOption) {
            fallOption.classList.add('selected');
            termValue.textContent = 'Fall';
            termSelect.value = '秋学期/Fall';
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
    
    // Apply filters to update the display
    applyFilters();
    updateCoursesAndFilters();
});

courseList.addEventListener("click", function(event) {
    const clickedContainer = event.target.closest(".class-container");
    if (clickedContainer) {
        // Parse the course data and open the shared menu
        const courseData = JSON.parse(clickedContainer.dataset.course);
        openCourseInfoMenu(courseData);
    }
});

const default_year = yearSelect.value;
const default_term = termSelect.value;
showCourse(default_year, default_term);

yearSelect.addEventListener("change", updateCoursesAndFilters);
termSelect.addEventListener("change", updateCoursesAndFilters);

// Ignore
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
        refreshCalendarComponent(); // Refresh calendar after course selection change
    }
});

const saveBtn = document.getElementById("save-button");
saveBtn.addEventListener("click", async function() {
    const concentration = "Global Culture";

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
        console.error("Error:", error);
        alert("Failed to get session");
        return;
    }

    const user = session.user;

    const { error: updateError } = await supabase
        .from('profiles')
        .update({ concentration })
        .eq('id', user.id);

    if (updateError) {
        console.error("Error:", updateError);
        alert("Failed to update concentration");
    } else {
        alert("Concentration updated successfully");
    }
});

document.addEventListener("DOMContentLoaded", async function () {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        return;
    }

    const user = session.user;

    console.log(user.email, user.id);

    const profileButton = document.getElementById("profile");
    profileButton.addEventListener("click", function() {
        window.location.href = `/profile/${user.id}`;
    });

    const profileText = document.querySelector(".navigation-text");
    profileText.textContent = `Welcome, ${user.email}`;
});

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

        calendar.querySelectorAll('tbody td .course-cell').forEach(el => el.remove());

        if (selectedCourses.length === 0) {
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

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    let term = "春学期/Spring";
    if (currentMonth >= 8 || currentMonth <= 2) {
        term = "秋学期/Fall";
    }

    showCourse(currentYear, term);

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
    });
}

// Initialize custom dropdowns when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, initializing dropdowns...');
        initCustomDropdowns();
    });
} else {
    // DOM is already loaded
    console.log('DOM already loaded, initializing dropdowns immediately...');
    setTimeout(initCustomDropdowns, 100); // Small delay to ensure elements are rendered
}

const filterBtn = document.getElementById("filter-btn");
const filterContainer = document.querySelector(".filter-container");
const filterBackground = document.querySelector(".filter-background");
const pageBody = document.body;

filterBtn.addEventListener("click", () => {
    if (filterContainer.classList.contains("hidden")) {
        filterContainer.classList.remove("hidden");
        filterContainer.style.opacity = "0";
        filterContainer.style.transform = "translateY(-10px)";
        pageBody.style.overflow = "hidden";
        
        // Trigger animation
        requestAnimationFrame(() => {
            filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
            filterContainer.style.opacity = "1";
            filterContainer.style.transform = "translateY(0)";
        });
    } else {
        filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        filterContainer.style.opacity = "0";
        filterContainer.style.transform = "translateY(-10px)";
        
        setTimeout(() => {
            filterContainer.classList.add("hidden");
        }, 300);
    }
});

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
        filterContainer.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        filterContainer.style.opacity = "0";
        filterContainer.style.transform = "translateY(-10px)";
        pageBody.style.overflow = "auto";
        
        setTimeout(() => {
            filterContainer.classList.add("hidden");
        }, 300);
    }
});

const filterDaysDiv = document.getElementById("filter-by-days");
const value = [];
const inputElements = filterDaysDiv.querySelectorAll("input[type='checkbox']");
const courseFilterParagraph = document.getElementById("course-filter-paragraph");
courseFilterParagraph.innerHTML = `Showing ${value.join(", ") || "All Days"} Courses`;
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
        courseFilterParagraph.innerHTML = `Showing ${value.join(", ") || "All Days"} Courses`;
    });
});