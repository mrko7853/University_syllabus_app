import { supabase } from "../supabase.js";
import { withBase } from "./path-utils.js";
import {
  isSetupCompleteFromProfile,
  isSetupSchemaMissingError,
  normalizeSetupProfile
} from "./setup-status.js";

const CALLBACK_ROUTE = "/auth/callback";
let callbackInitInFlight = false;

function getRoot() {
  return document.getElementById("auth-callback-main");
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
  document.body.classList.toggle("auth-callback-active", Boolean(active));
}

function setStatusMessage(message) {
  const line = document.getElementById("auth-callback-status");
  if (line) {
    line.textContent = message;
  }
}

function renderFallback(message) {
  const root = getRoot();
  if (!root) return;
  root.innerHTML = `
    <section class="setup-card ui-card card-surface">
      <h1 class="setup-question-title">Sign in required</h1>
      <p class="setup-status-text">${message}</p>
      <div class="setup-callback-actions">
        <button type="button" class="ui-btn ui-btn--secondary control-surface" id="auth-callback-login">Go to login</button>
      </div>
    </section>
  `;
  root.querySelector("#auth-callback-login")?.addEventListener("click", () => navigateTo("/login"));
}

async function applyHashSessionIfNeeded() {
  const hash = String(window.location.hash || "");
  if (!hash.includes("access_token=") || !hash.includes("refresh_token=")) {
    return;
  }

  const tokenParams = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = tokenParams.get("access_token");
  const refreshToken = tokenParams.get("refresh_token");
  if (!accessToken || !refreshToken) return;

  try {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
  } catch (error) {
    console.warn("Auth callback: unable to apply hash session", error);
  }
}

async function exchangeCodeIfPresent() {
  const url = new URL(window.location.href);
  const authCode = url.searchParams.get("code");
  if (!authCode) return;

  if (typeof supabase.auth.exchangeCodeForSession !== "function") return;

  try {
    await supabase.auth.exchangeCodeForSession(authCode);
  } catch (error) {
    console.warn("Auth callback: exchange code failed", error);
  }
}

async function getSessionWithRetries(maxAttempts = 10, delayMs = 250) {
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
    .select("current_year, concentration, year_opt_out, concentration_opt_out, setup_completed_at, setup_version")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return normalizeSetupProfile(data || {});
}

async function initializeAuthCallback() {
  const root = getRoot();
  if (!root) return;
  if (callbackInitInFlight) return;
  callbackInitInFlight = true;

  setShellMode(true);
  setStatusMessage("Finalizing sign-in...");

  try {
    await exchangeCodeIfPresent();
    await applyHashSessionIfNeeded();

    setStatusMessage("Checking your account...");
    const session = await getSessionWithRetries();
    const user = session?.user || null;

    if (!user) {
      setStatusMessage("No active session found. Redirecting...");
      navigateTo("/login");
      return;
    }

    setStatusMessage("Loading your setup status...");

    let isComplete = true;
    try {
      const profile = await fetchSetupProfile(user.id);
      isComplete = isSetupCompleteFromProfile(profile);
    } catch (error) {
      if (!isSetupSchemaMissingError(error)) {
        throw error;
      }
      isComplete = true;
    }

    if (window.router && typeof window.router.setSetupCompletionForCurrentUser === "function") {
      window.router.setSetupCompletionForCurrentUser(isComplete, user.id);
    }

    navigateTo(isComplete ? "/" : "/setup");
  } catch (error) {
    console.error("Auth callback failed", error);
    renderFallback("Something went wrong while finalizing sign-in. Please log in again.");
  } finally {
    callbackInitInFlight = false;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAuthCallback);
} else {
  initializeAuthCallback();
}

document.addEventListener("pageLoaded", (event) => {
  const path = String(event?.detail?.path || "");
  if (path === CALLBACK_ROUTE) {
    initializeAuthCallback();
    return;
  }

  // Keep setup shell mode when callback hands off to /setup.
  if (path === "/setup") {
    document.body.classList.remove("auth-callback-active");
    return;
  }

  setShellMode(false);
});

export { initializeAuthCallback };
window.initializeAuthCallback = initializeAuthCallback;
