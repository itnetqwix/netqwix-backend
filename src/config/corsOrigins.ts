import type { CorsOptions } from "cors";

export type ResolvedCorsOrigin = CorsOptions["origin"];

/**
 * Builds the list of allowed browser origins for CORS.
 *
 * Production must allow both apex and www (users often land on www.netqwix.com).
 * Set `CORS_ORIGINS` explicitly, or rely on `FRONTEND_URL` / `ADMIN_FRONTEND_URL`.
 */
export function resolveCorsOrigins(): ResolvedCorsOrigin {
  const fromEnv = String(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const seeds = [
    ...fromEnv,
    process.env.FRONTEND_URL,
    process.env.ADMIN_FRONTEND_URL,
    process.env.FRONTEND_URL_SMS,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  const expanded = new Set<string>();

  for (const raw of seeds) {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) continue;

    try {
      const u = new URL(trimmed);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const origin = `${u.protocol}//${u.host}`;
      expanded.add(origin);

      const host = u.hostname;
      if (host.startsWith("www.")) {
        expanded.add(`${u.protocol}//${host.slice(4)}${u.port ? `:${u.port}` : ""}`);
      } else if (!host.includes("localhost") && host.split(".").length >= 2) {
        expanded.add(`${u.protocol}//www.${host}${u.port ? `:${u.port}` : ""}`);
      }
    } catch {
      expanded.add(trimmed);
    }
  }

  const list = [...expanded];

  if (list.length > 0) {
    return list;
  }

  if (process.env.NODE_ENV === "production") {
    return [
      "https://www.netqwix.com",
      "https://netqwix.com",
      "https://admin.netqwix.com",
    ];
  }

  return "*";
}
