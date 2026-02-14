// Calendar Page Component - Dedicated component for calendar page with native-style mobile UX
import { fetchCourseData, openCourseInfoMenu, getCourseColorByType } from "./shared.js";
import { supabase } from "../supabase.js";

class CalendarPageComponent extends HTMLElement {
  constructor() {
    super();

    this.isInitialized = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.isMobile = false;

    this.dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    this.dayLongNames = {
      Mon: "Monday",
      Tue: "Tuesday",
      Wed: "Wednesday",
      Thu: "Thursday",
      Fri: "Friday"
    };
    this.dayShortButtons = {
      Mon: "M",
      Tue: "T",
      Wed: "W",
      Thu: "T",
      Fri: "F"
    };

    this.periodDefinitions = [
      { number: 1, label: "period 1", timeRange: "09:00 - 10:30", start: 9 * 60, end: 10 * 60 + 30 },
      { number: 2, label: "period 2", timeRange: "10:45 - 12:15", start: 10 * 60 + 45, end: 12 * 60 + 15 },
      { number: 3, label: "period 3", timeRange: "13:10 - 14:40", start: 13 * 60 + 10, end: 14 * 60 + 40 },
      { number: 4, label: "period 4", timeRange: "14:55 - 16:25", start: 14 * 60 + 55, end: 16 * 60 + 25 },
      { number: 5, label: "period 5", timeRange: "16:40 - 18:10", start: 16 * 60 + 40, end: 18 * 60 + 10 }
    ];

    this.dayIdByEN = {
      Mon: "calendar-monday",
      Tue: "calendar-tuesday",
      Wed: "calendar-wednesday",
      Thu: "calendar-thursday",
      Fri: "calendar-friday"
    };

    this.mobileCoursesBySlot = new Map();
    this.mobileCourseLookup = new Map();
    this.expandedMobilePeriodByDay = {};
    this.selectedMobileDayIndex = this.getDefaultMobileDayIndex();

    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchInProgress = false;

    this.innerHTML = `
      <div class="calendar-page-wrapper">
        <div class="calendar-container-main">
          <div class="loading-indicator" id="loading-indicator" style="display: none;"></div>

          <div class="calendar-wrapper">
            <table id="calendar-main">
              <thead>
                <tr>
                  <th><p style="display: none;">empty</p></th>
                  <th id="calendar-monday"><p>Mon</p></th>
                  <th id="calendar-tuesday"><p>Tue</p></th>
                  <th id="calendar-wednesday"><p>Wed</p></th>
                  <th id="calendar-thursday"><p>Thu</p></th>
                  <th id="calendar-friday"><p>Fri</p></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td id="calendar-period-1">
                    <p class="time-full"><small>period 1</small></br>09:00 - 10:30</p>
                    <p class="time-short">1h</p>
                  </td>
                  <td></td><td></td><td></td><td></td><td></td>
                </tr>
                <tr>
                  <td id="calendar-period-2">
                    <p class="time-full"><small>period 2</small></br>10:45 - 12:15</p>
                    <p class="time-short">2h</p>
                  </td>
                  <td></td><td></td><td></td><td></td><td></td>
                </tr>
                <tr>
                  <td id="calendar-period-3">
                    <p class="time-full"><small>period 3</small></br>13:10 - 14:40</p>
                    <p class="time-short">3h</p>
                  </td>
                  <td></td><td></td><td></td><td></td><td></td>
                </tr>
                <tr>
                  <td id="calendar-period-4">
                    <p class="time-full"><small>period 4</small></br>14:55 - 16:25</p>
                    <p class="time-short">4h</p>
                  </td>
                  <td></td><td></td><td></td><td></td><td></td>
                </tr>
                <tr>
                  <td id="calendar-period-5">
                    <p class="time-full"><small>period 5</small></br>16:40 - 18:10</p>
                    <p class="time-short">5h</p>
                  </td>
                  <td></td><td></td><td></td><td></td><td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="calendar-mobile-view" style="display: none;" aria-label="Mobile schedule">
            <div class="calendar-mobile-day-tabs" role="tablist" aria-label="Weekday selector"></div>
            <div class="calendar-mobile-viewport">
              <div class="calendar-mobile-track"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.calendar = this.querySelector("#calendar-main");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.querySelector("#loading-indicator");

    this.calendarWrapper = this.querySelector(".calendar-wrapper");
    this.mobileView = this.querySelector(".calendar-mobile-view");
    this.mobileDayTabs = this.querySelector(".calendar-mobile-day-tabs");
    this.mobileTrack = this.querySelector(".calendar-mobile-track");

    this.displayedYear = null;
    this.displayedTerm = null;

    this.boundResizeHandler = this.handleResize.bind(this);
    this.boundCalendarClickHandler = this.handleCalendarClick.bind(this);
    this.boundMobileClickHandler = this.handleMobileViewClick.bind(this);
    this.boundTouchStartHandler = this.handleTouchStart.bind(this);
    this.boundTouchMoveHandler = this.handleTouchMove.bind(this);
    this.boundTouchEndHandler = this.handleTouchEnd.bind(this);

    this.buildMobileViewSkeleton();

    this.checkMobile();
  }

  connectedCallback() {
    console.log("Calendar page component connected");

    this.calendar.addEventListener("click", this.boundCalendarClickHandler);
    this.mobileView.addEventListener("click", this.boundMobileClickHandler);
    this.mobileView.addEventListener("touchstart", this.boundTouchStartHandler, { passive: true });
    this.mobileView.addEventListener("touchmove", this.boundTouchMoveHandler, { passive: true });
    this.mobileView.addEventListener("touchend", this.boundTouchEndHandler, { passive: true });
    window.addEventListener("resize", this.boundResizeHandler);

    this.initializeCalendar();
    this.setupSearchButtons();

    document.addEventListener("pageLoaded", () => {
      this.checkMobile();
    });
  }

  disconnectedCallback() {
    this.calendar.removeEventListener("click", this.boundCalendarClickHandler);
    this.mobileView.removeEventListener("click", this.boundMobileClickHandler);
    this.mobileView.removeEventListener("touchstart", this.boundTouchStartHandler);
    this.mobileView.removeEventListener("touchmove", this.boundTouchMoveHandler);
    this.mobileView.removeEventListener("touchend", this.boundTouchEndHandler);
    window.removeEventListener("resize", this.boundResizeHandler);
  }

  setupSearchButtons() {
    if (this.searchButtonsInitialized) return;
    this.searchButtonsInitialized = true;

    const searchButtons = document.querySelectorAll(".search-btn");
    const searchContainer = document.querySelector(".search-container");
    const searchModal = document.querySelector(".search-modal");
    const searchBackground = document.querySelector(".search-background");
    const searchCancel = document.getElementById("search-cancel");

    if (!searchContainer || !searchModal || searchButtons.length === 0) return;

    const closeSearchAnimated = (immediate = false) => {
      if (window.innerWidth <= 780) {
        searchModal.classList.remove("show");

        if (immediate) {
          searchContainer.classList.add("hidden");
          document.body.classList.remove("modal-open");
          return;
        }

        setTimeout(() => {
          searchContainer.classList.add("hidden");
          document.body.classList.remove("modal-open");
        }, 320);
        return;
      }

      searchContainer.classList.add("hidden");
    };

    const openSearch = () => {
      searchContainer.classList.remove("hidden");

      if (window.innerWidth <= 780) {
        searchModal.classList.add("show");
        document.body.classList.add("modal-open");

        if (!this.searchSwipeBound && typeof window.addSwipeToCloseSimple === "function" && searchBackground) {
          this.searchSwipeBound = true;
          window.addSwipeToCloseSimple(searchModal, searchBackground, () => {
            closeSearchAnimated(true);
          });
        }
      } else {
        searchModal.classList.add("show");
      }

      const searchInput = document.getElementById("search-input");
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 100);
      }
    };

    const closeSearch = () => {
      closeSearchAnimated();
    };

    searchButtons.forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
      });
    });

    if (searchCancel) {
      searchCancel.addEventListener("click", (event) => {
        event.preventDefault();
        closeSearch();
      });
    }

    if (searchBackground) {
      searchBackground.addEventListener("click", (event) => {
        if (event.target === searchBackground) {
          closeSearch();
        }
      });
    }
  }

  handleResize() {
    this.checkMobile();
  }

  checkMobile() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth <= 780;
    window.isMobile = this.isMobile;

    if (this.isMobile !== wasMobile) {
      this.updateMobileUI(true);
      return;
    }

    if (this.isMobile) {
      this.updateMobileUI(false);
    }
  }

  updateMobileUI(forceReset) {
    if (this.isMobile) {
      if (this.mobileView) this.mobileView.style.display = "flex";
      if (this.calendarWrapper) this.calendarWrapper.style.display = "none";

      if (forceReset) {
        this.selectedMobileDayIndex = this.getDefaultMobileDayIndex();
      }

      this.ensureExpandedPeriodForDay(this.dayOrder[this.selectedMobileDayIndex]);
      this.updateMobileTrackPosition(false);
      this.updateMobileDayButtons();
      this.applyMobileExpandedState();
      return;
    }

    if (this.mobileView) this.mobileView.style.display = "none";
    if (this.calendarWrapper) this.calendarWrapper.style.display = "block";
    this.showAllDays();
  }

  buildMobileViewSkeleton() {
    if (!this.mobileDayTabs || !this.mobileTrack) return;

    this.mobileDayTabs.innerHTML = "";
    this.mobileTrack.innerHTML = "";

    this.dayOrder.forEach((dayCode, dayIndex) => {
      const tabButton = document.createElement("button");
      tabButton.type = "button";
      tabButton.className = "calendar-mobile-day-tab";
      tabButton.dataset.action = "select-day";
      tabButton.dataset.dayIndex = String(dayIndex);
      tabButton.dataset.dayCode = dayCode;
      tabButton.setAttribute("role", "tab");
      tabButton.setAttribute("aria-label", this.dayLongNames[dayCode]);
      tabButton.textContent = this.dayShortButtons[dayCode];
      this.mobileDayTabs.appendChild(tabButton);

      const dayPage = document.createElement("section");
      dayPage.className = "calendar-mobile-day-page";
      dayPage.dataset.dayCode = dayCode;

      const dayShell = document.createElement("div");
      dayShell.className = "calendar-mobile-day-shell";

      this.periodDefinitions.forEach((periodDef) => {
        const periodArticle = document.createElement("article");
        periodArticle.className = "calendar-mobile-period";
        periodArticle.dataset.dayCode = dayCode;
        periodArticle.dataset.periodNumber = String(periodDef.number);

        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "calendar-mobile-period-toggle";
        toggleButton.dataset.action = "toggle-period";
        toggleButton.dataset.dayCode = dayCode;
        toggleButton.dataset.periodNumber = String(periodDef.number);
        toggleButton.setAttribute("aria-expanded", "false");

        const periodMeta = document.createElement("div");
        periodMeta.className = "calendar-mobile-period-meta";

        const periodLabel = document.createElement("p");
        periodLabel.className = "calendar-mobile-period-label";
        periodLabel.textContent = periodDef.label;

        const periodTime = document.createElement("p");
        periodTime.className = "calendar-mobile-period-time";
        periodTime.textContent = periodDef.timeRange;

        periodMeta.appendChild(periodLabel);
        periodMeta.appendChild(periodTime);

        const compact = document.createElement("div");
        compact.className = "calendar-mobile-period-compact";
        compact.dataset.role = "compact";

        toggleButton.appendChild(periodMeta);
        toggleButton.appendChild(compact);

        const detailPanel = document.createElement("div");
        detailPanel.className = "calendar-mobile-period-panel";
        detailPanel.dataset.role = "panel";

        periodArticle.appendChild(toggleButton);
        periodArticle.appendChild(detailPanel);
        dayShell.appendChild(periodArticle);
      });

      dayPage.appendChild(dayShell);
      this.mobileTrack.appendChild(dayPage);
    });

    this.updateMobileDayButtons();
  }

  updateMobileDayButtons() {
    if (!this.mobileDayTabs) return;

    const buttons = this.mobileDayTabs.querySelectorAll(".calendar-mobile-day-tab");
    buttons.forEach((button, index) => {
      const isActive = index === this.selectedMobileDayIndex;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  }

  updateMobileTrackPosition(animate = true) {
    if (!this.mobileTrack) return;

    this.mobileTrack.classList.toggle("without-animation", !animate);
    this.mobileTrack.style.transform = `translateX(-${this.selectedMobileDayIndex * 100}%)`;

    if (!animate) {
      requestAnimationFrame(() => {
        this.mobileTrack.classList.remove("without-animation");
      });
    }
  }

  handleTouchStart(event) {
    if (!this.isMobile) return;

    const touch = event.touches[0];
    if (!touch) return;

    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchInProgress = true;
  }

  handleTouchMove(event) {
    if (!this.isMobile || !this.touchInProgress) return;

    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;

    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.25) {
      this.touchInProgress = false;
    }
  }

  handleTouchEnd(event) {
    if (!this.isMobile || !this.touchInProgress) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;
    this.touchInProgress = false;

    if (Math.abs(deltaX) < 50) return;
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.25) return;

    if (deltaX < 0) {
      this.selectMobileDayByIndex(this.selectedMobileDayIndex + 1, true);
    } else {
      this.selectMobileDayByIndex(this.selectedMobileDayIndex - 1, true);
    }
  }

  handleMobileViewClick(event) {
    if (!this.isMobile) return;

    const courseCard = event.target.closest("[data-course-key]");
    if (courseCard) {
      const courseKey = courseCard.dataset.courseKey;
      const course = this.mobileCourseLookup.get(courseKey);
      if (course) {
        openCourseInfoMenu(course);
      }
      return;
    }

    const dayButton = event.target.closest("[data-action='select-day']");
    if (dayButton) {
      const dayIndex = parseInt(dayButton.dataset.dayIndex, 10);
      if (Number.isFinite(dayIndex)) {
        this.selectMobileDayByIndex(dayIndex, true);
      }
      return;
    }

    const toggleButton = event.target.closest("[data-action='toggle-period']");
    if (toggleButton) {
      const dayCode = toggleButton.dataset.dayCode;
      const periodNumber = parseInt(toggleButton.dataset.periodNumber, 10);
      if (dayCode && Number.isFinite(periodNumber)) {
        this.toggleMobilePeriod(dayCode, periodNumber);
      }
    }
  }

  selectMobileDayByIndex(dayIndex, animate = true) {
    const boundedIndex = Math.max(0, Math.min(this.dayOrder.length - 1, dayIndex));
    if (boundedIndex === this.selectedMobileDayIndex && animate) return;

    const previousDayCode = this.dayOrder[this.selectedMobileDayIndex];
    if (previousDayCode && boundedIndex !== this.selectedMobileDayIndex) {
      this.expandedMobilePeriodByDay[previousDayCode] = null;
    }

    this.selectedMobileDayIndex = boundedIndex;
    const dayCode = this.dayOrder[this.selectedMobileDayIndex];

    this.ensureExpandedPeriodForDay(dayCode);
    this.updateMobileDayButtons();
    this.updateMobileTrackPosition(animate);
    this.applyMobileExpandedState();
  }

  selectMobileDayByName(dayName, animate = false) {
    const dayNameToCode = {
      Monday: "Mon",
      Tuesday: "Tue",
      Wednesday: "Wed",
      Thursday: "Thu",
      Friday: "Fri"
    };

    const dayCode = dayNameToCode[dayName];
    if (!dayCode) return;

    const index = this.dayOrder.indexOf(dayCode);
    if (index === -1) return;

    this.selectMobileDayByIndex(index, animate);
  }

  getCurrentDayName() {
    const now = new Date();
    const weekday = now.getDay();
    const mapping = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return mapping[weekday];
  }

  getDefaultMobileDayIndex() {
    const currentDayName = this.getCurrentDayName();
    const fallback = 0;

    const dayMap = {
      Monday: 0,
      Tuesday: 1,
      Wednesday: 2,
      Thursday: 3,
      Friday: 4
    };

    return dayMap[currentDayName] ?? fallback;
  }

  isWeekendDay(dayName) {
    return dayName === "Saturday" || dayName === "Sunday";
  }

  getSuggestedExpandedPeriod() {
    if (this.isWeekendDay(this.getCurrentDayName())) {
      return null;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const currentPeriod = this.periodDefinitions.find((period) => currentMinutes >= period.start && currentMinutes <= period.end);
    return currentPeriod ? currentPeriod.number : null;
  }

  ensureExpandedPeriodForDay(dayCode) {
    if (!dayCode) return;

    if (!Object.prototype.hasOwnProperty.call(this.expandedMobilePeriodByDay, dayCode)) {
      this.expandedMobilePeriodByDay[dayCode] = this.getSuggestedExpandedPeriod();
    }
  }

  toggleMobilePeriod(dayCode, periodNumber) {
    if (!dayCode || !Number.isFinite(periodNumber)) return;

    const currentlyExpanded = this.expandedMobilePeriodByDay[dayCode];
    if (currentlyExpanded === periodNumber) {
      this.expandedMobilePeriodByDay[dayCode] = null;
    } else {
      this.expandedMobilePeriodByDay[dayCode] = periodNumber;
    }

    this.applyMobileExpandedState();
  }

  applyMobileExpandedState() {
    if (!this.mobileTrack) return;

    const dayPages = this.mobileTrack.querySelectorAll(".calendar-mobile-day-page");
    dayPages.forEach((dayPage) => {
      const dayCode = dayPage.dataset.dayCode;
      const expandedPeriod = dayCode ? this.expandedMobilePeriodByDay[dayCode] : null;

      const periodRows = dayPage.querySelectorAll(".calendar-mobile-period");
      periodRows.forEach((row) => {
        const periodNumber = parseInt(row.dataset.periodNumber, 10);
        const isExpanded = Number.isFinite(periodNumber) && expandedPeriod === periodNumber;
        row.classList.toggle("is-expanded", isExpanded);

        const toggleButton = row.querySelector(".calendar-mobile-period-toggle");
        if (toggleButton) {
          toggleButton.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        }
      });
    });
  }

  getSlotKey(dayCode, periodNumber) {
    return `${dayCode}-${periodNumber}`;
  }

  getCoursesForSlot(dayCode, periodNumber) {
    const key = this.getSlotKey(dayCode, periodNumber);
    return this.mobileCoursesBySlot.get(key) || [];
  }

  renderMobileSchedule() {
    if (!this.mobileTrack) return;

    this.mobileCourseLookup.clear();

    this.dayOrder.forEach((dayCode) => {
      const dayPage = this.mobileTrack.querySelector(`.calendar-mobile-day-page[data-day-code='${dayCode}']`);
      if (!dayPage) return;

      this.periodDefinitions.forEach((periodDef) => {
        const periodRow = dayPage.querySelector(`.calendar-mobile-period[data-period-number='${periodDef.number}']`);
        if (!periodRow) return;

        const compactContainer = periodRow.querySelector(".calendar-mobile-period-compact");
        const panelContainer = periodRow.querySelector(".calendar-mobile-period-panel");

        if (!compactContainer || !panelContainer) return;

        compactContainer.innerHTML = "";
        panelContainer.innerHTML = "";

        const courses = this.getCoursesForSlot(dayCode, periodDef.number);

        if (courses.length > 0) {
          const primaryCourse = courses[0];
          const compactPill = document.createElement("div");
          compactPill.className = "calendar-mobile-course-pill";
          compactPill.style.backgroundColor = getCourseColorByType(primaryCourse.type);
          compactPill.textContent = this.getCompactTitle(primaryCourse);
          compactContainer.appendChild(compactPill);

          if (courses.length > 1) {
            const overflowBadge = document.createElement("span");
            overflowBadge.className = "calendar-mobile-course-count";
            overflowBadge.textContent = `+${courses.length - 1}`;
            compactContainer.appendChild(overflowBadge);
          }

          courses.forEach((course, courseIndex) => {
            const courseKey = `${dayCode}-${periodDef.number}-${course.course_code}-${courseIndex}`;
            this.mobileCourseLookup.set(courseKey, course);

            const card = document.createElement("button");
            card.type = "button";
            card.className = "calendar-mobile-course-card";
            card.dataset.courseKey = courseKey;
            card.style.backgroundColor = getCourseColorByType(course.type);

            const title = document.createElement("div");
            title.className = "calendar-mobile-course-title";
            title.textContent = this.getDetailedTitle(course);

            const professor = document.createElement("div");
            professor.className = "calendar-mobile-course-professor";
            professor.textContent = course.professor ? `Professor ${course.professor}` : "Professor TBA";

            card.appendChild(title);
            card.appendChild(professor);
            panelContainer.appendChild(card);
          });
        } else {
          const emptyState = document.createElement("div");
          emptyState.className = "calendar-mobile-empty";
          emptyState.textContent = "No class scheduled";
          panelContainer.appendChild(emptyState);
        }
      });
    });

    this.updateMobileDayButtons();
    this.updateMobileTrackPosition(false);
    this.applyMobileExpandedState();
  }

  getCompactTitle(course) {
    const rawTitle = course?.title || course?.course_code || "Class";
    const normalized = rawTitle.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (normalized.length <= 24) return normalized;
    return `${normalized.slice(0, 24)}...`;
  }

  getDetailedTitle(course) {
    const rawTitle = course?.title || course?.course_code || "Class";
    return rawTitle.normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  // Legacy compatibility method used by debugging hooks and previous mobile flow.
  showDay(day, columnIndex = null) {
    if (!this.isMobile) return;
    this.selectMobileDayByName(day, true);
  }

  showAllDays() {
    this.calendar.querySelectorAll("tr").forEach((row) => {
      Array.from(row.cells).forEach((cell) => {
        cell.style.display = "table-cell";
      });
    });
  }

  async initializeCalendar() {
    try {
      this.showLoading();
      this.currentUser = null;

      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;

      this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
      this.highlightPeriod();
      this.highlightCurrentTimePeriod();

      let currentYear;
      let currentTerm;

      const yearSelect = document.getElementById("year-select");
      const termSelect = document.getElementById("term-select");

      if (yearSelect && yearSelect.value && !isNaN(parseInt(yearSelect.value, 10))) {
        currentYear = parseInt(yearSelect.value, 10);
      } else {
        currentYear = 2025;
      }

      if (termSelect && termSelect.value) {
        currentTerm = termSelect.value;
      } else {
        currentTerm = "Fall";
      }

      await this.showCourseWithRetry(currentYear, currentTerm);

      this.isInitialized = true;
      this.hideLoading();
      this.updateMobileUI(false);
    } catch (error) {
      console.error("Error initializing calendar page:", error);
      this.hideLoading();

      if (this.retryCount < this.maxRetries) {
        this.retryCount += 1;
        setTimeout(() => this.initializeCalendar(), 1000 * this.retryCount);
      }
    }
  }

  showLoading() {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = "block";
    }
  }

  hideLoading() {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = "none";
    }
  }

  async showCourseWithRetry(year, term, retryAttempt = 0) {
    try {
      await this.showCourse(year, term);
      this.retryCount = 0;
    } catch (error) {
      console.error(`Error showing courses (attempt ${retryAttempt + 1}):`, error);

      if (retryAttempt < this.maxRetries) {
        setTimeout(() => this.showCourseWithRetry(year, term, retryAttempt + 1), 1000 * (retryAttempt + 1));
      } else {
        this.showEmptyCalendar();
      }
    }
  }

  getColIndexByDayEN(dayEN) {
    const id = this.dayIdByEN[dayEN];
    if (!id) return -1;

    const element = this.querySelector(`#${id}`);
    if (!element) return -1;

    return Array.from(this.calendarHeader).indexOf(element);
  }

