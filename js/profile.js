import { supabase } from "../supabase.js";
import { fetchAvailableSemesters } from "./shared.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
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

const PROFILE_ROUTES = new Set(["/profile", "/settings"]);
const AUTH_PROMPT_KEY = "ila_profile_auth_prompt";
const AUTH_LOGOUT_TOAST_KEY = "ila_auth_logout_toast";
const PROFILE_MODAL_LAYER_ID = "profile-modal-layer";
const PROFILE_HEADER_BACK_BUTTON_ID = "profile-header-back-btn";
const PROFILE_SECTION_CONFIG = [
  { id: "profile-identity", label: "Identity", iconClass: "profile-section-icon--identity" },
  { id: "profile-academic", label: "Academic", iconClass: "profile-section-icon--academic" },
  { id: "profile-preferences", label: "Preferences", iconClass: "profile-section-icon--preferences" },
  { id: "profile-data-privacy", label: "Data & Privacy", iconClass: "profile-section-icon--privacy" },
  { id: "profile-auth", label: "Sign Out", iconClass: "profile-section-icon--signout" }
];
let profileCustomSelectDocumentHandler = null;
let profileHeaderScrollCleanup = null;
let profileSectionResizeHandler = null;
let profileSectionEnterAnimationTimer = null;

const state = {
  isAuthenticated: false,
  session: null,
  user: null,
  profile: null,
  settings: null,
  semesters: [],
  mobileSectionView: "list",
  activeSectionId: "profile-identity",
  userSettingsTableAvailable: true,
  profileProgramYearColumnsAvailable: true,
  profileSetupColumnsAvailable: true
};

function getRoot() {
  return document.getElementById("profile-main");
}

function getCurrentRouteForProfile() {
  const route = getCurrentAppPath();
  return PROFILE_ROUTES.has(route) ? route : "/profile";
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
      applyProfileSectionState({ scrollToTop: true });
    });
  });

  document.querySelectorAll("[data-profile-section-link='mobile']").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-profile-section-target");
      if (!target) return;
      state.mobileSectionView = "detail";
      state.activeSectionId = resolveProfileSectionId(target);
      applyProfileSectionState({ scrollToTop: true });
    });
  });
}

