// Calendar Page Component - Dedicated component for calendar page with mobile support
import { fetchCourseData, openCourseInfoMenu, getCourseColorByType } from "/js/shared.js";
import { supabase } from "/supabase.js";

class CalendarPageComponent extends HTMLElement {
  constructor() {
    super();
    this.isInitialized = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.isMobile = false;

    this.innerHTML = `
      <div class="calendar-page-wrapper">
        <div class="mobile-day-buttons" style="display: none;">
          <!-- Mobile day buttons will be generated here -->
        </div>
        <div class="calendar-container-main">
          <div class="calendar-wrapper">
            <div class="loading-indicator" id="loading-indicator" style="display: none;"></div>
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
        </div>
      </div>
    `;

    this.calendar = this.querySelector("#calendar-main");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.querySelector("#loading-indicator");
    this.mobileButtonsContainer = this.querySelector(".mobile-day-buttons");

    this.displayedYear = null;
    this.displayedTerm = null;

    this.dayIdByEN = {
      Mon: 'calendar-monday',
      Tue: 'calendar-tuesday',
      Wed: 'calendar-wednesday',
      Thu: 'calendar-thursday',
      Fri: 'calendar-friday'
    };

    // Setup click handler
    this.calendar.addEventListener("click", this.handleCalendarClick.bind(this));
    
    // Setup mobile detection
    this.checkMobile();
    window.addEventListener('resize', () => this.checkMobile());
  }

  connectedCallback() {
    console.log('Calendar page component connected');
    
    // Initialize once when connected
    this.initializeCalendar();

    this.setupSearchButtons();
    
    // Listen for pageLoaded event but don't force refresh (router handles it)
    document.addEventListener('pageLoaded', () => {
      console.log('PageLoaded event received - calendar should already be initialized');
    });
  }

  disconnectedCallback() {
    window.removeEventListener('resize', () => this.checkMobile());
  }

