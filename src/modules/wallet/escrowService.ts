import mongoose from "mongoose";
import escrow_holds from "../../model/escrow_holds.schema";
import user from "../../model/user.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { financialAuditService } from "./financialAuditService";

export type EscrowCreateParams = {
  sessionId: string;
  traineeId: string;
  trainerId: string;
  grossMinor: number;
  platformFeeMinor: number;
  fundingSource: "wallet" | "card" | "mixed";
  stripePaymentIntentId?: string;
  kind?: "booking" | "extension";
  parentHoldId?: string;
  idempotencyKey: string;
};

export class EscrowService {
  computeFees(grossMinor: number, commissionRate: number) {
    const platformFeeMinor = Math.round(grossMinor * commissionRate);
    const trainerNetMinor = grossMinor - platformFeeMinor;
    return { platformFeeMinor, trainerNetMinor };
  }

  async createHold(params: EscrowCreateParams) {
    const existing = await escrow_holds.findOne({
      session_id: params.sessionId,
      kind: params.kind ?? "booking",
      status: "held",
      gross_minor: params.grossMinor,
    });
    if (existing) return existing;

    const trainer = await user.findById(params.trainerId).select("commission").lean();
    const commissionRate = Number(trainer?.commission ?? 0.15);
    const { platformFeeMinor, trainerNetMinor } =
      params.platformFeeMinor != null
        ? {
            platformFeeMinor: params.platformFeeMinor,
            trainerNetMinor: params.grossMinor - params.platformFeeMinor,
          }
        : this.computeFees(params.grossMinor, commissionRate);

    const traineeWallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.traineeId,
      accountType: "trainee",
    });
    const platform = await walletAccountService.getOrCreatePlatformAccount();

    const ledgerResult = await ledgerService.post({
      idempotencyKey: params.idempotencyKey,
      referenceType: params.kind === "extension" ? "extension" : "escrow_hold",
      referenceId: params.sessionId,
      sessionId: params.sessionId,
      actor: "user",
      actorUserId: params.traineeId,
      legs: [
        {
          walletAccountId: new mongoose.Types.ObjectId(String(traineeWallet._id)),
          bucket: "available",
          entryType: "debit",
          amountMinor: params.grossMinor,
        },
        {
          walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
          bucket: "escrow_held",
          entryType: "credit",
          amountMinor: params.grossMinor,
        },
      ],
    });

    const clearanceMs = WALLET_CONFIG.clearanceHoursStandard * 60 * 60 * 1000;
    const hold = await escrow_holds.create({
      session_id: params.sessionId,
      trainee_id: params.traineeId,
      trainer_id: params.trainerId,
      trainee_wallet_id: traineeWallet._id,
      gross_minor: params.grossMinor,
      platform_fee_minor: platformFeeMinor,
      trainer_net_minor: trainerNetMinor,
      funding_source: params.fundingSource,
      stripe_payment_intent_id: params.stripePaymentIntentId,
      ledger_hold_entry_ids: ledgerResult.entryIds,
      status: "held",
      release_eligible_at: new Date(Date.now() + clearanceMs),
      kind: params.kind ?? "booking",
      parent_hold_id: params.parentHoldId,
    });

    await financialAuditService.log({
      action: "escrow_hold_created",
      entity_type: "escrow_hold",
      entity_id: String(hold._id),
      user_id: params.traineeId as any,
      amount_minor: params.grossMinor,
      meta: { sessionId: params.sessionId, fundingSource: params.fundingSource },
    });

    return hold;
  }

  async createCardEscrowRecord(params: EscrowCreateParams) {
    /** Card-funded escrow: funds on platform via Stripe PI; ledger records liability in escrow_held */
    const trainer = await user.findById(params.trainerId).select("commission").lean();
    const commissionRate = Number(trainer?.commission ?? 0.15);
    const { platformFeeMinor, trainerNetMinor } = this.computeFees(
      params.grossMinor,
      commissionRate
    );
    const platform = await walletAccountService.getOrCreatePlatformAccount();
    const traineeWallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.traineeId,
      accountType: "trainee",
    });

    if (WALLET_CONFIG.escrowEnabled) {
      await ledgerService.post({
        idempotencyKey: params.idempotencyKey,
        referenceType: params.kind === "extension" ? "extension" : "escrow_hold",
        referenceId: params.sessionId,
        sessionId: params.sessionId,
        actor: "webhook",
        legs: [
          {
            walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
            bucket: "escrow_held",
            entryType: "credit",
            amountMinor: params.grossMinor,
          },
          {
            walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
            bucket: "available",
            entryType: "debit",
            amountMinor: params.grossMinor,
          },
        ],
      });
    }

    const clearanceMs = WALLET_CONFIG.clearanceHoursStandard * 60 * 60 * 1000;
    return escrow_holds.create({
      session_id: params.sessionId,
      trainee_id: params.traineeId,
      trainer_id: params.trainerId,
      trainee_wallet_id: traineeWallet._id,
      gross_minor: params.grossMinor,
      platform_fee_minor: platformFeeMinor,
      trainer_net_minor: trainerNetMinor,
      funding_source: params.fundingSource,
      stripe_payment_intent_id: params.stripePaymentIntentId,
      status: "held",
      release_eligible_at: new Date(Date.now() + clearanceMs),
      kind: params.kind ?? "booking",
    });
  }

  async listHolds(filter: Record<string, unknown> = {}, page = 1, limit = 25) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      escrow_holds.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      escrow_holds.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
}

export const escrowService = new EscrowService();
