/**
 * Complete SPA Router - Handles full component lifecycle
 * Ensures all components work properly on every navigation
 */
import { getCurrentAppPath, stripBase, withBase } from './path-utils.js'

const IS_PRODUCTION = import.meta.env.PROD
const HOME_SLOT_PREFILTER_KEY = 'ila_home_slot_prefilter'
const HOME_SLOT_PREFILTER_MAX_AGE_MS = 10 * 60 * 1000

class SimpleRouter {
  constructor() {
    this.routes = {
      '/': '/index.html',
      '/home': '/index.html',
      '/courses': '/courses.html',
      '/dashboard': '/courses.html', // Legacy redirect
      '/calendar': '/calendar.html',
      '/assignments': '/assignments.html',
      '/profile': '/profile.html',
      '/login': '/login.html',
      '/register': '/register.html',
      '/settings': '/profile.html', // For now, settings goes to profile
      '/help': '/profile.html' // For now, help goes to profile
    }

    // Course URL pattern: /course/courseCode/year/term (also supports /courses alias)
    this.coursePattern = /^\/courses?\/([^\/]+)\/(\d{4})\/([^\/]+)$/

    this.currentPath = getCurrentAppPath()
    this.isInitialized = false
    this.componentCleanupFunctions = []

    // State persistence for courses page
    this.coursesPageState = {
      year: null,
      term: null,
      searchQuery: null,
      filters: null
    }

    // Page caching - keeps pages in DOM but hidden
    this.pageCache = new Map()
    this.pageCacheInitialized = new Map()
    this.sharedModulePromise = null
    this.mobileHeaderProfileBadgeCache = {
      userId: null,
      initials: '',
      fetchedAt: 0
    }

    // Initialize global year/term variables
    this.initializeGlobalYearTerm()

    // Load styles immediately
    this.addLockedPageStyles()

    // Create loading bar
    this.createLoadingBar()

    this.init()
  }

  initializeGlobalYearTerm() {
    if (window.globalCurrentYear && window.globalCurrentTerm) {
      return
    }

    // Set default global year/term values
    const currentMonth = new Date().getMonth() + 1
    window.globalCurrentYear = new Date().getFullYear()
    window.globalCurrentTerm = currentMonth >= 8 || currentMonth <= 2 ? "Fall" : "Spring"
  }

  init() {
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      this.loadPage(getCurrentAppPath())
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
    const currentPath = getCurrentAppPath()
    const basePath = this.extractBasePath(currentPath)
    const hasHomeMarkup = !!document.getElementById('home-main')
    const hasCoursesMarkup = !!document.getElementById('course-main-div')

    if (this.isHomeRoute(basePath) && hasHomeMarkup) {
      this.currentPath = '/'
      this.initializeCurrentPageOnly('/')
    } else if ((basePath === '/courses' || basePath === '/dashboard') && hasCoursesMarkup) {
      this.currentPath = '/courses'
      this.initializeCurrentPageOnly('/courses')
    } else {
      // For non-entrypoint pages loaded directly, clear the default content and load the correct page
      const appContent = document.querySelector('#app-content')
      if (appContent) {
        appContent.innerHTML = ''
      }

      if (basePath === '/dashboard') {
        this.loadPage('/courses')
      } else if (this.isHomeRoute(basePath)) {
        this.loadPage('/')
      } else {
        this.loadPage(basePath)
      }
    }

    this.isInitialized = true
  }

  shouldIntercept(link) {
    const href = String(link.getAttribute('href') || '').trim()
    if (!href) return false

    // Skip absolute/custom URL schemes (http, https, webcal, etc).
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      return false
    }

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

  // Check if currently on the courses page
  isOnCoursesPage() {
    return this.isCoursesRoute(this.currentPath)
  }

  isCoursesRoute(path) {
    return path === '/courses' || path === '/dashboard'
  }

  isHomeRoute(path) {
    return path === '/' || path === '' || path === '/home'
  }

  isMobileViewport() {
    return window.innerWidth <= 1023
  }

  isProfileRoute(path) {
    return path === '/profile' || path === '/settings' || path === '/help'
  }

  shouldRedirectGuestProfileRoute(path, isAuthenticated) {
    return this.isProfileRoute(path) && !isAuthenticated
  }

  getInitials(name, email = '') {
    const normalizedName = String(name || '').trim()
    if (normalizedName) {
      const parts = normalizedName.split(/\s+/).filter(Boolean)
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      }
      return parts[0].slice(0, 2).toUpperCase()
    }

