import { supabase } from "../supabase.js";

export const SAVED_COURSES_STORAGE_KEY = "ila_saved_courses";
const DAY_ORDER = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

function normalizeTermName(termValue) {
  if (!termValue) return null;
  const raw = String(termValue).trim();
  if (!raw) return null;
  if (raw.includes("/")) return normalizeTermName(raw.split("/").pop());
  const lowered = raw.toLowerCase();
  if (lowered.includes("fall") || raw.includes("秋")) return "Fall";
  if (lowered.includes("spring") || raw.includes("春")) return "Spring";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function normalizeDay(day) {
  const raw = String(day || "").trim();
  if (!raw) return null;
  const map = {
    Mon: "Mon", Monday: "Mon",
    Tue: "Tue", Tuesday: "Tue",
    Wed: "Wed", Wednesday: "Wed",
    Thu: "Thu", Thursday: "Thu",
    Fri: "Fri", Friday: "Fri"
  };
  const normalized = map[raw] || null;
  return normalized && DAY_ORDER.has(normalized) ? normalized : null;
}

function normalizePeriod(period) {
  const parsed = Number(period);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) return null;
  return Math.trunc(parsed);
}

function parseCourseTimeSlot(timeSlot) {
  if (!timeSlot) return null;
  let match = String(timeSlot).match(/\(?([月火水木金])(?:曜日)?(\d+)(?:講時)?\)?/);
  if (match) {
    const dayMap = { 月: "Mon", 火: "Tue", 水: "Wed", 木: "Thu", 金: "Fri" };
    const day = dayMap[match[1]];
    const period = normalizePeriod(match[2]);
    if (!day || !period) return null;
    return { day, period };
  }

  match = String(timeSlot).match(/^(Mon|Tue|Wed|Thu|Fri)\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
  if (match) {
    const start = `${match[2]}:${match[3]}`;
    const periodByStart = {
      "09:00": 1,
      "10:45": 2,
      "13:10": 3,
      "14:55": 4,
      "16:40": 5
    };
    const period = periodByStart[start] || null;
    if (!period) return null;
    return { day: normalizeDay(match[1]), period };
  }
  return null;
}

export function toSavedCourseItem(courseLike = {}) {
  const code = String(courseLike.course_code || courseLike.code || "").trim() || null;
  const title = String(courseLike.title || courseLike.course_title || courseLike.courseName || code || "Saved Course").trim();
  const year = Number(courseLike.year ?? courseLike.academic_year) || null;
  const term = normalizeTermName(courseLike.term);
  const timeSlot = String(courseLike.time_slot || "").trim() || null;
  let day = normalizeDay(courseLike.day);
  let period = normalizePeriod(courseLike.period);

  if ((!day || !period) && timeSlot) {
    const parsed = parseCourseTimeSlot(timeSlot);
    if (parsed) {
      day = day || parsed.day;
      period = period || parsed.period;
    }
  }

  return {
    code,
    title: title || code || "Saved Course",
    year,
    term,
    day,
    period,
    time_slot: timeSlot,
    type: String(courseLike.type || "").trim() || null,
    credits: courseLike.credits ?? null,
    updated_at: courseLike.updated_at || new Date().toISOString()
  };
}

function getSavedKey(item) {
  const code = String(item?.code || "").trim().toUpperCase();
  const year = Number(item?.year) || "";
  const term = normalizeTermName(item?.term) || "";
  return `${code}|${year}|${term}`;
}

function dedupeSavedCourses(items = []) {
  const map = new Map();
  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = toSavedCourseItem(rawItem);
    if (!item.title) continue;
    const key = getSavedKey(item);
    if (!key || key === "|||") continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const existingTime = Date.parse(existing.updated_at || 0) || 0;
    const nextTime = Date.parse(item.updated_at || 0) || 0;
    map.set(key, nextTime >= existingTime ? { ...existing, ...item } : { ...item, ...existing });
  }
  return [...map.values()].sort((a, b) => {
    const tA = Date.parse(a.updated_at || 0) || 0;
    const tB = Date.parse(b.updated_at || 0) || 0;
    return tB - tA;
  });
}

