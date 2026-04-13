import { PipelineStage } from "mongoose";
import { log } from "../../../logger";
import { Bcrypt } from "../../Utils/bcrypt";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import JWT from "../../Utils/jwt";
import admin_setting from "../../model/default_admin_setting.schema";
import { CONSTANCE } from "../../config/constance";


export class AdminService {
  public log = log.getLogger();
  public bcrypt = new Bcrypt();
  public JWT = new JWT();

  public async updateGlobalCommission(reqBody: any, authUser: any): Promise<ResponseBuilder> {
    const { commission } = reqBody;

    try {
      const adminSetting = await admin_setting.findOneAndUpdate(
        {},
        { commission, last_updated_admin_id: authUser._id },
        { upsert: true, new: true }
      );
      return ResponseBuilder.data(adminSetting, "Commission Updated!");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getGlobalCommission() {
    try {
      const data = await admin_setting.find();
      return ResponseBuilder.data(data, "Global Commission Fetched!");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

}
