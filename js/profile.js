import { supabase } from "../supabase.js";
import { fetchAvailableSemesters } from "./shared.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
import { clearFieldError, clearFieldErrors, initializeGlobalFieldErrorUI, setFieldError } from "./field-errors.js";
import {
  PREFERENCE_KEYS,
  DEFAULT_PREFERENCES,
  applyPreferencesToDocument,
  applyPreferredTermToGlobals,
  inferCurrentSemesterValue,
  getPreferredTermValue,
  getStoredPreferences,
  parseTermValue,
  resolvePreferredTermForAvailableSemesters,
  setPreferredTermValue,
  setStoredPreference,
  clearStoredPreferences,
  normalizeTermValue
} from "./preferences.js";
import {
  SETUP_CONCENTRATION_OPTIONS,
  SETUP_PREFER_NOT_TO_ANSWER,
  SETUP_YEAR_OPTIONS,
  mapConcentrationSelectionToPayload,
  mapYearSelectionToPayload,
  normalizeSetupProfile
} from "./setup-status.js";
import APP_META from "./app-meta.js";

const PROFILE_ROUTES = new Set(["/profile", "/settings", "/help"]);
const AUTH_PROMPT_KEY = "ila_profile_auth_prompt";
const AUTH_LOGOUT_TOAST_KEY = "ila_auth_logout_toast";
const AUTH_CALLBACK_RETURN_KEY = "ila_auth_callback_return_intent";
const AUTH_EXPECTED_OAUTH_EMAIL_KEY = "ila_auth_expected_oauth_email";
const AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY = "ila_auth_pending_oauth_link_provider";
const AUTH_PENDING_OAUTH_LINK_PROVIDER_MAX_AGE_MS = 15 * 60 * 1000;
const AUTH_EXPECTED_OAUTH_EMAIL_MAX_AGE_MS = 15 * 60 * 1000;
const PROFILE_TOAST_QUEUE_KEY = "ila_profile_toast_queue";
const PROFILE_MODAL_LAYER_ID = "profile-modal-layer";
const PROFILE_HEADER_BACK_BUTTON_ID = "profile-header-back-btn";
const CONNECTABLE_OAUTH_PROVIDERS = ["google", "azure"];
const PROFILE_SECTION_CONFIG = [
  { id: "profile-identity", label: "Account", iconClass: "profile-section-icon--identity" },
  { id: "profile-academic", label: "Academic", iconClass: "profile-section-icon--academic" },
  { id: "profile-reviews", label: "My Reviews", iconClass: "profile-section-icon--reviews" },
  { id: "profile-preferences", label: "Preferences", iconClass: "profile-section-icon--preferences" },
  { id: "profile-data-privacy", label: "Data & Privacy", iconClass: "profile-section-icon--privacy" },
  { id: "profile-auth", label: "Sign Out", iconClass: "profile-section-icon--signout" }
];
const PROFILE_SETTINGS_SECTION_PATH_BY_ID = {
  "profile-identity": "/settings/account",
  "profile-academic": "/settings/academic",
  "profile-reviews": "/settings/reviews",
  "profile-preferences": "/settings/preferences",
  "profile-data-privacy": "/settings/privacy",
  "profile-auth": "/settings/sign-out"
};
const PROFILE_SETTINGS_SECTION_ID_BY_PATH = Object.fromEntries(
  Object.entries(PROFILE_SETTINGS_SECTION_PATH_BY_ID).map(([sectionId, path]) => [path, sectionId])
);
let profileCustomSelectDocumentHandler = null;
let profileHeaderScrollCleanup = null;
let profileSectionResizeHandler = null;
let profileSectionEnterAnimationTimer = null;

const state = {
  isAuthenticated: false,
  session: null,
  user: null,
  profile: null,
  studentReviews: [],
  settings: null,
  semesters: [],
  mobileSectionView: "list",
  activeSectionId: "profile-identity",
  userSettingsTableAvailable: true,
  profileProgramYearColumnsAvailable: true,
  profileSetupColumnsAvailable: true
};

initializeGlobalFieldErrorUI();

function getRoot() {
  return document.getElementById("profile-main");
}

function normalizeProfileRoutePath(path = "/") {
  const raw = String(path || "/").trim();
  if (!raw) return "/";
  const noHash = raw.split("#")[0];
  const noQuery = noHash.split("?")[0];
  const withLeadingSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  return withLeadingSlash.length > 1 ? (withLeadingSlash.replace(/\/+$/, "") || "/") : withLeadingSlash;
}

function getCurrentProfileRoutePath() {
  return normalizeProfileRoutePath(getCurrentAppPath());
}

function getProfileRouteBase(path = getCurrentProfileRoutePath()) {
  const route = normalizeProfileRoutePath(path);
  if (route.startsWith("/settings/")) return "/settings";
  if (route.startsWith("/profile/")) return "/profile";
  if (route.startsWith("/help/")) return "/help";
  return PROFILE_ROUTES.has(route) ? route : "/profile";
}

function resolveProfileSectionIdFromRoutePath(path = getCurrentProfileRoutePath()) {
  const normalizedPath = normalizeProfileRoutePath(path);
  const settingsSectionId = PROFILE_SETTINGS_SECTION_ID_BY_PATH[normalizedPath];
  if (settingsSectionId) {
    return resolveProfileSectionId(settingsSectionId);
  }

  return "";
}

function getSettingsSectionRoutePath(sectionId) {
  const resolvedSectionId = resolveProfileSectionId(sectionId);
  return PROFILE_SETTINGS_SECTION_PATH_BY_ID[resolvedSectionId] || "/settings/account";
}

function syncProfileSectionRoute(sectionId, { replace = false } = {}) {
  const nextPath = getSettingsSectionRoutePath(sectionId);
  const currentPath = getCurrentProfileRoutePath();
  if (currentPath === nextPath || currentPath === `${nextPath}/`) {
    return;
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", withBase(`${nextPath}/`));
}

function isProfileContextPath(path = "/") {
  return PROFILE_ROUTES.has(getProfileRouteBase(path));
}

function isMobileViewport() {
  return window.innerWidth <= 1023;
}

function getProfileSectionsInDom() {
  return PROFILE_SECTION_CONFIG.filter(({ id }) => Boolean(document.getElementById(id)));
}

function getDefaultProfileSectionId() {
  return getProfileSectionsInDom()[0]?.id || PROFILE_SECTION_CONFIG[0].id;
}

function resolveProfileSectionId(sectionId) {
  const sections = getProfileSectionsInDom();
  if (sections.length === 0) return PROFILE_SECTION_CONFIG[0].id;
  const requested = String(sectionId || "").trim();
  const match = sections.find((section) => section.id === requested);
  return match ? match.id : sections[0].id;
}

function setActiveProfileSection(sectionId) {
  const resolvedSectionId = resolveProfileSectionId(sectionId);
  state.activeSectionId = resolvedSectionId;

  document.querySelectorAll("[data-profile-section-target]").forEach((node) => {
    const target = node.getAttribute("data-profile-section-target");
    node.classList.toggle("is-active", target === resolvedSectionId);
    if (target === resolvedSectionId) {
      node.setAttribute("aria-current", "true");
    } else {
      node.removeAttribute("aria-current");
    }
  });
}

function ensureProfileHeaderBackButton() {
  const headerBrand = document.querySelector(".app-header .app-header-brand");
  if (!headerBrand) return null;

  let button = headerBrand.querySelector(`#${PROFILE_HEADER_BACK_BUTTON_ID}`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.id = PROFILE_HEADER_BACK_BUTTON_ID;
    button.className = "ui-btn ui-btn--icon control-surface control-surface--secondary profile-header-back-btn";
    button.setAttribute("aria-label", "Back to profile sections");
    button.innerHTML = '<span class="profile-header-back-btn-icon" aria-hidden="true"></span>';
    button.addEventListener("click", () => {
      state.mobileSectionView = "list";
      applyProfileSectionState({ scrollToTop: true });
    });
  }

  const titleNode = headerBrand.querySelector(".app-mobile-page-title");
  if (titleNode && button.parentElement !== headerBrand) {
    headerBrand.insertBefore(button, titleNode);
  }

  return button;
}

function removeProfileHeaderBackButton() {
  const button = document.getElementById(PROFILE_HEADER_BACK_BUTTON_ID);
  button?.remove();
}

function updateProfileHeaderBackButton() {
  const button = ensureProfileHeaderBackButton();
  if (!button) return;
  const shouldShow = isMobileViewport() && state.mobileSectionView === "detail";
  button.hidden = !shouldShow;
  button.classList.toggle("is-visible", shouldShow);
  button.style.display = shouldShow ? "inline-flex" : "none";
}

function applyProfileSectionState({ scrollToTop = false } = {}) {
  const root = getRoot();
  if (!root) return;

  const sectionContainer = document.getElementById("profile-sections-content");
  const isMobile = isMobileViewport();
  const resolvedSectionId = resolveProfileSectionId(state.activeSectionId);
  const showDetail = !isMobile || state.mobileSectionView === "detail";

  root.classList.toggle("profile-mobile-list", isMobile && !showDetail);
  root.classList.toggle("profile-mobile-detail", isMobile && showDetail);

  if (sectionContainer) {
    sectionContainer.hidden = isMobile && !showDetail;
  }

  getProfileSectionsInDom().forEach(({ id }) => {
    const sectionNode = document.getElementById(id);
    if (!sectionNode) return;
    if (!showDetail) {
      sectionNode.hidden = true;
      return;
    }
    sectionNode.hidden = id !== resolvedSectionId;
  });

  setActiveProfileSection(resolvedSectionId);
  updateProfileHeaderBackButton();

  if (profileSectionEnterAnimationTimer) {
    window.clearTimeout(profileSectionEnterAnimationTimer);
    profileSectionEnterAnimationTimer = null;
  }

  const reducedMotion = document.body.classList.contains("reduced-motion")
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const activeSectionNode = showDetail ? document.getElementById(resolvedSectionId) : null;
  if (activeSectionNode && !reducedMotion) {
    activeSectionNode.classList.remove("profile-section-enter");
    // Restart animation each time the active section changes.
    void activeSectionNode.offsetWidth;
    activeSectionNode.classList.add("profile-section-enter");
    profileSectionEnterAnimationTimer = window.setTimeout(() => {
      activeSectionNode.classList.remove("profile-section-enter");
      profileSectionEnterAnimationTimer = null;
    }, 260);
  }

  if (scrollToTop) {
    const appContent = document.getElementById("app-content");
    appContent?.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

function renderProfileSectionNavigation() {
  const sections = getProfileSectionsInDom();
  const sidebarNav = document.getElementById("profile-sidebar-nav");
  const mobileNav = document.getElementById("profile-mobile-sections");

  if (sidebarNav) {
    sidebarNav.innerHTML = sections
      .map(
        (section) => `
          <button
            type="button"
            class="profile-sidebar-link ui-btn ui-btn--secondary control-surface control-surface--secondary"
            data-profile-section-link="desktop"
            data-profile-section-target="${escapeHtml(section.id)}"
            aria-controls="${escapeHtml(section.id)}"
          >
            <span class="profile-section-icon ${escapeHtml(section.iconClass)}" aria-hidden="true"></span>
            <span>${escapeHtml(section.label)}</span>
          </button>
        `
      )
      .join("");
  }

  if (mobileNav) {
    mobileNav.innerHTML = `
      <div class="profile-mobile-sections-list">
        ${sections
          .map(
            (section) => `
              <button
                type="button"
                class="profile-mobile-section-row"
                data-profile-section-link="mobile"
                data-profile-section-target="${escapeHtml(section.id)}"
                aria-controls="${escapeHtml(section.id)}"
                aria-label="${escapeHtml(section.label)}"
              >
                <span class="profile-mobile-section-row-left">
                  <span class="profile-section-icon ${escapeHtml(section.iconClass)}" aria-hidden="true"></span>
                  <span class="profile-mobile-section-label">${escapeHtml(section.label)}</span>
                </span>
                <span class="profile-mobile-section-chevron" aria-hidden="true">›</span>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }
}

function bindProfileSectionNavigationActions() {
  document.querySelectorAll("[data-profile-section-link='desktop']").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-profile-section-target");
      if (!target) return;
      state.activeSectionId = resolveProfileSectionId(target);
      syncProfileSectionRoute(state.activeSectionId);
      applyProfileSectionState({ scrollToTop: true });
    });
  });

  document.querySelectorAll("[data-profile-section-link='mobile']").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-profile-section-target");
      if (!target) return;
      state.mobileSectionView = "detail";
      state.activeSectionId = resolveProfileSectionId(target);
      syncProfileSectionRoute(state.activeSectionId);
      applyProfileSectionState({ scrollToTop: true });
    });
  });
}

function initializeProfileSectionNavigation(routePath = getCurrentProfileRoutePath()) {
  const routeBase = getProfileRouteBase(routePath);
  const routeSectionId = resolveProfileSectionIdFromRoutePath(routePath);
  const mobileViewport = isMobileViewport();

  renderProfileSectionNavigation();
  bindProfileSectionNavigationActions();

  if (!state.activeSectionId) {
    state.activeSectionId = getDefaultProfileSectionId();
  }

  if (routeSectionId) {
    state.activeSectionId = routeSectionId;
  } else if (routeBase === "/settings") {
    state.activeSectionId = resolveProfileSectionId("profile-preferences");
  } else if (routeBase === "/profile") {
    state.activeSectionId = resolveProfileSectionId("profile-identity");
  } else {
    state.activeSectionId = resolveProfileSectionId(state.activeSectionId);
  }

  if (mobileViewport) {
    if (routeSectionId) {
      state.mobileSectionView = "detail";
    } else if (state.mobileSectionView !== "detail") {
      state.mobileSectionView = "list";
    }
  }

  applyProfileSectionState();
  if (!mobileViewport && routeBase === "/settings" && !routeSectionId) {
    syncProfileSectionRoute(state.activeSectionId, { replace: true });
  }

  if (profileSectionResizeHandler) {
    window.removeEventListener("resize", profileSectionResizeHandler);
  }

  profileSectionResizeHandler = () => {
    applyProfileSectionState();
  };

  window.addEventListener("resize", profileSectionResizeHandler);
}

function teardownProfileSectionNavigation() {
  if (profileSectionResizeHandler) {
    window.removeEventListener("resize", profileSectionResizeHandler);
    profileSectionResizeHandler = null;
  }

  if (profileSectionEnterAnimationTimer) {
    window.clearTimeout(profileSectionEnterAnimationTimer);
    profileSectionEnterAnimationTimer = null;
  }

  removeProfileHeaderBackButton();

  const root = getRoot();
  if (root) {
    root.classList.remove("profile-mobile-list", "profile-mobile-detail");
  }

  const sectionContainer = document.getElementById("profile-sections-content");
  if (sectionContainer) {
    sectionContainer.hidden = false;
  }

  getProfileSectionsInDom().forEach(({ id }) => {
    const sectionNode = document.getElementById(id);
    if (sectionNode) {
      sectionNode.hidden = false;
    }
  });
}

function teardownProfileMobileHeaderBehavior() {
  if (typeof profileHeaderScrollCleanup === "function") {
    profileHeaderScrollCleanup();
    profileHeaderScrollCleanup = null;
  }
}

