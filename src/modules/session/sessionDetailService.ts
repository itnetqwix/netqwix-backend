import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import escrow_holds from "../../model/escrow_holds.schema";
import { INSTANT_REFUND_REASON } from "../../config/instantLesson";

async function loadSessionAggregate(bookingId: string) {
  if (!mongoose.isValidObjectId(bookingId)) return null;
  const rows = await booked_session.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(bookingId) } },
    {
      $lookup: {
        from: "users",
        localField: "trainer_id",
        foreignField: "_id",
        as: "trainer_info",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "trainee_id",
        foreignField: "_id",
        as: "trainee_info",
      },
    },
    {
      $addFields: {
        trainer_info: { $arrayElemAt: ["$trainer_info", 0] },
        trainee_info: { $arrayElemAt: ["$trainee_info", 0] },
      },
    },
  ]);
  return rows[0] ?? null;
}

function formatUser(u: any) {
  if (!u) return null;
  return {
    _id: String(u._id),
    fullname: u.fullname ?? u.fullName,
    email: u.email,
    profile_picture: u.profile_picture,
    category: u.category,
    time_zone:
      u.time_zone ?? u.extraInfo?.availabilityInfo?.timeZone ?? null,
  };
}

export async function getSessionDetailForUser(
  bookingId: string,
  userId: string,
  accountType: string
) {
  const row = await loadSessionAggregate(bookingId);
  if (!row) return null;

  const isTrainer = accountType === "Trainer";
  const ownerId = isTrainer ? String(row.trainer_id) : String(row.trainee_id);
  if (ownerId !== String(userId)) return null;

  return buildDetailPayload(row, { includePrivateIds: false });
}

export async function getSessionDetailForAdmin(bookingId: string) {
  const row = await loadSessionAggregate(bookingId);
  if (!row) return null;
  return buildDetailPayload(row, { includePrivateIds: true });
}

async function buildDetailPayload(row: any, opts: { includePrivateIds: boolean }) {
  const hold = await escrow_holds
    .findOne({ session_id: String(row._id) })
    .sort({ createdAt: -1 })
    .lean();

  const trainer = formatUser(row.trainer_info);
  const trainee = formatUser(row.trainee_info);

  const refundReasonLabels: Record<string, string> = {
    [INSTANT_REFUND_REASON.ACCEPT_EXPIRED]: "Accept window expired",
    [INSTANT_REFUND_REASON.DECLINED]: "Declined by coach",
    [INSTANT_REFUND_REASON.JOIN_EXPIRED]: "Join window expired",
    [INSTANT_REFUND_REASON.NO_SHOW]: "No-show",
  };

  return {
    session: {
      _id: String(row._id),
      status: row.status,
      is_instant: !!row.is_instant,
      instant_phase: row.instant_phase ?? null,
      duration_minutes: row.duration_minutes ?? null,
      booked_date: row.booked_date,
      session_start_time: row.session_start_time,
      session_end_time: row.session_end_time,
      start_time: row.start_time,
      end_time: row.end_time,
      time_zone: row.time_zone ?? null,
      requested_at: row.requested_at ?? row.createdAt,
      accept_deadline_at: row.accept_deadline_at ?? null,
      accepted_at: row.accepted_at ?? null,
      join_deadline_at: row.join_deadline_at ?? null,
      both_joined_at: row.both_joined_at ?? null,
      amount: row.amount ?? null,
      original_amount: row.original_amount ?? null,
      coupon_code: row.coupon_code ?? null,
      discount_applied: row.discount_applied ?? null,
      refund_status: row.refund_status ?? null,
      refund_reason: row.refund_reason ?? null,
      refund_reason_label: row.refund_reason
        ? refundReasonLabels[row.refund_reason] || row.refund_reason
        : null,
      ratings: row.ratings ?? null,
      total_extended_minutes: row.total_extended_minutes ?? 0,
      extensions: row.extensions ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    trainer,
    trainee,
    escrow: hold
      ? {
          hold_id: String(hold._id),
          status: hold.status,
          gross_minor: hold.gross_minor,
          trainer_net_minor: hold.trainer_net_minor,
          platform_fee_minor: hold.platform_fee_minor,
          funding_source: hold.funding_source,
          release_eligible_at: hold.release_eligible_at,
          released_at: hold.released_at,
          release_reason: hold.release_reason,
        }
      : null,
    payment: {
      method: row.payment_intent_id ? "card" : "wallet",
      payment_intent_id: opts.includePrivateIds ? row.payment_intent_id : null,
    },
  };
}

export const sessionDetailService = {
  getSessionDetailForUser,
  getSessionDetailForAdmin,
};
