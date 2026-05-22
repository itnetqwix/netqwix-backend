import { log } from "../../logger";

type LogLevel = "info" | "warn" | "error" | "debug";

export type StructuredLogFields = {
  scope?: string;
  event?: string;
  userId?: string;
  sessionId?: string;
  bookingId?: string;
  requestId?: string;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
};

const winston = log.getLogger();

function serialize(fields: StructuredLogFields): string {
  try {
    return JSON.stringify({
      ts: new Date().toISOString(),
      ...fields,
    });
  } catch {
    return String(fields);
  }
}

export function slog(level: LogLevel, message: string, fields: StructuredLogFields = {}): void {
  const line = `${message} ${serialize(fields)}`;
  if (level === "error") winston.error(line);
  else if (level === "warn") winston.warn(line);
  else if (level === "debug") winston.debug(line);
  else winston.info(line);
}