function initializeProfileSectionNavigation(route = getCurrentRouteForProfile()) {
  renderProfileSectionNavigation();
  bindProfileSectionNavigationActions();

  if (!state.activeSectionId) {
    state.activeSectionId = getDefaultProfileSectionId();
  }

  if (route === "/settings") {
    state.activeSectionId = resolveProfileSectionId("profile-preferences");
  } else {
    state.activeSectionId = resolveProfileSectionId(state.activeSectionId);
  }

  if (isMobileViewport()) {
    if (route === "/settings") {
      state.mobileSectionView = "detail";
    } else if (state.mobileSectionView !== "detail") {
      state.mobileSectionView = "list";
    }
  }

  applyProfileSectionState();

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
  merged.language = String(merged.language || "en").toLowerCase() === "ja" ? "ja" : "en";
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
  if (route === "/settings") {
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
  return String(value || "en").toLowerCase() === "ja" ? "日本語" : "English";
}

function getTimeFormatLabel(value) {
  return String(value || "12") === "24" ? "24-hour" : "12-hour";
}

function canUserManagePassword(user = state.user) {
  const provider = String(user?.app_metadata?.provider || "").toLowerCase();
  if (provider === "email") return true;

  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.some((identity) => String(identity?.provider || "").toLowerCase() === "email");
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
  const route = getCurrentRouteForProfile();
  const isMobile = isMobileViewport();
  const sections = [
    "profile-identity",
    "profile-academic",
    "profile-preferences",
    "profile-data-privacy",
    "profile-auth"
  ];

  state.activeSectionId = resolveProfileSectionId(
    route === "/settings" ? "profile-preferences" : state.activeSectionId
  );

  if (isMobile) {
    state.mobileSectionView = route === "/settings" ? "detail" : "list";
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

  ["profile-academic", "profile-preferences", "profile-data-privacy", "profile-auth"].forEach((id) => {
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
  const preferences = document.getElementById("profile-preferences");
  const dataPrivacy = document.getElementById("profile-data-privacy");
  const auth = document.getElementById("profile-auth");

  const displayName = getProfileDisplayName(state.profile, state.user);
  const email = state.user?.email || "";
  const initials = getInitials(displayName, email);
  const hasConcentration = isSetupFieldCompleted(state.profile, "concentration");
  const hasYear = isSetupFieldCompleted(state.profile, "year");
  const setupLabel = hasConcentration || hasYear ? "Edit" : "Set Up";
  const concentrationLabel = getSetupConcentrationLabel(state.profile);
  const yearLabel = getSetupYearLabel(state.profile);
  const useMobilePicker = isMobileViewport();
  const canManagePassword = canUserManagePassword(state.user);

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Identity",
      `
        <div class="profile-identity">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="identity-meta">
            <div class="name">${escapeHtml(displayName)}</div>
            <div class="email">${escapeHtml(email)}</div>
            <div class="ui-pill status-pill status-pill--signed-in">Signed in</div>
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
          }<button class="ui-btn ui-btn--icon filter-btn control-surface control-surface--secondary profile-action-pill${setupLabel === "Set Up" ? " profile-action-pill--setup" : ""}" type="button" data-action="setup-academic">${escapeHtml(setupLabel)}</button>`,
          "setting-row--program-year"
        )}
        ${settingRow(
          "Current year",
          "Current year",
          `${
            hasYear
              ? `<span class="ui-pill status-pill status-pill--value">${escapeHtml(yearLabel)}</span>`
              : '<span class="ui-pill status-pill status-pill--not-set">Not Set</span>'
          }<button class="ui-btn ui-btn--icon filter-btn control-surface control-surface--secondary profile-action-pill${setupLabel === "Set Up" ? " profile-action-pill--setup" : ""}" type="button" data-action="setup-academic">${escapeHtml(setupLabel)}</button>`,
          "setting-row--program-year"
        )}
      `
    );
  }

  if (preferences) {
    const languageOptions = [
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" }
    ];

    const timeFormatOptions = [
      { value: "12", label: "12-hour" },
      { value: "24", label: "24-hour" }
    ];

    const languageControl = useMobilePicker
      ? pickerButton("pref-language-picker", "language", getLanguageLabel(state.settings.language))
      : renderCustomSelectMarkup("pref-language", languageOptions, state.settings.language);

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
  initializeProfileSectionNavigation(getCurrentRouteForProfile());
}

function bindGuestActions() {
  document.getElementById("guest-browse-courses-btn")?.addEventListener("click", () => navigateTo("/courses"));
  document.getElementById("guest-signin-btn")?.addEventListener("click", () => navigateTo("/login"));
  document.getElementById("guest-register-btn")?.addEventListener("click", () => navigateTo("/register"));

  document.querySelectorAll("[data-action='require-auth']").forEach((button) => {
    button.addEventListener("click", () => navigateTo("/login"));
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

    document.getElementById("pref-language")?.addEventListener("change", async (event) => {
      await applySettingChanges({ language: event.target.value });
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

  document.querySelectorAll("[data-action='setup-academic']").forEach((button) => {
    button.addEventListener("click", openAcademicSetupModal);
  });

  document.getElementById("profile-clear-cache")?.addEventListener("click", openClearCacheModal);
  document.getElementById("profile-delete-account")?.addEventListener("click", openDeleteAccountModal);
  document.getElementById("profile-open-about")?.addEventListener("click", openAboutModal);
  document.getElementById("profile-signout")?.addEventListener("click", openSignOutModal);
}

function showProfileToast(message = "Saved") {
  const previous = document.getElementById("profile-toast");
  if (previous) {
    previous.remove();
  }

  const toast = document.createElement("div");
  toast.id = "profile-toast";
  toast.className = "profile-toast";
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
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" }
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

function openAboutModal() {
  const version = import.meta.env.VITE_APP_VERSION || "1.0.0";
  const build = import.meta.env.MODE || "production";

  openModal({
    title: "About",
    bodyMarkup: `
      <div class="profile-about-grid">
        <div><strong>App</strong></div><div>ILA Companion</div>
        <div><strong>Version</strong></div><div>${escapeHtml(version)}</div>
        <div><strong>Build</strong></div><div>${escapeHtml(build)}</div>
      </div>
    `,
    footerMarkup: `<button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Close</button>`
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
      <p>This action permanently deletes your account and all related data.</p>
      <p>Type <strong>DELETE</strong> to confirm.</p>
      <input id="profile-delete-confirm-input" class="search-input profile-modal-input" type="text" autocomplete="off" spellcheck="false" />
      <p id="profile-delete-error" class="profile-inline-error"></p>
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

function openEditProfileModal() {
  const displayName = getProfileDisplayName(state.profile, state.user);

  const layer = openModal({
    title: "Edit Profile",
    bodyMarkup: `
      <form id="profile-edit-form" novalidate>
        <label class="profile-modal-label" for="profile-edit-display-name">Display name</label>
        <input class="search-input profile-modal-input" id="profile-edit-display-name" maxlength="30" required value="${escapeHtml(displayName)}" />
        <p class="profile-inline-error" id="profile-edit-name-error"></p>
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
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const nameInput = layer.querySelector("#profile-edit-display-name");
    const name = String(nameInput?.value || "").trim();

    let nameError = "";
    if (name.length < 2 || name.length > 30) {
      nameError = "Display name must be 2 to 30 characters.";
    }

    layer.querySelector("#profile-edit-name-error").textContent = nameError;

    if (nameError) return;

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
      applyRouteFocus(getCurrentRouteForProfile());
      showProfileToast("Saved");
    } catch (error) {
      console.error("Profile: failed to save profile", error);
      layer.querySelector("#profile-edit-name-error").textContent = "Could not save profile right now.";
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
        <p class="profile-modal-help">Enter your current password and choose a new one (at least 8 characters).</p>
        <label class="profile-modal-label" for="profile-old-password">Current password</label>
        <input class="search-input profile-modal-input" id="profile-old-password" type="password" minlength="1" maxlength="72" autocomplete="current-password" required />
        <label class="profile-modal-label" for="profile-new-password">New password</label>
        <input class="search-input profile-modal-input" id="profile-new-password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required />
        <label class="profile-modal-label" for="profile-confirm-password">Confirm new password</label>
        <input class="search-input profile-modal-input" id="profile-confirm-password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required />
        <p class="profile-inline-error" id="profile-password-error"></p>
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
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const oldPasswordInput = layer.querySelector("#profile-old-password");
    const passwordInput = layer.querySelector("#profile-new-password");
    const confirmInput = layer.querySelector("#profile-confirm-password");
    const errorLine = layer.querySelector("#profile-password-error");
    const saveButton = layer.querySelector("#profile-password-save");

    const oldPassword = String(oldPasswordInput?.value || "");
    const password = String(passwordInput?.value || "");
    const confirmPassword = String(confirmInput?.value || "");

    let errorMessage = "";
    if (oldPassword.length < 1) {
      errorMessage = "Current password is required.";
    } else if (!state.user?.email) {
      errorMessage = "Your account email is unavailable. Please sign out and sign back in.";
    } else if (password.length < 8) {
      errorMessage = "Password must be at least 8 characters.";
    } else if (password.length > 72) {
      errorMessage = "Password must be 72 characters or fewer.";
    } else if (password === oldPassword) {
      errorMessage = "New password must be different from current password.";
    } else if (password !== confirmPassword) {
      errorMessage = "Passwords do not match.";
    }

    if (errorLine) errorLine.textContent = errorMessage;
    if (errorMessage) return;

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
      if (errorLine) {
        if (isInvalidCurrentPassword) {
          errorLine.textContent = "Current password is incorrect.";
        } else if (message.includes("reauthentication") || message.includes("not fresh")) {
          errorLine.textContent = "Please sign out and sign back in, then try changing your password again.";
        } else {
          errorLine.textContent = "Could not update password right now. Please try again.";
        }
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
        <p class="profile-inline-error" id="profile-edit-program-error"></p>

        <label class="profile-modal-label" for="profile-edit-year">Year</label>
        ${yearControlMarkup}
        <p class="profile-inline-error" id="profile-edit-year-error"></p>
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
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const programInput = layer.querySelector("#profile-edit-program");
    const yearInput = layer.querySelector("#profile-edit-year");

    const programValue = String(programInput?.value || "").trim();
    const yearValue = String(yearInput?.value || "").trim();

    let programError = "";
    let yearError = "";

    if (programValue.length > 40) {
      programError = "Program must be 40 characters or fewer.";
    }

    if (yearValue && !/^[1-4]$/.test(yearValue)) {
      yearError = "Year must be a number from 1 to 4.";
    }

    layer.querySelector("#profile-edit-program-error").textContent = programError;
    layer.querySelector("#profile-edit-year-error").textContent = yearError;

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
      applyRouteFocus(getCurrentRouteForProfile());
      showProfileToast("Saved");
    } catch (error) {
      console.error("Profile: failed to save program/year", error);
      layer.querySelector("#profile-edit-program-error").textContent = "Could not save right now.";
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save";
      }
    }
  });
}

