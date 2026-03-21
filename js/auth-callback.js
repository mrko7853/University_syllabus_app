import { supabase } from "../supabase.js";
import { withBase } from "./path-utils.js";
import {
  isSetupCompleteFromProfile,
  isSetupSchemaMissingError,
  normalizeSetupProfile
} from "./setup-status.js";

const CALLBACK_ROUTE = "/auth/callback";
const AUTH_CALLBACK_RETURN_KEY = "ila_auth_callback_return_intent";
const AUTH_CALLBACK_RETURN_MAX_AGE_MS = 5 * 60 * 1000;
const AUTH_EXPECTED_OAUTH_EMAIL_KEY = "ila_auth_expected_oauth_email";
const AUTH_EXPECTED_OAUTH_EMAIL_MAX_AGE_MS = 15 * 60 * 1000;
const AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY = "ila_auth_pending_oauth_link_provider";
const AUTH_PENDING_OAUTH_LINK_PROVIDER_MAX_AGE_MS = 15 * 60 * 1000;
const ROUTE_TOAST_QUEUE_KEY = "ila_route_toast";
const PROFILE_TOAST_QUEUE_KEY = "ila_profile_toast_queue";
let callbackInitInFlight = false;

function normalizeAppPath(path) {
  const value = String(path || "").trim();
  if (!value) return "/";
  if (value === "/") return "/";
  return value.replace(/\/+$/, "") || "/";
}

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

function queueRouteToast(message, variant = "info", durationMs = 2600) {
  const normalized = String(message || "").trim();
  if (!normalized) return;

  try {
    const payload = JSON.stringify({
      message: normalized,
      variant: String(variant || "info"),
      durationMs: Number(durationMs) || 2600
    });
    window.sessionStorage.setItem(ROUTE_TOAST_QUEUE_KEY, payload);
    window.localStorage.setItem(ROUTE_TOAST_QUEUE_KEY, payload);
  } catch (_) { }
}

function queueProfileToast(message, variant = "error") {
  const normalized = String(message || "").trim();
  if (!normalized) return;

  try {
    const payload = JSON.stringify({
      message: normalized,
      variant: String(variant || "error")
    });
    window.sessionStorage.setItem(PROFILE_TOAST_QUEUE_KEY, payload);
    window.localStorage.setItem(PROFILE_TOAST_QUEUE_KEY, payload);
  } catch (_) { }
}

function isProfileLikePath(path) {
  const normalized = normalizeAppPath(path || "");
  return normalized === "/profile" || normalized === "/settings" || normalized === "/help";
}

function parseProfileOAuthIntentFromQuery() {
  try {
    const url = new URL(window.location.href);
    const authIntent = String(url.searchParams.get("auth_intent") || "").trim().toLowerCase();
    if (authIntent !== "profile-oauth-link") {
      return { returnPath: "", provider: "" };
    }

    const path = normalizeAppPath(String(url.searchParams.get("next") || "").trim());
    const returnPath = (path && path !== "/" && isProfileLikePath(path)) ? path : "";
    const provider = String(url.searchParams.get("link_provider") || "").trim().toLowerCase();
    return { returnPath, provider };
  } catch (_) {
    return { returnPath: "", provider: "" };
  }
}

function isOAuthEmailMismatchMessage(message) {
  const normalized = String(message || "").toLowerCase();
  const hasEmailMismatch = normalized.includes("email")
    && (
      normalized.includes("mismatch")
      || normalized.includes("different")
      || normalized.includes("does not match")
      || normalized.includes("must match")
      || normalized.includes("conflict")
    );
  const alreadyLinkedElsewhere = normalized.includes("identity already exists")
    || normalized.includes("already linked")
    || normalized.includes("already associated");
  return hasEmailMismatch || alreadyLinkedElsewhere;
}

