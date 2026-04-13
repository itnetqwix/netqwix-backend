import { log } from "../../../logger";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { StripeHelper } from "../../helpers/stripe";
import master_data from "../../model/master_data";
import * as l10n from "jm-ez-l10n";

export class transactionService {
  public log = log.getLogger();
  public stripeHelper = new StripeHelper();
  public createPaymentIntent = async (body): Promise<ResponseBuilder> => {
    try {
      const result = await this.stripeHelper.createPaymentIntent(body);
      switch (result.code) {
        case 200:
          return ResponseBuilder.data(
            result,
            l10n.t("TRANSACTION_INTENT_CREATED")
          );
        case 400:
          return ResponseBuilder.badRequest(result, 400);

        default:
          return ResponseBuilder.data(
            result,
            l10n.t("TRANSACTION_INTENT_CREATED")
          );
      }
    } catch (err) {
      throw err;
    }
  };
}