function initializeProfileMobileHeaderBehavior() {
  teardownProfileMobileHeaderBehavior();

  const header = document.querySelector(".app-header");
  const appContent = document.getElementById("app-content");
  const profileMain = document.getElementById("profile-main");
  if (!header) return;

  if (!isMobileViewport()) {
    header.classList.remove("app-header--hidden");
    document.body.classList.remove("profile-page-header-sticky");
    document.documentElement.style.removeProperty("--profile-mobile-header-height");
    return;
  }

  document.body.classList.add("profile-page-header-sticky");

  const setHeaderHeight = () => {
    const height = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--profile-mobile-header-height", `${height}px`);
  };

  const getCurrentScrollY = () => {
    const windowScrollY = window.scrollY || window.pageYOffset || 0;
    const rootScrollY = document.documentElement?.scrollTop || 0;
    const bodyScrollY = document.body?.scrollTop || 0;
    const docScrollY = document.scrollingElement?.scrollTop || 0;
    const contentScrollY = appContent ? appContent.scrollTop : 0;
    const mainScrollY = profileMain ? profileMain.scrollTop : 0;
    return Math.max(windowScrollY, rootScrollY, bodyScrollY, docScrollY, contentScrollY, mainScrollY);
  };

  let lastScrollY = getCurrentScrollY();
  let ticking = false;
  const scrollThreshold = 6;
  const topRevealThreshold = 8;

  const applyScrollState = () => {
    ticking = false;

    const currentScrollY = getCurrentScrollY();
    if (currentScrollY <= topRevealThreshold) {
      header.classList.remove("app-header--hidden");
      lastScrollY = currentScrollY;
      return;
    }

    const deltaY = currentScrollY - lastScrollY;
    if (Math.abs(deltaY) <= scrollThreshold) return;

    if (deltaY > 0) {
      header.classList.add("app-header--hidden");
    } else {
      header.classList.remove("app-header--hidden");
    }

    lastScrollY = currentScrollY;
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyScrollState);
  };

  const onResize = () => {
    if (!isMobileViewport()) {
      teardownProfileMobileHeaderBehavior();
      return;
    }
    setHeaderHeight();
  };

  setHeaderHeight();
  header.classList.remove("app-header--hidden");

  window.addEventListener("scroll", onScroll, { passive: true });
  appContent?.addEventListener("scroll", onScroll, { passive: true });
  profileMain?.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onResize);

  profileHeaderScrollCleanup = () => {
    window.removeEventListener("scroll", onScroll);
    appContent?.removeEventListener("scroll", onScroll);
    profileMain?.removeEventListener("scroll", onScroll);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    header.classList.remove("app-header--hidden");
    document.body.classList.remove("profile-page-header-sticky");
    document.documentElement.style.removeProperty("--profile-mobile-header-height");
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function navigateTo(path) {
  if (window.router?.navigate) {
    window.router.navigate(path);
    return;
  }
  window.location.href = withBase(path);
}

function queueLogoutSuccessToast(message = "Logged out successfully.") {
  try {
    window.sessionStorage.setItem(AUTH_LOGOUT_TOAST_KEY, String(message || "Logged out successfully."));
  } catch (_) { }
}

function isMissingRelationError(error, token) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();

  return (
    code === "42P01" ||
    message.includes("schema cache") ||
    (message.includes(String(token || "").toLowerCase()) &&
      (message.includes("does not exist") || message.includes("could not find") || message.includes("relation")))
  );
}

function isMissingColumnError(error, token) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();

  return code === "42703" || (message.includes("column") && message.includes(String(token || "").toLowerCase()));
}

function getInferredCurrentTerm() {
  const { term, year } = inferCurrentSemesterValue();
  return `${term}-${year}`;
}

function buildFallbackSemesters() {
  const inferred = parseTermValue(getInferredCurrentTerm());
  if (!inferred.value) {
    const fallbackYear = new Date().getFullYear();
    return [{ term: "Fall", year: fallbackYear, label: `Fall ${fallbackYear}` }];
  }

  return [{ term: inferred.term, year: inferred.year, label: `${inferred.term} ${inferred.year}` }];
}

function buildInitialSettings() {
  const stored = getStoredPreferences();
  const preferredTerm = getPreferredTermValue() || getInferredCurrentTerm();

  return {
    language: stored.language,
    timeFormat: stored.timeFormat,
    weekStart: stored.weekStart,
    fullCardColors: stored.fullCardColors,
    reduceMotion: stored.reduceMotion,
    currentTerm: normalizeTermValue(preferredTerm) || null
  };
}

function syncSettingsToLocalStorage(settings) {
  if (!settings) return;

  setStoredPreference(PREFERENCE_KEYS.language, settings.language);
  setStoredPreference(PREFERENCE_KEYS.timeFormat, settings.timeFormat);
  setStoredPreference(PREFERENCE_KEYS.weekStart, settings.weekStart);
  setStoredPreference(PREFERENCE_KEYS.fullCardColors, settings.fullCardColors);
  setStoredPreference(PREFERENCE_KEYS.reduceMotion, settings.reduceMotion);

  if (settings.currentTerm) {
    setPreferredTermValue(settings.currentTerm);
  }
}

function propagateSelectedTerm(termValue) {
  const parsed = parseTermValue(termValue);
  if (!parsed.value) return;

  setPreferredTermValue(parsed.value);
  applyPreferredTermToGlobals(parsed.value);

  const hiddenTerm = document.getElementById("term-select");
  const hiddenYear = document.getElementById("year-select");
  if (hiddenTerm) hiddenTerm.value = parsed.term;
  if (hiddenYear) hiddenYear.value = String(parsed.year);

  if (window.router?.coursesPageState) {
    window.router.coursesPageState.term = parsed.term;
    window.router.coursesPageState.year = String(parsed.year);
  }
}

async function fetchSemestersSafe() {
  try {
    const semesters = await fetchAvailableSemesters();
    if (Array.isArray(semesters) && semesters.length > 0) {
      return semesters;
    }
  } catch (error) {
    console.warn("Profile: failed to fetch semesters, using fallback", error);
  }

  return buildFallbackSemesters();
}

async function refreshUserIdentities(user = state.user) {
  if (!user?.id || typeof supabase.auth.getUserIdentities !== "function") {
    return Array.isArray(user?.identities) ? user.identities : [];
  }

  try {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error) throw error;

    const identities = Array.isArray(data?.identities) ? data.identities : [];
    state.user = {
      ...(state.user || {}),
      identities
    };
    return identities;
  } catch (error) {
    console.warn("Profile: failed to refresh user identities", error);
    return Array.isArray(state.user?.identities) ? state.user.identities : [];
  }
}

function resolveTermValueForSelection(termValue, semesters) {
  const normalized = normalizeTermValue(termValue);
  const options = Array.isArray(semesters) ? semesters : [];
  const optionValues = options.map((semester) => `${semester.term}-${semester.year}`);
  const resolvedDefault = resolvePreferredTermForAvailableSemesters(optionValues);

  if (resolvedDefault && options.some((semester) => `${semester.term}-${semester.year}` === resolvedDefault)) {
    return resolvedDefault;
  }

  if (normalized && options.some((semester) => `${semester.term}-${semester.year}` === normalized)) {
    return normalized;
  }

  const preferred = getPreferredTermValue();
  if (preferred && options.some((semester) => `${semester.term}-${semester.year}` === preferred)) {
    return preferred;
  }

  if (options.length > 0) {
    return `${options[0].term}-${options[0].year}`;
  }

  return normalized || null;
}

async function fetchProfileSafe(user) {
  if (!user?.id) return null;

  const setupColumns = "id, display_name, avatar_url, current_year, concentration, year_opt_out, concentration_opt_out, setup_completed_at, setup_version";
  const setupWithLegacyColumns = `${setupColumns}, program, year`;
  const legacyColumns = "id, display_name, avatar_url, program, year";
  const fallbackColumns = "id, display_name, avatar_url";

  if (state.profileSetupColumnsAvailable) {
    const preferredColumns = state.profileProgramYearColumnsAvailable ? setupWithLegacyColumns : setupColumns;

    const { data, error } = await supabase
      .from("profiles")
      .select(preferredColumns)
      .eq("id", user.id)
      .maybeSingle();

    if (!error) {
      return normalizeSetupProfile({
        ...(data || {}),
        program: data?.program ?? null,
        year: data?.year ?? null
      });
    }

    const missingSetupColumn = ["current_year", "concentration", "year_opt_out", "concentration_opt_out", "setup_completed_at", "setup_version"]
      .some((column) => isMissingColumnError(error, column));

    if (missingSetupColumn) {
      state.profileSetupColumnsAvailable = false;
    } else if (isMissingColumnError(error, "program") || isMissingColumnError(error, "year")) {
      state.profileProgramYearColumnsAvailable = false;
      return fetchProfileSafe(user);
    } else {
      throw error;
    }
  }

  if (state.profileProgramYearColumnsAvailable) {
    const { data, error } = await supabase
      .from("profiles")
      .select(legacyColumns)
      .eq("id", user.id)
      .maybeSingle();

    if (!error) {
      return {
        ...data,
        current_year: null,
        concentration: null,
        year_opt_out: false,
        concentration_opt_out: false,
        setup_completed_at: null,
        setup_version: 0
      };
    }

    if (!isMissingColumnError(error, "program") && !isMissingColumnError(error, "year")) {
      throw error;
    }

    state.profileProgramYearColumnsAvailable = false;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(fallbackColumns)
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    ...data,
    current_year: null,
    concentration: null,
    year_opt_out: false,
    concentration_opt_out: false,
    setup_completed_at: null,
    setup_version: 0,
    program: null,
    year: null
  };
}

function mapSettingsRow(row) {
  if (!row) return null;

  return {
    currentTerm: normalizeTermValue(row.current_term),
    language: row.language || DEFAULT_PREFERENCES.language,
    timeFormat: row.time_format || DEFAULT_PREFERENCES.timeFormat,
    weekStart: row.week_start || DEFAULT_PREFERENCES.weekStart,
    fullCardColors: row.full_card_colors !== false,
    reduceMotion: Boolean(row.reduce_motion)
  };
}

async function fetchUserSettingsSafe(userId) {
  if (!state.userSettingsTableAvailable || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("user_settings")
    .select("current_term, language, time_format, week_start, full_card_colors, reduce_motion")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error, "user_settings")) {
      state.userSettingsTableAvailable = false;
      return null;
    }
    throw error;
  }

  return mapSettingsRow(data);
}

function mergeSettings(base, incoming, semesters) {
  const merged = {
    ...base,
    ...(incoming || {})
  };

  merged.currentTerm = resolveTermValueForSelection(merged.currentTerm, semesters);
  merged.language = "en";
  merged.timeFormat = String(merged.timeFormat || "12") === "24" ? "24" : "12";
  merged.weekStart = String(merged.weekStart || "mon").toLowerCase() === "sun" ? "sun" : "mon";
  merged.fullCardColors = merged.fullCardColors !== false;
  merged.reduceMotion = Boolean(merged.reduceMotion);

  return merged;
}

function getProfileDisplayName(profile, user) {
  return (
    profile?.display_name ||
    user?.user_metadata?.display_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "Student"
  );
}

function getInitials(name, email) {
  const trimmed = String(name || "").trim();
  if (trimmed) {
    const pieces = trimmed.split(/\s+/).filter(Boolean);
    if (pieces.length >= 2) {
      return `${pieces[0][0]}${pieces[1][0]}`.toUpperCase();
    }
    return pieces[0].slice(0, 2).toUpperCase();
  }

  return String(email || "").split("@")[0].slice(0, 2).toUpperCase() || "IL";
}

function normalizeOptionValue(value, options) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return options.includes(normalized) ? normalized : "";
}

function getSetupYearLabel(profile) {
  if (!state.profileSetupColumnsAvailable) {
    const legacyYear = profile?.year ? String(profile.year).trim() : "";
    return legacyYear ? `Year ${legacyYear}` : "Not Set";
  }

  if (profile?.year_opt_out) return SETUP_PREFER_NOT_TO_ANSWER;
  const selected = normalizeOptionValue(profile?.current_year, SETUP_YEAR_OPTIONS);
  return selected || "Not Set";
}

function getSetupConcentrationLabel(profile) {
  if (!state.profileSetupColumnsAvailable) {
    const legacyProgram = String(profile?.program || "").trim();
    return legacyProgram || "Not Set";
  }

  if (profile?.concentration_opt_out) return SETUP_PREFER_NOT_TO_ANSWER;
  const selected = normalizeOptionValue(profile?.concentration, SETUP_CONCENTRATION_OPTIONS);
  return selected || "Not Set";
}

function isSetupFieldCompleted(profile, field) {
  if (!profile) return false;
  if (!state.profileSetupColumnsAvailable) {
    if (field === "year") return Boolean(profile?.year);
    if (field === "concentration") return Boolean(String(profile?.program || "").trim());
    return false;
  }

  if (field === "year") {
    return Boolean(String(profile?.current_year || "").trim()) || Boolean(profile?.year_opt_out);
  }
  if (field === "concentration") {
    return Boolean(String(profile?.concentration || "").trim()) || Boolean(profile?.concentration_opt_out);
  }
  return false;
}

function consumeGuestPrompt(route) {
  if (getProfileRouteBase(route) === "/settings") {
    return "Sign in to access settings and sync your preferences.";
  }

  const prompt = sessionStorage.getItem(AUTH_PROMPT_KEY);
  if (prompt) {
    sessionStorage.removeItem(AUTH_PROMPT_KEY);
  }

  if (prompt === "assignments") {
    return "Assignments require an account. Sign in to create and manage assignments.";
  }

  return "";
}

function getTermLabel(termValue) {
  const normalized = normalizeTermValue(termValue);
  if (!normalized) return "Choose term";

  const match = state.semesters.find((semester) => `${semester.term}-${semester.year}` === normalized);
  if (match) return match.label || `${match.term} ${match.year}`;

  const parsed = parseTermValue(normalized);
  if (!parsed.value) return "Choose term";
  return `${parsed.term} ${parsed.year}`;
}

function getLanguageLabel(value) {
  return "English";
}

function getTimeFormatLabel(value) {
  return String(value || "12") === "24" ? "24-hour" : "12-hour";
}

function normalizeReviewTerm(termValue) {
  const normalized = String(termValue || "").trim();
  if (!normalized) return "";
  const termOnly = normalized.includes("/") ? normalized.split("/").pop() : normalized;
  const lower = String(termOnly || "").trim().toLowerCase();
  if (lower.startsWith("fall")) return "Fall";
  if (lower.startsWith("spring")) return "Spring";
  if (lower.startsWith("summer")) return "Summer";
  if (lower.startsWith("winter")) return "Winter";
  return String(termOnly || "").trim();
}

function buildReviewLookupKey(courseCode, academicYear, term) {
  const normalizedCode = String(courseCode || "").trim().toUpperCase();
  const yearNumber = Number(academicYear);
  const normalizedYear = Number.isFinite(yearNumber)
    ? String(yearNumber)
    : String(academicYear || "").trim();
  const normalizedTerm = normalizeReviewTerm(term).toLowerCase();
  return `${normalizedCode}|${normalizedYear}|${normalizedTerm}`;
}

function normalizeReviewRatingValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.round(parsed);
  return rounded >= 1 && rounded <= 5 ? rounded : 0;
}

function getReviewQualityRating(review) {
  return normalizeReviewRatingValue(review?.quality_rating ?? review?.rating);
}

function getReviewDifficultyRating(review) {
  return normalizeReviewRatingValue(review?.difficulty_rating ?? review?.rating);
}

function getProfileReviewTermLabel(review) {
  const term = normalizeReviewTerm(review?.term);
  const yearNumber = Number(review?.academic_year);
  const yearLabel = Number.isFinite(yearNumber) ? String(yearNumber) : String(review?.academic_year || "").trim();
  return [term, yearLabel].filter(Boolean).join(" ");
}

function formatProfileReviewDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getProfileReviewExcerpt(contentValue) {
  const normalized = String(contentValue || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No written review provided.";
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177).trimEnd()}...`;
}

async function fetchStudentReviewsSafe(userId) {
  if (!userId) return [];

  try {
    const { data: reviewsData, error: reviewsError } = await supabase
      .from("course_reviews")
      .select("id, course_code, academic_year, term, rating, quality_rating, difficulty_rating, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (reviewsError) {
      if (isMissingRelationError(reviewsError, "course_reviews")) {
        return [];
      }
      throw reviewsError;
    }

    const reviews = Array.isArray(reviewsData) ? reviewsData : [];
    if (reviews.length === 0) return [];

    const uniqueCourseCodes = Array.from(
      new Set(
        reviews
          .map((review) => String(review?.course_code || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );

    let courseRows = [];
    if (uniqueCourseCodes.length > 0) {
      const { data: coursesData, error: coursesError } = await supabase
        .from("courses")
        .select("course_code, academic_year, term, title")
        .in("course_code", uniqueCourseCodes);

      if (coursesError) {
        if (!isMissingRelationError(coursesError, "courses")) {
          console.warn("Profile: failed to fetch course titles for reviews", coursesError);
        }
      } else {
        courseRows = Array.isArray(coursesData) ? coursesData : [];
      }
    }

    const courseTitleByKey = new Map();
    const courseTitleByCode = new Map();

    courseRows.forEach((course) => {
      const code = String(course?.course_code || "").trim().toUpperCase();
      const title = String(course?.title || "").trim();
      if (!code || !title) return;

      if (!courseTitleByCode.has(code)) {
        courseTitleByCode.set(code, title);
      }

      const key = buildReviewLookupKey(code, course?.academic_year, course?.term);
      if (!courseTitleByKey.has(key)) {
        courseTitleByKey.set(key, title);
      }
    });

    return reviews.map((review) => {
      const code = String(review?.course_code || "").trim().toUpperCase();
      const titleByExactMatch = courseTitleByKey.get(
        buildReviewLookupKey(code, review?.academic_year, review?.term)
      );
      const resolvedTitle = titleByExactMatch || courseTitleByCode.get(code) || code || "Course";
      return {
        ...review,
        course_title: resolvedTitle
      };
    });
  } catch (error) {
    console.error("Profile: failed to load student reviews", error);
    return [];
  }
}

function renderStudentReviewsBody() {
  const reviews = Array.isArray(state.studentReviews) ? state.studentReviews : [];
  const totalReviews = reviews.length;

  if (totalReviews === 0) {
    return `
      <p class="profile-inline-notice">You haven't written any reviews yet. Your submitted reviews will appear here.</p>
    `;
  }

  const rowsMarkup = reviews
    .map((review) => {
      const reviewId = String(review?.id || "").trim();
      const courseCode = String(review?.course_code || "").trim().toUpperCase();
      const courseTitle = String(review?.course_title || courseCode || "Course");
      const qualityRating = getReviewQualityRating(review);
      const difficultyRating = getReviewDifficultyRating(review);
      const detailParts = [];
      const termLabel = getProfileReviewTermLabel(review);
      const createdAtLabel = formatProfileReviewDate(review?.created_at);
      if (termLabel) detailParts.push(termLabel);
      if (qualityRating) detailParts.push(`Quality ${qualityRating}/5`);
      if (difficultyRating) detailParts.push(`Difficulty ${difficultyRating}/5`);
      if (createdAtLabel) detailParts.push(createdAtLabel);
      const detailLabel = detailParts.join(" · ");
      const editAriaLabel = `Edit review for ${courseTitle}`;

      return `
        <article class="setting-row setting-row--student-review">
          <div class="setting-meta profile-student-review-meta">
            <div class="profile-student-review-header">
              <h4 class="setting-title profile-student-review-title">${escapeHtml(courseTitle)}</h4>
              <button
                type="button"
                class="ui-btn ui-btn--icon filter-btn control-surface control-surface--secondary profile-action-pill"
                data-action="edit-student-review"
                data-review-id="${escapeHtml(reviewId)}"
                aria-label="${escapeHtml(editAriaLabel)}"
              >
                <span class="pill-icon pill-icon--edit" aria-hidden="true"></span>
                <span>Edit</span>
              </button>
            </div>
            ${detailLabel ? `<p class="setting-desc profile-student-review-context">${escapeHtml(detailLabel)}</p>` : ""}
            <p class="profile-student-review-excerpt">${escapeHtml(getProfileReviewExcerpt(review?.content))}</p>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <div class="profile-student-reviews-list">
      ${rowsMarkup}
    </div>
  `;
}

function openStudentReviewEditor(reviewId) {
  const normalizedReviewId = String(reviewId || "").trim();
  if (!normalizedReviewId) return;

  const reviews = Array.isArray(state.studentReviews) ? state.studentReviews : [];
  const review = reviews.find((entry) => String(entry?.id || "").trim() === normalizedReviewId);
  if (!review) {
    showProfileToast("Could not open this review right now.", "error");
    return;
  }

  if (typeof window.openEditReviewModal !== "function") {
    showProfileToast("Review editor is unavailable right now.", "error");
    return;
  }

  const academicYearNumber = Number(review?.academic_year);
  const academicYear = Number.isFinite(academicYearNumber) ? academicYearNumber : null;
  window.openEditReviewModal(
    review.id,
    String(review.course_code || "").trim().toUpperCase(),
    normalizeReviewTerm(review.term) || String(review.term || "").trim(),
    getReviewQualityRating(review),
    getReviewDifficultyRating(review),
    String(review.content || ""),
    academicYear,
    String(review.course_title || review.course_code || "Course")
  );
}

function canUserManagePassword(user = state.user) {
  const provider = String(user?.app_metadata?.provider || "").toLowerCase();
  if (provider === "email") return true;

  const appProviders = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers.map((item) => String(item || "").toLowerCase())
    : [];
  if (appProviders.includes("email")) return true;

  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.some((identity) => String(identity?.provider || "").toLowerCase() === "email");
}

function countConnectedSignInMethods(user = state.user) {
  let total = 0;
  if (canUserManagePassword(user)) {
    total += 1;
  }

  const providers = getConnectedIdentityProviders(user);
  const oauthConnected = new Set();
  providers.forEach(({ provider, identity }) => {
    const normalized = normalizeIdentityProvider(provider);
    if (!isOAuthIdentityProvider(normalized)) return;
    if (!identity) return;
    oauthConnected.add(normalized);
  });

  total += oauthConnected.size;
  return total;
}

function normalizeIdentityProvider(provider) {
  return String(provider || "").trim().toLowerCase();
}

function getIdentityProviderLabel(provider) {
  const normalized = normalizeIdentityProvider(provider);
  if (!normalized) return "Unknown";

  const labels = {
    email: "Email & Password",
    google: "Google",
    azure: "Outlook",
    apple: "Apple",
    github: "GitHub",
    gitlab: "GitLab",
    discord: "Discord",
    facebook: "Facebook",
    linkedin: "LinkedIn",
    twitter: "X",
    bitbucket: "Bitbucket"
  };

  if (labels[normalized]) return labels[normalized];
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isOAuthIdentityProvider(provider) {
  const normalized = normalizeIdentityProvider(provider);
  return Boolean(normalized) && normalized !== "email" && normalized !== "phone" && normalized !== "anonymous";
}

function isOAuthEmailMismatchMessage(message) {
  const normalized = String(message || "").toLowerCase();
  const hasEmailMismatch = normalized.includes("email")
    && (
      normalized.includes("mismatch")
      || normalized.includes("different")
      || normalized.includes("does not match")
      || normalized.includes("must match")
    );
  const alreadyLinkedElsewhere = normalized.includes("identity already exists")
    || normalized.includes("already linked")
    || normalized.includes("already associated");
  return hasEmailMismatch || alreadyLinkedElsewhere;
}

function getOAuthRedirectTo(returnPath = "", provider = "") {
  const callbackUrl = new URL(`${window.location.origin}${withBase("/auth/callback/")}`);
  const normalizedReturnPath = String(returnPath || "").trim();
  if (normalizedReturnPath) {
    callbackUrl.searchParams.set("next", normalizedReturnPath);
    callbackUrl.searchParams.set("auth_intent", "profile-oauth-link");
  }
  const normalizedProvider = normalizeIdentityProvider(provider);
  if (normalizedProvider) {
    callbackUrl.searchParams.set("link_provider", normalizedProvider);
  }
  return callbackUrl.toString();
}

function getOAuthLinkOptions(provider, returnPath = "") {
  const options = {
    redirectTo: getOAuthRedirectTo(returnPath, provider)
  };

  if (normalizeIdentityProvider(provider) === "azure") {
    options.scopes = "email";
  }

  return options;
}

function setAuthCallbackReturnIntent(path) {
  const payload = {
    path: String(path || "").trim() || "/profile",
    source: "profile-oauth-link",
    createdAt: Date.now()
  };

  try {
    const serialized = JSON.stringify(payload);
    window.sessionStorage.setItem(AUTH_CALLBACK_RETURN_KEY, serialized);
    window.localStorage.setItem(AUTH_CALLBACK_RETURN_KEY, serialized);
    const expectedEmail = String(state.user?.email || "").trim().toLowerCase();
    if (expectedEmail) {
      const expectedPayload = JSON.stringify({
        email: expectedEmail,
        createdAt: Date.now(),
        source: "profile-oauth-link"
      });
      window.sessionStorage.setItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY, expectedPayload);
      window.localStorage.setItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY, expectedPayload);
    }
  } catch (_) { }
}

function clearAuthCallbackReturnIntent() {
  try {
    window.sessionStorage.removeItem(AUTH_CALLBACK_RETURN_KEY);
    window.localStorage.removeItem(AUTH_CALLBACK_RETURN_KEY);
    window.sessionStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
    window.localStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
    window.sessionStorage.removeItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY);
    window.localStorage.removeItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY);
  } catch (_) { }
}

function getConnectedIdentityProviders(user = state.user) {
  const byProvider = new Map();
  const identities = Array.isArray(user?.identities) ? user.identities : [];

  identities.forEach((identity) => {
    const provider = normalizeIdentityProvider(identity?.provider);
    if (!provider || byProvider.has(provider)) return;
    byProvider.set(provider, { provider, identity });
  });

  const appProviders = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  appProviders.forEach((providerValue) => {
    const provider = normalizeIdentityProvider(providerValue);
    if (!provider || byProvider.has(provider)) return;
    byProvider.set(provider, { provider, identity: null });
  });

  const primaryProvider = normalizeIdentityProvider(user?.app_metadata?.provider);
  if (primaryProvider && !byProvider.has(primaryProvider)) {
    byProvider.set(primaryProvider, { provider: primaryProvider, identity: null });
  }

  return Array.from(byProvider.values());
}

function renderConnectedProvidersMarkup(user = state.user) {
  const providers = getConnectedIdentityProviders(user);
  const providerByName = new Map(
    providers.map((entry) => [normalizeIdentityProvider(entry.provider), entry])
  );
  const hasEmailMethod = canUserManagePassword(user);

  CONNECTABLE_OAUTH_PROVIDERS.forEach((provider) => {
    if (!providerByName.has(provider)) {
      providerByName.set(provider, { provider, identity: null });
    }
  });

  const orderedProviders = [];
  if (hasEmailMethod) {
    orderedProviders.push(providerByName.get("email") || { provider: "email", identity: null });
  } else if (providerByName.has("email")) {
    providerByName.delete("email");
  }

  CONNECTABLE_OAUTH_PROVIDERS.forEach((provider) => {
    const entry = providerByName.get(provider);
    if (entry) orderedProviders.push(entry);
  });

  providerByName.forEach((entry, provider) => {
    if (provider === "email") return;
    if (CONNECTABLE_OAUTH_PROVIDERS.includes(provider)) return;
    orderedProviders.push(entry);
  });

  if (!orderedProviders.length) {
    return `<p class="profile-body-copy">No connected sign-in methods found.</p>`;
  }

  const totalConnected = countConnectedSignInMethods(user);

  const rows = orderedProviders
    .map(({ provider, identity }) => {
      const label = getIdentityProviderLabel(provider);
      const isOAuth = isOAuthIdentityProvider(provider);
      const isConnected = provider === "email" ? hasEmailMethod : Boolean(identity);
      const canDisconnect = isOAuth && isConnected && totalConnected > 1;

      const description = provider === "email"
        ? "Use your email and password to sign in"
        : isConnected
          ? "OAuth sign-in connection"
          : "Not connected yet";

      let controlMarkup = '<span class="ui-pill status-pill status-pill--signed-in">Connected</span>';
      if (isOAuth) {
        if (isConnected) {
          controlMarkup = `<button class="ui-btn ui-btn--secondary control-surface" type="button" data-action="disconnect-oauth-provider" data-provider="${escapeHtml(provider)}"${canDisconnect ? "" : " disabled"}>Disconnect</button>`;
        } else {
          controlMarkup = `<button class="ui-btn ui-btn--secondary control-surface" type="button" data-action="connect-oauth-provider" data-provider="${escapeHtml(provider)}">Connect</button>`;
        }
      }

      return settingRow(label, description, controlMarkup, "setting-row--auth-connection");
    })
    .join("");

  const note = totalConnected > 1
    ? ""
    : '<p class="profile-inline-notice">Connect another method before disconnecting your only sign-in method</p>';

  return `${rows}${note}`;
}

function cardTemplate(title, bodyMarkup, actionMarkup = "") {
  return `
    <div class="profile-card card-surface ui-card">
      <div class="card-head">
        <h2>${escapeHtml(title)}</h2>
        ${actionMarkup}
      </div>
      <div class="card-body">${bodyMarkup}</div>
    </div>
  `;
}

function renderProfileNavigationSkeleton() {
  const sections = getProfileSectionsInDom();
  const sidebarNav = document.getElementById("profile-sidebar-nav");
  const mobileNav = document.getElementById("profile-mobile-sections");

  if (sidebarNav) {
    sidebarNav.innerHTML = sections
      .map(
        () => `
          <div class="profile-sidebar-link ui-btn ui-btn--secondary control-surface control-surface--secondary profile-sidebar-link--skeleton" aria-hidden="true">
            <span class="profile-skeleton-block profile-skeleton-nav-icon"></span>
            <span class="profile-skeleton-block profile-skeleton-nav-label"></span>
          </div>
        `
      )
      .join("");
  }

  if (mobileNav) {
    mobileNav.innerHTML = `
      <div class="profile-mobile-sections-list profile-mobile-sections-list--skeleton">
        ${sections
          .map(
            () => `
              <div class="profile-mobile-section-row profile-mobile-section-row--skeleton" aria-hidden="true">
                <span class="profile-mobile-section-row-left">
                  <span class="profile-skeleton-block profile-skeleton-nav-icon"></span>
                  <span class="profile-skeleton-block profile-skeleton-mobile-label"></span>
                </span>
                <span class="profile-skeleton-block profile-skeleton-chevron"></span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }
}

function profileSkeletonSettingRow({ shortControl = false } = {}) {
  return `
    <div class="profile-skeleton-setting-row">
      <div class="profile-skeleton-setting-meta">
        <div class="profile-skeleton-block profile-skeleton-line profile-skeleton-line--title"></div>
        <div class="profile-skeleton-block profile-skeleton-line profile-skeleton-line--desc"></div>
      </div>
      <div class="profile-skeleton-block profile-skeleton-control${shortControl ? " profile-skeleton-control--short" : ""}"></div>
    </div>
  `;
}

function buildProfileSectionSkeletonMarkup(sectionId) {
  const headingMap = {
    "profile-identity": "profile-skeleton-heading--identity",
    "profile-academic": "profile-skeleton-heading--academic",
    "profile-reviews": "profile-skeleton-heading--reviews",
    "profile-preferences": "profile-skeleton-heading--preferences",
    "profile-data-privacy": "profile-skeleton-heading--privacy",
    "profile-auth": "profile-skeleton-heading--auth"
  };

  if (sectionId === "profile-identity") {
    return `
      <div class="profile-card card-surface ui-card profile-skeleton-card" aria-hidden="true">
        <div class="card-head">
          <div class="profile-skeleton-block profile-skeleton-heading ${headingMap[sectionId]}"></div>
          <div class="profile-skeleton-block profile-skeleton-action"></div>
        </div>
        <div class="card-body">
          <div class="profile-skeleton-identity">
            <div class="profile-skeleton-block profile-skeleton-avatar"></div>
            <div class="profile-skeleton-identity-meta">
              <div class="profile-skeleton-block profile-skeleton-line profile-skeleton-line--name"></div>
              <div class="profile-skeleton-block profile-skeleton-line profile-skeleton-line--email"></div>
              <div class="profile-skeleton-block profile-skeleton-status"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (sectionId === "profile-data-privacy") {
    return `
      <div class="profile-card card-surface ui-card profile-skeleton-card" aria-hidden="true">
        <div class="card-head">
          <div class="profile-skeleton-block profile-skeleton-heading ${headingMap[sectionId]}"></div>
        </div>
        <div class="card-body">
          ${profileSkeletonSettingRow()}
          ${profileSkeletonSettingRow({ shortControl: true })}
          <div class="profile-skeleton-danger-zone">
            <div class="profile-skeleton-block profile-skeleton-danger-title"></div>
            <div class="profile-skeleton-danger-row">
              <div class="profile-skeleton-setting-meta">
                <div class="profile-skeleton-block profile-skeleton-line profile-skeleton-line--title"></div>
                <div class="profile-skeleton-block profile-skeleton-line profile-skeleton-line--desc"></div>
              </div>
              <div class="profile-skeleton-block profile-skeleton-danger-btn"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (sectionId === "profile-auth") {
    return `
      <div class="profile-card card-surface ui-card profile-skeleton-card" aria-hidden="true">
        <div class="card-head">
          <div class="profile-skeleton-block profile-skeleton-heading ${headingMap[sectionId]}"></div>
        </div>
        <div class="card-body">
          ${profileSkeletonSettingRow({ shortControl: true })}
        </div>
      </div>
    `;
  }

  return `
    <div class="profile-card card-surface ui-card profile-skeleton-card" aria-hidden="true">
      <div class="card-head">
        <div class="profile-skeleton-block profile-skeleton-heading ${headingMap[sectionId] || ""}"></div>
      </div>
      <div class="card-body">
        ${profileSkeletonSettingRow()}
        ${profileSkeletonSettingRow()}
        ${profileSkeletonSettingRow({ shortControl: true })}
      </div>
    </div>
  `;
}

function renderSignedInSkeleton() {
  const routePath = getCurrentProfileRoutePath();
  const routeBase = getProfileRouteBase(routePath);
  const routeSectionId = resolveProfileSectionIdFromRoutePath(routePath);
  const isMobile = isMobileViewport();
  const sections = [
    "profile-identity",
    "profile-academic",
    "profile-reviews",
    "profile-preferences",
    "profile-data-privacy",
    "profile-auth"
  ];

  state.activeSectionId = resolveProfileSectionId(
    routeSectionId || (routeBase === "/settings" ? "profile-preferences" : state.activeSectionId)
  );

  if (isMobile) {
    state.mobileSectionView = routeSectionId ? "detail" : "list";
  }

  renderProfileNavigationSkeleton();

  sections.forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.innerHTML = buildProfileSectionSkeletonMarkup(id);
  });

  applyProfileSectionState();
}

function renderLoadError(error) {
  console.error("Profile: failed to load", error);

  const identity = document.getElementById("profile-identity");
  if (!identity) return;

  identity.innerHTML = cardTemplate(
    "Could not load profile",
    `
      <p class="profile-inline-error">We couldn't load your profile right now. Please try again.</p>
      <button class="ui-btn ui-btn--secondary control-surface" id="profile-retry-button" type="button">Retry</button>
    `
  );

  ["profile-academic", "profile-reviews", "profile-preferences", "profile-data-privacy", "profile-auth"].forEach((id) => {
    const section = document.getElementById(id);
    if (section) section.innerHTML = "";
  });

  const retryButton = document.getElementById("profile-retry-button");
  retryButton?.addEventListener("click", () => {
    initializeProfile();
  });
}

function settingRow(title, description, controlMarkup, className = "") {
  return `
    <div class="setting-row${className ? ` ${escapeHtml(className)}` : ""}">
      <div class="setting-meta">
        <h4 class="setting-title">${escapeHtml(title)}</h4>
        ${description ? `<p class="setting-desc">${escapeHtml(description)}</p>` : ""}
      </div>
      <div class="setting-control">${controlMarkup}</div>
    </div>
  `;
}

function toggleMarkup(id, checked) {
  return `
    <button type="button" class="ui-selector toggle" id="${escapeHtml(id)}" role="switch" aria-checked="${checked ? "true" : "false"}">
      <span class="toggle-track"><span class="toggle-knob" aria-hidden="true"></span></span>
      <span class="toggle-state" aria-hidden="true">${checked ? "On" : "Off"}</span>
    </button>
  `;
}

function pickerButton(id, pickerKey, valueLabel) {
  return `
    <button
      type="button"
      id="${escapeHtml(id)}"
      class="ui-btn ui-btn--secondary control-surface profile-picker-trigger"
      data-picker="${escapeHtml(pickerKey)}"
      aria-haspopup="dialog"
    >
      <span class="picker-value">${escapeHtml(valueLabel)}</span>
      <span class="picker-chevron" aria-hidden="true">›</span>
    </button>
  `;
}

function navRow(id, action, label, icon, soon = false) {
  return `
    <button type="button" class="ui-btn ui-btn--secondary nav-row" id="${escapeHtml(id)}" data-action="${escapeHtml(action)}">
      <span class="nav-row-left">
        <span class="nav-row-icon" aria-hidden="true">${escapeHtml(icon)}</span>
        <span class="nav-row-label">${escapeHtml(label)}</span>
      </span>
      <span class="nav-row-right">
        ${soon ? '<span class="ui-pill status-pill status-pill--soon">Soon</span>' : ""}
        <span class="nav-row-chevron" aria-hidden="true">›</span>
      </span>
    </button>
  `;
}

function renderHelpBody() {
  return `
    <div class="profile-nav-list">
      <button class="ui-btn ui-btn--secondary control-surface" id="profile-open-about" type="button">About</button>
    </div>
  `;
}

function renderGuestView(route) {
  const promptText = consumeGuestPrompt(route);

  const identity = document.getElementById("profile-identity");
  const academic = document.getElementById("profile-academic");
  const reviews = document.getElementById("profile-reviews");
  const preferences = document.getElementById("profile-preferences");
  const dataPrivacy = document.getElementById("profile-data-privacy");
  const auth = document.getElementById("profile-auth");

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Guest mode",
      `
        <p class="profile-body-copy">Browse courses without an account. Sign in to save your schedule.</p>
        ${promptText ? `<p class="profile-inline-notice">${escapeHtml(promptText)}</p>` : ""}
        <div class="profile-inline-actions">
          <button class="ui-btn ui-btn--secondary control-surface" id="guest-browse-courses-btn" type="button">Browse Courses</button>
          <button class="ui-btn ui-btn--secondary control-surface" id="guest-signin-btn" type="button">Sign In</button>
          <button class="ui-btn ui-btn--secondary control-surface" id="guest-register-btn" type="button">Create Account</button>
        </div>
      `
    );
  }

  if (academic) {
    academic.innerHTML = cardTemplate(
      "What's unlocked with an account",
      `
        <div class="profile-nav-list">
          ${navRow("guest-save-timetable", "require-auth", "Save Timetable", "✓")}
          ${navRow("guest-track-deadlines", "require-auth", "Track Deadlines", "⌛")}
          ${navRow("guest-write-reviews", "require-auth", "Write Reviews", "★")}
        </div>
      `
    );
  }

  if (reviews) reviews.innerHTML = "";
  if (preferences) preferences.innerHTML = "";
  if (dataPrivacy) dataPrivacy.innerHTML = "";
  if (auth) auth.innerHTML = "";

  bindGuestActions();
}

function renderTermOptions(selectedValue) {
  const semesters = Array.isArray(state.semesters) ? state.semesters : [];
  if (semesters.length === 0) {
    return `<option value="">No terms available</option>`;
  }

  return semesters
    .map((semester) => {
      const value = `${semester.term}-${semester.year}`;
      const selected = value === selectedValue ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(semester.label || `${semester.term} ${semester.year}`)}</option>`;
    })
    .join("");
}

