import * as crypto from "crypto";
import mongoose from "mongoose";
import user from "../../model/user.schema";
import ReferredUser from "../../model/referred.user.schema";
import ReferralAttribution from "../../model/referral_attribution.schema";
import ReferralReward from "../../model/referral_reward.schema";
import booked_session from "../../model/booked_sessions.schema";
import { AccountType } from "../auth/authEnum";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import {
  REFERRAL_CONFIG,
  formatRewardPreview,
  referralMatrixAmount,
  type ReferralRole,
} from "../../config/referral";
import { WALLET_CONFIG } from "../../config/wallet";
import { ledgerService } from "../wallet/ledgerService";
import { walletAccountService } from "../wallet/walletAccountService";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { SendEmail } from "../../Utils/sendEmail";

const { Types } = mongoose;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function asReferralRole(accountType: string | undefined): ReferralRole | null {
  if (accountType === AccountType.TRAINER || accountType === AccountType.TRAINEE) {
    return accountType;
  }
  return null;
}

function randomCodeBody(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

export class ReferralService {
  async ensureReferralCode(userId: string): Promise<string> {
    const existing = await user.findById(userId).select("referral_code").lean();
    if (existing?.referral_code) return String(existing.referral_code);

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = `${REFERRAL_CONFIG.codePrefix}${randomCodeBody(REFERRAL_CONFIG.codeLength)}`;
      try {
        await user.findByIdAndUpdate(userId, { $set: { referral_code: code } });
        return code;
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
    throw new Error("Could not allocate referral code.");
  }

  buildShareLinks(code: string, referrerUserId: string) {
    const webBase = (process.env.FRONTEND_URL || "https://netqwix.com").replace(/\/+$/, "");
    return {
      referralCode: code,
      webLink: `${webBase}${REFERRAL_CONFIG.webSignupPath}?code=${encodeURIComponent(code)}`,
      legacyWebLink: `${webBase}${REFERRAL_CONFIG.webSignupPath}?ref=${encodeURIComponent(referrerUserId)}`,
      appLink: `netqwix://${REFERRAL_CONFIG.appSignupPath}?code=${encodeURIComponent(code)}`,
    };
  }

  async getProgram(authUser: { _id: string; account_type?: string; fullname?: string }) {
    const role = asReferralRole(authUser.account_type);
    if (!role) return ResponseBuilder.badRequest("Invalid account type.");

    const code = await this.ensureReferralCode(String(authUser._id));
    const links = this.buildShareLinks(code, String(authUser._id));

    const rewardMatrix = {
      inviteTrainee: formatRewardPreview(role, AccountType.TRAINEE),
      inviteTrainer: formatRewardPreview(role, AccountType.TRAINER),
    };

    const [inviteCount, registeredCount, rewardsEarnedMinor] = await Promise.all([
      ReferredUser.countDocuments({ referrerId: authUser._id }),
      ReferredUser.countDocuments({ referrerId: authUser._id, status: { $ne: "pending" } }),
      ReferralReward.aggregate([
        {
          $match: {
            beneficiary_user_id: new Types.ObjectId(String(authUser._id)),
            status: "credited",
          },
        },
        { $group: { _id: null, total: { $sum: "$amount_minor" } } },
      ]),
    ]);

    return ResponseBuilder.data(
      {
        enabled: REFERRAL_CONFIG.enabled,
        currency: REFERRAL_CONFIG.currency,
        accountType: role,
        referrerName: authUser.fullname ?? "",
        ...links,
        rewardMatrix,
        stats: {
          invitesSent: inviteCount,
          registered: registeredCount,
          totalEarnedMinor: rewardsEarnedMinor[0]?.total ?? 0,
        },
      },
      "Referral program"
    );
  }

  async resolveCode(code: string) {
    const normalized = String(code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!normalized) return ResponseBuilder.badRequest("Referral code required.");

    const referrer = await user
      .findOne({ referral_code: normalized })
      .select("fullname account_type profile_picture referral_code")
      .lean();
    if (!referrer) return ResponseBuilder.badRequest("Referral code not found.");

    const role = asReferralRole(referrer.account_type);
    if (!role) return ResponseBuilder.badRequest("Referral code not found.");

    return ResponseBuilder.data(
      {
        referralCode: referrer.referral_code,
        referrerUserId: referrer._id,
        referrerName: referrer.fullname,
        referrerAccountType: role,
        rewardPreview: {
          ifYouJoinAsTrainee: formatRewardPreview(role, AccountType.TRAINEE),
          ifYouJoinAsTrainer: formatRewardPreview(role, AccountType.TRAINER),
        },
      },
      "Referral resolved"
    );
  }

  async resolveReferrerId(referrerId: string) {
    if (!Types.ObjectId.isValid(referrerId)) {
      return ResponseBuilder.badRequest("Invalid referrer id.");
    }
    const referrer = await user
      .findById(referrerId)
      .select("fullname account_type referral_code")
      .lean();
    if (!referrer) return ResponseBuilder.badRequest("Referrer not found.");
    const code = await this.ensureReferralCode(String(referrer._id));
    return this.resolveCode(code);
  }

  async sendInvites(
    authUser: { _id: string; account_type?: string; fullname?: string; notifications?: any },
    emails: string[],
    targetAccountType?: AccountType
  ) {
    if (!REFERRAL_CONFIG.enabled) {
      return ResponseBuilder.badRequest("Referral program is not enabled.");
    }
    const referrerRole = asReferralRole(authUser.account_type);
    if (!referrerRole) return ResponseBuilder.badRequest("Invalid account type.");

    const target =
      targetAccountType === AccountType.TRAINER ? AccountType.TRAINER : AccountType.TRAINEE;

    const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    if (unique.length === 0) return ResponseBuilder.badRequest("At least one email required.");
    if (unique.length > REFERRAL_CONFIG.maxInvitesPerRequest) {
      return ResponseBuilder.badRequest(`Maximum ${REFERRAL_CONFIG.maxInvitesPerRequest} emails per request.`);
    }

    const code = await this.ensureReferralCode(String(authUser._id));
    const links = this.buildShareLinks(code, String(authUser._id));
    const preview = formatRewardPreview(referrerRole, target);

    const results: { email: string; ok: boolean; error?: string }[] = [];

    for (const email of unique) {
      try {
        const existingUser = await user.findOne({ email }).select("_id").lean();
        if (existingUser) {
          results.push({ email, ok: false, error: "Already registered on NetQwix." });
          continue;
        }

        let invite = await ReferredUser.findOne({ email });
        if (invite && String(invite.referrerId) !== String(authUser._id)) {
          results.push({ email, ok: false, error: "Already invited by another member." });
          continue;
        }

        if (!invite) {
          invite = new ReferredUser({
            email,
            referrerId: authUser._id,
            target_account_type: target,
            status: "pending",
            referral_code: code,
          });
          await invite.save();
        } else {
          invite.target_account_type = target;
          invite.referral_code = code;
          await invite.save();
        }

        if (authUser.notifications?.promotional?.email !== false) {
          const template =
            referrerRole === AccountType.TRAINER ? "refer-expert" : "refer-friend";
          const subject =
            target === AccountType.TRAINER
              ? "You're invited to coach on NetQwix"
              : "You're invited to train on NetQwix";
          void SendEmail.sendRawEmail(
            template,
            {
              "{FULLNAME}": `${authUser.fullname ?? "A NetQwix member"}`,
              "{FULLNAME1}": `${authUser.fullname ?? "A NetQwix member"}`,
              "{FULLNAME2}": `${authUser.fullname ?? "A NetQwix member"}`,
              "{FULLNAME3}": `${authUser.fullname ?? "A NetQwix member"}`,
              "{FIRSTNAME}": `${(authUser.fullname ?? "").split(" ")[0] || "Friend"}`,
              "{FIRSTNAME1}": `${(authUser.fullname ?? "").split(" ")[0] || "Friend"}`,
              "{FIRSTNAME2}": `${(authUser.fullname ?? "").split(" ")[0] || "Friend"}`,
              "{FIRSTNAME3}": `${(authUser.fullname ?? "").split(" ")[0] || "Friend"}`,
              "{FIRSTNAME4}": `${(authUser.fullname ?? "").split(" ")[0] || "Friend"}`,
              "{PROFILE_PIC}": "",
              "{REFERRAL_LINK}": links.webLink,
            },
            [email],
            subject,
            null
          );
        }

        results.push({ email, ok: true });
      } catch (e: any) {
        results.push({ email, ok: false, error: e?.message || "Failed" });
      }
    }

    return ResponseBuilder.data(
      { results, rewardPreview: preview, links },
      "Invites processed"
    );
  }

  async listInvites(userId: string) {
    const list = await ReferredUser.find({ referrerId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    const emails = list.map((r) => normalizeEmail(r.email)).filter(Boolean);
    let joinedByEmail = new Map<string, { _id: any; createdAt?: Date; account_type?: string }>();
    if (emails.length > 0) {
      const usersWithEmail = await user
        .find({ email: { $in: emails } }, { email: 1, createdAt: 1, account_type: 1 })
        .lean();
      joinedByEmail = new Map(
        usersWithEmail.map((u: any) => [
          normalizeEmail(u.email),
          { _id: u._id, createdAt: u.createdAt, account_type: u.account_type },
        ])
      );
    }

    const enriched = list.map((r) => {
      const email = normalizeEmail(r.email);
      const match = joinedByEmail.get(email);
      const joined = !!match || r.status === "registered" || r.status === "qualified";
      return {
        ...r,
        joined,
        joinedAt: match?.createdAt ?? null,
        joinedUserId: match?._id ?? r.registered_user_id ?? null,
        joinedAccountType: match?.account_type ?? r.target_account_type ?? null,
        targetAccountType: r.target_account_type ?? AccountType.TRAINEE,
      };
    });

    return ResponseBuilder.data(enriched, "Fetched successfully");
  }

  async listRewards(userId: string) {
    const rows = await ReferralReward.find({
      beneficiary_user_id: new Types.ObjectId(userId),
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return ResponseBuilder.data(rows, "Rewards");
  }

  async getRefereeBenefits(userId: string) {
    const { findEligibleReferralAttribution } = await import("./referralCheckoutDiscount");
    const u = await user.findById(userId).select("account_type referred_by_user_id").lean();
    if (!u || u.account_type !== AccountType.TRAINEE) {
      return ResponseBuilder.data(
        { firstLessonCheckout: { eligible: false } },
        "Benefits"
      );
    }
    const attr = await findEligibleReferralAttribution(userId);
    const samplePrice = 50;
    const { estimateFirstLessonCheckoutDiscount } = await import("../../config/referral");
    const estimatedDiscount = attr
      ? estimateFirstLessonCheckoutDiscount(samplePrice)
      : 0;
    return ResponseBuilder.data(
      {
        referred: Boolean(u.referred_by_user_id || attr),
        firstLessonCheckout: {
          eligible: !!attr,
          estimatedDiscountDollars: estimatedDiscount,
          stacksWithPromo: true,
          config: REFERRAL_CONFIG.firstLessonDiscount,
        },
        walletSignupCreditsNote:
          "Signup wallet credits are applied separately after registration.",
      },
      "Benefits"
    );
  }

  private async findReferrerFromInput(params: {
    referralCode?: string;
    referrerId?: string;
    email?: string;
  }): Promise<{ referrer: any; invite?: any } | null> {
    const email = params.email ? normalizeEmail(params.email) : "";

    if (params.referralCode) {
      const code = params.referralCode.trim().toUpperCase();
      const referrer = await user.findOne({ referral_code: code }).lean();
      if (referrer) return { referrer };
    }

    if (params.referrerId && Types.ObjectId.isValid(params.referrerId)) {
      const referrer = await user.findById(params.referrerId).lean();
      if (referrer) return { referrer };
    }

    if (email) {
      const invite = await ReferredUser.findOne({ email }).lean();
      if (invite?.referrerId) {
        const referrer = await user.findById(invite.referrerId).lean();
        if (referrer) return { referrer, invite };
      }
    }

    return null;
  }

  /**
   * Link a newly registered user to their referrer and issue signup wallet credits.
   */
  async onUserRegistered(
    refereeUser: { _id: string; email: string; account_type: string },
    opts: { referralCode?: string; referrerId?: string }
  ) {
    if (!REFERRAL_CONFIG.enabled) return;

    const existingAttr = await ReferralAttribution.findOne({
      referee_user_id: refereeUser._id,
    }).lean();
    if (existingAttr) return;

    const match = await this.findReferrerFromInput({
      referralCode: opts.referralCode,
      referrerId: opts.referrerId,
      email: refereeUser.email,
    });
    if (!match?.referrer) return;

    const referrerId = String(match.referrer._id);
    if (referrerId === String(refereeUser._id)) return;

    const referrerType = asReferralRole(match.referrer.account_type);
    const refereeType = asReferralRole(refereeUser.account_type);
    if (!referrerType || !refereeType) return;

    const invite = match.invite ?? (await ReferredUser.findOne({ email: normalizeEmail(refereeUser.email) }));

    const attribution = await ReferralAttribution.create({
      referrer_user_id: referrerId,
      referee_user_id: refereeUser._id,
      referrer_account_type: referrerType,
      referee_account_type: refereeType,
      invite_id: invite?._id,
      referral_code: match.referrer.referral_code,
    });

    await user.findByIdAndUpdate(refereeUser._id, {
      $set: { referred_by_user_id: referrerId },
    });

    if (invite) {
      await ReferredUser.findByIdAndUpdate(invite._id, {
        $set: {
          status: "registered",
          registered_user_id: refereeUser._id,
          target_account_type: refereeType,
        },
      });
    }

    await this.addFriendLink(referrerId, String(refereeUser._id));

    await this.settleSignupRewards(attribution._id, referrerId, String(refereeUser._id), referrerType, refereeType);
  }

  private async addFriendLink(referrerId: string, refereeId: string) {
    const rUser = await user.findById(referrerId).select("friends").lean();
    const friends = (rUser?.friends ?? []).map((id) => String(id));
    if (!friends.includes(refereeId)) {
      await user.findByIdAndUpdate(referrerId, { $addToSet: { friends: refereeId } });
    }
    await user.findByIdAndUpdate(refereeId, { $addToSet: { friends: referrerId } });
  }

  private async settleSignupRewards(
    attributionId: mongoose.Types.ObjectId | string,
    referrerId: string,
    refereeId: string,
    referrerType: ReferralRole,
    refereeType: ReferralRole
  ) {
    const attrId = String(attributionId);
    await this.creditReward({
      attributionId: attrId,
      beneficiaryUserId: referrerId,
      beneficiaryRole: "referrer",
      trigger: "signup",
      amountMinor: referralMatrixAmount("signup", "referrer", referrerType, refereeType),
      idempotencyKey: `referral:signup:referrer:${attrId}`,
    });
    await this.creditReward({
      attributionId: attrId,
      beneficiaryUserId: refereeId,
      beneficiaryRole: "referee",
      trigger: "signup",
      amountMinor: referralMatrixAmount("signup", "referee", referrerType, refereeType),
      idempotencyKey: `referral:signup:referee:${attrId}`,
    });
    await ReferralAttribution.findByIdAndUpdate(attributionId, {
      $set: { signup_rewards_settled: true },
    });
  }

  async onSessionCompleted(booking: {
    _id?: string;
    status?: string;
    trainee_id?: string;
    trainer_id?: string;
  }) {
    if (!REFERRAL_CONFIG.enabled) return;
    if (booking.status !== BOOKED_SESSIONS_STATUS.completed) return;

    const bookingId = String(booking._id ?? "");
    const participantIds = [booking.trainee_id, booking.trainer_id]
      .filter(Boolean)
      .map((id) => String(id));

    for (const participantId of participantIds) {
      const attribution = await ReferralAttribution.findOne({
        referee_user_id: participantId,
        first_booking_reward_settled: { $ne: true },
      }).lean();
      if (!attribution) continue;

      const completedCount = await booked_session.countDocuments({
        status: BOOKED_SESSIONS_STATUS.completed,
        $or: [{ trainee_id: participantId }, { trainer_id: participantId }],
      });
      if (completedCount !== 1) continue;

      const referrerType = attribution.referrer_account_type as ReferralRole;
      const refereeType = attribution.referee_account_type as ReferralRole;
      const amountMinor = referralMatrixAmount(
        "first_booking",
        "referrer",
        referrerType,
        refereeType
      );

      await this.creditReward({
        attributionId: String(attribution._id),
        beneficiaryUserId: String(attribution.referrer_user_id),
        beneficiaryRole: "referrer",
        trigger: "first_booking",
        amountMinor,
        idempotencyKey: `referral:first_booking:referrer:${attribution._id}`,
        bookingId,
      });

      await ReferralAttribution.findByIdAndUpdate(attribution._id, {
        $set: { first_booking_reward_settled: true },
      });

      await ReferredUser.updateMany(
        { registered_user_id: participantId },
        { $set: { status: "qualified" } }
      );
    }
  }

  private async creditReward(params: {
    attributionId: string;
    beneficiaryUserId: string;
    beneficiaryRole: "referrer" | "referee";
    trigger: "signup" | "first_booking";
    amountMinor: number;
    idempotencyKey: string;
    bookingId?: string;
  }) {
    const existing = await ReferralReward.findOne({
      idempotency_key: params.idempotencyKey,
    }).lean();
    if (existing) return;

    if (params.amountMinor <= 0) {
      await ReferralReward.create({
        attribution_id: params.attributionId,
        beneficiary_user_id: params.beneficiaryUserId,
        beneficiary_role: params.beneficiaryRole,
        trigger: params.trigger,
        amount_minor: 0,
        currency: REFERRAL_CONFIG.currency,
        status: "skipped",
        idempotency_key: params.idempotencyKey,
        booking_id: params.bookingId,
        skip_reason: "zero_amount",
      });
      return;
    }

    if (!WALLET_CONFIG.enabled) {
      await ReferralReward.create({
        attribution_id: params.attributionId,
        beneficiary_user_id: params.beneficiaryUserId,
        beneficiary_role: params.beneficiaryRole,
        trigger: params.trigger,
        amount_minor: params.amountMinor,
        currency: REFERRAL_CONFIG.currency,
        status: "skipped",
        idempotency_key: params.idempotencyKey,
        booking_id: params.bookingId,
        skip_reason: "wallet_disabled",
      });
      return;
    }

    try {
      const beneficiary = await user
        .findById(params.beneficiaryUserId)
        .select("account_type")
        .lean();
      const walletType =
        beneficiary?.account_type === AccountType.TRAINER ? "trainer" : "trainee";

      const wallet = await walletAccountService.getOrCreateUserWallet({
        userId: params.beneficiaryUserId,
        accountType: walletType,
        currency: REFERRAL_CONFIG.currency,
      });
      const platform = await walletAccountService.getOrCreatePlatformAccount(
        REFERRAL_CONFIG.currency
      );

      const ledgerResult = await ledgerService.post({
        idempotencyKey: params.idempotencyKey,
        referenceType: "referral",
        referenceId: params.attributionId,
        sessionId: params.bookingId,
        actor: "system",
        metadata: {
          trigger: params.trigger,
          beneficiaryRole: params.beneficiaryRole,
        },
        legs: [
          {
            walletAccountId: new Types.ObjectId(String(wallet._id)),
            bucket: "available",
            entryType: "credit",
            amountMinor: params.amountMinor,
          },
          {
            walletAccountId: new Types.ObjectId(String(platform._id)),
            bucket: "available",
            entryType: "debit",
            amountMinor: params.amountMinor,
          },
        ],
      });

      await ReferralReward.create({
        attribution_id: params.attributionId,
        beneficiary_user_id: params.beneficiaryUserId,
        beneficiary_role: params.beneficiaryRole,
        trigger: params.trigger,
        amount_minor: params.amountMinor,
        currency: REFERRAL_CONFIG.currency,
        status: "credited",
        idempotency_key: params.idempotencyKey,
        booking_id: params.bookingId,
        ledger_entry_ids: ledgerResult.entryIds,
      });
      await ledgerService.refreshBalanceCache(wallet._id);
    } catch (e: any) {
      await ReferralReward.create({
        attribution_id: params.attributionId,
        beneficiary_user_id: params.beneficiaryUserId,
        beneficiary_role: params.beneficiaryRole,
        trigger: params.trigger,
        amount_minor: params.amountMinor,
        currency: REFERRAL_CONFIG.currency,
        status: "failed",
        idempotency_key: params.idempotencyKey,
        booking_id: params.bookingId,
        skip_reason: e?.message || "ledger_failed",
      });
    }
  }
}

export const referralService = new ReferralService();
