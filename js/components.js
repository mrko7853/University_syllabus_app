import { supabase } from "/supabase.js";
import { fetchCourseData, openCourseInfoMenu } from "/js/shared.js";

// Helper function to normalize course titles
function normalizeCourseTitle(title) {
    if (!title) return title;
    
    // Convert full-width characters to normal characters
    let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(char) {
        return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
    });
    
    // Convert full-width spaces to normal spaces
    normalized = normalized.replace(/　/g, ' ');
    
    // Remove parentheses and their contents
    normalized = normalized.replace(/[()（）]/g, '');
    
    // Clean up extra spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
}

// Initialize session state - will be updated by components as needed
window.globalSession = null;
window.globalUser = null;

// Initialize session asynchronously
(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    window.globalSession = session;
    window.globalUser = session?.user || null;
  } catch (error) {
    console.error('Error initializing global session:', error);
  }
})();

const yearSelect = document.getElementById("year-select");
const termSelect = document.getElementById("term-select");

// Keep for backward compatibility, but components should fetch fresh sessions
const user = window.globalUser;

class AppNavigation extends HTMLElement {
    constructor() {
        super();
        
        // Use regular DOM instead of Shadow DOM to avoid CSS import issues
        this.innerHTML = `
            <nav class="test">
                <ul>
                    <div class="profile-menu-container">
                    <li><button class="false" id="profile" data-route="/profile"></button>
                        <p class="navigation-text">Profile</p></li>
                      <div class="profile-dropdown-menu">
                        <a href="#view-profile">View Profile</a>
                        <a href="#settings">Settings</a>
                        <a href="#logout">Logout</a>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="false" id="dashboard" data-route="/dashboard"></button>
                        <p class="navigation-text">Dashboard</p></li>
                      <div class="accessibility-dropdown">
                        <p>Dashboard</p>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="false" id="calendar-btn" data-route="/calendar"></button>
                      <p class="navigation-text">Calendar</p></li>
                    <div class="accessibility-dropdown">
                        <p>Calendar</p>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="false" id="search" data-route="/search"></button>
                        <p class="navigation-text">Search</p></li>
                      <div class="accessibility-dropdown">
                        <p>Search</p>
                      </div>
                    </div>
                    <div class="accessibility-container accessibility-down">
                    <li><button class="false" id="settings" data-route="/settings"></button></li>
                      <div class="accessibility-dropdown">
                        <p>Settings</p>
                      </div>
                    </div>
                    <div class="accessibility-container accessibility-down">
                    <li><button class="false" id="help" data-route="/help"></button></li>
                      <div class="accessibility-dropdown">
                        <p>Help</p>
                      </div>
                    </div>
                </ul>
            </nav>
        `;
    }

    connectedCallback() {
        // Add event listener for logout link
        const logoutLink = this.querySelector('a[href="#logout"]');
        if (logoutLink) {
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleLogout();
            });
        }
    }

    async handleLogout() {
        try {
            // Show loading state on the logout link
            const logoutLink = this.querySelector('a[href="#logout"]');
            if (logoutLink) {
                logoutLink.textContent = 'Logging out...';
                logoutLink.style.pointerEvents = 'none';
            }

            // Sign out from Supabase
            const { error } = await supabase.auth.signOut();
            
            if (error) {
                console.error('Error during logout:', error);
                alert('Error during logout. Please try again.');
                
                // Reset logout link state
                if (logoutLink) {
                    logoutLink.textContent = 'Logout';
                    logoutLink.style.pointerEvents = 'auto';
                }
                return;
            }

            // Clear any local storage if needed
            localStorage.removeItem('token');
            
            // Update global session variables
            window.globalSession = null;
            window.globalUser = null;
            
            // Redirect to login page
            window.location.href = 'login.html';

        } catch (error) {
            console.error('Unexpected error during logout:', error);
            alert('An unexpected error occurred during logout.');
            
            // Reset logout link state
            const logoutLink = this.querySelector('a[href="#logout"]');
            if (logoutLink) {
                logoutLink.textContent = 'Logout';
                logoutLink.style.pointerEvents = 'auto';
            }
        }
    }
}

class TotalCourses extends HTMLElement {
    constructor() {
        super();

        this.innerHTML = `
            <div class="total-courses" id="total-registered-courses">
                <div class="total-courses-container">
                <h2 class="total-count">0</h2>
                <h2 class="total-text">Registered<br>Courses</h2>
                </div>
            </div>
        `;
    }

