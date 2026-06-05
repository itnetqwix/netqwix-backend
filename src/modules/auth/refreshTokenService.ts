import * as jwt from "jsonwebtoken";
import {
  getAccessJwtExpiration,
  getAccessJwtExpirationSeconds,
  getJwtSecret,
  getRefreshSessionTtlDays,
} from "../../config/jwtSecret";
import type { ClientSessionMeta } from "./clientSessionMeta";
import { authSessionService } from "./authSessionService";

export type AccessTokenClaims = {
  user_id: string;
  account_type: string;
  sid?: string;
  typ: "access";
};

export class RefreshTokenService {
  issueRefreshToken(userId: string, meta: ClientSessionMeta, ttlDays = getRefreshSessionTtlDays()) {
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

  issueAccessToken(userId: string, accountType: string, sessionId?: string) {
    const claims: AccessTokenClaims = {
      user_id: userId,
      account_type: accountType,
      typ: "access",
    };
    if (sessionId) claims.sid = sessionId;
    return jwt.sign(claims, getJwtSecret(), {
      expiresIn: getAccessJwtExpiration(),
      algorithm: "HS256",
    });
  }

  getAccessTokenExpiresInSeconds() {
    return getAccessJwtExpirationSeconds();
  }
}

export const refreshTokenService = new RefreshTokenService();
