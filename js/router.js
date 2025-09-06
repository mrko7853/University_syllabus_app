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
      '/search': '/index.html', // For now, search stays on dashboard
      '/settings': '/profile.html', // For now, settings goes to profile
      '/help': '/profile.html' // For now, help goes to profile
    }
    
    this.currentPath = window.location.pathname
    this.isInitialized = false
    this.componentCleanupFunctions = []
    
    // Load styles immediately
    this.addLockedPageStyles()
    
    // Create loading bar
    this.createLoadingBar()
    
    this.init()
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
      
      // Update the page content
      const mainContent = document.querySelector('#app-content') || document.querySelector('section') || document.body
      if (newContent && mainContent) {
        mainContent.innerHTML = newContent.innerHTML
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
    // Remove active class from all nav buttons
    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.remove('active')
    })
    
    // Add active class to current page button
    const activeButton = document.querySelector(`[data-route="${currentPath}"]`)
    if (activeButton) {
      activeButton.classList.add('active')
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
      // Re-import main.js to get fresh instances
      const mainModule = await import('/js/main.js?' + Date.now())
      
      // Call the initialization function
      if (mainModule.initializeDashboard) {
        mainModule.initializeDashboard()
      }
      
      // Initialize year/term selectors
      this.initializeYearTermSelectors()
      
      // Initialize course search and filtering
      this.initializeCourseSearch()
      
      // Initialize dashboard-specific components
      this.initializeDashboardComponents()
      
    } catch (error) {
      console.error('Error initializing dashboard:', error)
    }
  }

  async initializeCalendar() {
    try {
      // Re-import calendar.js to get fresh instances
      const calendarModule = await import('/js/calendar.js?' + Date.now())
      
      // Call the initialization function
      if (calendarModule.initializeCalendar) {
        calendarModule.initializeCalendar()
      }
      
      // Initialize calendar-specific functionality
      this.initializeCalendarComponents()
      
    } catch (error) {
      console.error('Error initializing calendar:', error)
    }
  }

  async initializeProfile() {
    try {
      // Re-import profile.js to get fresh instances  
      const profileModule = await import('/js/profile.js?' + Date.now())
      
      // Call the initialization function
      if (profileModule.initializeProfile) {
        await profileModule.initializeProfile()
      }
      
      // Initialize profile-specific functionality
      this.initializeProfileComponents()
      
    } catch (error) {
      console.error('Error initializing profile:', error)
    }
  }

  async initializeShared() {
    try {
      // Re-import shared.js to get fresh instances
      const sharedModule = await import('/js/shared.js?' + Date.now())
      
      // Initialize shared functionality
      this.initializeSharedComponents()
      
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

  initializeCalendarComponents() {
    // Calendar-specific initialization
  }

  initializeProfileComponents() {
    // Profile-specific initialization
  }

  initializeSharedComponents() {
    // Shared component initialization
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
      const { supabase } = await import('/supabase.js')
      const { data: { session } } = await supabase.auth.getSession()
      return !!session
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
    mainContent.innerHTML = `
      <div class="locked-page-container">
        <div class="locked-page-content">
          <div class="lock-icon">🔒</div>
          <h2 class="locked-title">Page Locked</h2>
          <p class="locked-message">Please log in to access the ${pageName} page.</p>
          <div class="locked-actions">
            <button class="login-btn" onclick="window.router.navigate('/login')">Log In</button>
            <button class="register-btn" onclick="window.router.navigate('/register')">Sign Up</button>
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
}

// Utility functions for components to use
window.getCurrentYear = () => {
  const yearSelect = document.getElementById('year-select')
  return yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear()
}

window.getCurrentTerm = () => {
  const termSelect = document.getElementById('term-select')
  return termSelect ? termSelect.value : (() => {
    const currentMonth = new Date().getMonth() + 1
    return currentMonth >= 8 || currentMonth <= 2 ? "秋学期/Fall" : "春学期/Spring"
  })()
}

// Initialize router
const router = new SimpleRouter()

// Make it globally available
window.router = router
