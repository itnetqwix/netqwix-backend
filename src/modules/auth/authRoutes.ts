import { Router } from "express";
import { authController } from "./authController";
import { validator } from "../../validate";
import { signupModel } from "./authValidator/signup";
import {
  loginModel,
  forgotPasswordEmailModal,
  confirmResetPasswordModal,
} from "./authValidator/login";
import { AuthMiddleware } from "./authMiddleware";
import { googleLoginModel } from "./authValidator/googleSignIn";
import { appleLoginModel } from "./authValidator/appleSignIn";
import {
  authForgotLimiter,
  authLoginLimiter,
  authSignupOtpLimiter,
} from "../../middleware/rateLimit.middleware";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const route: Router = Router();
const authC = new authController();
const authMiddleware = new AuthMiddleware();
const authorizeMiddleware = new AuthorizeMiddleware();
const V: validator = new validator();

//TODO: add middleware
route.post("/signup/otp/send", authSignupOtpLimiter, authC.signupOtpSend);
route.post("/signup/otp/verify", authSignupOtpLimiter, authC.signupOtpVerify);
route.post(
  "/signup",
  V.validate(signupModel),
  authMiddleware.isUserExist,
  authC.signup
);
route.post("/login", authLoginLimiter, V.validate(loginModel), authC.login);
route.post("/refresh", authC.refreshToken);
route.post("/logout", authC.logout);

route.post("/sessions/register", (req, res, next) => {
  req["byPassRoute"] = [];
  authorizeMiddleware.authorizeUser(req, res, next);
}, authC.registerSession);
route.get("/sessions", (req, res, next) => {
  req["byPassRoute"] = [];
  authorizeMiddleware.authorizeUser(req, res, next);
}, authC.listSessions);
route.post("/sessions/revoke", (req, res, next) => {
  req["byPassRoute"] = [];
  authorizeMiddleware.authorizeUser(req, res, next);
}, authC.revokeSession);
route.post("/sessions/revoke-others", (req, res, next) => {
  req["byPassRoute"] = [];
  authorizeMiddleware.authorizeUser(req, res, next);
}, authC.revokeOtherSessions);

// to send email for forgot password
route.post(
  "/forgot-password",
  authForgotLimiter,
  V.validate(forgotPasswordEmailModal),
  authMiddleware.isUserNotExist,
  authC.forgotPasswordEmail
);

//
route.put(
  "/confirm-reset-password",
  V.validate(confirmResetPasswordModal),
  authC.confirmResetPassword
);

route.post(
  "/verify-google-login",
  V.validate(googleLoginModel),
  authMiddleware.isGoogleUserExists,
  authC.googleLogin
);
route.post(
  "/verify-apple-login",
  V.validate(appleLoginModel),
  authMiddleware.isAppleUserExists,
  authC.appleLogin
);
export const authRoute: Router = route;
