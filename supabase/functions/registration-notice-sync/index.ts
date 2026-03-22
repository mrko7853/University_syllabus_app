import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "");
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

const NOTICE_KEY = "ila-course-registration";
const SOURCE_URL = "https://ila.doshisha.ac.jp/ila/en/private/current-students.html";
const SOURCE_FALLBACK_URL = "https://r.jina.ai/http://ila.doshisha.ac.jp/ila/en/private/current-students.html";
const JST_OFFSET_HOURS = 9;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type NoticeRow = {
  notice_key: string;
  source_url: string | null;
  source_snapshot_hash: string | null;
  registration_label: string | null;
  registration_period_text: string | null;
  registration_start_at: string | null;
  registration_end_at: string | null;
  withdrawal_label: string | null;
  withdrawal_period_text: string | null;
  withdrawal_start_at: string | null;
  withdrawal_end_at: string | null;
  last_synced_at: string | null;
  updated_at: string | null;
};

type ParsedPeriod = {
  label: string;
  periodText: string;
  startAtIso: string;
  endAtIso: string;
};

type ParsedNoticeData = {
  sourceUrl: string;
  sourceSnapshotHash: string;
  referenceYear: number;
  registration: ParsedPeriod;
  withdrawal: ParsedPeriod;
};

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)";
const DATE_POINT_PATTERN = `${MONTH_PATTERN}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*\\([^\\)]*\\))?(?:\\s+\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))?`;
const DATE_RANGE_REGEX = new RegExp(`(${DATE_POINT_PATTERN})\\s*(?:to|\\-|–|~|〜)\\s*(${DATE_POINT_PATTERN})`, "i");

function optionsResponse() {
  return new Response("ok", { headers: CORS_HEADERS });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function getCurrentJstYear(now = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  });
  const parsed = Number.parseInt(formatter.format(now), 10);
  return Number.isFinite(parsed) ? parsed : now.getUTCFullYear();
}

function normalizeWhitespace(value: string): string {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function stripHtmlToText(raw: string): string {
  const normalized = String(raw || "").trim();
  if (!normalized) return "";

  if (!/<html[\s>]|<body[\s>]|<!doctype/i.test(normalized)) {
    return normalizeWhitespace(normalized);
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalized, "text/html");
    const text = doc.body?.textContent || doc.documentElement?.textContent || "";
    if (!text.trim()) return normalizeWhitespace(normalized);
    return normalizeWhitespace(text);
  } catch {
    return normalizeWhitespace(normalized);
  }
}

async function fetchSourceText(): Promise<{ text: string }> {
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://ila.doshisha.ac.jp/",
    },
  };

  const candidates = [SOURCE_URL, SOURCE_FALLBACK_URL];

  for (const url of candidates) {
    try {
      const response = await fetch(url, requestInit);
      if (!response.ok) continue;

      const rawText = await response.text();
      const normalizedText = stripHtmlToText(rawText);
      if (!normalizedText) continue;

      return {
        text: normalizedText,
      };
    } catch {
      // Try next source URL.
    }
  }

  throw new Error("Unable to fetch registration source page");
}

function findImportantDatesScope(text: string): string {
  const normalized = String(text || "");
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  const startIndex = lower.indexOf("important dates");
  if (startIndex === -1) {
    return normalized.slice(0, 8000);
  }
  return normalized.slice(startIndex, Math.min(normalized.length, startIndex + 12000));
}

