import { supabase } from "../supabase.js";
import { withBase } from "./path-utils.js";
import {
  SETUP_CONCENTRATION_OPTIONS,
  SETUP_PREFER_NOT_TO_ANSWER,
  SETUP_VERSION,
  SETUP_YEAR_OPTIONS,
  deriveSetupStep,
  isSetupCompleteFromProfile,
  mapConcentrationSelectionToPayload,
  mapYearSelectionToPayload,
  normalizeSetupProfile,
  isSetupSchemaMissingError
} from "./setup-status.js";

const SETUP_ROUTE = "/setup";
const HOME_ROUTE = "/";

const state = {
  initialized: false,
  initializing: false,
  session: null,
  user: null,
  profile: null,
  step: 0,
  selectedYear: null,
  selectedConcentration: null,
  busy: false,
  error: ""
};

function getRoot() {
  return document.getElementById("setup-flow-main");
}

function navigateTo(path) {
  if (window.router?.navigate) {
    window.router.navigate(path);
    return;
  }
  window.location.href = withBase(path);
}

function setShellMode(active) {
  document.body.classList.toggle("setup-flow-active", Boolean(active));
}

function getDisplayName(user) {
  const metadata = user?.user_metadata || {};
  const candidates = [
    metadata.display_name,
    metadata.name,
    metadata.full_name,
    metadata.preferred_username,
    metadata.user_name
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value.slice(0, 60);
  }

  const emailPrefix = String(user?.email || "").split("@")[0] || "Student";
  return emailPrefix.slice(0, 60);
}

async function getSessionWithRetries(maxAttempts = 8, delayMs = 220) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.user) {
      return data.session;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  return null;
}

async function fetchSetupProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, current_year, concentration, year_opt_out, concentration_opt_out, setup_completed_at, setup_version")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeSetupProfile(data || {});
}

