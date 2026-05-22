import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { slog } from "../lib/structuredLog";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.length > 0
      ? incoming.slice(0, 64)
      : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    if (req.path === "/health") return;
    slog("info", "http_request", {
      scope: "http",
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}