function renderCustomSelectMarkup(selectId, options, selectedValue, config = {}) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const selected = normalizedOptions.find((option) => option.value === selectedValue) || normalizedOptions[0] || null;
  const isDisabled = config.disabled === true;
  const disabledAttr = isDisabled ? " disabled" : "";

  const optionRows = normalizedOptions
    .map((option) => {
      const isSelected = option.value === (selected?.value || "");
      return `<div class="ui-select__option custom-select-option${isSelected ? " selected" : ""}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</div>`;
    })
    .join("");

  const selectOptions = normalizedOptions
    .map((option) => {
      const isSelected = option.value === (selected?.value || "");
      return `<option value="${escapeHtml(option.value)}"${isSelected ? " selected" : ""}>${escapeHtml(option.label)}</option>`;
    })
    .join("");

  return `
    <div class="ui-select custom-select profile-custom-select${isDisabled ? " is-disabled" : ""}" data-target="${escapeHtml(selectId)}">
      <div class="ui-select__trigger custom-select-trigger control-surface" tabindex="${isDisabled ? "-1" : "0"}" role="button" aria-haspopup="listbox" aria-expanded="false" aria-disabled="${isDisabled ? "true" : "false"}">
        <span class="ui-select__value custom-select-value">${escapeHtml(selected?.label || "Select")}</span>
        <div class="ui-select__arrow custom-select-arrow"></div>
      </div>
      <div class="ui-select__menu custom-select-options" role="listbox">
        <div class="ui-select__options-inner custom-select-options-inner">
          ${optionRows}
        </div>
      </div>
    </div>
    <select id="${escapeHtml(selectId)}" class="profile-native-select" style="display:none;"${disabledAttr}>
      ${selectOptions}
    </select>
  `;
}

function initializeProfileCustomSelects() {
  const customSelects = document.querySelectorAll("#profile-main .profile-custom-select, #profile-modal-layer .profile-custom-select");
  if (customSelects.length === 0) return;

  const refreshModalOpenSelectState = () => {
    document.querySelectorAll("#profile-modal-layer .profile-modal").forEach((modal) => {
      const hasOpenSelect = Boolean(modal.querySelector(".profile-custom-select.open"));
      modal.classList.toggle("profile-modal-has-open-select", hasOpenSelect);
    });
  };

  const closeAll = (except = null) => {
    customSelects.forEach((customSelect) => {
      if (customSelect !== except) {
        customSelect.classList.remove("open");
        customSelect.classList.remove("open-upward");
        const trigger = customSelect.querySelector(".custom-select-trigger");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      }
    });
    refreshModalOpenSelectState();
  };

  customSelects.forEach((customSelect) => {
    if (customSelect.dataset.initialized === "true") return;

    const trigger = customSelect.querySelector(".custom-select-trigger");
    const options = customSelect.querySelector(".custom-select-options");
    const targetSelectId = customSelect.dataset.target;
    const targetSelect = targetSelectId ? document.getElementById(targetSelectId) : null;
    const valueElement = trigger?.querySelector(".custom-select-value");

    if (!trigger || !options || !targetSelect || !valueElement) return;
    customSelect.dataset.initialized = "true";

    const syncFromTargetSelect = () => {
      const currentValue = targetSelect.value;
      let matchedOption = null;
      const isDisabled = targetSelect.disabled;

      customSelect.classList.toggle("is-disabled", isDisabled);
      trigger.setAttribute("aria-disabled", isDisabled ? "true" : "false");
      trigger.tabIndex = isDisabled ? -1 : 0;

      options.querySelectorAll(".custom-select-option").forEach((option) => {
        const isSelected = option.dataset.value === currentValue;
        option.classList.toggle("selected", isSelected);
        if (isSelected) matchedOption = option;
      });

      if (!matchedOption) {
        matchedOption = options.querySelector(".custom-select-option");
        if (matchedOption) {
          matchedOption.classList.add("selected");
          targetSelect.value = matchedOption.dataset.value || "";
        }
      }

      if (matchedOption) {
        valueElement.textContent = matchedOption.textContent || "";
      }
    };

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (targetSelect.disabled) return;
      const isOpen = customSelect.classList.contains("open");
      closeAll(customSelect);
      customSelect.classList.toggle("open", !isOpen);
      trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
      refreshModalOpenSelectState();
    });

    trigger.addEventListener("keydown", (event) => {
      if (targetSelect.disabled) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      trigger.click();
    });

    options.addEventListener("click", (event) => {
      if (targetSelect.disabled) return;
      const option = event.target.closest(".custom-select-option");
      if (!option) return;

      const value = option.dataset.value || "";
      targetSelect.value = value;
      targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
      customSelect.classList.remove("open");
      customSelect.classList.remove("open-upward");
      trigger.setAttribute("aria-expanded", "false");
      syncFromTargetSelect();
      refreshModalOpenSelectState();
    });

    targetSelect.addEventListener("change", syncFromTargetSelect);
    syncFromTargetSelect();
  });

  if (profileCustomSelectDocumentHandler) {
    document.removeEventListener("click", profileCustomSelectDocumentHandler);
  }

  profileCustomSelectDocumentHandler = (event) => {
    if (!event.target.closest(".profile-custom-select")) {
      closeAll();
    }
  };

  document.addEventListener("click", profileCustomSelectDocumentHandler);
}

