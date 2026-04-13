import { CONSTANCE } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import booked_session from "../../model/booked_sessions.schema";
import { isValidMongoObjectId } from "../../helpers/mongoose";
export class userMiddleware {
  public IsUserExist = async (body?: any) => {
    return true;
  };

  public createNewUser = async (body: any): Promise<ResponseBuilder> => {
    return;
  };

  public isBookingExist = async (req: any, res, next: any) => {
    const { booking_id } = req.body;
    if(isValidMongoObjectId(booking_id)) {
     const bookedSessionInfo =  await booked_session.findById(booking_id)
      if (bookedSessionInfo && bookedSessionInfo._id) {
        req.booked_session_info = bookedSessionInfo;
        next();
      } else {
        res
          .status(CONSTANCE.RES_CODE.error.unauthorized)
          .send({ status: CONSTANCE.FAIL, error: 'invalid booking id' });
      }
    } else {
      res
        .status(CONSTANCE.RES_CODE.error.unauthorized)
        .send({ status: CONSTANCE.FAIL, error: 'invalid booking id' });
    }
  };
}