  clearCourseCells() {
    this.calendar.querySelectorAll("tbody td .course-cell, tbody td .course-cell-main").forEach((element) => element.remove());
  }

  showEmptyCalendar() {
    this.clearCourseCells();
    this.mobileCoursesBySlot.clear();
    this.mobileCourseLookup.clear();
    this.renderMobileSchedule();
  }

  highlightDay(dayShort) {
    this.calendar.querySelectorAll("thead th, tbody td").forEach((element) => {
      element.classList.remove("highlight-day", "highlight-current-day");
    });

    const colIndex = this.getColIndexByDayEN(dayShort);
    if (colIndex === -1) return;

    const header = this.calendarHeader[colIndex];
    if (header) header.classList.add("highlight-day");

    this.calendar.querySelectorAll("tbody tr").forEach((row) => {
      const cell = row.querySelector(`td:nth-child(${colIndex + 1})`);
      if (cell) cell.classList.add("highlight-current-day");
    });
  }

  highlightPeriod() {
    if (this.calendarHeader[0]) this.calendarHeader[0].classList.add("calendar-first");

    this.calendar.querySelectorAll("tbody tr").forEach((row) => {
      const cell = row.querySelector("td:nth-child(1)");
      if (cell) cell.classList.add("calendar-first");
    });
  }

