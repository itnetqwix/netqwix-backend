import { log } from "../../logger";

const MIN_SECRET_LENGTH = 16;

/** Stable dev-only fallback when JWT_SECRET is missing or too short (never used in production). */
const DEV_JWT_FALLBACK =
  "netqwix-local-development-jwt-secret-change-in-production";

function readRawJwtSecret(): string {
  return (
    process.env.JWT_SECRET?.trim() ||
    process.env.JWT_SECRET_KEY?.trim() ||
    ""
  );
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Returns a JWT signing secret. Production requires JWT_SECRET with at least 16 characters.
 * Non-production may use a documented dev fallback so local login is not blocked by short placeholders.
 */
export function getJwtSecret(): string {
  const raw = readRawJwtSecret();
  if (raw.length >= MIN_SECRET_LENGTH) {
    return raw;
  }

  if (isProductionEnv()) {
    throw new Error(
      "JWT_SECRET must be set in the environment with at least 16 characters (use 32+ random bytes in production)."
    );
  }

  if (raw.length > 0) {
    log
      .getLogger()
      .warn(
        `JWT_SECRET is only ${raw.length} characters (minimum ${MIN_SECRET_LENGTH}). Using development fallback for signing. Set JWT_SECRET to a longer value in .env.`
      );
  } else {
    log
      .getLogger()
      .warn(
        "JWT_SECRET is not set. Using development fallback for signing. Copy sample.env to .env and set JWT_SECRET."
      );
  }

  return DEV_JWT_FALLBACK;
}

/** Call once at process startup to fail fast in production when misconfigured. */
export function assertJwtConfiguredAtStartup(): void {
  try {
    getJwtSecret();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.getLogger().error(message);
    throw err;
  }
}

export function getJwtExpiration(): string {
  return process.env.JWT_EXPIRATION_TIME?.trim() || "7d";
}
