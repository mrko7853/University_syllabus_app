import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.1";
import {
  CORS_HEADERS,
  DEFAULT_TIMEZONE,
  FeedKind,
  PERIOD_TIMES,
  defaultSettings,
  escapeIcsText,
  firstDateForWeekday,
  formatDateYmd,
  formatLocalDateTime,
  formatUtcDateTime,
  getTermDateRange,
  inferCurrentTermValue,
  mapSettingsRow,
  normalizeFeedKind,
  normalizeTerm,
  optionsResponse,
  parseCourseSchedule,
  parseTermValue,
  serializeIcsLines,
} from "../_shared/calendar.ts";

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "");
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type CourseRow = {
  course_code: string;
  title: string | null;
  professor: string | null;
  location: string | null;
  type: string | null;
  time_slot: string | null;
};

type AssignmentRow = {
  id: string;
  title: string | null;
  due_date: string | null;
  status: string | null;
  course_code: string | null;
  course_tag_name: string | null;
  course_year: string | number | null;
  course_term: string | null;
  instructions: string | null;
};

type FeedTokenRow = {
  user_id: string;
  feed_kind: FeedKind;
  is_active: boolean;
};

function sanitizeUid(value: string): string {
  return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function inferFeedName(feedKind: FeedKind): string {
  if (feedKind === "courses") return "ILA Companion - Courses";
  if (feedKind === "assignments") return "ILA Companion - Assignments";
  return "ILA Companion - Courses and Assignments";
}

function buildDescriptionLines(values: Array<string | null | undefined>): string {
  return values.filter((value) => Boolean(value && String(value).trim())).join("\n");
}

function parseSelectionYear(raw: unknown): number | null {
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTermSelectionValue(term: string, year: number): string {
  return `${normalizeTerm(term)}-${year}`;
}

function getDefaultTermSelection(): { term: string; year: number } {
  return inferCurrentTermValue(new Date());
}

async function resolveUserSelectedTerm(userId: string): Promise<{ term: string; year: number }> {
  const { data, error } = await admin
    .from("user_settings")
    .select("current_term")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return getDefaultTermSelection();
  }

  const parsed = parseTermValue(data?.current_term || "");
  if (parsed) return parsed;
  return getDefaultTermSelection();
}

async function fetchFeedToken(token: string): Promise<FeedTokenRow | null> {
  const { data, error } = await admin
    .from("calendar_feed_tokens")
    .select("user_id, feed_kind, is_active")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;

  const feedKind = normalizeFeedKind(data.feed_kind);
  if (!feedKind || data.is_active !== true) return null;

  return {
    user_id: String(data.user_id),
    feed_kind: feedKind,
    is_active: Boolean(data.is_active),
  };
}

async function fetchSettings(userId: string) {
  const { data, error } = await admin
    .from("calendar_integration_settings")
    .select("feed_mode, timezone, scope, assignments_rule")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return defaultSettings();
  return mapSettingsRow(data || undefined);
}

async function fetchCoursesForTerm(userId: string, term: string, year: number): Promise<CourseRow[]> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("courses_selection")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("Failed loading profile courses_selection", profileError);
    return [];
  }

  const selected = Array.isArray(profile?.courses_selection) ? profile.courses_selection : [];
  const normalizedTerm = normalizeTerm(term);

  const selectedCodes = selected
    .filter((entry) => {
      const code = String(entry?.code || "").trim();
      const entryYear = parseSelectionYear(entry?.year);
      const entryTerm = normalizeTerm(entry?.term || "");
      if (!code || entryYear === null) return false;
      if (entryYear !== year) return false;
      return !entryTerm || entryTerm === normalizedTerm;
    })
    .map((entry) => String(entry.code).trim());

  const uniqueCodes = Array.from(new Set(selectedCodes));
  if (uniqueCodes.length === 0) return [];

  const { data: courses, error: coursesError } = await admin
    .from("courses")
    .select("course_code, title, professor, location, type, time_slot")
    .eq("academic_year", year)
    .eq("term", normalizedTerm)
    .in("course_code", uniqueCodes);

  if (coursesError) {
    console.error("Failed loading courses for calendar feed", coursesError);
    return [];
  }

  return (courses || []) as CourseRow[];
}

async function fetchAssignmentsForTerm(userId: string, term: string, year: number): Promise<AssignmentRow[]> {
  const normalizedTerm = normalizeTerm(term);

  const { data, error } = await admin
    .from("assignments")
    .select("id, title, due_date, status, course_code, course_tag_name, course_year, course_term, instructions")
    .eq("user_id", userId)
    .neq("status", "completed")
    .not("due_date", "is", null)
    .order("due_date", { ascending: true });

  if (error) {
    console.error("Failed loading assignments for calendar feed", error);
    return [];
  }

  return (data || []).filter((assignment) => {
    const assignmentYear = assignment?.course_year === null || assignment?.course_year === undefined
      ? null
      : Number.parseInt(String(assignment.course_year), 10);
    const assignmentTerm = normalizeTerm(assignment?.course_term || "");

    if (!Number.isFinite(assignmentYear) || !assignmentTerm) {
      return true;
    }

    return assignmentYear === year && assignmentTerm === normalizedTerm;
  }) as AssignmentRow[];
}

function endOfTermUntilUtc(endDate: Date): string {
  const untilUtc = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 14, 59, 59));
  return formatUtcDateTime(untilUtc);
}

