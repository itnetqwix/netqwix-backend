const MAX_CERTIFICATES = 20;
const MAX_WORK_EXPERIENCE = 30;
const MAX_DEGREES = 20;

export type TrainerCertificate = {
  id: string;
  title: string;
  issuer: string;
  issued_at?: string;
  expires_at?: string;
  credential_url?: string;
  document_url?: string;
};

export type TrainerWorkExperience = {
  id: string;
  title: string;
  company?: string;
  location: string;
  start_date: string;
  end_date?: string;
  is_current?: boolean;
  description?: string;
};

export type TrainerDegree = {
  id: string;
  degree: string;
  field_of_study?: string;
  institution: string;
  location?: string;
  graduation_year?: string;
  description?: string;
};

function asTrimmedString(value: unknown, maxLen = 500): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  return s.slice(0, maxLen);
}

function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeCertificate(raw: unknown): TrainerCertificate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = asTrimmedString(o.title, 200);
  const issuer = asTrimmedString(o.issuer, 200);
  if (!title || !issuer) return null;
  return {
    id: asTrimmedString(o.id, 64) || newId(),
    title,
    issuer,
    issued_at: asTrimmedString(o.issued_at, 32),
    expires_at: asTrimmedString(o.expires_at, 32),
    credential_url: asTrimmedString(o.credential_url, 2048),
    document_url: asTrimmedString(o.document_url, 2048),
  };
}

function sanitizeWorkExperience(raw: unknown): TrainerWorkExperience | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = asTrimmedString(o.title, 200);
  const location = asTrimmedString(o.location, 200);
  const start_date = asTrimmedString(o.start_date, 32);
  if (!title || !location || !start_date) return null;
  const is_current = o.is_current === true;
  return {
    id: asTrimmedString(o.id, 64) || newId(),
    title,
    company: asTrimmedString(o.company, 200),
    location,
    start_date,
    end_date: is_current ? undefined : asTrimmedString(o.end_date, 32),
    is_current,
    description: asTrimmedString(o.description, 2000),
  };
}

function sanitizeDegree(raw: unknown): TrainerDegree | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const degree = asTrimmedString(o.degree, 200);
  const institution = asTrimmedString(o.institution, 200);
  if (!degree || !institution) return null;
  return {
    id: asTrimmedString(o.id, 64) || newId(),
    degree,
    field_of_study: asTrimmedString(o.field_of_study, 200),
    institution,
    location: asTrimmedString(o.location, 200),
    graduation_year: asTrimmedString(o.graduation_year, 8),
    description: asTrimmedString(o.description, 2000),
  };
}

function sanitizeArray<T>(
  value: unknown,
  sanitizer: (raw: unknown) => T | null,
  max: number
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizer)
    .filter((x): x is T => x != null)
    .slice(0, max);
}

/**
 * Sanitizes trainer professional profile arrays inside extraInfo.
 * Returns partial extraInfo fields to merge onto the user document.
 */
export function sanitizeTrainerCredentialsExtraInfo(
  extraInfo: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!extraInfo || typeof extraInfo !== "object") return {};
  const out: Record<string, unknown> = {};

  const certificates = sanitizeArray(
    extraInfo.certificates,
    sanitizeCertificate,
    MAX_CERTIFICATES
  );
  if (certificates !== undefined) out.certificates = certificates;

  const work_experience = sanitizeArray(
    extraInfo.work_experience,
    sanitizeWorkExperience,
    MAX_WORK_EXPERIENCE
  );
  if (work_experience !== undefined) out.work_experience = work_experience;

  const degrees = sanitizeArray(extraInfo.degrees, sanitizeDegree, MAX_DEGREES);
  if (degrees !== undefined) out.degrees = degrees;

  if (extraInfo.profile_setup_completed_at != null) {
    out.profile_setup_completed_at = extraInfo.profile_setup_completed_at;
  }
  if (extraInfo.profile_setup_skipped_at != null) {
    out.profile_setup_skipped_at = extraInfo.profile_setup_skipped_at;
  }

  return out;
}

export function mergeExtraInfo(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined
): Record<string, unknown> {
  const base = { ...(existing ?? {}) };
  if (!incoming) return base;
  const credPatch = sanitizeTrainerCredentialsExtraInfo(incoming);
  const merged = { ...base, ...incoming, ...credPatch };
  return merged;
}
