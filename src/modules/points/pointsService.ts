import mongoose from "mongoose";
import user from "../../model/user.schema";
import PointsLedger from "../../model/points_ledger.schema";
import PointsRedemption from "../../model/points_redemption.schema";
import {
  EARN_RULES,
  POINTS_CONFIG,
  getEarnRule,
  pointsToWalletMinor,
  redeemBlocksAvailable,
  type PointsActionKey,
} from "../../config/points";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { WALLET_CONFIG } from "../../config/wallet";
import { ledgerService } from "../wallet/ledgerService";
import { walletAccountService } from "../wallet/walletAccountService";
import { AccountType } from "../auth/authEnum";
import { getPointsEligibility } from "../../helpers/points/pointsEligibility";

const { Types } = mongoose;

function startOfWeekUtc(): Date {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfDayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export class PointsService {
  async getBalance(userId: string) {
    const u = await user.findById(userId).select("points_balance").lean();
    if (!u) return ResponseBuilder.badRequest("User not found.", 404);
    const balance = Math.max(0, Number(u.points_balance ?? 0));
    const blocks = redeemBlocksAvailable(balance);
    return ResponseBuilder.data(
      {
        balance,
        redeemBlockPoints: POINTS_CONFIG.redemptionBlockPoints,
        minRedeemPoints: POINTS_CONFIG.minRedeemPoints,
        pointsPerDollar: POINTS_CONFIG.pointsPerDollar,
        redeemableBlocks: blocks,
        redeemablePoints: blocks * POINTS_CONFIG.redemptionBlockPoints,
        walletCreditPerBlock: pointsToWalletMinor(POINTS_CONFIG.redemptionBlockPoints) / 100,
      },
      "Points balance"
    );
  }

  getCatalog() {
    return ResponseBuilder.data(
      {
        redemption: {
          blockPoints: POINTS_CONFIG.redemptionBlockPoints,
          walletDollarsPerBlock: pointsToWalletMinor(POINTS_CONFIG.redemptionBlockPoints) / 100,
          minRedeemPoints: POINTS_CONFIG.minRedeemPoints,
          maxPointsPerEarn: POINTS_CONFIG.maxPointsPerAction,
        },
        earnRules: EARN_RULES,
        referralNote:
          "Referral signup and first completed lesson awards are also in points (up to 5 per event).",
      },
      "Points catalog"
    );
  }

  async listLedger(userId: string, query: { page?: number; limit?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;
    const filter = { user_id: new Types.ObjectId(userId) };
    const [rows, total] = await Promise.all([
      PointsLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PointsLedger.countDocuments(filter),
    ]);
    return ResponseBuilder.data(
      { entries: rows, total, page, limit, totalPages: Math.ceil(total / limit) },
      "Points ledger"
    );
  }

  private async sumEarnedInWindow(
    userId: string,
    actionKey: string,
    since: Date
  ): Promise<number> {
    const rows = await PointsLedger.aggregate([
      {
        $match: {
          user_id: new Types.ObjectId(userId),
          action_key: actionKey,
          points: { $gt: 0 },
          createdAt: { $gte: since },
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);
    return rows[0]?.total ?? 0;
  }

  private async checkCaps(
    userId: string,
    actionKey: PointsActionKey,
    points: number
  ): Promise<string | null> {
    const rule = getEarnRule(actionKey);
    if (!rule) return null;
    if (rule.weeklyCap != null) {
      const earned = await this.sumEarnedInWindow(userId, actionKey, startOfWeekUtc());
      if (earned + points > rule.weeklyCap) {
        return `Weekly cap reached for ${rule.label}.`;
      }
    }
    if (rule.dailyCap != null) {
      const earned = await this.sumEarnedInWindow(userId, actionKey, startOfDayUtc());
      if (earned + points > rule.dailyCap) {
        return `Daily cap reached for ${rule.label}.`;
      }
    }
    return null;
  }

  /**
   * Reverse a prior earn row (e.g. cancelled/refunded session). Idempotent per earn key.
   */
  async clawbackEarn(params: {
    userId: string;
    earnIdempotencyKey: string;
    actionKey: string;
    referenceType: "referral" | "session" | "report" | "review" | "admin" | "clawback";
    referenceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ clawed: boolean; points: number; reason?: string }> {
    if (!POINTS_CONFIG.enabled) return { clawed: false, points: 0, reason: "disabled" };

    const clawKey = `clawback:${params.earnIdempotencyKey}`;
    if (await PointsLedger.findOne({ idempotency_key: clawKey }).lean()) {
      return { clawed: false, points: 0, reason: "already_clawed_back" };
    }

    const earn = await PointsLedger.findOne({
      idempotency_key: params.earnIdempotencyKey,
      user_id: new Types.ObjectId(params.userId),
      points: { $gt: 0 },
    }).lean();
    if (!earn) return { clawed: false, points: 0, reason: "no_earn" };

    const pts = Math.floor(earn.points);
    const updated = await user.findOneAndUpdate(
      { _id: params.userId, points_balance: { $gte: pts } },
      { $inc: { points_balance: -pts } },
      { new: true }
    );
    if (!updated) {
      return { clawed: false, points: 0, reason: "insufficient_balance" };
    }

    await PointsLedger.create({
      user_id: params.userId,
      action_key: params.actionKey,
      points: -pts,
      balance_after: Math.max(0, Number(updated.points_balance ?? 0)),
      reference_type: params.referenceType,
      reference_id: params.referenceId ?? "",
      idempotency_key: clawKey,
      metadata: { ...(params.metadata ?? {}), clawedFrom: params.earnIdempotencyKey },
    });

    return { clawed: true, points: pts };
  }

  async awardPoints(params: {
    userId: string;
    actionKey: PointsActionKey | string;
    points: number;
    referenceType: "referral" | "session" | "report" | "review" | "admin";
    referenceId?: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    skipCaps?: boolean;
  }): Promise<{ awarded: boolean; points: number; reason?: string }> {
    if (!POINTS_CONFIG.enabled) return { awarded: false, points: 0, reason: "disabled" };

    const eligibility = await getPointsEligibility(params.userId);
    if (!eligibility.allowed) {
      return { awarded: false, points: 0, reason: eligibility.reason ?? "ineligible" };
    }

    const pts = Math.min(
      Math.max(0, Math.floor(params.points)),
      POINTS_CONFIG.maxPointsPerAction
    );
    if (pts <= 0) return { awarded: false, points: 0, reason: "zero" };

    const existing = await PointsLedger.findOne({
      idempotency_key: params.idempotencyKey,
    }).lean();
    if (existing) return { awarded: false, points: existing.points, reason: "duplicate" };

    if (!params.skipCaps && getEarnRule(params.actionKey as PointsActionKey)) {
      const capErr = await this.checkCaps(
        params.userId,
        params.actionKey as PointsActionKey,
        pts
      );
      if (capErr) return { awarded: false, points: 0, reason: capErr };
    }

    const updated = await user.findOneAndUpdate(
      { _id: params.userId },
      { $inc: { points_balance: pts } },
      { new: true }
    );
    if (!updated) return { awarded: false, points: 0, reason: "user_not_found" };

    await PointsLedger.create({
      user_id: params.userId,
      action_key: params.actionKey,
      points: pts,
      balance_after: Math.max(0, Number(updated.points_balance ?? 0)),
      reference_type: params.referenceType,
      reference_id: params.referenceId ?? "",
      idempotency_key: params.idempotencyKey,
      metadata: params.metadata ?? {},
    });

    return { awarded: true, points: pts };
  }

  async redeemPoints(userId: string, body: { points?: number }) {
    if (!POINTS_CONFIG.enabled) {
      return ResponseBuilder.badRequest("Points redemption is disabled.");
    }
    if (!WALLET_CONFIG.enabled) {
      return ResponseBuilder.badRequest(
        "Wallet is disabled. Points cannot be redeemed until wallet top-up is available in your region."
      );
    }

    const eligibility = await getPointsEligibility(userId);
    if (!eligibility.allowed) {
      return ResponseBuilder.badRequest(eligibility.message ?? "Account cannot redeem points.");
    }

    const block = POINTS_CONFIG.redemptionBlockPoints;
    const requested = body.points != null ? Math.floor(Number(body.points)) : block;
    if (requested < POINTS_CONFIG.minRedeemPoints || requested % block !== 0) {
      return ResponseBuilder.badRequest(
        `Redeem in blocks of ${block} points (minimum ${POINTS_CONFIG.minRedeemPoints}).`
      );
    }

    const u = await user.findById(userId).select("points_balance account_type").lean();
    if (!u) return ResponseBuilder.badRequest("User not found.", 404);

    const balance = Math.max(0, Number(u.points_balance ?? 0));
    if (balance < requested) {
      return ResponseBuilder.badRequest("Insufficient points balance.");
    }

    const redeemIdem = `points:redeem:${userId}:${requested}:${Math.floor(Date.now() / 60000)}`;
    const ledgerIdem = `points:ledger:redeem:${redeemIdem}`;

    const existing = await PointsLedger.findOne({ idempotency_key: ledgerIdem }).lean();
    if (existing) {
      return ResponseBuilder.badRequest("Redemption already processed.");
    }

    const updated = await user.findOneAndUpdate(
      { _id: userId, points_balance: { $gte: requested } },
      { $inc: { points_balance: -requested } },
      { new: true }
    );
    if (!updated) {
      return ResponseBuilder.badRequest("Insufficient points balance.");
    }

    await PointsLedger.create({
      user_id: userId,
      action_key: "points_redeem",
      points: -requested,
      balance_after: Math.max(0, Number(updated.points_balance ?? 0)),
      reference_type: "redemption",
      reference_id: redeemIdem,
      idempotency_key: ledgerIdem,
      metadata: {},
    });

    const amountMinor = pointsToWalletMinor(requested);

    if (WALLET_CONFIG.enabled && amountMinor > 0) {
      const accountType =
        u.account_type === AccountType.TRAINER ? "trainer" : "trainee";
      const wallet = await walletAccountService.getOrCreateUserWallet({
        userId,
        accountType,
      });
      const platform = await walletAccountService.getOrCreatePlatformAccount(
        wallet.currency
      );
      const walletIdem = `points:wallet:${redeemIdem}`;
      await ledgerService.post({
        idempotencyKey: walletIdem,
        referenceType: "referral",
        referenceId: redeemIdem,
        legs: [
          {
            walletAccountId: platform._id as mongoose.Types.ObjectId,
            bucket: "available",
            entryType: "debit",
            amountMinor,
          },
          {
            walletAccountId: wallet._id as mongoose.Types.ObjectId,
            bucket: "available",
            entryType: "credit",
            amountMinor,
          },
        ],
        actor: "system",
        metadata: { kind: "points_redemption", points: requested },
      });
      await PointsRedemption.create({
        user_id: userId,
        points_spent: requested,
        amount_minor: amountMinor,
        currency: wallet.currency,
        wallet_ledger_idempotency_key: walletIdem,
        status: "completed",
      });
    }

    return ResponseBuilder.data(
      {
        pointsSpent: requested,
        walletCreditDollars: amountMinor / 100,
        balance: Math.max(0, Number(updated.points_balance ?? 0)),
      },
      "Points redeemed to wallet"
    );
  }
}

export const pointsService = new PointsService();