function buildCourseEvents(courses: CourseRow[], selectedTerm: { term: string; year: number }, dtstamp: string): string[] {
  const lines: string[] = [];
  const { startDate, endDate } = getTermDateRange(selectedTerm.term, selectedTerm.year);
  const untilValue = endOfTermUntilUtc(endDate);

  for (const course of courses) {
    const parsed = parseCourseSchedule(course.time_slot);
    if (!parsed) continue;

    const periodInfo = PERIOD_TIMES[parsed.period];
    if (!periodInfo) continue;

    const firstDate = firstDateForWeekday(startDate, parsed.dayCode);
    if (!firstDate) continue;
    if (firstDate.getTime() > endDate.getTime()) continue;

    const summary = `Class: ${course.title || course.course_code}`;
    const description = buildDescriptionLines([
      `Course code: ${course.course_code}`,
      course.type ? `Type: ${course.type}` : null,
      course.professor ? `Professor: ${course.professor}` : null,
      course.location ? `Location: ${course.location}` : null,
      `Term: ${buildTermSelectionValue(selectedTerm.term, selectedTerm.year)}`,
    ]);

    const uid = `course-${sanitizeUid(course.course_code)}-${selectedTerm.year}-${selectedTerm.term.toLowerCase()}-${parsed.dayCode}-${parsed.period}@ila-companion`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    if (course.location) lines.push(`LOCATION:${escapeIcsText(course.location)}`);
    lines.push(`DTSTART;TZID=${DEFAULT_TIMEZONE}:${formatLocalDateTime(firstDate, periodInfo.start)}`);
    lines.push(`DTEND;TZID=${DEFAULT_TIMEZONE}:${formatLocalDateTime(firstDate, periodInfo.end)}`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${parsed.byDay};UNTIL=${untilValue}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  return lines;
}

function buildAssignmentEvents(assignments: AssignmentRow[], dtstamp: string): string[] {
  const lines: string[] = [];

  for (const assignment of assignments) {
    if (!assignment.due_date) continue;
    const dueDate = new Date(assignment.due_date);
    if (Number.isNaN(dueDate.getTime())) continue;

    const dueDay = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
    const dueDayEnd = new Date(dueDay.getTime());
    dueDayEnd.setUTCDate(dueDayEnd.getUTCDate() + 1);

    const title = String(assignment.title || "Untitled assignment").trim() || "Untitled assignment";
    const summary = `Due: ${title}`;
    const courseLabel = assignment.course_tag_name || assignment.course_code || null;

    const description = buildDescriptionLines([
      courseLabel ? `Course: ${courseLabel}` : null,
      assignment.instructions ? `Instructions: ${assignment.instructions}` : null,
    ]);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:assignment-${sanitizeUid(assignment.id)}@ila-companion`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push(`DTSTART;VALUE=DATE:${formatDateYmd(dueDay)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateYmd(dueDayEnd)}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  return lines;
}

function buildIcsDocument(payload: {
  feedKind: FeedKind;
  selectedTerm: { term: string; year: number };
  courses: CourseRow[];
  assignments: AssignmentRow[];
}): string {
  const dtstamp = formatUtcDateTime(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ILA Companion//Calendar Integration//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(inferFeedName(payload.feedKind))}`,
    `X-WR-TIMEZONE:${DEFAULT_TIMEZONE}`,
    "BEGIN:VTIMEZONE",
    `TZID:${DEFAULT_TIMEZONE}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "TZNAME:JST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  if (payload.feedKind === "courses" || payload.feedKind === "combined") {
    lines.push(...buildCourseEvents(payload.courses, payload.selectedTerm, dtstamp));
  }

  if (payload.feedKind === "assignments" || payload.feedKind === "combined") {
    lines.push(...buildAssignmentEvents(payload.assignments, dtstamp));
  }

  lines.push("END:VCALENDAR");
  return serializeIcsLines(lines);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get("token") || "").trim();
    const forceDownload = url.searchParams.get("download") === "1";

    if (!token) {
      return new Response("Not found", {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const tokenRow = await fetchFeedToken(token);
    if (!tokenRow || !tokenRow.is_active) {
      return new Response("Not found", {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const settings = await fetchSettings(tokenRow.user_id);
    const selectedTerm = await resolveUserSelectedTerm(tokenRow.user_id);

    const includeCourses = tokenRow.feed_kind === "courses" || tokenRow.feed_kind === "combined";
    const includeAssignments = tokenRow.feed_kind === "assignments" || tokenRow.feed_kind === "combined";

    const [courses, assignments] = await Promise.all([
      includeCourses
        ? fetchCoursesForTerm(tokenRow.user_id, selectedTerm.term, selectedTerm.year)
        : Promise.resolve([]),
      includeAssignments
        ? fetchAssignmentsForTerm(tokenRow.user_id, selectedTerm.term, selectedTerm.year)
        : Promise.resolve([]),
    ]);

    const ics = buildIcsDocument({
      feedKind: tokenRow.feed_kind,
      selectedTerm,
      courses,
      assignments,
    });

    const filename = `ila-calendar-${tokenRow.feed_kind}.ics`;

    return new Response(ics, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=300",
        ...(forceDownload ? { "Content-Disposition": `attachment; filename=\"${filename}\"` } : {}),
        "X-Calendar-Term": buildTermSelectionValue(selectedTerm.term, selectedTerm.year),
        "X-Calendar-Timezone": settings.timezone || DEFAULT_TIMEZONE,
      },
    });
  } catch (error) {
    console.error("calendar-feed error", error);
    return new Response("Internal server error", {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
});
