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
    return [{ term: "Fall", year: new Date().getFullYear(), label: `Fall ${new Date().getFullYear()}` }];
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

function renderHelpBody() {
  return `
    <div class="profile-link-list">
      <button type="button" class="profile-link-row" id="profile-open-faq">FAQ</button>
      <button type="button" class="profile-link-row is-disabled" id="profile-open-feedback" disabled>Feedback <span class="coming-soon">Coming soon</span></button>
      <button type="button" class="profile-link-row is-disabled" id="profile-open-bug" disabled>Report a bug <span class="coming-soon">Coming soon</span></button>
      <button type="button" class="profile-link-row" id="profile-open-about">About</button>
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
        <div class="profile-link-list">
          <button type="button" class="profile-link-row" data-require-auth="true">Save timetable</button>
          <button type="button" class="profile-link-row" data-require-auth="true">Track deadlines</button>
          <button type="button" class="profile-link-row" data-require-auth="true">Write reviews</button>
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

function settingRow(title, description, controlMarkup) {
  return `
    <div class="setting-row">
      <div class="setting-meta">
        <div class="setting-title">${escapeHtml(title)}</div>
        <div class="setting-desc">${escapeHtml(description)}</div>
      </div>
      <div class="setting-control">${controlMarkup}</div>
    </div>
  `;
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
  const program = state.profile?.program ? String(state.profile.program) : "Not set";
  const year = state.profile?.year ? String(state.profile.year) : "Not set";

  if (identity) {
    identity.innerHTML = cardTemplate(
      "Identity",
      `
        <div class="profile-identity">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="identity-meta">
            <div class="name">${escapeHtml(displayName)}</div>
            <div class="email">${escapeHtml(email)}</div>
            <div class="profile-status-line">Signed in</div>
          </div>
        </div>
      `,
      `<button class="control-surface icon-btn" id="profile-edit-button" aria-label="Edit profile" type="button">✎</button>`
    );
  }

  if (academic) {
    academic.innerHTML = cardTemplate(
      "Academic",
      `
        ${settingRow(
          "Current term",
          "Used for courses, schedule, and assignments",
          `<select class="control-surface" id="profile-current-term">${renderTermOptions(state.settings.currentTerm)}</select>`
        )}
        ${settingRow("Program", "Your current program", `<span class="profile-static-value">${escapeHtml(program)}</span>`)}
        ${settingRow("Year", "Current year", `<span class="profile-static-value">${escapeHtml(year)}</span>`)}
      `
    );
  }

  if (preferences) {
    preferences.innerHTML = cardTemplate(
      "Preferences",
      `
        ${settingRow(
          "Language",
          "Choose app language",
          `
            <select class="control-surface" id="pref-language">
              <option value="en"${state.settings.language === "en" ? " selected" : ""}>English</option>
              <option value="ja"${state.settings.language === "ja" ? " selected" : ""}>日本語</option>
            </select>
          `
        )}
        ${settingRow(
          "Time format",
          "12-hour or 24-hour",
          `
            <select class="control-surface" id="pref-timefmt">
              <option value="12"${state.settings.timeFormat === "12" ? " selected" : ""}>12-hour</option>
              <option value="24"${state.settings.timeFormat === "24" ? " selected" : ""}>24-hour</option>
            </select>
          `
        )}
        ${settingRow(
          "Use full card colors",
          "Show full card background colors",
          `
            <select class="control-surface" id="pref-fullcardcolors">
              <option value="1"${state.settings.fullCardColors ? " selected" : ""}>On</option>
              <option value="0"${!state.settings.fullCardColors ? " selected" : ""}>Off</option>
            </select>
          `
        )}
        ${settingRow(
          "Reduce motion",
          "Limit transitions and motion",
          `
            <select class="control-surface" id="pref-reducemotion">
              <option value="0"${!state.settings.reduceMotion ? " selected" : ""}>Off</option>
              <option value="1"${state.settings.reduceMotion ? " selected" : ""}>On</option>
            </select>
          `
        )}
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
          `<span class="status-pill">Not connected</span>`
        )}
        <div class="profile-inline-actions">
          <button class="control-surface" id="profile-manage-integrations" type="button">Manage</button>
          <span class="coming-soon">Coming soon</span>
        </div>
      `
    );
  }

  if (dataPrivacy) {
    dataPrivacy.innerHTML = cardTemplate(
      "Data & Privacy",
      `
        <div class="profile-inline-actions vertical">
          <button class="control-surface" id="profile-clear-cache" type="button">Clear cache</button>
          <button class="pill-danger" id="profile-delete-account" type="button">Delete account</button>
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

  document.querySelectorAll("[data-require-auth='true']").forEach((button) => {
    button.addEventListener("click", () => navigateTo("/login"));
  });

  bindHelpActions();
}

