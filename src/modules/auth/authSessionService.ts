import * as crypto from "crypto";
import authSessionModel from "../../model/auth_session.schema";
import type { ClientSessionMeta } from "./clientSessionMeta";
import { maskIpAddress } from "./clientSessionMeta";

export type IssuedAuthSession = {
  refreshToken: string;
  sessionId: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newPublicId(): string {
  return `NQ-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export type AuthSessionListItem = {
  id: string;
  publicId: string;
  deviceLabel: string;
  clientType: string;
  platform: string;
  loginMethod: string;
  ipAddress: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
};

export class AuthSessionService {
  async issueSession(
    userId: string,
    meta: ClientSessionMeta,
    ttlDays = 30
  ): Promise<IssuedAuthSession> {
    const refreshToken = crypto.randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const publicId = newPublicId();

    const doc = await authSessionModel.create({
      userId,
      publicId,
      refreshTokenHash: hashToken(refreshToken),
      clientType: meta.clientType,
      platform: meta.platform,
      deviceLabel: meta.deviceLabel,
      deviceId: meta.deviceId,
      appVersion: meta.appVersion,
      loginMethod: meta.loginMethod,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      lastUsedAt: new Date(),
      expiresAt,
      revokedAt: null,
    });

    return { refreshToken, sessionId: String(doc._id) };
  }

  async validateAndTouch(refreshToken: string): Promise<{ userId: string; sessionId: string }> {
    const hash = hashToken(refreshToken);
    const now = new Date();
    const doc = await authSessionModel.findOne({
      refreshTokenHash: hash,
      revokedAt: null,
      expiresAt: { $gt: now },
    });

    if (!doc) {
      throw new Error("Invalid refresh token.");
    }

    doc.lastUsedAt = now;
    await doc.save();

    return { userId: String(doc.userId), sessionId: String(doc._id) };
  }

  async rotateRefreshToken(
    oldToken: string,
    meta?: Partial<ClientSessionMeta>
  ): Promise<IssuedAuthSession> {
    const { userId, sessionId } = await this.validateAndTouch(oldToken);
    const hash = hashToken(oldToken);
    const newToken = crypto.randomBytes(48).toString("hex");

    const update: Record<string, unknown> = {
      refreshTokenHash: hashToken(newToken),
      lastUsedAt: new Date(),
    };
    if (meta?.deviceLabel) update.deviceLabel = meta.deviceLabel;
    if (meta?.ipAddress) update.ipAddress = meta.ipAddress;
    if (meta?.userAgent) update.userAgent = meta.userAgent;

    const updated = await authSessionModel.findOneAndUpdate(
      { _id: sessionId, userId, revokedAt: null },
      { $set: update },
      { new: true }
    );

    if (!updated) {
      throw new Error("Invalid refresh token.");
    }

    return { refreshToken: newToken, sessionId };
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const hash = hashToken(refreshToken);
    await authSessionModel.updateOne(
      { refreshTokenHash: hash, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  async revokeSessionForUser(userId: string, sessionId: string): Promise<boolean> {
    const res = await authSessionModel.updateOne(
      { _id: sessionId, userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return (res.modifiedCount ?? 0) > 0;
  }

  async revokeAllExcept(userId: string, keepSessionId?: string): Promise<number> {
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (keepSessionId) filter._id = { $ne: keepSessionId };
    const res = await authSessionModel.updateMany(filter, { $set: { revokedAt: new Date() } });
    return res.modifiedCount ?? 0;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const res = await authSessionModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return res.modifiedCount ?? 0;
  }

  async listForUser(userId: string, currentSessionId?: string): Promise<AuthSessionListItem[]> {
    const now = new Date();
    const rows = await authSessionModel
      .find({ userId, revokedAt: null, expiresAt: { $gt: now } })
      .sort({ lastUsedAt: -1 })
      .lean();

    return rows.map((row) => ({
      id: String(row._id),
      publicId: String(row.publicId),
      deviceLabel: String(row.deviceLabel || "Unknown device"),
      clientType: String(row.clientType || "unknown"),
      platform: String(row.platform || "unknown"),
      loginMethod: String(row.loginMethod || "unknown"),
      ipAddress: maskIpAddress(String(row.ipAddress || "")),
      createdAt: (row.createdAt as Date)?.toISOString?.() ?? new Date().toISOString(),
      lastUsedAt: (row.lastUsedAt as Date)?.toISOString?.() ?? new Date().toISOString(),
      isCurrent: currentSessionId ? String(row._id) === currentSessionId : false,
    }));
  }
}

export const authSessionService = new AuthSessionService();
