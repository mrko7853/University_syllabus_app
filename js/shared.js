import { supabase } from "/supabase.js";

const courseCache = {};

export async function fetchCourseData(year, term) {
    const cacheKey = `${year}-${term}`;
    if (courseCache[cacheKey]) {
        return courseCache[cacheKey];
    }
    try {
        const { data: courses, error } = await supabase.rpc('get_courses_with_fallback_gpa', {
            p_year: year,
            p_term: term
        });

        if (error) {
            console.error("Supabase error:", error.message);
            return [];
        }
        
        courseCache[cacheKey] = courses;
        return courses;
    } catch (error) {
        console.error('Error fetching course data', error);
        return [];
    }
}

export function openCourseInfoMenu(course) {
    const classInfo = document.getElementById("class-info");
    const classContent = document.getElementById("class-content");
    const classClose = document.getElementById("class-close");

    if (!classInfo || !classContent || !classClose) {
        console.error("Could not find the class info menu elements in the HTML.");
        return;
    }

    classContent.innerHTML = `
        <h2>${course.title}</h2>
        <p><strong>Professor:</strong> ${course.professor}</p>
        <p><strong>Course Code:</strong> ${course.course_code}</p>
        <p><strong>Time:</strong> ${course.time_slot.replace(/曜日(\d+)講時/, ` Day Period $1`)}</p>
    `;

    classInfo.classList.add("show");

    if (!classClose.dataset.listenerAttached) {
        classClose.addEventListener("click", function() {
            classInfo.classList.remove("show");
        });
        classClose.dataset.listenerAttached = "true";
    }
}
