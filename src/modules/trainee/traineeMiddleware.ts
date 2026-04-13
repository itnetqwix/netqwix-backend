import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { AccountType } from "../auth/authEnum";
import * as l10n from "jm-ez-l10n";

export class TraineeMiddleware {
  public logger = log.getLogger();

  public isTrainee = async (req: any, res, next: any) => {
    this.logger.info(req.authUser);

    if (req.authUser.account_type === AccountType.TRAINEE) {
      next();
    } else {
      res
        .status(CONSTANCE.RES_CODE.error.unauthorized)
        .send({ status: CONSTANCE.FAIL, error: l10n.t("ERR_UNAUTH") });
      return;
    }
  };
}
