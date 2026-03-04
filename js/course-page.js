import { fetchAvailableSemesters, fetchCourseData, openCourseInfoMenu } from "./shared.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
import { openSemesterMobileSheet } from "./semester-mobile-sheet.js";

const COURSE_PAGE_SEARCH_PREFILL_KEY = "ila_courses_search_prefill";
let hasCoursePageStickyOffsetListeners = false;
let hasCoursePageFooterDockListeners = false;

function normalizeTerm(term) {
  if (!term) return null;
  const lower = term.toLowerCase();
  if (lower === "fall") return "Fall";
  if (lower === "spring") return "Spring";
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function getCourseParams() {
  const match = getCurrentAppPath().match(/^\/courses?\/([^\/]+)\/(\d{4})\/([^\/]+)$/);
  if (!match) return null;
  const [, courseCode, year, term] = match;
  return {
    courseCode,
    year: parseInt(year, 10),
    term: normalizeTerm(term)
  };
}

function parseSemesterValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return { term: null, year: null };
  const [term, yearText] = raw.split("-");
  const year = parseInt(yearText, 10);
  return {
    term: normalizeTerm(term),
    year: Number.isFinite(year) ? year : null
  };
}

function normalizeCourseCode(code) {
  return String(code || "").replace(/[^\d]/g, "");
}

function seedCoursesSearchPrefill(payload) {
  try {
    const query = String(payload?.query || "").trim();
    if (!query) return;

    const year = Number(payload?.year);
    const term = normalizeTerm(payload?.term);

    window.sessionStorage.setItem(COURSE_PAGE_SEARCH_PREFILL_KEY, JSON.stringify({
      query,
      year: Number.isFinite(year) ? year : null,
      term: term || null,
      createdAt: Date.now()
    }));
  } catch (error) {
    console.warn("Unable to store course-page search prefill:", error);
  }
}

function navigateToCourses() {
  if (window.router?.navigate) {
    window.router.navigate("/courses");
  } else {
    window.location.href = withBase("/courses");
  }
}

function setupCoursePageSearch({
  searchForm,
  searchInput,
  fallbackQuery,
  activeYear,
  activeTerm
}) {
  if (!searchForm || !searchInput) return;

  const submitHandler = (event) => {
    event.preventDefault();
    const query = String(searchInput.value || "").trim() || String(fallbackQuery || "").trim();
    if (!query) return;
    seedCoursesSearchPrefill({
      query,
      year: activeYear,
      term: activeTerm
    });
    navigateToCourses();
  };

  searchForm.addEventListener("submit", submitHandler);
}

