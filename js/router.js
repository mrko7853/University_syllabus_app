/**
 * Complete SPA Router - Handles full component lifecycle
 * Ensures all components work properly on every navigation
 */

class SimpleRouter {
  constructor() {
    this.routes = {
      '/': '/index.html',
      '/dashboard': '/index.html', 
      '/calendar': '/calendar.html',
      '/profile': '/profile.html',
      '/login': '/login.html',
      '/register': '/register.html',
      '/settings': '/profile.html', // For now, settings goes to profile
      '/help': '/profile.html' // For now, help goes to profile
    }
    
    // Course URL pattern: /course/courseCode/year/term
    this.coursePattern = /^\/course\/([^\/]+)\/(\d{4})\/([^\/]+)$/
    
    this.currentPath = window.location.pathname
    this.isInitialized = false
    this.componentCleanupFunctions = []
    
    // Initialize global year/term variables
    this.initializeGlobalYearTerm()
    
    // Load styles immediately
    this.addLockedPageStyles()
    
    // Create loading bar
    this.createLoadingBar()
    
    this.init()
  }

  initializeGlobalYearTerm() {
    // Set default global year/term values
    const currentMonth = new Date().getMonth() + 1
    window.globalCurrentYear = new Date().getFullYear()
    window.globalCurrentTerm = currentMonth >= 8 || currentMonth <= 2 ? "Fall" : "Spring"
  }

