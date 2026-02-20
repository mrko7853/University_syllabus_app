import { supabase } from "../supabase.js";
import { fetchAvailableSemesters } from "./shared.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
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

const PROFILE_ROUTES = new Set(["/profile", "/settings", "/help"]);
const AUTH_PROMPT_KEY = "ila_profile_auth_prompt";
const PROFILE_MODAL_LAYER_ID = "profile-modal-layer";
let profileCustomSelectDocumentHandler = null;

const state = {
  isAuthenticated: false,
  session: null,
  user: null,
  profile: null,
  settings: null,
  semesters: [],
  userSettingsTableAvailable: true,
  profileProgramYearColumnsAvailable: true
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
    "profile-help",
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

  ["profile-academic", "profile-preferences", "profile-integrations", "profile-data-privacy", "profile-help", "profile-auth"].forEach((id) => {
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
      ${navRow("profile-open-faq", "faq", "FAQ", "?")}
      ${navRow("profile-open-feedback", "feedback", "Feedback", "✉", true)}
      ${navRow("profile-open-bug", "bug", "Report a bug", "!", true)}
      ${navRow("profile-open-about", "about", "About", "i")}
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
  const help = document.getElementById("profile-help");
  const auth = document.getElementById("profile-auth");

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Guest mode",
      `
        <p class="profile-body-copy">Browse courses without an account. Sign in to save your schedule.</p>
        ${promptText ? `<p class="profile-inline-notice">${escapeHtml(promptText)}</p>` : ""}
        <div class="profile-inline-actions">
          <button class="control-surface" id="guest-browse-courses-btn" type="button">Browse courses</button>
          <button class="control-surface" id="guest-signin-btn" type="button">Sign in</button>
          <button class="control-surface" id="guest-register-btn" type="button">Create account</button>
        </div>
      `
    );
  }

  if (academic) {
    academic.innerHTML = cardTemplate(
      "What's unlocked with an account",
      `
        <div class="profile-nav-list">
          ${navRow("guest-save-timetable", "require-auth", "Save timetable", "✓")}
          ${navRow("guest-track-deadlines", "require-auth", "Track deadlines", "⌛")}
          ${navRow("guest-write-reviews", "require-auth", "Write reviews", "★")}
        </div>
      `
    );
  }

  if (help) {
    help.innerHTML = cardTemplate("Help & About", renderHelpBody());
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

function renderCustomSelectMarkup(selectId, options, selectedValue) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const selected = normalizedOptions.find((option) => option.value === selectedValue) || normalizedOptions[0] || null;

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
    <div class="custom-select profile-custom-select" data-target="${escapeHtml(selectId)}">
      <div class="custom-select-trigger control-surface" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="custom-select-value">${escapeHtml(selected?.label || "Select")}</span>
        <div class="custom-select-arrow"></div>
      </div>
      <div class="custom-select-options" role="listbox">
        <div class="custom-select-options-inner">
          ${optionRows}
        </div>
      </div>
    </div>
    <select id="${escapeHtml(selectId)}" class="profile-native-select" style="display:none;">
      ${selectOptions}
    </select>
  `;
}

function initializeProfileCustomSelects() {
  const customSelects = document.querySelectorAll("#profile-main .profile-custom-select");
  if (customSelects.length === 0) return;

  const closeAll = (except = null) => {
    customSelects.forEach((customSelect) => {
      if (customSelect !== except) {
        customSelect.classList.remove("open");
        const trigger = customSelect.querySelector(".custom-select-trigger");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      }
    });
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
      const isOpen = customSelect.classList.contains("open");
      closeAll(customSelect);
      customSelect.classList.toggle("open", !isOpen);
      trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      trigger.click();
    });

    options.addEventListener("click", (event) => {
      const option = event.target.closest(".custom-select-option");
      if (!option) return;

      const value = option.dataset.value || "";
      targetSelect.value = value;
      targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
      customSelect.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      syncFromTargetSelect();
    });

    targetSelect.addEventListener("change", syncFromTargetSelect);
    syncFromTargetSelect();
  });

  if (profileCustomSelectDocumentHandler) {
    document.removeEventListener("click", profileCustomSelectDocumentHandler);
  }

  profileCustomSelectDocumentHandler = (event) => {
    if (!event.target.closest("#profile-main .profile-custom-select")) {
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
  const help = document.getElementById("profile-help");
  const auth = document.getElementById("profile-auth");

  const displayName = getProfileDisplayName(state.profile, state.user);
  const email = state.user?.email || "";
  const initials = getInitials(displayName, email);
  const programValue = state.profile?.program ? String(state.profile.program) : "";
  const yearValue = state.profile?.year ? String(state.profile.year) : "";
  const hasProgram = Boolean(programValue);
  const hasYear = Boolean(yearValue);
  const setupLabel = hasProgram || hasYear ? "Edit" : "Set up";
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
          `<div class="setting-control-stack">${
            hasProgram
              ? `<span class="status-pill status-pill--value">${escapeHtml(programValue)}</span>`
              : '<span class="status-pill status-pill--not-set">Not set</span>'
          }<button class="profile-action-pill control-surface" type="button" data-action="setup-program-year">${escapeHtml(setupLabel)}</button></div>`
        )}
        ${settingRow(
          "Year",
          "Current year",
          `<div class="setting-control-stack">${
            hasYear
              ? `<span class="status-pill status-pill--value">Year ${escapeHtml(yearValue)}</span>`
              : '<span class="status-pill status-pill--not-set">Not set</span>'
          }<button class="profile-action-pill control-surface" type="button" data-action="setup-program-year">${escapeHtml(setupLabel)}</button></div>`
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
        ${settingRow("Use full card colors", "Show full card background colors", toggleMarkup("pref-fullcardcolors-toggle", state.settings.fullCardColors))}
        ${settingRow("Reduce motion", "Limit transitions and motion", toggleMarkup("pref-reducemotion-toggle", state.settings.reduceMotion))}
      `
    );
  }

  if (integrations) {
    integrations.innerHTML = cardTemplate(
      "Integrations",
      `
        ${settingRow(
          "Calendar access",
          "Current integration status",
          `
            <div class="setting-control-stack">
              <span class="status-pill status-pill--neutral">Not connected</span>
              <button class="profile-action-pill control-surface is-disabled" id="profile-manage-integrations" type="button" disabled title="Coming soon">
                <span class="pill-icon" aria-hidden="true">🔒</span>
                <span>Manage</span>
              </button>
            </div>
          `
        )}
        <p class="coming-soon-note">Export to Google Calendar — coming soon</p>
      `
    );
  }

  if (dataPrivacy) {
    dataPrivacy.innerHTML = cardTemplate(
      "Data & Privacy",
      `
        <div class="profile-subblock">
          <h3 class="profile-subtitle">Utilities</h3>
          ${settingRow("Clear cache", "Remove local preferences and temporary data", '<button class="control-surface" id="profile-clear-cache" type="button">Clear cache</button>')}
        </div>
        <div class="danger-zone">
          <h3 class="profile-subtitle">Danger zone</h3>
          <p class="danger-copy">Deleting your account permanently removes your profile and saved data.</p>
          <button class="danger-action-btn" id="profile-delete-account" type="button">
            <span class="pill-icon" aria-hidden="true">🗑</span>
            <span>Delete account</span>
          </button>
        </div>
      `
    );
  }

  if (help) {
    help.innerHTML = cardTemplate("Help & Feedback", renderHelpBody());
  }

  if (auth) {
    auth.innerHTML = cardTemplate(
      "Sign out",
      `<button class="control-surface" id="profile-signout" type="button">Sign out</button>`
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

  bindHelpActions();
}

function bindHelpActions() {
  document.getElementById("profile-open-faq")?.addEventListener("click", openFaqModal);
  document.getElementById("profile-open-about")?.addEventListener("click", openAboutModal);
  document.getElementById("profile-open-feedback")?.addEventListener("click", () => showProfileToast("Coming soon"));
  document.getElementById("profile-open-bug")?.addEventListener("click", () => showProfileToast("Coming soon"));
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

  document.getElementById("profile-clear-cache")?.addEventListener("click", openClearCacheModal);
  document.getElementById("profile-delete-account")?.addEventListener("click", openDeleteAccountModal);
  document.getElementById("profile-signout")?.addEventListener("click", openSignOutModal);

  bindHelpActions();
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
  const isSheet = modal?.classList.contains("profile-modal--sheet");

  if (isSheet && modal) {
    modal.classList.remove("show");
    window.setTimeout(() => {
      layer.remove();
    }, 220);
  } else {
    layer.remove();
  }

  document.body.classList.remove("modal-open");
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
  const showSwipeIndicator = resolvedMode === "sheet";
  const layer = document.createElement("div");
  layer.id = PROFILE_MODAL_LAYER_ID;
  layer.className = "profile-modal-layer";
  layer.innerHTML = `
    <div class="profile-modal-backdrop"${closeOnBackdrop ? ' data-modal-close="true"' : ""}></div>
    <div class="profile-modal card-surface profile-modal--${escapeHtml(resolvedMode)}${modalClassName ? ` ${escapeHtml(modalClassName)}` : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      ${showSwipeIndicator ? '<div class="swipe-indicator" aria-hidden="true"></div>' : ""}
      <div class="profile-modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="control-surface icon-btn" data-modal-close="true" aria-label="Close">×</button>
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

  if (resolvedMode === "sheet" || resolvedMode === "fullscreen") {
    document.body.classList.add("modal-open");
  }

  if (resolvedMode === "sheet" && modal) {
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
              ${isSelected ? '<span class="choice-check" aria-hidden="true">✓</span>' : ""}
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
    mobileMode: "sheet"
  });

  layer.querySelectorAll(".profile-choice-option").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-choice-value") || "";
      await onSelect(value);
      closeModal();
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
      title: "Current term",
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
      title: "Time format",
      options,
      selectedValue: state.settings.timeFormat,
      onSelect: async (value) => {
        updatePickerLabel("pref-timefmt-picker", getTimeFormatLabel(value));
        await applySettingChanges({ timeFormat: value });
      }
    });
  }
}

function openFaqModal() {
  openModal({
    title: "FAQ",
    bodyMarkup: `
      <div class="profile-faq-list">
        <div class="profile-faq-item">
          <h4>Can I browse courses without an account?</h4>
          <p>Yes. Browsing courses is available in guest mode.</p>
        </div>
        <div class="profile-faq-item">
          <h4>What requires sign in?</h4>
          <p>Saving schedules, managing assignments, and profile sync require sign in.</p>
        </div>
        <div class="profile-faq-item">
          <h4>How do I change my term?</h4>
          <p>Use Current term in the Academic card. Your selection is saved automatically.</p>
        </div>
      </div>
    `,
    footerMarkup: `<button type="button" class="control-surface" data-modal-close="true">Close</button>`
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
    title: "Clear cache",
    bodyMarkup: `<p>Clear locally stored app preferences and temporary cache?</p>`,
    footerMarkup: `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="control-surface" id="profile-confirm-clear-cache">Clear cache</button>
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
    title: "Delete account",
    bodyMarkup: `
      <p>This action permanently deletes your account and all related data.</p>
      <p>Type <strong>DELETE</strong> to confirm.</p>
      <input id="profile-delete-confirm-input" class="search-input profile-modal-input" type="text" autocomplete="off" spellcheck="false" />
      <p id="profile-delete-error" class="profile-inline-error"></p>
    `,
    footerMarkup: `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="danger-action-btn" id="profile-confirm-delete" disabled>Delete account</button>
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
    title: "Sign out?",
    bodyMarkup: `<p>You can sign in again at any time.</p>`,
    footerMarkup: `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="control-surface" id="profile-confirm-signout">Sign out</button>
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
    title: "Edit profile",
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

  const layer = openModal({
    title: "Set up academic details",
    bodyMarkup: `
      <form id="profile-program-year-form" novalidate>
        <label class="profile-modal-label" for="profile-edit-program">Program</label>
        <input class="search-input profile-modal-input" id="profile-edit-program" maxlength="40" value="${escapeHtml(program)}" />
        <p class="profile-inline-error" id="profile-edit-program-error"></p>

        <label class="profile-modal-label" for="profile-edit-year">Year</label>
        <select class="profile-modal-input" id="profile-edit-year">
          <option value=""${!year ? " selected" : ""}>Not set</option>
          <option value="1"${year === "1" ? " selected" : ""}>Year 1</option>
          <option value="2"${year === "2" ? " selected" : ""}>Year 2</option>
          <option value="3"${year === "3" ? " selected" : ""}>Year 3</option>
          <option value="4"${year === "4" ? " selected" : ""}>Year 4</option>
        </select>
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
  } else if (route === "/help") {
    target = document.getElementById("profile-help");
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

  state.profile = {
    ...(profileRow || {}),
    display_name: getProfileDisplayName(profileRow, state.user)
  };

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
  if (!root) return;

  const route = getCurrentRouteForProfile();

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;

    state.session = session;
    state.user = session?.user || null;
    state.isAuthenticated = Boolean(state.user);

    closeModal();

    if (!state.isAuthenticated) {
      state.settings = buildInitialSettings();
      applyPreferencesToDocument(state.settings);
      renderGuestView(route);
      applyRouteFocus(route);
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
  }
});

export { initializeProfile };
window.initializeProfile = initializeProfile;