function openAcademicSetupModal() {
  if (!state.profileSetupColumnsAvailable) {
    openLegacyProgramYearSetupModal();
    return;
  }

  const useMobilePicker = isMobileViewport();
  const selectedYear = state.profile?.year_opt_out
    ? SETUP_PREFER_NOT_TO_ANSWER
    : normalizeOptionValue(state.profile?.current_year, SETUP_YEAR_OPTIONS);
  const selectedConcentration = state.profile?.concentration_opt_out
    ? SETUP_PREFER_NOT_TO_ANSWER
    : normalizeOptionValue(state.profile?.concentration, SETUP_CONCENTRATION_OPTIONS);

  const yearPickerOptions = [{ value: "", label: "Select year" }, ...SETUP_YEAR_OPTIONS.map((value) => ({ value, label: value }))];
  const concentrationPickerOptions = [{ value: "", label: "Select concentration" }, ...SETUP_CONCENTRATION_OPTIONS.map((value) => ({ value, label: value }))];
  const selectedYearOption = yearPickerOptions.find((option) => option.value === selectedYear) || yearPickerOptions[0];
  const selectedConcentrationOption = concentrationPickerOptions.find((option) => option.value === selectedConcentration) || concentrationPickerOptions[0];

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

  const yearControlMarkup = useMobilePicker
    ? buildPickerMarkup("profile-edit-current-year", "profile-current-year-picker", yearPickerOptions, selectedYearOption)
    : renderCustomSelectMarkup("profile-edit-current-year", yearPickerOptions, selectedYearOption.value);

  const concentrationControlMarkup = useMobilePicker
    ? buildPickerMarkup("profile-edit-concentration", "profile-concentration-picker", concentrationPickerOptions, selectedConcentrationOption)
    : renderCustomSelectMarkup("profile-edit-concentration", concentrationPickerOptions, selectedConcentrationOption.value);

  const layer = openModal({
    title: "Set Up Academic Details",
    bodyMarkup: `
      <form id="profile-academic-setup-form" novalidate>
        <label class="profile-modal-label" for="profile-edit-current-year">Current year</label>
        ${yearControlMarkup}
        <p class="profile-inline-error" id="profile-edit-current-year-error"></p>

        <label class="profile-modal-label" for="profile-edit-concentration">Concentration</label>
        ${concentrationControlMarkup}
        <p class="profile-inline-error" id="profile-edit-concentration-error"></p>
      </form>
    `,
    footerMarkup: `
      <button type="button" class="ui-btn ui-btn--secondary control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="ui-btn ui-btn--secondary control-surface" form="profile-academic-setup-form" id="profile-academic-setup-save">Save</button>
    `,
    mode: "dialog",
    mobileMode: "sheet"
  });

  if (!useMobilePicker) {
    initializeProfileCustomSelects();
  } else {
    const yearPickerButton = layer.querySelector("#profile-current-year-picker");
    const yearSelect = layer.querySelector("#profile-edit-current-year");
    const concentrationPickerButton = layer.querySelector("#profile-concentration-picker");
    const concentrationSelect = layer.querySelector("#profile-edit-concentration");

    yearPickerButton?.addEventListener("click", () => {
      openNestedChoicePicker({
        title: "Current year",
        options: yearPickerOptions,
        selectedValue: String(yearSelect?.value || ""),
        onSelect: async (value) => {
          if (yearSelect) {
            yearSelect.value = value;
            yearSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const selected = yearPickerOptions.find((option) => option.value === value) || yearPickerOptions[0];
          updatePickerLabel("profile-current-year-picker", selected.label);
        }
      });
    });

    concentrationPickerButton?.addEventListener("click", () => {
      openNestedChoicePicker({
        title: "Concentration",
        options: concentrationPickerOptions,
        selectedValue: String(concentrationSelect?.value || ""),
        onSelect: async (value) => {
          if (concentrationSelect) {
            concentrationSelect.value = value;
            concentrationSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const selected = concentrationPickerOptions.find((option) => option.value === value) || concentrationPickerOptions[0];
          updatePickerLabel("profile-concentration-picker", selected.label);
        }
      });
    });
  }

  const form = layer.querySelector("#profile-academic-setup-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const yearValue = String(layer.querySelector("#profile-edit-current-year")?.value || "").trim();
    const concentrationValue = String(layer.querySelector("#profile-edit-concentration")?.value || "").trim();

    const yearError = yearValue && SETUP_YEAR_OPTIONS.includes(yearValue)
      ? ""
      : "Select your current year or choose Prefer not to answer.";
    const concentrationError = concentrationValue && SETUP_CONCENTRATION_OPTIONS.includes(concentrationValue)
      ? ""
      : "Select your concentration or choose Prefer not to answer.";

    layer.querySelector("#profile-edit-current-year-error").textContent = yearError;
    layer.querySelector("#profile-edit-concentration-error").textContent = concentrationError;

    if (yearError || concentrationError) return;

    const yearPayload = mapYearSelectionToPayload(yearValue);
    const concentrationPayload = mapConcentrationSelectionToPayload(concentrationValue);
    const completionTimestamp = state.profile?.setup_completed_at || new Date().toISOString();

    const payload = {
      id: state.user.id,
      display_name: getProfileDisplayName(state.profile, state.user),
      ...yearPayload,
      ...concentrationPayload,
      setup_completed_at: completionTimestamp,
      setup_version: Math.max(Number(state.profile?.setup_version || 0), 1),
      updated_at: new Date().toISOString()
    };

    const saveButton = layer.querySelector("#profile-academic-setup-save");
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    try {
      await upsertProfileSafe(payload);

      state.profile = normalizeSetupProfile({
        ...(state.profile || {}),
        display_name: payload.display_name,
        ...yearPayload,
        ...concentrationPayload,
        setup_completed_at: payload.setup_completed_at,
        setup_version: payload.setup_version
      });

      if (window.router && typeof window.router.setSetupCompletionForCurrentUser === "function") {
        window.router.setSetupCompletionForCurrentUser(true, state.user?.id || null);
      }

      closeModal();
      renderSignedInView();
      applyRouteFocus(getCurrentRouteForProfile());
      showProfileToast("Saved");
    } catch (error) {
      console.error("Profile: failed to save academic setup", error);
      layer.querySelector("#profile-edit-concentration-error").textContent = "Could not save right now.";
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
  let target = null;

  if (route === "/settings") {
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

  const [profileRow, settingsRow] = await Promise.all([
    fetchProfileSafe(state.user),
    fetchUserSettingsSafe(state.user.id)
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

  const route = getCurrentRouteForProfile();

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;

    state.session = session;
    state.user = session?.user || null;
    state.isAuthenticated = Boolean(state.user);

    closeModal();

    if (!state.isAuthenticated) {
      teardownProfileSectionNavigation();
      navigateTo("/login");
      return;
    }

    renderSignedInSkeleton();
    await loadSignedInState();
    renderSignedInView();
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
  const route = event?.detail?.path || getCurrentAppPath();
  if (PROFILE_ROUTES.has(route)) {
    window.setTimeout(() => initializeProfile(), 20);
    return;
  }
  teardownProfileSectionNavigation();
  teardownProfileMobileHeaderBehavior();
});

export { initializeProfile };
window.initializeProfile = initializeProfile;
