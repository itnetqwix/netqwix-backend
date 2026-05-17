import * as jwt from "jsonwebtoken";
import { getJwtExpiration, getJwtSecret } from "../../config/jwtSecret";
import type { ClientSessionMeta } from "./clientSessionMeta";
import { authSessionService } from "./authSessionService";

export class RefreshTokenService {
  issueRefreshToken(userId: string, meta: ClientSessionMeta, ttlDays = 30) {
    return authSessionService.issueSession(userId, meta, ttlDays);
  }

  validateRefreshToken(token: string) {
    return authSessionService.validateAndTouch(token).then((r) => r.userId);
  }

  rotateRefreshToken(oldToken: string, meta?: Partial<ClientSessionMeta>) {
    return authSessionService.rotateRefreshToken(oldToken, meta);
  }

  revokeRefreshToken(token: string) {
    return authSessionService.revokeByRefreshToken(token);
  }

  revokeAllForUser(userId: string) {
    return authSessionService.revokeAllForUser(userId);
  }

  issueAccessToken(userId: string, accountType: string) {
    return jwt.sign({ user_id: userId, account_type: accountType }, getJwtSecret(), {
      expiresIn: getJwtExpiration(),
      algorithm: "HS256",
    });
  }
}

export const refreshTokenService = new RefreshTokenService();