function parseOAuthErrorFromUrl() {
  try {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
    const error = url.searchParams.get("error") || hashParams.get("error") || "";
    const errorCode = url.searchParams.get("error_code") || hashParams.get("error_code") || "";
    const errorDescription = url.searchParams.get("error_description") || hashParams.get("error_description") || "";

    if (!error && !errorCode && !errorDescription) return null;

    return {
      error: String(error || ""),
      errorCode: String(errorCode || ""),
      errorDescription: String(errorDescription || "")
    };
  } catch (_) {
    return null;
  }
}

function getOAuthProviderLabel(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "google") return "Google";
  if (normalized === "azure") return "Outlook";
  return normalized ? (normalized.charAt(0).toUpperCase() + normalized.slice(1)) : "OAuth";
}

function consumeCallbackReturnIntent() {
  const clearAll = () => {
    try {
      window.sessionStorage.removeItem(AUTH_CALLBACK_RETURN_KEY);
      window.localStorage.removeItem(AUTH_CALLBACK_RETURN_KEY);
    } catch (_) { }
  };

  const tryParseIntent = (raw) => {
    if (!raw) return "";
    const payload = JSON.parse(raw);
    const source = String(payload?.source || "").trim().toLowerCase();
    if (source !== "profile-oauth-link") return "";

    const createdAt = Number(payload?.createdAt || 0);
    if (!Number.isFinite(createdAt) || (Date.now() - createdAt) > AUTH_CALLBACK_RETURN_MAX_AGE_MS) {
      return "";
    }

    const path = normalizeAppPath(String(payload?.path || "").trim());
    if (!path || path === "/") return "";
    if (path !== "/profile" && path !== "/settings" && path !== "/help") return "";
    return path;
  };

  try {
    const raw = window.sessionStorage.getItem(AUTH_CALLBACK_RETURN_KEY);
    const fromSession = tryParseIntent(raw);
    if (fromSession) {
      clearAll();
      return fromSession;
    }
  } catch (_) {
    // fall through to localStorage fallback
  }

  try {
    const raw = window.localStorage.getItem(AUTH_CALLBACK_RETURN_KEY);
    const fromLocal = tryParseIntent(raw);
    if (fromLocal) {
      clearAll();
      return fromLocal;
    }
  } catch (_) { }

  clearAll();
  return "";
}

function consumeExpectedOAuthEmail() {
  const clearAll = () => {
    try {
      window.sessionStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
      window.localStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
    } catch (_) { }
  };

  const tryParse = (raw) => {
    if (!raw) return "";
    const payload = JSON.parse(raw);
    const email = String(payload?.email || "").trim().toLowerCase();
    const source = String(payload?.source || "").trim().toLowerCase();
    const createdAt = Number(payload?.createdAt || 0);
    if (!email) return "";
    if (!Number.isFinite(createdAt) || (Date.now() - createdAt) > AUTH_EXPECTED_OAUTH_EMAIL_MAX_AGE_MS) {
      return "";
    }
    return { email, source };
  };

  try {
    const fromSession = tryParse(window.sessionStorage.getItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY));
    if (fromSession) {
      clearAll();
      return fromSession;
    }
  } catch (_) {
    // fall through to localStorage fallback
  }

  try {
    const fromLocal = tryParse(window.localStorage.getItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY));
    if (fromLocal) {
      clearAll();
      return fromLocal;
    }
  } catch (_) { }

  clearAll();
  return "";
}

function consumePendingOAuthLinkProvider() {
  const clearAll = () => {
    try {
      window.sessionStorage.removeItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY);
      window.localStorage.removeItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY);
    } catch (_) { }
  };

  const tryParse = (raw) => {
    if (!raw) return "";
    const payload = JSON.parse(raw);
    const provider = String(payload?.provider || "").trim().toLowerCase();
    const source = String(payload?.source || "").trim().toLowerCase();
    const createdAt = Number(payload?.createdAt || 0);
    if (!provider || source !== "profile-oauth-link") return "";
    if (!Number.isFinite(createdAt) || (Date.now() - createdAt) > AUTH_PENDING_OAUTH_LINK_PROVIDER_MAX_AGE_MS) {
      return "";
    }
    return provider;
  };

  try {
    const fromSession = tryParse(window.sessionStorage.getItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY));
    if (fromSession) {
      clearAll();
      return fromSession;
    }
  } catch (_) {
    // fall through
  }

  try {
    const fromLocal = tryParse(window.localStorage.getItem(AUTH_PENDING_OAUTH_LINK_PROVIDER_KEY));
    if (fromLocal) {
      clearAll();
      return fromLocal;
    }
  } catch (_) { }

  clearAll();
  return "";
}