  connectedCallback() {
    // Always reinitialize when connected
    this.updateTotalCourses();
    
    // Set up refresh on router navigation
    document.addEventListener('pageLoaded', () => {
      setTimeout(() => this.updateTotalCourses(), 100);
    });
  }    async updateTotalCourses() {
        const totalCountEl = this.querySelector('.total-count');

        const fetchTotalCourses = async () => {
            try {
                // Get fresh session data
                const { data: { session } } = await supabase.auth.getSession();
                const currentUser = session?.user || null;

                if (!currentUser) {
                  // For guest users, show a placeholder instead of error
                  return (this.innerHTML = `
                    <div class="total-courses" id="total-registered-courses">
                      <div class="total-courses-container">
                      <h2 class="total-count">--</h2>
                      <h2 class="total-text">Registered<br>Courses</h2>
                      </div>
                    </div>
                  `);
                }

                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('courses_selection')
                    .eq('id', currentUser.id)
                    .single();

                if (profileError) {
                    throw profileError;
                }

                const selectedCourses = profile?.courses_selection || [];
                
                // Filter to only count courses for the current year and term using utility functions
                const currentDisplayCourses = selectedCourses.filter(course => {
                    const currentYear = window.getCurrentYear ? window.getCurrentYear() : parseInt(document.getElementById("year-select")?.value || new Date().getFullYear());
                    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (document.getElementById("term-select")?.value || '秋学期/Fall');
                    return course.year === currentYear && (!course.term || course.term === currentTerm);
                });
                
                return currentDisplayCourses.length;
            } catch (error) {
                console.error('Error fetching total courses:', error);
                return 0; // Return 0 if there's an error
            }
        };

        try {
            const count = await fetchTotalCourses();
            if (typeof count === 'number') {
                totalCountEl.textContent = String(count);
            }
        } catch (error) {
            console.error('Error updating total courses display:', error);
            totalCountEl.textContent = '--';
        }
    }
}

class TermBox extends HTMLElement {
  constructor() {
    super();

    this.innerHTML = `
      <div class="total-courses">
        <div class="total-courses-container" id="#year-courses">
          <h2 class="total-count" id="term-semester"></h2>
          <h2 class="total-text" id="term-year"></h2>
        </div>
      </div>
    `;

    this.handleSelectChange = () => this.updateDisplayTerm();
  }

  connectedCallback() {
    // Always reinitialize when connected
    this.updateDisplayTerm();
    this.initConcentration();

    // Set up refresh on router navigation
    document.addEventListener('pageLoaded', () => {
      setTimeout(() => {
        this.updateDisplayTerm();
        this.initConcentration();
      }, 100);
    });

    // Attach listeners to keep display updated on changes
    this._ys = document.getElementById('year-select');
    this._ts = document.getElementById('term-select');
    this._termSemesterDisplay = this.querySelector('#term-semester');
    this._termYearDisplay = this.querySelector('#term-year');

    if (this._ys) this._ys.addEventListener('change', this.handleSelectChange);
    if (this._ts) this._ts.addEventListener('change', this.handleSelectChange);
  }

  disconnectedCallback() {
    if (this._ys) this._ys.removeEventListener('change', this.handleSelectChange);
    if (this._ts) this._ts.removeEventListener('change', this.handleSelectChange);
  }

  translateTerm(termRaw) {
    return (termRaw || '')
      .replace('春学期', 'Spring')
      .replace('秋学期', 'Fall')
      .trim();
  }

  updateDisplayTerm() {
    const displayTermSemester = this.querySelector('#term-semester');
    const displayTermYear = this.querySelector('#term-year');
    if (!displayTermSemester || !displayTermYear) return;

    const ys = document.getElementById('year-select');
    const ts = document.getElementById('term-select');

    let year = ys?.value || '';
    let termRaw = ts?.value || '';

    if (termRaw.includes('/')) {
      const parts = termRaw.split('/');
      if (parts.length > 1) {
        if (!year) year = (parts[0] || '').trim();
        termRaw = (parts[1] || '').trim();
      }
    }

    const term = this.translateTerm(termRaw);
    displayTermSemester.textContent = term;
    displayTermYear.textContent = year;
  }

  async initConcentration() {
    const concentrationText = this.querySelector('#concentration-text-id');
    const containerDiv = this.querySelector('.total-courses');
  }
}

// Remove the old ConcentrationBox class since it's now integrated into TermBox