function renderSignedInView() {
  const identity = document.getElementById("profile-identity");
  const academic = document.getElementById("profile-academic");
  const reviews = document.getElementById("profile-reviews");
  const preferences = document.getElementById("profile-preferences");
  const dataPrivacy = document.getElementById("profile-data-privacy");
  const auth = document.getElementById("profile-auth");

  const displayName = getProfileDisplayName(state.profile, state.user);
  const email = state.user?.email || "";
  const initials = getInitials(displayName, email);
  const hasConcentration = isSetupFieldCompleted(state.profile, "concentration");
  const hasYear = isSetupFieldCompleted(state.profile, "year");
  const concentrationSetupLabel = hasConcentration ? "Edit" : "Set Up";
  const yearSetupLabel = hasYear ? "Edit" : "Set Up";
  const concentrationLabel = getSetupConcentrationLabel(state.profile);
  const yearLabel = getSetupYearLabel(state.profile);
  const useMobilePicker = isMobileViewport();
  const canManagePassword = canUserManagePassword(state.user);
  const connectedProvidersMarkup = renderConnectedProvidersMarkup(state.user);

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Account",
      `
        <div class="profile-identity">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="identity-meta">
            <div class="name">${escapeHtml(displayName)}</div>
            <div class="email">${escapeHtml(email)}</div>
          </div>
        </div>
        ${
          canManagePassword
            ? settingRow(
                "Password",
                "Change your account password",
                '<button class="ui-btn ui-btn--secondary control-surface" id="profile-change-password" type="button">Change Password</button>'
              )
            : ""
        }
        <h3 class="setting-title profile-connected-methods-title">Connected sign-in methods</h3>
        ${connectedProvidersMarkup}
      `,
      `
        <button class="ui-btn ui-btn--icon filter-btn control-surface control-surface--secondary profile-action-pill" id="profile-edit-button" aria-label="Edit profile" type="button">
          <span class="pill-icon pill-icon--edit" aria-hidden="true"></span>
          <span>Edit</span>
        </button>
      `
    );
  }

  if (academic) {
    const termOptions = state.semesters.map((semester) => ({
      value: `${semester.term}-${semester.year}`,
      label: semester.label || `${semester.term} ${semester.year}`
    }));

    const currentTermControl = useMobilePicker
      ? pickerButton("profile-current-term-picker", "current-term", getTermLabel(state.settings.currentTerm))
      : renderCustomSelectMarkup("profile-current-term", termOptions, state.settings.currentTerm);

    academic.innerHTML = cardTemplate(
      "Academic",
      `
        ${settingRow("Current term", "Used for courses, schedule, and assignments", currentTermControl)}
        ${settingRow(
          "Concentration",
          "Your current concentration",
          `${
            hasConcentration
              ? `<span class="ui-pill status-pill status-pill--value">${escapeHtml(concentrationLabel)}</span>`
              : '<span class="ui-pill status-pill status-pill--not-set">Not Set</span>'
          }<button class="ui-btn ui-btn--icon filter-btn control-surface control-surface--secondary profile-action-pill${concentrationSetupLabel === "Set Up" ? " profile-action-pill--setup" : ""}" type="button" data-action="setup-academic-concentration">${escapeHtml(concentrationSetupLabel)}</button>`,
          "setting-row--program-year"
        )}
        ${settingRow(
          "Current year",
          "Current year",
          `${
            hasYear
              ? `<span class="ui-pill status-pill status-pill--value">${escapeHtml(yearLabel)}</span>`
              : '<span class="ui-pill status-pill status-pill--not-set">Not Set</span>'
          }<button class="ui-btn ui-btn--icon filter-btn control-surface control-surface--secondary profile-action-pill${yearSetupLabel === "Set Up" ? " profile-action-pill--setup" : ""}" type="button" data-action="setup-academic-year">${escapeHtml(yearSetupLabel)}</button>`,
          "setting-row--program-year"
        )}
      `
    );
  }

  if (reviews) {
    const totalReviews = Array.isArray(state.studentReviews) ? state.studentReviews.length : 0;
    reviews.innerHTML = cardTemplate(
      "My Reviews",
      `${renderStudentReviewsBody()}`,
      `
        <div class="profile-student-reviews-summary">
          <span class="ui-pill status-pill status-pill--value">
            ${totalReviews} ${totalReviews === 1 ? "review" : "reviews"} made
          </span>
        </div>
      `
    );
  }

  if (preferences) {
    const timeFormatOptions = [
      { value: "12", label: "12-hour" },
      { value: "24", label: "24-hour" }
    ];

    const languageControl = renderCustomSelectMarkup(
      "pref-language",
      [{ value: "en", label: "English" }],
      "en",
      { disabled: true }
    );

    const timeFormatControl = useMobilePicker
      ? pickerButton("pref-timefmt-picker", "time-format", getTimeFormatLabel(state.settings.timeFormat))
      : renderCustomSelectMarkup("pref-timefmt", timeFormatOptions, state.settings.timeFormat);

    preferences.innerHTML = cardTemplate(
      "Preferences",
      `
        ${settingRow("Language", "Choose app language", languageControl)}
        ${settingRow("Time format", "12-hour or 24-hour", timeFormatControl)}
        ${settingRow("Use full card colors", "Show full card background colors", toggleMarkup("pref-fullcardcolors-toggle", state.settings.fullCardColors), "setting-row--toggle")}
        ${settingRow("Reduce motion", "Limit transitions and motion", toggleMarkup("pref-reducemotion-toggle", state.settings.reduceMotion), "setting-row--toggle")}
      `
    );
  }

  if (dataPrivacy) {
    dataPrivacy.innerHTML = cardTemplate(
      "Data & Privacy",
      `
        ${settingRow("Clear cache", "Remove local preferences and temporary data", '<button class="ui-btn ui-btn--secondary control-surface" id="profile-clear-cache" type="button">Clear Cache</button>')}
        ${settingRow("Version", "Current application version", `${renderHelpBody()}`)}
        <div class="danger-zone">
          <h3 class="setting-title profile-danger-zone-title">Danger Zone</h3>
          <div class="danger-zone-row">
            <button class="ui-btn ui-btn--destructive danger-action-btn" id="profile-delete-account" type="button">
              <span class="pill-icon pill-icon--trash" aria-hidden="true"></span>
              <span>Delete Account</span>
            </button>
            <div class="danger-zone-meta">
              <h4 class="setting-title">Delete account</h4>
              <p class="danger-copy">Deleting your account permanently removes your profile and saved data</p>
            </div>
          </div>
        </div>
      `
    );
  }

  if (auth) {
    auth.innerHTML = cardTemplate(
      "Sign Out",
      `${settingRow("Sign out", "End your session and return to the login screen", '<button class="ui-btn ui-btn--secondary control-surface" id="profile-signout" type="button">Sign Out</button>')}`
    );
  }

  bindSignedInActions();
  initializeProfileSectionNavigation(getCurrentProfileRoutePath());
}

function bindGuestActions() {
  document.getElementById("guest-browse-courses-btn")?.addEventListener("click", () => navigateTo("/courses"));
  document.getElementById("guest-signin-btn")?.addEventListener("click", () => {
    if (window.authManager?.openSignIn) {
      window.authManager.openSignIn({
        action: "continue",
        source: "profile-guest-signin"
      });
      return;
    }
    navigateTo("/login");
  });
  document.getElementById("guest-register-btn")?.addEventListener("click", () => {
    if (window.authManager?.openSignUp) {
      window.authManager.openSignUp({
        action: "create your account",
        source: "profile-guest-signup"
      });
      return;
    }
    navigateTo("/register");
  });

  document.querySelectorAll("[data-action='require-auth']").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.authManager?.openSignIn) {
        window.authManager.openSignIn({
          action: "unlock this feature",
          source: "profile-guest-require-auth"
        });
        return;
      }
      navigateTo("/login");
    });
  });
}

function setToggleUi(button, checked) {
  if (!button) return;
  button.setAttribute("aria-checked", checked ? "true" : "false");
  const stateLabel = button.querySelector(".toggle-state");
  if (stateLabel) stateLabel.textContent = checked ? "On" : "Off";
}

function bindSignedInActions() {
  document.getElementById("profile-edit-button")?.addEventListener("click", openEditProfileModal);
  document.getElementById("profile-change-password")?.addEventListener("click", openChangePasswordModal);
  document.querySelectorAll("[data-action='connect-oauth-provider']").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const trigger = event.currentTarget;
      if (!(trigger instanceof HTMLButtonElement)) return;

      const provider = trigger.getAttribute("data-provider") || "";
      if (!provider) return;

      trigger.disabled = true;
      const started = await connectOAuthProvider(provider);
      if (!started && trigger.isConnected) {
        trigger.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-action='disconnect-oauth-provider']").forEach((button) => {
    button.addEventListener("click", () => {
      const provider = button.getAttribute("data-provider") || "";
      if (!provider) return;
      openDisconnectOAuthProviderModal(provider);
    });
  });

  document.querySelectorAll("[data-action='edit-student-review']").forEach((button) => {
    button.addEventListener("click", () => {
      const reviewId = button.getAttribute("data-review-id") || "";
      openStudentReviewEditor(reviewId);
    });
  });

  if (isMobileViewport()) {
    document.querySelectorAll("[data-picker]").forEach((button) => {
      button.addEventListener("click", () => openPreferencePicker(button.dataset.picker || ""));
    });
  } else {
    initializeProfileCustomSelects();

    document.getElementById("profile-current-term")?.addEventListener("change", async (event) => {
      const value = normalizeTermValue(event.target.value);
      await applySettingChanges({ currentTerm: value });
    });

    document.getElementById("pref-timefmt")?.addEventListener("change", async (event) => {
      await applySettingChanges({ timeFormat: event.target.value });
    });
  }

  const fullCardToggle = document.getElementById("pref-fullcardcolors-toggle");
  fullCardToggle?.addEventListener("click", async () => {
    const next = fullCardToggle.getAttribute("aria-checked") !== "true";
    setToggleUi(fullCardToggle, next);
    await applySettingChanges({ fullCardColors: next });
  });

  const reduceMotionToggle = document.getElementById("pref-reducemotion-toggle");
  reduceMotionToggle?.addEventListener("click", async () => {
    const next = reduceMotionToggle.getAttribute("aria-checked") !== "true";
    setToggleUi(reduceMotionToggle, next);
    await applySettingChanges({ reduceMotion: next });
  });

  document.querySelectorAll("[data-action='setup-academic-year']").forEach((button) => {
    button.addEventListener("click", () => openAcademicSetupModal("year"));
  });

  document.querySelectorAll("[data-action='setup-academic-concentration']").forEach((button) => {
    button.addEventListener("click", () => openAcademicSetupModal("concentration"));
  });

  document.getElementById("profile-clear-cache")?.addEventListener("click", openClearCacheModal);
  document.getElementById("profile-delete-account")?.addEventListener("click", openDeleteAccountModal);
  document.getElementById("profile-open-about")?.addEventListener("click", openAboutModal);
  document.getElementById("profile-signout")?.addEventListener("click", openSignOutModal);
}

function showProfileToast(message = "Saved", variant = "info") {
  const previous = document.getElementById("profile-toast");
  if (previous) {
    previous.remove();
  }

  const toast = document.createElement("div");
  toast.id = "profile-toast";
  toast.className = "profile-toast";
  if (variant === "error") {
    toast.classList.add("is-error");
  }
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 180);
  }, 1700);
}

function consumeQueuedProfileToast() {
  const parseToastPayload = (raw) => {
    if (!raw) return null;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }

    if (!parsed || typeof parsed !== "object") {
      const message = String(raw || "").trim();
      if (!message) return null;
      return { message, variant: "error" };
    }

    const message = String(parsed.message || "").trim();
    if (!message) return null;
    const variant = String(parsed.variant || "error").toLowerCase() === "error" ? "error" : "info";
    return { message, variant };
  };

  try {
    const rawSession = window.sessionStorage.getItem(PROFILE_TOAST_QUEUE_KEY);
    if (rawSession) {
      window.sessionStorage.removeItem(PROFILE_TOAST_QUEUE_KEY);
      window.localStorage.removeItem(PROFILE_TOAST_QUEUE_KEY);
      return parseToastPayload(rawSession);
    }
  } catch (_) { }

  try {
    const rawLocal = window.localStorage.getItem(PROFILE_TOAST_QUEUE_KEY);
    if (!rawLocal) return null;
    window.localStorage.removeItem(PROFILE_TOAST_QUEUE_KEY);
    return parseToastPayload(rawLocal);
  } catch (_) {
    return null;
  }
}

function showGlobalBottomToast(message, variant = "info", durationMs = 3000) {
  const normalized = String(message || "").trim();
  if (!normalized) return;

  if (window.router && typeof window.router.showRouteToast === "function") {
    window.router.showRouteToast(normalized, Number(durationMs) || 3000, String(variant || "info"));
    return;
  }

  const existingToast = document.getElementById("link-copied-notification");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "link-copied-notification";
  if (String(variant || "").toLowerCase() === "error") {
    toast.classList.add("is-error");
  }
  toast.textContent = normalized;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 220);
  }, Number(durationMs) || 3000);
}

function clearPendingOAuthLinkIntentState() {
  try {
    window.sessionStorage.removeItem(AUTH_CALLBACK_RETURN_KEY);
    window.localStorage.removeItem(AUTH_CALLBACK_RETURN_KEY);
    window.sessionStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
    window.localStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
    window.sessionStorage.removeItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY);
    window.localStorage.removeItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY);
  } catch (_) { }
}

function readPendingOAuthLinkPayload() {
  const tryParse = (raw) => {
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const provider = normalizeIdentityProvider(parsed?.provider || "");
    const source = String(parsed?.source || "").trim().toLowerCase();
    const createdAt = Number(parsed?.createdAt || 0);
    if (!provider || source !== "profile-oauth-link") return null;
    if (!Number.isFinite(createdAt) || (Date.now() - createdAt) > AUTH_PENDING_OAUTH_LINK_PROVIDER_MAX_AGE_MS) {
      return null;
    }
    return { provider, createdAt };
  };

  try {
    const sessionPayload = tryParse(window.sessionStorage.getItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY));
    if (sessionPayload) return sessionPayload;
  } catch (_) { }

  try {
    const localPayload = tryParse(window.localStorage.getItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY));
    if (localPayload) return localPayload;
  } catch (_) { }

  return null;
}

function readExpectedOAuthEmailForLinking() {
  const tryParse = (raw) => {
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const email = String(parsed?.email || "").trim().toLowerCase();
    const source = String(parsed?.source || "").trim().toLowerCase();
    const createdAt = Number(parsed?.createdAt || 0);
    if (!email || source !== "profile-oauth-link") return "";
    if (!Number.isFinite(createdAt) || (Date.now() - createdAt) > AUTH_EXPECTED_OAUTH_EMAIL_MAX_AGE_MS) {
      return "";
    }
    return email;
  };

  try {
    const fromSession = tryParse(window.sessionStorage.getItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY));
    if (fromSession) return fromSession;
  } catch (_) { }

  try {
    const fromLocal = tryParse(window.localStorage.getItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY));
    if (fromLocal) return fromLocal;
  } catch (_) { }

  return "";
}

function hasOAuthReturnSignalInUrl() {
  try {
    const url = new URL(window.location.href);
    const searchParams = url.searchParams;
    const hashParams = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
    return [
      "code",
      "state",
      "error",
      "error_code",
      "error_description",
      "access_token",
      "refresh_token"
    ].some((key) => Boolean(searchParams.get(key) || hashParams.get(key)));
  } catch (_) {
    return false;
  }
}

function isOAuthProviderConnected(provider, user = state.user) {
  const normalizedProvider = normalizeIdentityProvider(provider);
  if (!normalizedProvider) return false;
  const providers = getConnectedIdentityProviders(user);
  const match = providers.find((entry) => normalizeIdentityProvider(entry.provider) === normalizedProvider);
  return Boolean(match?.identity);
}

function consumePendingOAuthLinkErrorMessage(user = state.user) {
  const pending = readPendingOAuthLinkPayload();
  if (!pending?.provider) return "";

  if (isOAuthProviderConnected(pending.provider, user)) {
    clearPendingOAuthLinkIntentState();
    return "";
  }

  const ageMs = Date.now() - Number(pending.createdAt || 0);
  const likelyOAuthReturn = hasOAuthReturnSignalInUrl() || ageMs >= 4000;
  if (!likelyOAuthReturn) {
    return "";
  }

  const providerLabel = getIdentityProviderLabel(pending.provider);
  const expectedEmail = readExpectedOAuthEmailForLinking();
  const accountEmail = String(user?.email || "").trim().toLowerCase();
  clearPendingOAuthLinkIntentState();

  if (expectedEmail && accountEmail) {
    return `Could not connect ${providerLabel}. Use ${accountEmail} in ${providerLabel}.`;
  }
  return `Could not connect ${providerLabel}. Use the same email as your account and try again.`;
}

function closeModal() {
  const layer = document.getElementById(PROFILE_MODAL_LAYER_ID);
  if (!layer) return;

  const modal = layer.querySelector(".profile-modal");
  const isSwipeModal = modal?.classList.contains("profile-modal--swipe");

  if (isSwipeModal && modal) {
    modal.classList.remove("show");
    window.setTimeout(() => {
      layer.remove();
      document.body.classList.remove("modal-open");
    }, 340);
  } else {
    layer.remove();
    document.body.classList.remove("modal-open");
  }
}