async function isProviderLinked(user, provider) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (!user || !normalizedProvider) return false;

  const hasProviderInList = (identities) => {
    const list = Array.isArray(identities) ? identities : [];
    return list.some((item) => String(item?.provider || "").trim().toLowerCase() === normalizedProvider);
  };

  if (hasProviderInList(user.identities)) return true;
  if (typeof supabase.auth.getUserIdentities !== "function") return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (!error && hasProviderInList(data?.identities)) {
        return true;
      }
    } catch (_) { }
    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    }
  }

  return false;
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

    const queryIntent = parseProfileOAuthIntentFromQuery();
    const callbackReturnPath = queryIntent.returnPath || consumeCallbackReturnIntent();
    const expectedOAuth = consumeExpectedOAuthEmail();
    const expectedOAuthEmail = String(expectedOAuth?.email || "").trim().toLowerCase();
    const expectedOAuthSource = String(expectedOAuth?.source || "").trim().toLowerCase();
    const pendingOAuthProvider = queryIntent.provider || consumePendingOAuthLinkProvider();
    const oauthError = parseOAuthErrorFromUrl();

    if (oauthError) {
      const combinedMessage = [oauthError.error, oauthError.errorCode, oauthError.errorDescription].join(" ");
      const mismatch = isOAuthEmailMismatchMessage(combinedMessage);
      queueRouteToast(
        mismatch
          ? "OAuth email mismatch. Please use your account email or password."
          : "Could not complete OAuth connection. Please try again.",
        "error"
      );
      const fallbackPath = callbackReturnPath || (pendingOAuthProvider || expectedOAuthSource === "profile-oauth-link" ? "/profile" : "/login");
      if (isProfileLikePath(fallbackPath)) {
        queueProfileToast(
          mismatch
            ? "OAuth email mismatch. Please use your account email or password."
            : "Could not complete OAuth connection. Please try again.",
          "error"
        );
      }
      navigateTo(fallbackPath);
      return;
    }

    setStatusMessage("Checking your account...");
    const session = await getSessionWithRetries();
    const user = session?.user || null;

    if (!user) {
      setStatusMessage("No active session found. Redirecting...");
      navigateTo("/login");
      return;
    }

    const authenticatedEmail = String(user?.email || "").trim().toLowerCase();
    if (expectedOAuthEmail && authenticatedEmail && expectedOAuthEmail !== authenticatedEmail) {
      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.warn("Auth callback: failed to sign out mismatched OAuth session", error);
      }
      queueRouteToast("OAuth email mismatch. Please sign in with your account email or password.", "error");
      navigateTo("/login");
      return;
    }

    if (pendingOAuthProvider) {
      const linked = await isProviderLinked(user, pendingOAuthProvider);
      if (!linked) {
        const providerLabel = getOAuthProviderLabel(pendingOAuthProvider);
        queueRouteToast(
          expectedOAuthEmail
            ? "OAuth email mismatch. Please use your account email or password."
            : `Could not connect ${providerLabel}. Please try again.`,
          "error"
        );
        queueProfileToast(
          expectedOAuthEmail
            ? "OAuth email mismatch. Please use your account email or password."
            : `Could not connect ${providerLabel}. Please try again.`,
          "error"
        );
        navigateTo(callbackReturnPath || "/profile");
        return;
      }
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

    if (isComplete && callbackReturnPath) {
      navigateTo(callbackReturnPath);
      return;
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
  const path = normalizeAppPath(event?.detail?.path || "");
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