  init() {
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      this.loadPage(window.location.pathname)
    })

    // Handle navigation clicks
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]')
      if (link && this.shouldIntercept(link)) {
        e.preventDefault()
        this.navigate(link.href)
      }
    })

    // Handle navigation button clicks
    document.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-route]')
      if (button) {
        e.preventDefault()
        
        // Special handling for search button - open modal instead of navigating
        if (button.dataset.route === '/search') {
          this.openSearchModal()
          return
        }
        
        this.navigate(button.dataset.route)
      }
    })

    // Load initial page
    const currentPath = window.location.pathname
    const basePath = this.extractBasePath(currentPath)
    
    if (basePath === '/' || basePath === '') {
      this.navigate('/dashboard')
    } else {
      // Load current page to initialize components
      this.loadPage(currentPath)
    }
    
    this.isInitialized = true
  }

  shouldIntercept(link) {
    const href = link.getAttribute('href')
    
    // Skip external links
    if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return false
    }
    
    // Skip links with target="_blank"
    if (link.target === '_blank') {
      return false
    }
    
    return true
  }

  navigate(path) {
    // Remove domain if full URL
    if (path.includes(window.location.origin)) {
      path = path.replace(window.location.origin, '')
    }
    
    // Handle route parameters (e.g., /profile/uuid)
    const cleanPath = this.extractBasePath(path)
    
    // Normalize path
    if (cleanPath === '' || cleanPath === '/') {
      path = '/dashboard'
    } else {
      path = cleanPath
    }

    if (path !== this.currentPath || !this.isInitialized) {
      window.history.pushState({}, '', path)
      this.loadPage(path)
    }
  }

  // Clean up existing components before loading new page
  cleanupCurrentPage() {
    // Run any registered cleanup functions
    this.componentCleanupFunctions.forEach(cleanup => {
      try {
        cleanup()
      } catch (error) {
        console.error('Error during component cleanup:', error)
      }
    })
    this.componentCleanupFunctions = []

    // Disconnect any existing components to force reinitialization
    const components = document.querySelectorAll('total-courses, term-box, course-calendar')
    components.forEach(component => {
      if (component.disconnectedCallback) {
        component.disconnectedCallback()
      }
    })

    // Clear any existing intervals or timeouts
    if (window.refreshInterval) {
      clearInterval(window.refreshInterval)
      window.refreshInterval = null
    }

    // Clear mobile state
    window.currentDay = null

    // Clear event listeners that might interfere
    const oldSelects = document.querySelectorAll('#year-select, #term-select')
    oldSelects.forEach(select => {
      const newSelect = select.cloneNode(true)
      select.parentNode.replaceChild(newSelect, select)
    })
  }

  async loadPage(path) {
    // Show loading bar
    this.showLoadingBar()
    
    // Check if this is a course URL first
    const courseMatch = path.match(this.coursePattern)
    if (courseMatch) {
      // This is a course URL - redirect to dashboard and handle course opening
      const [, courseCode, year, term] = courseMatch
      console.log('Course URL detected:', { courseCode, year, term })
      
      // Load dashboard first
      const basePath = '/dashboard'
      this.currentPath = basePath
      
      try {
        // Clean up current page first
        this.cleanupCurrentPage()
        
        // Load dashboard HTML
        const response = await fetch('/index.html')
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
        
        const html = await response.text()
        document.body.innerHTML = html
        
        // Initialize dashboard components
        await this.reinitializeEverything('/dashboard')
        
        // Update active navigation to show dashboard as active
        this.updateActiveNav('/dashboard')
        
        // Wait for components to be ready, then open the course
        setTimeout(async () => {
          try {
            // Find the course and open it
            const courses = await fetchCourseData(parseInt(year), term)
            const course = courses.find(c => c.course_code === courseCode)
            if (course) {
              openCourseInfoMenu(course, false) // false to prevent URL update loop
            } else {
              console.warn('Course not found:', courseCode)
            }
          } catch (error) {
            console.error('Error opening course from URL:', error)
          }
        }, 1000)
        
        this.hideLoadingBar()
        return
      } catch (error) {
        console.error('Error loading course URL:', error)
        this.hideLoadingBar()
        return
      }
    }
    
    // Extract base path for route matching
    const basePath = this.extractBasePath(path)
    this.currentPath = basePath
    
    // Check if user is authenticated for protected routes
    const isProtectedRoute = this.isProtectedRoute(basePath)
    const isAuthenticated = await this.checkAuthentication()
    
    // Get the HTML file for this route
    const htmlFile = this.routes[basePath]
    if (!htmlFile) {
      console.error('No route found for:', basePath)
      this.hideLoadingBar()
      return
    }

    try {
      // Clean up current page first
      this.cleanupCurrentPage()
      
      // If protected route and user not authenticated, show locked message
      if (isProtectedRoute && !isAuthenticated) {
        this.showLockedPage(basePath)
        this.hideLoadingBar()
        return
      }
      
      // Update loading progress
      this.updateLoadingProgress(30)
      
      // Fetch the HTML content
      const response = await fetch(htmlFile)
      if (!response.ok) {
        throw new Error(`Failed to load ${htmlFile}`)
      }
      
      const html = await response.text()
      
      // Update loading progress
      this.updateLoadingProgress(60)
      
      // Parse the HTML
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      
      // Extract the content we want (everything except navigation)
      const newContent = doc.querySelector('#app-content') || doc.querySelector('section') || doc.body
      
      // Update the page content - PROPERLY for custom elements
      const mainContent = document.querySelector('#app-content') || document.querySelector('section') || document.body
      if (newContent && mainContent) {
        // Clear existing content first
        mainContent.replaceChildren()
        
        // Clone and append nodes to ensure custom elements are properly connected
        Array.from(newContent.childNodes).forEach(node => {
          const clonedNode = node.cloneNode(true)
          mainContent.appendChild(clonedNode)
        })
        
        console.log('Router: Page content updated with proper DOM methods for custom elements')
      }
      
      // Update the page title
      if (doc.title) {
        document.title = doc.title
      }
      
      // Update loading progress
      this.updateLoadingProgress(80)
      
      // Update active navigation
      this.updateActiveNav(basePath)
      
      // Re-initialize everything for the new content
      await this.reinitializeEverything(basePath)
      
      // Update loading progress
      this.updateLoadingProgress(95)
      
      // ALWAYS check for guest dashboard on ANY dashboard load (including first load)
      if (basePath === '/dashboard' || basePath === '/' || this.routes[basePath] === '/index.html') {
        const isAuthenticated = await this.checkAuthentication()
        this.handleGuestDashboard(isAuthenticated)
      }
      
      // Complete loading
      this.updateLoadingProgress(100)
      setTimeout(() => this.hideLoadingBar(), 200)
      
    } catch (error) {
      console.error('Error loading page:', error)
      this.hideLoadingBar()
    }
  }

  updateActiveNav(currentPath) {
    // Remove active class and add false class to all nav buttons
    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.remove('active')
      el.classList.add('false')
    })
    
    // Add active class and remove false class from current page button
    const activeButton = document.querySelector(`[data-route="${currentPath}"]`)
    if (activeButton) {
      activeButton.classList.add('active')
      activeButton.classList.remove('false')
    }
  }

  async reinitializeEverything(path) {
    try {
      // Wait for DOM to be ready
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Check authentication status for UI modifications
      const isAuthenticated = await this.checkAuthentication()
      
      // Re-import and reinitialize main.js functionality if on dashboard/index
      if (path === '/dashboard' || path === '/' || this.routes[path] === '/index.html') {
        await this.initializeDashboard()
        // Hide top content for guest users on dashboard
        this.handleGuestDashboard(isAuthenticated)
      }
      
      // Re-import and reinitialize calendar.js functionality if on calendar
      if (path === '/calendar' || this.routes[path] === '/calendar.html') {
        await this.initializeCalendar()
      }
      
      // Re-import and reinitialize profile.js functionality if on profile
      if (path === '/profile' || this.routes[path] === '/profile.html') {
        await this.initializeProfile()
      }

      // Initialize shared functionality for all pages
      await this.initializeShared()
      
      // Force component reinitialization
      this.forceComponentReinitialization()
      
      // Dispatch page loaded event
      document.dispatchEvent(new CustomEvent('pageLoaded', { 
        detail: { path: path } 
      }))
      
    } catch (error) {
      console.error('Error reinitializing page:', error)
    }
  }

  async initializeDashboard() {
    try {
      // In production, modules are already bundled and available
      if (this.isProduction()) {
        // Call initialization functions directly if they exist
        if (window.initializeDashboard) {
          window.initializeDashboard()
        }
        
        // Also ensure courses are loaded
        if (window.updateCoursesAndFilters) {
          try {
            await window.updateCoursesAndFilters()
          } catch (error) {
            console.error('Error loading courses in production:', error)
          }
        }
      } else {
        // Re-import main.js to get fresh instances (dev mode only)
        const mainModule = await import('./main.js?' + Date.now())
        
        // Call the initialization function
        if (mainModule.initializeDashboard) {
          mainModule.initializeDashboard()
        }
      }
      
      // Initialize year/term selectors
      this.initializeYearTermSelectors()
      
      // Initialize course search and filtering
      this.initializeCourseSearch()
      
      // Initialize dashboard-specific components
      this.initializeDashboardComponents()
      
      // Set up global year/term tracking
      this.setupGlobalYearTermTracking()
      
    } catch (error) {
      console.error('Error initializing dashboard:', error)
    }
  }

  async initializeCalendar() {
    try {
      // Initialize calendar-specific functionality using web component
      this.initializeCalendarComponents()
      
      // Initialize the course-calendar web component
      const calendarComponent = document.querySelector('course-calendar')
      if (calendarComponent) {
        // Trigger a refresh of the calendar component
        if (calendarComponent.refreshCalendar) {
          calendarComponent.refreshCalendar()
        }
        // Or if it has a showCourse method, call it
        else if (calendarComponent.showCourse) {
          const currentYear = window.globalCurrentYear || new Date().getFullYear()
          const currentTerm = window.globalCurrentTerm || (new Date().getMonth() >= 7 ? "Fall" : "Spring")
          calendarComponent.showCourse(currentYear, currentTerm)
        }
      }
      
      // Check for calendar-page component 
      const calendarPageComponent = document.querySelector('calendar-page')
      if (calendarPageComponent) {
        console.log('Calendar page component found - it should auto-initialize')
      } else {
        console.log('No calendar page component found in DOM')
        
        // If we're on calendar page but component isn't found, try dynamic import
        if (basePath === '/calendar') {
          console.log('Attempting dynamic import of calendar page component...')
          try {
            if (!this.isProduction()) {
              await import('./calendar-page-component.js')
              console.log('Calendar page component imported successfully')
            } else {
              console.log('Production mode: calendar component should already be bundled')
            }
          } catch (error) {
            console.error('Failed to import calendar page component:', error)
          }
        }
      }
      
    } catch (error) {
      console.error('Error initializing calendar:', error)
    }
  }

  async initializeProfile() {
    try {
      // In production, modules are already bundled and available
      if (this.isProduction()) {
        // Call initialization functions directly if they exist
        if (window.initializeProfile) {
          await window.initializeProfile()
        }
      } else {
        // Re-import profile.js to get fresh instances (dev mode only)
        const profileModule = await import('./profile.js?' + Date.now())
        
        // Call the initialization function
        if (profileModule.initializeProfile) {
          await profileModule.initializeProfile()
        }
      }
      
      // Initialize profile-specific functionality
      this.initializeProfileComponents()
      
      // Set up global year/term tracking (needed for navigation to work)
      this.setupGlobalYearTermTracking()
      
    } catch (error) {
      console.error('Error initializing profile:', error)
    }
  }

  async initializeShared() {
    try {
      // In production, modules are already bundled and available
      if (this.isProduction()) {
        // Shared functionality is already loaded, just initialize components
        this.initializeSharedComponents()
      } else {
        // Re-import shared.js to get fresh instances (dev mode only)
        const sharedModule = await import('./shared.js?' + Date.now())
        
        // Initialize shared functionality
        this.initializeSharedComponents()
      }
      
      // Set up global year/term tracking for all pages as fallback
      this.setupGlobalYearTermTracking()
      
    } catch (error) {
      console.error('Error initializing shared:', error)
    }
  }

  initializeYearTermSelectors() {
    // Year and term selector functionality
    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')
    
    if (yearSelect && termSelect) {
      // Set up event listeners for year/term changes
      const handleSelectChange = () => {
        this.refreshAllComponents()
      }
      
      yearSelect.addEventListener('change', handleSelectChange)
      termSelect.addEventListener('change', handleSelectChange)
      
      this.componentCleanupFunctions.push(() => {
        yearSelect.removeEventListener('change', handleSelectChange)
        termSelect.removeEventListener('change', handleSelectChange)
      })
    }
  }

  initializeCourseSearch() {
    // Course search functionality
    const searchInput = document.getElementById('search-course')
    if (searchInput) {
      const handleSearch = (e) => {
        // Add search functionality here
        console.log('Search triggered:', e.target.value)
      }
      
      searchInput.addEventListener('input', handleSearch)
      
      this.componentCleanupFunctions.push(() => {
        searchInput.removeEventListener('input', handleSearch)
      })
    }
  }

  initializeDashboardComponents() {
    // Dashboard-specific initialization
  }

  setupGlobalYearTermTracking() {
    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')
    
    if (yearSelect && termSelect) {
      // Initialize global variables with current values
      window.globalCurrentYear = parseInt(yearSelect.value)
      window.globalCurrentTerm = termSelect.value
      
      // Add listeners to update global variables when selectors change
      const updateGlobals = () => {
        window.globalCurrentYear = parseInt(yearSelect.value)
        window.globalCurrentTerm = termSelect.value
      }
      
      yearSelect.addEventListener('change', updateGlobals)
      termSelect.addEventListener('change', updateGlobals)
      
      // Store cleanup for these listeners
      this.componentCleanupFunctions.push(() => {
        yearSelect.removeEventListener('change', updateGlobals)
        termSelect.removeEventListener('change', updateGlobals)
      })
    }
  }

  initializeCalendarComponents() {
    // Calendar-specific initialization - the CourseCalendar web component handles most functionality
  }

  initializeSharedComponents() {
    // Shared component initialization
  }

  initializeProfileComponents() {
    // Profile-specific initialization
  }

  forceComponentReinitialization() {
    // Force web components to reinitialize
    const components = document.querySelectorAll('total-courses, term-box, course-calendar')
    components.forEach(component => {
      if (component.connectedCallback) {
        component.connectedCallback()
      }
    })
  }

  refreshAllComponents() {
    // Refresh all components when year/term changes
    const calendarComponent = document.querySelector('course-calendar')
    if (calendarComponent && calendarComponent.refreshCalendar) {
      calendarComponent.refreshCalendar()
    }
    
    const totalCoursesComponent = document.querySelector('total-courses')
    if (totalCoursesComponent && totalCoursesComponent.updateTotalCourses) {
      totalCoursesComponent.updateTotalCourses()
    }
    
    const termBoxComponent = document.querySelector('term-box')
    if (termBoxComponent && termBoxComponent.updateDisplayTerm) {
      termBoxComponent.updateDisplayTerm()
    }
  }

  // Extract base path from parameterized routes
  extractBasePath(path) {
    // Handle routes with parameters like /profile/uuid
    if (path.startsWith('/profile/')) {
      return '/profile'
    }
    if (path.startsWith('/calendar/')) {
      return '/calendar'
    }
    if (path.startsWith('/dashboard/')) {
      return '/dashboard'
    }
    if (path.startsWith('/settings/')) {
      return '/settings'
    }
    
    // Return the path as-is for routes without parameters
    return path
  }

  // Check if a route requires authentication
  isProtectedRoute(path) {
    const protectedRoutes = ['/profile', '/calendar', '/settings']
    return protectedRoutes.includes(path)
  }

  // Check if user is authenticated
  async checkAuthentication() {
    try {
      // Import supabase dynamically to avoid circular dependencies
      if (this.isProduction()) {
        // In production, supabase is already available globally
        if (window.supabase) {
          const { data: { session } } = await window.supabase.auth.getSession()
          return !!session
        }
        return false
      } else {
        // Development mode - dynamic import
        const { supabase } = await import('../supabase.js')
        const { data: { session } } = await supabase.auth.getSession()
        return !!session
      }
    } catch (error) {
      console.error('Error checking authentication:', error)
      return false
    }
  }

  // Show locked page for unauthenticated users
  showLockedPage(path) {
    const mainContent = document.querySelector('#app-content') || document.querySelector('section') || document.body
    if (!mainContent) return

    // Get page name for display
    const pageNames = {
      '/profile': 'Profile',
      '/calendar': 'Calendar',
      '/dashboard': 'Dashboard',
      '/settings': 'Settings',
      '/help': 'Help'
    }
    const pageName = pageNames[path] || 'Page'

    // Update title
    document.title = `${pageName} - BlazeArchive`

    // Show locked message
            // <button class="login-btn" onclick="window.router.navigate('/login')">Log In</button>
           // <button class="register-btn" onclick="window.router.navigate('/register')">Sign Up</button>
    mainContent.innerHTML = `
      <div class="locked-page-container">
        <div class="locked-page-content">
          <div class="lock-icon"></div>
          <h2 class="locked-title">Page Locked</h2>
          <p class="locked-message">Please log in to access the ${pageName} page.</p>
          <div class="locked-actions">

          </div>
        </div>
      </div>
    `

    // Update active navigation
    this.updateActiveNav(path)

    // Add locked page styles
    this.addLockedPageStyles()
  }

  // Add styles for locked page
  addLockedPageStyles() {
    const existingStyles = document.getElementById('locked-page-styles')
    if (existingStyles) return

    const styles = document.createElement('style')
    styles.id = 'locked-page-styles'
    styles.textContent = `
      .locked-page-container {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        padding: 2rem;
        text-align: center;
      }

      .locked-page-content {
        max-width: 400px;
        background: var(--surface-color, #f8f9fa);
        border-radius: 12px;
        padding: 3rem 2rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--border-color, #e0e0e0);
      }

      .lock-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
        opacity: 0.7;
      }

      .locked-title {
        color: var(--text-primary, #333);
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
      }

      .locked-message {
        color: var(--text-secondary, #666);
        font-size: 1rem;
        margin-bottom: 2rem;
        line-height: 1.5;
      }

      .locked-actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
      }

      .login-btn, .register-btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 0.9rem;
      }

      .login-btn {
        background: var(--primary-color, #007bff);
        color: white;
      }

      .login-btn:hover {
        background: var(--primary-dark, #0056b3);
        transform: translateY(-1px);
      }

      .register-btn {
        background: transparent;
        color: var(--primary-color, #007bff);
        border: 1px solid var(--primary-color, #007bff);
      }

      .register-btn:hover {
        background: var(--primary-color, #007bff);
        color: white;
        transform: translateY(-1px);
      }

      @media (max-width: 480px) {
        .locked-actions {
          flex-direction: column;
        }
        
        .locked-page-content {
          padding: 2rem 1.5rem;
        }
      }

      /* Guest dashboard styles */
      .guest-dashboard .top-content {
        display: none !important;
      }

      /* Loading bar styles */
      .router-loading-bar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 3px;
        background: transparent;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .router-loading-bar.visible {
        opacity: 1;
      }

      .router-loading-progress {
        height: 100%;
        background: linear-gradient(90deg, #ff0000 0%, #ff6b35 50%, #f7931e 100%);
        width: 0%;
        transition: width 0.3s ease;
        box-shadow: 0 0 10px rgba(255, 107, 53, 0.5);
      }

      .router-loading-bar.complete .router-loading-progress {
        transition: width 0.1s ease;
      }
    `
    document.head.appendChild(styles)
  }

  // Create loading bar element
  createLoadingBar() {
    if (document.getElementById('router-loading-bar')) return

    const loadingBar = document.createElement('div')
    loadingBar.id = 'router-loading-bar'
    loadingBar.className = 'router-loading-bar'
    
    const progress = document.createElement('div')
    progress.className = 'router-loading-progress'
    
    loadingBar.appendChild(progress)
    document.body.appendChild(loadingBar)
    
    this.loadingBar = loadingBar
    this.loadingProgress = progress
  }

  // Show loading bar
  showLoadingBar() {
    if (this.loadingBar) {
      this.loadingProgress.style.width = '0%'
      this.loadingBar.classList.remove('complete')
      this.loadingBar.classList.add('visible')
      
      // Start with a small progress
      setTimeout(() => this.updateLoadingProgress(10), 50)
    }
  }

  // Update loading progress
  updateLoadingProgress(percentage) {
    if (this.loadingProgress) {
      this.loadingProgress.style.width = `${percentage}%`
      
      if (percentage >= 100) {
        this.loadingBar.classList.add('complete')
      }
    }
  }

  // Hide loading bar
  hideLoadingBar() {
    if (this.loadingBar) {
      this.loadingBar.classList.remove('visible')
      setTimeout(() => {
        if (this.loadingProgress) {
          this.loadingProgress.style.width = '0%'
        }
        if (this.loadingBar) {
          this.loadingBar.classList.remove('complete')
        }
      }, 200)
    }
  }

  // Handle guest user dashboard modifications
  handleGuestDashboard(isAuthenticated) {
    const mainContent = document.querySelector('#app-content')
    if (!mainContent) return

    if (!isAuthenticated) {
      // Add guest class to hide top content
      mainContent.classList.add('guest-dashboard')
    } else {
      // Remove guest class if user is authenticated
      mainContent.classList.remove('guest-dashboard')
    }
  }

  // Open search modal
  openSearchModal() {
    this.createSearchModal()
    const modal = document.getElementById('global-search-modal')
    if (modal) {
      modal.style.display = 'flex'
      // Focus on search input
      const searchInput = modal.querySelector('#global-search-input')
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 100)
      }
    }
  }

  // Close search modal
  closeSearchModal() {
    const modal = document.getElementById('global-search-modal')
    if (modal) {
      modal.style.display = 'none'
      // Clear search input
      const searchInput = modal.querySelector('#global-search-input')
      if (searchInput) {
        searchInput.value = ''
      }
    }
  }

  // Create search modal
  createSearchModal() {
    // Remove existing modal if present
    const existingModal = document.getElementById('global-search-modal')
    if (existingModal) {
      existingModal.remove()
    }

    // Get current year and term for defaults
    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth() + 1
    const defaultTerm = (currentMonth >= 8 || currentMonth <= 2) ? "秋学期/Fall" : "春学期/Spring"

    // Create modal HTML
    const modal = document.createElement('div')
    modal.id = 'global-search-modal'
    modal.className = 'global-search-modal'
    modal.innerHTML = `
      <div class="search-modal-overlay" onclick="window.router.closeSearchModal()"></div>
      <div class="search-modal-content">
        <div class="search-modal-header">
          <h2>Search Courses</h2>
          <button class="search-modal-close" onclick="window.router.closeSearchModal()">×</button>
        </div>
        
        <div class="search-modal-body">
          <div class="search-input-container">
            <input 
              type="text" 
              id="global-search-input" 
              placeholder="Search for courses..." 
              autocomplete="off"
            />
            <div id="global-search-autocomplete" class="global-search-autocomplete"></div>
          </div>
          
          <div class="search-filters">
            <div class="filter-group">
              <label for="search-year-select">Year:</label>
              <select id="search-year-select">
                <option value="${currentYear - 1}">${currentYear - 1}</option>
                <option value="${currentYear}" selected>${currentYear}</option>
                <option value="${currentYear + 1}">${currentYear + 1}</option>
              </select>
            </div>
            
            <div class="filter-group">
              <label for="search-term-select">Semester:</label>
              <select id="search-term-select">
                <option value="春学期/Spring" ${defaultTerm === "春学期/Spring" ? 'selected' : ''}>春学期/Spring</option>
                <option value="秋学期/Fall" ${defaultTerm === "秋学期/Fall" ? 'selected' : ''}>秋学期/Fall</option>
              </select>
            </div>
          </div>
          
          <div class="search-actions">
            <button id="global-search-submit" class="search-submit-btn">Search</button>
            <button onclick="window.router.closeSearchModal()" class="search-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
    `

    // Add modal to body
    document.body.appendChild(modal)

    // Initialize autocomplete data and event listeners
    this.initializeGlobalSearchAutocomplete()

    // Add event listeners
    this.setupSearchModalEventListeners()

    // Add modal styles
    this.addSearchModalStyles()
  }

  // Setup event listeners for search modal
  setupSearchModalEventListeners() {
    const modal = document.getElementById('global-search-modal')
    if (!modal) return

    const searchInput = modal.querySelector('#global-search-input')
    const searchSubmit = modal.querySelector('#global-search-submit')
    const yearSelect = modal.querySelector('#search-year-select')
    const termSelect = modal.querySelector('#search-term-select')

    // Handle Enter key in search input
    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.performGlobalSearch()
        }
      })

      // Handle input for autocomplete
      searchInput.addEventListener('input', (e) => {
        this.showGlobalAutocomplete(e.target.value)
      })

      // Handle keyboard navigation in autocomplete
      searchInput.addEventListener('keydown', (e) => {
        this.handleGlobalAutocompleteNavigation(e)
      })

      // Hide autocomplete when input loses focus (with delay for click handling)
      searchInput.addEventListener('blur', () => {
        setTimeout(() => this.hideGlobalAutocomplete(), 200)
      })
    }

    // Handle search submit button
    if (searchSubmit) {
      searchSubmit.addEventListener('click', () => {
        this.performGlobalSearch()
      })
    }

    // Handle year/term change to reload autocomplete data
    if (yearSelect) {
      yearSelect.addEventListener('change', () => {
        this.loadGlobalAutocompleteData()
      })
    }

    if (termSelect) {
      termSelect.addEventListener('change', () => {
        this.loadGlobalAutocompleteData()
      })
    }

    // Handle Escape key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeSearchModal()
      }
    })
  }

  // Perform global search
  async performGlobalSearch() {
    const modal = document.getElementById('global-search-modal')
    if (!modal) return

    const searchInput = modal.querySelector('#global-search-input')
    const yearSelect = modal.querySelector('#search-year-select')
    const termSelect = modal.querySelector('#search-term-select')

    const searchQuery = searchInput ? searchInput.value.trim() : ''
    const selectedYear = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear()
    const selectedTerm = termSelect ? termSelect.value : 'Spring'

    if (!searchQuery) {
      alert('Please enter a search term')
      return
    }

    // Close modal
    this.closeSearchModal()

    // Navigate to dashboard if not already there
    if (this.currentPath !== '/dashboard' && this.currentPath !== '/') {
      await this.navigate('/dashboard')
      
      // Wait for dashboard to load completely
      await new Promise(resolve => setTimeout(resolve, 800))
    }

    // Set the year and term selectors on dashboard
    this.setDashboardYearTerm(selectedYear, selectedTerm)

    // Wait for selectors to update and components to refresh
    await new Promise(resolve => setTimeout(resolve, 500))

    // Perform the search on dashboard
    this.performDashboardSearch(searchQuery)
  }

  // Set year and term on dashboard
  setDashboardYearTerm(year, term) {
    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')

    if (yearSelect && yearSelect.value !== year.toString()) {
      yearSelect.value = year.toString()
      // Trigger change event
      yearSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }

    if (termSelect && termSelect.value !== term) {
      termSelect.value = term
      // Trigger change event
      termSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }

    // Also update the filter menu selectors
    this.updateFilterMenuYearTerm(year, term)
  }

  // Update filter menu year and term
  updateFilterMenuYearTerm(year, term) {
    // The filter menu uses the same selectors as the main dashboard
    // year-select and term-select (without -filter suffix)
    
    // Update custom dropdowns in filter menu
    this.updateFilterCustomDropdowns(year, term)
  }

  // Update custom dropdowns in filter menu
  updateFilterCustomDropdowns(year, term) {
    // Update term custom dropdown
    const termCustomSelect = document.querySelector('.custom-select[data-target="term-select"]')
    if (termCustomSelect) {
      const termValue = termCustomSelect.querySelector('.custom-select-value')
      const termOptions = termCustomSelect.querySelectorAll('.custom-select-option')
      
      // Remove existing selection
      termOptions.forEach(option => option.classList.remove('selected'))
      
      // Find and select the correct option
      const targetOption = Array.from(termOptions).find(option => option.dataset.value === term)
      if (targetOption) {
        targetOption.classList.add('selected')
        if (termValue) {
          termValue.textContent = targetOption.textContent
        }
      }
    }

    // Update year custom dropdown  
    const yearCustomSelect = document.querySelector('.custom-select[data-target="year-select"]')
    if (yearCustomSelect) {
      const yearValue = yearCustomSelect.querySelector('.custom-select-value')
      const yearOptions = yearCustomSelect.querySelectorAll('.custom-select-option')
      
      // Remove existing selection
      yearOptions.forEach(option => option.classList.remove('selected'))
      
      // Find and select the correct option
      const targetOption = Array.from(yearOptions).find(option => option.dataset.value === year.toString())
      if (targetOption) {
        targetOption.classList.add('selected')
        if (yearValue) {
          yearValue.textContent = targetOption.textContent
        }
      }
    }
  }

  // Perform search on dashboard
  performDashboardSearch(query) {
    console.log('Performing dashboard search for:', query)
    
    // Set the global search query variable if available
    if (typeof window.currentSearchQuery !== 'undefined') {
      window.currentSearchQuery = query
    }
    
    // Try multiple approaches to ensure search works
    
    // Method 1: Use the global performSearch function if available
    if (window.performSearch) {
      console.log('Using window.performSearch')
      window.performSearch(query)
      
      // Update the course filter paragraph
      if (window.updateCourseFilterParagraph) {
        setTimeout(() => window.updateCourseFilterParagraph(), 100)
      }
      return
    }
    
    // Method 2: Try applySearchAndFilters directly with the query
    if (window.applySearchAndFilters) {
      console.log('Using window.applySearchAndFilters directly')
      window.applySearchAndFilters(query)
      
      // Update the course filter paragraph
      if (window.updateCourseFilterParagraph) {
        setTimeout(() => window.updateCourseFilterParagraph(), 100)
      }
      return
    }
    
    // Method 3: Use the search modal functionality
    const searchBtn = document.getElementById('search-btn')
    const searchInput = document.getElementById('search-input')
    const searchSubmit = document.getElementById('search-submit')
    
    if (searchBtn && searchInput && searchSubmit) {
      console.log('Using search modal approach')
      
      // Open the search modal
      searchBtn.click()
      
      // Wait a bit for modal to open
      setTimeout(() => {
        // Set the search query
        searchInput.value = query
        
        // Trigger input event for autocomplete/validation
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
        
        // Submit the search
        setTimeout(() => {
          searchSubmit.click()
          
          // Update the course filter paragraph after search
          if (window.updateCourseFilterParagraph) {
            setTimeout(() => window.updateCourseFilterParagraph(), 200)
          }
        }, 100)
      }, 200)
      return
    }
    
    // Method 4: Direct search input fallback
    const directSearchInput = document.getElementById('search-course')
    if (directSearchInput) {
      console.log('Using direct search input')
      directSearchInput.value = query
      directSearchInput.dispatchEvent(new Event('input', { bubbles: true }))
      
      // Try to find and click search submit
      const directSearchSubmit = document.getElementById('search-submit')
      if (directSearchSubmit) {
        setTimeout(() => {
          directSearchSubmit.click()
          
          // Update the course filter paragraph
          if (window.updateCourseFilterParagraph) {
            setTimeout(() => window.updateCourseFilterParagraph(), 200)
          }
        }, 100)
      }
      return
    }
    
    console.warn('No search method available, query:', query)
  }

  // Initialize global search autocomplete
  async initializeGlobalSearchAutocomplete() {
    this.globalSearchCourses = []
    this.globalSearchHighlightIndex = -1
    await this.loadGlobalAutocompleteData()
  }

  // Load autocomplete data for current year/term selection
  async loadGlobalAutocompleteData() {
    try {
      const modal = document.getElementById('global-search-modal')
      if (!modal) return

      const yearSelect = modal.querySelector('#search-year-select')
      const termSelect = modal.querySelector('#search-term-select')
      
      const year = yearSelect ? yearSelect.value : new Date().getFullYear()
      const term = termSelect ? termSelect.value : 'Fall'

      // Import shared functions
      if (this.isProduction()) {
        // In production, fetchCourseData should be globally available
        if (window.fetchCourseData) {
          this.globalSearchCourses = await window.fetchCourseData(year, term)
        }
      } else {
        // Development mode - dynamic import
        const { fetchCourseData } = await import('./shared.js')
        this.globalSearchCourses = await fetchCourseData(year, term)
      }
    } catch (error) {
      console.error('Error loading autocomplete data:', error)
      this.globalSearchCourses = []
    }
  }

  // Show autocomplete suggestions
  showGlobalAutocomplete(query) {
    const autocompleteContainer = document.getElementById('global-search-autocomplete')
    if (!autocompleteContainer) return

    if (!query.trim() || query.length < 2) {
      this.hideGlobalAutocomplete()
      return
    }

    const normalizedQuery = query.toLowerCase().trim()
    
    // First, try exact substring matches
    let suggestions = this.globalSearchCourses.filter(course => {
      const title = this.normalizeCourseTitle(course.title || '').toLowerCase()
      const professor = this.romanizeProfessorName(course.professor || '').toLowerCase()
      const courseCode = (course.course_code || '').toLowerCase()
      
      return title.includes(normalizedQuery) || 
             professor.includes(normalizedQuery) || 
             courseCode.includes(normalizedQuery)
    }).slice(0, 5)

    // If no exact matches found, use fuzzy matching
    if (suggestions.length === 0) {
      const coursesWithRelevance = this.globalSearchCourses.map(course => {
        const relevance = this.calculateCourseRelevance(normalizedQuery, course)
        return { course, relevance }
      })
      .filter(item => item.relevance > 0.15)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 6)
      
      suggestions = coursesWithRelevance.map(item => item.course)
    }

    if (suggestions.length === 0) {
      this.hideGlobalAutocomplete()
      return
    }

    // Build autocomplete HTML
    autocompleteContainer.innerHTML = ''
    suggestions.forEach((course, index) => {
      const item = document.createElement('div')
      item.className = 'global-autocomplete-item'
      
      const title = course.title || ''
      const highlightedTitle = this.highlightMatches(title, query)
      
      item.innerHTML = `
        <div class="item-title">${highlightedTitle}</div>
        <div class="item-details">
          <span class="item-code">${course.course_code}</span>
          <span class="item-professor">${this.romanizeProfessorName(course.professor)}</span>
        </div>
      `
      
      item.addEventListener('click', () => {
        const searchInput = document.getElementById('global-search-input')
        if (searchInput) {
          searchInput.value = course.title
        }
        this.hideGlobalAutocomplete()
        this.globalSearchHighlightIndex = -1
      })
      
      autocompleteContainer.appendChild(item)
    })

    autocompleteContainer.style.display = 'block'
    this.globalSearchHighlightIndex = -1
  }

  // Hide autocomplete
  hideGlobalAutocomplete() {
    const autocompleteContainer = document.getElementById('global-search-autocomplete')
    if (autocompleteContainer) {
      autocompleteContainer.style.display = 'none'
    }
  }

  // Handle keyboard navigation in autocomplete
  handleGlobalAutocompleteNavigation(event) {
    const autocompleteContainer = document.getElementById('global-search-autocomplete')
    if (!autocompleteContainer || autocompleteContainer.style.display === 'none') return

    const items = autocompleteContainer.querySelectorAll('.global-autocomplete-item')
    if (items.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.globalSearchHighlightIndex = Math.min(this.globalSearchHighlightIndex + 1, items.length - 1)
      this.updateGlobalAutocompleteHighlight(items)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.globalSearchHighlightIndex = Math.max(this.globalSearchHighlightIndex - 1, -1)
      this.updateGlobalAutocompleteHighlight(items)
    } else if (event.key === 'Enter' && this.globalSearchHighlightIndex >= 0) {
      event.preventDefault()
      items[this.globalSearchHighlightIndex].click()
    } else if (event.key === 'Escape') {
      this.hideGlobalAutocomplete()
    }
  }

  // Update highlight in autocomplete
  updateGlobalAutocompleteHighlight(items) {
    items.forEach((item, index) => {
      if (index === this.globalSearchHighlightIndex) {
        item.classList.add('highlighted')
      } else {
        item.classList.remove('highlighted')
      }
    })
  }

  // Helper functions for autocomplete
  normalizeCourseTitle(title) {
    if (!title) return title
    
    // Convert full-width characters to normal characters
    let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(char) {
      return String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
    })
    
    // Convert full-width spaces to normal spaces
    normalized = normalized.replace(/　/g, ' ')
    
    // Remove parentheses and their contents
    normalized = normalized.replace(/[()（）]/g, '')
    
    // Clean up extra spaces
    normalized = normalized.replace(/\s+/g, ' ').trim()
    
    return normalized
  }

  romanizeProfessorName(name) {
    if (!name) return ''
    
    // Basic romanization mapping (extend as needed)
    const romanizationMap = {
      'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
      'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
      'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
      'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
      'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
      'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
      'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
      'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
      'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
      'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'wo', 'ん': 'n'
    }
    
    let romanized = name
    for (const [hiragana, romaji] of Object.entries(romanizationMap)) {
      romanized = romanized.replace(new RegExp(hiragana, 'g'), romaji)
    }
    
    return romanized
  }

  calculateCourseRelevance(query, course) {
    const title = this.normalizeCourseTitle(course.title || '').toLowerCase()
    const professor = this.romanizeProfessorName(course.professor || '').toLowerCase()
    const courseCode = (course.course_code || '').toLowerCase()
    
    let score = 0
    
    // Exact matches get highest score
    if (title.includes(query)) score += 1.0
    if (professor.includes(query)) score += 0.8
    if (courseCode.includes(query)) score += 0.9
    
    // Fuzzy matching for partial matches
    const titleWords = title.split(' ')
    const queryWords = query.split(' ')
    
    for (const queryWord of queryWords) {
      for (const titleWord of titleWords) {
        if (titleWord.includes(queryWord) || queryWord.includes(titleWord)) {
          score += 0.3
        }
      }
    }
    
    return Math.min(score, 1.0)
  }

  highlightMatches(text, query) {
    if (!query.trim()) return text
    
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return text.replace(regex, '<mark>$1</mark>')
  }

  // Add search modal styles
  addSearchModalStyles() {
    const existingStyles = document.getElementById('search-modal-styles')
    if (existingStyles) return

    const styles = document.createElement('style')
    styles.id = 'search-modal-styles'
    styles.textContent = `
      .global-search-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: none;
        align-items: center;
        justify-content: center;
      }

      .search-modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
      }

      .search-modal-content {
        position: relative;
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        animation: modalSlideIn 0.3s ease;
      }

      @keyframes modalSlideIn {
        from {
          opacity: 0;
          transform: translateY(-20px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .search-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem;
        border-bottom: 1px solid #e0e0e0;
        background: #f8f9fa;
      }

      .search-modal-header h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #333;
      }

      .search-modal-close {
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s ease;
      }

      .search-modal-close:hover {
        background: #e0e0e0;
        color: #333;
      }

      .search-modal-body {
        padding: 1.5rem;
      }

      .search-input-container {
        margin-bottom: 1.5rem;
        position: relative;
      }

      #global-search-input {
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #e0e0e0;
        border-radius: 8px;
        font-size: 1rem;
        transition: border-color 0.2s ease;
        box-sizing: border-box;
      }

      #global-search-input:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
      }

      .global-search-autocomplete {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 1px solid #ddd;
        border-top: none;
        border-radius: 0 0 8px 8px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 1000;
        display: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .global-autocomplete-item {
        padding: 0.75rem;
        cursor: pointer;
        border-bottom: 1px solid #f0f0f0;
        transition: background-color 0.2s ease;
      }

      .global-autocomplete-item:hover,
      .global-autocomplete-item.highlighted {
        background-color: #f8f9fa;
      }

      .global-autocomplete-item:last-child {
        border-bottom: none;
      }

      .global-autocomplete-item .item-title {
        font-weight: 500;
        color: #333;
        margin-bottom: 0.25rem;
        line-height: 1.3;
      }

      .global-autocomplete-item .item-title mark {
        background: #fff3cd;
        color: #856404;
        padding: 0 2px;
        border-radius: 2px;
      }

      .global-autocomplete-item .item-details {
        display: flex;
        gap: 0.75rem;
        font-size: 0.85rem;
        color: #666;
      }

      .global-autocomplete-item .item-code {
        font-weight: 500;
        color: #007bff;
      }

      .global-autocomplete-item .item-professor {
        color: #6c757d;
      }

      .search-filters {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .filter-group {
        display: flex;
        flex-direction: column;
      }

      .filter-group label {
        font-weight: 500;
        margin-bottom: 0.5rem;
        color: #555;
        font-size: 0.9rem;
      }

      .filter-group select {
        padding: 0.5rem;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 0.9rem;
        background: white;
        cursor: pointer;
      }

      .filter-group select:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.1);
      }

      .search-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: flex-end;
      }

      .search-submit-btn, .search-cancel-btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 6px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 0.9rem;
      }

      .search-submit-btn {
        background: #007bff;
        color: white;
      }

      .search-submit-btn:hover {
        background: #0056b3;
        transform: translateY(-1px);
      }

      .search-cancel-btn {
        background: #f8f9fa;
        color: #666;
        border: 1px solid #ddd;
      }

      .search-cancel-btn:hover {
        background: #e9ecef;
        color: #333;
      }

      @media (max-width: 480px) {
        .search-modal-content {
          width: 95%;
          margin: 1rem;
        }

        .search-modal-header,
        .search-modal-body {
          padding: 1rem;
        }

        .search-filters {
          grid-template-columns: 1fr;
        }

        .search-actions {
          flex-direction: column;
        }
      }
    `
    document.head.appendChild(styles)
  }

  // Check if running in production mode
  isProduction() {
    // Check for various indicators that we're in production
    return (
      // Check if we're running from bundled assets
      window.location.pathname.includes('/assets/') ||
      // Check for common production indicators
      process?.env?.NODE_ENV === 'production' ||
      // Check if development server port is NOT in URL
      !window.location.href.includes(':5173') &&
      !window.location.href.includes('localhost') &&
      !window.location.href.includes('127.0.0.1')
    )
  }
}

// Utility functions for components to use
window.getCurrentYear = () => {
  const yearSelect = document.getElementById('year-select')
  if (yearSelect) {
    // Store the current year selection globally
    window.globalCurrentYear = parseInt(yearSelect.value)
    return window.globalCurrentYear
  }
  // Return stored global year or default to current year
  return window.globalCurrentYear || new Date().getFullYear()
}

window.getCurrentTerm = () => {
  const termSelect = document.getElementById('term-select')
  if (termSelect) {
    // Store the current term selection globally
    window.globalCurrentTerm = termSelect.value
    return window.globalCurrentTerm
  }
  // Return stored global term or default based on current month
  if (window.globalCurrentTerm) {
    return window.globalCurrentTerm
  }
  const currentMonth = new Date().getMonth() + 1
  return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring"
}

// Initialize router
const router = new SimpleRouter()

// Make it globally available
window.router = router
