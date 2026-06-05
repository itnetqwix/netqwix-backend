import { Request, Response, NextFunction, RequestHandler } from "express";
import { CONSTANCE } from "../config/constance";
import { isDomainError } from "../helpers/domainError";
import { sendDomainError } from "../http/sendResponse";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response>;

/**
 * Wraps async route handlers — forwards DomainError to standard envelope; logs unexpected errors.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
      if (res.headersSent) return next(err);
      if (isDomainError(err)) {
        sendDomainError(res, err);
        return;
      }
      const message = err instanceof Error ? err.message : "Internal Server Error";
      console.error("[asyncHandler]", err);
      res.status(500).send({ status: CONSTANCE.FAIL, error: message });
    });
  };
}
