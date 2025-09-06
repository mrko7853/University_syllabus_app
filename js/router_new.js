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
      '/search': '/index.html',
      '/settings': '/profile.html',
      '/help': '/profile.html'
    }
    
    this.currentPath = window.location.pathname
    this.isInitialized = false
    this.componentCleanupFunctions = []
    this.init()
  }

  init() {
    window.addEventListener('popstate', (e) => {
      this.loadPage(window.location.pathname)
    })

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]')
      if (link && this.shouldIntercept(link)) {
        e.preventDefault()
        this.navigate(link.href)
      }
    })

    document.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-route]')
      if (button) {
        e.preventDefault()
        this.navigate(button.dataset.route)
      }
    })

    const currentPath = window.location.pathname
    const basePath = this.extractBasePath(currentPath)
    
    if (basePath === '/' || basePath === '') {
      this.navigate('/dashboard')
    } else {
      this.loadPage(currentPath)
    }
    
    this.isInitialized = true
  }

  shouldIntercept(link) {
    const href = link.getAttribute('href')
    
    if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return false
    }
    
    if (link.target === '_blank') {
      return false
    }
    
    return true
  }

  navigate(path) {
    if (path.includes(window.location.origin)) {
      path = path.replace(window.location.origin, '')
    }
    
    const cleanPath = this.extractBasePath(path)
    
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

  cleanupCurrentPage() {
    this.componentCleanupFunctions.forEach(cleanup => {
      try {
        cleanup()
      } catch (error) {
        console.error('Error during component cleanup:', error)
      }
    })
    this.componentCleanupFunctions = []

    const components = document.querySelectorAll('total-courses, term-box, course-calendar')
    components.forEach(component => {
      if (component.disconnectedCallback) {
        component.disconnectedCallback()
      }
    })

    if (window.refreshInterval) {
      clearInterval(window.refreshInterval)
      window.refreshInterval = null
    }

    const oldSelects = document.querySelectorAll('#year-select, #term-select')
    oldSelects.forEach(select => {
      const newSelect = select.cloneNode(true)
      select.parentNode.replaceChild(newSelect, select)
    })
  }

  async loadPage(path) {
    const basePath = this.extractBasePath(path)
    this.currentPath = basePath
    
    const isProtectedRoute = this.isProtectedRoute(basePath)
    const isAuthenticated = await this.checkAuthentication()
    
    const htmlFile = this.routes[basePath]
    if (!htmlFile) {
      console.error('No route found for:', basePath)
      return
    }

    try {
      this.cleanupCurrentPage()
      
      if (isProtectedRoute && !isAuthenticated) {
        this.showLockedPage(basePath)
        return
      }
      
      const response = await fetch(htmlFile)
      if (!response.ok) {
        throw new Error(`Failed to load ${htmlFile}`)
      }
      
      const html = await response.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const newContent = doc.querySelector('#app-content') || doc.querySelector('section') || doc.body
      const mainContent = document.querySelector('#app-content') || document.querySelector('section') || document.body
      
      if (newContent && mainContent) {
        mainContent.innerHTML = newContent.innerHTML
      }
      
      if (doc.title) {
        document.title = doc.title
      }
      
      this.updateActiveNav(basePath)
      await this.reinitializeEverything(basePath)
      
    } catch (error) {
      console.error('Error loading page:', error)
    }
  }

  updateActiveNav(currentPath) {
    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.remove('active')
    })
    
    const activeButton = document.querySelector(`[data-route="${currentPath}"]`)
    if (activeButton) {
      activeButton.classList.add('active')
    }
  }

  async reinitializeEverything(path) {
    try {
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const isAuthenticated = await this.checkAuthentication()
      
      if (path === '/dashboard' || path === '/' || this.routes[path] === '/index.html') {
        await this.initializeDashboard()
        this.handleGuestDashboard(isAuthenticated)
      }
      
      if (path === '/calendar' || this.routes[path] === '/calendar.html') {
        await this.initializeCalendar()
      }
      
      if (path === '/profile' || this.routes[path] === '/profile.html') {
        await this.initializeProfile()
      }

      await this.initializeShared()
      this.forceComponentReinitialization()
      
      document.dispatchEvent(new CustomEvent('pageLoaded', { 
        detail: { path: path } 
      }))
      
    } catch (error) {
      console.error('Error reinitializing page:', error)
    }
  }

  async initializeDashboard() {
    try {
      await import('/js/main.js?' + Date.now())
      this.initializeYearTermSelectors()
      this.initializeCourseSearch()
    } catch (error) {
      console.error('Error initializing dashboard:', error)
    }
  }

  async initializeCalendar() {
    try {
      await import('/js/calendar.js?' + Date.now())
    } catch (error) {
      console.error('Error initializing calendar:', error)
    }
  }

  async initializeProfile() {
    try {
      await import('/js/profile.js?' + Date.now())
    } catch (error) {
      console.error('Error initializing profile:', error)
    }
  }

  async initializeShared() {
    try {
      await import('/js/shared.js?' + Date.now())
    } catch (error) {
      console.error('Error initializing shared:', error)
    }
  }

  initializeYearTermSelectors() {
    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')
    
    if (yearSelect && termSelect) {
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
    const searchInput = document.getElementById('search-course')
    if (searchInput) {
      const handleSearch = (e) => {
        console.log('Search triggered:', e.target.value)
      }
      
      searchInput.addEventListener('input', handleSearch)
      
      this.componentCleanupFunctions.push(() => {
        searchInput.removeEventListener('input', handleSearch)
      })
    }
  }

  forceComponentReinitialization() {
    const components = document.querySelectorAll('total-courses, term-box, course-calendar')
    components.forEach(component => {
      if (component.connectedCallback) {
        component.connectedCallback()
      }
    })
  }

  refreshAllComponents() {
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

  extractBasePath(path) {
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
    
    return path
  }

  isProtectedRoute(path) {
    const protectedRoutes = ['/profile', '/calendar', '/settings']
    return protectedRoutes.includes(path)
  }

  async checkAuthentication() {
    try {
      const { supabase } = await import('/supabase.js')
      const { data: { session } } = await supabase.auth.getSession()
      return !!session
    } catch (error) {
      console.error('Error checking authentication:', error)
      return false
    }
  }

  showLockedPage(path) {
    const mainContent = document.querySelector('#app-content') || document.querySelector('section') || document.body
    if (!mainContent) return

    const pageNames = {
      '/profile': 'Profile',
      '/calendar': 'Calendar',
      '/dashboard': 'Dashboard',
      '/settings': 'Settings',
      '/help': 'Help'
    }
    const pageName = pageNames[path] || 'Page'

    document.title = `${pageName} - BlazeArchive`

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

    this.updateActiveNav(path)
    this.addLockedPageStyles()
  }

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

      .guest-dashboard .top-content {
        display: none !important;
      }
    `
    document.head.appendChild(styles)
  }

  handleGuestDashboard(isAuthenticated) {
    const mainContent = document.querySelector('#app-content')
    if (!mainContent) return

    if (!isAuthenticated) {
      mainContent.classList.add('guest-dashboard')
    } else {
      mainContent.classList.remove('guest-dashboard')
    }
  }
}

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

const router = new SimpleRouter()
window.router = router