function serializeSavedCourses(items = []) {
  return JSON.stringify(dedupeSavedCourses(items));
}

function savedCoursesEqual(a = [], b = []) {
  return serializeSavedCourses(a) === serializeSavedCourses(b);
}

export function readSavedCourses(limit = 5) {
  try {
    const raw = window.localStorage.getItem(SAVED_COURSES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const normalized = dedupeSavedCourses(parsed);
    return Number.isFinite(limit) ? normalized.slice(0, limit) : normalized;
  } catch (error) {
    console.warn("Unable to read saved courses from storage:", error);
    return [];
  }
}

export function writeSavedCoursesLocal(items = [], options = {}) {
  const normalized = dedupeSavedCourses(items);
  const nextSerialized = JSON.stringify(normalized);
  try {
    const existingRaw = window.localStorage.getItem(SAVED_COURSES_STORAGE_KEY);
    if (existingRaw !== nextSerialized) {
      window.localStorage.setItem(SAVED_COURSES_STORAGE_KEY, nextSerialized);
    }
  } catch (error) {
    console.warn("Unable to write saved courses to storage:", error);
  }
  if (options.silent !== true) {
    window.dispatchEvent(new CustomEvent("saved-courses:changed", { detail: { items: normalized } }));
  }
  return normalized;
}

async function readSavedCoursesProfile(userId) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("saved_courses")
      .eq("id", userId)
      .single();
    if (error) {
      console.warn("Unable to read profile saved courses:", error);
      return [];
    }
    return dedupeSavedCourses(data?.saved_courses || []);
  } catch (error) {
    console.warn("Unable to read profile saved courses:", error);
    return [];
  }
}

async function writeSavedCoursesProfile(userId, items = []) {
  if (!userId) return [];
  const normalized = dedupeSavedCourses(items);
  const { error } = await supabase
    .from("profiles")
    .update({ saved_courses: normalized })
    .eq("id", userId);
  if (error) throw error;
  return normalized;
}

export async function syncSavedCoursesForUser(userId, options = {}) {
  if (!userId) {
    return readSavedCourses(Number.POSITIVE_INFINITY);
  }
  const local = readSavedCourses(Number.POSITIVE_INFINITY);
  const remote = await readSavedCoursesProfile(userId);
  const merged = dedupeSavedCourses([...remote, ...local]);
  const localChanged = !savedCoursesEqual(local, merged);
  const remoteChanged = !savedCoursesEqual(remote, merged);

  if (remoteChanged) {
    await writeSavedCoursesProfile(userId, merged);
  }

  if (localChanged) {
    writeSavedCoursesLocal(merged, { silent: true });
  }

  if (options.emitChange === true && (localChanged || remoteChanged)) {
    window.dispatchEvent(new CustomEvent("saved-courses:changed", { detail: { items: merged } }));
  }
  return merged;
}

export async function toggleSavedCourse(courseLike = {}) {
  const target = toSavedCourseItem(courseLike);
  if (!target?.code) {
    return { saved: false, items: readSavedCourses(Number.POSITIVE_INFINITY) };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id || null;
  const base = userId
    ? await syncSavedCoursesForUser(userId)
    : readSavedCourses(Number.POSITIVE_INFINITY);

  const targetKey = getSavedKey(target);
  const exists = base.some((item) => getSavedKey(item) === targetKey);
  const next = exists
    ? base.filter((item) => getSavedKey(item) !== targetKey)
    : [{ ...target, updated_at: new Date().toISOString() }, ...base];

  const normalized = dedupeSavedCourses(next);
  if (userId) {
    await writeSavedCoursesProfile(userId, normalized);
  }
  writeSavedCoursesLocal(normalized);
  return {
    saved: !exists,
    items: normalized
  };
}

export function isCourseSaved(courseLike = {}, savedItems = []) {
  const targetKey = getSavedKey(toSavedCourseItem(courseLike));
  if (!targetKey) return false;
  return (Array.isArray(savedItems) ? savedItems : []).some((item) => getSavedKey(item) === targetKey);
}
