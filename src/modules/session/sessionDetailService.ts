import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import escrow_holds from "../../model/escrow_holds.schema";
import user from "../../model/user.schema";
import { INSTANT_REFUND_REASON } from "../../config/instantLesson";
import { formatRefundTransferForApi } from "../wallet/refundTransferService";
import { opsEventService } from "../ops/opsEventService";

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

async function normalizeExtensions(extensions: any[], includeAllStatuses: boolean) {
  if (!Array.isArray(extensions) || extensions.length === 0) return [];

  const userIds = [
    ...new Set(
      extensions
        .map((e) => e.requested_by)
        .filter((id) => id && mongoose.isValidObjectId(String(id)))
        .map((id) => String(id))
    ),
  ];

  const users =
    userIds.length > 0
      ? await user
          .find({ _id: { $in: userIds } })
          .select("fullname")
          .lean()
      : [];

  const nameById = new Map(users.map((u) => [String(u._id), (u as any).fullname]));

  return extensions
    .filter((e) => includeAllStatuses || e.status === "applied")
    .map((e) => ({
      minutes: e.minutes,
      amount: e.amount,
      status: e.status,
      requested_at: e.requested_at,
      applied_at: e.applied_at ?? null,
      requested_by: e.requested_by ? String(e.requested_by) : null,
      requested_by_name: e.requested_by
        ? nameById.get(String(e.requested_by)) ?? null
        : null,
    }));
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

  return buildDetailPayload(row, { includePrivateIds: false, includeAllExtensionStatuses: false });
}

export async function getSessionDetailForAdmin(bookingId: string) {
  const row = await loadSessionAggregate(bookingId);
  if (!row) return null;

  const payload = await buildDetailPayload(row, {
    includePrivateIds: true,
    includeAllExtensionStatuses: true,
  });

  const opsEvents = await opsEventService.listBySession(bookingId, 15);
  return {
    ...payload,
    ops_events: opsEvents.map((e: any) => ({
      _id: String(e._id),
      event_id: e.event_id,
      category: e.category,
      severity: e.severity,
      title: e.title,
      summary: e.summary,
      createdAt: e.createdAt,
    })),
  };
}

async function buildDetailPayload(
  row: any,
  opts: { includePrivateIds: boolean; includeAllExtensionStatuses: boolean }
) {
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

  const extensions = await normalizeExtensions(
    row.extensions ?? [],
    opts.includeAllExtensionStatuses
  );

  const refundTransfer = formatRefundTransferForApi(row.refund_transfer);

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
      extensions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    refund: {
      status: row.refund_status ?? null,
      reason: row.refund_reason ?? null,
      reason_label: row.refund_reason
        ? refundReasonLabels[row.refund_reason] || row.refund_reason
        : null,
      transfer: refundTransfer,
    },
    trainer,
    trainee,
    escrow: hold
      ? {
          hold_id: String(hold._id),
          status: hold.status,
          gross_minor: hold.gross_minor,
          charge_total_minor: hold.charge_total_minor ?? hold.gross_minor,
          session_subtotal_minor: hold.session_subtotal_minor ?? 0,
          trainee_platform_fee_minor: hold.trainee_platform_fee_minor ?? 0,
          trainer_platform_fee_minor: hold.trainer_platform_fee_minor ?? 0,
          processing_fee_minor: hold.processing_fee_minor ?? 0,
          tax_minor: hold.tax_minor ?? 0,
          trainer_net_minor: hold.trainer_net_minor,
          platform_fee_minor: hold.platform_fee_minor,
          commission_rate: hold.commission_rate ?? null,
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
