import type { Request } from "express";

export type ClientSessionMeta = {
  clientType: "mobile" | "web" | "tablet" | "desktop" | "unknown";
  platform: "ios" | "android" | "web" | "unknown";
  deviceLabel: string;
  deviceId?: string;
  appVersion?: string;
  loginMethod: "password" | "google" | "apple" | "unknown";
  ipAddress: string;
  userAgent: string;
};

function firstIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string) || "";
  const raw = fwd || req.socket?.remoteAddress || "";
  const ip = typeof raw === "string" && raw.includes(",") ? raw.split(",")[0].trim() : String(raw);
  return ip || "unknown";
}

function inferFromUserAgent(ua: string): Pick<ClientSessionMeta, "clientType" | "platform" | "deviceLabel"> {
  const lower = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(lower)) {
    const isPad = /ipad/.test(lower);
    return {
      clientType: isPad ? "tablet" : "mobile",
      platform: "ios",
      deviceLabel: isPad ? "iPad" : "iPhone",
    };
  }
  if (/android/.test(lower)) {
    return { clientType: "mobile", platform: "android", deviceLabel: "Android device" };
  }
  if (/mobile/.test(lower)) {
    return { clientType: "mobile", platform: "unknown", deviceLabel: "Mobile browser" };
  }
  if (/macintosh|windows|linux/.test(lower) && !/mobile/.test(lower)) {
    const os = /macintosh/.test(lower) ? "macOS" : /windows/.test(lower) ? "Windows" : "Linux";
    return { clientType: "desktop", platform: "web", deviceLabel: `Web browser on ${os}` };
  }
  if (lower.includes("mozilla")) {
    return { clientType: "web", platform: "web", deviceLabel: "Web browser" };
  }
  return { clientType: "unknown", platform: "unknown", deviceLabel: "Unknown device" };
}

/** Reads NetQwix client headers (mobile/web) with User-Agent fallback. */
export function parseClientSessionMeta(
  req: Request,
  loginMethod: ClientSessionMeta["loginMethod"] = "unknown"
): ClientSessionMeta {
  const userAgent = String(req.headers["user-agent"] || "");
  const inferred = inferFromUserAgent(userAgent);

  const headerClient = String(req.headers["x-nq-client"] || "").toLowerCase();
  const headerPlatform = String(req.headers["x-nq-platform"] || "").toLowerCase();
  const headerLabel = String(req.headers["x-nq-device-label"] || "").trim();
  const deviceId = String(req.headers["x-nq-device-id"] || "").trim() || undefined;
  const appVersion = String(req.headers["x-nq-app-version"] || "").trim() || undefined;

  const clientType =
    headerClient === "mobile" ||
    headerClient === "web" ||
    headerClient === "tablet" ||
    headerClient === "desktop"
      ? (headerClient as ClientSessionMeta["clientType"])
      : inferred.clientType;

  const platform =
    headerPlatform === "ios" || headerPlatform === "android" || headerPlatform === "web"
      ? (headerPlatform as ClientSessionMeta["platform"])
      : inferred.platform;

  const deviceLabel = headerLabel || inferred.deviceLabel;

  return {
    clientType,
    platform,
    deviceLabel,
    deviceId,
    appVersion,
    loginMethod,
    ipAddress: firstIp(req),
    userAgent: userAgent.slice(0, 512),
  };
}

export function maskIpAddress(ip: string): string {
  if (!ip || ip === "unknown") return "Unknown location";
  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length > 2) return `${parts.slice(0, 3).join(":")}:…`;
    return ip;
  }
  const octets = ip.split(".");
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.*`;
  return ip;
}