function resolveModalMode(mode, mobileMode) {
  if (mode === "fullscreen-mobile") {
    return isMobileViewport() ? "fullscreen" : "dialog";
  }

  if (mode === "dialog" && isMobileViewport() && mobileMode) {
    return mobileMode;
  }

  return mode;
}

function openModal({
  title,
  bodyMarkup,
  footerMarkup = "",
  mode = "dialog",
  mobileMode = "sheet",
  closeOnBackdrop = true,
  modalClassName = ""
}) {
  closeModal();

  const resolvedMode = resolveModalMode(mode, mobileMode);
  const enableSwipeSheet = resolvedMode === "sheet" || (resolvedMode === "fullscreen" && isMobileViewport());
  const showSwipeIndicator = enableSwipeSheet;
  const layer = document.createElement("div");
  layer.id = PROFILE_MODAL_LAYER_ID;
  layer.className = "profile-modal-layer";
  layer.innerHTML = `
    <div class="profile-modal-backdrop"${closeOnBackdrop ? ' data-modal-close="true"' : ""}></div>
    <div class="profile-modal card-surface ui-card${enableSwipeSheet ? " ui-swipe-sheet" : ""} profile-modal--${escapeHtml(resolvedMode)}${modalClassName ? ` ${escapeHtml(modalClassName)}` : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      ${showSwipeIndicator ? '<div class="swipe-indicator ui-swipe-sheet__handle" aria-hidden="true"></div>' : ""}
      <div class="profile-modal-head ui-swipe-sheet__header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="ui-btn ui-btn--icon control-surface icon-btn" data-modal-close="true" aria-label="Close"></button>
      </div>
      <div class="profile-modal-body ui-swipe-sheet__body">${bodyMarkup}</div>
      ${footerMarkup ? `<div class="profile-modal-footer ui-swipe-sheet__footer">${footerMarkup}</div>` : ""}
    </div>
  `;

  layer.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-modal-close='true']")) {
      closeModal();
    }
  });

  document.body.appendChild(layer);

  const modal = layer.querySelector(".profile-modal");
  const backdrop = layer.querySelector(".profile-modal-backdrop");
  if (enableSwipeSheet && modal) {
    modal.classList.add("profile-modal--swipe");
  }

  document.body.classList.add("modal-open");

  if (enableSwipeSheet && modal) {
    requestAnimationFrame(() => {
      modal.classList.add("show");
    });

    if (typeof window.addSwipeToCloseSimple === "function" && backdrop) {
      window.addSwipeToCloseSimple(modal, backdrop, () => {
        const active = document.getElementById(PROFILE_MODAL_LAYER_ID);
        if (active) active.remove();
        document.body.classList.remove("modal-open");
      });
    }
  }

  return layer;
}

function openChoicePicker({ title, description = "", options, selectedValue, onSelect }) {
  const bodyMarkup = `
    ${description ? `<p class="profile-picker-help">${escapeHtml(description)}</p>` : ""}
    <div class="profile-choice-list">
      ${options
        .map((option) => {
          const isSelected = option.value === selectedValue;
          return `
            <button
              type="button"
              class="profile-choice-option${isSelected ? " is-selected" : ""}"
              data-choice-value="${escapeHtml(option.value)}"
            >
              <span>${escapeHtml(option.label)}</span>
              ${isSelected ? '<span class="choice-check" aria-hidden="true"></span>' : ""}
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  const layer = openModal({
    title,
    bodyMarkup,
    footerMarkup: `<button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>`,
    mode: "sheet",
    mobileMode: "sheet",
    modalClassName: "profile-modal--picker-sheet"
  });

  layer.querySelectorAll(".profile-choice-option").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-choice-value") || "";
      await onSelect(value);
      closeModal();
    });
  });
}

function openNestedChoicePicker({ title, description = "", options, selectedValue, onSelect }) {
  const existingLayer = document.querySelector(".profile-modal-layer--nested");
  if (existingLayer) {
    existingLayer.remove();
  }

  const bodyMarkup = `
    ${description ? `<p class="profile-picker-help">${escapeHtml(description)}</p>` : ""}
    <div class="profile-choice-list">
      ${options
        .map((option) => {
          const isSelected = option.value === selectedValue;
          return `
            <button
              type="button"
              class="profile-choice-option${isSelected ? " is-selected" : ""}"
              data-choice-value="${escapeHtml(option.value)}"
            >
              <span>${escapeHtml(option.label)}</span>
              ${isSelected ? '<span class="choice-check" aria-hidden="true"></span>' : ""}
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  const layer = document.createElement("div");
  layer.className = "profile-modal-layer profile-modal-layer--nested";
  layer.innerHTML = `
    <div class="profile-modal-backdrop" data-modal-close="true"></div>
    <div class="profile-modal card-surface ui-card ui-swipe-sheet profile-modal--sheet profile-modal--swipe profile-modal--picker-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="swipe-indicator ui-swipe-sheet__handle" aria-hidden="true"></div>
      <div class="profile-modal-head ui-swipe-sheet__header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="ui-btn ui-btn--icon control-surface icon-btn" data-modal-close="true" aria-label="Close"></button>
      </div>
      <div class="profile-modal-body ui-swipe-sheet__body">${bodyMarkup}</div>
      <div class="profile-modal-footer ui-swipe-sheet__footer">
        <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      </div>
    </div>
  `;

  const closeLayer = ({ immediate = false } = {}) => {
    if (!layer.isConnected) return;
    const modal = layer.querySelector(".profile-modal");
    if (immediate) {
      layer.remove();
      return;
    }
    if (modal?.classList.contains("profile-modal--swipe")) {
      modal.classList.remove("show");
      window.setTimeout(() => {
        layer.remove();
      }, 340);
      return;
    }
    layer.remove();
  };

  layer.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-modal-close='true']")) {
      closeLayer();
    }
  });

  document.body.appendChild(layer);

  const modal = layer.querySelector(".profile-modal");
  const backdrop = layer.querySelector(".profile-modal-backdrop");

  requestAnimationFrame(() => {
    modal?.classList.add("show");
  });

  if (typeof window.addSwipeToCloseSimple === "function" && modal && backdrop) {
    window.addSwipeToCloseSimple(modal, backdrop, () => closeLayer({ immediate: true }));
  }

  layer.querySelectorAll(".profile-choice-option").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-choice-value") || "";
      await onSelect(value);
      closeLayer();
    });
  });
}

function updatePickerLabel(buttonId, text) {
  const button = document.getElementById(buttonId);
  const valueNode = button?.querySelector(".picker-value");
  if (valueNode) {
    valueNode.textContent = text;
  }
}

function openPreferencePicker(key) {
  if (key === "current-term") {
    const options = state.semesters.map((semester) => ({
      value: `${semester.term}-${semester.year}`,
      label: semester.label || `${semester.term} ${semester.year}`
    }));

    openChoicePicker({
      title: "Current Term",
      description: "Used for courses, schedule, and assignments",
      options,
      selectedValue: state.settings.currentTerm,
      onSelect: async (value) => {
        const normalized = normalizeTermValue(value);
        updatePickerLabel("profile-current-term-picker", getTermLabel(normalized));
        await applySettingChanges({ currentTerm: normalized });
      }
    });
    return;
  }

  if (key === "language") {
    const options = [
      { value: "en", label: "English" }
    ];

    openChoicePicker({
      title: "Language",
      options,
      selectedValue: state.settings.language,
      onSelect: async (value) => {
        updatePickerLabel("pref-language-picker", getLanguageLabel(value));
        await applySettingChanges({ language: value });
      }
    });
    return;
  }

  if (key === "time-format") {
    const options = [
      { value: "12", label: "12-hour" },
      { value: "24", label: "24-hour" }
    ];

    openChoicePicker({
      title: "Time Format",
      options,
      selectedValue: state.settings.timeFormat,
      onSelect: async (value) => {
        updatePickerLabel("pref-timefmt-picker", getTimeFormatLabel(value));
        await applySettingChanges({ timeFormat: value });
      }
    });
  }
}

function maskIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "N/A";
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function formatUnixTimestamp(value) {
  const unixSeconds = Number(value);
  if (!Number.isFinite(unixSeconds)) return "Unknown";
  const millis = unixSeconds * 1000;
  const parsed = new Date(millis);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toISOString();
}

function buildSessionDiagnostics(session) {
  const activeSession = session || null;
  const activeUser = activeSession?.user || state.user || null;
  const provider = String(
    activeUser?.app_metadata?.provider
    || activeUser?.identities?.[0]?.provider
    || "unknown"
  ).trim();

  return {
    isAuthenticated: Boolean(activeUser),
    userId: String(activeUser?.id || "").trim() || "N/A",
    email: String(activeUser?.email || "").trim() || "N/A",
    provider,
    expiresAtIso: formatUnixTimestamp(activeSession?.expires_at),
    route: getCurrentAppPath(),
    term: String(state.settings?.currentTerm || "N/A"),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown",
    online: typeof navigator.onLine === "boolean" ? (navigator.onLine ? "online" : "offline") : "unknown",
    userAgent: String(navigator.userAgent || "Unknown").trim() || "Unknown"
  };
}

function buildDebugReport(appMeta, sessionInfo) {
  return [
    `App: ${appMeta.appName}`,
    `Version: ${appMeta.version}`,
    `Build: ${appMeta.build}`,
    `Mode: ${appMeta.mode}`,
    `Build ID: ${appMeta.buildId}`,
    `Commit: ${appMeta.commit}`,
    `Built At: ${appMeta.builtAt}`,
    `Authenticated: ${sessionInfo.isAuthenticated ? "yes" : "no"}`,
    `User ID: ${sessionInfo.userId}`,
    `Email: ${sessionInfo.email}`,
    `Provider: ${sessionInfo.provider}`,
    `Session Expires: ${sessionInfo.expiresAtIso}`,
    `Current Route: ${sessionInfo.route}`,
    `Current Term: ${sessionInfo.term}`,
    `Timezone: ${sessionInfo.timezone}`,
    `Network: ${sessionInfo.online}`,
    `User Agent: ${sessionInfo.userAgent}`
  ].join("\n");
}

async function copyTextToClipboard(textValue) {
  const text = String(textValue || "");
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to the legacy copy path below.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch (_) {
    return false;
  }
}

async function openAboutModal() {
  let latestSession = state.session;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session || state.session === null) {
      latestSession = session;
      state.session = session;
      state.user = session?.user || state.user;
    }
  } catch (error) {
    console.warn("Profile: unable to refresh auth session for About modal", error);
  }

  const appMeta = {
    appName: String(APP_META?.appName || "ILA Companion"),
    version: String(APP_META?.version || import.meta.env.VITE_APP_VERSION || "0.0.0"),
    build: String(APP_META?.build || import.meta.env.VITE_APP_BUILD_LABEL || import.meta.env.MODE || "unknown"),
    mode: String(APP_META?.mode || import.meta.env.MODE || "unknown"),
    buildId: String(APP_META?.buildId || "unknown"),
    commit: String(APP_META?.commit || "unknown"),
    builtAt: String(APP_META?.builtAt || "unknown")
  };
  const sessionInfo = buildSessionDiagnostics(latestSession);
  const debugReport = buildDebugReport(appMeta, sessionInfo);

  const layer = openModal({
    title: "About",
    bodyMarkup: `
      <div class="profile-about-grid">
        <div><strong>App</strong></div><div>${escapeHtml(appMeta.appName)}</div>
        <div><strong>Version</strong></div><div>${escapeHtml(appMeta.version)}</div>
        <div><strong>Build</strong></div><div>${escapeHtml(appMeta.build)}</div>
        <div><strong>Mode</strong></div><div>${escapeHtml(appMeta.mode)}</div>
        <div><strong>Commit</strong></div><div>${escapeHtml(appMeta.commit)}</div>
        <div><strong>Built At</strong></div><div>${escapeHtml(appMeta.builtAt)}</div>
        <div><strong>Session</strong></div><div>${sessionInfo.isAuthenticated ? "Signed in" : "Guest"}</div>
        <div><strong>User</strong></div><div>${escapeHtml(maskIdentifier(sessionInfo.userId))}</div>
      </div>
      <details class="profile-about-debug">
        <summary>Debug Snapshot</summary>
        <pre class="profile-about-debug-pre">${escapeHtml(debugReport)}</pre>
      </details>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" id="profile-copy-debug-report">Copy Debug Info</button>
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Close</button>
    `
  });

  layer.querySelector("#profile-copy-debug-report")?.addEventListener("click", async () => {
    const copied = await copyTextToClipboard(debugReport);
    if (copied) {
      showProfileToast("Debug info copied");
      return;
    }
    showProfileToast("Could not copy debug info", "error");
  });
}

