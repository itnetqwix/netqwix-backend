import mongoose from "mongoose";
import wallet_ledger_entries from "../../model/wallet_ledger_entries.schema";
import booked_session from "../../model/booked_sessions.schema";
import wallet_topups from "../../model/wallet_topups.schema";
import { walletAccountService } from "./walletAccountService";

export class WalletTransactionDetailService {
  async getLedgerDetail(userId: string, entryId: string) {
    const accounts = await walletAccountService.listUserWalletIds(userId);
    const entry = await wallet_ledger_entries
      .findOne({
        entry_id: entryId,
        wallet_account_id: { $in: accounts },
      })
      .lean();
    if (!entry) return null;

    const refType = String(entry.reference_type ?? "");
    const refId = String(entry.reference_id ?? "");
    const sessionId = entry.session_id ? String(entry.session_id) : undefined;

    let booking: Record<string, unknown> | null = null;
    let topupStatus: string | null = null;
    let paymentMethod: "card" | "wallet" | "topup" = "wallet";

    if (refType === "topup") {
      paymentMethod = "topup";
      const topup = await wallet_topups.findOne({ _id: refId }).select("status stripe_payment_intent_id").lean();
      topupStatus = topup?.status ?? null;
    }

    const lookupId = sessionId || (refType === "booking" || refType === "extension" ? refId : null);
    if (lookupId) {
      booking = await this.loadBookingDetail(lookupId);
      if (booking) {
        paymentMethod = booking.payment_intent_id ? "card" : "wallet";
      }
    }

    return {
      ledger: {
        entry_id: entry.entry_id,
        entry_type: entry.entry_type,
        amount_minor: entry.amount_minor,
        bucket: entry.bucket,
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        session_id: sessionId,
        createdAt: (entry as { createdAt?: Date }).createdAt,
      },
      status: topupStatus ?? booking?.status ?? booking?.refund_status ?? null,
      payment: {
        method: paymentMethod,
        payment_intent_id: booking?.payment_intent_id
          ? this.maskId(String(booking.payment_intent_id))
          : null,
        transaction_id: entry.entry_id,
      },
      session: booking
        ? {
            booked_date: booking.booked_date,
            session_start_time: booking.session_start_time,
            session_end_time: booking.session_end_time,
            start_time: booking.start_time,
            end_time: booking.end_time,
            status: booking.status,
            is_instant: booking.is_instant,
          }
        : null,
      parties: booking
        ? {
            trainer_name:
              (booking.trainer_info as any)?.fullName ??
              (booking.trainer_info as any)?.fullname,
            trainee_name:
              (booking.trainee_info as any)?.fullName ??
              (booking.trainee_info as any)?.fullname,
          }
        : null,
      support: {
        reportAllowed: !!lookupId,
        booking_id: lookupId,
      },
      amounts: {
        amount: Number(entry.amount_minor) / 100,
        currency: "USD",
      },
    };
  }

  async getBookingDetail(userId: string, accountType: string, bookingId: string) {
    const booking = await this.loadBookingDetail(bookingId);
    if (!booking) return null;

    const isTrainer = accountType === "Trainer";
    const ownerId = isTrainer ? String(booking.trainer_id) : String(booking.trainee_id);
    if (ownerId !== String(userId)) return null;

    const amount = Number(booking.amount ?? booking.charging_price ?? 0);
    const fee = Number(booking.application_fee_amount ?? 0);
    const displayAmount = isTrainer ? amount - fee : amount;

    return {
      booking_id: String(booking._id),
      summary: {
        amount: displayAmount,
        currency: "USD",
        status: booking.refund_status ?? booking.status,
      },
      session: {
        booked_date: booking.booked_date,
        session_start_time: booking.session_start_time,
        session_end_time: booking.session_end_time,
        start_time: booking.start_time,
        end_time: booking.end_time,
        status: booking.status,
        is_instant: booking.is_instant,
      },
      parties: {
        trainer_name:
          (booking.trainer_info as any)?.fullName ?? (booking.trainer_info as any)?.fullname,
        trainee_name:
          (booking.trainee_info as any)?.fullName ?? (booking.trainee_info as any)?.fullname,
      },
      payment: {
        method: booking.payment_intent_id ? "card" : "wallet",
        payment_intent_id: booking.payment_intent_id
          ? this.maskId(String(booking.payment_intent_id))
          : null,
        transaction_id: String(booking._id),
      },
      timeline: {
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        refund_status: booking.refund_status,
      },
      support: {
        reportAllowed: true,
        booking_id: String(booking._id),
      },
    };
  }

  private maskId(id: string) {
    if (id.length <= 8) return id;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  }

  private async loadBookingDetail(bookingId: string) {
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
    return (rows[0] as Record<string, unknown>) ?? null;
  }
}

export const walletTransactionDetailService = new WalletTransactionDetailService();
