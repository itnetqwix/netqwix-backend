import { Router } from "express";
import { AdminController } from "./adminController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { adminFinanceController } from "../wallet/adminFinanceController";
import { opsAdminController } from "../ops/opsAdminController";

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
route.get("/user-timeline/:id", adminController.getUserTimeline);
route.get("/clip-play-url/:clipId", adminController.getClipPlayUrl);
route.get("/user-lessons/:id", adminController.getUserLessons);
route.get("/user-reviews/:id", adminController.getUserReviews);
route.get("/user-assets/:id", adminController.getUserAssets);
route.delete("/entity/:entityType/:entityId", adminController.deleteEntity);
route.get("/audit-logs", adminController.getAuditLogs);

route.get("/ops-events", opsAdminController.list);
route.get("/ops-events/stats", opsAdminController.stats);
route.get("/ops-events/playbook", opsAdminController.playbook);
route.post("/ops-events/backfill", opsAdminController.backfill);
route.get("/ops-events/user/:userId", opsAdminController.listByUser);
route.get("/ops-events/session/:sessionId", opsAdminController.listBySession);
route.get("/ops-events/:eventId", opsAdminController.detail);
route.patch("/ops-events/:eventId", opsAdminController.resolve);
route.get("/dashboard-metrics", adminController.getDashboardMetrics);
route.get("/online-users", adminController.getOnlineUsers);

route.get("/finance/ledger", adminFinanceController.getLedger);
route.get("/finance/escrow", adminFinanceController.getEscrowHolds);
route.post("/finance/escrow/:holdId/release", adminFinanceController.releaseEscrow);
route.post("/finance/escrow/:holdId/refund", adminFinanceController.refundEscrow);
route.get("/finance/payouts", adminFinanceController.getPayoutQueue);
route.post("/finance/payouts/:payoutId/approve", adminFinanceController.approvePayout);
route.post("/finance/wallet/adjust", adminFinanceController.adjustWallet);
route.get("/finance/audit-log", adminFinanceController.getFinancialAuditLog);
route.post("/finance/migrate-legacy-balances", async (req, res) => {
  const { walletMigrationService } = require("../wallet/migrationService");
  const dryRun = req.body?.dry_run !== false;
  const result = await walletMigrationService.migrateLegacyTrainerBalances(dryRun);
  return res.status(200).send({ status: "SUCCESS", data: result });
});

export const adminRoute: Router = route;
