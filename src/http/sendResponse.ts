/**
 * Standard HTTP envelopes for wallet/chat-style routes ({ status, data?, error? }).
 * Does not replace ResponseBuilder for legacy trainee/trainer flows.
 */

import { Response } from "express";
import { CONSTANCE } from "../config/constance";
import { DomainError } from "../helpers/domainError";

export function sendSuccess(res: Response, data: unknown, statusCode = 200) {
  return res.status(statusCode).send({ status: CONSTANCE.SUCCESS, data });
}

export function sendFail(
  res: Response,
  error: string | unknown,
  statusCode = 400,
  extra?: Record<string, unknown>
) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Request failed.";
  return res.status(statusCode).send({
    status: CONSTANCE.FAIL,
    error: message,
    ...extra,
  });
}

export function sendDomainError(res: Response, err: DomainError) {
  return sendFail(res, err.message, err.httpStatus, {
    code: err.code,
    ...(err.data !== undefined ? { data: err.data } : {}),
  });
}

export function sendFromResponseBuilder(
  res: Response,
  rb: { code?: number; status?: string; result?: unknown; error?: unknown; msg?: string }
) {
  const code = rb.code ?? 200;
  if (rb.status === CONSTANCE.SUCCESS) {
    return res.status(code).send({
      status: CONSTANCE.SUCCESS,
      data: rb.result ?? rb.msg,
    });
  }
  const errMsg =
    typeof rb.error === "string"
      ? rb.error
      : (rb.error as { error?: string })?.error ?? rb.msg ?? "Request failed.";
  return res.status(code).send({ status: CONSTANCE.FAIL, error: errMsg });
}
