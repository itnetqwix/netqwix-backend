import { Request, Response, NextFunction } from "express";
import JWT from "../Utils/jwt";
import user from "../model/user.schema";

/**
 * Optional auth: attaches `req.authUser` when a valid Bearer token is present,
 * otherwise continues with `authUser = null`. Never returns 401.
 */
export async function optionalAuthorize(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers?.authorization;
    if (!header || typeof header !== "string") {
      (req as any).authUser = null;
      return next();
    }
    const token = header.split(" ")[1];
    if (!token || token === "null" || token === "undefined") {
      (req as any).authUser = null;
      return next();
    }
    const tokenInfo: any = await JWT.decodeAuthToken(token);
    if (!tokenInfo?.user_id) {
      (req as any).authUser = null;
      return next();
    }
    const result = await user.findOne({ _id: tokenInfo.user_id });
    (req as any).authUser = result ?? null;
    return next();
  } catch {
    (req as any).authUser = null;
    return next();
  }
}
