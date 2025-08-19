import { supabase } from "/supabase.js";
import { fetchCourseData } from '/js/shared.js';
import { openCourseInfoMenu } from '/js/shared.js';

const courseList = document.getElementById("course-list");
const yearSelect = document.getElementById("year-select");
const termSelect = document.getElementById("term-select");
const filterByDays = document.getElementById("filter-by-days");
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

        // Concentration logic
        const courseColor = container.dataset.color;
        const cultureColor = "#C6E0B4";
        const economyColor = "#FFE699";
        const politicsColor = "#FFCCCC";

        // Check if matches day filter
        const dayMatch = selectedDays.length === 0 || selectedDays.includes(day);

        // Check if matches concentration filter
        const concMatch =
            selectedConcentrations.length === 0 ||
            (selectedConcentrations.includes("culture") && courseColor === cultureColor) ||
            (selectedConcentrations.includes("economy") && courseColor === economyColor) ||
            (selectedConcentrations.includes("politics") && courseColor === politicsColor);

        // Show only if matches both filters
        if (dayMatch && concMatch) {
            container.style.display = "flex";
        } else {
            container.style.display = "none";
        }
    });

    // After filtering, check if all containers are hidden
    const allHidden = Array.from(classContainers).every(container => container.style.display === "none");
    if (allHidden) {
        courseList.innerHTML = "<p>No courses found for the selected filters.</p>";
    } else {
    }
}

filterByDays.addEventListener("change", applyFilters);
filterByConcentration.addEventListener("change", applyFilters);

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

yearSelect.addEventListener("change", () => showCourse(yearSelect.value, termSelect.value));
termSelect.addEventListener("change", () => showCourse(yearSelect.value, termSelect.value));

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
    }
});