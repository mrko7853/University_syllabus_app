import { fetchCourseData, openCourseInfoMenu, getCourseColorByType, openCourseSearchForSlot, formatProfessorDisplayName } from "./shared.js";
import { readSavedCourses } from "./saved-courses.js";
import { supabase } from "../supabase.js";

const CALENDAR_VIEW_STORAGE_KEY = "ila_calendar_view_mode";
const CALENDAR_BUSY_SLOTS_STORAGE_KEY = "ila_calendar_busy_slots_v1";
const VIEW_WEEK = "week";
const VIEW_DAY = "day";
const VIEW_LIST = "list";
const ALLOWED_CALENDAR_VIEWS = new Set([VIEW_WEEK, VIEW_DAY, VIEW_LIST]);

class CalendarPageComponent extends HTMLElement {
  constructor() {
    super();

    this.isInitialized = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.isMobile = window.innerWidth <= 1023;
    this.savedViewPreference = this.readSavedViewPreference();
    const initialPreferredView = this.savedViewPreference || this.resolveDefaultViewForViewport(this.isMobile);
    this.currentView = this.resolveEffectiveViewForViewport(initialPreferredView, this.isMobile);

    this.dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    this.dayLongNames = {
      Mon: "Monday",
      Tue: "Tuesday",
      Wed: "Wednesday",
      Thu: "Thursday",
      Fri: "Friday"
    };
    this.dayShortButtons = {
      Mon: "Mon",
      Tue: "Tue",
      Wed: "Wed",
      Thu: "Thu",
      Fri: "Fri"
    };

    this.periodDefinitions = [
      { number: 1, label: "period 1", timeRange: "09:00 - 10:30", start: 9 * 60, end: 10 * 60 + 30, filterValue: "09:00" },
      { number: 2, label: "period 2", timeRange: "10:45 - 12:15", start: 10 * 60 + 45, end: 12 * 60 + 15, filterValue: "10:45" },
      { number: 3, label: "period 3", timeRange: "13:10 - 14:40", start: 13 * 60 + 10, end: 14 * 60 + 40, filterValue: "13:10" },
      { number: 4, label: "period 4", timeRange: "14:55 - 16:25", start: 14 * 60 + 55, end: 16 * 60 + 25, filterValue: "14:55" },
      { number: 5, label: "period 5", timeRange: "16:40 - 18:10", start: 16 * 60 + 40, end: 18 * 60 + 10, filterValue: "16:40" }
    ];

    this.dayIdByEN = {
      Mon: "calendar-monday",
      Tue: "calendar-tuesday",
      Wed: "calendar-wednesday",
      Thu: "calendar-thursday",
      Fri: "calendar-friday"
    };

    this.filterState = {
      typeFilters: new Set(),
      showRegistered: true,
      showEmptySlots: true
    };
    this.busySlots = new Set();

    this.allRegisteredCourses = [];
    this.mobileCoursesBySlot = new Map();
    this.mobileCourseLookup = new Map();
    this.desktopCourseLookup = new Map();
    this.listCourseLookup = new Map();
    this.expandedMobilePeriodByDay = {};
    this.selectedMobileDayIndex = this.getDefaultMobileDayIndex();

    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchInProgress = false;
    this.daySwitchAnimationTimer = null;

    this.activeFocusTrapCleanup = null;
    this.activeSlot = null;
    this.activeSlotTrigger = null;
    this.activeFilterTrigger = null;
    this.toolbarCleanupFns = [];
    this.stickyToolbarObserverCleanup = null;
    this.filterCloseTimer = null;

    this.innerHTML = `
      <div class="calendar-page-wrapper">
        <div class="calendar-container-main">
          <div class="loading-indicator" id="loading-indicator" style="display: none;"></div>

          <div class="calendar-wrapper">
            <div class="calendar-grid-scroll" id="calendar-grid-scroll">
              <table id="calendar-main">
                <thead>
                  <tr>
                    <th class="calendar-time-header"><p style="display: none;">empty</p></th>
                    <th id="calendar-monday"><p>Mon</p></th>
                    <th id="calendar-tuesday"><p>Tue</p></th>
                    <th id="calendar-wednesday"><p>Wed</p></th>
                    <th id="calendar-thursday"><p>Thu</p></th>
                    <th id="calendar-friday"><p>Fri</p></th>
                  </tr>
                </thead>
                <tbody>
                  ${this.periodDefinitions.map((periodDef) => `
                    <tr data-period="${periodDef.number}">
                      <td id="calendar-period-${periodDef.number}" class="calendar-time-cell" data-period="${periodDef.number}">
                        <p class="time-full">
                          <small>${periodDef.label}</small>
                          <span class="time-full-range">${periodDef.timeRange}</span>
                          <span class="calendar-now-chip" aria-hidden="true">● NOW</span>
                        </p>
                        <p class="time-short">${periodDef.number}h</p>
                      </td>
                      ${this.dayOrder.map((dayCode) => `<td class="calendar-slot-cell" data-day="${dayCode}" data-period="${periodDef.number}"></td>`).join("")}
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>

          <div class="calendar-mobile-view calendar-day-view" style="display: none;" aria-label="Day agenda">
            <div class="calendar-day-header">
              <p class="calendar-day-header-title" data-role="day-title">Monday</p>
            </div>
            <div class="calendar-day-tabs" data-role="day-tabs" role="tablist" aria-label="Weekday selector"></div>
            <div class="calendar-day-agenda" data-role="day-agenda"></div>
          </div>

          <div class="calendar-list-view" style="display: none;" aria-label="Registered courses list">
            <div class="calendar-list-scroll">
              <div class="calendar-list-content"></div>
            </div>
          </div>

          <div class="calendar-slot-popover hidden" id="calendar-slot-popover" role="dialog" aria-modal="false" aria-labelledby="calendar-slot-popover-title">
            <p class="calendar-slot-popover-title" id="calendar-slot-popover-title">Empty slot</p>
            <p class="calendar-slot-popover-subtitle" id="calendar-slot-popover-subtitle"></p>
            <button type="button" class="calendar-slot-action-btn control-surface control-surface--primary calendar-slot-action-btn-primary" data-action="slot-find">Find courses for this slot</button>
            <button type="button" class="calendar-slot-action-btn control-surface control-surface--secondary" data-action="slot-busy">Mark as busy</button>
          </div>

          <div class="calendar-slot-sheet-layer hidden" id="calendar-slot-sheet-layer" aria-hidden="true">
            <div class="calendar-slot-sheet-backdrop" data-action="slot-sheet-close"></div>
            <div class="calendar-slot-sheet" id="calendar-slot-sheet" role="dialog" aria-modal="true" aria-labelledby="calendar-slot-sheet-title">
              <div class="swipe-indicator"></div>
              <div class="calendar-slot-sheet-header">
                <h3 id="calendar-slot-sheet-title">Empty slot</h3>
                <p id="calendar-slot-sheet-subtitle"></p>
              </div>
              <div class="calendar-slot-sheet-actions">
                <button type="button" class="calendar-slot-action-btn control-surface control-surface--primary calendar-slot-action-btn-primary" data-action="slot-find">Find courses for this slot</button>
                <button type="button" class="calendar-slot-action-btn control-surface control-surface--secondary" data-action="slot-busy">Mark as busy</button>
                <button type="button" class="calendar-slot-action-btn control-surface control-surface--secondary" data-action="slot-cancel">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.calendar = this.querySelector("#calendar-main");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.querySelector("#loading-indicator");

    this.calendarWrapper = this.querySelector(".calendar-wrapper");
    this.calendarGridScroll = this.querySelector("#calendar-grid-scroll");
    this.mobileView = this.querySelector(".calendar-mobile-view");
    this.dayHeaderTitle = this.querySelector("[data-role='day-title']");
    this.mobileDayTabs = this.querySelector("[data-role='day-tabs']");
    this.dayAgenda = this.querySelector("[data-role='day-agenda']");
    this.listView = this.querySelector(".calendar-list-view");
    this.listContent = this.querySelector(".calendar-list-content");

    this.slotPopover = this.querySelector("#calendar-slot-popover");
    this.slotPopoverSubtitle = this.querySelector("#calendar-slot-popover-subtitle");
    this.slotSheetLayer = this.querySelector("#calendar-slot-sheet-layer");
    this.slotSheet = this.querySelector("#calendar-slot-sheet");
    this.slotSheetSubtitle = this.querySelector("#calendar-slot-sheet-subtitle");

    this.displayedYear = null;
    this.displayedTerm = null;

    this.boundResizeHandler = this.handleResize.bind(this);
    this.boundCalendarClickHandler = this.handleCalendarClick.bind(this);
    this.boundCalendarPointerOver = this.handleCalendarPointerOver.bind(this);
    this.boundCalendarPointerMove = this.handleCalendarPointerMove.bind(this);
    this.boundCalendarPointerLeave = this.handleCalendarPointerLeave.bind(this);
    this.boundMobileClickHandler = this.handleMobileViewClick.bind(this);
    this.boundMobileKeydownHandler = this.handleMobileViewKeydown.bind(this);
    this.boundListViewClickHandler = this.handleListViewClick.bind(this);
    this.boundTouchStartHandler = this.handleTouchStart.bind(this);
    this.boundTouchMoveHandler = this.handleTouchMove.bind(this);
    this.boundTouchEndHandler = this.handleTouchEnd.bind(this);
    this.boundPageLoadedHandler = this.handlePageLoaded.bind(this);
    this.boundDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.boundRootActionClick = this.handleRootActionClick.bind(this);
    this.boundSlotPopoverActionClick = this.handleRootActionClick.bind(this);
    this.originalSlotPopoverParent = this.slotPopover?.parentElement || null;

    this.buildMobileViewSkeleton();
    this.checkMobile();
  }

  connectedCallback() {
    this.calendar.addEventListener("click", this.boundCalendarClickHandler);
    this.calendar.addEventListener("mouseover", this.boundCalendarPointerOver);
    this.calendar.addEventListener("mousemove", this.boundCalendarPointerMove);
    this.calendar.addEventListener("mouseleave", this.boundCalendarPointerLeave);

    this.mobileView?.addEventListener("click", this.boundMobileClickHandler);
    this.mobileView?.addEventListener("keydown", this.boundMobileKeydownHandler);
    this.mobileView?.addEventListener("touchstart", this.boundTouchStartHandler, { passive: true });
    this.mobileView?.addEventListener("touchmove", this.boundTouchMoveHandler, { passive: true });
    this.mobileView?.addEventListener("touchend", this.boundTouchEndHandler, { passive: true });
    this.listView?.addEventListener("click", this.boundListViewClickHandler);
    this.addEventListener("click", this.boundRootActionClick);
    this.mountSlotPopoverToBody();
    this.slotPopover?.addEventListener("click", this.boundSlotPopoverActionClick);

    window.addEventListener("resize", this.boundResizeHandler);
    document.addEventListener("pageLoaded", this.boundPageLoadedHandler);
    document.addEventListener("pointerdown", this.boundDocumentPointerDown);

    this.setupSearchButtons();
    this.setupToolbarControls();
    this.initializeCalendar();
  }

