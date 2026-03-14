export const SETUP_VERSION = 1;
export const SETUP_PREFER_NOT_TO_ANSWER = "Prefer not to answer";

export const SETUP_YEAR_OPTIONS = [
  "1st year",
  "2nd year",
  "3rd year",
  "4th year",
  "5th year+",
  SETUP_PREFER_NOT_TO_ANSWER
];

export const SETUP_CONCENTRATION_OPTIONS = [
  "Japanese Society and Global Culture Concentration",
  "Japanese Business and the Global Economy Concentration",
  "Japanese Politics and Global Studies Concentration",
  "Non ILA student",
  SETUP_PREFER_NOT_TO_ANSWER
];

export function isSetupSchemaMissingError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return code === "42703" || (message.includes("column") && message.includes("setup"));
}

function normalizeString(value) {
  const text = String(value || "").trim();
  return text || null;
}

export function normalizeSetupProfile(row) {
  const data = row && typeof row === "object" ? row : {};
  return {
    ...data,
    current_year: normalizeString(data.current_year),
    concentration: normalizeString(data.concentration),
    year_opt_out: Boolean(data.year_opt_out),
    concentration_opt_out: Boolean(data.concentration_opt_out),
    setup_completed_at: data.setup_completed_at || null,
    setup_version: Number(data.setup_version || 0)
  };
}

export function isYearAnswered(row) {
  const data = normalizeSetupProfile(row);
  return Boolean(data.current_year) || data.year_opt_out;
}

export function isConcentrationAnswered(row) {
  const data = normalizeSetupProfile(row);
  return Boolean(data.concentration) || data.concentration_opt_out;
}

export function isSetupCompleteFromProfile(row) {
  const data = normalizeSetupProfile(row);
  const versionComplete = data.setup_version >= SETUP_VERSION;
  if (!versionComplete) return false;
  if (data.setup_completed_at) return true;
  return isYearAnswered(data) && isConcentrationAnswered(data);
}

export function deriveSetupStep(row) {
  const data = normalizeSetupProfile(row);
  if (!isYearAnswered(data)) return 0;
  if (!isConcentrationAnswered(data)) return 1;
  return 2;
}

export function mapYearSelectionToPayload(selectedYear) {
  if (selectedYear === SETUP_PREFER_NOT_TO_ANSWER) {
    return {
      current_year: null,
      year_opt_out: true
    };
  }

  return {
    current_year: normalizeString(selectedYear),
    year_opt_out: false
  };
}

export function mapConcentrationSelectionToPayload(selectedConcentration) {
  if (selectedConcentration === SETUP_PREFER_NOT_TO_ANSWER) {
    return {
      concentration: null,
      concentration_opt_out: true
    };
  }

  return {
    concentration: normalizeString(selectedConcentration),
    concentration_opt_out: false
  };
}
