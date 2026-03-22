import { supabase } from "../supabase.js";

const NOTICE_KEY = "ila-course-registration";
const BANNER_ROOT_ID = "app-registration-notice-root";
const GUEST_DISMISS_STORAGE_KEY = "ila_notice_dismissals_v1";
const DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_SYNC_AFTER_MS = 28 * 24 * 60 * 60 * 1000;
const SYNC_COOLDOWN_MS = 12 * 60 * 60 * 1000;

let isInitialized = false;
let cachedNoticeRow = null;
let cachedNoticeAtMs = 0;
let lastSyncAttemptMs = 0;
let renderVersion = 0;
const dismissalCache = new Map();

function safeParseIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getAppContentNode() {
  return document.getElementById("app-content");
}

function ensureBannerRoot() {
  const appContent = getAppContentNode();
  if (!appContent) return null;

  let root = document.getElementById(BANNER_ROOT_ID);
  if (root && root.parentElement !== appContent) {
    root.remove();
    root = null;
  }

  if (!root) {
    root = document.createElement("div");
    root.id = BANNER_ROOT_ID;
    appContent.prepend(root);
  }

  return root;
}

function clearBanner() {
  const root = document.getElementById(BANNER_ROOT_ID);
  if (root) {
    root.innerHTML = "";
  }
}

function shouldRenderOnCurrentPage() {
  if (document.body.classList.contains("auth-page")) return false;
  if (document.body.classList.contains("setup-flow-active")) return false;

  return Boolean(getAppContentNode());
}

function readGuestDismissals() {
  try {
    const raw = window.localStorage.getItem(GUEST_DISMISS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (error) {
    console.warn("Registration notice: failed to read guest dismissal state", error);
    return {};
  }
}

function writeGuestDismissals(value) {
  try {
    window.localStorage.setItem(GUEST_DISMISS_STORAGE_KEY, JSON.stringify(value || {}));
  } catch (error) {
    console.warn("Registration notice: failed to persist guest dismissal state", error);
  }
}

function dismissNoticeForGuest(noticeVersionKey) {
  const next = {
    ...readGuestDismissals(),
    [noticeVersionKey]: {
      dismissed_at: new Date().toISOString(),
    },
  };
  writeGuestDismissals(next);
}

function isDismissedForGuest(noticeVersionKey) {
  const map = readGuestDismissals();
  return Boolean(map?.[noticeVersionKey]);
}

async function getSessionUser() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data?.session?.user || null;
  } catch {
    return null;
  }
}

function toDismissalCacheKey(userId, noticeVersionKey) {
  return `${userId}:${noticeVersionKey}`;
}

async function isDismissedForUser(userId, noticeVersionKey) {
  if (!userId || !noticeVersionKey) return false;

  const cacheKey = toDismissalCacheKey(userId, noticeVersionKey);
  if (dismissalCache.has(cacheKey)) {
    return dismissalCache.get(cacheKey) === true;
  }

  try {
    const { data, error } = await supabase
      .from("user_notice_dismissals")
      .select("notice_key")
      .eq("user_id", userId)
      .eq("notice_key", noticeVersionKey)
      .maybeSingle();

    if (error) {
      console.warn("Registration notice: failed reading user dismissal", error);
      return false;
    }

    const dismissed = Boolean(data?.notice_key);
    dismissalCache.set(cacheKey, dismissed);
    return dismissed;
  } catch (error) {
    console.warn("Registration notice: failed reading user dismissal", error);
    return false;
  }
}