  highlightCurrentTimePeriod() {
    this.calendar.querySelectorAll("tbody td").forEach((cell) => cell.classList.remove("highlight-current-time"));

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.toLocaleDateString("en-US", { weekday: "short" });

    const currentPeriod = this.periodDefinitions.find((period) => currentTime >= period.start && currentTime <= period.end);
    if (!currentPeriod) return;

    const colIndex = this.getColIndexByDayEN(currentDay);
    if (colIndex === -1) return;

    const rows = this.calendar.querySelectorAll("tbody tr");
    const rowIndex = currentPeriod.number - 1;
    if (!rows[rowIndex]) return;

    const cell = rows[rowIndex].querySelector(`td:nth-child(${colIndex + 1})`);
    if (cell) cell.classList.add("highlight-current-time");
  }

  parseCourseSchedule(course) {
    if (!course?.time_slot) return null;

    let dayEN = null;
    let period = null;

    const jpMatch = course.time_slot.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
    if (jpMatch) {
      const dayMap = { "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat", "日": "Sun" };
      dayEN = dayMap[jpMatch[1]];
      period = parseInt(jpMatch[2], 10);
    } else {
      const enMatch = course.time_slot.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
      if (enMatch) {
        dayEN = enMatch[1];
        const startHour = parseInt(enMatch[2], 10);
        const startMinute = parseInt(enMatch[3], 10);
        const numericStart = startHour * 100 + startMinute;

        if (numericStart >= 900 && numericStart < 1030) period = 1;
        else if (numericStart >= 1045 && numericStart < 1215) period = 2;
        else if (numericStart >= 1310 && numericStart < 1440) period = 3;
        else if (numericStart >= 1455 && numericStart < 1625) period = 4;
        else if (numericStart >= 1640 && numericStart < 1810) period = 5;
      }
    }

    if (!dayEN || !this.dayIdByEN[dayEN]) return null;
    if (!Number.isFinite(period) || period < 1 || period > 5) return null;

    return { dayEN, period };
  }