function inferReferenceYear(scope: string): number {
  const currentJstYear = getCurrentJstYear();
  const years = Array.from(scope.matchAll(/\b(20\d{2})\b/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  if (years.length === 0) return currentJstYear;
  return Math.max(...years);
}

function extractContext(text: string, keyword: string, trailingChars = 1600): string {
  const normalized = String(text || "");
  const idx = normalized.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return "";

  const start = Math.max(0, idx - 120);
  const end = Math.min(normalized.length, idx + trailingChars);
  return normalized.slice(start, end);
}

function findRangeByKeywords(scope: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    const context = extractContext(scope, keyword);
    if (!context) continue;

    const normalizedContext = context.replace(/\|/g, " ");
    const match = normalizedContext.match(DATE_RANGE_REGEX);
    if (match?.[0]) {
      return normalizeWhitespace(match[0]);
    }
  }

  return null;
}

function parseMonth(rawMonth: string): number | null {
  const normalized = String(rawMonth || "")
    .toLowerCase()
    .replace(/\./g, "")
    .trim();

  const month = MONTH_INDEX[normalized];
  return Number.isFinite(month) ? month : null;
}

function parseDatePoint(raw: string, defaultYear: number, isEndPoint: boolean) {
  const normalized = normalizeWhitespace(raw)
    .replace(/\(JST\)/gi, "")
    .replace(/\s+/g, " ");

  const baseMatch = normalized.match(new RegExp(`(${MONTH_PATTERN})\\s+(\\d{1,2})`, "i"));
  if (!baseMatch) {
    throw new Error(`Unable to parse date point: ${raw}`);
  }

  const month = parseMonth(baseMatch[1]);
  const day = Number.parseInt(baseMatch[2], 10);
  if (!month || !Number.isFinite(day)) {
    throw new Error(`Unable to parse month/day: ${raw}`);
  }

  const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  let hours = isEndPoint ? 23 : 0;
  let minutes = isEndPoint ? 59 : 0;

  if (timeMatch) {
    const baseHour = Number.parseInt(timeMatch[1], 10);
    const baseMinute = Number.parseInt(timeMatch[2] || "0", 10);
    const ampm = String(timeMatch[3] || "").toLowerCase();
    const normalizedHour = baseHour % 12;

    hours = ampm.startsWith("p") ? normalizedHour + 12 : normalizedHour;
    minutes = Number.isFinite(baseMinute) ? baseMinute : 0;
  }

  return {
    year: defaultYear,
    month,
    day,
    hours,
    minutes,
  };
}

function jstPartsToIso(parts: { year: number; month: number; day: number; hours: number; minutes: number }): string {
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours - JST_OFFSET_HOURS, parts.minutes, 0);
  return new Date(utcMs).toISOString();
}

function parseRange(rangeText: string, referenceYear: number): { startAtIso: string; endAtIso: string } {
  const match = rangeText.match(DATE_RANGE_REGEX);
  if (!match?.[1] || !match?.[2]) {
    throw new Error(`Unable to parse date range: ${rangeText}`);
  }

  const start = parseDatePoint(match[1], referenceYear, false);
  const end = parseDatePoint(match[2], referenceYear, true);

  if (end.month < start.month) {
    end.year = start.year + 1;
  } else {
    end.year = start.year;
  }

  const startAtIso = jstPartsToIso(start);
  const endAtIso = jstPartsToIso(end);

  return { startAtIso, endAtIso };
}

function hashText(value: string): string {
  let hash = 2166136261;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  const normalized = (hash >>> 0).toString(16);
  return normalized.padStart(8, "0");
}

function buildParsedNoticeData(rawText: string): ParsedNoticeData {
  const scope = findImportantDatesScope(rawText);
  const referenceYear = inferReferenceYear(scope);

  const registrationRangeText = findRangeByKeywords(scope, [
    "General Registration",
  ]);
  if (!registrationRangeText) {
    throw new Error("General Registration period not found in source");
  }

  const withdrawalRangeText = findRangeByKeywords(scope, [
    "The Course Withdrawal Period",
    "Course Withdrawal Period",
    "Withdrawal Period",
  ]);
  if (!withdrawalRangeText) {
    throw new Error("Course Withdrawal period not found in source");
  }

  const registrationRange = parseRange(registrationRangeText, referenceYear);
  const withdrawalRange = parseRange(withdrawalRangeText, referenceYear);

  return {
    sourceUrl: SOURCE_URL,
    sourceSnapshotHash: hashText(scope),
    referenceYear,
    registration: {
      label: "General Registration",
      periodText: registrationRangeText,
      startAtIso: registrationRange.startAtIso,
      endAtIso: registrationRange.endAtIso,
    },
    withdrawal: {
      label: "Course Withdrawal Period",
      periodText: withdrawalRangeText,
      startAtIso: withdrawalRange.startAtIso,
      endAtIso: withdrawalRange.endAtIso,
    },
  };
}