function bindHelpActions() {
  document.getElementById("profile-open-faq")?.addEventListener("click", openFaqModal);
  document.getElementById("profile-open-about")?.addEventListener("click", openAboutModal);
}

function bindSignedInActions() {
  document.getElementById("profile-edit-button")?.addEventListener("click", openEditProfileModal);

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

  document.getElementById("pref-fullcardcolors")?.addEventListener("change", async (event) => {
    await applySettingChanges({ fullCardColors: event.target.value === "1" });
  });

  document.getElementById("pref-reducemotion")?.addEventListener("change", async (event) => {
    await applySettingChanges({ reduceMotion: event.target.value === "1" });
  });

  document.getElementById("profile-manage-integrations")?.addEventListener("click", openIntegrationsModal);
  document.getElementById("profile-clear-cache")?.addEventListener("click", openClearCacheModal);
  document.getElementById("profile-delete-account")?.addEventListener("click", openDeleteAccountModal);
  document.getElementById("profile-signout")?.addEventListener("click", signOutUser);

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
  const modal = document.getElementById(PROFILE_MODAL_LAYER_ID);
  if (modal) {
    modal.remove();
  }
}

function openModal(title, bodyMarkup, footerMarkup = "") {
  closeModal();

  const layer = document.createElement("div");
  layer.id = PROFILE_MODAL_LAYER_ID;
  layer.className = "profile-modal-layer";
  layer.innerHTML = `
    <div class="profile-modal-backdrop" data-modal-close="true"></div>
    <div class="profile-modal card-surface" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
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
  return layer;
}

function openFaqModal() {
  openModal(
    "FAQ",
    `
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
    `<button type="button" class="control-surface" data-modal-close="true">Close</button>`
  );
}

function openAboutModal() {
  const version = import.meta.env.VITE_APP_VERSION || "1.0.0";
  const build = import.meta.env.MODE || "production";

  openModal(
    "About",
    `
      <div class="profile-about-grid">
        <div><strong>App</strong></div><div>ILA Companion</div>
        <div><strong>Version</strong></div><div>${escapeHtml(version)}</div>
        <div><strong>Build</strong></div><div>${escapeHtml(build)}</div>
      </div>
    `,
    `<button type="button" class="control-surface" data-modal-close="true">Close</button>`
  );
}

function openIntegrationsModal() {
  openModal(
    "Calendar Integration",
    `
      <div class="integration-list">
        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">Status</div>
            <div class="setting-desc">Calendar is not connected yet.</div>
          </div>
          <div class="setting-control"><span class="status-pill">Not connected</span></div>
        </div>
        <div class="profile-inline-actions vertical">
          <button class="control-surface" type="button" disabled>Export ICS</button>
          <button class="control-surface" type="button" disabled>Connect calendar</button>
          <button class="control-surface" type="button" disabled>Disconnect</button>
        </div>
        <p class="coming-soon-note">Coming soon</p>
      </div>
    `,
    `<button type="button" class="control-surface" data-modal-close="true">Close</button>`
  );
}