  disconnectedCallback() {
    this.calendar.removeEventListener("click", this.boundCalendarClickHandler);
    this.calendar.removeEventListener("mouseover", this.boundCalendarPointerOver);
    this.calendar.removeEventListener("mousemove", this.boundCalendarPointerMove);
    this.calendar.removeEventListener("mouseleave", this.boundCalendarPointerLeave);

    this.mobileView?.removeEventListener("click", this.boundMobileClickHandler);
    this.mobileView?.removeEventListener("keydown", this.boundMobileKeydownHandler);
    this.mobileView?.removeEventListener("touchstart", this.boundTouchStartHandler);
    this.mobileView?.removeEventListener("touchmove", this.boundTouchMoveHandler);
    this.mobileView?.removeEventListener("touchend", this.boundTouchEndHandler);
    this.listView?.removeEventListener("click", this.boundListViewClickHandler);
    this.removeEventListener("click", this.boundRootActionClick);
    this.slotPopover?.removeEventListener("click", this.boundSlotPopoverActionClick);
    this.restoreSlotPopoverParent();

    window.removeEventListener("resize", this.boundResizeHandler);
    document.removeEventListener("pageLoaded", this.boundPageLoadedHandler);
    document.removeEventListener("pointerdown", this.boundDocumentPointerDown);

    this.cleanupToolbarControls();
    this.closeFilterPopover(false, true);
    this.closeSlotActionMenus(false);
    this.hideTooltip();
    this.clearFocusTrap();
    if (this.daySwitchAnimationTimer) {
      clearTimeout(this.daySwitchAnimationTimer);
      this.daySwitchAnimationTimer = null;
    }
  }

  handlePageLoaded() {
    this.setupToolbarControls();
    this.checkMobile();
  }

  mountSlotPopoverToBody() {
    if (!this.slotPopover) return;
    if (!this.originalSlotPopoverParent) {
      this.originalSlotPopoverParent = this.slotPopover.parentElement || null;
    }

    if (this.slotPopover.parentElement !== document.body) {
      document.body.appendChild(this.slotPopover);
    }
  }

  restoreSlotPopoverParent() {
    if (!this.slotPopover || !this.originalSlotPopoverParent) return;
    if (this.slotPopover.parentElement !== this.originalSlotPopoverParent) {
      this.originalSlotPopoverParent.appendChild(this.slotPopover);
    }
  }

  normalizeCalendarView(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return ALLOWED_CALENDAR_VIEWS.has(normalized) ? normalized : null;
  }

  readSavedViewPreference() {
    try {
      const stored = window.localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
      return this.normalizeCalendarView(stored);
    } catch (error) {
      console.warn("Unable to read calendar view preference:", error);
      return null;
    }
  }