function getOptionValueForProfile(field, optOutField, options, profile) {
  if (profile?.[optOutField]) return SETUP_PREFER_NOT_TO_ANSWER;
  const value = String(profile?.[field] || "").trim();
  if (!value) return null;
  return options.includes(value) ? value : null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLoading(message = "Loading setup...") {
  const root = getRoot();
  if (!root) return;
  root.innerHTML = `
    <section class="setup-card ui-card card-surface">
      <p class="setup-status-text" role="status" aria-live="polite">${escapeHtml(message)}</p>
    </section>
  `;
}

function buildStepMeta(step) {
  if (step === 0) {
    return {
      title: "What year are you currently in?",
      helper: "This helps personalize your academic view.",
      options: SETUP_YEAR_OPTIONS,
      selected: state.selectedYear,
      progress: "Step 1 of 2"
    };
  }

  if (step === 1) {
    return {
      title: "What concentration are you in?",
      helper: "This helps personalize courses and recommendations.",
      options: SETUP_CONCENTRATION_OPTIONS,
      selected: state.selectedConcentration,
      progress: "Step 2 of 2"
    };
  }

  return null;
}

function renderStep() {
  const root = getRoot();
  if (!root) return;

  const meta = buildStepMeta(state.step);
  if (!meta) {
    renderCompletion();
    return;
  }

  const isFirstStep = state.step === 0;
  const selectedValue = String(meta.selected || "");
  const continueDisabled = state.busy || !selectedValue;
  const progressRatio = state.step === 0 ? 50 : 100;

  const optionsMarkup = meta.options
    .map((option, index) => {
      const isSelected = option === selectedValue;
      const selectedClass = isSelected ? " is-selected" : "";
      const ariaChecked = isSelected ? "true" : "false";
      return `
        <button
          type="button"
          class="setup-option-row control-surface${selectedClass}"
          role="radio"
          aria-checked="${ariaChecked}"
          data-setup-option="${escapeHtml(option)}"
          data-option-index="${index}"
        >
          <span class="setup-option-label">${escapeHtml(option)}</span>
          <span class="setup-option-check" aria-hidden="true">${isSelected ? "Selected" : ""}</span>
        </button>
      `;
    })
    .join("");

  root.innerHTML = `
    <section class="setup-card ui-card card-surface">
      <div class="setup-progress">
        <p class="setup-progress-label">${escapeHtml(meta.progress)}</p>
        <div class="setup-progress-bar" aria-hidden="true">
          <span style="width:${progressRatio}%"></span>
        </div>
      </div>

      <header class="setup-question-head">
        <h1 class="setup-question-title">${escapeHtml(meta.title)}</h1>
        <p class="setup-question-helper">${escapeHtml(meta.helper)}</p>
      </header>

      <div class="setup-option-list" role="radiogroup" aria-label="${escapeHtml(meta.title)}">
        ${optionsMarkup}
      </div>

      <p class="setup-inline-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error)}</p>
    </section>

    <footer class="setup-actions-bar">
      <button type="button" class="ui-btn ui-btn--secondary control-surface setup-action setup-action-back" ${isFirstStep ? "disabled" : ""}>
        Back
      </button>
      <button type="button" class="ui-btn ui-btn--secondary control-surface setup-action setup-action-continue" ${continueDisabled ? "disabled" : ""}>
        ${state.busy ? "Saving..." : "Continue"}
      </button>
    </footer>
  `;

  bindStepEvents();
}

function renderCompletion() {
  const root = getRoot();
  if (!root) return;

  root.innerHTML = `
    <section class="setup-card ui-card card-surface">
      <h1 class="setup-question-title">You’re all set</h1>
      <p class="setup-status-text">Taking you to Home...</p>
    </section>
  `;
}

function handleArrowNavigation(event) {
  const optionButton = event.target.closest("[data-setup-option]");
  if (!optionButton) return;

  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const optionButtons = Array.from(document.querySelectorAll("[data-setup-option]"));
  if (optionButtons.length === 0) return;

  const currentIndex = optionButtons.indexOf(optionButton);
  if (currentIndex < 0) return;

  const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = (currentIndex + direction + optionButtons.length) % optionButtons.length;
  const nextButton = optionButtons[nextIndex];
  if (!nextButton) return;

  const value = nextButton.getAttribute("data-setup-option");
  setSelection(value);
  nextButton.focus();
}

function setSelection(value) {
  const selected = String(value || "").trim();
  if (!selected) return;

  if (state.step === 0) {
    state.selectedYear = selected;
  } else {
    state.selectedConcentration = selected;
  }

  state.error = "";
  renderStep();
}

async function persistYearSelection() {
  const payload = mapYearSelectionToPayload(state.selectedYear);
  await upsertProfile({
    ...payload
  });

  state.profile = normalizeSetupProfile({
    ...(state.profile || {}),
    ...payload
  });
}

async function persistConcentrationSelectionAndComplete() {
  const payload = mapConcentrationSelectionToPayload(state.selectedConcentration);
  const completedAt = new Date().toISOString();
  await upsertProfile({
    ...payload,
    setup_completed_at: completedAt,
    setup_version: SETUP_VERSION
  });

  state.profile = normalizeSetupProfile({
    ...(state.profile || {}),
    ...payload,
    setup_completed_at: completedAt,
    setup_version: SETUP_VERSION
  });
}

async function upsertProfile(payload) {
  const upsertPayload = {
    id: state.user.id,
    display_name: getDisplayName(state.user),
    updated_at: new Date().toISOString(),
    ...payload
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(upsertPayload, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function handleContinue() {
  if (state.busy) return;
  state.error = "";

  try {
    state.busy = true;
    renderStep();

    if (state.step === 0) {
      await persistYearSelection();
      state.step = 1;
      state.busy = false;
      renderStep();
      return;
    }

    if (state.step === 1) {
      await persistConcentrationSelectionAndComplete();
      state.step = 2;
      state.busy = false;
      renderCompletion();

      if (window.router && typeof window.router.setSetupCompletionForCurrentUser === "function") {
        window.router.setSetupCompletionForCurrentUser(true, state.user?.id || null);
      }

      window.setTimeout(() => navigateTo(HOME_ROUTE), 900);
      return;
    }
  } catch (error) {
    if (isSetupSchemaMissingError(error)) {
      state.error = "Setup fields are not available yet. Please try again shortly.";
    } else {
      state.error = "Could not save right now. Please try again.";
    }
    console.error("Setup flow save failed", error);
  } finally {
    state.busy = false;
    if (state.step < 2) {
      renderStep();
    }
  }
}

function handleBack() {
  if (state.busy) return;
  if (state.step <= 0) return;
  state.step -= 1;
  state.error = "";
  renderStep();
}

function bindStepEvents() {
  document.querySelectorAll("[data-setup-option]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelection(button.getAttribute("data-setup-option"));
    });
    button.addEventListener("keydown", handleArrowNavigation);
  });

  document.querySelector(".setup-action-back")?.addEventListener("click", handleBack);
  document.querySelector(".setup-action-continue")?.addEventListener("click", handleContinue);
}

async function loadState() {
  state.session = await getSessionWithRetries();
  state.user = state.session?.user || null;

  if (!state.user) {
    navigateTo("/login");
    return false;
  }

  const profile = await fetchSetupProfile(state.user.id);
  state.profile = profile;

  if (isSetupCompleteFromProfile(profile)) {
    if (window.router && typeof window.router.setSetupCompletionForCurrentUser === "function") {
      window.router.setSetupCompletionForCurrentUser(true, state.user.id);
    }
    navigateTo(HOME_ROUTE);
    return false;
  }

  state.selectedYear = getOptionValueForProfile("current_year", "year_opt_out", SETUP_YEAR_OPTIONS, profile);
  state.selectedConcentration = getOptionValueForProfile("concentration", "concentration_opt_out", SETUP_CONCENTRATION_OPTIONS, profile);
  state.step = deriveSetupStep(profile);
  if (state.step > 1) {
    state.step = 1;
  }

  return true;
}

async function initializeSetupFlow() {
  const root = getRoot();
  if (!root) return;
  if (state.initializing) return;
  state.initializing = true;

  setShellMode(true);
  renderLoading("Loading setup...");

  try {
    const canRender = await loadState();
    if (!canRender) return;
    renderStep();
    state.initialized = true;
  } catch (error) {
    console.error("Setup flow init failed", error);
    const message = isSetupSchemaMissingError(error)
      ? "Setup fields are not available yet. Please try again shortly."
      : "We couldn’t load setup right now.";
    renderLoading(message);
  } finally {
    state.initializing = false;
  }
}

function teardownSetupFlowIfNeeded(routePath) {
  if (routePath === SETUP_ROUTE) return;
  if (!state.initialized) {
    setShellMode(false);
    return;
  }
  state.initialized = false;
  state.busy = false;
  state.error = "";
  setShellMode(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeSetupFlow);
} else {
  initializeSetupFlow();
}

document.addEventListener("pageLoaded", (event) => {
  const path = String(event?.detail?.path || "");
  if (path === SETUP_ROUTE) {
    initializeSetupFlow();
    return;
  }
  teardownSetupFlowIfNeeded(path);
});

export { initializeSetupFlow };
window.initializeSetupFlow = initializeSetupFlow;
