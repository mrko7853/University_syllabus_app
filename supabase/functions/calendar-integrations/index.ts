import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.1";
import {
  CORS_HEADERS,
  FeedKind,
  FeedMode,
  buildFeedUrls,
  defaultSettings,
  generateSecureToken,
  getRequiredKindsForMode,
  jsonResponse,
  mapSettingsRow,
  normalizeFeedKind,
  normalizeFeedKinds,
  normalizeFeedMode,
  optionsResponse,
} from "../_shared/calendar.ts";

type FeedRecord = {
  feed_kind: FeedKind;
  token: string;
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "");
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function resolveFunctionsOrigin(req: Request): string | null {
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

function buildFeeds(records: FeedRecord[], functionsOrigin: string | null) {
  return records.map((record) => ({
    kind: record.feed_kind,
    ...buildFeedUrls(record.token, functionsOrigin || undefined),
  }));
}

async function authenticate(req: Request): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.id) {
    console.warn("Auth verification failed:", error?.message || "unknown error");
    return null;
  }

  return { userId: data.user.id };
}

async function fetchSettings(userId: string) {
  const { data, error } = await admin
    .from("calendar_integration_settings")
    .select("feed_mode, timezone, scope, assignments_rule")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return mapSettingsRow(data || undefined);
}

async function fetchActiveTokenRecords(userId: string): Promise<FeedRecord[]> {
  const { data, error } = await admin
    .from("calendar_feed_tokens")
    .select("feed_kind, token")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const byKind = new Map<FeedKind, FeedRecord>();
  for (const row of data || []) {
    const kind = normalizeFeedKind(row.feed_kind);
    if (!kind || byKind.has(kind)) continue;
    byKind.set(kind, {
      feed_kind: kind,
      token: String(row.token || ""),
    });
  }

  return Array.from(byKind.values());
}

async function upsertSettings(userId: string, feedMode: FeedMode) {
  const settings = await fetchSettings(userId).catch(() => defaultSettings());
  const payload = {
    user_id: userId,
    feed_mode: feedMode,
    timezone: settings.timezone || defaultSettings().timezone,
    scope: settings.scope || defaultSettings().scope,
    assignments_rule: settings.assignmentsRule || defaultSettings().assignmentsRule,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("calendar_integration_settings").upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
}

async function createToken(userId: string, kind: FeedKind): Promise<FeedRecord> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = generateSecureToken(32);
    const { data, error } = await admin
      .from("calendar_feed_tokens")
      .insert({
        user_id: userId,
        feed_kind: kind,
        token,
        is_active: true,
      })
      .select("feed_kind, token")
      .single();

    if (!error && data) {
      return {
        feed_kind: normalizeFeedKind(data.feed_kind) || kind,
        token: String(data.token),
      };
    }

    if (error?.code !== "23505") {
      throw error;
    }
  }

  throw new Error("Unable to generate a unique feed token");
}

async function deactivateKinds(userId: string, kinds: FeedKind[]) {
  if (!kinds.length) return;

  const { error } = await admin
    .from("calendar_feed_tokens")
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("feed_kind", kinds);

  if (error) throw error;
}

async function deactivateKindsExcept(userId: string, allowedKinds: FeedKind[]) {
  const excludedKinds = (["courses", "assignments", "combined"] as FeedKind[]).filter((kind) => !allowedKinds.includes(kind));
  await deactivateKinds(userId, excludedKinds);
}

async function ensureFeeds(userId: string, feedMode: FeedMode) {
  await upsertSettings(userId, feedMode);

  const requiredKinds = getRequiredKindsForMode(feedMode);
  await deactivateKindsExcept(userId, requiredKinds);

  const activeRecords = await fetchActiveTokenRecords(userId);
  const byKind = new Map(activeRecords.map((record) => [record.feed_kind, record]));

  for (const kind of requiredKinds) {
    if (!byKind.has(kind)) {
      const created = await createToken(userId, kind);
      byKind.set(kind, created);
    }
  }

  return Array.from(byKind.values()).filter((record) => requiredKinds.includes(record.feed_kind));
}

async function buildState(userId: string, req: Request) {
  const settings = await fetchSettings(userId).catch(() => defaultSettings());
  const tokenRecords = await fetchActiveTokenRecords(userId);
  const feeds = buildFeeds(tokenRecords, resolveFunctionsOrigin(req));

  return {
    status: feeds.length > 0 ? "connected" : "not_connected",
    settings,
    feeds,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  try {
    const auth = await authenticate(req);
    if (!auth) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (req.method === "GET") {
      const state = await buildState(auth.userId, req);
      return jsonResponse(state);
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim().toLowerCase();

    if (action === "ensure_feeds") {
      const requestedMode = normalizeFeedMode(body?.feedMode);
      await ensureFeeds(auth.userId, requestedMode);
      const state = await buildState(auth.userId, req);
      return jsonResponse(state);
    }

    if (action === "rotate_feeds") {
      const requestedKinds = normalizeFeedKinds(body?.kinds);
      const kindsToRotate = requestedKinds.length > 0
        ? requestedKinds
        : getRequiredKindsForMode((await fetchSettings(auth.userId).catch(() => defaultSettings())).feedMode);

      await deactivateKinds(auth.userId, kindsToRotate);
      for (const kind of kindsToRotate) {
        await createToken(auth.userId, kind);
      }

      const state = await buildState(auth.userId, req);
      return jsonResponse(state);
    }

    if (action === "disconnect_all") {
      await deactivateKinds(auth.userId, ["courses", "assignments", "combined"]);
      const state = await buildState(auth.userId, req);
      return jsonResponse(state);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("calendar-integrations error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }
});