class CourseCalendar extends HTMLElement {
  constructor() {
    super();
    this.isInitialized = false;
    this.pageLoadedListenerAdded = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;

    this.innerHTML = `
      <div class="calendar-container-main">
        <div class="calendar-wrapper">
          <div class="loading-indicator" id="loading-indicator" style="display: none;"></div>
          <table id="calendar-main">
            <thead>
              <tr>
                <th><p style="display: none;">empty</p></th>
                <th id="calendar-monday"><p>M</p></th>
                <th id="calendar-tuesday"><p>T</p></th>
                <th id="calendar-wednesday"><p>W</p></th>
                <th id="calendar-thursday"><p>T</p></th>
                <th id="calendar-friday"><p>F</p></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="calendar-period-1">
                  <p class="time-full">09:00 - 10:30</p>
                  <p class="time-short">1h</p>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-2">
                  <p class="time-full">10:45 - 12:15</p>
                  <p class="time-short">2h</p>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-3">
                  <p class="time-full">13:10 - 14:40</p>
                  <p class="time-short">3h</p>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-4">
                  <p class="time-full">14:55 - 16:25</p>
                  <p class="time-short">4h</p>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-5">
                  <p class="time-full">16:40 - 18:10</p>
                  <p class="time-short">5h</p>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.shadow = this;
    this.calendar = this.querySelector("#calendar-main");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.querySelector("#loading-indicator");

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
  }

  connectedCallback() {
    // Only initialize if not already done
    if (!this.isInitialized) {
      this.initializeCalendar();
    }
    
    // Set up refresh on router navigation only once
    if (!this.pageLoadedListenerAdded) {
      this.pageLoadedListenerAdded = true;
      document.addEventListener('pageLoaded', () => {
        setTimeout(() => this.initializeCalendar(), 100);
      });
    }
  }

  disconnectedCallback() {
    // Clean up event listeners if needed
  }

  async initializeCalendar() {
    try {
      this.showLoading();
      
      // Get fresh session data
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;

      // Initial highlight
      this.highlightDay(new Date().toLocaleDateString("en-US", { weekday: "short" }));
      this.highlightPeriod();

      // Set current term
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      let term = "春学期/Spring";
      if (currentMonth >= 8 || currentMonth <= 2) {
        term = "秋学期/Fall";
      }

      // Load courses with retry mechanism
      await this.showCourseWithRetry(currentYear, term);
      this.isInitialized = true;
      this.hideLoading();
    } catch (error) {
      console.error('Error initializing calendar:', error);
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
      if (retryAttempt === 0) this.showLoading();
      await this.showCourse(year, term);
      if (retryAttempt === 0) this.hideLoading(); // Only hide loading if this was the initial attempt
    } catch (error) {
      if (retryAttempt < this.maxRetries) {
        // Don't hide loading for retries
        // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
        const delay = 500 * Math.pow(2, retryAttempt);
        setTimeout(() => {
          this.showCourseWithRetry(year, term, retryAttempt + 1);
        }, delay);
      } else {
        // Final fallback: show empty cells and hide loading
        this.hideLoading();
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
    // Remove previously rendered course blocks and empties
    this.calendar.querySelectorAll('tbody td .course-cell-main').forEach(el => el.remove());
  }

  showEmptyCalendar() {
    this.clearCourseCells();
    this.calendar.querySelectorAll('tbody tr td:not(:first-child)').forEach(cell => {
      const emptyDiv = document.createElement('div');
      
      emptyDiv.classList.add('course-cell-main');
      cell.appendChild(emptyDiv);
    });
  }

  highlightDay(dayShort) {
    // Minimal highlight: add a class to the selected header and column cells
    this.calendar.querySelectorAll('thead th, tbody td').forEach(el => el.classList.remove('highlight-day'));
    const colIndex = this.getColIndexByDayEN(dayShort);
    if (colIndex === -1) return;
    const header = this.calendarHeader[colIndex];
    if (header) header.classList.add('highlight-day');
    this.calendar.querySelectorAll(`tbody tr`).forEach(row => {
      const cell = row.querySelector(`td:nth-child(${colIndex + 1})`);
      if (cell) cell.classList.add('highlight-day');
    });
  }

  highlightPeriod() {
    // Minimal highlight for the first column (time slots)
    if (this.calendarHeader[0]) this.calendarHeader[0].classList.add("calendar-first");
    this.calendar.querySelectorAll("tbody tr").forEach(row => {
      const cell = row.querySelector("td:nth-child(1)");
      if (cell) cell.classList.add("calendar-first");
    });
  }

  async showCourse(year, term) {
    this.displayedYear = year;
    this.displayedTerm = term;

    try {
      // Ensure we have the latest user session
      if (!this.currentUser) {
        const { data: { session } } = await supabase.auth.getSession();
        this.currentUser = session?.user || null;
      }

      let selectedCourses = [];
      if (this.currentUser) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('courses_selection')
          .eq('id', this.currentUser.id)
          .single();
        if (profileError) throw profileError;
        selectedCourses = profile?.courses_selection || [];
        
        // Filter to only show courses for the current year and term
        selectedCourses = selectedCourses.filter(course => {
          return course.year === parseInt(year) && (!course.term || course.term === term);
        });
      }

      this.clearCourseCells();

      // If no user or no selected courses for current year/term, fill with EMPTY placeholders
      if (!this.currentUser || !selectedCourses.length) {
        this.showEmptyCalendar();
        return;
      }

      const allCoursesInSemester = await fetchCourseData(year, term);

      const coursesToShow = allCoursesInSemester.filter(course =>
        selectedCourses.some((profileCourse) =>
          profileCourse.code === course.course_code
        )
      );

      coursesToShow.forEach(course => {
        // Try Japanese format first: (月曜日1講時) or (月1講時) or (木4講時)
        let match = course.time_slot?.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
        let dayEN, period;
        
        if (match) {
          // Japanese format
          const dayJP = match[1];
          period = parseInt(match[2], 10);
          const dayMap = { "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat", "日": "Sun" };
          dayEN = dayMap[dayJP];
        } else {
          // Try English format: "Mon 10:45 - 12:15", "Wed 09:00 - 10:30", etc.
          const englishMatch = course.time_slot?.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
          if (englishMatch) {
            dayEN = englishMatch[1];
            const startHour = parseInt(englishMatch[2], 10);
            const startMin = parseInt(englishMatch[3], 10);
            
            // Map time to period based on start time
            const timeToSlot = startHour * 100 + startMin;
            if (timeToSlot >= 900 && timeToSlot < 1030) period = 1;
            else if (timeToSlot >= 1045 && timeToSlot < 1215) period = 2;
            else if (timeToSlot >= 1310 && timeToSlot < 1440) period = 3;
            else if (timeToSlot >= 1455 && timeToSlot < 1625) period = 4;
            else if (timeToSlot >= 1640 && timeToSlot < 1810) period = 5;
            else period = -1; // Invalid time slot
          }
        }
        
        if (!dayEN || !this.dayIdByEN[dayEN] || !period || period < 1) {
          return;
        }

        if (!dayEN || !this.dayIdByEN[dayEN] || !period || period < 1) {
          return;
        }

        const colIndex = this.getColIndexByDayEN(dayEN);
        if (colIndex === -1) {
          console.log('Invalid column index for day:', dayEN);
          return;
        }

        const rowIndex = Number.isFinite(period) ? (period - 1) : -1;
        if (rowIndex < 0 || rowIndex >= 5) {
          console.log('Invalid row index for period:', period, 'rowIndex:', rowIndex);
          return;
        }

        const cell = this.calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
        if (!cell) {
          console.log('Cell not found for position:', { rowIndex: rowIndex + 1, colIndex: colIndex + 1 });
          return;
        }

        console.log('Rendering course in cell:', { course: course.course_code, dayEN, period, colIndex, rowIndex });

        const div = document.createElement("div");
        const div_title = document.createElement("div");
        const div_box = document.createElement("div");
        const div_classroom = document.createElement("div");
        div.classList.add("course-cell-main");
        div_box.classList.add("course-cell-box");
        div_title.classList.add("course-title");
        div_classroom.classList.add("course-classroom");
        
        // Set the course content
        // div_title.textContent = course.short_title || course.title || course.course_code;
        // div_classroom.textContent = course.classroom || '';
        
        //if (div_classroom.textContent === "") {
        //  div_classroom.classList.add("empty-classroom");
        //  div_title.classList.add("empty-classroom-title");
        //}
        div_box.style.backgroundColor = "#ED7F81";
        div.dataset.courseIdentifier = course.course_code;
        cell.appendChild(div);
        div.appendChild(div_box);
        div.appendChild(div_title);
        div.appendChild(div_classroom);
      });

      // Fill remaining empty cells with placeholders
      this.calendar.querySelectorAll('tbody tr td:not(:first-child)').forEach(cell => {
        if (!cell.querySelector('.course-cell-main')) {
          const emptyDiv = document.createElement('div');
          emptyDiv.classList.add('course-cell-main');
          cell.appendChild(emptyDiv);
        }
      });
    } catch (error) {
      console.error('An unexpected error occurred while showing courses:', error);
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  async handleCalendarClick(event) {
    const clickedCell = event.target.closest("div.course-cell-main");
    if (!clickedCell) return;
    const courseCode = clickedCell.dataset.courseIdentifier;
    if (!this.displayedYear || !this.displayedTerm || !courseCode) return;
    
    try {
      const courses = await fetchCourseData(this.displayedYear, this.displayedTerm);
      const clickedCourse = courses.find(c => c.course_code === courseCode);
      if (clickedCourse) openCourseInfoMenu(clickedCourse);
    } catch (error) {
      console.error('Error handling calendar click:', error);
    }
  }

  // Public method to refresh calendar data
  async refreshCalendar() {
    console.log('Refreshing calendar...');
    
    // Clear current user to force fresh session fetch
    this.currentUser = null;
    
    if (!this.isInitialized) {
      return this.initializeCalendar();
    }
    
    // Use utility functions to get current year and term from selectors
    const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
      const currentMonth = new Date().getMonth() + 1;
      return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
    })();

    await this.showCourseWithRetry(currentYear, currentTerm);
  }

  // Public method to show specific term
  async showTerm(year, term) {
    // Clear current user to force fresh session fetch
    this.currentUser = null;
    await this.showCourseWithRetry(year, term);
  }
}

class WeeklyCalendar extends HTMLElement {
  constructor() {
    super();
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async connectedCallback() {
    await this.render();
    this.setupMobile();
    await this.loadCourses();
  }

  async render() {
    this.innerHTML = `
      <table id="calendar">
        <thead>
          <tr>
            <th style="text-align: left;"><button id="previous"></button></th>
            <th>Mon</th>
            <th>Tue</th>
            <th>Wed</th>
            <th>Thu</th>
            <th>Fri</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><p id="smaller-text">period 1</p><p>09:00<span class="mobile-time"></span>10:30</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 2</p><p>10:45<span class="mobile-time"></span>12:15</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 3</p><p>13:10<span class="mobile-time"></span>14:40</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 4</p><p>14:55<span class="mobile-time"></span>16:25</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><p id="smaller-text">period 5</p><p>16:40<span class="mobile-time"></span>18:10</p></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    `;

    // Add event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    const previousBtn = this.querySelector('#previous');
    if (previousBtn) {
      previousBtn.addEventListener('click', () => {
        // Navigate to previous week or refresh
        this.loadCourses();
      });
    }

    // Set up mobile resize listener
    window.addEventListener('resize', () => this.checkMobile());
    this.checkMobile();
  }

  checkMobile() {
    window.isMobile = window.innerWidth <= 780;
    if (window.isMobile) {
      this.generateMobileButtons();
    }
  }

  generateMobileButtons() {
    const mobileButtonsContainer = document.querySelector(".mobile-day-buttons");
    if (!mobileButtonsContainer) return;

    mobileButtonsContainer.innerHTML = "";

    const dayHeaders = this.querySelectorAll("#calendar thead th");
    dayHeaders.forEach((header, index) => {
        if (index === 0) return; // Skip the first column (time)
        
        const button = document.createElement("div");
        button.className = "day-button";
        button.textContent = header.textContent.trim().substring(0, 1);
        button.dataset.day = header.textContent.trim();
        mobileButtonsContainer.appendChild(button);

        button.addEventListener("click", () => this.showDay(header.textContent.trim()));
    });
  }

  showDay(day) {
    if (!window.isMobile) return;

    const dayHeaders = this.querySelectorAll("#calendar thead th");
    const dayButtons = document.querySelectorAll(".day-button");

    let columnIndexToShow = -1;

    dayHeaders.forEach((header, index) => {
        if (header.textContent.trim() === day) {
            columnIndexToShow = index;
        }
    });

    if (columnIndexToShow === -1) return;

    this.querySelectorAll("#calendar tr").forEach(row => {
        const cells = row.children;
        for (let i = 0; i < cells.length; i++) {
            if (i === 0 || i === columnIndexToShow) {
                cells[i].style.display = "";
            } else {
                cells[i].style.display = "none";
            }
        }
    });

    // Update day button styles
    dayButtons.forEach((button, index) => {
        if (button.textContent === day.substring(0, 1)) {
            button.classList.add("active");
        } else {
            button.classList.remove("active");
        }
    });

    // Update header highlighting
    dayHeaders.forEach((header, index) => {
        if (index === columnIndexToShow) {
            header.classList.add("highlight-day");
        } else {
            header.classList.remove("highlight-day");
        }
    });

    window.currentDay = day;
  }

  setupMobile() {
    this.checkMobile();
  }

  async getCurrentUser() {
    if (this.currentUser) return this.currentUser;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      this.currentUser = session?.user || null;
      return this.currentUser;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  async loadCourses() {
    try {
      const user = await this.getCurrentUser();
      if (!user) {
        console.log('No user session found for weekly calendar');
        return;
      }

      // Get current year and term from global state
      const currentYear = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (() => {
        const currentMonth = new Date().getMonth() + 1;
        return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring";
      })();

      console.log(`Loading courses for weekly calendar: ${currentYear} ${currentTerm} for user ${user.id}`);

      const courses = await fetchCourseData(currentYear, currentTerm);
      console.log('Courses fetched for weekly calendar:', courses);
      
      if (courses && courses.length > 0) {
        this.renderCourses(courses);
        this.retryCount = 0; // Reset retry count on success
      } else {
        console.log('No courses found for weekly calendar');
        this.clearCalendar();
      }
    } catch (error) {
      console.error('Error loading courses for weekly calendar:', error);
      
      // Retry logic
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`Retrying weekly calendar load (attempt ${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this.loadCourses(), 1000 * this.retryCount);
      } else {
        console.error('Max retries reached for weekly calendar');
        this.clearCalendar();
      }
    }
  }

  renderCourses(courses) {
    // Clear existing courses
    this.clearCalendar();

    // Day mapping
    const dayMap = {
      'Mon': 1, 'Monday': 1, '月': 1,
      'Tue': 2, 'Tuesday': 2, '火': 2,
      'Wed': 3, 'Wednesday': 3, '水': 3,
      'Thu': 4, 'Thursday': 4, '木': 4,
      'Fri': 5, 'Friday': 5, '金': 5
    };

    courses.forEach(course => {
      if (!course.day || !course.period) return;

      const dayIndex = dayMap[course.day];
      if (!dayIndex) return;

      const period = parseInt(course.period);
      if (isNaN(period) || period < 1 || period > 5) return;

      // Find the cell (row = period, column = day)
      const table = this.querySelector('#calendar tbody');
      const row = table.rows[period - 1]; // 0-indexed
      const cell = row.cells[dayIndex]; // day index is already 1-based, so this works

      if (cell) {
        // Create course element
        const courseElement = document.createElement('div');
        courseElement.className = 'course-cell-main';
        courseElement.innerHTML = `
          <div class="course-cell-box" style="background-color: ${course.color || '#E3D5E9'};">
            <span style="display: none;">${normalizeCourseTitle(course.title)}</span>
          </div>
        `;

        // Add click handler
        courseElement.addEventListener('click', () => {
          openCourseInfoMenu(course);
        });

        cell.appendChild(courseElement);
      }
    });
  }

  clearCalendar() {
    // Remove all course elements from table cells
    const cells = this.querySelectorAll('#calendar tbody td:not(:first-child)');
    cells.forEach(cell => {
      // Keep the time info, remove course elements
      const courseElements = cell.querySelectorAll('.course-cell-main');
      courseElements.forEach(el => el.remove());
    });
  }

  // Public method to refresh calendar
  async refresh() {
    console.log('Refreshing weekly calendar...');
    this.currentUser = null; // Force fresh session fetch
    await this.loadCourses();
  }

  // Public method to show specific term
  async showTerm(year, term) {
    console.log(`Showing weekly calendar for: ${year} ${term}`);
    this.currentUser = null; // Force fresh session fetch
    await this.loadCourses();
  }
}

customElements.define('app-navigation', AppNavigation);
customElements.define('total-courses', TotalCourses);
customElements.define('term-box', TermBox);
customElements.define('course-calendar', CourseCalendar);
customElements.define('weekly-calendar', WeeklyCalendar);

window.refreshCalendar = () => {
  const calendar = document.querySelector('course-calendar');
  const weeklyCalendar = document.querySelector('weekly-calendar');
  
  if (calendar) {
    calendar.forceReinit();
  }
  
  if (weeklyCalendar) {
    weeklyCalendar.refresh();
  }
  
  if (!calendar && !weeklyCalendar) {
    console.log('No calendar components found');
  }
};