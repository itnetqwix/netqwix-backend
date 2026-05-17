import { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function key(req: Request, name: string) {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown");
  return `${name}:${ip}`;
}

export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  name: string;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = key(req, opts.name);
    const now = Date.now();
    let bucket = buckets.get(k);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(k, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      return res.status(429).json({
        status: 0,
        error: opts.message ?? "Too many requests. Please try again later.",
      });
    }
    return next();
  };
}

export const authLoginLimiter = createRateLimiter({
  name: "auth-login",
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many login attempts.",
});

export const authForgotLimiter = createRateLimiter({
  name: "auth-forgot",
  windowMs: 60 * 60 * 1000,
  max: 10,
});

export const authSignupOtpLimiter = createRateLimiter({
  name: "auth-signup-otp",
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "Too many verification code requests. Try again later.",
});

export const walletPinLimiter = createRateLimiter({
  name: "wallet-pin",
  windowMs: 15 * 60 * 1000,
  max: 30,
});

export const chatSendLimiter = createRateLimiter({
  name: "chat-send",
  windowMs: 60 * 1000,
  max: 60,
});

export const globalApiLimiter = createRateLimiter({
  name: "global-api",
  windowMs: 60 * 1000,
  max: 300,
});
