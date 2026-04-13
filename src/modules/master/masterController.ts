import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { Request, Response } from "express";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { masterService } from "./masterService";

export class masterController {
  public logger = log.getLogger();
  public masterService = new masterService();

  public getMasterData = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder = await this.masterService.getMasterData();
      if (result.status === CONSTANCE.FAIL) {
        return res
          .status(result.code)
          .json({ status: CONSTANCE.FAIL, error: result.error });
      } else {
        return res
          .status(result.code)
          .send({ status: CONSTANCE.SUCCESS, data: result.result });
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
