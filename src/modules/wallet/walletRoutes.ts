import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { walletPinLimiter } from "../../middleware/rateLimit.middleware";
import { walletController } from "./walletController";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();

route.get("/config", walletController.getConfig);

route.use(authorizeMiddleware.authorizeUser);

route.get("/balance", walletController.getBalance);
route.get("/transactions/:id", walletController.getTransactionDetail);
route.get("/ledger", walletController.getLedger);
route.get("/earnings", walletController.getEarnings);
route.post("/topup/create-intent", walletController.createTopUpIntent);
route.get("/topup/:topupId/status", walletController.getTopUpStatus);
route.post("/topup/:topupId/confirm", walletController.confirmTopUp);
route.post("/pin/set", walletController.setPin);
route.post("/pin/verify", walletPinLimiter, walletController.verifyPin);
route.post("/pin/forgot/request", walletController.forgotPinRequest);
route.post("/pin/forgot/confirm", walletController.forgotPinConfirm);
route.put("/payout-preference", walletController.updatePayoutPreference);
route.post("/withdraw", walletController.requestWithdraw);

export const walletRoute: Router = route;
