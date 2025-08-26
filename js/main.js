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

// Global sorting state
let currentSortMethod = null;

// Global search state
let currentSearchQuery = null;
let suggestionsDisplayed = false; // Track if suggestions are currently shown

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
    
    // Reset suggestions flag when courses are reloaded
    suggestionsDisplayed = false;
}

// Helper function to convert course time slot to container ID format
function convertTimeSlotToContainerFormat(timeSlot) {
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
    
    const match = timeSlot.match(/(月曜日|火曜日|水曜日|木曜日|金曜日)([1-5]講時)/);
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
    const day = timeSlot.split(" ")[0];

    // Time logic
    const time = timeSlot.split(" ")[1];

    // Concentration logic
    const courseColor = container.dataset.color;
    const cultureColor = "#C6E0B4";
    const economyColor = "#FFE699";
    const politicsColor = "#FFCCCC";
    const seminarColor = "#FFFF99";
    const academicColor = "#CCFFFF";
    const specialColor = "#CCCCFF";

    // Check if matches day filter
    const dayMatch = selectedDays.length === 0 || selectedDays.includes(day);

    // Check if matches time filter
    const timeMatch = selectedTimes.length === 0 || selectedTimes.includes(time);

    // Check if matches concentration filter
    const concMatch =
        selectedConcentrations.length === 0 ||
        (selectedConcentrations.includes("culture") && courseColor === cultureColor) ||
        (selectedConcentrations.includes("economy") && courseColor === economyColor) ||
        (selectedConcentrations.includes("politics") && courseColor === politicsColor) ||
        (selectedConcentrations.includes("seminar") && courseColor === seminarColor) ||
        (selectedConcentrations.includes("academic") && courseColor === academicColor) ||
        (selectedConcentrations.includes("special") && courseColor === specialColor);

    return dayMatch && timeMatch && concMatch;
}

function applyFilters() {
    // Use the unified search and filter function
    return applySearchAndFilters(currentSearchQuery);
}

// Unified function that applies both search and filter criteria
async function applySearchAndFilters(searchQuery) {
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
            
            const title = (courseData.title || '').toLowerCase();
            const professor = (courseData.professor || '').toLowerCase();
            const courseCode = (courseData.course_code || '').toLowerCase();
            const query = searchQuery.toLowerCase().trim();
            
            const searchMatches = title.includes(query) || 
                                 professor.includes(query) || 
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
                        dataset: { color: course.color }
                    };
                    return containerMatchesFilters(tempContainer);
                });
                
                const similarCourses = findSimilarCourses(searchQuery, filteredCourses, 5);
                displaySuggestedCourses(similarCourses, searchQuery);
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
}

async function updateCoursesAndFilters() {
    await showCourse(yearSelect.value, termSelect.value);
    
    // Re-apply current sort if one is selected
    if (currentSortMethod) {
        sortCourses(currentSortMethod);
    } else {
        // Apply both current search and filters
        await applySearchAndFilters(currentSearchQuery);
    }
    
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
clearAllBtn.addEventListener("click", async () => {
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

// Set default sort to Course A-Z
currentSortMethod = 'title-az';

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
    });
} else {
    // DOM is already loaded
    console.log('DOM already loaded, initializing dropdowns immediately...');
    setTimeout(initCustomDropdowns, 100); // Small delay to ensure elements are rendered
}

const filterBtn = document.getElementById("filter-btn");
const filterContainer = document.querySelector(".filter-container");
const filterBackground = document.querySelector(".filter-background");
const searchBtn = document.getElementById("search-btn");
const searchContainer = document.querySelector(".search-container");
const searchBackground = document.querySelector(".search-background");
const searchModal = document.querySelector(".search-modal");
const searchInput = document.getElementById("search-input");
const searchSubmit = document.getElementById("search-submit");
const searchCancel = document.getElementById("search-cancel");
const searchAutocomplete = document.getElementById("search-autocomplete");
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

// Sort dropdown functionality
const sortBtn = document.getElementById("sort-btn");
const sortDropdown = document.getElementById("sort-dropdown");

