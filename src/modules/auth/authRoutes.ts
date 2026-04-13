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

const route: Router = Router();
const authC = new authController();
const authMiddleware = new AuthMiddleware();
const V: validator = new validator();

//TODO: add middleware
route.post(
  "/signup",
  V.validate(signupModel),
  authMiddleware.isUserExist,
  authC.signup
);
route.post("/login", V.validate(loginModel), authC.login);

// to send email for forgot password
route.post(
  "/forgot-password",
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
export const authRoute: Router = route;
