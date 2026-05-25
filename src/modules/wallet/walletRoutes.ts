import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { walletPinLimiter } from "../../middleware/rateLimit.middleware";
import { walletController } from "./walletController";
import { idempotentHandler, requireIdempotencyKey } from "../../middleware/idempotency.middleware";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();

route.get("/config", walletController.getConfig);

route.use(authorizeMiddleware.authorizeUser);

route.get("/balance", walletController.getBalance);
route.get("/transactions/:id", walletController.getTransactionDetail);
route.get("/ledger", walletController.getLedger);
route.get("/earnings", walletController.getEarnings);
route.get("/trainer-pulse", walletController.getTrainerPulse);
route.get("/trainer-earnings-series", walletController.getTrainerEarningsSeries);
route.get("/trainer-earnings.csv", walletController.exportTrainerEarningsCsv);
route.post(
  "/topup/create-intent",
  requireIdempotencyKey,
  idempotentHandler(walletController.createTopUpIntent)
);
route.get("/topup/:topupId/status", walletController.getTopUpStatus);
route.post(
  "/topup/:topupId/confirm",
  requireIdempotencyKey,
  idempotentHandler(walletController.confirmTopUp)
);
route.post("/pin/set", walletController.setPin);
route.post("/pin/verify", walletPinLimiter, walletController.verifyPin);
route.post("/pin/forgot/request", walletController.forgotPinRequest);
route.post("/pin/forgot/confirm", walletController.forgotPinConfirm);
route.put("/payout-preference", walletController.updatePayoutPreference);
route.post(
  "/withdraw",
  requireIdempotencyKey,
  idempotentHandler(walletController.requestWithdraw)
);

export const walletRoute: Router = route;