function setupCoursePageSearchModal({
  triggerButton,
  searchContainer,
  searchBackground,
  searchModal,
  searchInput,
  searchSubmit,
  searchCancel,
  fallbackQuery,
  activeYear,
  activeTerm
}) {
  if (!triggerButton || !searchContainer || !searchModal || !searchInput || !searchSubmit || !searchCancel) {
    return;
  }

  let closeTimer = null;
  const isMobileViewport = () => window.innerWidth <= 1023;

  const clearCloseTimer = () => {
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const openModal = () => {
    clearCloseTimer();
    searchContainer.classList.remove("hidden");
    requestAnimationFrame(() => {
      searchModal.classList.add("show");
    });

    if (isMobileViewport()) {
      document.body.classList.add("modal-open");
      if (searchBackground && typeof window.addSwipeToCloseSimple === "function") {
        window.addSwipeToCloseSimple(searchModal, searchBackground, () => {
          clearCloseTimer();
          searchContainer.classList.add("hidden");
          document.body.classList.remove("modal-open");
          searchModal.classList.remove("show");
        });
      }
    }

    window.setTimeout(() => {
      searchInput.focus();
    }, 100);
  };

  const closeModal = () => {
    clearCloseTimer();
    searchModal.classList.remove("show");
    searchModal.classList.remove("swiping");
    searchModal.style.removeProperty("--modal-translate-y");
    searchModal.style.removeProperty("transition");
    searchModal.style.removeProperty("opacity");
    if (searchBackground) {
      searchBackground.style.removeProperty("transition");
      searchBackground.style.removeProperty("opacity");
    }
    document.body.classList.remove("modal-open");

    if (isMobileViewport()) {
      closeTimer = window.setTimeout(() => {
        searchContainer.classList.add("hidden");
      }, 320);
      return;
    }

    searchContainer.classList.add("hidden");
  };

  const submitSearch = () => {
    const query = String(searchInput.value || "").trim() || String(fallbackQuery || "").trim();
    if (!query) return;

    seedCoursesSearchPrefill({
      query,
      year: activeYear,
      term: activeTerm
    });

    searchModal.classList.remove("show");
    searchModal.classList.remove("swiping");
    searchModal.style.removeProperty("--modal-translate-y");
    searchModal.style.removeProperty("transition");
    searchModal.style.removeProperty("opacity");
    if (searchBackground) {
      searchBackground.style.removeProperty("transition");
      searchBackground.style.removeProperty("opacity");
    }
    searchContainer.classList.add("hidden");
    document.body.classList.remove("modal-open");
    navigateToCourses();
  };

  triggerButton.addEventListener("click", (event) => {
    event.preventDefault();
    openModal();
  });

  searchSubmit.addEventListener("click", (event) => {
    event.preventDefault();
    submitSearch();
  });

  searchCancel.addEventListener("click", (event) => {
    event.preventDefault();
    closeModal();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  });

  if (searchBackground) {
    searchBackground.addEventListener("click", (event) => {
      if (event.target === searchBackground) {
        closeModal();
      }
    });
  }
}

function updateCoursePageStickyOffset() {
  const root = document.documentElement;
  if (!root) return;

  if (window.innerWidth > 1023) {
    root.style.removeProperty("--course-page-sticky-top");
    return;
  }

  const toolbarShell = document.querySelector(".course-page-toolbar-shell");
  let stickyTop = 0;

  if (toolbarShell) {
    stickyTop += toolbarShell.getBoundingClientRect().height;
  }

  root.style.setProperty("--course-page-sticky-top", `${Math.round(stickyTop)}px`);
}

function setupCoursePageStickyOffsetObservers() {
  updateCoursePageStickyOffset();

  if (hasCoursePageStickyOffsetListeners) return;
  hasCoursePageStickyOffsetListeners = true;

  const handleResize = () => {
    updateCoursePageStickyOffset();
  };

  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
}

function syncCoursePageFooterDock() {
  const classInfo = document.getElementById("class-info");
  const footer = document.getElementById("course-info-footer");
  const dock = document.getElementById("course-page-footer-dock");

  if (!classInfo || !footer || !dock) return;

  const isDedicatedCoursePage = document.body.classList.contains("course-page-mode");
  const isMobileViewport = window.innerWidth <= 1023;
  const shouldUseDock = isDedicatedCoursePage && isMobileViewport;

  if (shouldUseDock) {
    if (footer.parentElement !== dock) {
      dock.appendChild(footer);
    }
    dock.classList.add("is-active");
    return;
  }

  if (footer.parentElement !== classInfo) {
    classInfo.appendChild(footer);
  }
  dock.classList.remove("is-active");
}

function setupCoursePageFooterDock() {
  syncCoursePageFooterDock();

  if (hasCoursePageFooterDockListeners) return;
  hasCoursePageFooterDockListeners = true;

  const handleDockResize = () => {
    syncCoursePageFooterDock();
  };

  window.addEventListener("resize", handleDockResize);
  window.addEventListener("orientationchange", handleDockResize);
}

function setupCoursePageCustomSelect(rootEl) {
  if (!rootEl) return;

  const trigger = rootEl.querySelector(".custom-select-trigger");
  const options = rootEl.querySelector(".custom-select-options");
  const targetSelectId = rootEl.dataset.target;
  const targetSelect = document.getElementById(targetSelectId);
  if (!trigger || !options || !targetSelect) return;

  const close = () => rootEl.classList.remove("open");

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (openSemesterMobileSheet({ targetSelect })) {
      rootEl.classList.remove("open");
      return;
    }

    rootEl.classList.toggle("open");
  });

  options.addEventListener("click", (event) => {
    const option = event.target.closest(".custom-select-option");
    if (!option) return;
    const value = String(option.dataset.value || "").trim();
    if (!value) return;
    targetSelect.value = value;
    targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  });

  document.addEventListener("click", (event) => {
    if (!rootEl.contains(event.target)) close();
  });
}

