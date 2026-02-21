export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const DEFAULT_TIMEZONE = "Asia/Tokyo";
export const DEFAULT_SCOPE = "selected_term";
export const DEFAULT_ASSIGNMENTS_RULE = "incomplete_only";

export const FEED_KINDS = ["courses", "assignments", "combined"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

export const FEED_MODES = ["separate", "combined"] as const;
export type FeedMode = (typeof FEED_MODES)[number];

export type CalendarIntegrationSettings = {
  feedMode: FeedMode;
  timezone: string;
  scope: "selected_term";
  assignmentsRule: "incomplete_only";
};

export const PERIOD_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: "09:00", end: "10:30" },
  2: { start: "10:45", end: "12:15" },
  3: { start: "13:10", end: "14:40" },
  4: { start: "14:55", end: "16:25" },
  5: { start: "16:40", end: "18:10" },
};

const DAY_TO_ICAL: Record<string, string> = {
  Mon: "MO",
  Tue: "TU",
  Wed: "WE",
  Thu: "TH",
  Fri: "FR",
};

const JP_DAY_TO_EN: Record<string, string> = {
  月: "Mon",
  火: "Tue",
  水: "Wed",
  木: "Thu",
  金: "Fri",
};

const EN_DAY_TO_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
};

const PERIOD_FROM_START: Record<string, number> = {
  "09:00": 1,
  "10:45": 2,
  "13:10": 3,
  "14:55": 4,
  "16:40": 5,
};

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function optionsResponse(): Response {
  return new Response("ok", {
    headers: CORS_HEADERS,
  });
}

export function normalizeFeedMode(value: unknown): FeedMode {
  return value === "combined" ? "combined" : "separate";
}

export function normalizeFeedKind(value: unknown): FeedKind | null {
  return FEED_KINDS.includes(value as FeedKind) ? (value as FeedKind) : null;
}

export function normalizeFeedKinds(values: unknown): FeedKind[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => normalizeFeedKind(value))
    .filter((value): value is FeedKind => Boolean(value));
  return Array.from(new Set(normalized));
}

export function defaultSettings(feedMode: FeedMode = "separate"): CalendarIntegrationSettings {
  return {
    feedMode,
    timezone: DEFAULT_TIMEZONE,
    scope: DEFAULT_SCOPE,
    assignmentsRule: DEFAULT_ASSIGNMENTS_RULE,
  };
}

export function mapSettingsRow(row: Record<string, unknown> | null | undefined): CalendarIntegrationSettings {
  if (!row) return defaultSettings();

  return {
    feedMode: normalizeFeedMode(row.feed_mode),
    timezone: String(row.timezone || DEFAULT_TIMEZONE),
    scope: DEFAULT_SCOPE,
    assignmentsRule: DEFAULT_ASSIGNMENTS_RULE,
  };
}

export function getRequiredKindsForMode(feedMode: FeedMode): FeedKind[] {
  return feedMode === "combined" ? ["combined"] : ["courses", "assignments"];
}

export function generateSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function getFunctionsBaseUrl(baseOrigin?: string): string {
  if (baseOrigin) {
    return `${String(baseOrigin).replace(/\/+$/g, "")}/functions/v1`;
  }

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/g, "");
  return `${supabaseUrl}/functions/v1`;
}