  setupSearchButtons() {
    if (this.searchButtonsInitialized) return;
    this.searchButtonsInitialized = true;

    const searchButtons = document.querySelectorAll('.search-btn');
    const searchContainer = document.querySelector('.search-container');
    const searchModal = document.querySelector('.search-modal');
    const searchBackground = document.querySelector('.search-background');
    const searchCancel = document.getElementById('search-cancel');

    if (!searchContainer || !searchModal || searchButtons.length === 0) return;

    const closeSearchAnimated = (immediate = false) => {
      if (window.innerWidth <= 780) {
        searchModal.classList.remove('show');

        if (immediate) {
          searchContainer.classList.add('hidden');
          document.body.classList.remove('modal-open');
          return;
        }

        setTimeout(() => {
          searchContainer.classList.add('hidden');
          document.body.classList.remove('modal-open');
        }, 400);
        return;
      }

      searchContainer.classList.add('hidden');
    };

    const openSearch = () => {
      searchContainer.classList.remove('hidden');

      if (window.innerWidth <= 780) {
        searchModal.classList.add('show');
        document.body.classList.add('modal-open');

        if (!this.searchSwipeBound && typeof window.addSwipeToCloseSimple === 'function' && searchBackground) {
          this.searchSwipeBound = true;
          window.addSwipeToCloseSimple(searchModal, searchBackground, () => {
            closeSearchAnimated(true);
          });
        }
      } else {
        searchModal.classList.add('show');
      }

      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 100);
      }
    };

    const closeSearch = () => {
      closeSearchAnimated();
    };

    searchButtons.forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
      });
    });

    if (searchCancel) {
      searchCancel.addEventListener('click', (event) => {
        event.preventDefault();
        closeSearch();
      });
    }

    if (searchBackground) {
      searchBackground.addEventListener('click', (event) => {
        if (event.target === searchBackground) {
          closeSearch();
        }
      });
    }
  }

  checkMobile() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth <= 780;
    window.isMobile = this.isMobile;
    
    if (this.isMobile !== wasMobile) {
      // Mobile state changed, update UI
      this.updateMobileUI();
    }
  }

  updateMobileUI() {
    if (this.isMobile) {
      this.mobileButtonsContainer.style.display = 'flex';
      this.generateMobileButtons();
      // Show current day by default
      setTimeout(() => {
        const today = this.getCurrentDay();
        this.showDay(today);
      }, 100);
    } else {
      this.mobileButtonsContainer.style.display = 'none';
      this.showAllDays();
    }
  }

  generateMobileButtons() {
    if (!this.isMobile) return;
    
    this.mobileButtonsContainer.innerHTML = "";

    // Map headers to full day names and button text (T for both Tue/Thu)
    const dayMapping = [
      { header: '', fullName: '', buttonText: '' }, // First column (empty)
      { header: 'M', fullName: 'Monday', buttonText: 'M' },
      { header: 'Tu', fullName: 'Tuesday', buttonText: 'T' },
      { header: 'W', fullName: 'Wednesday', buttonText: 'W' },
      { header: 'Th', fullName: 'Thursday', buttonText: 'T' },
      { header: 'F', fullName: 'Friday', buttonText: 'F' }
    ];
    
    this.calendarHeader.forEach((header, index) => {
      if (index === 0) return; // Skip first column
      
      const mapping = dayMapping[index];
      if (!mapping) return;
      
      const button = document.createElement("div");
      button.className = "day-button";
      button.textContent = mapping.buttonText;
      button.dataset.day = mapping.fullName;
      button.dataset.headerIndex = index;
      this.mobileButtonsContainer.appendChild(button);

      button.addEventListener("click", () => this.showDay(mapping.fullName, index));
    });
  }

  getCurrentDay() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // If it's Saturday (6) or Sunday (0), default to Monday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 'Monday';
    }
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[dayOfWeek];
  }

  showDay(day, columnIndex = null) {
    if (!this.isMobile) return;

    let columnIndexToShow = columnIndex;

    // If no column index provided, find it by day name
    if (columnIndexToShow === null) {
      const dayToColumn = {
        'Monday': 1,
        'Tuesday': 2, 
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5
      };
      columnIndexToShow = dayToColumn[day];
    }

    if (!columnIndexToShow) return;

    // Hide all columns except first (time) and selected day
    this.calendar.querySelectorAll("tr").forEach(row => {
      Array.from(row.cells).forEach((cell, cellIndex) => {
        if (cellIndex === 0 || cellIndex === columnIndexToShow) {
          cell.style.display = "table-cell";
        } else {
          cell.style.display = "none";
        }
      });
    });

    // Update button states
    const dayButtons = this.querySelectorAll(".day-button");
    dayButtons.forEach(btn => {
      btn.classList.remove("active");
      if (btn.dataset.day === day) {
        btn.classList.add("active");
      }
    });
  }

  showAllDays() {
    // Show all columns (for desktop)
    this.calendar.querySelectorAll("tr").forEach(row => {
      Array.from(row.cells).forEach(cell => {
        cell.style.display = "table-cell";
      });
    });
  }

  async initializeCalendar() {
    try {
      this.showLoading();
      console.log('Calendar page: Starting initialization...');
      
      // FORCE fresh session data - clear any cached session
      this.currentUser = null;
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;
      console.log('Calendar page: User session:', this.currentUser ? 'Found' : 'Not found');

      // Initial highlight
      this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
      this.highlightPeriod();
      this.highlightCurrentTimePeriod();

      // Set current term - wait for semester selector or use defaults
      let currentYear, currentTerm;
      
      // Try to get from selectors (might not be ready yet)
      const yearSelect = document.getElementById('year-select');
      const termSelect = document.getElementById('term-select');
      
      if (yearSelect && yearSelect.value && !isNaN(parseInt(yearSelect.value))) {
        currentYear = parseInt(yearSelect.value);
      } else {
        // Default to 2025 (latest available semester)
        currentYear = 2025;
      }
      
      if (termSelect && termSelect.value) {
        currentTerm = termSelect.value;
      } else {
        // Default to Fall (latest available semester)
        currentTerm = "Fall";
      }
      
      console.log(`Calendar page: Loading courses for ${currentYear} ${currentTerm}`);

      // FORCE load courses with retry mechanism
      await this.showCourseWithRetry(currentYear, currentTerm);
      this.isInitialized = true;
      this.hideLoading();
      
      console.log('Calendar page: Initialization completed successfully');
      
      // Update mobile UI after initialization
      this.updateMobileUI();
    } catch (error) {
      console.error('Error initializing calendar page:', error);
      this.hideLoading();
      // Retry initialization after a short delay
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        setTimeout(() => this.initializeCalendar(), 1000 * this.retryCount);
      }
    }
  }

  showLoading() {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'block';
    }
  }

  hideLoading() {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'none';
    }
  }

  async showCourseWithRetry(year, term, retryAttempt = 0) {
    try {
      await this.showCourse(year, term);
      this.retryCount = 0; // Reset retry count on success
    } catch (error) {
      console.error(`Error showing courses (attempt ${retryAttempt + 1}):`, error);
      
      if (retryAttempt < this.maxRetries) {
        console.log(`Retrying calendar load (attempt ${retryAttempt + 1}/${this.maxRetries})`);
        setTimeout(() => this.showCourseWithRetry(year, term, retryAttempt + 1), 1000 * (retryAttempt + 1));
      } else {
        console.error('Max retries reached for calendar page');
        this.showEmptyCalendar();
      }
    }
  }

  getColIndexByDayEN(dayEN) {
    const id = this.dayIdByEN[dayEN];
    if (!id) return -1;
    const el = this.querySelector(`#${id}`);
    if (!el) return -1;
    return Array.from(this.calendarHeader).indexOf(el);
  }

  clearCourseCells() {
    // Remove all course cells
    this.calendar.querySelectorAll('tbody td .course-cell, tbody td .course-cell-main').forEach(el => el.remove());
  }

  showEmptyCalendar() {
    this.clearCourseCells();
    // Don't add empty placeholders for calendar page - keep it clean
  }

  highlightDay(dayShort) {
    // Remove previous highlights
    this.calendar.querySelectorAll('thead th, tbody td').forEach(el => {
      el.classList.remove('highlight-day', 'highlight-current-day');
    });
    
    const colIndex = this.getColIndexByDayEN(dayShort);
    if (colIndex === -1) return;
    
    // Highlight the header
    const header = this.calendarHeader[colIndex];
    if (header) header.classList.add('highlight-day');
    
    // Highlight entire column for current day
    this.calendar.querySelectorAll(`tbody tr`).forEach(row => {
      const cell = row.querySelector(`td:nth-child(${colIndex + 1})`);
      if (cell) cell.classList.add('highlight-current-day');
    });
  }

  highlightPeriod() {
    if (this.calendarHeader[0]) this.calendarHeader[0].classList.add("calendar-first");
    this.calendar.querySelectorAll("tbody tr").forEach(row => {
      const cell = row.querySelector("td:nth-child(1)");
      if (cell) cell.classList.add("calendar-first");
    });
  }

  highlightCurrentTimePeriod() {
    // Get current time
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute; // minutes since midnight
    const currentDay = now.toLocaleDateString("en-US", { weekday: "short" });
    
    // Time periods in minutes
    const periods = [
      { start: 9 * 60, end: 10 * 60 + 30, row: 0 },      // 09:00-10:30 (period 1)
      { start: 10 * 60 + 45, end: 12 * 60 + 15, row: 1 }, // 10:45-12:15 (period 2)
      { start: 13 * 60 + 10, end: 14 * 60 + 40, row: 2 }, // 13:10-14:40 (period 3)
      { start: 14 * 60 + 55, end: 16 * 60 + 25, row: 3 }, // 14:55-16:25 (period 4)
      { start: 16 * 60 + 40, end: 18 * 60 + 10, row: 4 }  // 16:40-18:10 (period 5)
    ];
    
    // Find current period
    const currentPeriod = periods.find(p => currentTime >= p.start && currentTime <= p.end);
    if (!currentPeriod) return; // Not during class time
    
    // Get column index for current day
    const colIndex = this.getColIndexByDayEN(currentDay);
    if (colIndex === -1) return;
    
    // Highlight the cell
    const rows = this.calendar.querySelectorAll('tbody tr');
    if (rows[currentPeriod.row]) {
      const cell = rows[currentPeriod.row].querySelector(`td:nth-child(${colIndex + 1})`);
      if (cell) cell.classList.add('highlight-current-time');
    }
  }

  async showCourse(year, term) {
    this.displayedYear = year;
    this.displayedTerm = term;
    
    console.log(`Calendar page: showCourse called for ${year} ${term}`);

    try {
      // FORCE fresh user session
      this.currentUser = null;
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;
      console.log('Calendar page: Current user:', this.currentUser ? this.currentUser.id : 'None');

      let selectedCourses = [];
      if (this.currentUser) {
        console.log('Calendar page: Fetching user profile and course selection...');
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('courses_selection')
          .eq('id', this.currentUser.id)
          .single();
        if (profileError) throw profileError;
        selectedCourses = profile?.courses_selection || [];
        console.log('Calendar page: Total courses in profile:', selectedCourses.length);
        
        // Filter to only show courses for the current year and term
        selectedCourses = selectedCourses.filter(course => {
          return course.year === parseInt(year) && (!course.term || course.term === term);
        });
        console.log(`Calendar page: Filtered courses for ${year} ${term}:`, selectedCourses.length);
      }

      this.clearCourseCells();

      // If no user or no selected courses, show empty calendar
      if (!this.currentUser || !selectedCourses.length) {
        console.log('Calendar page: No user or no selected courses - showing empty calendar');
        this.showEmptyCalendar();
        return;
      }

      console.log('Calendar page: Fetching all courses data...');
      const allCoursesInSemester = await fetchCourseData(year, term);
      console.log('Calendar page: All courses fetched:', allCoursesInSemester.length);

      const coursesToShow = allCoursesInSemester.filter(course =>
        selectedCourses.some((profileCourse) =>
          profileCourse.code === course.course_code
        )
      );
      
      console.log('Calendar page: Courses to show on calendar:', coursesToShow.length);

      coursesToShow.forEach((course, index) => {
        console.log(`Calendar page: Rendering course ${index + 1}/${coursesToShow.length}: ${course.course_code}`);
        // Parse time slot - try Japanese format first
        let match = course.time_slot?.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
        let dayEN, period;
        
        if (match) {
          const dayJP = match[1];
          period = parseInt(match[2], 10);
          const dayMap = { "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat", "日": "Sun" };
          dayEN = dayMap[dayJP];
        } else {
          // Try English format
          const englishMatch = course.time_slot?.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
          if (englishMatch) {
            dayEN = englishMatch[1];
            const startHour = parseInt(englishMatch[2], 10);
            const startMin = parseInt(englishMatch[3], 10);
            
            // Map time to period
            const timeToSlot = startHour * 100 + startMin;
            if (timeToSlot >= 900 && timeToSlot < 1030) period = 1;
            else if (timeToSlot >= 1045 && timeToSlot < 1215) period = 2;
            else if (timeToSlot >= 1310 && timeToSlot < 1440) period = 3;
            else if (timeToSlot >= 1455 && timeToSlot < 1625) period = 4;
            else if (timeToSlot >= 1640 && timeToSlot < 1810) period = 5;
            else period = -1;
          }
        }

        if (!dayEN || !this.dayIdByEN[dayEN] || !period || period < 1) {
          return;
        }

        const colIndex = this.getColIndexByDayEN(dayEN);
        if (colIndex === -1) return;

        const rowIndex = Number.isFinite(period) ? (period - 1) : -1;
        if (rowIndex < 0 || rowIndex >= 5) return;

        const cell = this.calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
        if (!cell) return;

        // Create detailed course cell for calendar page
        const div = document.createElement("div");
        const div_title = document.createElement("div");
        const div_classroom = document.createElement("div");
        
        div.classList.add("course-cell");
        div_title.classList.add("course-title");
        div_classroom.classList.add("course-classroom");
        
        // Set content - normalize and truncate title for calendar cell
        const displayTitle = course.title ? 
          course.title.normalize("NFKC").substring(0, 40) + (course.title.length > 40 ? '...' : '') : 
          course.course_code;
        div_title.textContent = displayTitle;
        div_classroom.textContent = course.location || "";
        
        if (div_classroom.textContent === "") {
          div_classroom.classList.add("empty-classroom");
          div_title.classList.add("empty-classroom-title");
        }
        
        // Set background color based on course type from database
        const courseColor = getCourseColorByType(course.type);
        div.style.backgroundColor = courseColor;
        div.dataset.courseIdentifier = course.course_code;
        div.dataset.courseType = course.type || 'unknown';
        
        cell.appendChild(div);
        div.appendChild(div_title);
        div.appendChild(div_classroom);
      });

      console.log('Calendar page: Course rendering completed successfully');
      console.log('Calendar page: Total course cells rendered:', this.calendar.querySelectorAll('.course-cell').length);

      // Dispatch refresh event for any listeners
      document.dispatchEvent(new CustomEvent('calendarPageRefreshed'));

    } catch (error) {
      console.error('Error showing courses in calendar page:', error);
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
      const clickedCourse = courses.find(c => c.course_code === courseCode);
      if (clickedCourse) {
        openCourseInfoMenu(clickedCourse);
      }
    } catch (error) {
      console.error('Error handling calendar click:', error);
    }
  }

  // Force refresh method - aggressively reloads everything
  async forceRefresh() {
    console.log('FORCE REFRESH: Aggressively reloading calendar page');
    
    // Reset all state
    this.currentUser = null;
    this.isInitialized = false;
    this.retryCount = 0;
    
    // Clear any existing content
    this.clearCourseCells();
    
    // Force fresh initialization
    await this.initializeCalendar();
    
    console.log('FORCE REFRESH: Calendar page refresh completed');
  }

  // Public method to refresh calendar data
  async refreshCalendar() {
    console.log('Refreshing calendar page...');
    this.currentUser = null; // Force fresh session fetch
    
    if (!this.isInitialized) {
      return this.initializeCalendar();
    }
    
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
      const currentMonth = new Date().getMonth() + 1;
      return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();

    await this.showCourseWithRetry(currentYear, currentTerm);
    
    // Update mobile UI after refresh
    this.updateMobileUI();
  }

  // Public method to show specific term
  async showTerm(year, term) {
    this.currentUser = null; // Force fresh session fetch
    await this.showCourseWithRetry(year, term);
    this.updateMobileUI();
  }

  // Test method for debugging
  testMobile() {
    console.log('=== Testing Calendar Page Mobile ===');
    console.log('Window width:', window.innerWidth);
    console.log('isMobile:', this.isMobile);
    
    const dayHeaders = this.calendar.querySelectorAll("thead th");
    console.log('Day headers found:', dayHeaders.length);
    
    const mobileButtons = this.querySelectorAll('.day-button');
    console.log('Mobile buttons found:', mobileButtons.length);
    
    const today = this.getCurrentDay();
    console.log('Today should be:', today);
    
    if (this.isMobile) {
      console.log('Attempting to show day:', today);
      this.showDay(today);
    }
  }
}

// Define the custom element
customElements.define('calendar-page', CalendarPageComponent);

// Add global debug function
window.testCalendarPage = function() {
  const component = document.querySelector('calendar-page');
  if (component) {
    component.testMobile();
  } else {
    console.log('Calendar page component not found');
  }
};

// Export for module use
export { CalendarPageComponent };
