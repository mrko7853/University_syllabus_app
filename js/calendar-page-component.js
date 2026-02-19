import { fetchCourseData, openCourseInfoMenu, getCourseColorByType, openCourseSearchForSlot } from "./shared.js";
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
      typeGroups: new Set(),
      showRegistered: true,
      showSaved: false,
      showEmptySlots: true
    };

    this.allRegisteredCourses = [];
    this.mobileCoursesBySlot = new Map();
    this.mobileCourseLookup = new Map();
    this.desktopCourseLookup = new Map();
    this.expandedMobilePeriodByDay = {};
    this.selectedMobileDayIndex = this.getDefaultMobileDayIndex();

    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchInProgress = false;

    this.activeFocusTrapCleanup = null;
    this.activeSlot = null;
    this.activeSlotTrigger = null;
    this.activeFilterTrigger = null;
    this.toolbarCleanupFns = [];

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
                        <p class="time-full"><small>${periodDef.label}</small><br>${periodDef.timeRange}</p>
                        <p class="time-short">${periodDef.number}h</p>
                      </td>
                      ${this.dayOrder.map((dayCode) => `<td class="calendar-slot-cell" data-day="${dayCode}" data-period="${periodDef.number}"></td>`).join("")}
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>

          <div class="calendar-mobile-view" style="display: none;" aria-label="Mobile schedule">
            <div class="calendar-mobile-day-tabs" role="tablist" aria-label="Weekday selector"></div>
            <div class="calendar-mobile-viewport">
              <div class="calendar-mobile-track"></div>
            </div>
          </div>

          <div class="calendar-slot-popover hidden" id="calendar-slot-popover" role="dialog" aria-modal="false" aria-labelledby="calendar-slot-popover-title">
            <p class="calendar-slot-popover-title" id="calendar-slot-popover-title">Empty slot</p>
            <p class="calendar-slot-popover-subtitle" id="calendar-slot-popover-subtitle"></p>
            <button type="button" class="calendar-slot-action-btn calendar-slot-action-btn-primary" data-action="slot-find">Find courses for this slot</button>
            <button type="button" class="calendar-slot-action-btn" data-action="slot-busy" disabled>Mark as busy (soon)</button>
            <button type="button" class="calendar-slot-action-btn" data-action="slot-assignment" disabled>Add assignment (soon)</button>
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
                <button type="button" class="calendar-slot-action-btn calendar-slot-action-btn-primary" data-action="slot-find">Find courses for this slot</button>
                <button type="button" class="calendar-slot-action-btn" data-action="slot-busy" disabled>Mark as busy (soon)</button>
                <button type="button" class="calendar-slot-action-btn" data-action="slot-assignment" disabled>Add assignment (soon)</button>
                <button type="button" class="calendar-slot-action-btn" data-action="slot-cancel">Cancel</button>
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
    this.mobileDayTabs = this.querySelector(".calendar-mobile-day-tabs");
    this.mobileTrack = this.querySelector(".calendar-mobile-track");

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
    this.boundTouchStartHandler = this.handleTouchStart.bind(this);
    this.boundTouchMoveHandler = this.handleTouchMove.bind(this);
    this.boundTouchEndHandler = this.handleTouchEnd.bind(this);
    this.boundPageLoadedHandler = this.handlePageLoaded.bind(this);
    this.boundDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.boundRootActionClick = this.handleRootActionClick.bind(this);

    this.buildMobileViewSkeleton();
    this.checkMobile();
  }

  connectedCallback() {
    this.calendar.addEventListener("click", this.boundCalendarClickHandler);
    this.calendar.addEventListener("mouseover", this.boundCalendarPointerOver);
    this.calendar.addEventListener("mousemove", this.boundCalendarPointerMove);
    this.calendar.addEventListener("mouseleave", this.boundCalendarPointerLeave);

    this.mobileView.addEventListener("click", this.boundMobileClickHandler);
    this.mobileView.addEventListener("touchstart", this.boundTouchStartHandler, { passive: true });
    this.mobileView.addEventListener("touchmove", this.boundTouchMoveHandler, { passive: true });
    this.mobileView.addEventListener("touchend", this.boundTouchEndHandler, { passive: true });
    this.addEventListener("click", this.boundRootActionClick);

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

    this.mobileView.removeEventListener("click", this.boundMobileClickHandler);
    this.mobileView.removeEventListener("touchstart", this.boundTouchStartHandler);
    this.mobileView.removeEventListener("touchmove", this.boundTouchMoveHandler);
    this.mobileView.removeEventListener("touchend", this.boundTouchEndHandler);
    this.removeEventListener("click", this.boundRootActionClick);

    window.removeEventListener("resize", this.boundResizeHandler);
    document.removeEventListener("pageLoaded", this.boundPageLoadedHandler);
    document.removeEventListener("pointerdown", this.boundDocumentPointerDown);

    this.cleanupToolbarControls();
    this.closeFilterPopover(false);
    this.closeSlotActionMenus(false);
    this.hideTooltip();
    this.clearFocusTrap();
  }

  handlePageLoaded() {
    this.setupToolbarControls();
    this.checkMobile();
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

    const filterTriggerDesktop = document.getElementById("calendar-filter-trigger");
    const filterTriggerMobile = document.getElementById("calendar-filter-trigger-mobile");
    const filterPopover = document.getElementById("calendar-filter-popover");
    const filterClose = document.getElementById("calendar-filter-close");

    const weekButton = document.getElementById("calendar-view-week");
    const dayButton = document.getElementById("calendar-view-day");
    const listButton = document.getElementById("calendar-view-list");

    const typeCore = document.getElementById("calendar-type-core");
    const typeFoundation = document.getElementById("calendar-type-foundation");
    const typeElective = document.getElementById("calendar-type-elective");
    const showRegistered = document.getElementById("calendar-show-registered");
    const showSaved = document.getElementById("calendar-show-saved");
    const showEmpty = document.getElementById("calendar-show-empty");

    this.filterPopoverElement = filterPopover || null;
    this.filterTriggerDesktop = filterTriggerDesktop || null;
    this.filterTriggerMobile = filterTriggerMobile || null;

    if (weekButton) {
      const onClick = () => {
        weekButton.classList.add("is-active");
        weekButton.setAttribute("aria-selected", "true");
      };
      weekButton.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => weekButton.removeEventListener("click", onClick));
    }

    if (dayButton) {
      const onClick = (event) => {
        event.preventDefault();
      };
      dayButton.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => dayButton.removeEventListener("click", onClick));
    }

    if (listButton) {
      const onClick = (event) => {
        event.preventDefault();
      };
      listButton.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => listButton.removeEventListener("click", onClick));
    }

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

    if (filterClose) {
      const onClick = (event) => {
        event.preventDefault();
        this.closeFilterPopover();
      };
      filterClose.addEventListener("click", onClick);
      this.toolbarCleanupFns.push(() => filterClose.removeEventListener("click", onClick));
    }

    const onFilterChange = () => {
      this.syncFilterStateFromControls();
      this.applyActiveFiltersAndRender();
    };

    [typeCore, typeFoundation, typeElective, showRegistered, showSaved, showEmpty].forEach((checkbox) => {
      if (!checkbox) return;
      checkbox.addEventListener("change", onFilterChange);
      this.toolbarCleanupFns.push(() => checkbox.removeEventListener("change", onFilterChange));
    });

    this.syncFilterStateFromControls();
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
  }

  syncFilterStateFromControls() {
    const core = document.getElementById("calendar-type-core")?.checked;
    const foundation = document.getElementById("calendar-type-foundation")?.checked;
    const elective = document.getElementById("calendar-type-elective")?.checked;

    const selected = new Set();
    if (core) selected.add("Core");
    if (foundation) selected.add("Foundation");
    if (elective) selected.add("Elective");

    this.filterState.typeGroups = selected;
    this.filterState.showRegistered = document.getElementById("calendar-show-registered")?.checked !== false;
    this.filterState.showSaved = document.getElementById("calendar-show-saved")?.checked === true;
    this.filterState.showEmptySlots = document.getElementById("calendar-show-empty")?.checked !== false;
  }

  openFilterPopover(triggerElement) {
    if (!this.filterPopoverElement) return;

    if (!this.filterPopoverElement.classList.contains("hidden")) {
      this.closeFilterPopover();
      return;
    }

    this.closeSlotActionMenus();

    this.filterPopoverElement.classList.remove("hidden");
    this.filterPopoverElement.classList.toggle("is-mobile-open", this.isMobile);

    if (!this.isMobile) {
      const rect = triggerElement.getBoundingClientRect();
      this.filterPopoverElement.style.top = `${Math.round(rect.bottom + 8)}px`;
      this.filterPopoverElement.style.left = `${Math.round(rect.right - this.filterPopoverElement.offsetWidth)}px`;
    } else {
      this.filterPopoverElement.style.top = "";
      this.filterPopoverElement.style.left = "";
    }

    this.activeFilterTrigger = triggerElement;
    if (this.filterTriggerDesktop) this.filterTriggerDesktop.setAttribute("aria-expanded", "true");
    if (this.filterTriggerMobile) this.filterTriggerMobile.setAttribute("aria-expanded", "true");

    this.applyFocusTrap(this.filterPopoverElement, () => this.closeFilterPopover());

    const focusTarget = this.filterPopoverElement.querySelector("input, button");
    if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
  }

  closeFilterPopover(restoreFocus = true) {
    if (!this.filterPopoverElement) return;

    this.filterPopoverElement.classList.add("hidden");
    this.filterPopoverElement.classList.remove("is-mobile-open");
    this.filterPopoverElement.style.top = "";
    this.filterPopoverElement.style.left = "";

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

    if (action === "slot-find" || action === "slot-cancel") {
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
        if (this.mobileTrack) this.mobileTrack.classList.remove("without-animation");
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
      if (course) openCourseInfoMenu(course);
      return;
    }

    const actionButton = event.target.closest("[data-action='mobile-slot-find']");
    if (actionButton) {
      const dayCode = actionButton.dataset.dayCode;
      const periodNumber = parseInt(actionButton.dataset.periodNumber, 10);
      if (dayCode && Number.isFinite(periodNumber)) {
        this.openSlotActionMenu({ day: dayCode, period: periodNumber }, actionButton);
      }
      return;
    }

    const dayButton = event.target.closest("[data-action='select-day']");
    if (dayButton) {
      const dayIndex = parseInt(dayButton.dataset.dayIndex, 10);
      if (Number.isFinite(dayIndex)) this.selectMobileDayByIndex(dayIndex, true);
      return;
    }

    const toggleButton = event.target.closest("[data-action='toggle-period']");
    if (toggleButton) {
      const dayCode = toggleButton.dataset.dayCode;
      const periodNumber = parseInt(toggleButton.dataset.periodNumber, 10);
      const hasCoursesState = toggleButton.dataset.hasCourses;
      const hasCourses = hasCoursesState === "true";

      if (!dayCode || !Number.isFinite(periodNumber)) return;
      if (hasCoursesState === "hidden") return;

      if (!hasCourses) {
        this.openSlotActionMenu({ day: dayCode, period: periodNumber }, toggleButton);
        return;
      }

      this.toggleMobilePeriod(dayCode, periodNumber);
    }
  }

  selectMobileDayByIndex(dayIndex, animate = true) {
    const boundedIndex = Math.max(0, Math.min(this.dayOrder.length - 1, dayIndex));
    if (boundedIndex === this.selectedMobileDayIndex && animate) return;

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

  getPeriodDefinition(periodNumber) {
    return this.periodDefinitions.find((periodDef) => periodDef.number === Number(periodNumber)) || null;
  }

  getSlotSubtitle(day, period) {
    const periodDef = this.getPeriodDefinition(period);
    if (!periodDef) return `${day} period ${period}`;
    return `${day} period ${period} (${periodDef.timeRange})`;
  }

  getActiveTypeFilters() {
    return Array.from(this.filterState.typeGroups);
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

  handleSlotAction(action) {
    if (!this.activeSlot || !action) return;

    if (action === "slot-cancel") {
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
        const toggleButton = periodRow.querySelector(".calendar-mobile-period-toggle");

        if (!compactContainer || !panelContainer || !toggleButton) return;

        compactContainer.innerHTML = "";
        panelContainer.innerHTML = "";

        const courses = this.getCoursesForSlot(dayCode, periodDef.number);

        if (courses.length > 0) {
          toggleButton.dataset.hasCourses = "true";

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
          toggleButton.dataset.hasCourses = this.filterState.showEmptySlots ? "false" : "hidden";
          const emptyChip = document.createElement("div");
          emptyChip.className = "calendar-mobile-empty-chip";
          emptyChip.textContent = this.filterState.showEmptySlots ? "Empty" : "Hidden";
          compactContainer.appendChild(emptyChip);

          if (this.filterState.showEmptySlots) {
            const actionBtn = document.createElement("button");
            actionBtn.type = "button";
            actionBtn.className = "calendar-mobile-empty-action";
            actionBtn.dataset.action = "mobile-slot-find";
            actionBtn.dataset.dayCode = dayCode;
            actionBtn.dataset.periodNumber = String(periodDef.number);
            actionBtn.textContent = "Find courses for this slot";
            panelContainer.appendChild(actionBtn);
          } else {
            const emptyState = document.createElement("div");
            emptyState.className = "calendar-mobile-empty";
            emptyState.textContent = "No class scheduled";
            panelContainer.appendChild(emptyState);
          }
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

    if (raw === "Academic and Research Skills" || raw === "Understanding Japan and Kyoto") return "Foundation";
    if (raw === "Other Elective Courses") return "Elective";

    if (
      raw === "Introductory Seminars"
      || raw === "Intermediate Seminars"
      || raw === "Advanced Seminars and Honors Thesis"
      || raw === "Japanese Society and Global Culture Concentration"
      || raw === "Japanese Business and the Global Economy Concentration"
      || raw === "Japanese Politics and Global Studies Concentration"
    ) {
      return "Core";
    }

    return null;
  }

  passesTypeFilters(course) {
    if (!this.filterState.typeGroups || this.filterState.typeGroups.size === 0) return true;

    const group = this.getTypeGroupForCourse(course?.type);
    return group ? this.filterState.typeGroups.has(group) : false;
  }

  applyActiveFiltersAndRender() {
    let visibleCourses = Array.isArray(this.allRegisteredCourses) ? [...this.allRegisteredCourses] : [];

    if (!this.filterState.showRegistered) {
      visibleCourses = [];
    }

    visibleCourses = visibleCourses.filter((course) => this.passesTypeFilters(course));

    this.mobileCoursesBySlot.clear();
    this.desktopCourseLookup.clear();

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

    this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
    this.highlightCurrentTimePeriod();

    document.dispatchEvent(new CustomEvent("calendarPageRefreshed"));
  }

  async showCourse(year, term) {
    this.displayedYear = parseInt(year, 10);
    this.displayedTerm = this.normalizeTermValue(term);

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
    this.renderDesktopSchedule();
    this.renderMobileSchedule();
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

          const color = getCourseColorByType(primaryCourse.type);
          courseButton.style.backgroundColor = color;

          const title = document.createElement("p");
          title.className = "calendar-course-title";
          title.textContent = this.getDetailedTitle(primaryCourse);

          const subtitle = document.createElement("p");
          subtitle.className = "calendar-course-subtitle";
          subtitle.textContent = primaryCourse.location || this.getTypeGroupForCourse(primaryCourse.type) || "Scheduled";

          const badge = document.createElement("span");
          badge.className = "calendar-course-badge";
          badge.textContent = "Registered";

          courseButton.appendChild(title);
          courseButton.appendChild(subtitle);
          courseButton.appendChild(badge);

          if (slotCourses.length > 1) {
            const multiBadge = document.createElement("span");
            multiBadge.className = "calendar-course-count";
            multiBadge.textContent = `+${slotCourses.length - 1}`;
            courseButton.appendChild(multiBadge);
          }

          slotCell.appendChild(courseButton);
        } else if (this.filterState.showEmptySlots) {
          const emptyButton = document.createElement("button");
          emptyButton.type = "button";
          emptyButton.className = "calendar-empty-slot-btn";
          emptyButton.dataset.day = dayCode;
          emptyButton.dataset.period = String(periodDef.number);
          emptyButton.dataset.action = "slot-empty";
          emptyButton.textContent = "Empty";
          emptyButton.setAttribute("aria-label", `Empty slot ${dayCode} period ${periodDef.number} (${periodDef.timeRange})`);
          slotCell.appendChild(emptyButton);
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

  getCourseByLookupKey(courseKey) {
    return this.desktopCourseLookup.get(courseKey) || this.mobileCourseLookup.get(courseKey) || null;
  }

  async handleCalendarClick(event) {
    const slotActionButton = event.target.closest("[data-action='slot-find'], [data-action='slot-cancel']");
    if (slotActionButton) {
      this.handleSlotAction(slotActionButton.dataset.action);
      return;
    }

    const popoverAction = event.target.closest("[data-action='slot-busy'], [data-action='slot-assignment']");
    if (popoverAction) return;

    if (event.target.closest("[data-action='slot-sheet-close']")) {
      this.closeSlotSheet();
      return;
    }

    const emptyButton = event.target.closest(".calendar-empty-slot-btn");
    if (emptyButton) {
      const day = emptyButton.dataset.day;
      const period = parseInt(emptyButton.dataset.period, 10);
      if (day && Number.isFinite(period)) {
        this.openSlotActionMenu({ day, period }, emptyButton);
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
    const professor = course.professor || "Professor TBA";

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
    if (!this.canShowHover()) return;

    const card = event.target.closest(".calendar-course-card");
    if (!card || !this.calendar.contains(card)) return;

    const courseKey = card.dataset.courseKey;
    const course = this.getCourseByLookupKey(courseKey);
    if (!course) return;

    this.activeTooltipCourseKey = courseKey;
    this.showTooltipForCourse(course, event);
  }

  handleCalendarPointerMove(event) {
    if (!this.canShowHover() || !this.activeTooltipCourseKey) return;
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
