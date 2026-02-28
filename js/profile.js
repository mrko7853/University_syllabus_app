import { supabase } from "../supabase.js";
import { fetchAvailableSemesters } from "./shared.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
import {
  buildProviderLinks,
  disconnectAllCalendarFeeds,
  ensureCalendarFeeds,
  fetchCalendarIntegrationState,
  rotateCalendarFeeds
} from "./calendar-integrations.js";
import {
  PREFERENCE_KEYS,
  DEFAULT_PREFERENCES,
  applyPreferencesToDocument,
  applyPreferredTermToGlobals,
  getPreferredTermValue,
  getStoredPreferences,
  parseTermValue,
  setPreferredTermValue,
  setStoredPreference,
  clearStoredPreferences,
  normalizeTermValue
} from "./preferences.js";

const PROFILE_ROUTES = new Set(["/profile", "/settings"]);
const AUTH_PROMPT_KEY = "ila_profile_auth_prompt";
const PROFILE_MODAL_LAYER_ID = "profile-modal-layer";
let profileCustomSelectDocumentHandler = null;
let profileHeaderScrollCleanup = null;

const state = {
  isAuthenticated: false,
  session: null,
  user: null,
  profile: null,
  settings: null,
  calendarIntegrationState: null,
  calendarIntegrationError: null,
  semesters: [],
  userSettingsTableAvailable: true,
  profileProgramYearColumnsAvailable: true
};

function getDefaultCalendarIntegrationState() {
  return {
    status: "not_connected",
    settings: {
      feedMode: "separate",
      timezone: "Asia/Tokyo",
      scope: "selected_term",
      assignmentsRule: "incomplete_only"
    },
    feeds: []
  };
}

function normalizeCalendarIntegrationState(payload) {
  if (!payload || typeof payload !== "object") {
    return getDefaultCalendarIntegrationState();
  }

  const rawSettings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const feedMode = String(rawSettings.feedMode || "").toLowerCase() === "combined" ? "combined" : "separate";

  const normalizedFeeds = Array.isArray(payload.feeds)
    ? payload.feeds
      .map((feed) => {
        const kindRaw = String(feed?.kind || "").toLowerCase();
        const kind = ["courses", "assignments", "combined"].includes(kindRaw) ? kindRaw : null;
        const httpsUrl = String(feed?.httpsUrl || "").trim();
        if (!kind || !httpsUrl) return null;
        return {
          kind,
          httpsUrl,
          webcalUrl: String(feed?.webcalUrl || "").trim(),
          googleSubscribeUrl: String(feed?.googleSubscribeUrl || "").trim()
        };
      })
      .filter(Boolean)
    : [];

  return {
    status: normalizedFeeds.length > 0 ? "connected" : "not_connected",
    settings: {
      feedMode,
      timezone: String(rawSettings.timezone || "Asia/Tokyo"),
      scope: "selected_term",
      assignmentsRule: "incomplete_only"
    },
    feeds: normalizedFeeds
  };
}

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
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const term = month >= 8 || month <= 2 ? "Fall" : "Spring";
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

  const profileColumns = "id, display_name, avatar_url, program, year";
  const fallbackColumns = "id, display_name, avatar_url";

  if (state.profileProgramYearColumnsAvailable) {
    const { data, error } = await supabase
      .from("profiles")
      .select(profileColumns)
      .eq("id", user.id)
      .maybeSingle();

    if (!error) {
      return data;
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

function getCalendarFeedLabel(kind) {
  if (kind === "courses") return "Courses";
  if (kind === "assignments") return "Assignments";
  return "Courses + Assignments";
}

function getKindsForFeedMode(feedMode) {
  return feedMode === "combined" ? ["combined"] : ["courses", "assignments"];
}

function cardTemplate(title, bodyMarkup, actionMarkup = "") {
  return `
    <div class="profile-card card-surface">
      <div class="card-head">
        <h2>${escapeHtml(title)}</h2>
        ${actionMarkup}
      </div>
      <div class="card-body">${bodyMarkup}</div>
    </div>
  `;
}

function renderSignedInSkeleton() {
  const sections = [
    "profile-identity",
    "profile-academic",
    "profile-preferences",
    "profile-integrations",
    "profile-data-privacy",
    "profile-auth"
  ];

  sections.forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;

    node.innerHTML = `
      <div class="profile-card card-surface profile-skeleton-card" aria-hidden="true">
        <div class="card-head">
          <h2 class="profile-skeleton-line profile-skeleton-title"></h2>
        </div>
        <div class="card-body">
          <div class="profile-skeleton-line"></div>
          <div class="profile-skeleton-line profile-skeleton-line-short"></div>
          <div class="profile-skeleton-line"></div>
        </div>
      </div>
    `;
  });
}

