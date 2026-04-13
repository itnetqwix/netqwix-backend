import * as jwt from "jsonwebtoken";
import { ResponseBuilder } from "../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";

interface IJwtPayload {
  user_id: string;
  account_type: string;
}
export default class JWT {
  public signJWT = (payload: IJwtPayload) => {
    let jwtSecretKey = process.env.JWT_SECRET;
    return jwt.sign(payload, jwtSecretKey, {
      expiresIn: process.env.JWT_EXPIRATION_TIME,
    });
  };

  /*
   * decodeAuthToken
   */
  public static decodeAuthToken(token) {
    const decodedToken = jwt.decode(token);
    if (decodedToken) {
      return decodedToken;
    } else {
      throw ResponseBuilder.badRequest(l10n.t("NOT_VERIFIED_TOKEN"));
    }
  }
}
