import { Router } from "express";
import { AdminController } from "./adminController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const route: Router = Router();
const authorizeMiddleware = new AuthorizeMiddleware();
const adminController = new AdminController();

route.use([
  (req, res, next) => {
    req.byPassRoute = [];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

route.post("/update-global-commission", adminController.updateGlobalCommission);
route.get("/get-global-commission", adminController.getGlobalCommission);
route.get("/call-diagnostics", adminController.getCallDiagnostics);
route.get("/call-quality-summary/:sessionId", adminController.getCallQualitySummary);

export const adminRoute: Router = route;
