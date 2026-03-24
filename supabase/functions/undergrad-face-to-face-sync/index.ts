import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "");
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

const TABLE_NAME = "undergrad_face_to_face_periods";
const SOURCE_URL = "https://www.doshisha.ac.jp/en/students/calendar_undergrad/index.html";
const SOURCE_FALLBACK_URL = "https://r.jina.ai/http://www.doshisha.ac.jp/en/students/calendar_undergrad/index.html";
const JST_OFFSET_HOURS = 9;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type TermValue = "Spring" | "Fall";

type ParsedPeriod = {
  academicYear: number;
  term: TermValue;
  startText: string;
  endText: string;
  startAtIso: string;
  endAtIso: string;
};

type ParsedPayload = {
  sourceUrl: string;
  sourceSnapshotHash: string;
  periods: ParsedPeriod[];
};

type DateParts = {
  year: number;
  month: number;
  day: number;
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

async function fetchSourceText(): Promise<string> {
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.doshisha.ac.jp/",
    },
  };

  const candidates = [SOURCE_FALLBACK_URL, SOURCE_URL];

  for (const url of candidates) {
    try {
      const response = await fetch(url, requestInit);
      if (!response.ok) continue;

      const rawText = await response.text();
      const normalizedText = stripHtmlToText(rawText);
      if (!normalizedText) continue;

      return normalizedText;
    } catch {
      // Try the next source candidate.
    }
  }

  throw new Error("Unable to fetch undergraduate calendar source page");
}

function getRelevantCalendarScope(text: string): string {
  const normalized = String(text || "");
  if (!normalized) return "";

  const marker = "Faculty Calendar";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return normalized.slice(0, 40000);
  }

  return normalized.slice(markerIndex, Math.min(normalized.length, markerIndex + 60000));
}

function parseMonth(rawMonth: string): number | null {
  const normalized = String(rawMonth || "")
    .toLowerCase()
    .replace(/\./g, "")
    .trim();

  const month = MONTH_INDEX[normalized];
  return Number.isFinite(month) ? month : null;
}

function parseDatePrefix(line: string, defaultYear: number): DateParts | null {
  const normalized = normalizeWhitespace(line).replace(/\|/g, " ").replace(/^[\s•・*\-]+/, "");
  const match = normalized.match(/\b([A-Za-z]+)\s+(\d{1,2})\b/);
  if (!match?.[1] || !match?.[2]) return null;

  const month = parseMonth(match[1]);
  const day = Number.parseInt(match[2], 10);
  if (!month || !Number.isFinite(day)) return null;

  return {
    year: defaultYear,
    month,
    day,
  };
}

function jstDateToIso(parts: DateParts, isEndBoundary: boolean): string {
  const hours = isEndBoundary ? 23 : 0;
  const minutes = isEndBoundary ? 59 : 0;
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hours - JST_OFFSET_HOURS, minutes, 0);
  return new Date(utcMs).toISOString();
}

function isFaceToFaceStartLine(line: string): boolean {
  const normalized = String(line || "").toLowerCase();
  if (!/face\s*-?to\s*-?face classes/.test(normalized)) return false;
  if (/last day/.test(normalized)) return false;
  return /\b(begin|start|commence|recommence)\b/.test(normalized);
}

function isFaceToFaceEndLine(line: string): boolean {
  const normalized = String(line || "").toLowerCase();
  if (!/face\s*-?to\s*-?face classes/.test(normalized)) return false;
  return /last day/.test(normalized);
}

function parseSemesterSection(sectionText: string, academicYear: number, term: TermValue): ParsedPeriod {
  const lines = String(sectionText || "")
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  let lineYear = academicYear;
  let startEvent: { text: string; date: DateParts } | null = null;
  let endEvent: { text: string; date: DateParts } | null = null;

  for (const line of lines) {
    const yearOnlyMatch = line.match(/^(20\d{2})$/);
    if (yearOnlyMatch?.[1]) {
      const parsedYear = Number.parseInt(yearOnlyMatch[1], 10);
      if (Number.isFinite(parsedYear)) {
        lineYear = parsedYear;
      }
      continue;
    }

    const parsedDate = parseDatePrefix(line, lineYear);
    if (!parsedDate) continue;

    if (!startEvent && isFaceToFaceStartLine(line)) {
      startEvent = { text: line, date: parsedDate };
    }

    if (isFaceToFaceEndLine(line)) {
      endEvent = { text: line, date: parsedDate };
    }
  }

  if (!startEvent) {
    throw new Error(`Missing face-to-face start line for ${term} ${academicYear}`);
  }
  if (!endEvent) {
    throw new Error(`Missing face-to-face end line for ${term} ${academicYear}`);
  }

  const startDate = { ...startEvent.date };
  const endDate = { ...endEvent.date };
  let startAtIso = jstDateToIso(startDate, false);
  let endAtIso = jstDateToIso(endDate, true);

  if (Date.parse(endAtIso) < Date.parse(startAtIso)) {
    endDate.year += 1;
    endAtIso = jstDateToIso(endDate, true);
  }

  return {
    academicYear,
    term,
    startText: startEvent.text,
    endText: endEvent.text,
    startAtIso,
    endAtIso,
  };
}

