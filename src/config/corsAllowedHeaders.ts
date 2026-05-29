/**
 * Headers browsers may send on API preflight (OPTIONS).
 * Must include every custom header used by web + mobile clients.
 *
 * @see nq-frontend-main/app/utils/clientSessionHeaders.js
 * @see nq-mobile/src/features/auth/session/clientSessionHeaders.ts
 */
export const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Origin",
  "Accept",
  "Access-Control-Allow-Origin",
  "X-Session-Id",
  "Idempotency-Key",
  "X-Idempotency-Key",
  "X-NQ-Client",
  "X-NQ-Platform",
  "X-NQ-Device-Id",
  "X-NQ-Device-Label",
  "X-NQ-Auth-Session-Id",
  "X-NQ-App-Version",
  "X-NQ-Session-Id",
] as const;