  async showCourse(year, term) {
    this.displayedYear = year;
    this.displayedTerm = term;

    try {
      this.currentUser = null;
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;

      let selectedCourses = [];

      if (this.currentUser) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("courses_selection")
          .eq("id", this.currentUser.id)
          .single();

        if (profileError) throw profileError;

        selectedCourses = (profile?.courses_selection || []).filter((course) => {
          return course.year === parseInt(year, 10) && (!course.term || course.term === term);
        });
      }

      this.clearCourseCells();
      this.mobileCoursesBySlot.clear();

      if (!this.currentUser || selectedCourses.length === 0) {
        this.showEmptyCalendar();
        return;
      }

      const allCoursesInSemester = await fetchCourseData(year, term);
      const selectedCourseCodes = new Set(selectedCourses.map((course) => course.code));

      const coursesToShow = allCoursesInSemester.filter((course) => selectedCourseCodes.has(course.course_code));

      coursesToShow.forEach((course) => {
        const parsedSchedule = this.parseCourseSchedule(course);
        if (!parsedSchedule) return;

        const { dayEN, period } = parsedSchedule;
        const rowIndex = period - 1;
        const colIndex = this.getColIndexByDayEN(dayEN);
        if (rowIndex < 0 || rowIndex >= 5 || colIndex === -1) return;

        const targetCell = this.calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
        if (targetCell) {
          const card = document.createElement("div");
          card.classList.add("course-cell");
          card.dataset.courseIdentifier = course.course_code;
          card.dataset.courseType = course.type || "unknown";
          card.style.backgroundColor = getCourseColorByType(course.type);

          const title = document.createElement("div");
          title.classList.add("course-title");
          title.textContent = this.getCompactTitle(course);

          const classroom = document.createElement("div");
          classroom.classList.add("course-classroom");
          classroom.textContent = course.location || "";

          if (!classroom.textContent) {
            classroom.classList.add("empty-classroom");
            title.classList.add("empty-classroom-title");
          }

          card.appendChild(title);
          card.appendChild(classroom);
          targetCell.appendChild(card);
        }

        const slotKey = this.getSlotKey(dayEN, period);
        const slotCourses = this.mobileCoursesBySlot.get(slotKey) || [];
        slotCourses.push(course);
        this.mobileCoursesBySlot.set(slotKey, slotCourses);
      });

      this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
      this.highlightCurrentTimePeriod();

      this.renderMobileSchedule();

      document.dispatchEvent(new CustomEvent("calendarPageRefreshed"));
    } catch (error) {
      console.error("Error showing courses in calendar page:", error);
      throw error;
    }
  }

  async handleCalendarClick(event) {
    const clickedCell = event.target.closest("div.course-cell");
    if (!clickedCell) return;

    const courseCode = clickedCell.dataset.courseIdentifier;
    if (!this.displayedYear || !this.displayedTerm || !courseCode) return;

    try {
      const courses = await fetchCourseData(this.displayedYear, this.displayedTerm);
      const clickedCourse = courses.find((course) => course.course_code === courseCode);
      if (clickedCourse) {
        openCourseInfoMenu(clickedCourse);
      }
    } catch (error) {
      console.error("Error handling calendar click:", error);
    }
  }

  async forceRefresh() {
    this.currentUser = null;
    this.isInitialized = false;
    this.retryCount = 0;

    this.clearCourseCells();
    this.mobileCoursesBySlot.clear();

    await this.initializeCalendar();
  }

  async refreshCalendar() {
    this.currentUser = null;

    if (!this.isInitialized) {
      return this.initializeCalendar();
    }

    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
      const currentMonth = new Date().getMonth() + 1;
      return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();

    await this.showCourseWithRetry(currentYear, currentTerm);
    this.updateMobileUI(false);
  }

  async showTerm(year, term) {
    this.currentUser = null;
    await this.showCourseWithRetry(year, term);
    this.updateMobileUI(false);
  }

  testMobile() {
    console.log("=== Testing Calendar Page Mobile ===");
    console.log("Window width:", window.innerWidth);
    console.log("isMobile:", this.isMobile);
    console.log("Selected day index:", this.selectedMobileDayIndex);

    if (this.isMobile) {
      const defaultDay = this.getCurrentDayName();
      console.log("Default day based on current date:", defaultDay);
      this.selectMobileDayByName(defaultDay, true);
    }
  }
}

customElements.define("calendar-page", CalendarPageComponent);

window.testCalendarPage = function () {
  const component = document.querySelector("calendar-page");
  if (component) {
    component.testMobile();
  } else {
    console.log("Calendar page component not found");
  }
};

export { CalendarPageComponent };
