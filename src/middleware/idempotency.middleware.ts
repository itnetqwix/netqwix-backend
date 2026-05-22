import { NextFunction, Request, Response } from "express";
import { runIdempotency } from "../services/idempotencyService";
import { isRedisEnabled } from "../services/redisClient";

export type IdempotentHttpResult = {
  statusCode: number;
  body: unknown;
};

function readIdempotencyKey(req: Request): string | null {
  const raw =
    req.headers["idempotency-key"] ||
    req.headers["x-idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed.length ? trimmed.slice(0, 128) : null;
}

function scopeKey(req: Request, clientKey: string): string {
  const userId = String((req as any)["authUser"]?._id ?? "anonymous");
  const method = req.method.toUpperCase();
  const path = req.baseUrl + req.path;
  return `http:${userId}:${method}:${path}:${clientKey}`;
}

function patchResponseCapture(
  res: Response,
  onFinish: (statusCode: number, body: unknown) => void
) {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalStatus = res.status.bind(res);
  let statusCode = 200;
  let finished = false;

  const finish = (body: unknown) => {
    if (finished) return;
    finished = true;
    onFinish(statusCode, body);
  };

  res.status = function (code: number) {
    statusCode = code;
    return originalStatus(code);
  } as typeof res.status;

  res.json = function (body: unknown) {
    finish(body);
    return originalJson(body);
  } as typeof res.json;

  res.send = function (body: unknown) {
    let parsed: unknown = body;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
    }
    finish(parsed);
    return originalSend(body);
  } as typeof res.send;
}

/**
 * Wraps a route handler so duplicate POSTs with the same Idempotency-Key return the same response.
 */
export function idempotentHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
  options?: { requireKey?: boolean }
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientKey = readIdempotencyKey(req);
    if (!clientKey) {
      if (options?.requireKey) {
        return res.status(400).json({
          status: "FAIL",
          error: "Idempotency-Key header is required for this operation.",
        });
      }
      return handler(req, res, next);
    }

    if (!isRedisEnabled()) {
      return handler(req, res, next);
    }

    const key = scopeKey(req, clientKey);

    try {
      const { value: cached, replayed } = await runIdempotency(key, () =>
        new Promise<IdempotentHttpResult>((resolve, reject) => {
          patchResponseCapture(res, (statusCode, body) => {
            resolve({ statusCode, body });
          });
          Promise.resolve(handler(req, res, next)).catch(reject);
        })
      );

      if (replayed) {
        res.setHeader("Idempotency-Replayed", "true");
        if (typeof cached.body === "object" && cached.body !== null) {
          return res.status(cached.statusCode).json(cached.body);
        }
        return res.status(cached.statusCode).send(cached.body);
      }
    } catch (err: any) {
      if (err?.message === "IDEMPOTENCY_IN_PROGRESS") {
        return res.status(409).json({
          status: "FAIL",
          error: "Duplicate request is still processing. Retry shortly.",
        });
      }
      return next(err);
    }
  };
}

export function requireIdempotencyKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!readIdempotencyKey(req)) {
    return res.status(400).json({
      status: "FAIL",
      error: "Idempotency-Key header is required.",
    });
  }
  next();
}
