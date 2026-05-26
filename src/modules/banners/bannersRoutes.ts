import { Router, Request, Response, NextFunction } from "express";
import JWT from "../../Utils/jwt";
import user from "../../model/user.schema";
import { listActiveBanners } from "./bannersController";

const route: Router = Router();

/**
 * Banners are guest-visible. We try to authenticate so logged-in users see
 * audience-scoped banners, but never reject the request when the token is
 * missing or invalid — we just fall through with `req.authUser = null`.
 *
 * Inlined (rather than reusing AuthorizeMiddleware.authorizeUser) because
 * that middleware terminates the response on auth failure.
 */
async function optionalAuthorize(
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

route.get("/", optionalAuthorize, listActiveBanners);

export const bannersRoute: Router = route;