export function buildFeedUrls(
  token: string,
  baseOrigin?: string,
): { httpsUrl: string; webcalUrl: string; googleSubscribeUrl: string } {
  const base = getFunctionsBaseUrl(baseOrigin);
  const httpsUrl = `${base}/calendar-feed?token=${encodeURIComponent(token)}`;
  const webcalUrl = httpsUrl.startsWith("https://") ? `webcal://${httpsUrl.slice("https://".length)}` : httpsUrl;
  const googleSubscribeUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(httpsUrl)}`;
  return { httpsUrl, webcalUrl, googleSubscribeUrl };
}

export function normalizeTerm(rawTerm: unknown): string {
  const value = String(rawTerm || "").trim();
  if (!value) return "";

  if (value.includes("/")) {
    const split = value.split("/");
    return normalizeTerm(split[split.length - 1]);
  }

  const lower = value.toLowerCase();
  if (lower.includes("fall") || value.includes("秋")) return "Fall";
  if (lower.includes("spring") || value.includes("春")) return "Spring";
  return value;
}

export function parseTermValue(rawValue: unknown): { term: string; year: number } | null {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  const normalized = value.replace(/\s+/g, "-");
  const [termRaw, yearRaw] = normalized.split("-");
  const year = Number.parseInt(String(yearRaw || ""), 10);
  const term = normalizeTerm(termRaw);

  if (!term || !Number.isFinite(year)) return null;
  return { term, year };
}

export function inferCurrentTermValue(now = new Date()): { term: string; year: number } {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const term = month >= 8 || month <= 2 ? "Fall" : "Spring";
  return { term, year };
}

export function getTermDateRange(term: string, year: number): { startDate: Date; endDate: Date } {
  const normalized = normalizeTerm(term);

  if (normalized === "Spring") {
    return {
      startDate: new Date(Date.UTC(year, 3, 1)),
      endDate: new Date(Date.UTC(year, 7, 15)),
    };
  }

  if (normalized === "Fall") {
    return {
      startDate: new Date(Date.UTC(year, 8, 1)),
      endDate: new Date(Date.UTC(year + 1, 0, 31)),
    };
  }

  return {
    startDate: new Date(Date.UTC(year, 0, 1)),
    endDate: new Date(Date.UTC(year, 11, 31)),
  };
}

export function parseCourseSchedule(raw: unknown): { dayCode: string; period: number; byDay: string } | null {
  const timeSlot = String(raw || "").trim();
  if (!timeSlot) return null;

  const jpMatch = timeSlot.match(/\(?([月火水木金土日])(?:曜日)?(\d+)(?:講時)?\)?/);
  if (jpMatch) {
    const dayCode = JP_DAY_TO_EN[jpMatch[1]];
    const period = Number.parseInt(jpMatch[2], 10);
    if (!dayCode || !PERIOD_TIMES[period]) return null;
    return {
      dayCode,
      period,
      byDay: DAY_TO_ICAL[dayCode],
    };
  }

  const enMatch = timeSlot.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
  if (!enMatch) return null;

  const dayCode = enMatch[1];
  const start = `${enMatch[2]}:${enMatch[3]}`;
  const period = PERIOD_FROM_START[start];

  if (!DAY_TO_ICAL[dayCode] || !period || !PERIOD_TIMES[period]) return null;
  return {
    dayCode,
    period,
    byDay: DAY_TO_ICAL[dayCode],
  };
}

export function firstDateForWeekday(startDate: Date, dayCode: string): Date | null {
  const targetIndex = EN_DAY_TO_INDEX[dayCode];
  if (!targetIndex) return null;

  const date = new Date(startDate.getTime());
  const currentIndex = date.getUTCDay();
  const delta = (targetIndex - currentIndex + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

export function formatDateYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function formatUtcDateTime(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export function formatLocalDateTime(date: Date, hhmm: string): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const [hours, minutes] = hhmm.split(":");
  return `${year}${month}${day}T${hours}${minutes}00`;
}

export function escapeIcsText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line: string): string {
  const segments: string[] = [];
  let current = "";
  const encoder = new TextEncoder();

  for (const char of line) {
    const candidate = current + char;
    if (encoder.encode(candidate).length > 75) {
      if (current.length === 0) {
        segments.push(candidate);
        current = "";
      } else {
        segments.push(current);
        current = char;
      }
    } else {
      current = candidate;
    }
  }

  if (current.length > 0 || segments.length === 0) {
    segments.push(current);
  }

  const [first, ...rest] = segments;
  return [first, ...rest.map((segment) => ` ${segment}`)].join("\r\n");
}

export function serializeIcsLines(lines: string[]): string {
  return `${lines.map((line) => foldIcsLine(line)).join("\r\n")}\r\n`;
}
