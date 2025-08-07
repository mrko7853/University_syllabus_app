const courseCache = {};

async function fetchCourseData(year, term) {
    const cacheKey = `${year}-${term}`;
    if (courseCache[cacheKey]) {
        return courseCache[cacheKey];
    }
    try {
        const response = await fetch(`https://api.blazearchive.com/api/courses?year=${year}&term=${term}`);
        if (!response.ok) {
            console.error("API Error: Failed to fetch course data.");
            return [];
        }
        const courses = await response.json();
        courseCache[cacheKey] = courses;
        return courses;
    } catch (error) {
        console.error('Error fetching course data', error);
        return [];
    }
}

function openCourseInfoMenu(course) {
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