function renderCoursePageSemesterOptions({
  semesters,
  currentValue,
  targetSelect,
  customSelectRoot
}) {
  if (!targetSelect || !customSelectRoot) return;

  const optionsContainer = customSelectRoot.querySelector(".custom-select-options");
  const valueElement = customSelectRoot.querySelector(".custom-select-value");
  if (!optionsContainer || !valueElement) return;

  targetSelect.innerHTML = "";
  optionsContainer.innerHTML = "";

  semesters.forEach((semester) => {
    const value = `${semester.term}-${semester.year}`;
    const nativeOption = document.createElement("option");
    nativeOption.value = value;
    nativeOption.textContent = semester.label;
    targetSelect.appendChild(nativeOption);

    const customOption = document.createElement("div");
    customOption.className = "custom-select-option";
    customOption.dataset.value = value;
    customOption.textContent = semester.label;
    optionsContainer.appendChild(customOption);
  });

  const selectedValue = semesters.some((semester) => `${semester.term}-${semester.year}` === currentValue)
    ? currentValue
    : `${semesters[0]?.term || "Fall"}-${semesters[0]?.year || new Date().getFullYear()}`;
  targetSelect.value = selectedValue;

  const syncVisual = () => {
    const selectedOption = Array.from(optionsContainer.querySelectorAll(".custom-select-option")).find(
      (option) => option.dataset.value === targetSelect.value
    );
    optionsContainer.querySelectorAll(".custom-select-option").forEach((option) => {
      option.classList.toggle("selected", option.dataset.value === targetSelect.value);
    });
    if (selectedOption) {
      valueElement.textContent = selectedOption.textContent;
    }
  };

  syncVisual();
  targetSelect.addEventListener("change", syncVisual);
}

async function setupCoursePageSemesterSelector({
  course,
  currentYear,
  currentTerm
}) {
  const targetSelect = document.getElementById("course-page-semester-select");
  const customSelectRoot = document.querySelector(".course-page-semester-custom-select");
  if (!targetSelect || !customSelectRoot) return;

  const currentValue = `${currentTerm}-${currentYear}`;
  let semesters = [];

  try {
    semesters = await fetchAvailableSemesters();
  } catch (error) {
    console.warn("Failed to load semesters for course page toolbar:", error);
  }

  if (!Array.isArray(semesters) || semesters.length === 0) {
    semesters = [{ term: currentTerm, year: currentYear, label: `${currentTerm} ${currentYear}` }];
  }

  renderCoursePageSemesterOptions({
    semesters,
    currentValue,
    targetSelect,
    customSelectRoot
  });

  setupCoursePageCustomSelect(customSelectRoot);

  targetSelect.addEventListener("change", async () => {
    const { term, year } = parseSemesterValue(targetSelect.value);
    if (!term || !year) return;
    if (term === currentTerm && year === currentYear) return;

    let nextCourse = null;
    try {
      const semesterCourses = await fetchCourseData(year, term);
      const normalizedCurrentCode = normalizeCourseCode(course.course_code);
      nextCourse = semesterCourses.find((semesterCourse) => {
        const semesterCode = String(semesterCourse?.course_code || "");
        return semesterCode === String(course.course_code || "") ||
          normalizeCourseCode(semesterCode) === normalizedCurrentCode;
      }) || null;
    } catch (error) {
      console.error("Failed to load semester courses for course-page selector:", error);
    }

    if (nextCourse?.course_code) {
      const normalizedTerm = term.toLowerCase();
      const targetPath = `/courses/${encodeURIComponent(nextCourse.course_code)}/${year}/${normalizedTerm}`;
      if (window.router?.navigate) {
        window.router.navigate(targetPath);
      } else {
        window.location.href = withBase(targetPath);
      }
      return;
    }

    // Fallback: jump to courses and prefill search with this course title in the selected semester.
    seedCoursesSearchPrefill({
      query: String(course?.title || course?.course_code || "").trim(),
      year,
      term
    });
    navigateToCourses();
  });
}

