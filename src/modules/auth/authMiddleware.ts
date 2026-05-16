import { NextFunction, Request, Response } from "express";
import { isEmpty } from "lodash";
import * as l10n from "jm-ez-l10n";
import { AuthService } from "./authService";
import { CONSTANCE } from "../../config/constance";
import { isDataExists } from "../../common/types/mongoose.types";
import { log } from "../../../logger";
import JWT from "../../Utils/jwt";
import user from "../../model/user.schema";

export class AuthMiddleware {
  public authService = new AuthService();
  public logger = log.getLogger();

  public isUserExist = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const isUserExist: isDataExists = await this.authService.isUserExists(
        req.body
      );
      this.logger.info(isUserExist);
      if (isEmpty(isUserExist)) {
        next();
      } else {
        return res.status(CONSTANCE.RES_CODE.error.badRequest).send({
          status: CONSTANCE.FAIL,
          error: l10n.t("ERR_USER_PROFILE_EXIST", {
            EMAIL: req.body.email,
          }),
        });
      }
    } catch (error) {
      this.logger.error(error);
      return res.status(CONSTANCE.RES_CODE.error.internalServerError).send({
        status: CONSTANCE.FAIL,
        error: error.message || "Internal Server Error",
      });
    }
  };

  public isUserNotExist = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const email = req.body?.email;
      const existing = email ? await user.findOne({ email }).select("_id account_type") : null;
      this.logger.info({ email, found: Boolean(existing) });
      if (existing) {
        req["authUser"] = existing;
        next();
      } else {
        return res.status(CONSTANCE.RES_CODE.error.badRequest).send({
          status: CONSTANCE.FAIL,
          error: l10n.t("ERR_USER_PROFILE_NOT_EXIST", {
            EMAIL: req.body.email,
          }),
        });
      }
    } catch (error) {
      this.logger.error(error);
      return res.status(CONSTANCE.RES_CODE.error.internalServerError).send({
        status: CONSTANCE.FAIL,
        error: error.message || "Internal Server Error",
      });
    }
  };

  public isAppleUserExists = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { verifyAppleIdentityToken } = await import("./appleTokenVerify");
      const identityToken = req.body?.identity_token;
      if (!identityToken) {
        return res.status(401).send({
          status: CONSTANCE.FAIL,
          error: "Apple identity token required.",
        });
      }
      const verified = await verifyAppleIdentityToken(String(identityToken));
      req.body.apple_sub = verified.sub;
      if (verified.email) {
        req.body.email = String(verified.email).toLowerCase();
      }
      const email = req.body?.email;
      if (!email) {
        return res.status(400).send({
          status: CONSTANCE.FAIL,
          error: "Email is required for first-time Apple sign in.",
        });
      }
      const existing = await this.authService.isGoogleUserExists({
        email,
      } as any);
      if (isEmpty(existing)) {
        res.status(CONSTANCE.RES_CODE.success).json({
          data: { email, isRegistered: false },
          msg: l10n.t("GOOGLE_LOGIN_REGISTER_PENDING"),
        });
      } else {
        req.body = existing;
        next();
      }
    } catch (error) {
      this.logger.error(error);
      return res.status(CONSTANCE.RES_CODE.error.internalServerError).send({
        status: CONSTANCE.FAIL,
        error: (error as Error).message || "Internal Server Error",
      });
    }
  };

  public isGoogleUserExists = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const idToken = req.body?.id_token;
      if (idToken) {
        const axios = require("axios");
        const { data } = await axios.get(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
        );
        const tokenEmail = String(data?.email ?? "").toLowerCase();
        const bodyEmail = String(req.body?.email ?? "").toLowerCase();
        const googleSub = String(data?.sub ?? "");
        if (!tokenEmail || tokenEmail !== bodyEmail || !googleSub) {
          return res.status(401).send({
            status: CONSTANCE.FAIL,
            error: "Google token verification failed.",
          });
        }
        req.body.google_sub = googleSub;
      }
      const isGoogleUserExists = await this.authService.isGoogleUserExists(
        req.body
      );

      this.logger.info(isGoogleUserExists);
      if (isEmpty(isGoogleUserExists)) {
        res.status(CONSTANCE.RES_CODE.success).json({
          data: { ...req.body, isRegistered: false },
          msg: l10n.t("GOOGLE_LOGIN_REGISTER_PENDING"),
        });
      } else {
        req.body = isGoogleUserExists;
        next();
      }
    } catch (error) {
      this.logger.error(error);
      return res.status(CONSTANCE.RES_CODE.error.internalServerError).send({
        status: CONSTANCE.FAIL,
        error: error.message || "Internal Server Error",
      });
    }
  };

  public loadSocketUser = async (token) => {
    try {
      const tokenInfo = await JWT.decodeAuthToken(token);
      if (tokenInfo && tokenInfo["user_id"]) {
        const result = await user.findOne({ _id: tokenInfo["user_id"] });
        if (result) {
          return { user: result, isValidUser: true };
        } else {
          return {
            user: null,
            isValidUser: false,
            error: l10n.t("ERR_UNAUTH"),
          };
        }
      } else {
        return { user: null, isValidUser: false, error: l10n.t("ERR_UNAUTH") };
      }
    } catch (err) {
      return { user: null, isValidUser: false, error: l10n.t("ERR_UNAUTH") };
    }
  };
}