function openClearCacheModal() {
  const layer = openModal({
    title: "Clear Cache",
    bodyMarkup: `<p>Clear locally stored app preferences and temporary cache?</p>`,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="ui-btn ui-btn--secondary control-surface" id="profile-confirm-clear-cache">Clear Cache</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  layer.querySelector("#profile-confirm-clear-cache")?.addEventListener("click", () => {
    clearProfileCache();
    closeModal();
    if (state.isAuthenticated) {
      renderSignedInView();
    }
    showProfileToast("Cache cleared");
  });
}

function clearProfileCache() {
  clearStoredPreferences();

  try {
    sessionStorage.removeItem(AUTH_PROMPT_KEY);
    sessionStorage.removeItem("open_new_assignment_modal");
  } catch (error) {
    console.warn("Profile: failed to clear session storage", error);
  }

  state.settings = buildInitialSettings();
  syncSettingsToLocalStorage(state.settings);
  applyPreferencesToDocument(state.settings);

  const inferred = parseTermValue(state.settings.currentTerm || getInferredCurrentTerm());
  if (inferred.value) {
    applyPreferredTermToGlobals(inferred.value);
  }
}

function openDeleteAccountModal() {
  const layer = openModal({
    title: "Delete Account",
    bodyMarkup: `
      <p class="delete_p_modal">This action permanently deletes your account and all related data.</p>
      <p class="delete_p_modal">Type <strong>DELETE</strong> to confirm.</p>
      <input id="profile-delete-confirm-input" class="search-input profile-modal-input" type="text" autocomplete="off" spellcheck="false" />
      <p id="profile-delete-error" class="profile-inline-error delete_p_modal"></p>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="ui-btn ui-btn--destructive danger-action-btn" id="profile-confirm-delete" disabled>Delete Account</button>
    `,
    mode: "fullscreen-mobile"
  });

  const input = layer.querySelector("#profile-delete-confirm-input");
  const confirmButton = layer.querySelector("#profile-confirm-delete");
  const errorLine = layer.querySelector("#profile-delete-error");

  input?.addEventListener("input", () => {
    const isReady = input.value.trim() === "DELETE";
    confirmButton.disabled = !isReady;
    if (errorLine) errorLine.textContent = "";
  });

  confirmButton?.addEventListener("click", async () => {
    if (input?.value.trim() !== "DELETE") return;

    confirmButton.disabled = true;

    try {
      const { error } = await supabase.rpc("delete_account_self", { confirm_text: "DELETE" });
      if (error) throw error;

      await supabase.auth.signOut();
      closeModal();
      navigateTo("/");
    } catch (error) {
      console.error("Profile: delete account failed", error);
      if (errorLine) {
        errorLine.textContent = "Could not delete account right now. Please try again.";
      }
      confirmButton.disabled = false;
    }
  });
}

function openSignOutModal() {
  const layer = openModal({
    title: "Sign Out?",
    bodyMarkup: `<p>You can sign in again at any time.</p>`,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="ui-btn ui-btn--secondary control-surface" id="profile-confirm-signout">Sign Out</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  layer.querySelector("#profile-confirm-signout")?.addEventListener("click", async () => {
    closeModal();
    await signOutUser();
  });
}

async function disconnectOAuthProvider(provider) {
  const normalized = normalizeIdentityProvider(provider);
  const providerLabel = getIdentityProviderLabel(normalized);
  if (!isOAuthIdentityProvider(normalized)) {
    showProfileToast("Only OAuth providers can be disconnected.");
    return false;
  }

  let providers = getConnectedIdentityProviders(state.user);
  if (countConnectedSignInMethods(state.user) <= 1) {
    showProfileToast("Connect another sign-in method first.");
    return false;
  }

  let connection = providers.find((item) => item.provider === normalized) || null;
  if (!connection || !connection.identity) {
    await refreshUserIdentities(state.user);
    providers = getConnectedIdentityProviders(state.user);
    connection = providers.find((item) => item.provider === normalized) || null;
  }

  if (!connection || !connection.identity) {
    showProfileToast(`Could not disconnect ${providerLabel} right now.`);
    return false;
  }

  try {
    const { error } = await supabase.auth.unlinkIdentity(connection.identity);
    if (error) throw error;

    closeModal();
    showProfileToast(`${providerLabel} disconnected`);
    await initializeProfile();
    return true;
  } catch (error) {
    console.error("Profile: disconnect OAuth provider failed", error);
    showProfileToast(`Could not disconnect ${providerLabel}.`);
    return false;
  }
}

async function connectOAuthProvider(provider) {
  const normalized = normalizeIdentityProvider(provider);
  const providerLabel = getIdentityProviderLabel(normalized);
  if (!isOAuthIdentityProvider(normalized)) {
    showProfileToast("Only OAuth providers can be connected.");
    return false;
  }

  const providers = getConnectedIdentityProviders(state.user);
  const existingConnection = providers.find((item) => item.provider === normalized && Boolean(item.identity));
  if (existingConnection) {
    showProfileToast(`${providerLabel} is already connected.`);
    return false;
  }

  if (typeof supabase.auth.linkIdentity !== "function") {
    showProfileToast("Connecting OAuth providers is not supported by this client.");
    return false;
  }

  try {
    setAuthCallbackReturnIntent("/profile");
    const pendingProviderPayload = JSON.stringify({
      provider: normalized,
      source: "profile-oauth-link",
      createdAt: Date.now()
    });
    window.sessionStorage.setItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY, pendingProviderPayload);
    window.localStorage.setItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY, pendingProviderPayload);

    const { error } = await supabase.auth.linkIdentity({
      provider: normalized,
      options: getOAuthLinkOptions(normalized, "/profile")
    });
    if (error) throw error;
    return true;
  } catch (error) {
    clearAuthCallbackReturnIntent();
    console.error("Profile: connect OAuth provider failed", error);
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("provider is not enabled") || message.includes("unsupported provider")) {
      showProfileToast(`${providerLabel} sign-in is not enabled yet.`);
    } else if (isOAuthEmailMismatchMessage(message)) {
      showProfileToast("This OAuth email does not match your account email.", "error");
    } else {
      showProfileToast(`Could not connect ${providerLabel}.`);
    }
    return false;
  }
}

function openDisconnectOAuthProviderModal(provider) {
  const normalized = normalizeIdentityProvider(provider);
  const providerLabel = getIdentityProviderLabel(normalized);
  const canDisconnect = countConnectedSignInMethods(state.user) > 1;

  if (!canDisconnect) {
    openModal({
      title: "Cannot Disconnect",
      bodyMarkup: "<p>Connect another sign-in method before disconnecting your only OAuth provider.</p>",
      footerMarkup: `<button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Close</button>`,
      mode: "dialog",
      mobileMode: "sheet"
    });
    return;
  }

  const layer = openModal({
    title: `Disconnect ${providerLabel}?`,
    bodyMarkup: `<p>You can reconnect ${escapeHtml(providerLabel)} later. This will not delete your account.</p>`,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="ui-btn ui-btn--secondary control-surface" id="profile-confirm-disconnect-provider">Disconnect</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  layer.querySelector("#profile-confirm-disconnect-provider")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    await disconnectOAuthProvider(normalized);
    if (button.isConnected) button.disabled = false;
  });
}

function openEditProfileModal() {
  const displayName = getProfileDisplayName(state.profile, state.user);

  const layer = openModal({
    title: "Edit Profile",
    bodyMarkup: `
      <form id="profile-edit-form" novalidate>
        <label class="profile-modal-label" for="profile-edit-display-name">Display name</label>
        <input class="search-input profile-modal-input" id="profile-edit-display-name" minlength="2" maxlength="30" required value="${escapeHtml(displayName)}" />
        <p class="profile-inline-error app-field-error-message" id="profile-edit-name-error"></p>
      </form>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="ui-btn ui-btn--secondary control-surface" form="profile-edit-form" id="profile-edit-save">Save</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  const form = layer.querySelector("#profile-edit-form");
  const editDisplayNameInput = layer.querySelector("#profile-edit-display-name");
  const editNameErrorLine = layer.querySelector("#profile-edit-name-error");
  editDisplayNameInput?.addEventListener("input", () => {
    clearFieldError(editDisplayNameInput, { root: form || layer, messageElement: editNameErrorLine });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const nameInput = editDisplayNameInput;
    const nameErrorLine = editNameErrorLine;
    const name = String(nameInput?.value || "").trim();

    clearFieldError(nameInput, { root: form || layer, messageElement: nameErrorLine });

    let nameError = "";
    if (name.length < 2 || name.length > 30) {
      nameError = "Display name must be 2 to 30 characters.";
    }

    if (nameError) {
      setFieldError(nameInput, nameError, {
        root: form || layer,
        messageElement: nameErrorLine
      });
      return;
    }

    const payload = {
      id: state.user.id,
      display_name: name,
      program: state.profile?.program || null,
      year: state.profile?.year || null,
      updated_at: new Date().toISOString()
    };

    const saveButton = layer.querySelector("#profile-edit-save");
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    try {
      await upsertProfileSafe(payload);

      state.profile = {
        ...(state.profile || {}),
        display_name: payload.display_name
      };

      closeModal();
      renderSignedInView();
      applyRouteFocus(getCurrentProfileRoutePath());
      showProfileToast("Saved");
    } catch (error) {
      console.error("Profile: failed to save profile", error);
      setFieldError(nameInput, "Could not save profile right now.", {
        root: form || layer,
        messageElement: nameErrorLine
      });
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      }
    }
  });
}

function openChangePasswordModal() {
  if (!canUserManagePassword(state.user)) {
    showProfileToast("Password changes are not available for this sign-in method.");
    return;
  }

  const layer = openModal({
    title: "Change Password",
    bodyMarkup: `
      <form id="profile-password-form" novalidate>
        <p class="profile-modal-help">Enter your current password and choose a new one (at least 12 characters).</p>
        <label class="profile-modal-label" for="profile-old-password">Current password</label>
        <input class="search-input profile-modal-input" id="profile-old-password" type="password" minlength="1" maxlength="72" autocomplete="current-password" required />
        <p class="profile-inline-error app-field-error-message" id="profile-old-password-error" hidden></p>
        <label class="profile-modal-label" for="profile-new-password">New password</label>
        <input class="search-input profile-modal-input" id="profile-new-password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required />
        <p class="profile-inline-error app-field-error-message" id="profile-new-password-error" hidden></p>
        <label class="profile-modal-label" for="profile-confirm-password">Confirm new password</label>
        <input class="search-input profile-modal-input" id="profile-confirm-password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required />
        <p class="profile-inline-error app-field-error-message" id="profile-confirm-password-error" hidden></p>
      </form>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="ui-btn ui-btn--secondary control-surface" form="profile-password-form" id="profile-password-save">Update Password</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  const form = layer.querySelector("#profile-password-form");
  const oldPasswordInput = layer.querySelector("#profile-old-password");
  const passwordInput = layer.querySelector("#profile-new-password");
  const confirmInput = layer.querySelector("#profile-confirm-password");
  const oldPasswordErrorLine = layer.querySelector("#profile-old-password-error");
  const newPasswordErrorLine = layer.querySelector("#profile-new-password-error");
  const confirmPasswordErrorLine = layer.querySelector("#profile-confirm-password-error");

  oldPasswordInput?.addEventListener("input", () => {
    clearFieldError(oldPasswordInput, { root: form || layer, messageElement: oldPasswordErrorLine });
  });
  passwordInput?.addEventListener("input", () => {
    clearFieldError(passwordInput, { root: form || layer, messageElement: newPasswordErrorLine });
  });
  confirmInput?.addEventListener("input", () => {
    clearFieldError(confirmInput, { root: form || layer, messageElement: confirmPasswordErrorLine });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const saveButton = layer.querySelector("#profile-password-save");

    const oldPassword = String(oldPasswordInput?.value || "");
    const password = String(passwordInput?.value || "");
    const confirmPassword = String(confirmInput?.value || "");

    clearFieldErrors(form || layer);

    if (oldPassword.length < 1) {
      setFieldError(oldPasswordInput, "Current password is required.", {
        root: form || layer,
        messageElement: oldPasswordErrorLine
      });
      return;
    } else if (!state.user?.email) {
      setFieldError(oldPasswordInput, "Your account email is unavailable. Please sign out and sign back in.", {
        root: form || layer,
        messageElement: oldPasswordErrorLine
      });
      return;
    } else if (password.length < 12) {
      setFieldError(passwordInput, "Password must be at least 12 characters.", {
        root: form || layer,
        messageElement: newPasswordErrorLine
      });
      return;
    } else if (password.length > 72) {
      setFieldError(passwordInput, "Password must be 72 characters or fewer.", {
        root: form || layer,
        messageElement: newPasswordErrorLine
      });
      return;
    } else if (password === oldPassword) {
      setFieldError(passwordInput, "New password must be different from current password.", {
        root: form || layer,
        messageElement: newPasswordErrorLine
      });
      return;
    } else if (password !== confirmPassword) {
      setFieldError(confirmInput, "Passwords do not match.", {
        root: form || layer,
        messageElement: confirmPasswordErrorLine
      });
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Updating...";
    }

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: state.user.email,
        password: oldPassword
      });
      if (verifyError) {
        const verifyMessage = String(verifyError?.message || "").toLowerCase();
        if (verifyMessage.includes("invalid login credentials")) {
          throw new Error("CURRENT_PASSWORD_INVALID");
        }
        throw verifyError;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      closeModal();
      showProfileToast("Password updated.");
    } catch (error) {
      const rawMessage = String(error?.message || "");
      const isInvalidCurrentPassword = rawMessage === "CURRENT_PASSWORD_INVALID";
      if (!isInvalidCurrentPassword) {
        console.error("Profile: password update failed", error);
      }
      const message = rawMessage.toLowerCase();
      if (isInvalidCurrentPassword) {
        setFieldError(oldPasswordInput, "Current password is incorrect.", {
          root: form || layer,
          messageElement: oldPasswordErrorLine
        });
      } else if (message.includes("reauthentication") || message.includes("not fresh")) {
        setFieldError(oldPasswordInput, "Please sign out and sign back in, then try changing your password again.", {
          root: form || layer,
          messageElement: oldPasswordErrorLine
        });
      } else {
        setFieldError(passwordInput, "Could not update password right now. Please try again.", {
          root: form || layer,
          messageElement: newPasswordErrorLine
        });
      }
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Update Password";
      }
    }
  });
}

