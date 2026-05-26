import * as crypto from "crypto";
import { Bcrypt } from "../../Utils/bcrypt";
import magicLinkTokenModel from "../../model/magic_link_token.schema";
import userModel from "../../model/user.schema";
import { SendEmail } from "../../Utils/sendEmail";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { refreshTokenService } from "./refreshTokenService";
import type { ClientSessionMeta } from "./clientSessionMeta";
import { log } from "../../../logger";

/**
 * Magic-link email sign-in.
 *
 * Flow:
 *  1. Mobile / web posts to `/auth/magic-link/request` with the user's email.
 *  2. We mint a random token (and a 6-digit fallback code), store hashes only,
 *     and email the user a clickable link + the code.
 *  3. The user either taps the link (deep-link / web-link with `token`) or
 *     types the code into the verify screen — both resolve to the same row.
 *  4. `/auth/magic-link/verify` consumes the row exactly once and issues a
 *     standard access + refresh token pair, matching the normal login flow.
 *
 * Privacy: we deliberately don't tell the caller whether the email exists.
 * `request` always returns 200 with the same body so the endpoint can't be
 * used as a user enumeration oracle.
 */

const sendRate = new Map<string, number[]>();
const TOKEN_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_MINUTE = 5;

function hashSha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateCode(): string {
  return String(Math.floor(100000 + crypto.randomInt(0, 900000)));
}

function canSendForEmail(email: string): boolean {
  const now = Date.now();
  const window = sendRate.get(email) || [];
  const recent = window.filter((t) => now - t < 60_000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) return false;
  recent.push(now);
  sendRate.set(email, recent);
  return true;
}

export type MagicLinkVerifyResult = {
  access_token: string;
  refresh_token: string;
  session_id: string;
  account_type: string;
};

export class MagicLinkService {
  public log = log.getLogger();
  private bcrypt = new Bcrypt();

  async request(
    rawEmail: string,
    meta?: { ip?: string; userAgent?: string }
  ): Promise<ResponseBuilder> {
    const email = String(rawEmail ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return ResponseBuilder.badRequest("Enter a valid email address.");
    }

    if (!canSendForEmail(email)) {
      return ResponseBuilder.badRequest(
        "Too many sign-in requests. Try again in a minute."
      );
    }

    const userDoc = await userModel.findOne({ email }).lean();

    /**
     * Always return the same 200-shaped response. If no user exists, or the
     * account is deleted/disabled, we silently skip the email — but the
     * client gets the same body so it can't probe for existing emails.
     */
    if (
      userDoc &&
      !userDoc.deleted_at &&
      !(userDoc as any).pending_deletion_at &&
      !(userDoc as any).hibernated_at &&
      userDoc.status !== "rejected"
    ) {
      try {
        const token = crypto.randomBytes(32).toString("hex");
        const code = generateCode();
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

        await magicLinkTokenModel.deleteMany({
          user_id: userDoc._id,
          consumed_at: null,
        });

        await magicLinkTokenModel.create({
          user_id: userDoc._id,
          email,
          token_hash: hashSha256(token),
          code_hash: await this.bcrypt.getHashedPassword(code),
          expires_at: expiresAt,
          attempts: 0,
          requested_ip: meta?.ip ?? "",
          requested_user_agent: meta?.userAgent ?? "",
        });

        const base = (
          process.env.FRONTEND_URL ||
          process.env.FRONTEND_URL_SMS ||
          "https://netqwix.com"
        ).replace(/\/$/, "");
        const url = `${base}/auth/magic-link?token=${token}&email=${encodeURIComponent(
          email
        )}`;
        const userName =
          typeof userDoc.fullname === "string" && userDoc.fullname
            ? userDoc.fullname.split(" ")[0]
            : "there";

        SendEmail.sendRawEmail(
          null,
          null,
          [email],
          "Your NetQwix sign-in link",
          null,
          `
            <div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 15px; line-height: 22px; color: #1f2937;">
              <p>Hi ${userName},</p>
              <p>Tap the button below to sign in to NetQwix. The link is good for ${TOKEN_TTL_MINUTES} minutes and can only be used once.</p>
              <p style="text-align: center; margin: 28px 0;">
                <a href="${url}" style="background: #1f2a44; color: #fff; padding: 12px 28px; border-radius: 999px; font-weight: 700; text-decoration: none; display: inline-block;">Sign in to NetQwix</a>
              </p>
              <p>Or enter this code in the app:</p>
              <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #1f2a44; margin: 8px 0 24px;">${code}</p>
              <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email. Someone may have typed your address by mistake.</p>
              <p style="color: #6b7280; font-size: 13px;">Requested from IP ${
                meta?.ip || "unknown"
              }.</p>
            </div>
          `
        );
      } catch (err) {
        this.log.error("[magic-link] failed to send email", err);
        /** Fall through — still return the generic OK response below. */
      }
    }

    return ResponseBuilder.data(
      { sent: true, expires_in_minutes: TOKEN_TTL_MINUTES },
      "If that email is registered, we sent a sign-in link."
    );
  }

  async verify(
    rawEmail: string,
    payload: { token?: string; code?: string },
    sessionMeta: ClientSessionMeta
  ): Promise<ResponseBuilder> {
    const email = String(rawEmail ?? "").trim().toLowerCase();
    if (!email) return ResponseBuilder.badRequest("Email is required.");

    const tokenInput = (payload.token ?? "").trim();
    const codeInput = (payload.code ?? "").trim();
    if (!tokenInput && !codeInput) {
      return ResponseBuilder.badRequest("Enter the code from the email.");
    }

    const userDoc = await userModel.findOne({ email });
    if (!userDoc) {
      return ResponseBuilder.badRequest(
        "We couldn't sign you in with that link or code. Try requesting a new one."
      );
    }
    if (userDoc.deleted_at) {
      return ResponseBuilder.badRequest(
        "This account has been deleted. Contact support if this was a mistake."
      );
    }

    const now = new Date();

    let row;
    if (tokenInput) {
      row = await magicLinkTokenModel
        .findOne({
          user_id: userDoc._id,
          token_hash: hashSha256(tokenInput),
          consumed_at: null,
          expires_at: { $gt: now },
        })
        .sort({ createdAt: -1 });
    } else {
      row = await magicLinkTokenModel
        .findOne({
          user_id: userDoc._id,
          consumed_at: null,
          expires_at: { $gt: now },
        })
        .sort({ createdAt: -1 });
      if (row) {
        if (row.attempts >= MAX_ATTEMPTS) {
          return ResponseBuilder.badRequest(
            "Too many attempts. Request a fresh code."
          );
        }
        const codeOk = await this.bcrypt.comparePassword(
          codeInput,
          row.code_hash
        );
        if (!codeOk) {
          row.attempts += 1;
          await row.save();
          return ResponseBuilder.badRequest("Invalid or expired code.");
        }
      }
    }

    if (!row) {
      return ResponseBuilder.badRequest(
        "Link or code is invalid or has expired. Request a fresh one."
      );
    }

    row.consumed_at = now;
    await row.save();

    const access_token = refreshTokenService.issueAccessToken(
      String(userDoc._id),
      String(userDoc.account_type)
    );
    const issued = await refreshTokenService.issueRefreshToken(
      String(userDoc._id),
      { ...sessionMeta, loginMethod: "magic-link" }
    );

    return ResponseBuilder.data(
      {
        data: {
          access_token,
          refresh_token: issued.refreshToken,
          session_id: issued.sessionId,
          account_type: userDoc.account_type,
        },
      },
      "Signed in."
    );
  }
}

export const magicLinkService = new MagicLinkService();
