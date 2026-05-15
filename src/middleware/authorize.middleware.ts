import { isEmpty } from "lodash";
import { CONSTANCE } from "../config/constance";
import * as l10n from "jm-ez-l10n";
import JWT from "../Utils/jwt";
import user from "../model/user.schema";
import {
  buildOnboardingStatus,
  isOnboardingRequired,
  isOnboardingWhitelistedPath,
} from "../modules/verification/onboardingHelpers";

export class AuthorizeMiddleware {
  public authorizeUser = async (req, res, next) => {
    const { byPassRoute } = req;
    console.log(`route --- `, req.path)
    const isRouteExist = !(
      byPassRoute.includes(req.url) || byPassRoute.includes(req.path)
      );
      console.log(`isRouteExist --- `, isRouteExist)

      const bypasswithoutAuth = ["/get-availability"]

    if (isRouteExist) {
       if (!isEmpty(req.headers.authorization)) {
        try {
          const authRegex = /^Bearer\s+null$/;

          if (req.headers.authorization && authRegex.test(req.headers.authorization) && bypasswithoutAuth.includes(req.path)) {
            return next();
          }
          
          const tokenInfo: any = await JWT.decodeAuthToken(
            req.headers.authorization.split(" ")[1]
          );
          if (tokenInfo) {
            const result = await user.findOne({
              _id: tokenInfo.user_id,
            });
            if (result) {
              req.authUser = result;
              const path = req.path || req.url || "";
              const originalUrl = req.originalUrl || "";
              if (
                isOnboardingRequired(result) &&
                !isOnboardingWhitelistedPath(path, originalUrl)
              ) {
                return res.status(403).json({
                  status: CONSTANCE.FAIL,
                  error: "Trainer onboarding required",
                  code: "TRAINER_ONBOARDING_REQUIRED",
                  onboarding: buildOnboardingStatus(result),
                });
              }
              next();
            } else {
              res
                .status(CONSTANCE.RES_CODE.error.unauthorized)
                .send({ status: CONSTANCE.FAIL, error: l10n.t("ERR_UNAUTH") });
              return;
            }
          } else {
            res
              .status(CONSTANCE.RES_CODE.error.unauthorized)
              .send({ status: CONSTANCE.FAIL, error: l10n.t("ERR_UNAUTH") });
            return;
          }
        } catch (error) {
          res
            .status(CONSTANCE.RES_CODE.error.unauthorized)
            .send({ status: CONSTANCE.FAIL, error: l10n.t("ERR_UNAUTH") });
          return;
        }
      } else if(bypasswithoutAuth.includes(req.path)){
        next();
      }
      else {
        res.status(CONSTANCE.RES_CODE.error.unauthorized).send({
          status: CONSTANCE.FAIL,
          error: l10n.t("ERR_UNAUTH"),
        });
        return;
      }
    } else {
      next();
    }
  };
}
