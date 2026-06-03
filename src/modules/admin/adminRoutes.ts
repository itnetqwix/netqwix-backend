import { Router } from "express";
import { AdminController } from "./adminController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { adminFinanceController } from "../wallet/adminFinanceController";
import { opsAdminController } from "../ops/opsAdminController";
import { trainerReviewAdminController } from "../verification/trainerReviewAdminController";
import { mountAdminClipRoutes } from "../clips/clipsRoutes";
import { pricingAdminController } from "./pricingAdminController";
import {
  adminListTips,
  adminCreateTip,
  adminUpdateTip,
  adminDeleteTip,
  adminToggleTip,
} from "../tips/tipsController";
import {
  adminListBanners,
  adminCreateBanner,
  adminUpdateBanner,
  adminDeleteBanner,
  adminToggleBanner,
} from "../banners/bannersController";
import {
  adminCreatePage,
  adminDeletePage,
  adminGetFaq,
  adminListLegal,
  adminListPages,
  adminSeedFaq,
  adminTogglePage,
  adminUpdatePage,
  adminUpsertFaq,
  adminUpsertLegal,
} from "../cms/cmsController";
import {
  adminListAccountDeletions,
  adminRestoreAccountDeletion,
  adminAddAccountDeletionNote,
} from "./accountDeletionAdminController";
import { referralAdminController } from "../referral/referralAdminController";

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
route.get("/pricing-config", pricingAdminController.getConfig);
route.put("/pricing-config", pricingAdminController.updateConfig);
route.get("/pricing-config/history", pricingAdminController.getHistory);
route.get("/pricing-config/defaults", pricingAdminController.getDefaults);
route.post("/pricing-config/preview-quote", pricingAdminController.previewQuote);
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
route.get("/trainer-verifications", trainerReviewAdminController.list);
route.get("/trainer-verifications/pending-count", trainerReviewAdminController.pendingCount);
route.post("/trainer-verifications/migrate", trainerReviewAdminController.migrate);
route.get("/trainer-verifications/:userId", trainerReviewAdminController.detail);
route.post("/trainer-verifications/:userId/approve", trainerReviewAdminController.approve);
route.post("/trainer-verifications/:userId/reject", trainerReviewAdminController.reject);

mountAdminClipRoutes(route);

route.get("/tips", adminListTips);
route.post("/tips", adminCreateTip);
route.patch("/tips/:id", adminUpdateTip);
route.patch("/tips/:id/toggle", adminToggleTip);
route.delete("/tips/:id", adminDeleteTip);

route.get("/banners", adminListBanners);
route.post("/banners", adminCreateBanner);
route.patch("/banners/:id", adminUpdateBanner);
route.patch("/banners/:id/toggle", adminToggleBanner);
route.delete("/banners/:id", adminDeleteBanner);

route.get("/cms/legal", adminListLegal);
route.put("/cms/legal/:slug", adminUpsertLegal);
route.get("/cms/faq", adminGetFaq);
route.put("/cms/faq", adminUpsertFaq);
route.post("/cms/faq/seed", adminSeedFaq);
route.get("/cms/pages", adminListPages);
route.post("/cms/pages", adminCreatePage);
route.patch("/cms/pages/:id", adminUpdatePage);
route.patch("/cms/pages/:id/toggle", adminTogglePage);
route.delete("/cms/pages/:id", adminDeletePage);

route.get("/account-deletions", adminListAccountDeletions);
route.post("/account-deletions/:id/restore", adminRestoreAccountDeletion);
route.post("/account-deletions/:id/notes", adminAddAccountDeletionNote);

route.get("/messaging-health", async (_req, res) => {
  try {
    const { getMessagingHealth } = await import("../../services/messagingHealth");
    const report = await getMessagingHealth();
    const ok = report.email.ok && report.sms.ok;
    return res.status(ok ? 200 : 503).json({ success: ok ? 1 : 0, data: report });
  } catch (err: any) {
    return res.status(500).json({ success: 0, message: err?.message || "Health check failed" });
  }
});

route.get("/dashboard-metrics", adminController.getDashboardMetrics);
route.get("/online-users", adminController.getOnlineUsers);
route.get("/booking/:bookingId", adminController.getBookingSessionDetail);
route.get("/booking/:bookingId/timeline", adminController.getBookingSessionTimeline);

route.get("/referrals/dashboard", referralAdminController.getDashboard);
route.get("/referrals/rewards", referralAdminController.listRewards);
route.get("/referrals/attributions", referralAdminController.listAttributions);

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
