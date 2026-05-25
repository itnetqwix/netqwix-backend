/**
 * Privacy, trust & security endpoints — blocked list, profile visibility,
 * data export (GDPR/DPDP) and two-factor authentication.
 *
 * Kept in its own file rather than ballooning `userController.ts` to keep
 * the security surface easy to audit. All handlers expect the request to
 * already be authenticated by `AuthorizeMiddleware.authorizeUser`.
 */

import { Request, Response } from "express";
import { Types } from "mongoose";
import { CONSTANCE } from "../../config/constance";
import user from "../../model/user.schema";
import user_two_factor from "../../model/user_two_factor.schema";
import auth_session from "../../model/auth_session.schema";
import booked_session from "../../model/booked_sessions.schema";
import chat_message from "../../model/chat_message.schema";
import wallet_ledger_entries from "../../model/wallet_ledger_entries.schema";
import { twoFactorOtpService } from "../auth/twoFactorOtpService";

function senderId(req: Request): string {
  return String((req as any)?.authUser?._id ?? "");
}

/* ─── Blocked list ───────────────────────────────────────────────── */

export async function listBlockedUsers(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const me = await user
      .findById(userId)
      .select("blockedUsers")
      .populate("blockedUsers", "fullname email profile_picture account_type")
      .lean();
    const items = (me?.blockedUsers ?? []).map((u: any) => ({
      _id: String(u._id),
      fullname: u.fullname,
      email: u.email,
      profile_picture: u.profile_picture,
      account_type: u.account_type,
    }));
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: items });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function unblockUser(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const target = String((req.query?.userId as string) || req.body?.userId || "");
    if (!Types.ObjectId.isValid(target)) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "Invalid user id." });
    }
    await user.findByIdAndUpdate(userId, { $pull: { blockedUsers: target } });
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── Profile visibility ─────────────────────────────────────────── */

const VISIBILITY_KEYS = [
  "show_last_active",
  "show_in_community_search",
  "allow_message_requests_from_non_friends",
  "show_online_status",
] as const;

export async function updateProfileVisibility(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const patch: Record<string, boolean> = {};
    for (const key of VISIBILITY_KEYS) {
      if (key in (req.body || {})) {
        patch[`privacy_visibility.${key}`] = !!req.body[key];
      }
    }
    if (!Object.keys(patch).length) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "No valid keys to update." });
    }
    const updated = await user
      .findByIdAndUpdate(userId, { $set: patch }, { new: true })
      .select("privacy_visibility")
      .lean();
    const data = (updated as any)?.privacy_visibility ?? {};
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── GDPR/DPDP data export ─────────────────────────────────────── */

/**
 * Synchronous bundle for smaller accounts. We deliberately cap each
 * collection to a few thousand rows — accounts above that should
 * receive an email link instead (queue-based). The mobile client polls
 * `/data-export/status` so it can render a "we'll email you" state if
 * we ever switch to async.
 */
export async function requestDataExport(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const userObjId = new Types.ObjectId(userId);

    const me = await user
      .findById(userId)
      .select("-password -__v")
      .lean();
    const [bookings, messages, transactions] = await Promise.all([
      booked_session
        .find({ $or: [{ trainee_id: userObjId }, { trainer_id: userObjId }] })
        .limit(2000)
        .lean(),
      chat_message.find({ sender_id: userObjId }).limit(5000).lean(),
      wallet_ledger_entries.find({ user_id: userObjId }).limit(5000).lean(),
    ]);

    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        state: "ready",
        requested_at: new Date().toISOString(),
        ready_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        bundle: {
          profile: me,
          bookings,
          messages,
          transactions,
        },
        counts: {
          bookings: bookings.length,
          messages: messages.length,
          transactions: transactions.length,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function dataExportStatus(req: Request, res: Response) {
  // Synchronous mode — we never persist state, so respond `idle`.
  return res
    .status(200)
    .send({ status: CONSTANCE.SUCCESS, data: { state: "idle" } });
}

/* ─── Two-factor ────────────────────────────────────────────────── */

export async function twoFactorStatus(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const doc = await user_two_factor.findOne({ user_id: userId }).lean();
    const trustedCount = await auth_session.countDocuments({
      userId,
      revokedAt: null,
      trusted: true,
    });
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        enabled: !!doc?.enabled,
        method: doc?.method ?? null,
        lastVerifiedAt: doc?.last_verified_at
          ? new Date(doc.last_verified_at).toISOString()
          : null,
        trustedDeviceCount: trustedCount,
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function twoFactorEnable(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const method =
      req.body?.method === "sms" ? "sms" : req.body?.method === "totp" ? "totp" : "email";
    await user_two_factor.findOneAndUpdate(
      { user_id: userId },
      {
        $set: { method, user_id: userId },
        $setOnInsert: { enabled: false },
      },
      { upsert: true }
    );
    // Send the first OTP so the user can complete enrolment immediately.
    if (method !== "totp") {
      try {
        await twoFactorOtpService.sendOtpToUser(userId, method);
      } catch {
        /* mobile shows a "resend" button if delivery fails */
      }
    }
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: { enabled: false, method } });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function twoFactorChallenge(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const method = req.body?.method === "sms" ? "sms" : "email";
    const result = await twoFactorOtpService.sendOtpToUser(userId, method);
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function twoFactorVerify(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const code = String(req.body?.code ?? "").trim();
    if (!code) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Code is required." });
    }
    const ok = await twoFactorOtpService.verifyOtp(userId, code);
    if (!ok) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "Invalid or expired code." });
    }

    // Promote to enabled the first time the user finishes a verify, and
    // trust the current session so they don't get challenged next launch.
    await user_two_factor.findOneAndUpdate(
      { user_id: userId },
      {
        $set: { enabled: true, enabled_at: new Date(), last_verified_at: new Date() },
      }
    );

    const remember = req.body?.rememberDevice !== false;
    if (remember) {
      const currentSessionId =
        (req as any)?.authUser?.sessionId ?? (req as any)?.authUser?.session_id;
      if (currentSessionId) {
        await auth_session.updateOne(
          { _id: currentSessionId },
          { $set: { trusted: true, trustedAt: new Date() } }
        );
      }
    }

    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        enabled: true,
        lastVerifiedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function twoFactorDisable(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    await user_two_factor.updateOne(
      { user_id: userId },
      { $set: { enabled: false, enabled_at: null } }
    );
    await auth_session.updateMany(
      { userId, trusted: true },
      { $set: { trusted: false, trustedAt: null } }
    );
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function listTrustedDevices(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const currentId =
      (req as any)?.authUser?.sessionId ?? (req as any)?.authUser?.session_id;
    const sessions = await auth_session
      .find({ userId, revokedAt: null, trusted: true })
      .sort({ lastUsedAt: -1 })
      .lean();
    const data = sessions.map((s: any) => ({
      id: String(s._id),
      label: s.deviceLabel || s.platform || "Trusted device",
      lastSeenAt: s.lastUsedAt ? new Date(s.lastUsedAt).toISOString() : undefined,
      location: s.ipAddress,
      current: String(s._id) === String(currentId),
    }));
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function revokeTrustedDevice(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "Invalid device id." });
    }
    await auth_session.updateOne(
      { _id: id, userId },
      { $set: { trusted: false, trustedAt: null } }
    );
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
