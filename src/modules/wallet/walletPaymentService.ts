import * as crypto from "crypto";
import mongoose from "mongoose";
import { DateTime } from "luxon";
import { WALLET_CONFIG, isRegionWalletEnabled } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { escrowService } from "./escrowService";
import { pinService } from "./pinService";
import {
  buildQuote,
  getCachedQuote,
  validateQuoteForPayment,
} from "../payments/pricingService";
import { PRICING_QUOTE_ENABLED } from "../../config/pricing";
import wallet_accounts from "../../model/wallet_accounts.schema";
import wallet_ledger_entries from "../../model/wallet_ledger_entries.schema";
import booked_session from "../../model/booked_sessions.schema";

function csvEscape(value: string): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export class WalletPaymentService {
  dollarsToMinor(amount: number) {
    return Math.round(amount * 100);
  }

  async payFromWallet(params: {
    traineeId: string;
    sessionId: string;
    trainerId: string;
    amountDollars: number;
    pinSessionToken?: string;
    kind: "extension" | "booking";
    idempotencyKey?: string;
    quoteId?: string;
    paymentMethodHint?: string;
    billingAddress?: { country?: string; state?: string; postal_code?: string };
  }) {
    if (!WALLET_CONFIG.walletPayEnabled || !isRegionWalletEnabled(undefined, "walletPay")) {
      throw new Error("Wallet payments are not enabled.");
    }

    let amountMinor = this.dollarsToMinor(params.amountDollars);
    let feeBreakdown = undefined;

    if (PRICING_QUOTE_ENABLED && params.quoteId) {
      const quote = await validateQuoteForPayment({
        quoteId: params.quoteId,
        sessionSubtotalCents: this.dollarsToMinor(params.amountDollars),
      });
      if (quote) {
        amountMinor = quote.chargeTotalCents;
        feeBreakdown = escrowService.feeBreakdownFromQuote(quote);
      }
    } else if (PRICING_QUOTE_ENABLED) {
      const quote = await buildQuote({
        productType: params.kind === "extension" ? "session_extension" : "session_booking",
        sessionSubtotalCents: amountMinor,
        trainerId: params.trainerId,
        paymentMethodHint: params.paymentMethodHint || "wallet_us",
        billingAddress: params.billingAddress,
      });
      amountMinor = quote.chargeTotalCents;
      feeBreakdown = escrowService.feeBreakdownFromQuote(quote);
    }

    if (amountMinor <= 0) {
      return { paid: true, amountMinor: 0, fundingSource: "wallet" as const };
    }

    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.traineeId,
      accountType: "trainee",
    });

    if (wallet.status === "frozen") {
      throw new Error("Wallet is frozen.");
    }

    if (amountMinor >= WALLET_CONFIG.stepUpThresholdMinor) {
      if (!params.pinSessionToken) {
        throw new Error("PIN verification required for this amount.");
      }
      const session = pinService.verifyPinSessionToken(params.pinSessionToken);
      if (session.userId !== params.traineeId || session.walletAccountId !== String(wallet._id)) {
        throw new Error("Invalid PIN session.");
      }
    }

    const available = await ledgerService.getBalance(wallet._id, "available");
    if (available < amountMinor) {
      throw new Error("Insufficient wallet balance.");
    }

    const idempotencyKey =
      params.idempotencyKey ??
      `walletpay:${params.kind}:${params.sessionId}:${crypto.randomUUID()}`;

    if (WALLET_CONFIG.escrowEnabled) {
      await escrowService.createHold({
        sessionId: params.sessionId,
        traineeId: params.traineeId,
        trainerId: params.trainerId,
        grossMinor: amountMinor,
        platformFeeMinor: feeBreakdown?.platformFeePercentMinor ?? 0,
        fundingSource: "wallet",
        kind: params.kind,
        idempotencyKey,
        feeBreakdown,
        trainerNetMinor: feeBreakdown?.trainerNetMinor,
      });
    } else {
      await ledgerService.post({
        idempotencyKey,
        referenceType: params.kind === "extension" ? "extension" : "booking",
        referenceId: params.sessionId,
        sessionId: params.sessionId,
        actor: "user",
        actorUserId: params.traineeId,
        legs: [
          {
            walletAccountId: new mongoose.Types.ObjectId(String(wallet._id)),
            bucket: "available",
            entryType: "debit",
            amountMinor,
          },
          {
            walletAccountId: new mongoose.Types.ObjectId(
              String((await walletAccountService.getOrCreatePlatformAccount())._id)
            ),
            bucket: "available",
            entryType: "credit",
            amountMinor,
          },
        ],
      });
    }

    return {
      paid: true,
      amountMinor,
      fundingSource: "wallet" as const,
      idempotencyKey,
    };
  }

  /**
   * Compensating refund when booking/extension save fails after wallet debit.
   * Idempotent via escrow hold status + ledger idempotency keys.
   */
  async refundWalletPaymentForSession(params: {
    sessionId: string;
    traineeId: string;
    kind: "booking" | "extension";
    idempotencyKey?: string;
    reason: string;
  }): Promise<{ refunded: boolean }> {
    const escrow_holds = require("../../model/escrow_holds.schema").default;
    const hold = await escrow_holds
      .findOne({
        session_id: params.sessionId,
        kind: params.kind,
        status: { $in: ["held", "disputed"] },
        funding_source: "wallet",
      })
      .sort({ createdAt: -1 })
      .lean();
    if (!hold?._id) {
      return { refunded: false };
    }
    const { releaseService } = require("./releaseService");
    await releaseService.refundHold(
      String(hold._id),
      params.reason || "wallet_payment_rollback"
    );
    return { refunded: true };
  }

  /**
   * Pulse card for the trainer dashboard. Returns a quick "show me the money
   * + my people" hero strip: earnings credited in the last 7 days, week-
   * over-week delta, and an active-students count from confirmed/completed
   * bookings in the last 30 days. We compute in minor units server-side and
   * return dollars to keep the client simple.
   */
  async getTrainerPulse(userId: string) {
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId,
      accountType: "trainer",
    });
    const nowUtc = DateTime.utc();
    const startThisWeek = nowUtc.minus({ days: 7 }).toJSDate();
    const startLastWeek = nowUtc.minus({ days: 14 }).toJSDate();
    const endLastWeek = startThisWeek;
    const start30 = nowUtc.minus({ days: 30 }).toJSDate();

    const [thisWeekAgg, lastWeekAgg] = await Promise.all([
      wallet_ledger_entries
        .aggregate([
          {
            $match: {
              wallet_account_id: wallet._id,
              entry_type: "credit",
              createdAt: { $gte: startThisWeek },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount_minor" } } },
        ])
        .exec(),
      wallet_ledger_entries
        .aggregate([
          {
            $match: {
              wallet_account_id: wallet._id,
              entry_type: "credit",
              createdAt: { $gte: startLastWeek, $lt: endLastWeek },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount_minor" } } },
        ])
        .exec(),
    ]);

    const trainerObjId = new mongoose.Types.ObjectId(userId);
    const [activeStudents, newStudentsRows, last30Sessions] = await Promise.all([
      booked_session.distinct("trainee_id", {
        trainer_id: trainerObjId,
        status: { $in: ["confirmed", "completed", "booked", "upcoming"] },
        booked_date: { $gte: start30 },
      }),
      booked_session.aggregate([
        {
          $match: {
            trainer_id: trainerObjId,
            status: { $in: ["confirmed", "completed", "booked", "upcoming"] },
          },
        },
        { $group: { _id: "$trainee_id", first_seen: { $min: "$createdAt" } } },
        { $match: { first_seen: { $gte: startThisWeek } } },
        { $count: "n" },
      ]),
      booked_session.countDocuments({
        trainer_id: trainerObjId,
        status: { $in: ["confirmed", "completed", "booked", "upcoming"] },
        booked_date: { $gte: startThisWeek },
      }),
    ]);

    const thisWeekMinor = thisWeekAgg?.[0]?.total ?? 0;
    const lastWeekMinor = lastWeekAgg?.[0]?.total ?? 0;
    const deltaMinor = thisWeekMinor - lastWeekMinor;
    const deltaPct =
      lastWeekMinor > 0 ? Math.round((deltaMinor / lastWeekMinor) * 100) : null;

    return {
      currency: wallet.currency || "USD",
      earnings_this_week: thisWeekMinor / 100,
      earnings_last_week: lastWeekMinor / 100,
      delta_amount: deltaMinor / 100,
      delta_percent: deltaPct,
      active_students_30d: activeStudents.length,
      new_students_this_week: newStudentsRows?.[0]?.n ?? 0,
      sessions_this_week: last30Sessions,
    };
  }

  /**
   * Returns a bar-chart-ready time series of earnings, bucketed either
   * weekly (last 8 weeks) or monthly (last 6 months). Each point is keyed
   * by its bucket-start ISO date and includes a human label for the chart.
   */
  async getTrainerEarningsSeries(
    userId: string,
    range: "weekly" | "monthly"
  ) {
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId,
      accountType: "trainer",
    });
    const now = DateTime.utc();
    const buckets: Array<{ start: DateTime; end: DateTime; label: string; key: string }> = [];
    if (range === "weekly") {
      for (let i = 7; i >= 0; i--) {
        const start = now.minus({ weeks: i }).startOf("day").minus({ days: now.weekday - 1 });
        const end = start.plus({ days: 7 });
        buckets.push({
          start,
          end,
          label: start.toFormat("dd LLL"),
          key: start.toISODate() ?? "",
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const start = now.minus({ months: i }).startOf("month");
        const end = start.plus({ months: 1 });
        buckets.push({
          start,
          end,
          label: start.toFormat("LLL yyyy"),
          key: start.toISODate() ?? "",
        });
      }
    }

    const oldest = buckets[0]?.start.toJSDate() ?? now.minus({ months: 6 }).toJSDate();
    const rows = await wallet_ledger_entries
      .aggregate([
        {
          $match: {
            wallet_account_id: wallet._id,
            entry_type: "credit",
            createdAt: { $gte: oldest },
          },
        },
        {
          $project: {
            amount_minor: 1,
            createdAt: 1,
          },
        },
        { $sort: { createdAt: 1 } },
      ])
      .exec();

    const series = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      start: b.start.toISO(),
      end: b.end.toISO(),
      total: 0,
    }));
    for (const row of rows) {
      const ts = DateTime.fromJSDate(row.createdAt).toUTC();
      const idx = series.findIndex(
        (s) =>
          ts >= DateTime.fromISO(s.start ?? "") &&
          ts < DateTime.fromISO(s.end ?? "")
      );
      if (idx >= 0) series[idx].total += Number(row.amount_minor || 0) / 100;
    }

    const total = series.reduce((sum, s) => sum + s.total, 0);
    return {
      range,
      currency: wallet.currency || "USD",
      series,
      total,
    };
  }

  async exportTrainerEarningsCsv(
    userId: string,
    range: "weekly" | "monthly"
  ): Promise<string> {
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId,
      accountType: "trainer",
    });
    const since = DateTime.utc()
      .minus(range === "weekly" ? { weeks: 8 } : { months: 6 })
      .toJSDate();
    const rows = await wallet_ledger_entries
      .find({
        wallet_account_id: wallet._id,
        entry_type: "credit",
        createdAt: { $gte: since },
      })
      .populate({
        path: "session_id",
        select: "trainee_id session_start_time booked_date",
      })
      .sort({ createdAt: -1 })
      .lean();

    const header = [
      "date",
      "session_id",
      "trainee_id",
      "amount",
      "currency",
      "bucket",
      "reference_type",
    ];
    const lines = [header.join(",")];
    for (const row of rows) {
      const trainee = ((row as any).session_id as { trainee_id?: unknown })?.trainee_id ?? "";
      const createdAt = (row as any).createdAt as Date | undefined;
      const cols = [
        createdAt ? DateTime.fromJSDate(createdAt).toISO() ?? "" : "",
        String((row as any).session_id?._id ?? (row as any).session_id ?? ""),
        String(trainee),
        (Number(row.amount_minor || 0) / 100).toFixed(2),
        wallet.currency || "USD",
        String(row.bucket ?? ""),
        String(row.reference_type ?? ""),
      ].map(csvEscape);
      lines.push(cols.join(","));
    }
    return lines.join("\n");
  }

  async getBalanceSummary(userId: string, accountType: "trainee" | "trainer") {
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId,
      accountType,
    });
    const walletDoc = await wallet_accounts
      .findById(wallet._id)
      .select("pin_set_at payout_preference status currency")
      .lean();
    const cache = await ledgerService.refreshBalanceCache(wallet._id);
    return {
      walletAccountId: wallet._id,
      currency: wallet.currency,
      status: wallet.status,
      pinSet: !!walletDoc?.pin_set_at,
      payoutPreference: walletDoc?.payout_preference ?? wallet.payout_preference,
      balances: {
        available: cache.available / 100,
        available_minor: cache.available,
        pending_topup: cache.pending_topup / 100,
        pending_release: cache.pending_release / 100,
        pending_payout: cache.pending_payout / 100,
      },
    };
  }
}

export const walletPaymentService = new WalletPaymentService();
