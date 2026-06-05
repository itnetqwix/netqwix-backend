/**
 * Typed domain errors — map to HTTP in controllers via sendDomainError or ResponseBuilder.
 */

import { LIVE_LESSON_ERROR, LiveLessonErrorCode } from "./liveLessonRules";

export const CHECKOUT_ERROR = {
  INSUFFICIENT_WALLET: "insufficient_wallet",
  PROMO_INVALID: "promo_invalid",
  QUOTE_EXPIRED: "quote_expired",
  PAYMENT_FAILED: "payment_failed",
  BOOKING_SAVE_FAILED: "booking_save_failed",
  ESCROW_ALREADY_EXISTS: "escrow_already_exists",
} as const;

export type CheckoutErrorCode = (typeof CHECKOUT_ERROR)[keyof typeof CHECKOUT_ERROR];

export type DomainErrorCode =
  | LiveLessonErrorCode
  | CheckoutErrorCode
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal";

const DEFAULT_HTTP: Record<string, number> = {
  [LIVE_LESSON_ERROR.TRAINER_CONFLICT]: 409,
  [LIVE_LESSON_ERROR.TRAINEE_CONFLICT]: 409,
  [LIVE_LESSON_ERROR.SLOT_IN_PAST]: 400,
  [LIVE_LESSON_ERROR.INVALID_TIMES]: 400,
  [CHECKOUT_ERROR.INSUFFICIENT_WALLET]: 400,
  [CHECKOUT_ERROR.PROMO_INVALID]: 400,
  [CHECKOUT_ERROR.QUOTE_EXPIRED]: 400,
  [CHECKOUT_ERROR.PAYMENT_FAILED]: 402,
  [CHECKOUT_ERROR.ESCROW_ALREADY_EXISTS]: 409,
  conflict: 409,
  forbidden: 403,
  not_found: 404,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;
  readonly data?: unknown;

  constructor(
    code: DomainErrorCode,
    message: string,
    options?: { httpStatus?: number; data?: unknown }
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? DEFAULT_HTTP[code] ?? 400;
    this.data = options?.data;
  }

  static badRequest(message: string, code: DomainErrorCode = "bad_request") {
    return new DomainError(code, message, { httpStatus: 400 });
  }

  static conflict(message: string, code: DomainErrorCode = "conflict") {
    return new DomainError(code, message, { httpStatus: 409 });
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
