/**
 * Refund / payout / charge timeline for a single transaction (ledger
 * entry id, top-up id, or booking id).
 *
 * On the mobile side `TransactionDetailScreen` falls back to a
 * client-side synthesised timeline when this endpoint returns nothing,
 * so we can ship the route incrementally — new event types from new
 * webhooks just start appearing as the writers (`stripeWebhookService`,
 * `instantLessonRefundService`, `payoutService`) emit them.
 */

import mongoose, { Types } from "mongoose";
import wallet_timeline_event from "../../model/wallet_timeline_event.schema";
import wallet_ledger_entries from "../../model/wallet_ledger_entries.schema";
import wallet_topups from "../../model/wallet_topups.schema";
import booked_sessions from "../../model/booked_sessions.schema";

export type TimelineEventDto = {
  id: string;
  type: string;
  label?: string;
  status: "pending" | "completed" | "failed";
  timestamp: string;
  detail?: string | null;
  reference?: string | null;
};

function toObjectIdOrNull(s: string): Types.ObjectId | null {
  return mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : null;
}

export const walletTimelineService = {
  /** Append a single event. Safe to call from any writer (webhook, worker). */
  async append(input: {
    referenceId: string;
    referenceType: "ledger_entry" | "topup" | "payout" | "booking";
    userId: string;
    type: string;
    label?: string;
    detail?: string;
    status?: "pending" | "completed" | "failed";
    reference?: string;
    occurredAt?: Date;
  }) {
    await wallet_timeline_event.create({
      reference_id: input.referenceId,
      reference_type: input.referenceType,
      user_id: input.userId,
      type: input.type,
      label: input.label ?? null,
      detail: input.detail ?? null,
      status: input.status ?? "completed",
      reference: input.reference ?? null,
      occurred_at: input.occurredAt ?? new Date(),
    });
  },

  /**
   * Builds the timeline for a ledger entry id. If no events have been
   * logged yet (legacy data) we synthesise a minimal "charge → completed"
   * trail from the ledger entry itself so the UI is never empty.
   */
  async getForLedgerEntry(userId: string, entryId: string): Promise<TimelineEventDto[]> {
    const entryObjId = toObjectIdOrNull(entryId);
    if (!entryObjId) return [];

    const events = await wallet_timeline_event
      .find({ reference_id: entryObjId, user_id: userId })
      .sort({ occurred_at: 1, createdAt: 1 })
      .lean();

    if (events.length > 0) {
      return events.map((e: any) => ({
        id: String(e._id),
        type: e.type,
        label: e.label ?? undefined,
        status: e.status ?? "completed",
        timestamp: new Date(e.occurred_at ?? e.createdAt).toISOString(),
        detail: e.detail ?? null,
        reference: e.reference ?? null,
      }));
    }

    // Synthesised fallback — keeps legacy ledger entries from looking broken.
    const ledger = await wallet_ledger_entries.findById(entryObjId).lean();
    if (!ledger || String((ledger as any).user_id) !== String(userId)) return [];

    const created = (ledger as any).createdAt ?? new Date();
    const refType = (ledger as any).reference_type as string;
    const refId = (ledger as any).reference_id as string;
    const synth: TimelineEventDto[] = [];

    if (refType === "topup") {
      const topup = await wallet_topups.findById(refId).lean();
      synth.push({
        id: `${entryId}-initiated`,
        type: "topup-initiated",
        label: "Top-up initiated",
        status: "completed",
        timestamp: new Date((topup as any)?.createdAt ?? created).toISOString(),
      });
      synth.push({
        id: `${entryId}-succeeded`,
        type: "topup-succeeded",
        label: "Top-up credited",
        status: (topup as any)?.status === "succeeded" ? "completed" : "pending",
        timestamp: new Date((topup as any)?.updatedAt ?? created).toISOString(),
      });
    } else if (refType === "booking") {
      const booking = await booked_sessions.findById(refId).lean();
      synth.push({
        id: `${entryId}-charge`,
        type: "charge",
        label: "Session payment",
        status: "completed",
        timestamp: new Date((booking as any)?.createdAt ?? created).toISOString(),
      });
      if ((booking as any)?.refund_status) {
        synth.push({
          id: `${entryId}-refund-initiated`,
          type: "refund-initiated",
          label: "Refund initiated",
          status: "completed",
          timestamp: new Date(
            (booking as any)?.refund_initiated_at ?? (booking as any)?.updatedAt ?? created
          ).toISOString(),
        });
        if ((booking as any).refund_status === "completed") {
          synth.push({
            id: `${entryId}-refund-completed`,
            type: "refund-completed",
            label: "Refund received",
            status: "completed",
            timestamp: new Date(
              (booking as any)?.refund_completed_at ?? (booking as any)?.updatedAt ?? created
            ).toISOString(),
          });
        }
      }
    } else {
      synth.push({
        id: `${entryId}-base`,
        type: (ledger as any)?.entry_type === "credit" ? "topup-succeeded" : "charge",
        status: "completed",
        timestamp: new Date(created).toISOString(),
      });
    }
    return synth;
  },
};
