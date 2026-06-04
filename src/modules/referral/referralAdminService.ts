import mongoose from "mongoose";
import ReferredUser from "../../model/referred.user.schema";
import ReferralAttribution from "../../model/referral_attribution.schema";
import ReferralReward from "../../model/referral_reward.schema";
import user from "../../model/user.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { REFERRAL_CONFIG } from "../../config/referral";
import { formatRewardPreviewPoints } from "../../config/points";
import PointsRedemption from "../../model/points_redemption.schema";
import { AccountType } from "../auth/authEnum";

export class ReferralAdminService {
  async getDashboard() {
    const [
      invitesTotal,
      invitesPending,
      invitesRegistered,
      attributionsTotal,
      rewardAgg,
      checkoutDiscountAgg,
      redemptionAgg,
      pairAgg,
      recentRewards,
      recentAttributions,
    ] = await Promise.all([
      ReferredUser.countDocuments({}),
      ReferredUser.countDocuments({ status: "pending" }),
      ReferredUser.countDocuments({ status: { $in: ["registered", "qualified"] } }),
      ReferralAttribution.countDocuments({}),
      ReferralReward.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            amountMinor: { $sum: "$amount_minor" },
            pointsAwarded: { $sum: "$points_awarded" },
          },
        },
      ]),
      ReferralAttribution.aggregate([
        { $match: { first_lesson_discount_used: true } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalDollars: { $sum: "$first_lesson_discount_amount" },
          },
        },
      ]),
      PointsRedemption.aggregate([
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            pointsSpent: { $sum: "$points_spent" },
            amountMinor: { $sum: "$amount_minor" },
          },
        },
      ]),
      ReferralAttribution.aggregate([
        {
          $group: {
            _id: {
              referrer: "$referrer_account_type",
              referee: "$referee_account_type",
            },
            count: { $sum: 1 },
          },
        },
      ]),
      ReferralReward.find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      ReferralAttribution.find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const rewardByStatus: Record<
      string,
      { count: number; amountMinor: number; pointsAwarded: number }
    > = {};
    for (const row of rewardAgg) {
      rewardByStatus[row._id] = {
        count: row.count,
        amountMinor: row.amountMinor,
        pointsAwarded: row.pointsAwarded ?? 0,
      };
    }

    const referrerIds = [
      ...new Set(recentAttributions.map((a) => String(a.referrer_user_id))),
    ];
    const refereeIds = [
      ...new Set(recentAttributions.map((a) => String(a.referee_user_id))),
    ];
    const users = await user
      .find({ _id: { $in: [...referrerIds, ...refereeIds] } })
      .select("fullname email account_type")
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const enrichedAttributions = recentAttributions.map((a) => ({
      ...a,
      referrer: userMap.get(String(a.referrer_user_id)),
      referee: userMap.get(String(a.referee_user_id)),
    }));

    const beneficiaryIds = [
      ...new Set(recentRewards.map((r) => String(r.beneficiary_user_id))),
    ];
    const beneficiaries = await user
      .find({ _id: { $in: beneficiaryIds } })
      .select("fullname email")
      .lean();
    const benMap = new Map(beneficiaries.map((u) => [String(u._id), u]));
    const enrichedRewards = recentRewards.map((r) => ({
      ...r,
      beneficiary: benMap.get(String(r.beneficiary_user_id)),
    }));

    return ResponseBuilder.data(
      {
        enabled: REFERRAL_CONFIG.enabled,
        currency: REFERRAL_CONFIG.currency,
        firstLessonDiscount: REFERRAL_CONFIG.firstLessonDiscount,
        rewardMatrixPoints: {
          trainerInviteTrainee: formatRewardPreviewPoints(
            AccountType.TRAINER,
            AccountType.TRAINEE
          ),
          trainerInviteTrainer: formatRewardPreviewPoints(
            AccountType.TRAINER,
            AccountType.TRAINER
          ),
          traineeInviteTrainee: formatRewardPreviewPoints(
            AccountType.TRAINEE,
            AccountType.TRAINEE
          ),
          traineeInviteTrainer: formatRewardPreviewPoints(
            AccountType.TRAINEE,
            AccountType.TRAINER
          ),
        },
        summary: {
          invitesTotal,
          invitesPending,
          invitesRegistered,
          attributionsTotal,
          rewardsCreditedCount: rewardByStatus.credited?.count ?? 0,
          rewardsCreditedMinor: rewardByStatus.credited?.amountMinor ?? 0,
          referralPointsIssued: rewardByStatus.credited?.pointsAwarded ?? 0,
          rewardsSkippedCount: rewardByStatus.skipped?.count ?? 0,
          rewardsFailedCount: rewardByStatus.failed?.count ?? 0,
          pointsRedemptionsCount: redemptionAgg[0]?.count ?? 0,
          pointsRedeemedTotal: redemptionAgg[0]?.pointsSpent ?? 0,
          pointsRedeemedWalletMinor: redemptionAgg[0]?.amountMinor ?? 0,
          checkoutDiscountsUsed: checkoutDiscountAgg[0]?.count ?? 0,
          checkoutDiscountDollars: checkoutDiscountAgg[0]?.totalDollars ?? 0,
        },
        byPair: pairAgg.map((p) => ({
          referrerType: p._id.referrer,
          refereeType: p._id.referee,
          attributions: p.count,
        })),
        recentRewards: enrichedRewards,
        recentAttributions: enrichedAttributions,
      },
      "Referral dashboard"
    );
  }

  async listRewards(page = 1, limit = 50, status?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      ReferralReward.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ReferralReward.countDocuments(filter),
    ]);
    return ResponseBuilder.data({ items, total, page, limit }, "Rewards");
  }

  async listAttributions(page = 1, limit = 50) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      ReferralAttribution.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ReferralAttribution.countDocuments({}),
    ]);
    return ResponseBuilder.data({ items, total, page, limit }, "Attributions");
  }
}

export const referralAdminService = new ReferralAdminService();
