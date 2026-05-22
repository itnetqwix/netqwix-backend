/**
 * Optional Sentry — set SENTRY_DSN in environment to enable.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    });
    // eslint-disable-next-line no-console
    console.info("[Sentry] Initialized");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[Sentry] Failed to load @sentry/node — run npm install @sentry/node", err);
  }
}
