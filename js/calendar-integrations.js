import { supabase } from "../supabase.js";

const FEED_MODES = new Set(["separate", "combined"]);

function getFunctionsBaseUrl() {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/g, "");
  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL");
  }
  return `${supabaseUrl}/functions/v1`;
}

function normalizeFeedMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  return FEED_MODES.has(raw) ? raw : "separate";
}

function normalizeAbsoluteFeedUrl(urlValue) {
  const raw = String(urlValue || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("/")) {
    const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/g, "");
    return supabaseUrl ? `${supabaseUrl}${raw}` : raw;
  }

  return raw;
}

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) {
    throw new Error("Authentication required");
  }

  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "");
  return {
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
  };
}

async function requestCalendarIntegration(method, body = null) {
  const headers = await getAuthHeaders();
  const requestHeaders = {
    ...headers,
  };

  const init = {
    method,
    headers: requestHeaders,
  };

  if (body !== null) {
    requestHeaders["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${getFunctionsBaseUrl()}/calendar-integrations`, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = payload?.error || `Calendar integration request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload;
}

export async function fetchCalendarIntegrationState() {
  return requestCalendarIntegration("GET");
}

export async function ensureCalendarFeeds(feedMode = "separate") {
  return requestCalendarIntegration("POST", {
    action: "ensure_feeds",
    feedMode: normalizeFeedMode(feedMode),
  });
}

export async function rotateCalendarFeeds(kinds = []) {
  const normalizedKinds = Array.isArray(kinds)
    ? kinds.map((kind) => String(kind || "").trim().toLowerCase()).filter(Boolean)
    : [];

  return requestCalendarIntegration("POST", {
    action: "rotate_feeds",
    kinds: normalizedKinds,
  });
}

export async function disconnectAllCalendarFeeds() {
  return requestCalendarIntegration("POST", {
    action: "disconnect_all",
  });
}

export function buildProviderLinks(feed) {
  const httpsUrl = normalizeAbsoluteFeedUrl(feed?.httpsUrl);
  const googleSubscribeUrl = String(feed?.googleSubscribeUrl || "").trim()
    || (httpsUrl ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(httpsUrl)}` : "");

  return {
    httpsUrl,
    googleSubscribeUrl
  };
}
