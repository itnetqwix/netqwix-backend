import { CONSTANCE } from "../config/constance";
import * as l10n from "jm-ez-l10n";
import { isValidMongoObjectId } from "../helpers/mongoose";

export class IsValidMongoId {

  // to check token in param as id is valid mongo ID or not
  public isValidTokenInReqParams = async (req: Request, res, next: any) => {
    const { id = undefined } = req['params'];
    if (id && isValidMongoObjectId(id)) {
      next();
    } else {
      res
        .status(CONSTANCE.RES_CODE.error.badRequest)
        .send({ status: CONSTANCE.FAIL, error: l10n.t("INVALID_ID") });
      return;
    }
  };
}