function extractSemesterSections(scope: string): Array<{ term: TermValue; academicYear: number; sectionText: string }> {
  const headingRegex = /(?:###\s*)?(Spring|Fall)\s+Semester\s*\((20\d{2})\)/gi;
  const matches = Array.from(scope.matchAll(headingRegex));
  if (matches.length === 0) return [];

  const sections: Array<{ term: TermValue; academicYear: number; sectionText: string }> = [];

  matches.forEach((match, index) => {
    const fullHeading = String(match[0] || "");
    const termRaw = String(match[1] || "").trim();
    const term = termRaw === "Spring" ? "Spring" : "Fall";
    const academicYear = Number.parseInt(String(match[2] || ""), 10);
    if (!Number.isFinite(academicYear)) return;

    const headingStart = Number(match.index || 0);
    const contentStart = headingStart + fullHeading.length;
    const nextHeadingStart = index < matches.length - 1
      ? Number(matches[index + 1].index || scope.length)
      : scope.length;

    sections.push({
      term,
      academicYear,
      sectionText: scope.slice(contentStart, nextHeadingStart),
    });
  });

  return sections;
}

function buildParsedPayload(rawText: string): ParsedPayload {
  const scope = getRelevantCalendarScope(rawText);
  const sections = extractSemesterSections(scope);
  if (sections.length === 0) {
    throw new Error("No Spring/Fall semester sections found in undergraduate calendar source");
  }

  const deduped = new Map<string, ParsedPeriod>();
  for (const section of sections) {
    try {
      const parsed = parseSemesterSection(section.sectionText, section.academicYear, section.term);
      deduped.set(`${parsed.academicYear}-${parsed.term}`, parsed);
    } catch (error) {
      console.warn("Skipping unparseable semester section", {
        term: section.term,
        academicYear: section.academicYear,
        details: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  const periods = Array.from(deduped.values())
    .sort((left, right) => {
      if (left.academicYear !== right.academicYear) {
        return right.academicYear - left.academicYear;
      }
      if (left.term === right.term) return 0;
      return left.term === "Spring" ? -1 : 1;
    });

  if (periods.length === 0) {
    throw new Error("Unable to parse any face-to-face class periods from source page");
  }

  return {
    sourceUrl: SOURCE_URL,
    sourceSnapshotHash: hashText(scope),
    periods,
  };
}

async function fetchLatestSyncedAtMs(): Promise<number | null> {
  const { data, error } = await admin
    .from(TABLE_NAME)
    .select("last_synced_at")
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const latestIso = data?.[0]?.last_synced_at;
  const parsedMs = Date.parse(String(latestIso || ""));
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

function isWithinRateLimit(lastSyncedAtMs: number | null, force: boolean): boolean {
  if (force) return false;
  if (!Number.isFinite(lastSyncedAtMs ?? NaN)) return false;
  return (Date.now() - Number(lastSyncedAtMs)) < RATE_LIMIT_WINDOW_MS;
}

async function upsertParsedPeriods(parsed: ParsedPayload) {
  const nowIso = new Date().toISOString();

  const payload = parsed.periods.map((period) => ({
    academic_year: period.academicYear,
    term: period.term,
    source_url: parsed.sourceUrl,
    source_snapshot_hash: parsed.sourceSnapshotHash,
    face_to_face_start_text: period.startText,
    face_to_face_end_text: period.endText,
    face_to_face_start_at: period.startAtIso,
    face_to_face_end_at: period.endAtIso,
    last_synced_at: nowIso,
    updated_at: nowIso,
  }));

  const { data, error } = await admin
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: "academic_year,term" })
    .select("academic_year,term,face_to_face_start_at,face_to_face_end_at,last_synced_at,updated_at")
    .order("academic_year", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
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
    const lastSyncedAtMs = await fetchLatestSyncedAtMs();

    if (isWithinRateLimit(lastSyncedAtMs, force)) {
      return jsonResponse({
        status: "skipped_recent_sync",
        forced: force,
        last_synced_at: lastSyncedAtMs ? new Date(lastSyncedAtMs).toISOString() : null,
      });
    }

    const sourceText = await fetchSourceText();
    const parsed = buildParsedPayload(sourceText);
    const rows = await upsertParsedPeriods(parsed);

    return jsonResponse({
      status: "ok",
      forced: force,
      source_url: parsed.sourceUrl,
      source_snapshot_hash: parsed.sourceSnapshotHash,
      periods_count: parsed.periods.length,
      rows,
    });
  } catch (error) {
    console.error("undergrad-face-to-face-sync error", error);
    return jsonResponse({
      error: "Failed to sync undergraduate face-to-face class periods",
      details: error instanceof Error ? error.message : "unknown error",
    }, 500);
  }
});