async function dismissNoticeForUser(userId, noticeVersionKey) {
  if (!userId || !noticeVersionKey) return;

  const cacheKey = toDismissalCacheKey(userId, noticeVersionKey);
  dismissalCache.set(cacheKey, true);

  try {
    const { error } = await supabase
      .from("user_notice_dismissals")
      .upsert(
        {
          user_id: userId,
          notice_key: noticeVersionKey,
          dismissed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,notice_key" }
      );

    if (error) {
      console.warn("Registration notice: failed persisting user dismissal", error);
    }
  } catch (error) {
    console.warn("Registration notice: failed persisting user dismissal", error);
  }
}

async function maybeTriggerSync(row) {
  const now = Date.now();
  if (now - lastSyncAttemptMs < SYNC_COOLDOWN_MS) return;

  const lastSyncedAt = safeParseIso(row?.last_synced_at);
  const isStale = !lastSyncedAt || (now - lastSyncedAt) >= STALE_SYNC_AFTER_MS;
  if (!isStale) return;

  lastSyncAttemptMs = now;

  try {
    const { data, error } = await supabase.functions.invoke("registration-notice-sync", {
      body: { reason: "client_stale_sync" },
    });

    if (error) {
      console.warn("Registration notice: monthly sync call failed", error);
      return;
    }

    if (data?.row && typeof data.row === "object") {
      cachedNoticeRow = data.row;
      cachedNoticeAtMs = Date.now();
    }
  } catch (error) {
    console.warn("Registration notice: monthly sync call failed", error);
  }
}

async function fetchNoticeRow(force = false) {
  const now = Date.now();
  if (!force && cachedNoticeRow && (now - cachedNoticeAtMs) < DATA_CACHE_TTL_MS) {
    return cachedNoticeRow;
  }

  try {
    const { data, error } = await supabase
      .from("registration_notice_periods")
      .select(
        "notice_key,source_url,registration_label,registration_period_text,registration_start_at,registration_end_at,withdrawal_label,withdrawal_period_text,withdrawal_start_at,withdrawal_end_at,last_synced_at,updated_at"
      )
      .eq("notice_key", NOTICE_KEY)
      .maybeSingle();

    if (error) {
      console.warn("Registration notice: failed loading current notice", error);
      return null;
    }

    cachedNoticeRow = data || null;
    cachedNoticeAtMs = Date.now();
    void maybeTriggerSync(cachedNoticeRow);
    return cachedNoticeRow;
  } catch (error) {
    console.warn("Registration notice: failed loading current notice", error);
    return null;
  }
}

function resolveActiveNotice(row) {
  if (!row || typeof row !== "object") return null;

  const now = Date.now();
  const registrationEnd = safeParseIso(row.registration_end_at);
  const withdrawalEnd = safeParseIso(row.withdrawal_end_at);

  if (registrationEnd !== null && now <= registrationEnd) {
    return {
      type: "registration",
      label: normalizeText(row.registration_label) || "General Registration",
      periodText: normalizeText(row.registration_period_text),
      startAt: row.registration_start_at || "",
      endAt: row.registration_end_at || "",
      sourceUrl: normalizeText(row.source_url),
    };
  }

  if (withdrawalEnd !== null && now <= withdrawalEnd) {
    return {
      type: "withdrawal",
      label: normalizeText(row.withdrawal_label) || "Course Withdrawal Period",
      periodText: normalizeText(row.withdrawal_period_text),
      startAt: row.withdrawal_start_at || "",
      endAt: row.withdrawal_end_at || "",
      sourceUrl: normalizeText(row.source_url),
    };
  }

  return null;
}

function buildNoticeVersionKey(activeNotice) {
  if (!activeNotice) return "";
  return [
    NOTICE_KEY,
    activeNotice.type,
    normalizeText(activeNotice.startAt) || "none",
    normalizeText(activeNotice.endAt) || "none",
  ].join(":");
}

function buildNoticeElement(activeNotice, onDismiss) {
  const banner = document.createElement("div");
  banner.className = "course-registration-notice";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const icon = document.createElement("span");
  icon.className = "course-registration-notice__icon";
  icon.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "course-registration-notice__content";

  const headerRow = document.createElement("div");
  headerRow.className = "course-registration-notice__header-row";

  const title = document.createElement("p");
  title.className = "course-registration-notice__title";
  title.textContent = activeNotice.type === "withdrawal"
    ? "Course Wthdrawal Period"
    : "General Registration Period";

  const period = document.createElement("p");
  period.className = "course-registration-notice__period";
  period.textContent = activeNotice.periodText || "Please check DUET for the exact dates.";

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "course-registration-notice__dismiss-action";
  dismissButton.setAttribute("aria-label", "Dismiss registration notice");
  dismissButton.setAttribute("title", "Dismiss");
  dismissButton.innerHTML = `
    <span class="course-registration-notice__dismiss-icon" aria-hidden="true"></span>
    <span class="course-registration-notice__dismiss-label">Dismiss</span>
  `;
  dismissButton.addEventListener("click", onDismiss);

  headerRow.appendChild(title);
  headerRow.appendChild(dismissButton);

  content.appendChild(headerRow);
  content.appendChild(period);

  if (activeNotice.sourceUrl) {
    const sourceLink = document.createElement("a");
    sourceLink.className = "course-registration-notice__source";
    sourceLink.href = activeNotice.sourceUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = "Source";
    content.appendChild(sourceLink);
  }

  banner.appendChild(icon);
  banner.appendChild(content);

  return banner;
}

export async function renderRegistrationNotice(options = {}) {
  const force = options?.force === true;
  const runVersion = ++renderVersion;

  if (!shouldRenderOnCurrentPage()) {
    clearBanner();
    return;
  }

  const root = ensureBannerRoot();
  if (!root) return;

  const row = await fetchNoticeRow(force);
  if (runVersion !== renderVersion) return;

  const activeNotice = resolveActiveNotice(row);
  if (!activeNotice) {
    root.innerHTML = "";
    return;
  }

  const noticeVersionKey = buildNoticeVersionKey(activeNotice);
  if (!noticeVersionKey) {
    root.innerHTML = "";
    return;
  }

  const sessionUser = await getSessionUser();
  if (runVersion !== renderVersion) return;

  const dismissed = sessionUser
    ? await isDismissedForUser(sessionUser.id, noticeVersionKey)
    : isDismissedForGuest(noticeVersionKey);

  if (runVersion !== renderVersion) return;

  if (dismissed) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = "";
  const noticeElement = buildNoticeElement(activeNotice, async () => {
    if (sessionUser?.id) {
      await dismissNoticeForUser(sessionUser.id, noticeVersionKey);
    } else {
      dismissNoticeForGuest(noticeVersionKey);
    }

    root.innerHTML = "";
  });

  root.appendChild(noticeElement);
}

export function initializeRegistrationNoticeSystem() {
  if (isInitialized) return;
  isInitialized = true;

  document.addEventListener("pageLoaded", () => {
    void renderRegistrationNotice();
  });

  window.addEventListener("focus", () => {
    void renderRegistrationNotice({ force: true });
  });

  try {
    supabase.auth.onAuthStateChange(() => {
      void renderRegistrationNotice({ force: true });
    });
  } catch {
    // Ignore auth listener setup failures.
  }

  void renderRegistrationNotice({ force: true });
}
