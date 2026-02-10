import { fetchCourseData, openCourseInfoMenu } from "/js/shared.js";

function normalizeTerm(term) {
  if (!term) return null;
  const lower = term.toLowerCase();
  if (lower === "fall") return "Fall";
  if (lower === "spring") return "Spring";
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function getCourseParams() {
  const match = window.location.pathname.match(/^\/course\/([^\/]+)\/(\d{4})\/([^\/]+)$/);
  if (!match) return null;
  const [, courseCode, year, term] = match;
  return {
    courseCode,
    year: parseInt(year, 10),
    term: normalizeTerm(term)
  };
}

async function initCoursePage() {
  const card = document.getElementById("course-page-card");
  const title = document.getElementById("course-page-title");
  const backBtn = document.getElementById("course-page-back");

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "/courses";
    });
  }

  const params = getCourseParams();
  if (!params || !card) {
    if (card) {
      card.innerHTML = "<div class=\"course-page-error\">Invalid course URL.</div>";
    }
    return;
  }

  const { courseCode, year, term } = params;

  try {
    const courses = await fetchCourseData(year, term);
    const normalizedCode = String(courseCode).replace(/[^\d]/g, '');
    const course = courses.find(c =>
      String(c.course_code || '') === String(courseCode) ||
      String(c.course_code || '').replace(/[^\d]/g, '') === normalizedCode
    );

    if (!course) {
      card.innerHTML = "<div class=\"course-page-error\">Course not found.</div>";
      if (title) title.textContent = "Course Not Found";
      return;
    }

    if (title) title.textContent = course.title || "Course";
    document.body.classList.add('course-page-mode');

    await openCourseInfoMenu(course, false, { presentation: 'page' });

    const classInfo = document.getElementById('class-info');
    const classContent = document.getElementById('class-content');
    const loading = document.getElementById('course-page-loading');
    if (classInfo) {
      classInfo.classList.add('show');
      classInfo.style.opacity = '1';
      classInfo.style.transform = 'none';
      classInfo.style.display = 'flex';
      if (loading) {
        loading.style.display = 'none';
      }
    } else {
      console.error('Course page: class-info element missing');
      card.innerHTML = "<div class=\"course-page-error\">Course info UI not found.</div>";
    }

    if (!classContent) {
      console.error('Course page: class-content element missing');
    }
  } catch (error) {
    console.error("Error loading course page:", error);
    card.innerHTML = "<div class=\"course-page-error\">Failed to load course.</div>";
  }
}

initCoursePage();
