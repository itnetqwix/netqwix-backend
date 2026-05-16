import * as crypto from "crypto";
import mongoose from "mongoose";
const stripe = require("stripe")(process.env.STRIPE_SECRET);
import payout_requests from "../../model/payout_requests.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { financialAuditService } from "./financialAuditService";
import user from "../../model/user.schema";
import wallet_accounts from "../../model/wallet_accounts.schema";

export class PayoutService {
  async requestWithdrawal(params: {
    trainerId: string;
    amountMinor: number;
    method: "wallet_internal" | "bank";
    currency?: string;
    pinSessionToken?: string;
  }) {
    if (params.amountMinor < 100) {
      throw new Error("Minimum withdrawal is $1.00");
    }
    if (params.amountMinor > WALLET_CONFIG.maxWithdrawMinor) {
      throw new Error("Amount exceeds withdrawal limit.");
    }

    if (params.amountMinor >= WALLET_CONFIG.stepUpThresholdMinor) {
      if (!params.pinSessionToken) {
        throw new Error("PIN verification required for this withdrawal.");
      }
      const { pinService } = require("./pinService");
      const session = pinService.verifyPinSessionToken(params.pinSessionToken);
      if (session.userId !== params.trainerId) {
        throw new Error("Invalid PIN session.");
      }
    }

    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.trainerId,
      accountType: "trainer",
      currency: params.currency,
    });

    const available = await ledgerService.getBalance(wallet._id, "available");
    if (available < params.amountMinor) {
      throw new Error("Insufficient balance.");
    }

    const method =
      params.method ??
      (wallet.payout_preference === "bank_standard" ? "bank" : "wallet_internal");

    const needsApproval = params.amountMinor >= WALLET_CONFIG.stepUpThresholdMinor;
    const idempotencyKey = `payout:${params.trainerId}:${crypto.randomUUID()}`;

    const req = await payout_requests.create({
      trainer_id: params.trainerId,
      wallet_account_id: wallet._id,
      amount_minor: params.amountMinor,
      currency: wallet.currency,
      method,
      status: needsApproval ? "pending_approval" : "approved",
      idempotency_key: idempotencyKey,
      estimated_arrival:
        method === "bank"
          ? new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + WALLET_CONFIG.clearanceHoursFast * 60 * 60 * 1000),
    });

    if (!needsApproval) {
      await this.executePayout(String(req._id));
    }

    return req;
  }

  async executePayout(payoutRequestId: string, adminId?: string) {
    const req = await payout_requests.findById(payoutRequestId);
    if (!req || !["approved", "requested"].includes(req.status)) {
      throw new Error("Payout not executable.");
    }

    const wallet = await wallet_accounts.findById(req.wallet_account_id).lean();
    if (!wallet) throw new Error("Wallet not found.");
    const platform = await walletAccountService.getOrCreatePlatformAccount(req.currency);
    const trainer = await user.findById(req.trainer_id).select("stripe_account_id").lean();

    await ledgerService.post({
      idempotencyKey: `payout:debit:${req._id}`,
      referenceType: "payout",
      referenceId: String(req._id),
      actor: adminId ? "admin" : "system",
      actorUserId: adminId,
      legs: [
        {
          walletAccountId: new mongoose.Types.ObjectId(String(wallet._id)),
          bucket: "available",
          entryType: "debit",
          amountMinor: req.amount_minor,
        },
        {
          walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
          bucket: "available",
          entryType: "credit",
          amountMinor: req.amount_minor,
        },
      ],
    });

    if (req.method === "bank" && trainer?.stripe_account_id) {
      const transfer = await stripe.transfers.create({
        amount: req.amount_minor,
        currency: (req.currency || "usd").toLowerCase(),
        destination: trainer.stripe_account_id,
      });
      req.stripe_transfer_id = transfer.id;
      req.status = "processing";
    } else {
      req.status = "completed";
    }

    await req.save();

    await financialAuditService.log({
      action: "payout_executed",
      entity_type: "payout_request",
      entity_id: String(req._id),
      user_id: req.trainer_id as any,
      admin_id: adminId as any,
      amount_minor: req.amount_minor,
    });

    return req;
  }

  async approvePayout(payoutRequestId: string, adminId: string, secondAdminId?: string) {
    const req = await payout_requests.findById(payoutRequestId);
    if (!req || req.status !== "pending_approval") {
      throw new Error("Payout not pending approval.");
    }
    (req as any).admin_approved_by = new mongoose.Types.ObjectId(adminId);
    if (secondAdminId) {
      (req as any).admin_second_approved_by = new mongoose.Types.ObjectId(secondAdminId);
    }
    req.status = "approved";
    await req.save();
    return this.executePayout(payoutRequestId, adminId);
  }

  async listPayouts(filter: Record<string, unknown>, page = 1, limit = 25) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      payout_requests.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      payout_requests.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
}

export const payoutService = new PayoutService();