function renderLoadError(error) {
  console.error("Profile: failed to load", error);

  const identity = document.getElementById("profile-identity");
  if (!identity) return;

  identity.innerHTML = cardTemplate(
    "Could not load profile",
    `
      <p class="profile-inline-error">We couldn't load your profile right now. Please try again.</p>
      <button class="control-surface" id="profile-retry-button" type="button">Retry</button>
    `
  );

  ["profile-academic", "profile-preferences", "profile-integrations", "profile-data-privacy", "profile-auth"].forEach((id) => {
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
    <button type="button" class="toggle" id="${escapeHtml(id)}" role="switch" aria-checked="${checked ? "true" : "false"}">
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
      class="control-surface profile-picker-trigger"
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
    <button type="button" class="nav-row" id="${escapeHtml(id)}" data-action="${escapeHtml(action)}">
      <span class="nav-row-left">
        <span class="nav-row-icon" aria-hidden="true">${escapeHtml(icon)}</span>
        <span class="nav-row-label">${escapeHtml(label)}</span>
      </span>
      <span class="nav-row-right">
        ${soon ? '<span class="status-pill status-pill--soon">Soon</span>' : ""}
        <span class="nav-row-chevron" aria-hidden="true">›</span>
      </span>
    </button>
  `;
}

function renderHelpBody() {
  return `
    <div class="profile-nav-list">
      <button class="control-surface" id="profile-open-about" type="button">About</button>
    </div>
  `;
}

function renderGuestView(route) {
  const promptText = consumeGuestPrompt(route);

  const identity = document.getElementById("profile-identity");
  const academic = document.getElementById("profile-academic");
  const preferences = document.getElementById("profile-preferences");
  const integrations = document.getElementById("profile-integrations");
  const dataPrivacy = document.getElementById("profile-data-privacy");
  const auth = document.getElementById("profile-auth");

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Guest mode",
      `
        <p class="profile-body-copy">Browse courses without an account. Sign in to save your schedule.</p>
        ${promptText ? `<p class="profile-inline-notice">${escapeHtml(promptText)}</p>` : ""}
        <div class="profile-inline-actions">
          <button class="control-surface" id="guest-browse-courses-btn" type="button">Browse Courses</button>
          <button class="control-surface" id="guest-signin-btn" type="button">Sign In</button>
          <button class="control-surface" id="guest-register-btn" type="button">Create Account</button>
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
  if (integrations) integrations.innerHTML = "";
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
      return `<div class="custom-select-option${isSelected ? " selected" : ""}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</div>`;
    })
    .join("");

  const selectOptions = normalizedOptions
    .map((option) => {
      const isSelected = option.value === (selected?.value || "");
      return `<option value="${escapeHtml(option.value)}"${isSelected ? " selected" : ""}>${escapeHtml(option.label)}</option>`;
    })
    .join("");

  return `
    <div class="custom-select profile-custom-select${isDisabled ? " is-disabled" : ""}" data-target="${escapeHtml(selectId)}">
      <div class="custom-select-trigger control-surface" tabindex="${isDisabled ? "-1" : "0"}" role="button" aria-haspopup="listbox" aria-expanded="false" aria-disabled="${isDisabled ? "true" : "false"}">
        <span class="custom-select-value">${escapeHtml(selected?.label || "Select")}</span>
        <div class="custom-select-arrow"></div>
      </div>
      <div class="custom-select-options" role="listbox">
        <div class="custom-select-options-inner">
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
  const integrations = document.getElementById("profile-integrations");
  const dataPrivacy = document.getElementById("profile-data-privacy");
  const auth = document.getElementById("profile-auth");

  const displayName = getProfileDisplayName(state.profile, state.user);
  const email = state.user?.email || "";
  const initials = getInitials(displayName, email);
  const programValue = state.profile?.program ? String(state.profile.program) : "";
  const yearValue = state.profile?.year ? String(state.profile.year) : "";
  const hasProgram = Boolean(programValue);
  const hasYear = Boolean(yearValue);
  const setupLabel = hasProgram || hasYear ? "Edit" : "Set Up";
  const useMobilePicker = isMobileViewport();

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Identity",
      `
        <div class="profile-identity">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="identity-meta">
            <div class="name">${escapeHtml(displayName)}</div>
            <div class="email">${escapeHtml(email)}</div>
            <div class="status-pill status-pill--signed-in">Signed in</div>
          </div>
        </div>
      `,
      `
        <button class="profile-action-pill control-surface" id="profile-edit-button" aria-label="Edit profile" type="button">
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
          "Program",
          "Your current program",
          `${
            hasProgram
              ? `<span class="status-pill status-pill--value">${escapeHtml(programValue)}</span>`
              : '<span class="status-pill status-pill--not-set">Not Set</span>'
          }<button class="profile-action-pill control-surface${setupLabel === "Set Up" ? " profile-action-pill--setup" : ""}" type="button" data-action="setup-program-year">${escapeHtml(setupLabel)}</button>`,
          "setting-row--program-year"
        )}
        ${settingRow(
          "Year",
          "Current year",
          `${
            hasYear
              ? `<span class="status-pill status-pill--value">Year ${escapeHtml(yearValue)}</span>`
              : '<span class="status-pill status-pill--not-set">Not Set</span>'
          }<button class="profile-action-pill control-surface${setupLabel === "Set Up" ? " profile-action-pill--setup" : ""}" type="button" data-action="setup-program-year">${escapeHtml(setupLabel)}</button>`,
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

  if (integrations) {
    const integrationState = normalizeCalendarIntegrationState(state.calendarIntegrationState);
    const isConnected = integrationState.status === "connected";
    const feedModeLabel = integrationState.settings.feedMode === "combined" ? "Combined feed" : "Separate feeds";
    const feedCount = integrationState.feeds.length;
    const statusLabel = isConnected ? "Connected" : "Not connected";
    const helperText = state.calendarIntegrationError
      ? "Calendar integration service is temporarily unavailable."
      : (isConnected
        ? `${feedModeLabel} active (${feedCount} ${feedCount === 1 ? "feed" : "feeds"}).`
        : "Subscribe from Google Calendar.");

    integrations.innerHTML = cardTemplate(
      "Integrations",
      `
        ${settingRow(
          "Calendar access",
          "Current integration status",
          `
            <span class="status-pill status-pill--neutral">${escapeHtml(statusLabel)}</span>
            <button class="profile-action-pill profile-action-pill--integration control-surface" id="profile-manage-integrations" type="button">
              <span class="pill-icon pill-icon--calendar-plus" aria-hidden="true"></span>
              <span>Manage</span>
            </button>
          `,
          "setting-row--integration"
        )}
      `
    );
  }

  if (dataPrivacy) {
    dataPrivacy.innerHTML = cardTemplate(
      "Data & Privacy",
      `
        <div class="profile-subblock">
          <h3 class="profile-subtitle">Utilities</h3>
          <div class="setting-row-id">${settingRow("Clear cache", "Remove local preferences and temporary data", '<button class="control-surface" id="profile-clear-cache" type="button">Clear Cache</button>')}</div>
        </div>
        <div class="profile-subblock" id="profile-help-subblock">
          <h3 class="profile-subtitle">App Version</h3>
          <div class="setting-row-id">${settingRow("Version", "Current application version", `${renderHelpBody()}`)}</div>
        </div>
        <div class="danger-zone">
          <h3 class="profile-subtitle">Danger Zone</h3>
          <div class="danger-zone-row">
            <button class="danger-action-btn" id="profile-delete-account" type="button">
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
      `<div class="profile-subblock">
          <div class="setting-row-id">${settingRow("Sign out", "End your session and return to the login screen", '<button class="control-surface" id="profile-signout" type="button">Sign Out</button>')}</div>
       </div>`
    );
  }

  bindSignedInActions();
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

  document.querySelectorAll("[data-action='setup-program-year']").forEach((button) => {
    button.addEventListener("click", openProgramYearSetupModal);
  });

  document.getElementById("profile-manage-integrations")?.addEventListener("click", openCalendarIntegrationsModal);
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
    <div class="profile-modal card-surface profile-modal--${escapeHtml(resolvedMode)}${modalClassName ? ` ${escapeHtml(modalClassName)}` : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      ${showSwipeIndicator ? '<div class="swipe-indicator" aria-hidden="true"></div>' : ""}
      <div class="profile-modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="control-surface icon-btn" data-modal-close="true" aria-label="Close"></button>
      </div>
      <div class="profile-modal-body">${bodyMarkup}</div>
      ${footerMarkup ? `<div class="profile-modal-footer">${footerMarkup}</div>` : ""}
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

  if (resolvedMode === "sheet" || resolvedMode === "fullscreen") {
    document.body.classList.add("modal-open");
  }

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
    footerMarkup: `<button type="button" class="control-surface" data-modal-close="true">Cancel</button>`,
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
    <div class="profile-modal card-surface profile-modal--sheet profile-modal--swipe profile-modal--picker-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="swipe-indicator" aria-hidden="true"></div>
      <div class="profile-modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="control-surface icon-btn" data-modal-close="true" aria-label="Close"></button>
      </div>
      <div class="profile-modal-body">${bodyMarkup}</div>
      <div class="profile-modal-footer">
        <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
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

function getCalendarFeedRowsMarkup(integrationState) {
  if (!integrationState.feeds.length) {
    return '<p class="profile-picker-help">No feed links yet. Choose a mode and click Save mode to connect.</p>';
  }

  return integrationState.feeds
    .map((feed) => {
      const links = buildProviderLinks(feed);
      return `
        <div class="calendar-integration-feed-card">
          <div class="calendar-integration-feed-head">
            <h4>${escapeHtml(getCalendarFeedLabel(feed.kind))}</h4>
            <span class="status-pill status-pill--neutral">Active</span>
          </div>
          <div class="calendar-integration-feed-actions">
            <a class="control-surface" href="${escapeHtml(links.googleSubscribeUrl)}" target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
            <button class="control-surface" type="button" data-action="copy-feed-url" data-url="${escapeHtml(links.httpsUrl)}">Copy Subscription URL</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function openCalendarIntegrationsModal() {
  const initialState = normalizeCalendarIntegrationState(state.calendarIntegrationState);
  const local = {
    data: initialState,
    busy: false,
    error: state.calendarIntegrationError ? "Could not refresh integration state right now." : ""
  };

  const layer = openModal({
    title: "Calendar Integrations",
    bodyMarkup: `
      <div id="calendar-integrations-modal-content"></div>
    `,
    mode: "fullscreen-mobile"
  });

  const content = layer.querySelector("#calendar-integrations-modal-content");
  if (!content) return;
  const useMobileFeedModePicker = isMobileViewport();

  const render = () => {
    const modeValue = local.data.settings.feedMode === "combined" ? "combined" : "separate";
    const saveLabel = local.data.status === "connected" ? "Save Mode" : "Connect";
    const disableAttr = local.busy ? " disabled" : "";
    const feedModeOptions = [
      { value: "separate", label: "Separate Calendars" },
      { value: "combined", label: "Single Combined Calendar" }
    ];
    const selectedFeedModeOption = feedModeOptions.find((option) => option.value === modeValue) || feedModeOptions[0];
    const feedModeControlMarkup = useMobileFeedModePicker
      ? `
        <button
          type="button"
          id="calendar-feed-mode-picker"
          class="control-surface profile-picker-trigger profile-modal-picker-trigger"
          aria-haspopup="dialog"
          ${local.busy ? "disabled" : ""}
        >
          <span class="picker-value">${escapeHtml(selectedFeedModeOption.label)}</span>
          <span class="picker-chevron" aria-hidden="true">›</span>
        </button>
        <select id="calendar-feed-mode-select" class="profile-native-select" style="display:none;"${local.busy ? " disabled" : ""}>
          ${feedModeOptions
            .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === modeValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
            .join("")}
        </select>
      `
      : renderCustomSelectMarkup("calendar-feed-mode-select", feedModeOptions, modeValue, { disabled: local.busy });

    content.innerHTML = `
      <p class="profile-picker-help">Create private subscription links for Google Calendar.</p>
      ${local.error ? `<p class="profile-inline-error">${escapeHtml(local.error)}</p>` : ""}
      <div class="calendar-integration-mode-row">
        <label class="profile-modal-label" for="calendar-feed-mode-select">Feed mode</label>
        <div class="calendar-integration-mode-controls">
          ${feedModeControlMarkup}
          <button class="control-surface" type="button" id="calendar-feed-mode-save"${disableAttr}>${escapeHtml(saveLabel)}</button>
        </div>
      </div>
      <div class="calendar-integration-feed-list">
        ${getCalendarFeedRowsMarkup(local.data)}
      </div>
      <div class="calendar-integration-security-row">
        <button class="control-surface" type="button" id="calendar-rotate-links"${disableAttr}>Regenerate Links</button>
        <button class="danger-action-btn" type="button" id="calendar-disconnect-links"${disableAttr}>Disconnect</button>
      </div>
    `;
    if (!useMobileFeedModePicker) {
      initializeProfileCustomSelects();
    } else {
      const feedModePickerButton = content.querySelector("#calendar-feed-mode-picker");
      const feedModeSelect = content.querySelector("#calendar-feed-mode-select");

      feedModePickerButton?.addEventListener("click", () => {
        if (feedModePickerButton.disabled) return;
        openNestedChoicePicker({
          title: "Feed mode",
          description: "Choose how subscription feeds are grouped.",
          options: feedModeOptions,
          selectedValue: String(feedModeSelect?.value || modeValue),
          onSelect: async (value) => {
            if (feedModeSelect) {
              feedModeSelect.value = value;
              feedModeSelect.dispatchEvent(new Event("change", { bubbles: true }));
            }

            const selected = feedModeOptions.find((option) => option.value === value) || feedModeOptions[0];
            updatePickerLabel("calendar-feed-mode-picker", selected.label);
          }
        });
      });
    }

    content.querySelector("#calendar-feed-mode-save")?.addEventListener("click", async () => {
      const select = content.querySelector("#calendar-feed-mode-select");
      const selectedMode = String(select?.value || local.data.settings.feedMode || "separate").toLowerCase() === "combined"
        ? "combined"
        : "separate";

      local.busy = true;
      local.error = "";
      render();

      try {
        const next = await ensureCalendarFeeds(selectedMode);
        local.data = normalizeCalendarIntegrationState(next);
        state.calendarIntegrationState = local.data;
        state.calendarIntegrationError = null;
        renderSignedInView();
        showProfileToast("Calendar updated");
      } catch (error) {
        console.error("Profile: ensure calendar feeds failed", error);
        local.error = "Could not save calendar mode.";
        state.calendarIntegrationError = error;
      } finally {
        local.busy = false;
        render();
      }
    });

    content.querySelector("#calendar-rotate-links")?.addEventListener("click", async () => {
      const feedMode = local.data.settings.feedMode;
      const fallbackKinds = getKindsForFeedMode(feedMode);
      const activeKinds = local.data.feeds.map((feed) => feed.kind);
      const kinds = activeKinds.length > 0 ? activeKinds : fallbackKinds;

      local.busy = true;
      local.error = "";
      render();

      try {
        const next = await rotateCalendarFeeds(kinds);
        local.data = normalizeCalendarIntegrationState(next);
        state.calendarIntegrationState = local.data;
        state.calendarIntegrationError = null;
        renderSignedInView();
        showProfileToast("Links regenerated");
      } catch (error) {
        console.error("Profile: rotate calendar feeds failed", error);
        local.error = "Could not regenerate links.";
        state.calendarIntegrationError = error;
      } finally {
        local.busy = false;
        render();
      }
    });

    content.querySelector("#calendar-disconnect-links")?.addEventListener("click", async () => {
      local.busy = true;
      local.error = "";
      render();

      try {
        const next = await disconnectAllCalendarFeeds();
        local.data = normalizeCalendarIntegrationState(next);
        state.calendarIntegrationState = local.data;
        state.calendarIntegrationError = null;
        renderSignedInView();
        showProfileToast("Disconnected");
      } catch (error) {
        console.error("Profile: disconnect calendar feeds failed", error);
        local.error = "Could not disconnect calendar links.";
        state.calendarIntegrationError = error;
      } finally {
        local.busy = false;
        render();
      }
    });

    content.querySelectorAll("[data-action='copy-feed-url']").forEach((button) => {
      button.addEventListener("click", async () => {
        const url = button.getAttribute("data-url") || "";
        if (!url) return;

        try {
          await navigator.clipboard.writeText(url);
          showProfileToast("Link copied");
        } catch (error) {
          console.warn("Clipboard copy failed", error);
          window.prompt("Copy subscription URL:", url);
        }
      });
    });

  };

  render();

  fetchCalendarIntegrationState()
    .then((freshState) => {
      local.data = normalizeCalendarIntegrationState(freshState);
      state.calendarIntegrationState = local.data;
      state.calendarIntegrationError = null;
      renderSignedInView();
      render();
    })
    .catch((error) => {
      console.warn("Profile: calendar integration refresh failed", error);
      local.error = "Using last known data. Some actions may fail.";
      state.calendarIntegrationError = error;
      render();
    });
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
    footerMarkup: `<button type="button" class="control-surface" data-modal-close="true">Close</button>`
  });
}

function openClearCacheModal() {
  const layer = openModal({
    title: "Clear Cache",
    bodyMarkup: `<p>Clear locally stored app preferences and temporary cache?</p>`,
    footerMarkup: `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="control-surface" id="profile-confirm-clear-cache">Clear Cache</button>
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
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="danger-action-btn" id="profile-confirm-delete" disabled>Delete Account</button>
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
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="control-surface" id="profile-confirm-signout">Sign Out</button>
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
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="control-surface" form="profile-edit-form" id="profile-edit-save">Save</button>
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

function openProgramYearSetupModal() {
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
        class="control-surface profile-picker-trigger profile-modal-picker-trigger"
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
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="control-surface" form="profile-program-year-form" id="profile-program-year-save">Save</button>
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

async function upsertProfileSafe(payload) {
  if (state.profileProgramYearColumnsAvailable) {
    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

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

  const [profileRow, settingsRow, integrationResult] = await Promise.all([
    fetchProfileSafe(state.user),
    fetchUserSettingsSafe(state.user.id),
    fetchCalendarIntegrationState()
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }))
  ]);

  state.profile = {
    ...(profileRow || {}),
    display_name: getProfileDisplayName(profileRow, state.user)
  };

  state.semesters = semesters;
  state.settings = mergeSettings(baseSettings, settingsRow, semesters);
  state.calendarIntegrationState = normalizeCalendarIntegrationState(integrationResult.data);
  state.calendarIntegrationError = integrationResult.error;

  syncSettingsToLocalStorage(state.settings);
  applyPreferencesToDocument(state.settings);

  if (state.settings.currentTerm) {
    propagateSelectedTerm(state.settings.currentTerm);
  }
}

async function initializeProfile() {
  const root = getRoot();
  if (!root) {
    teardownProfileMobileHeaderBehavior();
    return;
  }

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
  teardownProfileMobileHeaderBehavior();
});

export { initializeProfile };
window.initializeProfile = initializeProfile;
