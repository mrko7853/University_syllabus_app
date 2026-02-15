import { supabase } from "../supabase.js";
import { fetchCourseData, openCourseInfoMenu, getCourseColorByType, fetchAvailableSemesters } from "./shared.js";
import { withBase } from "./path-utils.js";

// Helper function to normalize course titles
function normalizeCourseTitle(title) {
  if (!title) return title;

  // Convert full-width characters to normal characters
  let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (char) {
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

// Helper function to normalize short titles for Next Class display
function normalizeShortTitle(shortTitle) {
  if (!shortTitle) return shortTitle;

  // Convert full-width characters to normal width
  let normalized = shortTitle.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (char) {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  });

  // Convert full-width spaces to normal spaces
  normalized = normalized.replace(/　/g, ' ');

  // Remove ○ symbol
  normalized = normalized.replace(/○/g, '');

  // Remove parentheses
  normalized = normalized.replace(/[()（）]/g, '');

  // Clean up extra spaces and convert to UPPERCASE
  normalized = normalized.replace(/\s+/g, ' ').trim().toUpperCase();

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

const MOBILE_BREAKPOINT = 780;
const KEYBOARD_HEIGHT_THRESHOLD = 120;

function isEditableElement(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (!element.matches) return false;
  return element.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
}

function updateMobileNavSafeHeight() {
  const root = document.documentElement;
  const nav = document.querySelector('app-navigation');
  if (!root || !nav || window.innerWidth > MOBILE_BREAKPOINT) {
    root?.style.removeProperty('--mobile-nav-safe-height');
    return;
  }

  const navHeight = Math.ceil(nav.getBoundingClientRect().height || 0);
  if (navHeight > 0) {
    root.style.setProperty('--mobile-nav-safe-height', `${navHeight + 8}px`);
  }
}

function initializeMobileNavKeyboardState() {
  if (window.__mobileNavKeyboardStateInitialized) return;
  window.__mobileNavKeyboardStateInitialized = true;

  let baselineViewportHeight = window.visualViewport?.height || window.innerHeight;

  const updateKeyboardState = () => {
    if (!document.body) return;

    if (window.innerWidth > MOBILE_BREAKPOINT) {
      document.body.classList.remove('keyboard-visible');
      return;
    }

    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    if (viewportHeight > baselineViewportHeight - 32) {
      baselineViewportHeight = viewportHeight;
    }

    const activeElement = document.activeElement;
    const isEditing = isEditableElement(activeElement);
    const keyboardHeight = baselineViewportHeight - viewportHeight;
    const isKeyboardVisible = isEditing && keyboardHeight > KEYBOARD_HEIGHT_THRESHOLD;

    document.body.classList.toggle('keyboard-visible', isKeyboardVisible);
  };

  const refreshMobileNavState = () => {
    updateMobileNavSafeHeight();
    updateKeyboardState();
  };

  window.addEventListener('resize', refreshMobileNavState, { passive: true });
  window.addEventListener('orientationchange', () => {
    baselineViewportHeight = window.visualViewport?.height || window.innerHeight;
    setTimeout(refreshMobileNavState, 250);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', refreshMobileNavState);
    window.visualViewport.addEventListener('scroll', updateKeyboardState);
  }

  document.addEventListener('focusin', updateKeyboardState, true);
  document.addEventListener('focusout', () => {
    setTimeout(updateKeyboardState, 120);
  }, true);

  document.addEventListener('pageLoaded', () => {
    setTimeout(refreshMobileNavState, 30);
  });

  setTimeout(refreshMobileNavState, 0);
}

initializeMobileNavKeyboardState();

class AppNavigation extends HTMLElement {
  constructor() {
    super();

    // Use regular DOM instead of Shadow DOM to avoid CSS import issues
    this.innerHTML = `
            <nav class="test">
                <ul>
                    <li class="logo-nav-item"><div class="desktop-app-logo"></div></li>
                    <li><button class="nav-btn" id="home-btn" data-route="/">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Home</span>
                    </button></li>
                    <li><button class="nav-btn" id="dashboard" data-route="/courses">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Courses</span>
                    </button></li>
                    <li><button class="nav-btn" id="calendar-btn" data-route="/calendar">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Calendar</span>
                    </button></li>
                    <li><button class="nav-btn" id="assignments-btn" data-route="/assignments">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Assignments</span>
                    </button></li>
                    <div class="profile-menu-container">
                    <li><button class="nav-btn" id="profile" data-route="/profile">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Profile</span>
                    </button></li>
                      <div class="profile-dropdown-menu">
                        <a href="#view-profile">View Profile</a>
                        <a href="#settings">Settings</a>
                        <a href="#logout">Logout</a>
                      </div>
                    </div>
                    <li class="settings-nav-item"><button class="nav-btn" id="settings" data-route="/settings">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Settings</span>
                    </button></li>
                    <li class="help-nav-item"><button class="nav-btn" id="help" data-route="/help">
                        <span class="nav-icon"></span>
                        <span class="navigation-text">Help</span>
                    </button></li>
                </ul>
            </nav>
        `;
  }

  connectedCallback() {
    updateMobileNavSafeHeight();

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
      window.location.href = withBase('/login');

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
    this.handlePageLoaded = () => {
      setTimeout(() => this.updateTotalCourses(), 100);
    };
    this.handleSemesterSelectionChange = (event) => {
      const targetId = event?.target?.id;
      if (!targetId) return;

      if (
        targetId === 'semester-select'
        || targetId === 'semester-select-mobile'
        || targetId === 'term-select'
        || targetId === 'year-select'
      ) {
        setTimeout(() => this.updateTotalCourses(), 60);
      }
    };
    this.handleAssignmentsCardClick = () => {
      if (window.router?.navigate) {
        window.router.navigate('/assignments');
        return;
      }
      window.location.href = withBase('/assignments');
    };
    this.handleAssignmentsCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleAssignmentsCardClick();
      }
    };

    this.innerHTML = `
            <div class="total-courses" id="total-registered-courses">
                <div class="total-courses-container">
                <h2 class="total-text">Assignments Due</h2>
                <h2 class="total-count">0</h2>
                <p class="total-upcoming">
                  <span class="upcoming-assignment-title" hidden></span>
                  <span class="no-upcoming-assignment-text">No upcoming assignment</span>
                  <span class="upcoming-assignment-deadline"></span>
                </p>
                </div>
            </div>
        `;
  }

  connectedCallback() {
    // Always reinitialize when connected
    this.updateTotalCourses();

    // Set up refresh on router navigation
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);
    document.removeEventListener('change', this.handleSemesterSelectionChange);
    document.addEventListener('change', this.handleSemesterSelectionChange);

    const assignmentsContainer = this.querySelector('.total-courses-container');
    if (assignmentsContainer) {
      assignmentsContainer.setAttribute('role', 'button');
      assignmentsContainer.setAttribute('tabindex', '0');
      assignmentsContainer.addEventListener('click', this.handleAssignmentsCardClick);
      assignmentsContainer.addEventListener('keydown', this.handleAssignmentsCardKeyDown);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.removeEventListener('change', this.handleSemesterSelectionChange);

    const assignmentsContainer = this.querySelector('.total-courses-container');
    if (assignmentsContainer) {
      assignmentsContainer.removeEventListener('click', this.handleAssignmentsCardClick);
      assignmentsContainer.removeEventListener('keydown', this.handleAssignmentsCardKeyDown);
    }
  }

  getDaysLeft(dueDateValue) {
    const dueDate = new Date(dueDateValue);
    if (Number.isNaN(dueDate.getTime())) return null;
    dueDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  formatDaysLeft(daysLeft) {
    if (daysLeft === null) return '';
    if (daysLeft <= 0) return 'Due today';
    if (daysLeft === 1) return '1 day left';
    return `${daysLeft} days left`;
  }

  async updateTotalCourses() {
    const totalCountEl = this.querySelector('.total-count');
    const upcomingAssignmentTitleEl = this.querySelector('.upcoming-assignment-title');
    const noUpcomingTextEl = this.querySelector('.no-upcoming-assignment-text');
    const upcomingDeadlineEl = this.querySelector('.upcoming-assignment-deadline');

    const updateDisplay = ({
      count = '0',
      assignmentTitle = '',
      noUpcomingText = 'No upcoming assignment',
      daysLeftText = '',
      hasUpcomingAssignment = false
    }) => {
      if (totalCountEl) totalCountEl.textContent = String(count);
      if (upcomingDeadlineEl) upcomingDeadlineEl.textContent = daysLeftText;

      if (upcomingAssignmentTitleEl) {
        upcomingAssignmentTitleEl.textContent = hasUpcomingAssignment ? assignmentTitle : '';
        upcomingAssignmentTitleEl.hidden = !hasUpcomingAssignment;
      }

      if (noUpcomingTextEl) {
        noUpcomingTextEl.textContent = hasUpcomingAssignment ? '' : noUpcomingText;
        noUpcomingTextEl.hidden = hasUpcomingAssignment;
      }
    };

    const fetchDueAssignments = async () => {
      try {
        // Get fresh session data
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user || null;

        if (!currentUser) {
          return { guestUser: true, dueAssignments: [] };
        }

        const { data: assignments, error: assignmentsError } = await supabase
          .from('assignments')
          .select('title, due_date, status, course_year, course_term')
          .eq('user_id', currentUser.id)
          .neq('status', 'completed')
          .not('due_date', 'is', null);

        if (assignmentsError) {
          throw assignmentsError;
        }

        const currentYear = window.getCurrentYear ? window.getCurrentYear() : parseInt(document.getElementById("year-select")?.value || new Date().getFullYear(), 10);
        const currentTerm = window.getCurrentTerm ? window.getCurrentTerm() : (document.getElementById("term-select")?.value || 'Fall');
        const normalizedCurrentTerm = String(currentTerm).trim().toLowerCase();
        const normalizedCurrentYear = Number(currentYear);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dueAssignments = (assignments || [])
          .filter((assignment) => {
            const dueDate = assignment?.due_date ? new Date(assignment.due_date) : null;
            if (!dueDate || Number.isNaN(dueDate.getTime())) return false;
            dueDate.setHours(0, 0, 0, 0);

            if (dueDate < today) return false;

            const assignmentYear = assignment?.course_year === null || assignment?.course_year === undefined
              ? null
              : Number(assignment.course_year);
            const assignmentTerm = assignment?.course_term ? String(assignment.course_term).trim().toLowerCase() : null;
            const hasSemesterMetadata = assignmentYear !== null && assignmentTerm;

            if (!hasSemesterMetadata) return true;
            return assignmentYear === normalizedCurrentYear && assignmentTerm === normalizedCurrentTerm;
          })
          .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

        return { guestUser: false, dueAssignments };
      } catch (error) {
        console.error('Error fetching due assignments:', error);
        return { guestUser: false, dueAssignments: [] };
      }
    };

    try {
      const { guestUser, dueAssignments } = await fetchDueAssignments();

      if (guestUser) {
        updateDisplay({
          count: '--',
          noUpcomingText: 'Sign in to view due assignments',
          daysLeftText: '',
          hasUpcomingAssignment: false
        });
        return;
      }

      const upcoming = dueAssignments[0] || null;
      const daysLeft = upcoming?.due_date ? this.getDaysLeft(upcoming.due_date) : null;
      const assignmentTitle = upcoming?.title?.trim() || 'Untitled Assignment';

      updateDisplay({
        count: dueAssignments.length,
        assignmentTitle,
        noUpcomingText: 'No upcoming assignment',
        daysLeftText: upcoming ? this.formatDaysLeft(daysLeft) : '',
        hasUpcomingAssignment: Boolean(upcoming)
      });
    } catch (error) {
      console.error('Error updating due assignments display:', error);
      updateDisplay({
        count: '--',
        noUpcomingText: 'Unable to load assignments',
        daysLeftText: '',
        hasUpcomingAssignment: false
      });
    }
  }
}

class TermBox extends HTMLElement {
  constructor() {
    super();

    // ====================================================================
    // NEXT CLASS FEATURE - ENABLED
    // Semester end check is DISABLED for styling purposes
    // ====================================================================
    this.enableNextClass = true;

    // Temporary HTML for styling (shows old term/year display)
    if (!this.enableNextClass) {
      this.innerHTML = `
        <div class="total-courses">
          <div class="total-courses-container" id="#year-courses">
            <h2 class="total-count" id="term-semester">Fall</h2>
            <h2 class="total-text" id="term-year">2025</h2>
          </div>
        </div>
      `;
    } else {
      // New Next Class HTML (will be used once enabled)
      this.innerHTML = `
        <div class="total-courses">
          <div class="total-courses-container">
            <h2 class="total-text" id="next-class-label">Next Class</h2>
            <h2 class="total-count" id="next-class-name">Loading...</h2>
            <h2 class="total-text" id="next-class-time">Calculating...</h2>
          </div>
        </div>
      `;
    }

    this.updateInterval = null;
    this.courses = [];
    this.currentNextClassCourse = null;
    this.yearSelectEl = null;
    this.termSelectEl = null;
    this.handleNextClassPageLoaded = () => {
      setTimeout(() => this.updateNextClass(), 100);
    };
    this.handleNextClassSelectionChange = () => {
      this.updateNextClass();
    };
    this.handleNextClassCardClick = () => {
      if (this.currentNextClassCourse) {
        openCourseInfoMenu(this.currentNextClassCourse);
      }
    };
    this.handleNextClassCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleNextClassCardClick();
      }
    };
  }

  connectedCallback() {
    // ====================================================================
    // ENABLE NEXT CLASS FEATURE BY CHANGING enableNextClass to true
    // ====================================================================
    if (!this.enableNextClass) {
      // Old behavior: show term and year
      this.showOldTermDisplay();
      return;
    }

    // New behavior: show next class
    this.updateNextClass();

    // Update every minute
    this.updateInterval = setInterval(() => {
      this.updateNextClass();
    }, 60000); // 60 seconds

    // Listen for selector changes
    this.yearSelectEl = document.getElementById('year-select');
    this.termSelectEl = document.getElementById('term-select');

    this.yearSelectEl?.addEventListener('change', this.handleNextClassSelectionChange);
    this.termSelectEl?.addEventListener('change', this.handleNextClassSelectionChange);

    // Refresh on page navigation
    document.removeEventListener('pageLoaded', this.handleNextClassPageLoaded);
    document.addEventListener('pageLoaded', this.handleNextClassPageLoaded);

    const nextClassContainer = this.querySelector('.total-courses-container');
    if (nextClassContainer) {
      nextClassContainer.setAttribute('role', 'button');
      nextClassContainer.setAttribute('tabindex', '0');
      nextClassContainer.addEventListener('click', this.handleNextClassCardClick);
      nextClassContainer.addEventListener('keydown', this.handleNextClassCardKeyDown);
    }
  }

  disconnectedCallback() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.yearSelectEl?.removeEventListener('change', this.handleNextClassSelectionChange);
    this.termSelectEl?.removeEventListener('change', this.handleNextClassSelectionChange);
    this.yearSelectEl = null;
    this.termSelectEl = null;
    document.removeEventListener('pageLoaded', this.handleNextClassPageLoaded);

    const nextClassContainer = this.querySelector('.total-courses-container');
    if (nextClassContainer) {
      nextClassContainer.removeEventListener('click', this.handleNextClassCardClick);
      nextClassContainer.removeEventListener('keydown', this.handleNextClassCardKeyDown);
    }
  }

  // ====================================================================
  // OLD TERM DISPLAY (temporary for styling)
  // ====================================================================
  showOldTermDisplay() {
    this.updateDisplayTerm();

    const yearSelect = document.getElementById('year-select');
    const termSelect = document.getElementById('term-select');

    if (yearSelect) {
      yearSelect.addEventListener('change', () => this.updateDisplayTerm());
    }

    if (termSelect) {
      termSelect.addEventListener('change', () => this.updateDisplayTerm());
    }

    document.addEventListener('pageLoaded', () => {
      setTimeout(() => this.updateDisplayTerm(), 100);
    });
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

    const term = termRaw.trim();
    displayTermSemester.textContent = term;
    displayTermYear.textContent = year;
  }

  // ====================================================================
  // NEW NEXT CLASS FUNCTIONALITY (will run when enableNextClass = true)
  // ====================================================================

  async updateNextClass() {
    const labelEl = this.querySelector('#next-class-label');
    const nameEl = this.querySelector('#next-class-name');
    const timeEl = this.querySelector('#next-class-time');

    if (!labelEl || !nameEl || !timeEl) return;
    this.currentNextClassCourse = null;

    try {
      // Get current user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        nameEl.textContent = 'Please log in';
        timeEl.textContent = '';
        return;
      }

      // Get selected semester
      const year = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const termRaw = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';
      const term = termRaw.includes('/') ? termRaw.split('/')[1] : termRaw;

      // Get user's selected courses
      const { data: profile } = await supabase
        .from('profiles')
        .select('courses_selection')
        .eq('id', session.user.id)
        .single();

      const selectedCourses = profile?.courses_selection || [];
      const normalizedTerm = term.trim();

      // Filter for current semester
      const semesterCourses = selectedCourses.filter(course => {
        const courseTerm = course.term ? (course.term.includes('/') ? course.term.split('/')[1] : course.term) : null;
        return course.year === parseInt(year) && (!courseTerm || courseTerm === normalizedTerm);
      });

      if (semesterCourses.length === 0) {
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        return;
      }

      // Fetch full course data
      const allCoursesInSemester = await fetchCourseData(year, term);
      const userCourses = allCoursesInSemester.filter(course =>
        semesterCourses.some(sc => sc.code === course.course_code)
      );

      // Find next class
      const nextClass = this.findNextClass(userCourses, year, term);

      if (!nextClass) {
        labelEl.textContent = 'Next Class';
        nameEl.textContent = 'No classes scheduled';
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        return;
      }

      // Display the class info
      let displayName = nextClass.course.title || nextClass.course.course_code;

      // Truncate to 30 characters if needed
      if (displayName.length > 22) {
        displayName = displayName.substring(0, 22) + '...';
      }

      if (nextClass.isCurrent) {
        labelEl.textContent = 'Current Class';
        nameEl.textContent = displayName;
        timeEl.textContent = '';
        timeEl.style.display = 'none';
        this.currentNextClassCourse = nextClass.course;
      } else {
        labelEl.textContent = 'Next Class';
        nameEl.textContent = displayName;
        timeEl.textContent = nextClass.timeRemaining;
        timeEl.style.display = nextClass.timeRemaining ? 'block' : 'none';
        this.currentNextClassCourse = nextClass.course;
      }
    } catch (error) {
      console.error('Error updating next class:', error);
      nameEl.textContent = 'Error loading';
      timeEl.textContent = '';
    }
  }

  findNextClass(courses, year, term) {
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
    const currentTime = now.getHours() * 60 + now.getMinutes(); // minutes since midnight

    // ====================================================================
    // SEMESTER END CHECK - TEMPORARILY DISABLED FOR STYLING
    // To enable: Uncomment the lines below
    // ====================================================================
    /*
    const semesterEnd = this.getSemesterEnd(year, term);
    if (now > semesterEnd) {
      return null;
    }
    */

    const dayMap = {
      'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5,
      '月': 1, '火': 2, '水': 3, '木': 4, '金': 5
    };

    const scheduledClasses = [];

    courses.forEach(course => {
      const parsed = this.parseTimeSlot(course.time_slot);
      if (!parsed) return;

      const { day, startTime, endTime } = parsed;
      const dayNum = dayMap[day];
      if (!dayNum) return;

      scheduledClasses.push({
        course,
        dayNum,
        startTime,
        endTime
      });
    });

    if (scheduledClasses.length === 0) return null;

    // Check for current class (within first 30 minutes)
    const currentClasses = scheduledClasses.filter(cls => {
      return cls.dayNum === currentDay &&
        currentTime >= cls.startTime &&
        currentTime < cls.startTime + 30;
    });

    if (currentClasses.length > 0) {
      return {
        course: currentClasses[0].course,
        isCurrent: true,
        timeRemaining: ''
      };
    }

    // Find next upcoming class
    let nextClass = null;
    let minDiff = Infinity;

    for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysAhead);
      const targetDay = targetDate.getDay();

      if (targetDay === 0 || targetDay === 6) continue; // Skip weekends

      scheduledClasses.forEach(cls => {
        if (cls.dayNum !== targetDay) return;

        let timeDiff;
        if (daysAhead === 0) {
          // Today: only consider future classes
          if (cls.startTime <= currentTime) return;
          timeDiff = cls.startTime - currentTime;
        } else {
          // Future days
          timeDiff = (daysAhead * 24 * 60) + (cls.startTime - currentTime);
        }

        if (timeDiff > 0 && timeDiff < minDiff) {
          minDiff = timeDiff;
          nextClass = cls;
        }
      });

      if (nextClass) break; // Found a class this week
    }

    if (!nextClass) return null;

    // Calculate time remaining string
    const days = Math.floor(minDiff / (24 * 60));
    const hours = Math.floor((minDiff % (24 * 60)) / 60);
    const minutes = Math.floor(minDiff % 60);

    let timeStr = 'in ';
    if (days > 0) timeStr += `${days}d `;
    if (hours > 0) timeStr += `${hours}h `;
    if (minutes > 0 || (days === 0 && hours === 0)) timeStr += `${minutes}m`;

    return {
      course: nextClass.course,
      isCurrent: false,
      timeRemaining: timeStr.trim()
    };
  }

  parseTimeSlot(timeSlot) {
    if (!timeSlot) return null;

    // Try Japanese format: (月1講時) or (月曜日1講時)
    let match = timeSlot.match(/\(?([月火水木金])(?:曜日)?(\d+)(?:講時)?\)?/);
    if (match) {
      const dayJP = match[1];
      const period = parseInt(match[2], 10);

      const timeSlots = {
        1: { start: 9 * 60, end: 10 * 60 + 30 },      // 09:00-10:30
        2: { start: 10 * 60 + 45, end: 12 * 60 + 15 }, // 10:45-12:15
        3: { start: 13 * 60 + 10, end: 14 * 60 + 40 }, // 13:10-14:40
        4: { start: 14 * 60 + 55, end: 16 * 60 + 25 }, // 14:55-16:25
        5: { start: 16 * 60 + 40, end: 18 * 60 + 10 }  // 16:40-18:10
      };

      const slot = timeSlots[period];
      if (!slot) return null;

      return {
        day: dayJP,
        startTime: slot.start,
        endTime: slot.end
      };
    }

    // Try English format: "Mon 09:00 - 10:30"
    const engMatch = timeSlot.match(/^(Mon|Tue|Wed|Thu|Fri)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
    if (engMatch) {
      const day = engMatch[1];
      const startHour = parseInt(engMatch[2], 10);
      const startMin = parseInt(engMatch[3], 10);
      const endHour = parseInt(engMatch[4], 10);
      const endMin = parseInt(engMatch[5], 10);

      return {
        day,
        startTime: startHour * 60 + startMin,
        endTime: endHour * 60 + endMin
      };
    }

    return null;
  }

  getSemesterEnd(year, term) {
    // Spring semester: April 1 - July 31
    // Fall semester: October 1 - January 31 (next year)
    if (term === 'Spring') {
      return new Date(year, 6, 31, 23, 59, 59); // July 31 (month is 0-indexed)
    } else {
      return new Date(parseInt(year) + 1, 0, 31, 23, 59, 59); // January 31 next year
    }
  }
}