  writeSavedViewPreference(view) {
    const normalized = this.normalizeCalendarView(view);
    if (!normalized) return;

    try {
      window.localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, normalized);
    } catch (error) {
      console.warn("Unable to persist calendar view preference:", error);
    }
  }

  resolveDefaultViewForViewport(isMobile) {
    return isMobile ? VIEW_DAY : VIEW_WEEK;
  }

  resolveEffectiveViewForViewport(preferredView, isMobile) {
    const normalized = this.normalizeCalendarView(preferredView);
    const fallback = this.resolveDefaultViewForViewport(isMobile);
    if (!normalized) return fallback;
    if (isMobile && normalized === VIEW_WEEK) return VIEW_DAY;
    return normalized;
  }

  getPreferredView() {
    return this.savedViewPreference || this.resolveDefaultViewForViewport(this.isMobile);
  }

  applyViewportViewPreference() {
    const preferredView = this.getPreferredView();
    const effectiveView = this.resolveEffectiveViewForViewport(preferredView, this.isMobile);
    this.currentView = effectiveView;
    this.syncViewToggleButtons();
  }

  setCurrentView(view, { persist = false } = {}) {
    const normalized = this.normalizeCalendarView(view);
    if (!normalized) return;

    if (persist) {
      this.savedViewPreference = normalized;
      this.writeSavedViewPreference(normalized);
    }

    const effectiveView = this.resolveEffectiveViewForViewport(normalized, this.isMobile);
    this.currentView = effectiveView;
    this.syncViewToggleButtons();
    this.applyViewVisibility();
  }

  syncViewToggleButtons() {
    const viewButtons = document.querySelectorAll("[data-calendar-view]");
    const activeView = this.resolveEffectiveViewForViewport(this.currentView, this.isMobile);

    viewButtons.forEach((button) => {
      const buttonView = this.normalizeCalendarView(button.dataset.calendarView);
      const isActive = buttonView === activeView;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  }

  setViewElementVisibility(element, isVisible, displayValue) {
    if (!element) return;
    element.classList.toggle("is-hidden", !isVisible);
    element.style.display = isVisible ? displayValue : "none";
  }

  applyViewVisibility({ forceDayReset = false } = {}) {
    const effectiveView = this.resolveEffectiveViewForViewport(this.currentView, this.isMobile);
    this.currentView = effectiveView;

    const showWeek = effectiveView === VIEW_WEEK;
    const showDay = effectiveView === VIEW_DAY;
    const showList = effectiveView === VIEW_LIST;

    this.syncRootViewStateClasses(showWeek, showDay, showList);

    this.setViewElementVisibility(this.calendarWrapper, showWeek, "block");
    this.setViewElementVisibility(this.mobileView, showDay, "flex");
    this.setViewElementVisibility(this.listView, showList, "block");

    if (showDay) {
      this.updateDayViewState(forceDayReset);
    } else {
      this.closeSlotSheet(false);
    }

    if (showWeek) {
      this.showAllDays();
    } else {
      this.closeSlotPopover(false);
      this.hideTooltip();
    }
  }

  syncRootViewStateClasses(showWeek, showDay, showList) {
    const root = this.closest("#course-summary") || document.getElementById("course-summary");
    if (!root) return;

    root.classList.toggle("calendar-view-week-active", Boolean(showWeek));
    root.classList.toggle("calendar-view-day-active", Boolean(showDay));
    root.classList.toggle("calendar-view-list-active", Boolean(showList));
  }

  updateDayViewState(forceReset = false) {
    if (forceReset) {
      this.selectedMobileDayIndex = this.getDefaultMobileDayIndex();
    }

    this.ensureExpandedPeriodForDay(this.dayOrder[this.selectedMobileDayIndex]);
    this.updateMobileDayButtons();
    this.renderMobileSchedule({ animate: false });
    this.updateDayHeaderState();
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
      if (window.innerWidth <= 1023) {
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

      if (window.innerWidth <= 1023) {
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
        closeSearchAnimated();
      });
    }

    if (searchBackground) {
      searchBackground.addEventListener("click", (event) => {
        if (event.target === searchBackground) {
          closeSearchAnimated();
        }
      });
    }
  }

  setupToolbarControls() {
    this.cleanupToolbarControls();
    this.ensureCalendarFilterMarkup();
    this.setupStickyToolbarObserver();

    const filterTriggerDesktop = document.getElementById("calendar-filter-trigger");
    const filterTriggerMobile = document.getElementById("calendar-filter-trigger-mobile");
    const filterPopover = document.getElementById("calendar-filter-popover");
    const filterBackground = document.getElementById("calendar-filter-background");
    const filterSeeResults = document.getElementById("calendar-filter-see-results");
    const filterClearAll = document.getElementById("calendar-filter-clear-all");
    const filterPopupPanel = filterPopover?.querySelector(".filter-popup");

    const viewButtonDefs = [
      { id: "calendar-view-week", view: VIEW_WEEK },
      { id: "calendar-view-day", view: VIEW_DAY },
      { id: "calendar-view-list", view: VIEW_LIST },
      { id: "calendar-view-day-mobile", view: VIEW_DAY },
      { id: "calendar-view-list-mobile", view: VIEW_LIST }
    ];
    const viewButtonSet = new Set();

    viewButtonDefs.forEach(({ id, view }) => {
      const button = document.getElementById(id);
      if (!button) return;
      if (!button.dataset.calendarView) {
        button.dataset.calendarView = view;
      }
      viewButtonSet.add(button);
    });

    document.querySelectorAll("[data-calendar-view]").forEach((button) => viewButtonSet.add(button));
    const viewButtons = Array.from(viewButtonSet);

    const typeCulture = document.getElementById("calendar-type-culture");
    const typeEconomy = document.getElementById("calendar-type-economy");
    const typePolitics = document.getElementById("calendar-type-politics");
    const typeSpecial = document.getElementById("calendar-type-special");
    const typeUnderstandingKyoto = document.getElementById("calendar-type-understanding-kyoto");
    const typeAcademicSkills = document.getElementById("calendar-type-academic-skills");
    const typeSeminarHonor = document.getElementById("calendar-type-seminar-honor");
    const showRegistered = document.getElementById("calendar-show-registered");
    const showEmpty = document.getElementById("calendar-show-empty");

    this.filterPopoverElement = filterPopover || null;
    this.filterPopoverBackground = filterBackground || null;
    this.filterPopoverPanel = filterPopupPanel || null;
    this.filterTriggerDesktop = filterTriggerDesktop || null;
    this.filterTriggerMobile = filterTriggerMobile || null;

    viewButtons.forEach((button) => {
      button.removeAttribute("disabled");
      button.removeAttribute("aria-disabled");

      const requestedView = this.normalizeCalendarView(button.dataset.calendarView);
      if (!requestedView) return;

      const onClick = (event) => {
        event.preventDefault();
        this.setCurrentView(requestedView, { persist: true });
      };

      button.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => button.removeEventListener("click", onClick));
    });

    const openFromTrigger = (trigger) => {
      if (!trigger || !this.filterPopoverElement) return;
      this.openFilterPopover(trigger);
    };

    if (filterTriggerDesktop) {
      const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFromTrigger(filterTriggerDesktop);
      };
      filterTriggerDesktop.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => filterTriggerDesktop.removeEventListener("click", onClick));
    }

    if (filterTriggerMobile) {
      const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFromTrigger(filterTriggerMobile);
      };
      filterTriggerMobile.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => filterTriggerMobile.removeEventListener("click", onClick));
    }

    if (filterBackground) {
      const onClick = (event) => {
        if (event.target === filterBackground) {
          this.closeFilterPopover(false);
        }
      };
      filterBackground.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => filterBackground.removeEventListener("click", onClick));
    }

    if (filterSeeResults) {
      const onClick = (event) => {
        event.preventDefault();
        this.closeFilterPopover();
      };
      filterSeeResults.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => filterSeeResults.removeEventListener("click", onClick));
    }

    if (filterClearAll) {
      const onClick = (event) => {
        event.preventDefault();
        this.clearCalendarFilters();
      };
      filterClearAll.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => filterClearAll.removeEventListener("click", onClick));
    }

    const onFilterChange = () => {
      this.syncFilterStateFromControls();
      this.applyActiveFiltersAndRender();
    };

    [typeCulture, typeEconomy, typePolitics, typeSpecial, typeUnderstandingKyoto, typeAcademicSkills, typeSeminarHonor, showRegistered, showEmpty].forEach((checkbox) => {
      if (!checkbox) return;
      checkbox.addEventListener("change", onFilterChange);
      this.toolbarCleanupFns.push(() => checkbox.removeEventListener("change", onFilterChange));
    });

    this.syncFilterStateFromControls();
    this.syncViewToggleButtons();
  }

  cleanupToolbarControls() {
    this.toolbarCleanupFns.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.warn("Cleanup error:", error);
      }
    });
    this.toolbarCleanupFns = [];
    this.cleanupStickyToolbarObserver();
  }

  setupStickyToolbarObserver() {
    this.cleanupStickyToolbarObserver();

    const stickyBars = Array.from(document.querySelectorAll(
      "#course-summary.calendar-page-modern .container-above.container-above-desktop, #course-summary.calendar-page-modern .container-above.container-above-mobile"
    ));
    if (!stickyBars.length) return;

    const appContent = document.getElementById("app-content");
    let rafId = 0;

    const getScrollTop = () => {
      const windowScrollY = window.scrollY || window.pageYOffset || 0;
      const rootScrollY = document.documentElement?.scrollTop || 0;
      const bodyScrollY = document.body?.scrollTop || 0;
      const contentScrollY = appContent ? appContent.scrollTop : 0;
      return Math.max(windowScrollY, rootScrollY, bodyScrollY, contentScrollY);
    };

    const applyScrollState = () => {
      rafId = 0;
      const isScrolled = getScrollTop() > 0;
      stickyBars.forEach((bar) => bar.classList.toggle("is-scrolled", isScrolled));
    };

    const requestApply = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(applyScrollState);
    };

    window.addEventListener("scroll", requestApply, { passive: true });
    appContent?.addEventListener("scroll", requestApply, { passive: true });
    document.addEventListener("scroll", requestApply, { passive: true, capture: true });
    window.addEventListener("resize", requestApply);
    applyScrollState();

    this.stickyToolbarObserverCleanup = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      window.removeEventListener("scroll", requestApply);
      appContent?.removeEventListener("scroll", requestApply);
      document.removeEventListener("scroll", requestApply, true);
      window.removeEventListener("resize", requestApply);
      stickyBars.forEach((bar) => bar.classList.remove("is-scrolled"));
    };
  }

  cleanupStickyToolbarObserver() {
    if (typeof this.stickyToolbarObserverCleanup === "function") {
      this.stickyToolbarObserverCleanup();
    }
    this.stickyToolbarObserverCleanup = null;
  }

  getAppliedFilterCount() {
    let count = this.filterState?.typeFilters?.size || 0;

    if (this.filterState?.showRegistered === false) count += 1;
    if (this.filterState?.showEmptySlots === false) count += 1;

    return count;
  }

  ensureFilterCountChip(triggerButton) {
    if (!triggerButton) return null;

    let chip = triggerButton.querySelector(".calendar-filter-count-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "calendar-filter-count-chip";
      chip.setAttribute("aria-hidden", "true");
      chip.hidden = true;
      triggerButton.appendChild(chip);
    }

    return chip;
  }

  updateFilterTriggerCount() {
    const count = this.getAppliedFilterCount();
    const countLabel = count > 99 ? "99+" : String(count);
    const ariaLabel = count > 0 ? `Filters, ${count} applied` : "Filters";

    [this.filterTriggerDesktop, this.filterTriggerMobile].forEach((trigger) => {
      if (!trigger) return;

      const chip = this.ensureFilterCountChip(trigger);
      if (!chip) return;

      if (count > 0) {
        chip.hidden = false;
        chip.textContent = countLabel;
        trigger.classList.add("has-active-filters");
      } else {
        chip.hidden = true;
        chip.textContent = "";
        trigger.classList.remove("has-active-filters");
      }

      trigger.setAttribute("aria-label", ariaLabel);
    });
  }

  syncFilterStateFromControls() {
    const culture = document.getElementById("calendar-type-culture")?.checked;
    const economy = document.getElementById("calendar-type-economy")?.checked;
    const politics = document.getElementById("calendar-type-politics")?.checked;
    const special = document.getElementById("calendar-type-special")?.checked;
    const understandingKyoto = document.getElementById("calendar-type-understanding-kyoto")?.checked;
    const academicSkills = document.getElementById("calendar-type-academic-skills")?.checked;
    const seminarHonor = document.getElementById("calendar-type-seminar-honor")?.checked;
    const legacyFoundation = document.getElementById("calendar-type-foundation")?.checked;

    const selected = new Set();
    if (culture) selected.add("Culture");
    if (economy) selected.add("Economy");
    if (politics) selected.add("Politics");
    if (special) selected.add("Special");
    if (understandingKyoto) selected.add("UnderstandingJapanKyoto");
    if (academicSkills) selected.add("AcademicSkills");
    if (seminarHonor) selected.add("SeminarHonorThesis");
    if (legacyFoundation) {
      selected.add("UnderstandingJapanKyoto");
      selected.add("AcademicSkills");
    }

    this.filterState.typeFilters = selected;
    this.filterState.showRegistered = document.getElementById("calendar-show-registered")?.checked !== false;
    this.filterState.showEmptySlots = document.getElementById("calendar-show-empty")?.checked !== false;
    this.updateFilterTriggerCount();
  }

  clearCalendarFilters() {
    [
      "calendar-type-culture",
      "calendar-type-economy",
      "calendar-type-politics",
      "calendar-type-special",
      "calendar-type-understanding-kyoto",
      "calendar-type-academic-skills",
      "calendar-type-seminar-honor"
    ].forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) checkbox.checked = false;
    });

    const showRegistered = document.getElementById("calendar-show-registered");
    const showEmpty = document.getElementById("calendar-show-empty");

    if (showRegistered) showRegistered.checked = true;
    if (showEmpty) showEmpty.checked = true;

    this.syncFilterStateFromControls();
    this.applyActiveFiltersAndRender();
  }

  ensureCalendarFilterMarkup() {
    const typeGroupElement = document.getElementById("calendar-filter-type-group");
    if (!typeGroupElement) return;

    const previousSelections = this.getSelectedTypeFiltersFromDom();
    typeGroupElement.innerHTML = `
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-culture" class="filter-checkbox">
        <label for="calendar-type-culture">Global Culture<small>Japanese Society and Global Culture Concentration</small></label>
      </div>
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-economy" class="filter-checkbox">
        <label for="calendar-type-economy">Business<small>Japanese Business and the Global Economy Concentration</small></label>
      </div>
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-politics" class="filter-checkbox">
        <label for="calendar-type-politics">Politics<small>Japanese Politics and Global Studies Concentration</small></label>
      </div>
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-seminar-honor" class="filter-checkbox">
        <label for="calendar-type-seminar-honor">Seminars<small>Seminars and Honors Thesis</small></label>
      </div>
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-academic-skills" class="filter-checkbox">
        <label for="calendar-type-academic-skills">Academic Skills<small>Foundation Courses</small></label>
      </div>
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-understanding-kyoto" class="filter-checkbox">
        <label for="calendar-type-understanding-kyoto">Understanding Japan and Kyoto<small>Foundation Courses</small></label>
      </div>
      <div class="checkbox-content">
        <input type="checkbox" id="calendar-type-special" class="filter-checkbox">
        <label for="calendar-type-special">Special Lecture Series</label>
      </div>
    `;

    const syncChecked = (id, key) => {
      const checkbox = document.getElementById(id);
      if (checkbox) checkbox.checked = previousSelections.has(key);
    };

    syncChecked("calendar-type-culture", "Culture");
    syncChecked("calendar-type-economy", "Economy");
    syncChecked("calendar-type-politics", "Politics");
    syncChecked("calendar-type-special", "Special");
    syncChecked("calendar-type-understanding-kyoto", "UnderstandingJapanKyoto");
    syncChecked("calendar-type-academic-skills", "AcademicSkills");
    syncChecked("calendar-type-seminar-honor", "SeminarHonorThesis");
  }

  getSelectedTypeFiltersFromDom() {
    const selected = new Set();

    if (document.getElementById("calendar-type-culture")?.checked) selected.add("Culture");
    if (document.getElementById("calendar-type-economy")?.checked) selected.add("Economy");
    if (document.getElementById("calendar-type-politics")?.checked) selected.add("Politics");
    if (document.getElementById("calendar-type-special")?.checked) selected.add("Special");
    if (document.getElementById("calendar-type-understanding-kyoto")?.checked) selected.add("UnderstandingJapanKyoto");
    if (document.getElementById("calendar-type-academic-skills")?.checked) selected.add("AcademicSkills");
    if (document.getElementById("calendar-type-seminar-honor")?.checked) selected.add("SeminarHonorThesis");
    if (document.getElementById("calendar-type-foundation")?.checked) {
      selected.add("UnderstandingJapanKyoto");
      selected.add("AcademicSkills");
    }

    if (document.getElementById("calendar-type-core")?.checked) {
      selected.add("Culture");
      selected.add("Economy");
      selected.add("Politics");
    }
    if (document.getElementById("calendar-type-elective")?.checked) {
      selected.add("Special");
      selected.add("SeminarHonorThesis");
    }

    return selected;
  }

  openFilterPopover(triggerElement) {
    if (!this.filterPopoverElement) return;

    if (!this.filterPopoverElement.classList.contains("hidden")) {
      this.closeFilterPopover();
      return;
    }

    this.closeSlotActionMenus();

    if (this.filterCloseTimer) {
      clearTimeout(this.filterCloseTimer);
      this.filterCloseTimer = null;
    }

    const background = this.filterPopoverBackground;
    const panel = this.filterPopoverPanel;

    this.filterPopoverElement.classList.remove("hidden");
    this.filterPopoverElement.style.transition = "";
    this.filterPopoverElement.style.opacity = "";
    this.filterPopoverElement.style.transform = "";

    if (this.isMobile) {
      if (background) {
        background.style.transition = "opacity 220ms ease";
        background.style.opacity = "0";
      }

      if (panel) {
        panel.classList.remove("swiping");
        panel.style.removeProperty("--modal-translate-y");
        panel.style.transition = "";
        panel.style.opacity = "";
        panel.classList.add("show");
      }

      document.body.classList.add("modal-open");

      requestAnimationFrame(() => {
        if (background) background.style.opacity = "1";
      });
    } else {
      this.filterPopoverElement.style.opacity = "0";
      this.filterPopoverElement.style.transform = "translateY(-10px)";
      this.filterPopoverElement.style.transition = "opacity 0.3s ease, transform 0.3s ease";

      if (background) {
        background.style.transition = "opacity 220ms ease";
        background.style.opacity = "0";
      }

      document.body.classList.add("modal-open");

      requestAnimationFrame(() => {
        this.filterPopoverElement.style.opacity = "1";
        this.filterPopoverElement.style.transform = "translateY(0)";
        if (background) background.style.opacity = "1";
      });
    }

    if (!this.calendarFilterSwipeBound && typeof window.addSwipeToCloseSimple === "function" && this.filterPopoverPanel && this.filterPopoverBackground) {
      this.calendarFilterSwipeBound = true;
      window.addSwipeToCloseSimple(this.filterPopoverPanel, this.filterPopoverBackground, () => this.closeFilterPopover(false));
    }

    this.activeFilterTrigger = triggerElement;
    if (this.filterTriggerDesktop) this.filterTriggerDesktop.setAttribute("aria-expanded", "true");
    if (this.filterTriggerMobile) this.filterTriggerMobile.setAttribute("aria-expanded", "true");

    this.applyFocusTrap(this.filterPopoverPanel || this.filterPopoverElement, () => this.closeFilterPopover());

    const focusTarget = this.filterPopoverElement.querySelector("input, button");
    if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
  }

  closeFilterPopover(restoreFocus = true, immediate = false) {
    if (!this.filterPopoverElement) return;

    const background = this.filterPopoverBackground;
    const panel = this.filterPopoverPanel;

    if (this.filterCloseTimer) {
      clearTimeout(this.filterCloseTimer);
      this.filterCloseTimer = null;
    }

    if (immediate) {
      if (panel) {
        panel.classList.remove("show", "swiping");
        panel.style.removeProperty("--modal-translate-y");
        panel.style.transition = "";
        panel.style.opacity = "";
      }
      this.filterPopoverElement.classList.add("hidden");
      this.filterPopoverElement.style.transition = "";
      this.filterPopoverElement.style.opacity = "";
      this.filterPopoverElement.style.transform = "";
      if (background) {
        background.style.transition = "";
        background.style.opacity = "";
      }
      document.body.classList.remove("modal-open");
    } else if (this.isMobile) {
      if (panel) {
        panel.classList.remove("show", "swiping");
        panel.style.removeProperty("--modal-translate-y");
        panel.style.transition = "";
        panel.style.opacity = "";
      }
      if (background) {
        background.style.transition = "opacity 220ms ease";
        background.style.opacity = "0";
      }

      this.filterCloseTimer = setTimeout(() => {
        this.filterPopoverElement.classList.add("hidden");
        this.filterPopoverElement.style.transition = "";
        this.filterPopoverElement.style.opacity = "";
        this.filterPopoverElement.style.transform = "";
        if (background) {
          background.style.transition = "";
          background.style.opacity = "";
        }
        document.body.classList.remove("modal-open");
        this.filterCloseTimer = null;
      }, 320);
    } else {
      this.filterPopoverElement.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      this.filterPopoverElement.style.opacity = "0";
      this.filterPopoverElement.style.transform = "translateY(-10px)";

      if (background) {
        background.style.transition = "opacity 220ms ease";
        background.style.opacity = "0";
      }

      this.filterCloseTimer = setTimeout(() => {
        this.filterPopoverElement.classList.add("hidden");
        this.filterPopoverElement.style.transition = "";
        this.filterPopoverElement.style.opacity = "";
        this.filterPopoverElement.style.transform = "";
        if (background) {
          background.style.transition = "";
          background.style.opacity = "";
        }
        document.body.classList.remove("modal-open");
        this.filterCloseTimer = null;
      }, 300);
    }

    if (this.filterTriggerDesktop) this.filterTriggerDesktop.setAttribute("aria-expanded", "false");
    if (this.filterTriggerMobile) this.filterTriggerMobile.setAttribute("aria-expanded", "false");

    if (restoreFocus && this.activeFilterTrigger) {
      this.activeFilterTrigger.focus();
    }

    this.activeFilterTrigger = null;
    this.clearFocusTrap();
  }

  handleDocumentPointerDown(event) {
    const target = event.target;

    if (this.filterPopoverElement && !this.filterPopoverElement.classList.contains("hidden")) {
      const clickedTrigger = target.closest("#calendar-filter-trigger, #calendar-filter-trigger-mobile");
      if (!clickedTrigger && !this.filterPopoverElement.contains(target)) {
        this.closeFilterPopover(false);
      }
    }

    if (this.slotPopover && !this.slotPopover.classList.contains("hidden")) {
      if (!this.slotPopover.contains(target) && target !== this.activeSlotTrigger) {
        this.closeSlotPopover(false);
      }
    }
  }

  handleRootActionClick(event) {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    if (!action) return;

    if (action === "slot-find" || action === "slot-busy" || action === "slot-cancel") {
      event.preventDefault();
      this.handleSlotAction(action);
      return;
    }

    if (action === "slot-sheet-close") {
      event.preventDefault();
      this.closeSlotSheet();
    }
  }

  applyFocusTrap(container, onEscape) {
    this.clearFocusTrap();

    const handler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape?.();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handler);
    this.activeFocusTrapCleanup = () => {
      document.removeEventListener("keydown", handler);
    };
  }

  clearFocusTrap() {
    if (typeof this.activeFocusTrapCleanup === "function") {
      this.activeFocusTrapCleanup();
    }
    this.activeFocusTrapCleanup = null;
  }

  handleResize() {
    this.checkMobile();

    if (!this.isMobile && this.slotPopover && !this.slotPopover.classList.contains("hidden") && this.activeSlotTrigger) {
      this.positionSlotPopover(this.activeSlotTrigger);
    }

    if (!this.isMobile && this.filterPopoverElement && !this.filterPopoverElement.classList.contains("hidden") && this.activeFilterTrigger) {
      const rect = this.activeFilterTrigger.getBoundingClientRect();
      this.filterPopoverElement.style.top = `${Math.round(rect.bottom + 8)}px`;
      this.filterPopoverElement.style.left = `${Math.round(rect.right - this.filterPopoverElement.offsetWidth)}px`;
    }
  }

  checkMobile() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth <= 1023;
    window.isMobile = this.isMobile;

    const breakpointChanged = this.isMobile !== wasMobile;
    this.applyViewportViewPreference();
    this.applyViewVisibility({ forceDayReset: breakpointChanged && this.currentView === VIEW_DAY });
  }

  updateMobileUI(forceReset) {
    this.updateDayViewState(forceReset);
    this.applyViewVisibility();
  }

  buildMobileViewSkeleton() {
    if (!this.mobileDayTabs) return;

    this.mobileDayTabs.innerHTML = "";
    this.dayOrder.forEach((dayCode, dayIndex) => {
      const tabButton = document.createElement("button");
      tabButton.type = "button";
      tabButton.className = "calendar-day-tab-btn";
      tabButton.dataset.action = "select-day";
      tabButton.dataset.dayIndex = String(dayIndex);
      tabButton.dataset.dayCode = dayCode;
      tabButton.setAttribute("role", "tab");
      tabButton.setAttribute("aria-label", this.dayLongNames[dayCode]);

      const label = document.createElement("span");
      label.className = "calendar-day-tab-label";
      label.textContent = this.dayShortButtons[dayCode];

      const todayChip = document.createElement("span");
      todayChip.className = "calendar-day-tab-today-chip";
      todayChip.textContent = "TODAY";
      todayChip.hidden = true;
      todayChip.setAttribute("aria-hidden", "true");

      tabButton.appendChild(label);
      tabButton.appendChild(todayChip);
      this.mobileDayTabs.appendChild(tabButton);
    });

    this.updateMobileDayButtons();
    this.updateDayHeaderState();
  }

  updateMobileDayButtons() {
    if (!this.mobileDayTabs) return;

    const currentDayCode = this.getCurrentDayCode();
    const buttons = this.mobileDayTabs.querySelectorAll(".calendar-day-tab-btn");
    buttons.forEach((button, index) => {
      const isActive = index === this.selectedMobileDayIndex;
      const isToday = button.dataset.dayCode === currentDayCode;
      const todayChip = button.querySelector(".calendar-day-tab-today-chip");

      button.classList.toggle("is-active", isActive);
      button.classList.toggle("is-today", isToday);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
      button.setAttribute("aria-label", `${this.dayLongNames[button.dataset.dayCode] || button.dataset.dayCode}${isToday ? " (Today)" : ""}`);

      if (todayChip) {
        todayChip.hidden = !isToday;
      }
    });
  }

  updateMobileTrackPosition(animate = true) {
    void animate;
  }

  getCurrentDayCode() {
    const dayMap = {
      Monday: "Mon",
      Tuesday: "Tue",
      Wednesday: "Wed",
      Thursday: "Thu",
      Friday: "Fri"
    };
    return dayMap[this.getCurrentDayName()] || null;
  }

  updateDayHeaderState() {
    const dayCode = this.dayOrder[this.selectedMobileDayIndex] || this.dayOrder[0];
    const dayLabel = this.dayLongNames[dayCode] || dayCode;

    if (this.dayHeaderTitle) {
      this.dayHeaderTitle.textContent = dayLabel;
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
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "select-day") {
        const dayIndex = parseInt(actionButton.dataset.dayIndex, 10);
        if (Number.isFinite(dayIndex)) this.selectMobileDayByIndex(dayIndex, true);
        return;
      }
      if (action === "day-course-view") {
        const courseKey = actionButton.dataset.courseKey;
        const course = this.mobileCourseLookup.get(courseKey);
        if (course) openCourseInfoMenu(course);
        return;
      }
      if (action === "day-saved-course-open") {
        const courseKey = actionButton.dataset.courseKey;
        const course = this.mobileCourseLookup.get(courseKey);
        if (course) openCourseInfoMenu(course);
        return;
      }
      if (action === "day-empty-toggle") {
        const dayCode = actionButton.dataset.dayCode;
        const periodNumber = parseInt(actionButton.dataset.periodNumber, 10);
        if (!dayCode || !Number.isFinite(periodNumber)) return;
        this.toggleMobilePeriod(dayCode, periodNumber);
        return;
      }
      if (action === "day-slot-find") {
        const dayCode = actionButton.dataset.dayCode;
        const periodNumber = parseInt(actionButton.dataset.periodNumber, 10);
        if (!dayCode || !Number.isFinite(periodNumber)) return;

        const typeFilters = this.getActiveTypeFilters();
        openCourseSearchForSlot({
          day: dayCode,
          period: periodNumber,
          term: this.displayedTerm,
          year: this.displayedYear,
          typeFilters: typeFilters.length > 0 ? typeFilters : undefined,
          source: "calendar-day-empty"
        });
        return;
      }
    }

    const row = event.target.closest(".calendar-day-period-row");
    if (!row || !this.mobileView?.contains(row)) return;

    const dayCode = row.dataset.dayCode;
    const periodNumber = parseInt(row.dataset.periodNumber, 10);
    if (!dayCode || !Number.isFinite(periodNumber)) return;
    const canExpand = row.dataset.canExpand === "true";

    const clickedPreviewCard = event.target.closest(".calendar-day-period-preview");
    if (clickedPreviewCard && row.classList.contains("is-occupied") && row.classList.contains("is-expanded")) {
      const slotCourses = this.getCoursesForSlot(dayCode, periodNumber);
      const primaryCourse = Array.isArray(slotCourses) ? slotCourses[0] : null;
      if (primaryCourse) {
        openCourseInfoMenu(primaryCourse);
        return;
      }
    }

    if (!canExpand) return;
    this.toggleMobilePeriod(dayCode, periodNumber);
  }

  handleMobileViewKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".calendar-day-period-row");
    if (!row || event.target !== row) return;

    const dayCode = row.dataset.dayCode;
    const periodNumber = parseInt(row.dataset.periodNumber, 10);
    if (!dayCode || !Number.isFinite(periodNumber)) return;
    const canExpand = row.dataset.canExpand === "true";
    if (!canExpand) return;

    event.preventDefault();
    this.toggleMobilePeriod(dayCode, periodNumber);
  }

  handleListViewClick(event) {
    const row = event.target.closest(".calendar-list-item");
    if (!row) return;

    const courseKey = row.dataset.courseKey;
    if (!courseKey) return;

    const course = this.listCourseLookup.get(courseKey);
    if (course) openCourseInfoMenu(course);
  }

  selectMobileDayByIndex(dayIndex, animate = true) {
    const boundedIndex = Math.max(0, Math.min(this.dayOrder.length - 1, dayIndex));
    if (boundedIndex === this.selectedMobileDayIndex) return;

    const previousIndex = this.selectedMobileDayIndex;
    const direction = boundedIndex > previousIndex ? "forward" : "backward";

    this.selectedMobileDayIndex = boundedIndex;
    const dayCode = this.dayOrder[this.selectedMobileDayIndex];

    this.ensureExpandedPeriodForDay(dayCode);
    this.updateMobileDayButtons();
    this.updateDayHeaderState();
    this.renderMobileSchedule({ animate, direction });
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
    const dayMap = {
      Monday: 0,
      Tuesday: 1,
      Wednesday: 2,
      Thursday: 3,
      Friday: 4
    };

    return dayMap[currentDayName] ?? 0;
  }

  isWeekendDay(dayName) {
    return dayName === "Saturday" || dayName === "Sunday";
  }

  getSuggestedExpandedPeriod() {
    if (this.isWeekendDay(this.getCurrentDayName())) return null;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const currentPeriod = this.periodDefinitions.find((period) => currentMinutes >= period.start && currentMinutes <= period.end);
    return currentPeriod ? currentPeriod.number : null;
  }

  getDefaultExpandedPeriodForDay(dayCode) {
    if (!dayCode) return null;
    const todayCode = this.getCurrentDayCode();
    if (!todayCode || dayCode !== todayCode) return null;
    return this.getSuggestedExpandedPeriod();
  }

  ensureExpandedPeriodForDay(dayCode) {
    if (!dayCode) return;

    if (!Object.prototype.hasOwnProperty.call(this.expandedMobilePeriodByDay, dayCode)) {
      this.expandedMobilePeriodByDay[dayCode] = this.getDefaultExpandedPeriodForDay(dayCode);
    }
  }

  canExpandDayPeriod(dayCode, periodNumber) {
    if (!dayCode || !Number.isFinite(periodNumber)) return false;

    const slotCourses = this.getCoursesForSlot(dayCode, periodNumber);
    if (Array.isArray(slotCourses) && slotCourses.length > 0) return true;

    if (this.isSlotBusy(dayCode, periodNumber)) return true;

    const savedSuggestions = this.getSavedSuggestionsForSlot(dayCode, periodNumber, 1);
    return Array.isArray(savedSuggestions) && savedSuggestions.length > 0;
  }

  toggleMobilePeriod(dayCode, periodNumber) {
    if (!dayCode || !Number.isFinite(periodNumber)) return;
    if (!this.canExpandDayPeriod(dayCode, periodNumber)) return;

    const currentlyExpanded = this.expandedMobilePeriodByDay[dayCode];
    if (currentlyExpanded === periodNumber) {
      this.expandedMobilePeriodByDay[dayCode] = null;
    } else {
      this.expandedMobilePeriodByDay[dayCode] = periodNumber;
    }

    this.applyMobileExpandedState();
  }

  applyMobileExpandedState() {
    if (!this.dayAgenda) return;

    const dayCode = this.dayOrder[this.selectedMobileDayIndex];
    const expandedPeriod = dayCode ? this.expandedMobilePeriodByDay[dayCode] : null;
    const periodRows = this.dayAgenda.querySelectorAll(".calendar-day-period-row");
    periodRows.forEach((row) => {
      const periodNumber = parseInt(row.dataset.periodNumber, 10);
      const canExpand = row.dataset.canExpand === "true";
      const allowRowToggle = row.dataset.allowToggle === "true";
      const isExpanded = Number.isFinite(periodNumber) && canExpand && expandedPeriod === periodNumber;
      row.classList.toggle("is-expanded", isExpanded);
      if (allowRowToggle && canExpand) {
        row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      } else {
        row.removeAttribute("aria-expanded");
      }
    });
  }

  getSlotKey(dayCode, periodNumber) {
    return `${dayCode}-${periodNumber}`;
  }

  getBusySlotSemesterKey() {
    const year = Number.isFinite(parseInt(this.displayedYear, 10)) ? parseInt(this.displayedYear, 10) : null;
    const term = this.normalizeTermValue(this.displayedTerm);
    if (!year || !term) return null;
    return `${year}-${term}`;
  }

  loadBusySlotsForDisplayedSemester() {
    this.busySlots = new Set();
    const semesterKey = this.getBusySlotSemesterKey();
    if (!semesterKey) return;

    try {
      const raw = window.localStorage.getItem(CALENDAR_BUSY_SLOTS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed?.[semesterKey]) ? parsed[semesterKey] : [];
      values.forEach((value) => {
        const normalized = String(value || "").trim();
        if (!normalized) return;
        this.busySlots.add(normalized);
      });
    } catch (error) {
      console.warn("Unable to load busy slot state:", error);
    }
  }

  persistBusySlotsForDisplayedSemester() {
    const semesterKey = this.getBusySlotSemesterKey();
    if (!semesterKey) return;

    try {
      const raw = window.localStorage.getItem(CALENDAR_BUSY_SLOTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[semesterKey] = Array.from(this.busySlots);
      window.localStorage.setItem(CALENDAR_BUSY_SLOTS_STORAGE_KEY, JSON.stringify(parsed));
    } catch (error) {
      console.warn("Unable to save busy slot state:", error);
    }
  }

  isSlotBusy(dayCode, periodNumber) {
    return this.busySlots.has(this.getSlotKey(dayCode, periodNumber));
  }

  setSlotBusy(dayCode, periodNumber, isBusy) {
    const key = this.getSlotKey(dayCode, periodNumber);
    if (isBusy) {
      this.busySlots.add(key);
    } else {
      this.busySlots.delete(key);
    }
    this.persistBusySlotsForDisplayedSemester();
  }

  getCoursesForSlot(dayCode, periodNumber) {
    const key = this.getSlotKey(dayCode, periodNumber);
    return this.mobileCoursesBySlot.get(key) || [];
  }

  getPeriodDefinition(periodNumber) {
    return this.periodDefinitions.find((periodDef) => periodDef.number === Number(periodNumber)) || null;
  }

  getSlotSubtitle(day, period) {
    const periodDef = this.getPeriodDefinition(period);
    if (!periodDef) return `${day} period ${period}`;
    return `${day} period ${period} (${periodDef.timeRange})`;
  }

  getActiveTypeFilters() {
    if (!this.filterState.typeFilters || this.filterState.typeFilters.size === 0) return [];

    const mappedGroups = new Set();
    this.filterState.typeFilters.forEach((typeFilter) => {
      if (typeFilter === "UnderstandingJapanKyoto" || typeFilter === "AcademicSkills") {
        mappedGroups.add("Foundation");
      } else if (typeFilter === "Special" || typeFilter === "SeminarHonorThesis") {
        mappedGroups.add("Elective");
      } else {
        mappedGroups.add("Core");
      }
    });

    return Array.from(mappedGroups);
  }

  openSlotActionMenu(slot, triggerElement) {
    const day = slot?.day;
    const period = Number(slot?.period);
    if (!day || !Number.isFinite(period)) return;

    this.activeSlot = { day, period };
    this.activeSlotTrigger = triggerElement || null;
    this.closeFilterPopover(false);

    if (this.isMobile) {
      this.openSlotSheet();
      return;
    }

    this.openSlotPopover();
  }

  openSlotPopover() {
    if (!this.slotPopover || !this.activeSlot) return;

    this.closeSlotSheet(false);

    this.slotPopoverSubtitle.textContent = this.getSlotSubtitle(this.activeSlot.day, this.activeSlot.period);
    this.syncSlotActionButtons();
    this.slotPopover.classList.remove("hidden");

    if (this.activeSlotTrigger) this.positionSlotPopover(this.activeSlotTrigger);

    this.applyFocusTrap(this.slotPopover, () => this.closeSlotPopover());

    const firstButton = this.slotPopover.querySelector("button[data-action='slot-find']");
    if (firstButton) setTimeout(() => firstButton.focus(), 0);
  }

  positionSlotPopover(triggerElement) {
    if (!this.slotPopover || !triggerElement) return;

    const rect = triggerElement.getBoundingClientRect();
    const popoverRect = this.slotPopover.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 8;

    if (left + popoverRect.width > window.innerWidth - 12) {
      left = window.innerWidth - popoverRect.width - 12;
    }

    if (top + popoverRect.height > window.innerHeight - 12) {
      top = rect.top - popoverRect.height - 8;
    }

    left = Math.max(12, left);
    top = Math.max(12, top);

    this.slotPopover.style.left = `${Math.round(left)}px`;
    this.slotPopover.style.top = `${Math.round(top)}px`;
  }

  closeSlotPopover(restoreFocus = true) {
    if (!this.slotPopover) return;

    const wasOpen = !this.slotPopover.classList.contains("hidden");
    this.slotPopover.classList.add("hidden");
    this.slotPopover.style.left = "";
    this.slotPopover.style.top = "";

    if (wasOpen && restoreFocus && this.activeSlotTrigger) {
      this.activeSlotTrigger.focus();
    }

    if (wasOpen) this.clearFocusTrap();
  }

  openSlotSheet() {
    if (!this.slotSheetLayer || !this.slotSheet || !this.activeSlot) return;

    this.closeSlotPopover(false);

    this.slotSheetSubtitle.textContent = this.getSlotSubtitle(this.activeSlot.day, this.activeSlot.period);
    this.syncSlotActionButtons();
    this.slotSheetLayer.classList.remove("hidden");
    this.slotSheetLayer.setAttribute("aria-hidden", "false");

    this.slotSheet.classList.add("show");
    document.body.classList.add("modal-open");

    if (!this.slotSheetSwipeBound && typeof window.addSwipeToCloseSimple === "function") {
      const backdrop = this.slotSheetLayer.querySelector(".calendar-slot-sheet-backdrop");
      if (backdrop) {
        this.slotSheetSwipeBound = true;
        window.addSwipeToCloseSimple(this.slotSheet, backdrop, () => this.closeSlotSheet(true));
      }
    }

    this.applyFocusTrap(this.slotSheet, () => this.closeSlotSheet());

    const firstButton = this.slotSheet.querySelector("button[data-action='slot-find']");
    if (firstButton) setTimeout(() => firstButton.focus(), 30);
  }

  closeSlotSheet(restoreFocus = true) {
    if (!this.slotSheetLayer || !this.slotSheet) return;

    const wasOpen = !this.slotSheetLayer.classList.contains("hidden");

    this.slotSheet.classList.remove("show");
    this.slotSheetLayer.classList.add("hidden");
    this.slotSheetLayer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    if (wasOpen && restoreFocus && this.activeSlotTrigger) {
      this.activeSlotTrigger.focus();
    }

    if (wasOpen) this.clearFocusTrap();
  }

  closeSlotActionMenus(restoreFocus = false) {
    this.closeSlotPopover(restoreFocus);
    this.closeSlotSheet(restoreFocus);
  }

  syncSlotActionButtons() {
    if (!this.activeSlot) return;
    const isBusy = this.isSlotBusy(this.activeSlot.day, this.activeSlot.period);
    const label = isBusy ? "Mark as available" : "Mark as busy";
    const aria = isBusy ? "Mark this slot as available" : "Mark this slot as busy";

    const buttons = [];
    if (this.slotPopover) {
      const btn = this.slotPopover.querySelector("[data-action='slot-busy']");
      if (btn) buttons.push(btn);
    }
    if (this.slotSheet) {
      const btn = this.slotSheet.querySelector("[data-action='slot-busy']");
      if (btn) buttons.push(btn);
    }

    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = label;
      button.setAttribute("aria-label", aria);
    });
  }

  handleSlotAction(action) {
    if (!this.activeSlot || !action) return;

    if (action === "slot-cancel") {
      this.closeSlotActionMenus(true);
      return;
    }

    if (action === "slot-busy") {
      const currentlyBusy = this.isSlotBusy(this.activeSlot.day, this.activeSlot.period);
      this.setSlotBusy(this.activeSlot.day, this.activeSlot.period, !currentlyBusy);
      this.applyActiveFiltersAndRender();
      this.closeSlotActionMenus(true);
      return;
    }

    if (action !== "slot-find") return;

    const typeFilters = this.getActiveTypeFilters();

    openCourseSearchForSlot({
      day: this.activeSlot.day,
      period: this.activeSlot.period,
      term: this.displayedTerm,
      year: this.displayedYear,
      typeFilters: typeFilters.length > 0 ? typeFilters : undefined,
      source: "calendar"
    });

    this.closeSlotActionMenus(false);
  }

  getSavedSuggestionsForSlot(dayCode, periodNumber, limit = 3) {
    const normalizedDay = String(dayCode || "").trim();
    const normalizedPeriod = Number(periodNumber);
    if (!normalizedDay || !Number.isFinite(normalizedPeriod)) return [];

    const selectedYear = Number.parseInt(this.displayedYear, 10);
    const selectedTerm = this.normalizeTermValue(this.displayedTerm);
    const savedItems = readSavedCourses(Number.POSITIVE_INFINITY);

    return (Array.isArray(savedItems) ? savedItems : [])
      .filter((item) => {
        if (String(item?.day || "").trim() !== normalizedDay) return false;
        if (Number(item?.period) !== normalizedPeriod) return false;

        const itemYear = Number.parseInt(item?.year, 10);
        const itemTerm = this.normalizeTermValue(item?.term);
        const matchesYear = Number.isFinite(itemYear) ? itemYear === selectedYear : true;
        const matchesTerm = itemTerm ? itemTerm === selectedTerm : true;
        return matchesYear && matchesTerm;
      })
      .slice(0, limit);
  }

  getCourseCreditsLabel(course) {
    const raw = course?.credits;
    if (raw === null || raw === undefined || raw === "") return null;

    const matched = String(raw).match(/(\d+(\.\d+)?)/);
    if (!matched) return String(raw);

    const parsed = Number.parseFloat(matched[1]);
    if (!Number.isFinite(parsed)) return String(raw);

    const formatted = Number.isInteger(parsed) ? parsed.toFixed(0) : parsed.toFixed(1).replace(/\.0$/, "");
    return `${formatted} ${parsed === 1 ? "Credit" : "Credits"}`;
  }

  createDayPeriodRow({ dayCode, periodDef, isExpanded, isToday, courses, matchingSuggestions, canExpand }) {
    const hasCourses = Array.isArray(courses) && courses.length > 0;
    const primaryCourse = hasCourses ? courses[0] : null;
    const isBusy = !hasCourses && this.isSlotBusy(dayCode, periodDef.number);
    const savedSuggestionCount = Array.isArray(matchingSuggestions) ? matchingSuggestions.length : 0;
    const isCurrentPeriod = isToday && this.getSuggestedExpandedPeriod() === periodDef.number;

    const row = document.createElement("article");
    row.className = "calendar-day-period-row";
    row.dataset.dayCode = dayCode;
    row.dataset.periodNumber = String(periodDef.number);
    const allowRowToggle = hasCourses || isBusy || savedSuggestionCount > 0;
    row.setAttribute("tabindex", allowRowToggle && canExpand ? "0" : "-1");
    row.setAttribute("role", allowRowToggle && canExpand ? "button" : "group");
    if (allowRowToggle && canExpand) {
      row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    } else {
      row.removeAttribute("aria-expanded");
    }
    row.classList.toggle("is-occupied", hasCourses);
    row.classList.toggle("is-empty", !hasCourses);
    row.classList.toggle("is-expanded", isExpanded);
    row.classList.toggle("is-today", isToday);
    row.classList.toggle("is-current-period", isCurrentPeriod);
    row.classList.toggle("can-expand", !!canExpand);
    row.classList.toggle("cannot-expand", !canExpand);
    row.dataset.canExpand = canExpand ? "true" : "false";
    row.dataset.allowToggle = allowRowToggle ? "true" : "false";

    const left = document.createElement("div");
    left.className = "calendar-day-period-left";

    const periodLabel = document.createElement("p");
    periodLabel.className = "calendar-day-period-label";
    periodLabel.textContent = `Period ${periodDef.number}`;

    const periodTime = document.createElement("p");
    periodTime.className = "calendar-day-period-time";
    periodTime.textContent = periodDef.timeRange;

    left.appendChild(periodLabel);
    left.appendChild(periodTime);

    if (isCurrentPeriod) {
      const nowChip = document.createElement("span");
      nowChip.className = "calendar-now-chip calendar-day-now-chip";
      nowChip.textContent = "● NOW";
      nowChip.setAttribute("aria-label", "Now");
      left.appendChild(nowChip);
    }

    const right = document.createElement("div");
    right.className = "calendar-day-period-right";

    const previewCard = document.createElement("div");
    previewCard.className = "calendar-day-period-preview";
    const previewMain = document.createElement("div");
    previewMain.className = "calendar-day-preview-main";
    const previewExtra = document.createElement("div");
    previewExtra.className = "calendar-day-preview-extra";

    if (hasCourses && primaryCourse) {
      const previewTitle = document.createElement("p");
      previewTitle.className = "calendar-day-preview-title";
      previewTitle.textContent = this.getDetailedTitle(primaryCourse);

      const previewProfessor = document.createElement("p");
      previewProfessor.className = "calendar-day-preview-professor";
      previewProfessor.textContent = formatProfessorDisplayName(primaryCourse.professor);

      previewCard.style.backgroundColor = this.getCalendarCourseColor(primaryCourse.type);
      previewMain.appendChild(previewTitle);
      previewMain.appendChild(previewProfessor);

      if (courses.length > 1) {
        const overflow = document.createElement("span");
        overflow.className = "calendar-day-preview-count";
        overflow.textContent = `+${courses.length - 1}`;
        previewCard.appendChild(overflow);
      }

      const courseKey = `${dayCode}-${periodDef.number}-${primaryCourse.course_code || "course"}-day-primary`;
      this.mobileCourseLookup.set(courseKey, primaryCourse);

      const metaRow = document.createElement("div");
      metaRow.className = "calendar-day-expanded-meta-row";

      const metaChipRow = document.createElement("div");
      metaChipRow.className = "calendar-day-meta-chip-row";

      const typeChip = document.createElement("span");
      typeChip.className = "calendar-day-meta-chip calendar-day-meta-chip-type";
      typeChip.textContent = this.getLegendLabelForCourse(primaryCourse?.type) || String(primaryCourse?.type || "Course");

      const creditsLabel = this.getCourseCreditsLabel(primaryCourse);
      const creditsChip = document.createElement("span");
      creditsChip.className = "calendar-day-meta-chip calendar-day-meta-chip-credits";
      creditsChip.textContent = creditsLabel || "Credits TBA";

      const registeredChip = document.createElement("span");
      registeredChip.className = "calendar-day-meta-chip calendar-day-meta-chip-status calendar-day-meta-chip-status-registered";
      registeredChip.textContent = "Registered";

      metaChipRow.appendChild(typeChip);
      metaChipRow.appendChild(creditsChip);
      metaChipRow.appendChild(registeredChip);

      const createViewCourseAction = (variantClass) => {
        const action = document.createElement("span");
        action.className = `assignment-item-right calendar-day-assignment-action ${variantClass}`;
        action.dataset.action = "day-course-view";
        action.dataset.courseKey = courseKey;
        action.setAttribute("role", "button");
        action.setAttribute("aria-label", "View course");

        const label = document.createElement("span");
        label.className = "assignment-item-hover-action calendar-day-assignment-action-label";
        label.textContent = "View course";
        label.setAttribute("aria-hidden", "true");

        const chevron = document.createElement("span");
        chevron.className = "assignment-item-chevron calendar-day-assignment-action-chevron";
        chevron.setAttribute("aria-hidden", "true");

        action.appendChild(label);
        action.appendChild(chevron);
        return action;
      };

      const inlineAction = createViewCourseAction("calendar-day-assignment-action-mobile");
      const desktopAction = createViewCourseAction("calendar-day-assignment-action-desktop");
      metaRow.appendChild(metaChipRow);
      metaRow.appendChild(inlineAction);
      previewExtra.appendChild(metaRow);
      previewCard.appendChild(desktopAction);

      if (courses.length > 1) {
        const moreClassesHeading = document.createElement("p");
        moreClassesHeading.className = "calendar-day-suggestions-heading";
        moreClassesHeading.textContent = "Also in this slot";

        const moreClassesList = document.createElement("ul");
        moreClassesList.className = "calendar-day-suggestions-list";
        courses.slice(1).forEach((course) => {
          const item = document.createElement("li");
          item.className = "calendar-day-suggestion-item";
          item.textContent = this.getDetailedTitle(course);
          moreClassesList.appendChild(item);
        });

        previewExtra.appendChild(moreClassesHeading);
        previewExtra.appendChild(moreClassesList);
      }
    } else {
      const previewTitle = document.createElement("p");
      previewTitle.className = "calendar-day-preview-title";
      previewTitle.textContent = isBusy ? "Busy slot" : "Empty slot";

      const previewMeta = document.createElement("p");
      previewMeta.className = "calendar-day-preview-meta";
      previewMeta.textContent = isBusy ? "Marked as busy" : "";

      previewCard.classList.add("is-empty-preview");
      previewMain.appendChild(previewTitle);
      if (isBusy) {
        previewMain.appendChild(previewMeta);
      } else {
        previewMain.classList.add("calendar-day-empty-main");
        if (savedSuggestionCount === 0) {
          previewCard.dataset.action = "day-slot-find";
          previewCard.dataset.dayCode = dayCode;
          previewCard.dataset.periodNumber = String(periodDef.number);
          previewCard.setAttribute("role", "button");
          previewCard.setAttribute("aria-label", `Find course for period ${periodDef.number}`);
        }

        const headerRow = document.createElement("div");
        headerRow.className = "calendar-day-empty-header";
        const leftStack = document.createElement("div");
        leftStack.className = "calendar-day-empty-left";
        leftStack.appendChild(previewTitle);

        previewMain.replaceChildren(headerRow);

        if (savedSuggestionCount > 0) {
          const savedChip = document.createElement("button");
          savedChip.type = "button";
          savedChip.className = "calendar-day-meta-chip calendar-day-empty-saved-chip";
          savedChip.dataset.action = "day-empty-toggle";
          savedChip.dataset.dayCode = dayCode;
          savedChip.dataset.periodNumber = String(periodDef.number);
          savedChip.setAttribute("aria-label", `Show ${savedSuggestionCount} saved course${savedSuggestionCount === 1 ? "" : "s"}`);
          savedChip.textContent = `${savedSuggestionCount} saved course${savedSuggestionCount === 1 ? "" : "s"}`;
          leftStack.appendChild(savedChip);
        }
        headerRow.appendChild(leftStack);

        const findInline = document.createElement("span");
        findInline.className = "assignment-item-right calendar-day-assignment-action calendar-day-empty-find-action";
        findInline.dataset.action = "day-slot-find";
        findInline.dataset.dayCode = dayCode;
        findInline.dataset.periodNumber = String(periodDef.number);
        findInline.setAttribute("role", "button");
        findInline.setAttribute("aria-label", "Find course");

        const findLabel = document.createElement("span");
        findLabel.className = "assignment-item-hover-action calendar-day-assignment-action-label";
        findLabel.textContent = "Find course";
        findLabel.setAttribute("aria-hidden", "true");

        const findChevron = document.createElement("span");
        findChevron.className = "assignment-item-chevron calendar-day-assignment-action-chevron";
        findChevron.setAttribute("aria-hidden", "true");

        findInline.appendChild(findLabel);
        findInline.appendChild(findChevron);
        headerRow.appendChild(findInline);
      }

      if (Array.isArray(matchingSuggestions) && matchingSuggestions.length > 0) {
        const suggestionHeader = document.createElement("p");
        suggestionHeader.className = "calendar-day-suggestions-heading";
        suggestionHeader.textContent = "Saved courses matching this slot";

        const suggestionList = document.createElement("ul");
        suggestionList.className = "calendar-day-suggestions-list";
        matchingSuggestions.forEach((item, index) => {
          const savedKey = `${dayCode}-${periodDef.number}-saved-${index}`;
          this.mobileCourseLookup.set(savedKey, item);

          const listItem = document.createElement("li");
          listItem.className = "calendar-day-suggestion-item";
          listItem.style.backgroundColor = this.getCalendarCourseColor(item?.type);

          const entry = document.createElement("button");
          entry.type = "button";
          entry.className = "calendar-day-suggestion-item-btn";
          entry.dataset.action = "day-saved-course-open";
          entry.dataset.courseKey = savedKey;
          entry.setAttribute("aria-label", `Open ${String(item?.title || item?.code || "saved course")}`);
          entry.textContent = String(item?.title || item?.code || "Saved course");

          listItem.appendChild(entry);
          suggestionList.appendChild(listItem);
        });

        previewExtra.appendChild(suggestionHeader);
        previewExtra.appendChild(suggestionList);
      }
    }

    previewCard.appendChild(previewMain);
    previewCard.appendChild(previewExtra);
    right.appendChild(previewCard);
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  applyDayAgendaSwipeAnimation(direction) {
    if (!this.dayAgenda) return;
    if (direction !== "forward" && direction !== "backward") return;

    this.dayAgenda.classList.remove("is-day-switching-forward", "is-day-switching-backward");
    void this.dayAgenda.offsetWidth;
    this.dayAgenda.classList.add(direction === "forward" ? "is-day-switching-forward" : "is-day-switching-backward");

    if (this.daySwitchAnimationTimer) {
      clearTimeout(this.daySwitchAnimationTimer);
    }
    this.daySwitchAnimationTimer = setTimeout(() => {
      this.dayAgenda?.classList.remove("is-day-switching-forward", "is-day-switching-backward");
      this.daySwitchAnimationTimer = null;
    }, 260);
  }

  renderMobileSchedule({ animate = false, direction = null } = {}) {
    if (!this.dayAgenda) return;

    this.mobileCourseLookup.clear();
    this.dayAgenda.innerHTML = "";

    const dayCode = this.dayOrder[this.selectedMobileDayIndex] || this.dayOrder[0];
    if (!dayCode) return;

    const isToday = dayCode === this.getCurrentDayCode();
    const expandedPeriod = this.expandedMobilePeriodByDay[dayCode];
    const fragment = document.createDocumentFragment();

    this.periodDefinitions.forEach((periodDef) => {
      const slotCourses = this.getCoursesForSlot(dayCode, periodDef.number);
      const suggestions = slotCourses.length === 0
        ? this.getSavedSuggestionsForSlot(dayCode, periodDef.number)
        : [];
      const canExpand = slotCourses.length > 0 || this.isSlotBusy(dayCode, periodDef.number) || suggestions.length > 0;
      const row = this.createDayPeriodRow({
        dayCode,
        periodDef,
        isExpanded: canExpand && expandedPeriod === periodDef.number,
        isToday,
        courses: slotCourses,
        matchingSuggestions: suggestions,
        canExpand
      });
      fragment.appendChild(row);
    });

    this.dayAgenda.appendChild(fragment);
    this.applyMobileExpandedState();
    if (animate) {
      this.applyDayAgendaSwipeAnimation(direction);
    }
  }

  renderListSchedule() {
    if (!this.listContent) return;

    this.listCourseLookup.clear();
    this.listContent.innerHTML = "";

    const hasRegisteredCourses = Array.isArray(this.allRegisteredCourses) && this.allRegisteredCourses.length > 0;
    let hasVisibleCourses = false;
    const fragment = document.createDocumentFragment();

    this.dayOrder.forEach((dayCode) => {
      const daySection = document.createElement("section");
      daySection.className = "calendar-list-day-group";

      const heading = document.createElement("h3");
      heading.className = "calendar-list-day-heading";
      heading.textContent = this.dayLongNames[dayCode] || dayCode;
      daySection.appendChild(heading);

      const list = document.createElement("div");
      list.className = "calendar-list-day-items";

      this.periodDefinitions.forEach((periodDef) => {
        const slotCourses = [...this.getCoursesForSlot(dayCode, periodDef.number)];
        if (slotCourses.length === 0) return;

        slotCourses.sort((a, b) => this.getDetailedTitle(a).localeCompare(this.getDetailedTitle(b)));

        slotCourses.forEach((course, courseIndex) => {
          hasVisibleCourses = true;
          const courseKey = `${dayCode}-${periodDef.number}-${course.course_code || "course"}-${courseIndex}-list`;
          this.listCourseLookup.set(courseKey, course);

          const row = document.createElement("button");
          row.type = "button";
          row.className = "calendar-list-item";
          row.dataset.courseKey = courseKey;
          const courseColor = this.getCalendarCourseColor(course.type);
          row.style.setProperty("--calendar-list-item-bg", courseColor);

          const title = document.createElement("p");
          title.className = "calendar-list-item-title";
          title.textContent = this.getDetailedTitle(course);

          const meta = document.createElement("p");
          meta.className = "calendar-list-item-meta";
          meta.textContent = `${this.dayLongNames[dayCode]} • Period ${periodDef.number} • ${periodDef.timeRange}`;

          const professor = document.createElement("p");
          professor.className = "calendar-list-item-professor";
          professor.textContent = formatProfessorDisplayName(course.professor);

          const badges = document.createElement("div");
          badges.className = "calendar-list-item-badges";

          const typeBadge = document.createElement("span");
          typeBadge.className = "calendar-list-type-badge";
          typeBadge.textContent = this.getLegendLabelForCourse(course.type) || String(course.type || "Course");

          const creditsLabel = this.getCourseCreditsLabel(course);
          const creditsBadge = document.createElement("span");
          creditsBadge.className = "calendar-list-credits-badge";
          creditsBadge.textContent = creditsLabel || "Credits TBA";

          const registeredBadge = document.createElement("span");
          registeredBadge.className = "calendar-list-registered-badge";
          registeredBadge.textContent = "Registered";

          badges.appendChild(typeBadge);
          badges.appendChild(creditsBadge);
          badges.appendChild(registeredBadge);
          row.appendChild(title);
          row.appendChild(meta);
          row.appendChild(professor);
          row.appendChild(badges);
          list.appendChild(row);
        });
      });

      if (list.children.length > 0) {
        daySection.appendChild(list);
        fragment.appendChild(daySection);
      }
    });

    if (!hasRegisteredCourses) {
      const emptyState = document.createElement("div");
      emptyState.className = "calendar-list-empty-state";
      emptyState.textContent = "No registered courses for this term yet.";
      this.listContent.appendChild(emptyState);
      return;
    }

    if (!hasVisibleCourses) {
      const emptyState = document.createElement("div");
      emptyState.className = "calendar-list-empty-state";
      emptyState.textContent = "No courses match your current filters.";
      this.listContent.appendChild(emptyState);
      return;
    }

    this.listContent.appendChild(fragment);
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

  showAllDays() {
    this.calendar.querySelectorAll("tr").forEach((row) => {
      Array.from(row.cells).forEach((cell) => {
        cell.style.display = "table-cell";
      });
    });
  }

  getCurrentYearTerm() {
    const hiddenValues = this.getYearTermFromHiddenInputs();
    if (hiddenValues) return hiddenValues;

    const semesterValues = this.getYearTermFromSemesterSelects();
    if (semesterValues) {
      this.syncHiddenYearTerm(semesterValues.year, semesterValues.term);
      return semesterValues;
    }

    const fallbackYear = window.getCurrentYear
      ? parseInt(window.getCurrentYear(), 10)
      : new Date().getFullYear();
    const fallbackTerm = window.getCurrentTerm
      ? this.normalizeTermValue(window.getCurrentTerm())
      : "Fall";

    return {
      year: Number.isFinite(fallbackYear) ? fallbackYear : new Date().getFullYear(),
      term: fallbackTerm || "Fall"
    };
  }

  getYearTermFromHiddenInputs() {
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");

    const year = yearSelect && yearSelect.value && !Number.isNaN(parseInt(yearSelect.value, 10))
      ? parseInt(yearSelect.value, 10)
      : null;
    const termRaw = termSelect && termSelect.value
      ? String(termSelect.value).trim()
      : "";
    const term = this.normalizeTermValue(termRaw);

    if (!Number.isFinite(year) || !term) return null;
    return { year, term };
  }

  parseSemesterValue(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "Loading...") return null;

    const parts = raw.split("-");
    if (parts.length < 2) return null;

    const year = parseInt(parts[parts.length - 1], 10);
    const termPart = parts.slice(0, -1).join("-").trim();
    const term = this.normalizeTermValue(termPart);

    if (!Number.isFinite(year) || !term) return null;
    return { year, term };
  }

  getYearTermFromSemesterSelects() {
    const semesterSelectIds = ["semester-select", "semester-select-mobile"];

    for (const selectId of semesterSelectIds) {
      const select = document.getElementById(selectId);
      if (!select) continue;

      const direct = this.parseSemesterValue(select.value);
      if (direct) return direct;

      const selectedOptionValue = select.options && select.selectedIndex >= 0
        ? select.options[select.selectedIndex]?.value
        : "";
      const fromOptionValue = this.parseSemesterValue(selectedOptionValue);
      if (fromOptionValue) return fromOptionValue;

      const selectedOptionText = select.options && select.selectedIndex >= 0
        ? select.options[select.selectedIndex]?.textContent
        : "";
      const fromOptionText = this.parseSemesterValue(selectedOptionText);
      if (fromOptionText) return fromOptionText;
    }

    return null;
  }

  syncHiddenYearTerm(year, term) {
    const yearSelect = document.getElementById("year-select");
    const termSelect = document.getElementById("term-select");

    if (yearSelect && Number.isFinite(parseInt(year, 10))) {
      yearSelect.value = String(parseInt(year, 10));
    }
    if (termSelect && term) {
      termSelect.value = term;
    }
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async resolveInitialYearTerm(maxWaitMs = 2600, intervalMs = 80) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const hiddenValues = this.getYearTermFromHiddenInputs();
      if (hiddenValues) return hiddenValues;

      const semesterValues = this.getYearTermFromSemesterSelects();
      if (semesterValues) {
        this.syncHiddenYearTerm(semesterValues.year, semesterValues.term);
        return semesterValues;
      }

      await this.wait(intervalMs);
    }

    return this.getCurrentYearTerm();
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

      const { year, term } = await this.resolveInitialYearTerm();
      await this.showCourseWithRetry(year, term);

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

  normalizeTermValue(term) {
    const rawTerm = String(term || "").trim();
    if (!rawTerm) return "";

    const lowered = rawTerm.toLowerCase();
    if (lowered.includes("fall") || rawTerm.includes("秋")) return "Fall";
    if (lowered.includes("spring") || rawTerm.includes("春")) return "Spring";

    if (rawTerm.includes("/")) {
      const split = rawTerm.split("/");
      return this.normalizeTermValue(split[split.length - 1]);
    }

    return rawTerm;
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

  getTypeGroupForCourse(typeLabel) {
    const raw = String(typeLabel || "").trim();
    if (!raw) return null;

    if (raw === "Japanese Society and Global Culture Concentration") return "Culture";
    if (raw === "Japanese Business and the Global Economy Concentration") return "Economy";
    if (raw === "Japanese Politics and Global Studies Concentration") return "Politics";
    if (raw === "Understanding Japan and Kyoto") return "UnderstandingJapanKyoto";
    if (raw === "Academic and Research Skills") return "AcademicSkills";
    if (raw === "Other Elective Courses" || raw === "Special Lecture Series") return "Special";

    if (
      raw === "Introductory Seminars"
      || raw === "Intermediate Seminars"
      || raw === "Advanced Seminars and Honors Thesis"
    ) {
      return "SeminarHonorThesis";
    }

    return null;
  }

  getCalendarCourseColor(typeLabel) {
    const raw = String(typeLabel || "").trim();

    const calendarTypeColors = {
      "Japanese Society and Global Culture Concentration": "#C1E0C8",
      "Japanese Business and the Global Economy Concentration": "#EFDC8F",
      "Japanese Politics and Global Studies Concentration": "#E77A84",
      "Special Lecture Series": "#BDA7F2",
      "Other Elective Courses": "#BDA7F2",
      "Understanding Japan and Kyoto": "#AED3F2",
      "Academic and Research Skills": "#A0BEE8"
    };

    return calendarTypeColors[raw] || getCourseColorByType(typeLabel);
  }

  getLegendLabelForCourse(typeLabel) {
    const raw = String(typeLabel || "").trim();
    if (!raw) return null;

    if (raw === "Japanese Society and Global Culture Concentration") return "Global Culture";
    if (raw === "Japanese Business and the Global Economy Concentration") return "Economy";
    if (raw === "Japanese Politics and Global Studies Concentration") return "Politics";
    if (raw === "Understanding Japan and Kyoto") return "Understanding Japan and Kyoto";
    if (raw === "Academic and Research Skills") return "Academic Skills";
    if (raw === "Other Elective Courses" || raw === "Special Lecture Series") return "Special Lecture Series";
    if (
      raw === "Introductory Seminars"
      || raw === "Intermediate Seminars"
      || raw === "Advanced Seminars and Honors Thesis"
    ) {
      return "Seminar and Honor Thesis";
    }

    return null;
  }

  passesTypeFilters(course) {
    if (!this.filterState.typeFilters || this.filterState.typeFilters.size === 0) return true;

    const group = this.getTypeGroupForCourse(course?.type);
    return group ? this.filterState.typeFilters.has(group) : false;
  }

  applyActiveFiltersAndRender() {
    let visibleCourses = Array.isArray(this.allRegisteredCourses) ? [...this.allRegisteredCourses] : [];

    if (!this.filterState.showRegistered) {
      visibleCourses = [];
    }

    visibleCourses = visibleCourses.filter((course) => this.passesTypeFilters(course));

    this.mobileCoursesBySlot.clear();
    this.desktopCourseLookup.clear();
    this.listCourseLookup.clear();

    visibleCourses.forEach((course) => {
      const parsed = this.parseCourseSchedule(course);
      if (!parsed) return;
      const key = this.getSlotKey(parsed.dayEN, parsed.period);
      const slotCourses = this.mobileCoursesBySlot.get(key) || [];
      slotCourses.push(course);
      this.mobileCoursesBySlot.set(key, slotCourses);
    });

    this.renderDesktopSchedule();
    this.renderMobileSchedule();
    this.renderListSchedule();
    this.applyViewVisibility();

    this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
    this.highlightCurrentTimePeriod();

    document.dispatchEvent(new CustomEvent("calendarPageRefreshed"));
  }

  async showCourse(year, term) {
    this.displayedYear = parseInt(year, 10);
    this.displayedTerm = this.normalizeTermValue(term);
    this.loadBusySlotsForDisplayedSemester();

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

        const normalizedTerm = this.normalizeTermValue(this.displayedTerm);
        selectedCourses = (profile?.courses_selection || []).filter((course) => {
          const courseYear = parseInt(course.year, 10);
          const courseTerm = this.normalizeTermValue(course.term);
          return courseYear === this.displayedYear && (!courseTerm || courseTerm === normalizedTerm);
        });
      }

      if (!this.currentUser || selectedCourses.length === 0) {
        this.allRegisteredCourses = [];
        this.applyActiveFiltersAndRender();
        return;
      }

      const allCoursesInSemester = await fetchCourseData(this.displayedYear, this.displayedTerm);
      const selectedCourseCodes = new Set(selectedCourses.map((course) => course.code));

      this.allRegisteredCourses = allCoursesInSemester.filter((course) => selectedCourseCodes.has(course.course_code));
      this.applyActiveFiltersAndRender();
    } catch (error) {
      console.error("Error showing courses in calendar page:", error);
      throw error;
    }
  }

  getColIndexByDayEN(dayEN) {
    const id = this.dayIdByEN[dayEN];
    if (!id) return -1;

    const element = this.querySelector(`#${id}`);
    if (!element) return -1;

    return Array.from(this.calendarHeader).indexOf(element);
  }

  clearDesktopSlots() {
    const slotCells = this.calendar.querySelectorAll("tbody td.calendar-slot-cell");
    slotCells.forEach((cell) => {
      cell.innerHTML = "";
    });
  }

  showEmptyCalendar() {
    this.allRegisteredCourses = [];
    this.mobileCoursesBySlot.clear();
    this.mobileCourseLookup.clear();
    this.desktopCourseLookup.clear();
    this.listCourseLookup.clear();
    this.renderDesktopSchedule();
    this.renderMobileSchedule();
    this.renderListSchedule();
    this.applyViewVisibility();
  }

  renderDesktopSchedule() {
    this.clearDesktopSlots();

    this.dayOrder.forEach((dayCode) => {
      this.periodDefinitions.forEach((periodDef) => {
        const slotCell = this.calendar.querySelector(`.calendar-slot-cell[data-day='${dayCode}'][data-period='${periodDef.number}']`);
        if (!slotCell) return;

        const slotCourses = this.getCoursesForSlot(dayCode, periodDef.number);
        if (slotCourses.length > 0) {
          const primaryCourse = slotCourses[0];
          const courseKey = `${dayCode}-${periodDef.number}-${primaryCourse.course_code}-primary`;
          this.desktopCourseLookup.set(courseKey, primaryCourse);

          const courseButton = document.createElement("button");
          courseButton.type = "button";
          courseButton.className = "calendar-course-card";
          courseButton.dataset.courseKey = courseKey;

          const color = this.getCalendarCourseColor(primaryCourse.type);
          courseButton.style.backgroundColor = color;

          const title = document.createElement("p");
          title.className = "calendar-course-title";
          title.textContent = this.getDetailedTitle(primaryCourse);

          const timeText = document.createElement("p");
          timeText.className = "calendar-course-time";
          timeText.textContent = periodDef.timeRange;

          const professorText = document.createElement("p");
          professorText.className = "calendar-course-professor";
          professorText.textContent = formatProfessorDisplayName(primaryCourse.professor);

          const badges = document.createElement("div");
          badges.className = "calendar-course-badge-row";

          const registeredBadge = document.createElement("span");
          registeredBadge.className = "calendar-course-badge calendar-course-registered-badge";
          registeredBadge.textContent = "Registered";

          badges.appendChild(registeredBadge);

          courseButton.appendChild(title);
          courseButton.appendChild(timeText);
          courseButton.appendChild(professorText);
          courseButton.appendChild(badges);

          if (slotCourses.length > 1) {
            const multiBadge = document.createElement("span");
            multiBadge.className = "calendar-course-count";
            multiBadge.textContent = `+${slotCourses.length - 1}`;
            courseButton.appendChild(multiBadge);
          }

          slotCell.appendChild(courseButton);
        } else {
          const isBusy = this.isSlotBusy(dayCode, periodDef.number);
          if (isBusy) {
            const busyButton = document.createElement("button");
            busyButton.type = "button";
            busyButton.className = "calendar-busy-slot-btn";
            busyButton.dataset.day = dayCode;
            busyButton.dataset.period = String(periodDef.number);
            busyButton.dataset.action = "slot-busy-state";
            busyButton.textContent = "Busy";
            busyButton.setAttribute("aria-label", `Busy slot ${dayCode} period ${periodDef.number} (${periodDef.timeRange})`);
            slotCell.appendChild(busyButton);
          } else if (this.filterState.showEmptySlots) {
            const emptyButton = document.createElement("button");
            emptyButton.type = "button";
            emptyButton.className = "calendar-empty-slot-btn";
            emptyButton.dataset.day = dayCode;
            emptyButton.dataset.period = String(periodDef.number);
            emptyButton.dataset.action = "slot-empty";
            emptyButton.textContent = "+ Add";
            emptyButton.setAttribute("aria-label", `Empty slot ${dayCode} period ${periodDef.number} (${periodDef.timeRange})`);
            slotCell.appendChild(emptyButton);
          }
        }
      });
    });
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
    this.calendar.querySelectorAll("tbody td.calendar-time-cell").forEach((cell) => cell.classList.remove("highlight-current-period"));

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

    const row = rows[rowIndex];
    const cell = row.querySelector(`td:nth-child(${colIndex + 1})`);
    if (cell) cell.classList.add("highlight-current-time");

    const timeCell = row.querySelector("td.calendar-time-cell");
    if (timeCell) timeCell.classList.add("highlight-current-period");
  }

  getCourseByLookupKey(courseKey) {
    return this.desktopCourseLookup.get(courseKey) || this.mobileCourseLookup.get(courseKey) || null;
  }

  async handleCalendarClick(event) {
    const slotActionButton = event.target.closest("[data-action='slot-find'], [data-action='slot-cancel']");
    if (slotActionButton) {
      this.handleSlotAction(slotActionButton.dataset.action);
      return;
    }

    const popoverAction = event.target.closest("[data-action='slot-busy']");
    if (popoverAction) return;

    if (event.target.closest("[data-action='slot-sheet-close']")) {
      this.closeSlotSheet();
      return;
    }

    const slotActionTrigger = event.target.closest(".calendar-empty-slot-btn, .calendar-busy-slot-btn");
    if (slotActionTrigger) {
      const day = slotActionTrigger.dataset.day;
      const period = parseInt(slotActionTrigger.dataset.period, 10);
      if (day && Number.isFinite(period)) {
        this.openSlotActionMenu({ day, period }, slotActionTrigger);
      }
      return;
    }

    const courseButton = event.target.closest(".calendar-course-card");
    if (courseButton) {
      const courseKey = courseButton.dataset.courseKey;
      const course = this.getCourseByLookupKey(courseKey);
      if (course) openCourseInfoMenu(course);
    }
  }

  ensureTooltipElement() {
    if (this.tooltipElement && document.body.contains(this.tooltipElement)) {
      return this.tooltipElement;
    }

    const tooltip = document.createElement("div");
    tooltip.className = "calendar-course-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);
    this.tooltipElement = tooltip;
    return tooltip;
  }

  canShowHover() {
    return window.matchMedia && window.matchMedia("(hover: hover)").matches && !this.isMobile;
  }

  positionTooltip(clientX, clientY) {
    const tooltip = this.tooltipElement;
    if (!tooltip) return;

    const offset = 14;
    const maxX = window.innerWidth - tooltip.offsetWidth - 8;
    const maxY = window.innerHeight - tooltip.offsetHeight - 8;
    const left = Math.max(8, Math.min(clientX + offset, maxX));
    const top = Math.max(8, Math.min(clientY + offset, maxY));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  showTooltipForCourse(course, event) {
    if (!course || !this.canShowHover()) return;

    const tooltip = this.ensureTooltipElement();
    if (!tooltip) return;

    const schedule = this.parseCourseSchedule(course);
    const slotLabel = schedule ? this.getSlotSubtitle(schedule.dayEN, schedule.period) : String(course.time_slot || "");
    const credits = course.credits ? `${course.credits} credits` : "Credits TBA";
    const professorName = formatProfessorDisplayName(course.professor);
    const professor = `Professor ${professorName}`;

    tooltip.innerHTML = `
      <div class="calendar-course-tooltip-title">${this.escapeHtml(this.getDetailedTitle(course))}</div>
      <div class="calendar-course-tooltip-subtitle">${this.escapeHtml(slotLabel)}</div>
      <div class="calendar-course-tooltip-detail">${this.escapeHtml(professor)} • ${this.escapeHtml(credits)}</div>
    `;

    tooltip.classList.add("is-visible");
    this.positionTooltip(event.clientX, event.clientY);
  }

  hideTooltip() {
    if (!this.tooltipElement) return;
    this.tooltipElement.classList.remove("is-visible");
  }

  handleCalendarPointerOver(event) {
    if (!this.canShowHover()) {
      this.activeTooltipCourseKey = null;
      this.hideTooltip();
      return;
    }

    const card = event.target.closest(".calendar-course-card");
    if (!card || !this.calendar.contains(card)) {
      this.activeTooltipCourseKey = null;
      this.hideTooltip();
      return;
    }

    const courseKey = card.dataset.courseKey;
    const course = this.getCourseByLookupKey(courseKey);
    if (!course) {
      this.activeTooltipCourseKey = null;
      this.hideTooltip();
      return;
    }

    this.activeTooltipCourseKey = courseKey;
    this.showTooltipForCourse(course, event);
  }

  handleCalendarPointerMove(event) {
    if (!this.canShowHover() || !this.activeTooltipCourseKey) {
      this.activeTooltipCourseKey = null;
      this.hideTooltip();
      return;
    }

    const card = event.target.closest(".calendar-course-card");
    const hoveredCourseKey = card?.dataset?.courseKey;
    if (!card || !this.calendar.contains(card) || hoveredCourseKey !== this.activeTooltipCourseKey) {
      this.activeTooltipCourseKey = null;
      this.hideTooltip();
      return;
    }

    this.positionTooltip(event.clientX, event.clientY);
  }

  handleCalendarPointerLeave() {
    this.activeTooltipCourseKey = null;
    this.hideTooltip();
  }

  escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async forceRefresh() {
    this.currentUser = null;
    this.isInitialized = false;
    this.retryCount = 0;

    this.showEmptyCalendar();
    await this.initializeCalendar();
  }

  async refreshCalendar() {
    this.currentUser = null;

    if (!this.isInitialized) {
      return this.initializeCalendar();
    }

    const { year, term } = this.getCurrentYearTerm();
    await this.showCourseWithRetry(year, term);
    this.updateMobileUI(false);
  }

  async showTerm(year, term) {
    this.currentUser = null;
    await this.showCourseWithRetry(year, term);
    this.updateMobileUI(false);
  }
}

customElements.define("calendar-page", CalendarPageComponent);

export { CalendarPageComponent };
