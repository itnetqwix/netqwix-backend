/**
 * Shared Socket.IO handshake token extraction (REST + mobile + web clients).
 */

export function normalizeSocketAuthToken(raw: string): string {
  const t = raw.trim().replace(/^\uFEFF/, "");
  if (t.toLowerCase().startsWith("bearer ")) {
    return t.slice(7).trim();
  }
  return t;
}

export function extractSocketToken(handshake: {
  auth?: { authorization?: string; token?: string };
  query?: { authorization?: string | string[]; token?: string | string[] };
}): string | null {
  const auth = handshake?.auth;
  const candidates: unknown[] = [
    auth?.authorization,
    auth?.token,
    handshake?.query?.authorization,
    handshake?.query?.token,
  ];

  for (const c of candidates) {
    const raw = Array.isArray(c) ? c[0] : c;
    if (typeof raw === "string" && raw.trim()) {
      return normalizeSocketAuthToken(raw);
    }
  }
  return null;
}
