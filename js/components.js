import { supabase } from "/supabase.js";
import { fetchCourseData, openCourseInfoMenu } from "/js/shared.js";

// Initialize session state - will be updated by components as needed
let globalSession = null;
let globalUser = null;

// Initialize session asynchronously
(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    globalSession = session;
    globalUser = session?.user || null;
  } catch (error) {
    console.error('Error initializing global session:', error);
  }
})();

const yearSelect = document.getElementById("year-select");
const termSelect = document.getElementById("term-select");

// Keep for backward compatibility, but components should fetch fresh sessions
const user = globalUser;

class AppNavigation extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <style>
                @import url('/css/blaze.css');
            </style>
            <nav class="test">
                <ul>
                    <div class="profile-menu-container">
                    <li><button class="${document.title.includes('Profile') && 'active'}" id="profile"></button>
                        <p class="navigation-text">Profile</p></li>
                      <div class="profile-dropdown-menu">
                        <a href="#view-profile">View Profile</a>
                        <a href="#settings">Settings</a>
                        <a href="#logout">Logout</a>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="${document.title.includes('Dashboard') && 'active'}" id="dashboard"></button>
                        <p class="navigation-text">Dashboard</p></li>
                      <div class="accessibility-dropdown">
                        <p>Dashboard</p>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="${document.title.includes('Calendar') && 'active'}" id="calendar-btn"></button>
                      <p class="navigation-text">Calendar</p></li>
                    <div class="accessibility-dropdown">
                        <p>Calendar</p>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="${document.title.includes('Search') && 'active'}" id="search"></button>
                        <p class="navigation-text">Search</p></li>
                      <div class="accessibility-dropdown">
                        <p>Search</p>
                      </div>
                    </div>
                    <div class="accessibility-container accessibility-down">
                    <li><button class="${document.title.includes('Settings') && 'active'}" id="settings"></button></li>
                      <div class="accessibility-dropdown">
                        <p>Settings</p>
                      </div>
                    </div>
                    <div class="accessibility-container accessibility-down">
                    <li><button class="${document.title.includes('Help') && 'active'}" id="help"></button></li>
                      <div class="accessibility-dropdown">
                        <p>Help</p>
                      </div>
                    </div>
                </ul>
            </nav>
        `;
    }
}

class TotalCourses extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
            <style>
                @import url('/css/blaze.css');
            </style>
            <div class="total-courses">
                <div class="total-courses-container">
                <h2 class="total-count">0</h2>
                <h2 class="total-text">Registered<br>Courses</h2>
                </div>
            </div>
        `;
    }

    connectedCallback() {
        this.updateTotalCourses();
    }

    async updateTotalCourses() {
        const totalCountEl = this.shadowRoot.querySelector('.total-count');

        const fetchTotalCourses = async () => {
            try {
                // Get fresh session data
                const { data: { session } } = await supabase.auth.getSession();
                const currentUser = session?.user || null;

                if (!currentUser) {
                  return (this.shadowRoot.innerHTML = `
                    <style>
                      @import url('/css/blaze.css');
                    </style>
                    <div class="total-courses">
                      <div class="total-courses-container">
                      <h2 class="total-count">14</h2>
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
            totalCountEl.textContent = String(count);
        } catch (error) {
            console.error('Error updating total courses display:', error);
            totalCountEl.textContent = '0';
        }
    }
}

class TermBox extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        @import url('/css/blaze.css');
        .concentration-section {
          margin-top: 15px;
          padding-top: 15px;
        }
      </style>
      <div class="total-courses">
        <div class="total-courses-container">
          <div class="total-count" id="term-year-display"></div>
          <div class="concentration-section">
            <h2 class="total-text" id="concentration-text-id">Loading...</h2>
          </div>
        </div>
      </div>
    `;

    this.handleSelectChange = () => this.updateDisplayTerm();
  }

  connectedCallback() {
    // Set initial term/year display
    this.updateDisplayTerm();
    
    // Initialize concentration text
    this.initConcentration();

    // Attach listeners to keep display updated on changes
    this._ys = document.getElementById('year-select');
    this._ts = document.getElementById('term-select');
    this._termYearDisplay = this.shadowRoot.getElementById('term-year-display');

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
    const displayTermYear = this.shadowRoot.getElementById('term-year-display');
    if (!displayTermYear) return;

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
    displayTermYear.textContent = `${term} ${year}`;
  }

  async initConcentration() {
    const concentrationText = this.shadowRoot.getElementById('concentration-text-id');
    const containerDiv = this.shadowRoot.querySelector('.total-courses');

    try {
      // Get fresh session data
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user || null;

      if (!currentUser) {
        concentrationText.textContent = 'Global Culture';
        containerDiv.style.backgroundColor = "#C6E0B4";
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('concentration')
        .eq('id', currentUser.id)
        .single();

      if (profileError) throw profileError;

      const userConcentration = profile?.concentration || 'Global Culture';
      concentrationText.textContent = userConcentration;

      // Apply background color based on concentration
      if (userConcentration === "Global Culture") {
        containerDiv.style.backgroundColor = "#C6E0B4";
      } else if (userConcentration === "Economy") {
        containerDiv.style.backgroundColor = "#FFE699";
      } else if (userConcentration === "Politics") {
        containerDiv.style.backgroundColor = "#FFCCCC";
      } else {
        containerDiv.style.backgroundColor = "#C6E0B4"; // Default to Global Culture color
      }
    } catch (error) {
      console.error('Error fetching user concentration:', error);
      concentrationText.textContent = 'Global Culture';
      containerDiv.style.backgroundColor = "#C6E0B4";
    }
  }
}

// Remove the old ConcentrationBox class since it's now integrated into TermBox

class CourseCalendar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isInitialized = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;

    this.shadowRoot.innerHTML = `
      <style>
        @import url('/css/blaze.css');
        .loading-indicator {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100%;
          text-align: center;
          height: 100%;
          backdrop-filter: blur(3px);
          transform: translate(-50%, -50%);
          font-size: 14px;
          color: #666;
          z-index: 10;
        }
        .calendar-wrapper {
          position: relative;
        }
      </style>
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
                <td id="calendar-period-1"><p>09:00 - 10:30</p></td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-2"><p>10:45 - 12:15</p></td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-3"><p>13:10 - 14:40</p></td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-4"><p>14:55 - 16:25</p></td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-5"><p>16:40 - 18:10</p></td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.shadow = this.shadowRoot;
    this.calendar = this.shadow.getElementById("calendar-main");
    this.calendarHeader = this.calendar.querySelectorAll("thead th");
    this.loadingIndicator = this.shadow.getElementById("loading-indicator");

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
    // Initialize when connected to DOM
    this.initializeCalendar();
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
    const el = this.shadow.getElementById(id);
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
      emptyDiv.textContent = 'EMPTY';
      emptyDiv.classList.add('course-cell-main', 'empty-cell');
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

      // If no selected courses for current year/term, fill with EMPTY placeholders
      if (!selectedCourses.length) {
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
          emptyDiv.textContent = 'EMPTY';
          emptyDiv.classList.add('course-cell-main', 'empty-cell');
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

customElements.define('app-navigation', AppNavigation);
customElements.define('total-courses', TotalCourses);
customElements.define('term-box', TermBox);
customElements.define('course-calendar', CourseCalendar);

window.refreshCalendar = () => {
  const calendar = document.querySelector('course-calendar');
  if (calendar) {
    calendar.forceReinit();
  } else {
    console.log('No course-calendar component found');
  }
};