function toggleCoursePageSkeleton(isLoading) {
  const pageRoot = document.getElementById("course-page");
  const skeleton = document.getElementById("course-page-skeleton");
  const classInfo = document.getElementById("class-info");

  if (pageRoot) {
    pageRoot.classList.toggle("is-loading", Boolean(isLoading));
  }

  if (skeleton) {
    skeleton.hidden = !isLoading;
    skeleton.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }

  if (classInfo) {
    classInfo.setAttribute("aria-hidden", isLoading ? "true" : "false");
    if (isLoading) {
      classInfo.style.display = "none";
      classInfo.classList.remove("show");
    } else {
      classInfo.style.removeProperty("display");
    }
  }
}

export async function initializeCoursePage() {
  const card = document.getElementById("course-page-card");
  const searchForm = document.getElementById("course-page-search-form");
  const searchInput = document.getElementById("course-page-search-input");
  const mobileSearchTrigger = document.getElementById("course-page-search-trigger");
  const searchModalContainer = document.getElementById("course-page-search-container");
  const searchModalBackground = document.getElementById("course-page-search-background");
  const searchModal = document.getElementById("course-page-search-modal");
  const searchModalInput = document.getElementById("course-page-modal-search-input");
  const searchModalSubmit = document.getElementById("course-page-modal-search-submit");
  const searchModalCancel = document.getElementById("course-page-modal-search-cancel");

  setupCoursePageStickyOffsetObservers();
  setupCoursePageFooterDock();

  const params = getCourseParams();
  if (!params || !card) {
    if (card) {
      card.innerHTML = "<div class=\"course-page-error\">Invalid course URL.</div>";
    }
    return;
  }

  const { courseCode, year, term } = params;
  toggleCoursePageSkeleton(true);

  try {
    const courses = await fetchCourseData(year, term);
    const normalizedCode = normalizeCourseCode(courseCode);
    const course = courses.find(c =>
      String(c.course_code || '') === String(courseCode) ||
      normalizeCourseCode(c.course_code) === normalizedCode
    );

    if (!course) {
      card.innerHTML = "<div class=\"course-page-error\">Course not found.</div>";
      return;
    }

    setupCoursePageSearch({
      searchForm,
      searchInput,
      fallbackQuery: course.title || course.course_code,
      activeYear: year,
      activeTerm: term
    });
    setupCoursePageSearchModal({
      triggerButton: mobileSearchTrigger,
      searchContainer: searchModalContainer,
      searchBackground: searchModalBackground,
      searchModal,
      searchInput: searchModalInput,
      searchSubmit: searchModalSubmit,
      searchCancel: searchModalCancel,
      fallbackQuery: course.title || course.course_code,
      activeYear: year,
      activeTerm: term
    });

    await setupCoursePageSemesterSelector({
      course,
      currentYear: year,
      currentTerm: term
    });

    document.body.classList.add('course-page-mode');

    await openCourseInfoMenu(course, false, { presentation: 'page' });
    syncCoursePageFooterDock();
    updateCoursePageStickyOffset();

    const classInfo = document.getElementById("class-info");
    const classContent = document.getElementById("class-content");
    if (classInfo) {
      classInfo.classList.add("show");
      classInfo.style.opacity = "1";
      classInfo.style.transform = "none";
      toggleCoursePageSkeleton(false);
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
  } finally {
    if (document.getElementById("class-info")?.classList.contains("show")) return;
    toggleCoursePageSkeleton(false);
  }
}

// Standalone course.html entrypoint initializes itself.
// In SPA navigation, router calls initializeCoursePage() explicitly.
if (!window.router) {
  initializeCoursePage();
}