    return String(email || '').split('@')[0].slice(0, 2).toUpperCase() || 'IL'
  }

  async getMobileHeaderProfileInitials() {
    try {
      let supabaseClient = null

      if (this.isProduction()) {
        supabaseClient = window.supabase || null
      } else {
        const { supabase } = await import('../supabase.js')
        supabaseClient = supabase
      }

      if (!supabaseClient) return ''

      const { data: { session } } = await supabaseClient.auth.getSession()
      const user = session?.user || null
      if (!user) return ''

      const cache = this.mobileHeaderProfileBadgeCache
      if (cache.userId === user.id && cache.initials && (Date.now() - cache.fetchedAt) < 60000) {
        return cache.initials
      }

      let displayName = ''
      try {
        const { data: profileRow } = await supabaseClient
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .single()

        displayName = String(profileRow?.display_name || '').trim()
      } catch (error) {
        console.warn('Router: failed to load profile display name for mobile header', error)
      }

      if (!displayName) {
        displayName = String(
          user.user_metadata?.display_name
          || user.user_metadata?.name
          || user.user_metadata?.full_name
          || user.email
          || ''
        ).trim()
      }

      const initials = this.getInitials(displayName, user.email || '')
      this.mobileHeaderProfileBadgeCache = {
        userId: user.id,
        initials,
        fetchedAt: Date.now()
      }
      return initials
    } catch (error) {
      console.error('Router: error resolving mobile header initials', error)
      return ''
    }
  }

  async hydrateMobileProfileButtonInitials() {
    const button = document.getElementById('profile-mobile')
    if (!button) return

    const initials = await this.getMobileHeaderProfileInitials()
    if (!button.isConnected) return

    if (!initials) {
      button.textContent = ''
      button.classList.remove('profile-mobile-initials')
      button.removeAttribute('data-initials')
      button.setAttribute('aria-label', 'Profile')
      return
    }

    button.textContent = initials
    button.classList.add('profile-mobile-initials')
    button.setAttribute('data-initials', initials)
    button.setAttribute('aria-label', `Profile (${initials})`)
  }

  async hydrateDesktopProfileNavInitials(isAuthenticated) {
    const profileNavButton = document.getElementById('profile')
    const profileNavIcon = profileNavButton?.querySelector('.nav-icon')
    if (!profileNavButton || !profileNavIcon) return

    if (!isAuthenticated) {
      profileNavButton.classList.remove('nav-btn--initials')
      profileNavIcon.textContent = ''
      profileNavIcon.removeAttribute('data-initials')
      profileNavButton.setAttribute('aria-label', 'Profile')
      return
    }

    const initials = await this.getMobileHeaderProfileInitials()
    if (!profileNavButton.isConnected || !profileNavIcon.isConnected) return

    if (!initials) {
      profileNavButton.classList.remove('nav-btn--initials')
      profileNavIcon.textContent = ''
      profileNavIcon.removeAttribute('data-initials')
      profileNavButton.setAttribute('aria-label', 'Profile')
      return
    }

    profileNavButton.classList.add('nav-btn--initials')
    profileNavIcon.textContent = initials
    profileNavIcon.setAttribute('data-initials', initials)
    profileNavButton.setAttribute('aria-label', `Profile (${initials})`)
  }

  async updateMobileGuestAuthHeader(isAuthenticated) {
    const appHeader = document.querySelector('.app-header')
    const appMisc = appHeader?.querySelector('.app-misc')
    if (!appMisc) return

    const profileButtonMarkup = `
      <button id="profile-mobile" type="button" data-route="/profile" aria-label="Profile"></button>
    `

    if (!this.isMobileViewport() || isAuthenticated) {
      appMisc.innerHTML = profileButtonMarkup
      if (isAuthenticated) {
        await this.hydrateMobileProfileButtonInitials()
      }
      return
    }

    appMisc.innerHTML = `
      <div class="mobile-guest-auth-actions">
        <button type="button" class="control-surface mobile-guest-auth-btn" data-route="/login">Log In</button>
        <button type="button" class="control-surface mobile-guest-auth-btn" data-route="/register">Sign Up</button>
      </div>
    `
  }

  navigate(path) {
    // Remove domain if full URL
    if (path.includes(window.location.origin)) {
      path = path.replace(window.location.origin, '')
    }

    const appPath = stripBase(path)
    const normalizedAppPath = (String(appPath || '/').split('?')[0].split('#')[0] || '/').replace(/\/+$/, '') || '/'

    if (this.coursePattern.test(normalizedAppPath)) {
      if (normalizedAppPath !== this.currentPath || !this.isInitialized) {
        window.history.pushState({}, '', withBase(normalizedAppPath))
        this.loadPage(normalizedAppPath)
      }
      return
    }

    // Handle route parameters (e.g., /profile/uuid)
    const cleanPath = this.extractBasePath(appPath)

    // Normalize path
    if (cleanPath === '' || cleanPath === '/' || cleanPath === '/home') {
      path = '/'
    } else if (cleanPath === '/dashboard') {
      path = '/courses' // Redirect legacy dashboard to courses
    } else {
      path = cleanPath
    }

    if (path !== this.currentPath || !this.isInitialized) {
      const canonicalHistoryPath = this.getCanonicalHistoryPath(path)
      window.history.pushState({}, '', withBase(canonicalHistoryPath))
      this.loadPage(path)
    }
  }

  getCanonicalHistoryPath(path) {
    const normalized = String(path || '/')

    // Keep a single canonical URL shape for top-level pages.
    // This avoids duplicate route forms like /dev/assignments and /dev/assignments/.
    const trailingSlashRoutes = new Set([
      '/courses',
      '/calendar',
      '/assignments',
      '/profile',
      '/login',
      '/register',
      '/settings',
      '/help'
    ])

    if (trailingSlashRoutes.has(normalized)) {
      return `${normalized}/`
    }

    return normalized
  }

  // Clean up existing components before loading new page
  cleanupCurrentPage() {
    this.cleanupCourseModalArtifacts()

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
    const components = document.querySelectorAll('total-courses, term-box, course-calendar, latest-courses-preview')
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

  cleanupCourseModalArtifacts() {
    const classInfoBackground = document.getElementById('class-info-background')
    if (classInfoBackground && classInfoBackground.parentNode) {
      classInfoBackground.parentNode.removeChild(classInfoBackground)
    }

    const classInfo = document.getElementById('class-info')
    if (classInfo) {
      if (typeof classInfo._focusTrapCleanup === 'function') {
        classInfo._focusTrapCleanup()
        classInfo._focusTrapCleanup = null
      }
      if (typeof classInfo._mobileTabsResizeCleanup === 'function') {
        classInfo._mobileTabsResizeCleanup()
        classInfo._mobileTabsResizeCleanup = null
      }
      if (typeof classInfo._courseInfoTabCleanup === 'function') {
        classInfo._courseInfoTabCleanup()
        classInfo._courseInfoTabCleanup = null
      }
      if (typeof classInfo._courseInfoSheetController?.destroy === 'function') {
        classInfo._courseInfoSheetController.destroy()
        classInfo._courseInfoSheetController = null
      }

      // When leaving course fullscreen routes, hide immediately to avoid slide-out animation.
      if (document.body.classList.contains('course-page-mode')) {
        classInfo.style.transition = 'none'
        classInfo.style.transform = 'none'
        classInfo.style.opacity = '0'
        classInfo.style.display = 'none'
      }

      classInfo.classList.remove('show', 'fully-open', 'swiping')
      classInfo.style.removeProperty('--modal-translate-y')
      classInfo.style.removeProperty('--sheet-y')
      classInfo.style.removeProperty('--sheet-radius')
      classInfo.classList.remove('is-snapping', 'is-dragging')
      delete classInfo.dataset.sheetState
    }

    document.body.style.overflow = ''
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    document.body.classList.remove('modal-open')
  }

  getRouteCacheKey(path) {
    return `route:${path}`
  }

  getCourseTemplateCacheKey() {
    return 'route:__course_template__'
  }

  getCachedRouteMarkup(path) {
    return this.pageCache.get(this.getRouteCacheKey(path)) || null
  }

  setCachedRouteMarkup(path, markup) {
    const key = this.getRouteCacheKey(path)
    this.pageCache.set(key, markup)
    this.pageCacheInitialized.set(key, true)
  }

  getCachedCourseTemplate() {
    return this.pageCache.get(this.getCourseTemplateCacheKey()) || null
  }

  setCachedCourseTemplate(markup) {
    const key = this.getCourseTemplateCacheKey()
    this.pageCache.set(key, markup)
    this.pageCacheInitialized.set(key, true)
  }

  async loadPage(path) {
    // Show loading bar
    this.showLoadingBar()

    // Prevent stale class-info overlay from persisting across routes
    this.cleanupCourseModalArtifacts()

    // Save courses page state before navigating away
    if (this.isOnCoursesPage()) {
      this.saveCoursesPageState()
    }

    // Check if this is a course URL first
    const courseMatch = path.match(this.coursePattern)
    if (courseMatch) {
      const [, courseCode, year, term] = courseMatch
      console.log('Course URL detected:', { courseCode, year, term })
      this.currentPath = path

      try {
        this.cleanupCurrentPage()

        let courseTemplateMarkup = this.getCachedCourseTemplate()

        if (!courseTemplateMarkup) {
          const response = await fetch(withBase('/course.html'))
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

          const html = await response.text()
          const parser = new DOMParser()
          const doc = parser.parseFromString(html, 'text/html')
          const coursePage = doc.querySelector('#course-page')

          if (coursePage) {
            courseTemplateMarkup = coursePage.outerHTML
            this.setCachedCourseTemplate(courseTemplateMarkup)
          } else {
            courseTemplateMarkup = ''
          }
        }

        let appContent = document.querySelector('#app-content')
        if (!appContent) {
          appContent = document.createElement('div')
          appContent.id = 'app-content'
          document.body.appendChild(appContent)
        }

        appContent.innerHTML = ''
        const courseAppContent = document.createElement('div')
        courseAppContent.id = 'course-app-content'
        courseAppContent.innerHTML = courseTemplateMarkup || ''

        appContent.appendChild(courseAppContent)

        document.body.classList.add('course-page-mode')
        this.updateActiveNav('')

        await this.initializeShared()

        const coursePageModule = await import('./course-page.js')
        if (coursePageModule && typeof coursePageModule.initializeCoursePage === 'function') {
          await coursePageModule.initializeCoursePage()
        }

        this.hideLoadingBar()
        return
      } catch (error) {
        console.error('Error loading course URL:', error)
        this.hideLoadingBar()
        return
      }
    }

    // Clear course page mode when leaving course URLs
    document.body.classList.remove('course-page-mode')

    // Extract base path for route matching
    const basePath = this.extractBasePath(path)
    this.currentPath = basePath

    // Check if user is authenticated for protected routes
    const isProtectedRoute = this.isProtectedRoute(basePath)
    const isAuthenticated = await this.checkAuthentication()
    await this.updateMobileGuestAuthHeader(isAuthenticated)
    await this.hydrateDesktopProfileNavInitials(isAuthenticated)

    if (this.shouldRedirectGuestProfileRoute(basePath, isAuthenticated)) {
      this.hideLoadingBar()
      this.navigate('/login')
      return
    }

    // Assignments remain gated for guests, but route to Profile instead of a hard lock page.
    if (basePath === '/assignments' && !isAuthenticated) {
      try {
        window.sessionStorage.setItem('ila_profile_auth_prompt', 'assignments')
      } catch (error) {
        console.warn('Router: unable to store assignments auth prompt context', error)
      }

      this.hideLoadingBar()
      this.navigate('/profile')
      return
    }

    // Get the HTML file for this route
    const htmlFile = this.routes[basePath]
    if (!htmlFile) {
      console.error('No route found for:', basePath)
      this.hideLoadingBar()
      return
    }

    try {
      // If protected route and user not authenticated, show locked message
      if (isProtectedRoute && !isAuthenticated) {
        this.showLockedPage(basePath)
        this.hideLoadingBar()
        return
      }

      // Update loading progress
      this.updateLoadingProgress(30)

      let appContent = document.querySelector('#app-content')
      if (!appContent) {
        appContent = document.createElement('div')
        appContent.id = 'app-content'
        document.body.appendChild(appContent)
      }

      const cachedMarkup = this.getCachedRouteMarkup(basePath)

      if (cachedMarkup) {
        appContent.innerHTML = cachedMarkup
        this.updateLoadingProgress(70)
        console.log(`Router: Using cached markup for ${basePath}`)
      } else {
        // Fetch the HTML content
        const response = await fetch(withBase(htmlFile))
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
        const pageMarkup = newContent ? newContent.innerHTML : ''
        appContent.innerHTML = pageMarkup
        this.setCachedRouteMarkup(basePath, pageMarkup)

        console.log('Router: Page content updated')
      }

      // Update loading progress
      this.updateLoadingProgress(80)

      // Update active navigation
      this.updateActiveNav(basePath)

      // Toggle guest vs authenticated home layout early to avoid signed-in widget flashes
      this.handleGuestDashboard(isAuthenticated, basePath)

      // Re-initialize everything for the new content
      await this.reinitializeEverything(basePath)

      // Update loading progress
      this.updateLoadingProgress(95)

      // Complete loading
      this.updateLoadingProgress(100)
      setTimeout(() => this.hideLoadingBar(), 200)

    } catch (error) {
      console.error('Error loading page:', error)
      this.hideLoadingBar()
    }
  }

  // Initialize current page without re-fetching HTML - used for initial load when HTML is already present
  async initializeCurrentPageOnly(path) {
    try {
      console.log('Router: Initializing current page only (no HTML fetch):', path)

      const appContent = document.querySelector('#app-content')
      if (appContent && !this.getCachedRouteMarkup(path)) {
        this.setCachedRouteMarkup(path, appContent.innerHTML)
      }

      // Check authentication status
      const isAuthenticated = await this.checkAuthentication()
      await this.updateMobileGuestAuthHeader(isAuthenticated)
      await this.hydrateDesktopProfileNavInitials(isAuthenticated)

      if (this.shouldRedirectGuestProfileRoute(path, isAuthenticated)) {
        this.navigate('/login')
        return
      }

      // Update active navigation
      this.updateActiveNav(path)

      // Toggle guest vs authenticated home layout early to avoid signed-in widget flashes
      this.handleGuestDashboard(isAuthenticated, path)

      // Re-initialize everything for the current content
      await this.reinitializeEverything(path)

      console.log('Router: Current page initialized successfully')

    } catch (error) {
      console.error('Error initializing current page:', error)
    }
  }

  updateActiveNav(currentPath) {
    const navPath = currentPath === '/settings' || currentPath === '/help'
      ? '/profile'
      : currentPath

    // Remove active class and add false class to all nav buttons
    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.remove('active')
      el.classList.add('false')
    })

    // Mark all matching route buttons active (e.g., sidebar + mobile header profile button).
    document.querySelectorAll(`[data-route="${navPath}"]`).forEach((activeButton) => {
      activeButton.classList.add('active')
      activeButton.classList.remove('false')
    })
  }

  async reinitializeEverything(path) {
    try {
      // Wait for DOM to be ready
      await new Promise(resolve => setTimeout(resolve, 10))

      // Re-import and reinitialize main.js functionality if on courses
      if (this.isCoursesRoute(path)) {
        await this.initializeDashboard()
      }

      // Re-import and reinitialize calendar.js functionality if on calendar
      if (path === '/calendar' || this.routes[path] === '/calendar.html') {
        await this.initializeCalendar()
      }

      // Re-import and reinitialize profile.js functionality if on profile
      if (path === '/profile' || this.routes[path] === '/profile.html') {
        await this.initializeProfile()
      }

      // Re-import and reinitialize assignments.js functionality if on assignments
      if (path === '/assignments' || this.routes[path] === '/assignments.html') {
        await this.initializeAssignments()
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
      // Check if we're actually on a dashboard/courses page
      const courseList = document.getElementById('course-list');
      const semesterSelect = document.getElementById('semester-select');

      if (!courseList && !semesterSelect) {
        console.log('Router: Not on dashboard page, skipping dashboard initialization');
        return;
      }

      // Check if we have saved state to restore.
      // Slot-intent navigation from home writes a pending prefilter payload that should
      // take precedence over old remembered courses-page state.
      const hasPendingHomeSlotPrefilter = this.hasPendingHomeSlotPrefilter()
      const hasSavedState = !hasPendingHomeSlotPrefilter && (this.coursesPageState.year || this.coursesPageState.term)

      // On multi-page entrypoints, main.js may not be loaded yet.
      // Always ensure we can initialize dashboard regardless of start page.
      let mainModule = null
      if (typeof window.initializeDashboard !== 'function') {
        try {
          mainModule = await import('./main.js')
        } catch (error) {
          console.error('Router: Failed to load main.js for dashboard init', error)
        }
      }

      if (typeof window.initializeDashboard === 'function') {
        await window.initializeDashboard()
      } else if (mainModule && typeof mainModule.initializeDashboard === 'function') {
        await mainModule.initializeDashboard()
      } else {
        console.error('Router: initializeDashboard is unavailable')
        return
      }

      // Initialize year/term selectors
      this.initializeYearTermSelectors()

      // Initialize course search and filtering
      this.initializeCourseSearch()

      // Initialize dashboard-specific components
      this.initializeDashboardComponents()

      // Set up global year/term tracking
      this.setupGlobalYearTermTracking()

      // Restore saved state AFTER initialization completes
      // This will override the defaults and reload courses with saved year/term
      if (hasSavedState) {
        // Give DOM time to settle, then restore state and reload courses
        setTimeout(() => this.restoreCoursesPageStateWithReload(), 150)
      }

      // Set up state persistence listeners
      this.setupCoursesPageStatePersistence()

    } catch (error) {
      console.error('Error initializing dashboard:', error)
    }
  }

  hasPendingHomeSlotPrefilter() {
    try {
      const raw = window.sessionStorage.getItem(HOME_SLOT_PREFILTER_KEY)
      if (!raw) return false

      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return false

      const createdAt = Number(parsed.createdAt || 0)
      if (createdAt && (Date.now() - createdAt) > HOME_SLOT_PREFILTER_MAX_AGE_MS) {
        return false
      }

      const day = String(parsed.day || '').trim()
      const term = String(parsed.term || '').trim()
      const year = Number(parsed.year)
      return Boolean(day && term && Number.isFinite(year))
    } catch (error) {
      console.warn('Router: unable to inspect home slot prefilter state', error)
      return false
    }
  }

  // Restore state and reload courses with the saved year/term
  async restoreCoursesPageStateWithReload() {
    console.log('Restoring courses page state with reload:', this.coursesPageState)

    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')

    let needsReload = false

    // Restore year
    if (this.coursesPageState.year && yearSelect && yearSelect.value !== this.coursesPageState.year) {
      yearSelect.value = this.coursesPageState.year
      needsReload = true
    }

    // Restore term
    if (this.coursesPageState.term && termSelect && termSelect.value !== this.coursesPageState.term) {
      termSelect.value = this.coursesPageState.term
      needsReload = true
    }

    // Update the custom semester dropdown to match
    if (this.coursesPageState.year && this.coursesPageState.term) {
      this.updateSemesterDropdown(this.coursesPageState.year, this.coursesPageState.term)
    }

    // If year/term changed, reload the courses
    if (needsReload) {
      console.log('Reloading courses with saved year/term:', this.coursesPageState.year, this.coursesPageState.term)

      // Use window.showCourse to reload courses with the correct year/term
      if (window.showCourse) {
        await window.showCourse(this.coursesPageState.year, this.coursesPageState.term)
      } else if (window.updateCoursesAndFilters) {
        // Fallback to updateCoursesAndFilters
        await window.updateCoursesAndFilters()
      }
    }

    // Course filters/search are intentionally not restored across navigations.
  }

  // Save courses page state before navigating away
  saveCoursesPageState() {
    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')

    this.coursesPageState = {
      year: yearSelect ? yearSelect.value : null,
      term: termSelect ? termSelect.value : null,
      searchQuery: null,
      filters: null
    }

    console.log('Saved courses page state:', this.coursesPageState)
  }

  // Restore courses page state when returning
  restoreCoursesPageState() {
    // Only restore if we have saved state
    if (!this.coursesPageState.year && !this.coursesPageState.term) {
      console.log('No saved courses page state to restore')
      return
    }

    console.log('Restoring courses page state:', this.coursesPageState)

    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')

    let needsRefresh = false

    // Restore year
    if (this.coursesPageState.year && yearSelect && yearSelect.value !== this.coursesPageState.year) {
      yearSelect.value = this.coursesPageState.year
      needsRefresh = true
    }

    // Restore term
    if (this.coursesPageState.term && termSelect && termSelect.value !== this.coursesPageState.term) {
      termSelect.value = this.coursesPageState.term
      needsRefresh = true
    }

    // Update the custom semester dropdown if it exists
    if (needsRefresh && this.coursesPageState.year && this.coursesPageState.term) {
      this.updateSemesterDropdown(this.coursesPageState.year, this.coursesPageState.term)
    }

    // Trigger refresh if year/term changed
    if (needsRefresh) {
      // Dispatch change events to trigger data refresh
      if (yearSelect) yearSelect.dispatchEvent(new Event('change', { bubbles: true }))
      if (termSelect) termSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }

    // Course filters/search are intentionally not restored across navigations.
  }

  // Get active filters from the filter menu
  getActiveFilters() {
    const filters = {
      types: [],
      days: [],
      periods: []
    }

    // Get type filters
    document.querySelectorAll('#filter-by-type input[type="checkbox"]:checked').forEach(cb => {
      filters.types.push(cb.value)
    })

    // Get day filters
    document.querySelectorAll('#filter-by-days input[type="checkbox"]:checked').forEach(cb => {
      filters.days.push(cb.value)
    })

    // Get period/time filters
    document.querySelectorAll('#filter-by-time input[type="checkbox"]:checked').forEach(cb => {
      filters.periods.push(cb.value)
    })

    // Only return if there are active filters
    if (filters.types.length > 0 || filters.days.length > 0 || filters.periods.length > 0) {
      return filters
    }

    return null
  }

  // Restore filters
  restoreFilters(filters) {
    if (!filters) return

    // Restore type filters
    if (filters.types && filters.types.length > 0) {
      document.querySelectorAll('#filter-by-type input[type="checkbox"]').forEach(cb => {
        cb.checked = filters.types.includes(cb.value)
      })
    }

    // Restore day filters
    if (filters.days && filters.days.length > 0) {
      document.querySelectorAll('#filter-by-days input[type="checkbox"]').forEach(cb => {
        cb.checked = filters.days.includes(cb.value)
      })
    }

    // Restore period/time filters
    if (filters.periods && filters.periods.length > 0) {
      document.querySelectorAll('#filter-by-time input[type="checkbox"]').forEach(cb => {
        cb.checked = filters.periods.includes(cb.value)
      })
    }

    // Apply filters
    if (window.applySearchAndFilters) {
      window.applySearchAndFilters(this.coursesPageState.searchQuery || '')
    }
  }

  // Set up listeners to persist state changes
  setupCoursesPageStatePersistence() {
    const yearSelect = document.getElementById('year-select')
    const termSelect = document.getElementById('term-select')

    // Listen for year/term changes
    const saveState = () => {
      this.saveCoursesPageState()
    }

    if (yearSelect) {
      yearSelect.addEventListener('change', saveState)
      this.componentCleanupFunctions.push(() => {
        yearSelect.removeEventListener('change', saveState)
      })
    }

    if (termSelect) {
      termSelect.addEventListener('change', saveState)
      this.componentCleanupFunctions.push(() => {
        termSelect.removeEventListener('change', saveState)
      })
    }

    // Course filters/search are intentionally transient and not persisted.
  }

  async initializeCalendar() {
    try {
      console.log('Router: Initializing calendar page...');

      const basePath = this.currentPath

      // calendar-page is defined in calendar-page-component.js and may be absent
      // when app starts from another entrypoint (e.g. assignments).
      await this.ensureCalendarComponentRegistered()

      // Calendar route relies on helper functions exposed by main.js.
      // If user lands from a non-dashboard entrypoint, those helpers may not be loaded yet.
      await this.ensureCalendarHelpersAvailable()

      // Wait for DOM to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if we have the required elements
      const semesterSelect = document.getElementById('semester-select');
      const courseListPlaceholder = document.getElementById('course-list');

      console.log('Router: Found elements:', {
        semesterSelect: !!semesterSelect,
        courseListPlaceholder: !!courseListPlaceholder
      });

      // Populate semester dropdown - MUST happen first
      console.log('Router: Calling populateSemesterDropdown...');
      if (window.populateSemesterDropdown) {
        await window.populateSemesterDropdown();
        console.log('Router: Semester dropdown populated');
      } else {
        console.warn('Router: populateSemesterDropdown not available');
      }

      // Initialize custom selects - MUST happen after dropdown population
      console.log('Router: Calling initializeCustomSelects...');
      if (window.initializeCustomSelects) {
        window.initializeCustomSelects();
        console.log('Router: Custom selects initialized');
      } else {
        console.warn('Router: initializeCustomSelects not available');
      }

      // Attach semester change listener for calendar page
      console.log('Router: Attaching semester change listener...');
      const semesterSelects = document.querySelectorAll('.semester-select');
      semesterSelects.forEach(semesterSelect => {
        if (semesterSelect.dataset.calendarListenerAttached !== 'true') {
          semesterSelect.addEventListener('change', async (e) => {
            console.log('🔔 CALENDAR SEMESTER CHANGE EVENT FIRED');
            console.log('  → Select value:', e.target.value);

            // Parse the semester value
            const parsedValue = this.parseSemesterValueSafe(e.target.value);
            console.log('  → Parsed value:', parsedValue);

            if (!parsedValue || !parsedValue.term || !parsedValue.year) {
              console.error('  ❌ Failed to parse semester value');
              return;
            }

            const { term, year } = parsedValue;
            const yearInt = parseInt(year);

            console.log('  → Updating hidden inputs to:', yearInt, term);

            // Update hidden inputs
            const termSelect = document.getElementById('term-select');
            const yearSelect = document.getElementById('year-select');

            if (termSelect) {
              termSelect.value = term;
              console.log('  → term-select updated to:', termSelect.value);
            }
            if (yearSelect) {
              yearSelect.value = yearInt;
              console.log('  → year-select updated to:', yearSelect.value);
            }

            // Update calendar FIRST (so it doesn't interrupt search update)
            const calendarComponent = document.querySelector('calendar-page');
            if (calendarComponent && calendarComponent.showCourseWithRetry) {
              console.log('  → Refreshing calendar with:', yearInt, term);
              try {
                await calendarComponent.showCourseWithRetry(yearInt, term);
                console.log('  → Calendar refreshed successfully');
              } catch (error) {
                console.error('  ❌ Calendar refresh error:', error);
              }
            } else {
              console.error('  ❌ Calendar component not found');
            }

            // Update search courses AFTER calendar (ensures clean update)
            console.log('  → Updating search courses...');
            console.log('  → window.getAllCourses exists?', !!window.getAllCourses);
            console.log('  → typeof window.getAllCourses:', typeof window.getAllCourses);

            if (window.getAllCourses) {
              try {
                console.log('  → About to call getAllCourses()');
                const result = await window.getAllCourses();
                console.log('  → getAllCourses() returned:', result);
                console.log('  → Search courses updated successfully');
              } catch (error) {
                console.error('  ❌ Search courses update error:', error);
              }
            } else {
              console.error('  ❌ getAllCourses function not available');
            }

            console.log('  ✅ Semester change completed');
          });
          semesterSelect.dataset.calendarListenerAttached = 'true';
          console.log('Router: Semester change listener attached to', semesterSelect.id);
        }
      });

      // Initialize search functionality
      console.log('Router: Calling initializeSearch...');
      if (window.initializeSearch) {
        window.initializeSearch();
        console.log('Router: Search initialized');
      } else {
        console.warn('Router: initializeSearch not available');
      }

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

  async ensureCalendarComponentRegistered() {
    if (customElements.get('calendar-page')) {
      return
    }

    try {
      await import('./calendar-page-component.js')
    } catch (error) {
      console.error('Router: Failed to load calendar-page component module', error)
    }
  }

  async ensureCalendarHelpersAvailable() {
    const requiredHelpers = [
      'populateSemesterDropdown',
      'initializeCustomSelects',
      'initializeSearch',
      'parseSemesterValue',
      'getAllCourses'
    ]

    const missingBeforeImport = requiredHelpers.filter(
      (name) => typeof window[name] !== 'function'
    )

    if (missingBeforeImport.length === 0) {
      return
    }

    try {
      await import('./main.js')
    } catch (error) {
      console.error('Router: Failed to load calendar helper module from main.js', error)
    }

    const missingAfterImport = requiredHelpers.filter(
      (name) => typeof window[name] !== 'function'
    )

    if (missingAfterImport.length > 0) {
      console.warn('Router: Calendar helpers still unavailable:', missingAfterImport.join(', '))
    }
  }

  parseSemesterValueSafe(value) {
    if (typeof window.parseSemesterValue === 'function') {
      return window.parseSemesterValue(value)
    }

    if (!value || value === '' || value === 'Loading...') {
      return { term: null, year: null }
    }

    const parts = String(value).split('-')
    if (parts.length === 2) {
      return { term: parts[0], year: parts[1] }
    }

    return { term: null, year: null }
  }

  async initializeProfile() {
    try {
      let profileModule = null

      if (typeof window.initializeProfile !== 'function') {
        profileModule = await import('./profile.js')
      }

      if (typeof window.initializeProfile === 'function') {
        await window.initializeProfile()
      } else if (profileModule && typeof profileModule.initializeProfile === 'function') {
        await profileModule.initializeProfile()
      } else {
        console.error('Router: initializeProfile is unavailable')
        return
      }

      // Initialize profile-specific functionality
      this.initializeProfileComponents()

      // Set up global year/term tracking (needed for navigation to work)
      this.setupGlobalYearTermTracking()

    } catch (error) {
      console.error('Error initializing profile:', error)
    }
  }

  async initializeAssignments() {
    try {
      console.log('Router: Initializing assignments page...');

      // Always dynamically import the assignments module to ensure it loads
      // This is necessary because the assignments chunk may not be loaded yet
      const assignmentsModule = await import('./assignments.js');

      if (assignmentsModule.initializeAssignments) {
        await assignmentsModule.initializeAssignments();
      } else if (window.initializeAssignments) {
        // Fallback to window global if available
        await window.initializeAssignments();
      }

      console.log('Router: Assignments page initialized');
    } catch (error) {
      console.error('Error initializing assignments:', error);
    }
  }

  async initializeShared() {
    try {
      if (!this.sharedModulePromise) {
        this.sharedModulePromise = import('./shared.js')
      }
      await this.sharedModulePromise
      this.initializeSharedComponents()

      // Set up global year/term tracking for all pages as fallback
      this.setupGlobalYearTermTracking()

    } catch (error) {
      console.error('Error initializing shared:', error)
    }
  }

  initializeYearTermSelectors() {
    // Combined semester selector functionality
    const semesterSelect = document.getElementById('semester-select')

    if (semesterSelect) {
      // Set up event listener for semester changes
      const handleSelectChange = () => {
        this.refreshAllComponents()
      }

      semesterSelect.addEventListener('change', handleSelectChange)

      this.componentCleanupFunctions.push(() => {
        semesterSelect.removeEventListener('change', handleSelectChange)
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
    const components = document.querySelectorAll('total-courses, term-box, course-calendar, latest-courses-preview')
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
    const rawPath = String(path || '/').split('?')[0].split('#')[0] || '/'
    const normalizedPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath

    // Preserve course detail deep-links so they can be handled by the dedicated course route loader.
    if (this.coursePattern && this.coursePattern.test(normalizedPath)) {
      return normalizedPath
    }

    // Handle routes with parameters like /profile/uuid
    if (normalizedPath.startsWith('/profile/')) {
      return '/profile'
    }
    if (normalizedPath.startsWith('/courses/')) {
      return '/courses'
    }
    if (normalizedPath === '/dashboard' || normalizedPath.startsWith('/dashboard/')) {
      return '/courses' // Redirect legacy dashboard paths
    }
    if (normalizedPath.startsWith('/calendar/')) {
      return '/calendar'
    }
    if (normalizedPath.startsWith('/settings/')) {
      return '/settings'
    }
    if (normalizedPath === '/home' || normalizedPath === '/home/' || normalizedPath.startsWith('/home/')) {
      return '/'
    }
    if (normalizedPath === '/index' || normalizedPath === '/index/' || normalizedPath.startsWith('/index/')) {
      return '/'
    }

    // Return the path as-is for routes without parameters
    return normalizedPath
  }

  // Check if a route requires authentication
  isProtectedRoute(path) {
    const protectedRoutes = ['/calendar', '/assignments']
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
    document.body.classList.remove('guest-dashboard')

    const mainContent = document.querySelector('#app-content') || document.querySelector('section') || document.body
    if (!mainContent) return

    // Get page name for display
    const pageNames = {
      '/': 'Home',
      '/home': 'Home',
      '/profile': 'Profile',
      '/calendar': 'Calendar',
      '/assignments': 'Assignments',
      '/courses': 'Courses',
      '/dashboard': 'Courses',
      '/settings': 'Settings',
      '/help': 'Help'
    }
    const pageName = pageNames[path] || 'Page'

    // Update title
    document.title = `${pageName} - ILA Companion`

    // Show locked message
    mainContent.innerHTML = `
      <div class="locked-page-container">
        <div class="locked-page-content">
          <div class="lock-icon"></div>
          <h2 class="locked-title">Page Locked</h2>
          <p class="locked-message">Please log in to access the ${pageName} page.</p>
          <div class="locked-actions">
            <button class="login-btn" onclick="window.router.navigate('/login')">Sign in</button>
            <button class="register-btn" onclick="window.router.navigate('/register')">Create account</button>
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

  // Handle guest user home layout modifications
  handleGuestDashboard(isAuthenticated, path = this.currentPath) {
    const pageWrapper = document.body
    if (!pageWrapper) return

    const topContent = document.querySelector('#home-main .top-content')
    if (topContent) {
      topContent.style.display = ''
    }

    // Remove any legacy class placement on #app-content.
    const appContent = document.querySelector('#app-content')
    if (appContent) {
      appContent.classList.remove('guest-dashboard')
    }

    const normalizedPath = this.extractBasePath(path || this.currentPath)
    const isHomeRoute = this.isHomeRoute(normalizedPath)

    if (!isHomeRoute) {
      pageWrapper.classList.remove('guest-dashboard')
      return
    }

    pageWrapper.classList.toggle('guest-dashboard', !isAuthenticated)
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

    // Navigate to courses page if not already there
    if (!this.isCoursesRoute(this.currentPath)) {
      await this.navigate('/courses')

      // Wait for courses page to load completely
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
    // Update the combined semester dropdown
    this.updateSemesterDropdown(year, term)
  }

  // Update combined semester dropdown
  updateSemesterDropdown(year, term) {
    const semesterValue = `${term}-${year}`
    const semesterLabel = `${term} ${year}`

    // Update semester custom dropdown
    const semesterCustomSelect = document.querySelector('.custom-select[data-target="semester-select"]')
    if (semesterCustomSelect) {
      const valueElement = semesterCustomSelect.querySelector('.custom-select-value')
      const semesterOptions = semesterCustomSelect.querySelectorAll('.custom-select-option')

      // Remove existing selection
      semesterOptions.forEach(option => option.classList.remove('selected'))

      // Find and select the correct option
      const targetOption = Array.from(semesterOptions).find(option => option.dataset.value === semesterValue)
      if (targetOption) {
        targetOption.classList.add('selected')
        if (valueElement) {
          valueElement.textContent = targetOption.textContent
        }
      }
    }

    // Update hidden semester select
    const semesterSelect = document.getElementById('semester-select')
    if (semesterSelect) {
      semesterSelect.value = semesterValue
    }

    // Update hidden term and year inputs
    const termSelect = document.getElementById('term-select')
    const yearSelect = document.getElementById('year-select')
    if (termSelect) termSelect.value = term
    if (yearSelect) yearSelect.value = year
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
    let normalized = title.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (char) {
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
    return IS_PRODUCTION
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
