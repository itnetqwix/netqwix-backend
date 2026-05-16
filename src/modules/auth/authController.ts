import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { UserService } from "../user/userService";
import { AuthService } from "./authService";
import { Request, Response } from "express";
import { AccountType } from "./authEnum";
import { refreshTokenService } from "./refreshTokenService";
import userModel from "../../model/user.schema";

const loginAttemptStore = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 12;

function loginRateKey(req: Request, email: string) {
  const fwd = (req.headers["x-forwarded-for"] as string) || "";
  const ip = (fwd || req.socket?.remoteAddress || "").split(",")[0].trim() || "unknown";
  return `${ip}:${String(email).toLowerCase()}`;
}

export class authController {
  public authService = new AuthService();
  public userService = new UserService();
  public logger = log.getLogger();

  public signup = async (req: Request, res: Response) => {
    try {
      const at = String(req.body?.account_type ?? "").trim().toLowerCase();
      if (at === String(AccountType.ADMIN).toLowerCase()) {
        if (String(process.env.ADMIN_PUBLIC_SIGNUP_ENABLED || "").toLowerCase() !== "true") {
          return res.status(403).json({
            status: CONSTANCE.FAIL,
            error: "Admin self-signup is disabled. Set ADMIN_PUBLIC_SIGNUP_ENABLED=true to allow (not recommended for production).",
          });
        }
      }

      const result: ResponseBuilder = await this.authService.createNewUser(
        req.body
      );

      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (error) {
      this.logger.error(error);
      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };

  public login = async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || "").trim();
      const key = loginRateKey(req, email || "unknown");
      const now = Date.now();
      const slot = loginAttemptStore.get(key);
      if (slot && slot.resetAt > now && slot.count >= LOGIN_MAX_FAILS) {
        return res.status(429).json({
          status: CONSTANCE.FAIL,
          error: "Too many login attempts. Try again later.",
        });
      }

      const fwd = (req.headers["x-forwarded-for"] as string) || "";
      const ip = fwd || req.socket?.remoteAddress || "";
      const result: ResponseBuilder = await this.authService.login(req.body, { ip });
      if (result.status !== CONSTANCE.FAIL) {
        loginAttemptStore.delete(key);
        res.status(result.code).json(result);
      } else {
        const next =
          slot && slot.resetAt > now
            ? { count: slot.count + 1, resetAt: slot.resetAt }
            : { count: 1, resetAt: now + LOGIN_WINDOW_MS };
        loginAttemptStore.set(key, next);
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (error) {
      this.logger.error(error);

      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };

  public forgotPasswordEmail = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder =
        await this.authService.forgotPasswordEmail(
          req.body.email,
          req["authUser"],
          String(req.body.portal || "")
        );
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (error) {
      this.logger.error(error);
      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };

  public confirmResetPassword = async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "Token and password are required.",
        });
      }
      const result: ResponseBuilder =
        await this.authService.confirmForgetPassword(req.body);
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code
        ? error.code
        : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message;
      return res
        .status(statusCode)
        .send({ status: CONSTANCE.FAIL, error: errorMessage });
    }
  };

  public googleLogin = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder = await this.authService.googleLogin(
        req.body
      );
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (error) {
      this.logger.error(error);
      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };

  public refreshToken = async (req: Request, res: Response) => {
    try {
      const refresh_token = String(req.body?.refresh_token ?? "").trim();
      if (!refresh_token) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "refresh_token is required.",
        });
      }
      const userId = refreshTokenService.validateRefreshToken(refresh_token);
      const userDoc = await userModel.findById(userId).lean();
      if (!userDoc) {
        return res.status(401).json({ status: CONSTANCE.FAIL, error: "Invalid refresh token." });
      }
      const newRefresh = refreshTokenService.rotateRefreshToken(refresh_token);
      const access_token = refreshTokenService.issueAccessToken(
        String(userDoc._id),
        String(userDoc.account_type)
      );
      return res.status(200).json({
        status: CONSTANCE.SUCCESS,
        data: {
          access_token,
          refresh_token: newRefresh,
          account_type: userDoc.account_type,
        },
      });
    } catch (error) {
      this.logger.error(error);
      return res.status(401).json({
        status: CONSTANCE.FAIL,
        error: error?.message || "Invalid refresh token.",
      });
    }
  };
}