class CourseCalendar extends HTMLElement {
  constructor() {
    super();
    this.isInitialized = false;
    this.pageLoadedListenerAdded = false;
    this.currentUser = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.renderRequestId = 0;

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
                  <span class="period-index">1</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-2">
                  <span class="period-index">2</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-3">
                  <span class="period-index">3</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-4">
                  <span class="period-index">4</span>
                </td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td id="calendar-period-5">
                  <span class="period-index">5</span>
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

      // Listen for year/term selector changes
      const yearSelect = document.getElementById('year-select');
      const termSelect = document.getElementById('term-select');

      if (yearSelect) {
        yearSelect.addEventListener('change', () => {
          this.refreshFromSelectors();
        });
      }

      if (termSelect) {
        termSelect.addEventListener('change', () => {
          this.refreshFromSelectors();
        });
      }
    }
  }

  disconnectedCallback() {
    // Clean up event listeners if needed
  }

  refreshFromSelectors() {
    const year = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
    const term = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';
    console.log('Mini calendar: Refreshing from selectors:', year, term);
    this.showCourseWithRetry(year, term);
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
      this.highlightCurrentTimePeriod();

      // Use selected year/term from selectors instead of current date
      const year = window.getCurrentYear ? window.getCurrentYear() : new Date().getFullYear();
      const term = window.getCurrentTerm ? window.getCurrentTerm() : 'Fall';

      console.log('Mini calendar: Initializing with year/term:', year, term);

      // Load courses with retry mechanism
      await this.showCourseWithRetry(year, term);
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

  createRenderRequestId() {
    this.renderRequestId += 1;
    return this.renderRequestId;
  }

  isRenderRequestStale(requestId) {
    return requestId !== this.renderRequestId;
  }

  async showCourseWithRetry(year, term, retryAttempt = 0, requestId = null) {
    const activeRequestId = requestId ?? this.createRenderRequestId();

    try {
      if (retryAttempt === 0) this.showLoading();
      await this.showCourse(year, term, activeRequestId);

      if (this.isRenderRequestStale(activeRequestId)) {
        return;
      }

      if (retryAttempt === 0) this.hideLoading(); // Only hide loading if this was the initial attempt
    } catch (error) {
      if (this.isRenderRequestStale(activeRequestId)) {
        return;
      }

      if (retryAttempt < this.maxRetries) {
        // Don't hide loading for retries
        // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
        const delay = 500 * Math.pow(2, retryAttempt);
        setTimeout(() => {
          if (this.isRenderRequestStale(activeRequestId)) return;
          this.showCourseWithRetry(year, term, retryAttempt + 1, activeRequestId);
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
    // Remove all course/placeholder blocks in day cells.
    this.calendar.querySelectorAll('tbody tr td:not(:first-child)').forEach(cell => {
      cell.textContent = '';
    });
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
    // Minimal highlight for the first column (time slots)
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

  async showCourse(year, term, requestId = this.renderRequestId) {
    this.displayedYear = year;
    this.displayedTerm = term;

    try {
      // Ensure we have the latest user session
      if (!this.currentUser) {
        const { data: { session } } = await supabase.auth.getSession();
        if (this.isRenderRequestStale(requestId)) return;
        this.currentUser = session?.user || null;
      }

      let selectedCourses = [];
      let normalizedTerm = term.includes('/') ? term.split('/')[1] : term;

      if (this.currentUser) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('courses_selection')
          .eq('id', this.currentUser.id)
          .single();
        if (profileError) throw profileError;
        if (this.isRenderRequestStale(requestId)) return;

        selectedCourses = profile?.courses_selection || [];
        normalizedTerm = term.includes('/') ? term.split('/')[1] : term;

        // Filter to only show courses for the current year and term
        selectedCourses = selectedCourses.filter(course => {
          const courseTerm = course.term ? (course.term.includes('/') ? course.term.split('/')[1] : course.term) : null;
          return course.year === parseInt(year) && (!courseTerm || courseTerm === normalizedTerm);
        });

        console.log('Mini calendar: Selected courses for', year, normalizedTerm, ':', selectedCourses.length);
      }

      // If no user or no selected courses for current year/term, fill with EMPTY placeholders
      if (!this.currentUser || !selectedCourses.length) {
        if (this.isRenderRequestStale(requestId)) return;
        this.showEmptyCalendar();
        return;
      }

      const allCoursesInSemester = await fetchCourseData(year, term);
      if (this.isRenderRequestStale(requestId)) return;

      const coursesToShow = allCoursesInSemester.filter(course =>
        selectedCourses.some((profileCourse) =>
          profileCourse.code === course.course_code
        )
      );

      console.log('Mini calendar: Courses to show:', coursesToShow.length);
      console.log('Mini calendar: Course details:', coursesToShow.map(c => ({ code: c.course_code, time: c.time_slot })));

      this.clearCourseCells();

      for (const course of coursesToShow) {
        if (this.isRenderRequestStale(requestId)) return;

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
          continue;
        }

        const colIndex = this.getColIndexByDayEN(dayEN);
        if (colIndex === -1) {
          console.log('Invalid column index for day:', dayEN);
          continue;
        }

        const rowIndex = Number.isFinite(period) ? (period - 1) : -1;
        if (rowIndex < 0 || rowIndex >= 5) {
          console.log('Invalid row index for period:', period, 'rowIndex:', rowIndex);
          continue;
        }

        const cell = this.calendar.querySelector(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${colIndex + 1})`);
        if (!cell) {
          console.log('Cell not found for position:', { rowIndex: rowIndex + 1, colIndex: colIndex + 1 });
          continue;
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
        div_box.style.backgroundColor = getCourseColorByType(course.type);
        div.dataset.courseIdentifier = course.course_code;
        cell.appendChild(div);
        div.appendChild(div_box);
        div.appendChild(div_title);
        div.appendChild(div_classroom);
      }

      // Fill remaining empty cells with placeholders
      if (this.isRenderRequestStale(requestId)) return;
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
      return currentMonth >= 8 || currentMonth <= 2 ? "Fall" : "Spring";
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

class LatestCoursesPreview extends HTMLElement {
  constructor() {
    super();
    this.handlePageLoaded = () => {
      setTimeout(() => this.refreshPreview(), 100);
    };
    this.handleCardClick = () => {
      try {
        sessionStorage.setItem('open_new_assignment_modal', '1');
      } catch (error) {
        console.warn('Unable to store assignment quick-action intent:', error);
      }

      if (window.router?.navigate) {
        window.router.navigate('/assignments');
        return;
      }
      window.location.href = withBase('/assignments');
    };
    this.handleCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleCardClick();
      }
    };

    this.innerHTML = `
      <div class="home-courses-preview">
        <div class="home-courses-preview-header">
          <div>
            <h2 class="home-courses-preview-title">Quick Action</h2>
          </div>
          <span class="home-courses-preview-link">Add Assignment</span>
        </div>
        <p class="home-courses-preview-note">Add a new assignment to your schedule.</p>
      </div>
    `;
  }

  connectedCallback() {
    this.refreshPreview();
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);

    const card = this.querySelector('.home-courses-preview');
    if (card) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.removeEventListener('click', this.handleCardClick);
      card.removeEventListener('keydown', this.handleCardKeyDown);
      card.addEventListener('click', this.handleCardClick);
      card.addEventListener('keydown', this.handleCardKeyDown);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    const card = this.querySelector('.home-courses-preview');
    if (card) {
      card.removeEventListener('click', this.handleCardClick);
      card.removeEventListener('keydown', this.handleCardKeyDown);
    }
  }

  updateYearTermContext(semester) {
    if (!semester) return;

    const termSelectEl = document.getElementById('term-select');
    const yearSelectEl = document.getElementById('year-select');
    if (termSelectEl) {
      termSelectEl.value = semester.term;
    }
    if (yearSelectEl) {
      yearSelectEl.value = semester.year;
    }

    window.globalCurrentYear = parseInt(semester.year, 10);
    window.globalCurrentTerm = semester.term;
  }

  refreshWidgets() {
    const nextAssignment = document.querySelector('total-courses');
    if (nextAssignment?.updateTotalCourses) {
      nextAssignment.updateTotalCourses();
    }

    const nextClass = document.querySelector('term-box');
    if (nextClass?.updateNextClass) {
      nextClass.updateNextClass();
    }

    const miniCalendar = document.querySelector('course-calendar');
    if (miniCalendar?.refreshCalendar) {
      miniCalendar.refreshCalendar();
    }
  }

  async refreshPreview() {
    const noteEl = this.querySelector('.home-courses-preview-note');
    const quickActionText = 'Add a new assignment to your schedule.';

    if (noteEl) noteEl.textContent = quickActionText;

    try {
      const semesters = await fetchAvailableSemesters();
      const latestSemester = Array.isArray(semesters) && semesters.length > 0 ? semesters[0] : null;

      if (!latestSemester) {
        if (noteEl) noteEl.textContent = quickActionText;
        return;
      }

      this.updateYearTermContext(latestSemester);
      if (noteEl) noteEl.textContent = quickActionText;
      this.refreshWidgets();
    } catch (error) {
      console.error('Error loading latest courses preview:', error);
      if (noteEl) noteEl.textContent = quickActionText;
    }
  }
}

class ReviewSuggestionWidget extends HTMLElement {
  constructor() {
    super();
    this.suggestedCourse = null;
    this.lastSuggestedCourseKey = null;
    this.handlePageLoaded = () => {
      setTimeout(() => this.refreshSuggestion(), 120);
    };
    this.handleCardClick = () => {
      if (!this.suggestedCourse) return;
      const route = `/course/${encodeURIComponent(this.suggestedCourse.code)}/${this.suggestedCourse.year}/${encodeURIComponent(this.suggestedCourse.term)}`;
      if (window.router?.navigate) {
        window.router.navigate(route);
        return;
      }
      window.location.href = withBase(route);
    };
    this.handleCardKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleCardClick();
      }
    };

    this.innerHTML = `
      <div class="home-review-suggestion">
        <div class="home-review-suggestion-header">
          <h2 class="home-review-suggestion-title">Suggestion</h2>
          <span class="home-review-suggestion-link">Write Review</span>
        </div>
        <p class="home-review-suggestion-text">Review a course you have registered for.</p>
        <div class="home-review-suggestion-course-card">
          <h3 class="home-review-suggestion-course">Loading...</h3>
          <p class="home-review-suggestion-meta"></p>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.refreshSuggestion();
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    document.addEventListener('pageLoaded', this.handlePageLoaded);

    const card = this.querySelector('.home-review-suggestion');
    if (card) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.removeEventListener('click', this.handleCardClick);
      card.removeEventListener('keydown', this.handleCardKeyDown);
      card.addEventListener('click', this.handleCardClick);
      card.addEventListener('keydown', this.handleCardKeyDown);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('pageLoaded', this.handlePageLoaded);
    const card = this.querySelector('.home-review-suggestion');
    if (card) {
      card.removeEventListener('click', this.handleCardClick);
      card.removeEventListener('keydown', this.handleCardKeyDown);
    }
  }

  setContainerVisibility(isVisible) {
    this.style.display = isVisible ? 'block' : 'none';
    const container = this.closest('#home-review-suggestion-container');
    if (container) {
      container.style.display = isVisible ? 'block' : 'none';
    }
  }

  normalizeTerm(termValue) {
    if (termValue === null || termValue === undefined || termValue === '') {
      return window.getCurrentTerm ? String(window.getCurrentTerm()) : 'Fall';
    }

    const raw = String(termValue).trim();
    if (raw.includes('/')) {
      return raw.split('/').pop().trim();
    }

    const lower = raw.toLowerCase();
    if (lower.includes('fall') || raw.includes('秋')) return 'Fall';
    if (lower.includes('spring') || raw.includes('春')) return 'Spring';
    return raw;
  }

  getCourseSuggestionKey(course) {
    if (!course) return '';
    const code = String(course.code || '').trim();
    const year = Number(course.year) || '';
    const term = this.normalizeTerm(course.term || '');
    return `${code}|${year}|${term}`;
  }

  getReviewedCourseKey(code, termValue) {
    const normalizedCode = String(code || '').trim();
    const normalizedTerm = this.normalizeTerm(termValue || '');
    return `${normalizedCode}|${normalizedTerm}`;
  }

  pickRandomCourse(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return null;
    if (courses.length === 1) return courses[0];

    const candidates = this.lastSuggestedCourseKey
      ? courses.filter((course) => this.getCourseSuggestionKey(course) !== this.lastSuggestedCourseKey)
      : courses;
    const pool = candidates.length > 0 ? candidates : courses;
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex];
  }

  async refreshSuggestion() {
    const courseTitleEl = this.querySelector('.home-review-suggestion-course');
    const courseMetaEl = this.querySelector('.home-review-suggestion-meta');
    const courseCardEl = this.querySelector('.home-review-suggestion-course-card');
    if (courseTitleEl) courseTitleEl.textContent = 'Loading...';
    if (courseMetaEl) courseMetaEl.textContent = '';
    if (courseCardEl) courseCardEl.style.backgroundColor = 'rgba(255, 255, 255, 0.72)';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || null;
      if (!user) {
        this.suggestedCourse = null;
        this.setContainerVisibility(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('courses_selection')
        .eq('id', user.id)
        .single();

      if (error) {
        throw error;
      }

      const selectedCourses = Array.isArray(profile?.courses_selection)
        ? profile.courses_selection.filter((course) => course?.code && course?.year)
        : [];

      const uniqueSelectedCourses = [...new Map(
        selectedCourses.map((course) => [this.getCourseSuggestionKey(course), course])
      ).values()];

      let reviewedCourseKeys = new Set();
      try {
        const { data: reviewedCourses, error: reviewedCoursesError } = await supabase
          .from('course_reviews')
          .select('course_code, term')
          .eq('user_id', user.id);

        if (reviewedCoursesError) {
          throw reviewedCoursesError;
        }

        reviewedCourseKeys = new Set(
          (reviewedCourses || []).map((review) =>
            this.getReviewedCourseKey(review.course_code, review.term)
          )
        );
      } catch (error) {
        console.error('Error loading reviewed courses for suggestion widget:', error);
      }

      const availableCourses = uniqueSelectedCourses.filter((course) => {
        const reviewedKey = this.getReviewedCourseKey(course.code, course.term);
        return !reviewedCourseKeys.has(reviewedKey);
      });

      if (availableCourses.length === 0) {
        this.suggestedCourse = null;
        this.setContainerVisibility(false);
        return;
      }

      const selectedCourse = this.pickRandomCourse(availableCourses) || availableCourses[0];
      const year = Number(selectedCourse.year) || new Date().getFullYear();
      const term = this.normalizeTerm(selectedCourse.term);
      const code = String(selectedCourse.code);

      let displayTitle = code;
      let courseType = null;
      try {
        const semesterCourses = await fetchCourseData(year, term);
        const matchedCourse = Array.isArray(semesterCourses)
          ? semesterCourses.find((course) => course.course_code === code)
          : null;
        if (matchedCourse) {
          displayTitle = normalizeCourseTitle(matchedCourse.title || code);
          courseType = matchedCourse.type || null;
        }
      } catch (error) {
        console.error('Error fetching course title for review suggestion:', error);
      }

      this.suggestedCourse = { code, year, term };
      this.lastSuggestedCourseKey = `${code}|${year}|${term}`;
      if (courseTitleEl) courseTitleEl.textContent = displayTitle;
      if (courseMetaEl) courseMetaEl.textContent = `${term} ${year}`;
      if (courseCardEl) {
        courseCardEl.style.backgroundColor = courseType
          ? getCourseColorByType(courseType)
          : 'rgba(255, 255, 255, 0.72)';
      }
      this.setContainerVisibility(true);
    } catch (error) {
      console.error('Error loading review suggestion widget:', error);
      this.suggestedCourse = null;
      this.setContainerVisibility(false);
    }
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
    this.highlightToday();
    this.highlightCurrentTimePeriod();
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

  highlightToday() {
    const today = new Date().toLocaleDateString("en-US", { weekday: "short" });
    const headers = this.querySelectorAll('#calendar thead th');

    // Find column index for today
    let todayIndex = -1;
    headers.forEach((header, index) => {
      if (header.textContent.trim() === today) {
        todayIndex = index;
        header.classList.add('highlight-day');
      }
    });

    if (todayIndex === -1) return;

    // Highlight entire column
    const rows = this.querySelectorAll('#calendar tbody tr');
    rows.forEach(row => {
      const cells = row.children;
      if (cells[todayIndex]) {
        cells[todayIndex].classList.add('highlight-current-day');
      }
    });
  }

  highlightCurrentTimePeriod() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;
    const today = new Date().toLocaleDateString("en-US", { weekday: "short" });

    // Time periods in minutes
    const periods = [
      { start: 9 * 60, end: 10 * 60 + 30, row: 0 },
      { start: 10 * 60 + 45, end: 12 * 60 + 15, row: 1 },
      { start: 13 * 60 + 10, end: 14 * 60 + 40, row: 2 },
      { start: 14 * 60 + 55, end: 16 * 60 + 25, row: 3 },
      { start: 16 * 60 + 40, end: 18 * 60 + 10, row: 4 }
    ];

    const currentPeriod = periods.find(p => currentTime >= p.start && currentTime <= p.end);
    if (!currentPeriod) return;

    // Find today's column
    const headers = this.querySelectorAll('#calendar thead th');
    let todayIndex = -1;
    headers.forEach((header, index) => {
      if (header.textContent.trim() === today) {
        todayIndex = index;
      }
    });

    if (todayIndex === -1) return;

    // Highlight the specific cell
    const rows = this.querySelectorAll('#calendar tbody tr');
    if (rows[currentPeriod.row]) {
      const cells = rows[currentPeriod.row].children;
      if (cells[todayIndex]) {
        cells[todayIndex].classList.add('highlight-current-time');
      }
    }
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
        return currentMonth >= 8 || currentMonth <= 2 ? "Fall" : "Spring";
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
          <div class="course-cell-box" style="background-color: ${getCourseColorByType(course.type)};">
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
customElements.define('latest-courses-preview', LatestCoursesPreview);
customElements.define('review-suggestion-widget', ReviewSuggestionWidget);
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