// Function to sort courses based on selected method
function sortCourses(method) {
    const courseContainers = Array.from(courseList.querySelectorAll(".class-outside"));
    
    courseContainers.sort((a, b) => {
        const courseA = JSON.parse(a.querySelector('.class-container').dataset.course);
        const courseB = JSON.parse(b.querySelector('.class-container').dataset.course);
        
        switch(method) {
            case 'title-az':
                return (courseA.title || '').localeCompare(courseB.title || '');
            case 'title-za':
                return (courseB.title || '').localeCompare(courseA.title || '');
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

// Sort button click handler
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

// Sort option selection
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

// Search modal functionality
let originalCourses = []; // Store original courses for search
let allCourses = []; // Store all courses for autocomplete
let currentHighlightIndex = -1;

// Function to get all courses for autocomplete
async function getAllCourses() {
    try {
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

// Function to show autocomplete suggestions
function showAutocomplete(query) {
    if (!query.trim() || query.length < 2) {
        searchAutocomplete.style.display = 'none';
        return;
    }
    
    const normalizedQuery = query.toLowerCase().trim();
    const suggestions = allCourses.filter(course => {
        const title = (course.title || '').toLowerCase();
        const professor = (course.professor || '').toLowerCase();
        const courseCode = (course.course_code || '').toLowerCase();
        
        return title.includes(normalizedQuery) || 
               professor.includes(normalizedQuery) || 
               courseCode.includes(normalizedQuery);
    }).slice(0, 5); // Limit to 5 suggestions
    
    if (suggestions.length === 0) {
        searchAutocomplete.style.display = 'none';
        return;
    }
    
    searchAutocomplete.innerHTML = '';
    suggestions.forEach((course, index) => {
        const item = document.createElement('div');
        item.className = 'search-autocomplete-item';
        item.innerHTML = `
            <div class="item-title">${course.title}</div>
            <div class="item-details">
                <span class="item-code">${course.course_code}</span>
                <span class="item-professor">${course.professor}</span>
            </div>
        `;
        
        item.addEventListener('click', () => {
            searchInput.value = course.title;
            searchAutocomplete.style.display = 'none';
            currentHighlightIndex = -1;
        });
        
        searchAutocomplete.appendChild(item);
    });
    
    searchAutocomplete.style.display = 'block';
    currentHighlightIndex = -1;
}

// Function to handle keyboard navigation in autocomplete
function handleAutocompleteNavigation(event) {
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

// Function to calculate word similarity (simple Jaccard similarity)
function calculateSimilarity(str1, str2) {
    const words1 = str1.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const words2 = str2.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// Function to find similar courses
function findSimilarCourses(searchQuery, courses, limit = 5) {
    if (!searchQuery.trim() || courses.length === 0) return [];
    
    const query = searchQuery.toLowerCase().trim();
    const coursesWithSimilarity = courses.map(course => {
        const titleSimilarity = calculateSimilarity(query, course.title || '');
        const professorSimilarity = calculateSimilarity(query, course.professor || '');
        const codeSimilarity = calculateSimilarity(query, course.course_code || '');
        
        // Weight title similarity more heavily
        const overallSimilarity = (titleSimilarity * 0.6) + (professorSimilarity * 0.3) + (codeSimilarity * 0.1);
        
        return {
            course,
            similarity: overallSimilarity
        };
    })
    .filter(item => item.similarity > 0.1) // Only include courses with some similarity
    .sort((a, b) => b.similarity - a.similarity) // Sort by similarity descending
    .slice(0, limit); // Limit results
    
    return coursesWithSimilarity.map(item => item.course);
}

// Function to display suggested courses
function displaySuggestedCourses(courses, searchQuery) {
    const courseList = document.getElementById("course-list");
    
    if (courses.length === 0) {
        courseList.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <h3 style="color: #666; margin-bottom: 10px;">No courses found</h3>
                <p style="color: #999;">No courses match your search for "${searchQuery}"</p>
            </div>
        `;
        return;
    }
    
    let suggestionsHTML = `
        <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #E3D5E9; margin-bottom: 20px;">
            <h3 style="color: #666; margin-bottom: 10px;">No exact matches found</h3>
            <p style="color: #999; margin-bottom: 0;">Here are some courses that might interest you based on "${searchQuery}":</p>
        </div>
    `;
    
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
        
        let timeSlot = course.time_slot;
        const match = course.time_slot.match(/(月曜日|火曜日|水曜日|木曜日|金曜日)([1-5]講時)/);
        const specialMatch = course.time_slot.match(/(月曜日3講時・木曜日3講時)/);
        
        if (specialMatch) {
            timeSlot = "Mon 13:10 - 14:40<br>Thu 13:10 - 14:40";
        } else if (match) {
            timeSlot = `${days[match[1]]} ${times[match[2]]}`;
        }

        suggestionsHTML += `
        <div class="class-outside suggested-course" id="${timeSlot}" data-color='${course.color}' style="opacity: 0.8; border: 2px dashed #BDAAC6;">
            <div class="class-container" style="background-color: ${course.color}; position: relative;" data-course='${JSON.stringify(course)}'>
                <div style="position: absolute; top: 10px; right: 15px; background: rgba(255,255,255,0.9); border-radius: 15px; padding: 4px 12px; font-size: 12px; color: #666; font-weight: 500;">
                    Suggested
                </div>
                <p>${course.course_code}</p>
                <h2>${course.title}</h2>
                <p>Professor</p>
                <h3>${course.professor}</h3>
                <div class="class-space"></div>
                <p>Time</p>
                <h3>${timeSlot}</h3>
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
    
    courseList.innerHTML = suggestionsHTML;
}

// Function to perform search
function performSearch(searchQuery) {
    // Update the global search state
    currentSearchQuery = searchQuery && searchQuery.trim() ? searchQuery : null;
    
    // Use the unified search and filter function
    return applySearchAndFilters(currentSearchQuery);
}

// Search button click handler
searchBtn.addEventListener("click", async () => {
    if (searchContainer.classList.contains("hidden")) {
        searchContainer.classList.remove("hidden");
        searchContainer.style.opacity = "0";
        searchModal.style.transform = "translate(-50%, -60%)";
        pageBody.style.overflow = "hidden";
        
        // Trigger animation
        requestAnimationFrame(() => {
            searchContainer.style.transition = "opacity 0.3s ease";
            searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
            searchContainer.style.opacity = "1";
            searchModal.style.transform = "translate(-50%, -50%)";
        });
        
        // Load courses for autocomplete
        await getAllCourses();
        
        // Focus on search input after animation
        setTimeout(() => {
            searchInput.focus();
        }, 100);
    }
});

// Search submit handler
searchSubmit.addEventListener("click", async () => {
    const searchQuery = searchInput.value;
    await performSearch(searchQuery);
    
    // Close search modal with animation
    searchContainer.style.transition = "opacity 0.3s ease";
    searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    searchContainer.style.opacity = "0";
    searchModal.style.transform = "translate(-50%, -60%)";
    
    setTimeout(() => {
        searchContainer.classList.add("hidden");
        pageBody.style.overflow = "auto";
        // Reset styles
        searchContainer.style.transition = "";
        searchModal.style.transition = "";
        searchContainer.style.opacity = "";
        searchModal.style.transform = "";
    }, 300);
});

// Search cancel handler
searchCancel.addEventListener("click", async () => {
    searchInput.value = ""; // Clear search input
    searchAutocomplete.style.display = 'none';
    currentHighlightIndex = -1;
    
    // Close search modal with animation
    searchContainer.style.transition = "opacity 0.3s ease";
    searchModal.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    searchContainer.style.opacity = "0";
    searchModal.style.transform = "translate(-50%, -60%)";
    
    setTimeout(() => {
        searchContainer.classList.add("hidden");
        pageBody.style.overflow = "auto";
        // Reset styles
        searchContainer.style.transition = "";
        searchModal.style.transition = "";
        searchContainer.style.opacity = "";
        searchModal.style.transform = "";
    }, 300);
    
    // Clear search state and restore filtered state
    currentSearchQuery = null;
    await applySearchAndFilters(null);
});

// Search input event handlers for autocomplete
searchInput.addEventListener("input", (event) => {
    showAutocomplete(event.target.value);
});

// Show autocomplete when clicking in search input (if there's content)
searchInput.addEventListener("click", (event) => {
    if (event.target.value.trim() && event.target.value.length >= 2) {
        showAutocomplete(event.target.value);
    }
});

// Focus event to show autocomplete when tabbing into input
searchInput.addEventListener("focus", (event) => {
    if (event.target.value.trim() && event.target.value.length >= 2) {
        showAutocomplete(event.target.value);
    }
});

// Allow Enter key to submit search and handle autocomplete navigation
searchInput.addEventListener("keydown", (event) => {
    if (searchAutocomplete.style.display === 'block' && 
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        handleAutocompleteNavigation(event);
    } else if (event.key === "Enter") {
        event.preventDefault();
        if (searchAutocomplete.style.display === 'block' && currentHighlightIndex >= 0) {
            const items = searchAutocomplete.querySelectorAll('.search-autocomplete-item');
            if (items[currentHighlightIndex]) {
                items[currentHighlightIndex].click();
                return;
            }
        }
        searchSubmit.click();
    } else if (event.key === "Escape") {
        event.preventDefault();
        if (searchAutocomplete.style.display === 'block') {
            searchAutocomplete.style.display = 'none';
            currentHighlightIndex = -1;
        } else {
            searchCancel.click();
        }
    }
});

// Close search modal when clicking on background
searchBackground.addEventListener("click", (event) => {
    if (event.target === searchBackground) {
        searchAutocomplete.style.display = 'none';
        currentHighlightIndex = -1;
        searchCancel.click();
    }
});

// Handle clicks inside the modal (for autocomplete behavior and preventing modal closure)
searchModal.addEventListener("click", (event) => {
    // Check if click is inside search input or autocomplete dropdown
    const clickedInsideSearch = searchInput.contains(event.target);
    const clickedInsideAutocomplete = searchAutocomplete.contains(event.target);
    
    // If clicked inside the modal but outside search input and autocomplete, hide autocomplete
    if (!clickedInsideSearch && !clickedInsideAutocomplete) {
        searchAutocomplete.style.display = 'none';
        currentHighlightIndex = -1;
    }
    
    // Always prevent modal from closing when clicking inside
    event.stopPropagation();
});

// Close autocomplete when clicking completely outside the modal
document.addEventListener("click", (event) => {
    // Only handle clicks when search modal is open
    if (searchContainer.classList.contains("hidden")) {
        return;
    }
    
    // If clicked completely outside the modal, hide autocomplete
    if (!searchModal.contains(event.target)) {
        searchAutocomplete.style.display = 'none';
        currentHighlightIndex = -1;
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