function openClearCacheModal() {
  const layer = openModal(
    "Clear cache",
    `<p>Clear locally stored app preferences and temporary cache?</p>`,
    `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="control-surface" id="profile-confirm-clear-cache">Clear cache</button>
    `
  );

  layer.querySelector("#profile-confirm-clear-cache")?.addEventListener("click", () => {
    clearProfileCache();
    closeModal();
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

  applyPreferencesToDocument(DEFAULT_PREFERENCES);

  const inferred = parseTermValue(getInferredCurrentTerm());
  if (inferred.value) {
    applyPreferredTermToGlobals(inferred.value);
  }
}

function openDeleteAccountModal() {
  const layer = openModal(
    "Delete account",
    `
      <p>This action permanently deletes your account and all related data.</p>
      <p>Type <strong>DELETE</strong> to confirm.</p>
      <input id="profile-delete-confirm-input" class="profile-modal-input" type="text" autocomplete="off" spellcheck="false" />
      <p id="profile-delete-error" class="profile-inline-error"></p>
    `,
    `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="button" class="pill-danger" id="profile-confirm-delete" disabled>Delete account</button>
    `
  );

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

function openEditProfileModal() {
  const displayName = getProfileDisplayName(state.profile, state.user);
  const program = state.profile?.program ? String(state.profile.program) : "";
  const year = state.profile?.year ? String(state.profile.year) : "";

  const layer = openModal(
    "Edit profile",
    `
      <form id="profile-edit-form" novalidate>
        <label class="profile-modal-label" for="profile-edit-display-name">Display name</label>
        <input class="profile-modal-input" id="profile-edit-display-name" maxlength="30" required value="${escapeHtml(displayName)}" />
        <p class="profile-inline-error" id="profile-edit-name-error"></p>

        <label class="profile-modal-label" for="profile-edit-program">Program</label>
        <input class="profile-modal-input" id="profile-edit-program" maxlength="40" value="${escapeHtml(program)}" />
        <p class="profile-inline-error" id="profile-edit-program-error"></p>

        <label class="profile-modal-label" for="profile-edit-year">Year</label>
        <input class="profile-modal-input" id="profile-edit-year" maxlength="1" inputmode="numeric" value="${escapeHtml(year)}" />
        <p class="profile-inline-error" id="profile-edit-year-error"></p>
      </form>
    `,
    `
      <button type="button" class="control-surface" data-modal-close="true">Cancel</button>
      <button type="submit" class="control-surface" form="profile-edit-form" id="profile-edit-save">Save</button>
    `
  );

  const form = layer.querySelector("#profile-edit-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const nameInput = layer.querySelector("#profile-edit-display-name");
    const programInput = layer.querySelector("#profile-edit-program");
    const yearInput = layer.querySelector("#profile-edit-year");

    const name = String(nameInput?.value || "").trim();
    const programValue = String(programInput?.value || "").trim();
    const yearValue = String(yearInput?.value || "").trim();

    const errors = {
      name: "",
      program: "",
      year: ""
    };

    if (name.length < 2 || name.length > 30) {
      errors.name = "Display name must be 2 to 30 characters.";
    }

    if (programValue.length > 40) {
      errors.program = "Program must be 40 characters or fewer.";
    }

    if (yearValue && !/^[1-4]$/.test(yearValue)) {
      errors.year = "Year must be a number from 1 to 4.";
    }

    layer.querySelector("#profile-edit-name-error").textContent = errors.name;
    layer.querySelector("#profile-edit-program-error").textContent = errors.program;
    layer.querySelector("#profile-edit-year-error").textContent = errors.year;

    if (errors.name || errors.program || errors.year) {
      return;
    }

    const payload = {
      id: state.user.id,
      display_name: name,
      program: programValue || null,
      year: yearValue ? Number(yearValue) : null,
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
        display_name: payload.display_name,
        program: payload.program,
        year: payload.year
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
