import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { verificationController } from "./verificationController";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();

route.use(authorizeMiddleware.authorizeUser);

route.get("/status", verificationController.status);
route.post("/otp/send", verificationController.sendOtp);
route.post("/otp/verify", verificationController.verifyOtp);
route.put("/profile", verificationController.updateProfile);
route.post("/face/session", verificationController.createFaceSession);
route.post("/face/complete", verificationController.completeFace);

export const verificationRoute: Router = route;
