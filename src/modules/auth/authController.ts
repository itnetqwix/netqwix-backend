import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { UserService } from "../user/userService";
import { AuthService } from "./authService";
import { Request, Response } from "express";

export class authController {
  public authService = new AuthService();
  public userService = new UserService();
  public logger = log.getLogger();

  public signup = async (req: Request, res: Response) => {
    try {
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
      const fwd = (req.headers["x-forwarded-for"] as string) || "";
      const ip = fwd || req.socket?.remoteAddress || "";
      const result: ResponseBuilder = await this.authService.login(req.body, { ip });
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

  public forgotPasswordEmail = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder =
        await this.authService.forgotPasswordEmail(
          req.body.email,
          req["authUser"]
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
}
