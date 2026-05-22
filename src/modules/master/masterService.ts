import { log } from "../../../logger";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import master_data from "../../model/master_data";
import mongoose from "mongoose";
import * as l10n from "jm-ez-l10n";

export class masterService {
  public log = log.getLogger();

  public getMasterData = async (): Promise<ResponseBuilder> => {
    try {
      let masterData = await master_data.find().lean();
      if (!masterData?.length) {
        try {
          const legacy = await mongoose.connection
            .collection("master")
            .find({})
            .toArray();
          if (legacy?.length) masterData = legacy as typeof masterData;
        } catch (legacyErr) {
          this.log.info(`[master] legacy collection read skipped: ${legacyErr}`);
        }
      }
      if (!masterData || masterData.length === 0) {
        return ResponseBuilder.badRequest(l10n.t("DATA_NOT_FOUND"));
      }
      this.log.info(masterData);
      return ResponseBuilder.data(
        masterData,
        l10n.t("MASTER_DATA_GET_SUCCESS")
      );
    } catch (error) {
      this.log.error(error);
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  };
}
