import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { listActiveTips } from "./tipsController";

const route: Router = Router();
const authorize = new AuthorizeMiddleware();

route.use([
  (req, _res, next) => {
    (req as any).byPassRoute = [];
    next();
  },
  authorize.authorizeUser,
]);

route.get("/", listActiveTips);

export const tipsRoute: Router = route;
