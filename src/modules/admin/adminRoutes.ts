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
route.get("/user-360/:id", adminController.getUser360);
route.get("/user-lessons/:id", adminController.getUserLessons);
route.get("/user-reviews/:id", adminController.getUserReviews);
route.get("/user-assets/:id", adminController.getUserAssets);
route.delete("/entity/:entityType/:entityId", adminController.deleteEntity);
route.get("/audit-logs", adminController.getAuditLogs);

export const adminRoute: Router = route;