function openLegacyProgramYearSetupModal() {
  const program = state.profile?.program ? String(state.profile.program) : "";
  const year = state.profile?.year ? String(state.profile.year) : "";
  const useMobileYearPicker = isMobileViewport();
  const yearOptions = [
    { value: "", label: "Not Set" },
    { value: "1", label: "Year 1" },
    { value: "2", label: "Year 2" },
    { value: "3", label: "Year 3" },
    { value: "4", label: "Year 4" }
  ];
  const selectedYearOption = yearOptions.find((option) => option.value === year) || yearOptions[0];
  const yearSelectOptionsMarkup = yearOptions
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === year ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");
  const yearControlMarkup = useMobileYearPicker
    ? `
      <button
        type="button"
        id="profile-program-year-picker"
        class="ui-btn ui-btn--secondary control-surface profile-picker-trigger profile-modal-picker-trigger"
        aria-haspopup="dialog"
      >
        <span class="picker-value">${escapeHtml(selectedYearOption.label)}</span>
        <span class="picker-chevron" aria-hidden="true">›</span>
      </button>
      <select id="profile-edit-year" class="profile-native-select" style="display:none;">
        ${yearSelectOptionsMarkup}
      </select>
    `
    : renderCustomSelectMarkup("profile-edit-year", yearOptions, year);

  const layer = openModal({
    title: "Set Up Academic Details",
    bodyMarkup: `
      <form id="profile-program-year-form" novalidate>
        <label class="profile-modal-label" for="profile-edit-program">Program</label>
        <input class="search-input profile-modal-input" id="profile-edit-program" maxlength="40" value="${escapeHtml(program)}" />
        <p class="profile-inline-error app-field-error-message" id="profile-edit-program-error"></p>

        <label class="profile-modal-label" for="profile-edit-year">Year</label>
        ${yearControlMarkup}
        <p class="profile-inline-error app-field-error-message" id="profile-edit-year-error"></p>
      </form>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="ui-btn ui-btn--secondary control-surface" form="profile-program-year-form" id="profile-program-year-save">Save</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  if (!useMobileYearPicker) {
    initializeProfileCustomSelects();
  } else {
    const yearPickerButton = layer.querySelector("#profile-program-year-picker");
    const yearSelect = layer.querySelector("#profile-edit-year");

    yearPickerButton?.addEventListener("click", () => {
      openNestedChoicePicker({
        title: "Year",
        options: yearOptions,
        selectedValue: String(yearSelect?.value || ""),
        onSelect: async (value) => {
          if (yearSelect) {
            yearSelect.value = value;
            yearSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }

          const selected = yearOptions.find((option) => option.value === value) || yearOptions[0];
          updatePickerLabel("profile-program-year-picker", selected.label);
        }
      });
    });
  }

  const form = layer.querySelector("#profile-program-year-form");
  const legacyProgramInput = layer.querySelector("#profile-edit-program");
  const legacyYearInput = layer.querySelector("#profile-edit-year");
  const legacyProgramErrorLine = layer.querySelector("#profile-edit-program-error");
  const legacyYearErrorLine = layer.querySelector("#profile-edit-year-error");
  const legacyYearControl = useMobileYearPicker
    ? layer.querySelector("#profile-program-year-picker")
    : (layer.querySelector('[data-target="profile-edit-year"] .custom-select-trigger') || legacyYearInput);

  legacyProgramInput?.addEventListener("input", () => {
    clearFieldError(legacyProgramInput, { root: form || layer, messageElement: legacyProgramErrorLine });
  });
  legacyYearInput?.addEventListener("change", () => {
    clearFieldError(legacyYearInput, {
      root: form || layer,
      highlightTarget: legacyYearControl,
      messageElement: legacyYearErrorLine
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const programInput = layer.querySelector("#profile-edit-program");
    const yearInput = layer.querySelector("#profile-edit-year");
    const programErrorLine = layer.querySelector("#profile-edit-program-error");
    const yearErrorLine = layer.querySelector("#profile-edit-year-error");
    const yearControl = useMobileYearPicker
      ? layer.querySelector("#profile-program-year-picker")
      : (layer.querySelector('[data-target="profile-edit-year"] .custom-select-trigger') || yearInput);

    const programValue = String(programInput?.value || "").trim();
    const yearValue = String(yearInput?.value || "").trim();

    clearFieldError(programInput, { root: form || layer, messageElement: programErrorLine });
    clearFieldError(yearInput, {
      root: form || layer,
      highlightTarget: yearControl,
      messageElement: yearErrorLine
    });

    let programError = "";
    let yearError = "";

    if (programValue.length > 40) {
      programError = "Program must be 40 characters or fewer.";
    }

    if (yearValue && !/^[1-4]$/.test(yearValue)) {
      yearError = "Year must be a number from 1 to 4.";
    }

    if (programError) {
      setFieldError(programInput, programError, {
        root: form || layer,
        messageElement: programErrorLine
      });
    }

    if (yearError) {
      setFieldError(yearInput, yearError, {
        root: form || layer,
        anchor: yearControl,
        highlightTarget: yearControl,
        messageElement: yearErrorLine
      });
    }

    if (programError || yearError) return;

    const payload = {
      id: state.user.id,
      display_name: getProfileDisplayName(state.profile, state.user),
      program: programValue || null,
      year: yearValue ? Number(yearValue) : null,
      updated_at: new Date().toISOString()
    };

    const saveButton = layer.querySelector("#profile-program-year-save");
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    try {
      await upsertProfileSafe(payload);

      state.profile = {
        ...(state.profile || {}),
        display_name: payload.display_name,
        program: payload.program,
        year: payload.year
      };

      closeModal();
      renderSignedInView();
      applyRouteFocus(getCurrentProfileRoutePath());
      showProfileToast("Saved");
    } catch (error) {
      console.error("Profile: failed to save program/year", error);
      setFieldError(programInput, "Could not save right now.", {
        root: form || layer,
        messageElement: programErrorLine
      });
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      }
    }
  });
}

function openAcademicSetupModal(field = "year") {
  if (!state.profileSetupColumnsAvailable) {
    openLegacyProgramYearSetupModal();
    return;
  }

  const targetField = field === "concentration" ? "concentration" : "year";
  const isYearField = targetField === "year";
  const useMobilePicker = isMobileViewport();
  const selectedYear = state.profile?.year_opt_out
    ? SETUP_PREFER_NOT_TO_ANSWER
    : normalizeOptionValue(state.profile?.current_year, SETUP_YEAR_OPTIONS);
  const selectedConcentration = state.profile?.concentration_opt_out
    ? SETUP_PREFER_NOT_TO_ANSWER
    : normalizeOptionValue(state.profile?.concentration, SETUP_CONCENTRATION_OPTIONS);

  const fieldOptions = isYearField ? SETUP_YEAR_OPTIONS : SETUP_CONCENTRATION_OPTIONS;
  const pickerOptions = [
    { value: "", label: isYearField ? "Select year" : "Select concentration" },
    ...fieldOptions.map((value) => ({ value, label: value }))
  ];
  const selectedValue = isYearField ? selectedYear : selectedConcentration;
  const selectedOption = pickerOptions.find((option) => option.value === selectedValue) || pickerOptions[0];
  const selectId = isYearField ? "profile-edit-current-year" : "profile-edit-concentration";
  const pickerId = isYearField ? "profile-current-year-picker" : "profile-concentration-picker";
  const formId = isYearField ? "profile-academic-year-form" : "profile-academic-concentration-form";
  const errorId = isYearField ? "profile-edit-current-year-error" : "profile-edit-concentration-error";
  const saveButtonId = isYearField ? "profile-academic-year-save" : "profile-academic-concentration-save";
  const fieldLabel = isYearField ? "Current year" : "Concentration";
  const validationMessage = isYearField
    ? "Select your current year or choose Prefer not to answer."
    : "Select your concentration or choose Prefer not to answer.";

  const buildPickerMarkup = (selectId, pickerId, options, selectedOption) => {
    const selectOptions = options
      .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selectedOption.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
      .join("");
    return `
      <button
        type="button"
        id="${escapeHtml(pickerId)}"
        class="ui-btn ui-btn--secondary control-surface profile-picker-trigger profile-modal-picker-trigger"
        aria-haspopup="dialog"
      >
        <span class="picker-value">${escapeHtml(selectedOption.label)}</span>
        <span class="picker-chevron" aria-hidden="true">›</span>
      </button>
      <select id="${escapeHtml(selectId)}" class="profile-native-select" style="display:none;">
        ${selectOptions}
      </select>
    `;
  };

  const controlMarkup = useMobilePicker
    ? buildPickerMarkup(selectId, pickerId, pickerOptions, selectedOption)
    : renderCustomSelectMarkup(selectId, pickerOptions, selectedOption.value);

  const layer = openModal({
    title: fieldLabel,
    bodyMarkup: `
      <form id="${formId}" novalidate>
        <label class="profile-modal-label" for="${selectId}">${fieldLabel}</label>
        ${controlMarkup}
        <p class="profile-inline-error app-field-error-message" id="${errorId}"></p>
      </form>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="ui-btn ui-btn--secondary control-surface" form="${formId}" id="${saveButtonId}">Save</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  if (!useMobilePicker) {
    initializeProfileCustomSelects();
  } else {
    const pickerButton = layer.querySelector(`#${pickerId}`);
    const select = layer.querySelector(`#${selectId}`);

    pickerButton?.addEventListener("click", () => {
      openNestedChoicePicker({
        title: fieldLabel,
        options: pickerOptions,
        selectedValue: String(select?.value || ""),
        onSelect: async (value) => {
          if (select) {
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const selected = pickerOptions.find((option) => option.value === value) || pickerOptions[0];
          updatePickerLabel(pickerId, selected.label);
        }
      });
    });
  }

  const form = layer.querySelector(`#${formId}`);
  const academicFieldSelect = layer.querySelector(`#${selectId}`);
  const academicFieldErrorLine = layer.querySelector(`#${errorId}`);
  const academicFieldControl = useMobilePicker
    ? layer.querySelector(`#${pickerId}`)
    : (layer.querySelector(`[data-target="${selectId}"] .custom-select-trigger`) || academicFieldSelect);

  academicFieldSelect?.addEventListener("change", () => {
    clearFieldError(academicFieldSelect, {
      root: form || layer,
      highlightTarget: academicFieldControl,
      messageElement: academicFieldErrorLine
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fieldSelect = layer.querySelector(`#${selectId}`);
    const fieldErrorLine = layer.querySelector(`#${errorId}`);
    const fieldControl = useMobilePicker
      ? layer.querySelector(`#${pickerId}`)
      : (layer.querySelector(`[data-target="${selectId}"] .custom-select-trigger`) || fieldSelect);
    const fieldValue = String(fieldSelect?.value || "").trim();
    const fieldError = fieldValue && fieldOptions.includes(fieldValue) ? "" : validationMessage;

    clearFieldError(fieldSelect, {
      root: form || layer,
      highlightTarget: fieldControl,
      messageElement: fieldErrorLine
    });

    if (fieldError) {
      setFieldError(fieldSelect, fieldError, {
        root: form || layer,
        anchor: fieldControl,
        highlightTarget: fieldControl,
        messageElement: fieldErrorLine
      });
      return;
    }

    const fieldPayload = isYearField
      ? mapYearSelectionToPayload(fieldValue)
      : mapConcentrationSelectionToPayload(fieldValue);
    const nextProfile = normalizeSetupProfile({
      ...(state.profile || {}),
      ...fieldPayload
    });
    const yearAnswered = Boolean(nextProfile.current_year) || Boolean(nextProfile.year_opt_out);
    const concentrationAnswered = Boolean(nextProfile.concentration) || Boolean(nextProfile.concentration_opt_out);
    const setupComplete = yearAnswered && concentrationAnswered;
    const completionTimestamp = setupComplete
      ? (state.profile?.setup_completed_at || new Date().toISOString())
      : null;

    const payload = {
      id: state.user.id,
      display_name: getProfileDisplayName(state.profile, state.user),
      ...fieldPayload,
      setup_completed_at: completionTimestamp,
      setup_version: setupComplete
        ? Math.max(Number(state.profile?.setup_version || 0), 1)
        : Number(state.profile?.setup_version || 0),
      updated_at: new Date().toISOString()
    };

    const saveButton = layer.querySelector(`#${saveButtonId}`);
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    try {
      await upsertProfileSafe(payload);

      state.profile = normalizeSetupProfile({
        ...(state.profile || {}),
        display_name: payload.display_name,
        ...fieldPayload,
        setup_completed_at: payload.setup_completed_at,
        setup_version: payload.setup_version
      });

      if (window.router && typeof window.router.setSetupCompletionForCurrentUser === "function") {
        window.router.setSetupCompletionForCurrentUser(setupComplete, state.user?.id || null);
      }

      closeModal();
      renderSignedInView();
      applyRouteFocus(getCurrentProfileRoutePath());
      showProfileToast("Saved");
    } catch (error) {
      console.error("Profile: failed to save academic setup", error);
      setFieldError(fieldSelect, "Could not save right now.", {
        root: form || layer,
        anchor: fieldControl,
        highlightTarget: fieldControl,
        messageElement: fieldErrorLine
      });
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      }
    }
  });
}

async function upsertProfileSafe(payload) {
  if (state.profileSetupColumnsAvailable) {
    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (!error) {
      return;
    }

    const missingSetupColumn = ["current_year", "concentration", "year_opt_out", "concentration_opt_out", "setup_completed_at", "setup_version"]
      .some((column) => isMissingColumnError(error, column));

    if (missingSetupColumn) {
      state.profileSetupColumnsAvailable = false;
    } else if (isMissingColumnError(error, "program") || isMissingColumnError(error, "year")) {
      state.profileProgramYearColumnsAvailable = false;
      return upsertProfileSafe(payload);
    } else {
      throw error;
    }
  }

  if (state.profileProgramYearColumnsAvailable) {
    const legacyPayload = {
      id: payload.id,
      display_name: payload.display_name,
      updated_at: payload.updated_at
    };

    if (Object.prototype.hasOwnProperty.call(payload, "program")) {
      legacyPayload.program = payload.program;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "year")) {
      legacyPayload.year = payload.year;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(legacyPayload, { onConflict: "id" });

    if (!error) {
      return;
    }

    if (!isMissingColumnError(error, "program") && !isMissingColumnError(error, "year")) {
      throw error;
    }

    state.profileProgramYearColumnsAvailable = false;
  }

  const fallbackPayload = {
    id: payload.id,
    display_name: payload.display_name,
    updated_at: payload.updated_at
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(fallbackPayload, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function upsertSettingsSafe(settings) {
  if (!state.userSettingsTableAvailable || !state.user?.id) {
    return false;
  }

  const payload = {
    user_id: state.user.id,
    current_term: settings.currentTerm,
    language: settings.language,
    time_format: settings.timeFormat,
    week_start: settings.weekStart,
    full_card_colors: settings.fullCardColors,
    reduce_motion: settings.reduceMotion,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("user_settings").upsert(payload, { onConflict: "user_id" });

  if (error) {
    if (isMissingRelationError(error, "user_settings")) {
      state.userSettingsTableAvailable = false;
      return false;
    }
    throw error;
  }

  return true;
}

async function applySettingChanges(partialSettings) {
  const merged = mergeSettings(state.settings || buildInitialSettings(), partialSettings, state.semesters);
  state.settings = merged;

  syncSettingsToLocalStorage(merged);
  applyPreferencesToDocument(merged);

  if (merged.currentTerm) {
    propagateSelectedTerm(merged.currentTerm);
  }

  if (!state.isAuthenticated) {
    showProfileToast("Saved");
    return;
  }

  try {
    const persisted = await upsertSettingsSafe(merged);
    showProfileToast(persisted ? "Saved" : "Saved locally");
  } catch (error) {
    console.error("Profile: failed to persist settings", error);
    showProfileToast("Saved locally");
  }
}

async function signOutUser() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    queueLogoutSuccessToast();
    navigateTo("/");
  } catch (error) {
    console.error("Profile: sign out failed", error);
    showProfileToast("Sign out failed");
  }
}

function applyRouteFocus(route) {
  if (isMobileViewport() && state.mobileSectionView !== "detail") {
    return;
  }

  const normalizedRoute = normalizeProfileRoutePath(route || getCurrentProfileRoutePath());
  const sectionFromRoute = resolveProfileSectionIdFromRoutePath(normalizedRoute);
  let target = null;

  if (sectionFromRoute) {
    target = document.getElementById(sectionFromRoute);
  } else if (getProfileRouteBase(normalizedRoute) === "/settings") {
    target = document.getElementById(state.isAuthenticated ? "profile-preferences" : "profile-identity");
  }

  if (!target) return;

  window.setTimeout(() => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

async function loadSignedInState() {
  const baseSettings = buildInitialSettings();
  const semesters = await fetchSemestersSafe();

  const [profileRow, settingsRow, _identities, studentReviews] = await Promise.all([
    fetchProfileSafe(state.user),
    fetchUserSettingsSafe(state.user.id),
    refreshUserIdentities(state.user),
    fetchStudentReviewsSafe(state.user.id)
  ]);

  const mergedProfile = {
    ...(profileRow || {}),
    display_name: getProfileDisplayName(profileRow, state.user)
  };
  state.profile = state.profileSetupColumnsAvailable
    ? normalizeSetupProfile(mergedProfile)
    : mergedProfile;

  state.semesters = semesters;
  state.settings = mergeSettings(baseSettings, settingsRow, semesters);
  state.studentReviews = Array.isArray(studentReviews) ? studentReviews : [];

  syncSettingsToLocalStorage(state.settings);
  applyPreferencesToDocument(state.settings);

  if (state.settings.currentTerm) {
    propagateSelectedTerm(state.settings.currentTerm);
  }
}

async function initializeProfile() {
  const root = getRoot();
  if (!root) {
    teardownProfileSectionNavigation();
    teardownProfileMobileHeaderBehavior();
    return;
  }

  teardownProfileSectionNavigation();
  initializeProfileMobileHeaderBehavior();

  const route = getCurrentProfileRoutePath();

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;

    state.session = session;
    state.user = session?.user || null;
    state.isAuthenticated = Boolean(state.user);

    closeModal();

    if (!state.isAuthenticated) {
      state.studentReviews = [];
      teardownProfileSectionNavigation();
      navigateTo("/login");
      return;
    }

    renderSignedInSkeleton();
    await loadSignedInState();
    renderSignedInView();
    const queuedToast = consumeQueuedProfileToast();
    if (queuedToast) {
      if (queuedToast.variant === "error") {
        showGlobalBottomToast(queuedToast.message, "error", 3200);
      } else {
        showProfileToast(queuedToast.message, queuedToast.variant);
      }
    } else {
      const pendingOAuthMessage = consumePendingOAuthLinkErrorMessage(state.user);
      if (pendingOAuthMessage) {
        showGlobalBottomToast(pendingOAuthMessage, "error", 3200);
      }
    }
    applyRouteFocus(route);
  } catch (error) {
    renderLoadError(error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeProfile);
} else {
  initializeProfile();
}

document.addEventListener("pageLoaded", (event) => {
  const eventRoute = normalizeProfileRoutePath(event?.detail?.path || "");
  const currentRoute = normalizeProfileRoutePath(getCurrentAppPath());
  const isProfileContext = isProfileContextPath(eventRoute) || isProfileContextPath(currentRoute);

  if (isProfileContext) {
    window.setTimeout(() => initializeProfile(), 20);
    return;
  }
  teardownProfileSectionNavigation();
  teardownProfileMobileHeaderBehavior();
});

export { initializeProfile };
window.initializeProfile = initializeProfile;
