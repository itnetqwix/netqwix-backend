import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { getJwtExpiration, getJwtSecret } from "../../config/jwtSecret";

type RefreshRecord = {
  userId: string;
  expiresAt: number;
};

const refreshStore = new Map<string, RefreshRecord>();

export class RefreshTokenService {
  issueRefreshToken(userId: string, ttlDays = 30) {
    const token = crypto.randomBytes(48).toString("hex");
    refreshStore.set(token, {
      userId,
      expiresAt: Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    });
    return token;
  }

  validateRefreshToken(token: string): string {
    const rec = refreshStore.get(token);
    if (!rec || rec.expiresAt < Date.now()) {
      refreshStore.delete(token);
      throw new Error("Invalid refresh token.");
    }
    return rec.userId;
  }

  rotateRefreshToken(oldToken: string) {
    const userId = this.validateRefreshToken(oldToken);
    refreshStore.delete(oldToken);
    return this.issueRefreshToken(userId);
  }

  revokeRefreshToken(token: string) {
    refreshStore.delete(token);
  }

  revokeAllForUser(userId: string) {
    for (const [t, r] of refreshStore.entries()) {
      if (r.userId === userId) refreshStore.delete(t);
    }
  }

  issueAccessToken(userId: string, accountType: string) {
    return jwt.sign({ user_id: userId, account_type: accountType }, getJwtSecret(), {
      expiresIn: getJwtExpiration(),
      algorithm: "HS256",
    });
  }
}

export const refreshTokenService = new RefreshTokenService();
