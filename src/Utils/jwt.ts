import * as jwt from "jsonwebtoken";
import { getJwtExpiration, getJwtSecret } from "../config/jwtSecret";
import { ResponseBuilder } from "../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";

interface IJwtPayload {
  user_id: string;
  account_type: string;
}
export default class JWT {
  public signJWT = (payload: IJwtPayload) => {
    return jwt.sign(payload, getJwtSecret(), {
      expiresIn: getJwtExpiration(),
      algorithm: "HS256",
    });
  };

  private static getSecret(): string {
    return getJwtSecret();
  }

  /**
   * Verify signature + expiry. Use for all auth tokens (REST, socket, password reset).
   */
  public static verifyAuthToken(token: string): IJwtPayload & jwt.JwtPayload {
    try {
      const decoded = jwt.verify(token, JWT.getSecret(), {
        algorithms: ["HS256"],
      }) as IJwtPayload & jwt.JwtPayload;
      if (!decoded?.user_id) {
        throw new Error("Invalid token payload");
      }
      return decoded;
    } catch {
      throw ResponseBuilder.badRequest(l10n.t("NOT_VERIFIED_TOKEN"));
    }
  }

  /** @deprecated Use verifyAuthToken — decode-only is insecure. */
  public static decodeAuthToken(token: string) {
    return JWT.verifyAuthToken(token);
  }
}
