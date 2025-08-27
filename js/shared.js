import { supabase } from "/supabase.js";

const courseCache = {};

// Helper function to convert RGB to hex
function rgbToHex(rgb) {
    const result = rgb.match(/\d+/g);
    if (result && result.length >= 3) {
        return "#" + ((1 << 24) + (parseInt(result[0]) << 16) + (parseInt(result[1]) << 8) + parseInt(result[2])).toString(16).slice(1).toUpperCase();
    }
    return rgb; // Return original if conversion fails
}

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

export async function openCourseInfoMenu(course) {
    const classInfo = document.getElementById("class-info");
    const classContent = document.getElementById("class-content");
    const classGPA = document.getElementById("class-gpa-graph");
    const classReview = document.getElementById("class-review");
    const classClose = document.getElementById("class-close");

    if (!classInfo || !classContent || !classClose) {
        console.error("Could not find the class info menu elements in the HTML.");
        return;
    }

    // Create or get the background overlay
    let classInfoBackground = document.getElementById("class-info-background");
    if (!classInfoBackground) {
        classInfoBackground = document.createElement("div");
        classInfoBackground.id = "class-info-background";
        classInfoBackground.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100vh;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(classInfoBackground);
        
        // Close menu when clicking background
        classInfoBackground.addEventListener("click", function() {
            classInfo.classList.remove("show");
            classInfoBackground.style.opacity = "0";
            document.body.style.overflow = "auto";
            
            setTimeout(() => {
                if (classInfoBackground.parentNode) {
                    classInfoBackground.parentNode.removeChild(classInfoBackground);
                }
            }, 300);
        });
    }

    const cultureColor = "#C6E0B4";
    const economyColor = "#FFE699";
    const politicsColor = "#FFCCCC";
    const seminarColor = "#FFFF99";
    const academicColor = "#CCFFFF";
    const specialColor = "#CCCCFF";

    // Function to determine course type based on color
    function getCourseType(courseColor) {
        switch(courseColor) {
            case cultureColor:
                return "Culture";
            case economyColor:
                return "Economy";
            case politicsColor:
                return "Politics";
            case seminarColor:
                return "Seminar";
            case academicColor:
                return "Foundation";
            case specialColor:
                return "Special Lecture";
            default:
                return "General";
        }
    }

    // Get course color from the course data or determine it
    let courseColor = course.color || "#FFFFFF"; // Default to white if no color
    if (course.course_code) {
        // Try to find the course element in the DOM to get its color
        const courseElements = document.querySelectorAll('.class-container');
        for (let element of courseElements) {
            if (element.textContent.includes(course.course_code)) {
                courseColor = element.style.backgroundColor || 
                            window.getComputedStyle(element).backgroundColor;
                // Convert rgb to hex if needed
                if (courseColor.startsWith('rgb')) {
                    courseColor = rgbToHex(courseColor);
                }
                break;
            }
        }
    }

    const courseType = getCourseType(courseColor);

    // Function to check if there's a time conflict with registered courses
    async function checkTimeConflict(timeSlot, courseCode, courseYear) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return false; // No user logged in, assume available
            
            console.log('Checking if course is already selected:', courseCode, courseYear);
            console.log('Full course object:', course); // Debug: see all properties
            
            // Get user profile with selected courses
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('courses_selection')
                .eq('id', session.user.id)
                .single();
            
            if (profileData && profileData.courses_selection && profileData.courses_selection.length > 0) {
                console.log('Selected courses from profile:', profileData.courses_selection);
                
                // Since year might be undefined, let's check with and without year
                const isAlreadySelected = profileData.courses_selection.some(selectedCourse => {
                    console.log('Comparing:', selectedCourse.code, 'vs', courseCode, '|', selectedCourse.year, 'vs', courseYear);
                    
                    // Primary check: match by course code and year (if year is available)
                    if (courseYear && courseYear !== undefined) {
                        return selectedCourse.code === courseCode && selectedCourse.year === courseYear;
                    }
                    
                    // Fallback: match by course code only (since year might not be available in course object)
                    return selectedCourse.code === courseCode;
                });
                
                console.log('Is course already selected?', isAlreadySelected);
                return isAlreadySelected;
            }
            
            console.log('No selected courses found - showing as available');
            return false;
            
        } catch (error) {
            console.error('Error checking course selection:', error);
            return false; // Assume available on error
        }
    }

    // Check for time conflict and set appropriate color
    const hasTimeConflict = await checkTimeConflict(course.time_slot, course.course_code, course.academic_year);
    const timeBackgroundColor = hasTimeConflict ? '#ED7F81' : '#92ECB0'; // Red for already selected, Green for available

    classContent.innerHTML = `
        <h2>${course.title}</h2>
        <div class="class-info-container">
            <div class="class-info-1">
                <div class="class-component"><p>Professor</p><h3>${course.professor}</h3></div>
                <div class="class-component"><p>Course Code</p><h3>${course.course_code}</h3></div>
                <div class="class-component"><p>Time</p><div class="class-component-label" style="background: ${timeBackgroundColor};">${course.time_slot.replace(/曜日(\d+)講時/, ` Day Period $1`).replace(/Mon /g, 'Monday ').replace(/Tue /g, 'Tuesday ').replace(/Wed /g, 'Wednesday ').replace(/Thu /g, 'Thursday ').replace(/Fri /g, 'Friday ')}</div></div>
                <div class="class-component"><p>Location</p><h3>${course.location || 'TBA'}</h3></div>
            </div>
            <div class="class-info-2">
                <div class="class-component"><p>Course type</p><div class="class-component-label" style="background: ${courseColor};">${courseType}</div></div>
                <div class="class-component"><p>Syllabus Link</p><button id="external-link-btn" onclick="window.open('${course.url}', '_blank')">University Page</button></div>
            </div>
        </div>
    `;

    classInfo.classList.add("show");
    document.body.style.overflow = "hidden";
    
    // Show background with fade-in animation
    setTimeout(() => {
        classInfoBackground.style.opacity = "1";
    }, 10);

    if (!classClose.dataset.listenerAttached) {
        classClose.addEventListener("click", function() {
            const currentBackground = document.getElementById("class-info-background");
            classInfo.classList.remove("show");
            document.body.style.overflow = "auto";
            
            if (currentBackground) {
                currentBackground.style.opacity = "0";
                // Remove background after animation
                setTimeout(() => {
                    if (currentBackground.parentNode) {
                        currentBackground.parentNode.removeChild(currentBackground);
                    }
                }, 300);
            }
        });
        classClose.dataset.listenerAttached = "true";
    }
}
