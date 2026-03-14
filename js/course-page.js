import { fetchAvailableSemesters, fetchCourseData, openCourseInfoMenu, formatProfessorDisplayName } from "./shared.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
import { openSemesterMobileSheet } from "./semester-mobile-sheet.js";

const COURSE_PAGE_SEARCH_PREFILL_KEY = "ila_courses_search_prefill";
const COURSE_PAGE_OPEN_REVIEW_INTENT_KEY = "ila_open_review_from_suggestion";
let hasCoursePageStickyOffsetListeners = false;
let hasCoursePageFooterDockListeners = false;
let coursePageStickyOffsetRaf = 0;
let coursePageStickyOffsetMutationObserver = null;
let coursePageInitRequestVersion = 0;

function isCourseDetailPath(path = getCurrentAppPath()) {
  return /^\/courses?\/[^\/]+\/\d{4}\/[^\/]+$/.test(String(path || ""));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatches(value, query) {
  const text = String(value || "");
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery || normalizedQuery.length < 2) {
    return escapeHtml(text);
  }

  const pattern = new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig");
  return text
    .split(pattern)
    .map((part, index) => {
      if (index % 2 === 1) {
        return `<mark style="background: #E3D5E9; padding: 0 2px; border-radius: 3px;">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

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

function normalizeCourseCodeForIntent(code) {
  return String(code || "").trim().toUpperCase();
}

function maybeConsumeOpenReviewIntent(course, routeYear, routeTerm) {
  let payload = null;
  try {
    const raw = sessionStorage.getItem(COURSE_PAGE_OPEN_REVIEW_INTENT_KEY);
    if (!raw) return false;
    payload = JSON.parse(raw);
  } catch (_) {
    try {
      sessionStorage.removeItem(COURSE_PAGE_OPEN_REVIEW_INTENT_KEY);
    } catch (_) { }
    return false;
  }

  const timestamp = Number(payload?.timestamp) || 0;
  const isExpired = timestamp > 0 && (Date.now() - timestamp) > (5 * 60 * 1000);
  if (isExpired) {
    try {
      sessionStorage.removeItem(COURSE_PAGE_OPEN_REVIEW_INTENT_KEY);
    } catch (_) { }
    return false;
  }

  const intentCode = normalizeCourseCodeForIntent(payload?.courseCode);
  const intentYear = Number(payload?.year) || null;
  const intentTerm = normalizeTerm(payload?.term);
  const currentCode = normalizeCourseCodeForIntent(course?.course_code);
  const currentYear = Number(routeYear) || Number(course?.academic_year) || null;
  const currentTerm = normalizeTerm(routeTerm || course?.term);

  const matches = Boolean(intentCode)
    && intentCode === currentCode
    && intentYear === currentYear
    && intentTerm === currentTerm;

  if (!matches) {
    return false;
  }

  try {
    sessionStorage.removeItem(COURSE_PAGE_OPEN_REVIEW_INTENT_KEY);
  } catch (_) { }
  return true;
}

function buildCoursePagePath(courseCode, year, term) {
  const normalizedTerm = normalizeTerm(term);
  const encodedCode = encodeURIComponent(String(courseCode || "").trim());
  const encodedYear = encodeURIComponent(String(year || "").trim());
  const encodedTerm = encodeURIComponent(String(normalizedTerm || term || "").toLowerCase());
  return `/courses/${encodedCode}/${encodedYear}/${encodedTerm}`;
}

function setupCoursePageAutocomplete({
  input,
  container,
  courses,
  activeYear,
  activeTerm,
  onBeforeNavigate
}) {
  if (!input || !container || !Array.isArray(courses)) return;
  if (input.dataset.autocompleteBound === "true") return;
  input.dataset.autocompleteBound = "true";

  const stopScrollChain = (event) => {
    event.stopPropagation();
  };
  container.addEventListener("wheel", stopScrollChain, { passive: false });
  container.addEventListener("touchmove", stopScrollChain, { passive: true });

  let highlightedIndex = -1;
  let suggestions = [];

  const close = () => {
    highlightedIndex = -1;
    suggestions = [];
    container.innerHTML = "";
    container.style.display = "none";
  };

  const navigateToCourse = (course) => {
    const courseCode = String(course?.course_code || "").trim();
    if (!courseCode) return;
    if (typeof onBeforeNavigate === "function") {
      onBeforeNavigate();
    }
    const targetPath = buildCoursePagePath(courseCode, activeYear, activeTerm);
    if (window.router?.navigate) {
      window.router.navigate(targetPath);
    } else {
      window.location.href = withBase(targetPath);
    }
  };

  const render = () => {
    const queryText = String(input.value || "").trim();
    const query = queryText.toLowerCase();
    if (query.length < 2) {
      close();
      return;
    }

    suggestions = courses
      .filter((course) => {
        const title = String(course?.title || "").toLowerCase();
        const professorRaw = String(course?.professor || "").toLowerCase();
        const professorRomaji = String(formatProfessorDisplayName(course?.professor || "") || "").toLowerCase();
        const code = String(course?.course_code || "").toLowerCase();
        return title.includes(query) || professorRaw.includes(query) || professorRomaji.includes(query) || code.includes(query);
      })
      .slice(0, 6);

    if (!suggestions.length) {
      close();
      return;
    }

    if (highlightedIndex >= suggestions.length) {
      highlightedIndex = -1;
    }

    const itemsMarkup = suggestions.map((course, index) => {
      const title = highlightMatches(course?.title || "", queryText);
      const professor = highlightMatches(formatProfessorDisplayName(course?.professor || ""), queryText);
      const code = highlightMatches(course?.course_code || "", queryText);
      const highlightedClass = highlightedIndex === index ? " highlighted" : "";
      return `
        <div class="search-autocomplete-item${highlightedClass}" data-autocomplete-index="${index}">
          <div class="item-title">${title}</div>
          <div class="item-details">
            <span class="item-code">${code}</span>
            <span class="item-professor">${professor}</span>
          </div>
        </div>
      `;
    }).join("");

    if (container.classList.contains("search-pill-autocomplete")) {
      container.innerHTML = `<div class="search-pill-autocomplete-inner">${itemsMarkup}</div>`;
    } else {
      container.innerHTML = itemsMarkup;
    }

    container.style.display = "block";

    container.querySelectorAll(".search-autocomplete-item").forEach((itemEl) => {
      itemEl.addEventListener("click", () => {
        const index = Number(itemEl.getAttribute("data-autocomplete-index"));
        if (!Number.isInteger(index)) return;
        const selected = suggestions[index];
        if (!selected) return;
        input.value = String(selected?.title || selected?.course_code || "");
        close();
        navigateToCourse(selected);
      });
    });
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("click", render);

  input.addEventListener("keydown", (event) => {
    if (container.style.display !== "block" || !suggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % suggestions.length;
      render();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightedIndex = highlightedIndex <= 0 ? suggestions.length - 1 : highlightedIndex - 1;
      render();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      const selected = suggestions[highlightedIndex];
      if (!selected) return;
      input.value = String(selected?.title || selected?.course_code || "");
      close();
      navigateToCourse(selected);
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target === input) return;
    if (container.contains(event.target)) return;
    close();
  });
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

  const appHeader = document.querySelector(".app-header");
  const toolbarShell = document.querySelector(".course-page-toolbar-shell");
  const isHeaderVisible = Boolean(
    appHeader &&
    !appHeader.classList.contains("app-header--hidden") &&
    window.getComputedStyle(appHeader).position === "fixed"
  );
  const isToolbarVisible = Boolean(
    toolbarShell &&
    !toolbarShell.classList.contains("app-mobile-toolbar--hidden") &&
    window.getComputedStyle(toolbarShell).position === "fixed"
  );

  const headerHeight = isHeaderVisible
    ? (appHeader.getBoundingClientRect().height || 0)
    : 0;
  const toolbarHeight = isToolbarVisible
    ? (toolbarShell.getBoundingClientRect().height || 0)
    : 0;
  // Subtract the shared divider seam so tabs sit flush under the toolbar stack.
  const stickyTop = Math.max(0, (headerHeight + toolbarHeight) - 5);

  root.style.setProperty("--course-page-sticky-top", `${Math.round(stickyTop)}px`);
}

function setupCoursePageStickyOffsetObservers() {
  updateCoursePageStickyOffset();

  if (hasCoursePageStickyOffsetListeners) return;
  hasCoursePageStickyOffsetListeners = true;

  const requestStickyOffsetUpdate = () => {
    if (coursePageStickyOffsetRaf) return;
    coursePageStickyOffsetRaf = window.requestAnimationFrame(() => {
      coursePageStickyOffsetRaf = 0;
      updateCoursePageStickyOffset();
    });
  };

  const handleResize = () => {
    updateCoursePageStickyOffset();
  };

  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
  window.addEventListener("scroll", requestStickyOffsetUpdate, { passive: true });
  document.addEventListener("scroll", requestStickyOffsetUpdate, { passive: true, capture: true });
  document.getElementById("app-content")?.addEventListener("scroll", requestStickyOffsetUpdate, { passive: true });

  if (typeof MutationObserver === "function") {
    coursePageStickyOffsetMutationObserver = new MutationObserver(requestStickyOffsetUpdate);
    const appHeader = document.querySelector(".app-header");
    const toolbarShell = document.querySelector(".course-page-toolbar-shell");
    if (appHeader) {
      coursePageStickyOffsetMutationObserver.observe(appHeader, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    }
    if (toolbarShell) {
      coursePageStickyOffsetMutationObserver.observe(toolbarShell, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    }
  }
}

function syncCoursePageFooterDock() {
  const pageRoot = document.getElementById("course-page");
  const classInfo = document.getElementById("class-info");
  const footer = document.getElementById("course-info-footer");
  const dock = document.getElementById("course-page-footer-dock");

  if (!classInfo || !footer || !dock) return;

  const isDedicatedCoursePage = document.body.classList.contains("course-page-mode");
  const isMobileViewport = window.innerWidth <= 1023;
  const isLoading = pageRoot?.classList.contains("is-loading") === true;
  const hasHydratedFooterLayout = Boolean(footer.querySelector(".course-info-footer-layout"));
  const shouldUseDock = isDedicatedCoursePage && isMobileViewport && !isLoading && hasHydratedFooterLayout;

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

function bindContainedScroll(optionsEl) {
  if (!optionsEl || optionsEl.dataset.scrollContainBound === "true") return;
  optionsEl.dataset.scrollContainBound = "true";

  const canScroll = () => optionsEl.scrollHeight > (optionsEl.clientHeight + 1);
  const atTop = () => optionsEl.scrollTop <= 0;
  const atBottom = () => (optionsEl.scrollTop + optionsEl.clientHeight) >= (optionsEl.scrollHeight - 1);
  let lastTouchY = null;

  optionsEl.addEventListener("wheel", (event) => {
    event.stopPropagation();
    if (!canScroll()) {
      event.preventDefault();
      return;
    }
    if ((event.deltaY < 0 && atTop()) || (event.deltaY > 0 && atBottom())) {
      event.preventDefault();
    }
  }, { passive: false });

  optionsEl.addEventListener("touchstart", (event) => {
    if (!event.touches || !event.touches.length) return;
    lastTouchY = event.touches[0].clientY;
  }, { passive: true });

  optionsEl.addEventListener("touchmove", (event) => {
    event.stopPropagation();
    if (!event.touches || !event.touches.length || lastTouchY === null) return;

    const currentY = event.touches[0].clientY;
    const deltaY = lastTouchY - currentY;
    lastTouchY = currentY;

    if (!canScroll()) {
      event.preventDefault();
      return;
    }
    if ((deltaY < 0 && atTop()) || (deltaY > 0 && atBottom())) {
      event.preventDefault();
    }
  }, { passive: false });

  optionsEl.addEventListener("touchend", () => {
    lastTouchY = null;
  }, { passive: true });

  optionsEl.addEventListener("touchcancel", () => {
    lastTouchY = null;
  }, { passive: true });
}

function setupCoursePageCustomSelect(rootEl) {
  if (!rootEl) return;

  const trigger = rootEl.querySelector(".custom-select-trigger");
  const options = rootEl.querySelector(".custom-select-options");
  const targetSelectId = rootEl.dataset.target;
  const targetSelect = document.getElementById(targetSelectId);
  if (!trigger || !options || !targetSelect) return;
  bindContainedScroll(options);

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
    customOption.className = "ui-select__option custom-select-option";
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
  const shouldShowSkeleton = Boolean(isLoading);

  if (pageRoot) {
    pageRoot.classList.toggle("is-loading", shouldShowSkeleton);
  }

  if (skeleton) {
    skeleton.hidden = !shouldShowSkeleton;
    skeleton.setAttribute("aria-hidden", shouldShowSkeleton ? "false" : "true");
  }

  if (classInfo) {
    classInfo.setAttribute("aria-hidden", shouldShowSkeleton ? "true" : "false");
    if (shouldShowSkeleton) {
      classInfo.style.display = "none";
      classInfo.classList.remove("show");
    } else {
      classInfo.style.removeProperty("display");
    }
  }

  syncCoursePageFooterDock();
}

export async function initializeCoursePage() {
  const initRequestVersion = ++coursePageInitRequestVersion;
  const initialPath = getCurrentAppPath();
  const isStaleInitialization = () => {
    if (initRequestVersion !== coursePageInitRequestVersion) return true;
    const currentPath = getCurrentAppPath();
    if (!isCourseDetailPath(initialPath)) return true;
    if (!isCourseDetailPath(currentPath)) return true;
    if (currentPath !== initialPath) return true;
    if (!document.getElementById("course-page")) return true;
    return false;
  };

  if (isStaleInitialization()) return;

  // Apply course-page shell classes immediately to avoid first-frame layout snap.
  document.body.classList.add("course-page-mode");
  if (window.innerWidth <= 1023) {
    document.body.classList.add("mobile-page-header-sticky");
  }

  const card = document.getElementById("course-page-card");
  const searchForm = document.getElementById("course-page-search-form");
  const searchInput = document.getElementById("course-page-search-input");
  const searchAutocomplete = document.getElementById("course-page-search-autocomplete");
  const mobileSearchTrigger = document.getElementById("course-page-search-trigger");
  const searchModalContainer = document.getElementById("course-page-search-container");
  const searchModalBackground = document.getElementById("course-page-search-background");
  const searchModal = document.getElementById("course-page-search-modal");
  const searchModalInput = document.getElementById("course-page-modal-search-input");
  const searchModalAutocomplete = document.getElementById("course-page-modal-search-autocomplete");
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
    if (isStaleInitialization()) return;

    const normalizedCode = normalizeCourseCode(courseCode);
    const course = courses.find(c =>
      String(c.course_code || '') === String(courseCode) ||
      normalizeCourseCode(c.course_code) === normalizedCode
    );

    if (isStaleInitialization()) return;
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
    setupCoursePageAutocomplete({
      input: searchInput,
      container: searchAutocomplete,
      courses,
      activeYear: year,
      activeTerm: term
    });
    setupCoursePageAutocomplete({
      input: searchModalInput,
      container: searchModalAutocomplete,
      courses,
      activeYear: year,
      activeTerm: term,
      onBeforeNavigate: () => {
        searchModal.classList.remove("show");
        searchModalContainer?.classList.add("hidden");
        document.body.classList.remove("modal-open");
      }
    });

    await setupCoursePageSemesterSelector({
      course,
      currentYear: year,
      currentTerm: term
    });
    if (isStaleInitialization()) return;

    await openCourseInfoMenu(course, false, { presentation: 'page' });
    if (isStaleInitialization()) return;
    if (maybeConsumeOpenReviewIntent(course, year, term) && typeof window.openAddReviewModal === 'function') {
      await window.openAddReviewModal(
        String(course.course_code || ''),
        Number(course.academic_year) || year,
        normalizeTerm(course.term || term),
        String(course.title || '')
      );
    }
    if (isStaleInitialization()) return;
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
    if (isStaleInitialization()) return;
    console.error("Error loading course page:", error);
    card.innerHTML = "<div class=\"course-page-error\">Failed to load course.</div>";
  } finally {
    if (isStaleInitialization()) return;
    if (document.getElementById("class-info")?.classList.contains("show")) return;
    toggleCoursePageSkeleton(false);
  }
}

// Standalone course.html entrypoint initializes itself.
// In SPA navigation, router calls initializeCoursePage() explicitly.
if (!window.router) {
  initializeCoursePage();
}