async function fetchExistingRow(): Promise<NoticeRow | null> {
  const { data, error } = await admin
    .from("registration_notice_periods")
    .select(
      "notice_key,source_url,source_snapshot_hash,registration_label,registration_period_text,registration_start_at,registration_end_at,withdrawal_label,withdrawal_period_text,withdrawal_start_at,withdrawal_end_at,last_synced_at,updated_at"
    )
    .eq("notice_key", NOTICE_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data || null) as NoticeRow | null;
}

function isWithinRateLimit(existing: NoticeRow | null, force: boolean): boolean {
  if (force) return false;
  const lastSyncedAtMs = Date.parse(String(existing?.last_synced_at || ""));
  if (!Number.isFinite(lastSyncedAtMs)) return false;

  return (Date.now() - lastSyncedAtMs) < RATE_LIMIT_WINDOW_MS;
}

function isUpcomingPeriod(parsed: ParsedNoticeData): boolean {
  const now = Date.now();
  const registrationEnd = Date.parse(parsed.registration.endAtIso);
  const withdrawalEnd = Date.parse(parsed.withdrawal.endAtIso);

  return (Number.isFinite(registrationEnd) && registrationEnd >= now)
    || (Number.isFinite(withdrawalEnd) && withdrawalEnd >= now);
}

async function upsertNoticeRow(existing: NoticeRow | null, parsed: ParsedNoticeData) {
  const nowIso = new Date().toISOString();
  const hasUpcomingPeriod = isUpcomingPeriod(parsed);

  const payload = {
    notice_key: NOTICE_KEY,
    source_url: parsed.sourceUrl,
    source_snapshot_hash: parsed.sourceSnapshotHash,
    registration_label: hasUpcomingPeriod || !existing
      ? parsed.registration.label
      : (existing?.registration_label || parsed.registration.label),
    registration_period_text: hasUpcomingPeriod || !existing
      ? parsed.registration.periodText
      : (existing?.registration_period_text || parsed.registration.periodText),
    registration_start_at: hasUpcomingPeriod || !existing
      ? parsed.registration.startAtIso
      : (existing?.registration_start_at || parsed.registration.startAtIso),
    registration_end_at: hasUpcomingPeriod || !existing
      ? parsed.registration.endAtIso
      : (existing?.registration_end_at || parsed.registration.endAtIso),
    withdrawal_label: hasUpcomingPeriod || !existing
      ? parsed.withdrawal.label
      : (existing?.withdrawal_label || parsed.withdrawal.label),
    withdrawal_period_text: hasUpcomingPeriod || !existing
      ? parsed.withdrawal.periodText
      : (existing?.withdrawal_period_text || parsed.withdrawal.periodText),
    withdrawal_start_at: hasUpcomingPeriod || !existing
      ? parsed.withdrawal.startAtIso
      : (existing?.withdrawal_start_at || parsed.withdrawal.startAtIso),
    withdrawal_end_at: hasUpcomingPeriod || !existing
      ? parsed.withdrawal.endAtIso
      : (existing?.withdrawal_end_at || parsed.withdrawal.endAtIso),
    last_synced_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await admin
    .from("registration_notice_periods")
    .upsert(payload, { onConflict: "notice_key" })
    .select(
      "notice_key,source_url,source_snapshot_hash,registration_label,registration_period_text,registration_start_at,registration_end_at,withdrawal_label,withdrawal_period_text,withdrawal_start_at,withdrawal_end_at,last_synced_at,updated_at"
    )
    .single();

  if (error) {
    throw error;
  }

  return {
    row: data,
    hasUpcomingPeriod,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Server is missing Supabase credentials" }, 500);
    }

    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const force = body?.force === true || String(body?.force || "").toLowerCase() === "true";
    const existing = await fetchExistingRow();

    if (isWithinRateLimit(existing, force)) {
      return jsonResponse({
        status: "skipped_recent_sync",
        forced: force,
        row: existing,
      });
    }

    const source = await fetchSourceText();
    const parsed = buildParsedNoticeData(source.text);
    const upserted = await upsertNoticeRow(existing, parsed);

    return jsonResponse({
      status: "ok",
      forced: force,
      reference_year: parsed.referenceYear,
      has_upcoming_period: upserted.hasUpcomingPeriod,
      row: upserted.row,
    });
  } catch (error) {
    console.error("registration-notice-sync error", error);
    return jsonResponse({
      error: "Failed to sync registration notice",
      details: error instanceof Error ? error.message : "unknown error",
    }, 500);
  }
});
