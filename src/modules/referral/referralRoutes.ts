import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { referralController } from "./referralController";
import { authReferralInviteLimiter } from "../../middleware/rateLimit.middleware";

const route = Router();
const authorize = new AuthorizeMiddleware();

route.get("/resolve/:code", referralController.resolveCode);
route.get("/resolve-referrer/:userId", referralController.resolveReferrer);

route.get("/program", authorize.authorizeUser, referralController.getProgram);
route.get("/benefits", authorize.authorizeUser, referralController.getBenefits);
route.post("/preview-checkout", authorize.authorizeUser, referralController.previewCheckout);
route.get("/invites", authorize.authorizeUser, referralController.listInvites);
route.get("/rewards", authorize.authorizeUser, referralController.listRewards);
route.post(
  "/invite",
  authorize.authorizeUser,
  authReferralInviteLimiter,
  referralController.sendInvites
);

export const referralRoute = route;
