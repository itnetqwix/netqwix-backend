import mongoose from "mongoose";
import escrow_holds from "../../model/escrow_holds.schema";
import user from "../../model/user.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { financialAuditService } from "./financialAuditService";
import {
  buildQuote,
  parseQuoteFromMetadata,
  QuoteParams,
  QuoteResult,
  resolveCommissionRate,
} from "../payments/pricingService";
import { PricingRegion } from "../../config/pricing";

export type EscrowFeeBreakdown = {
  sessionSubtotalMinor: number;
  traineePlatformFeeMinor: number;
  trainerPlatformFeeMinor: number;
  processingFeeMinor: number;
  taxMinor: number;
  platformFeePercentMinor: number;
  commissionRate: number;
  trainerNetMinor: number;
  chargeTotalMinor: number;
  pricingConfigVersion?: number;
  region?: PricingRegion;
  currency?: string;
};

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
  feeBreakdown?: EscrowFeeBreakdown;
  trainerNetMinor?: number;
};

export class EscrowService {
  computeFeesFromSubtotal(sessionSubtotalMinor: number, commissionRate: number, trainerPlatformFeeMinor = 0) {
    const platformFeePercentMinor = Math.round(sessionSubtotalMinor * commissionRate);
    const trainerNetMinor = Math.max(
      0,
      sessionSubtotalMinor - platformFeePercentMinor - trainerPlatformFeeMinor
    );
    return {
      platformFeePercentMinor,
      platformFeeMinor: platformFeePercentMinor,
      trainerNetMinor,
    };
  }

  /** Legacy: gross = session subtotal only */
  computeFees(grossMinor: number, commissionRate: number) {
    return this.computeFeesFromSubtotal(grossMinor, commissionRate, 0);
  }

  async resolveFeeBreakdown(params: {
    trainerId: string;
    grossMinor: number;
    feeBreakdown?: EscrowFeeBreakdown;
    productType?: QuoteParams["productType"];
    region?: PricingRegion;
  }): Promise<EscrowFeeBreakdown> {
    if (params.feeBreakdown) return params.feeBreakdown;

    const commissionRate = await resolveCommissionRate(params.trainerId, params.region || "US");
    const { platformFeePercentMinor, trainerNetMinor } = this.computeFeesFromSubtotal(
      params.grossMinor,
      commissionRate,
      0
    );
    return {
      sessionSubtotalMinor: params.grossMinor,
      traineePlatformFeeMinor: 0,
      trainerPlatformFeeMinor: 0,
      processingFeeMinor: 0,
      taxMinor: 0,
      platformFeePercentMinor,
      commissionRate,
      trainerNetMinor,
      chargeTotalMinor: params.grossMinor,
    };
  }

  async buildEscrowFromQuote(quoteParams: QuoteParams): Promise<QuoteResult> {
    return buildQuote(quoteParams);
  }

  async createHold(params: EscrowCreateParams) {
    const fees = await this.resolveFeeBreakdown({
      trainerId: params.trainerId,
      grossMinor: params.feeBreakdown?.sessionSubtotalMinor ?? params.grossMinor,
      feeBreakdown: params.feeBreakdown,
    });

    const chargeTotalMinor = fees.chargeTotalMinor || params.grossMinor;
    const debitMinor = chargeTotalMinor;

    const existing = await escrow_holds.findOne({
      session_id: params.sessionId,
      kind: params.kind ?? "booking",
      status: "held",
      charge_total_minor: chargeTotalMinor,
    });
    if (existing) return existing;

    const platformFeeMinor =
      params.platformFeeMinor != null && params.platformFeeMinor > 0
        ? params.platformFeeMinor
        : fees.platformFeePercentMinor;
    const trainerNetMinor = params.trainerNetMinor ?? fees.trainerNetMinor;

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
          amountMinor: debitMinor,
        },
        {
          walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
          bucket: "escrow_held",
          entryType: "credit",
          amountMinor: debitMinor,
        },
      ],
    });

    const clearanceMs = WALLET_CONFIG.clearanceHoursStandard * 60 * 60 * 1000;
    const hold = await escrow_holds.create({
      session_id: params.sessionId,
      trainee_id: params.traineeId,
      trainer_id: params.trainerId,
      trainee_wallet_id: traineeWallet._id,
      currency: fees.currency || "USD",
      gross_minor: debitMinor,
      charge_total_minor: chargeTotalMinor,
      session_subtotal_minor: fees.sessionSubtotalMinor,
      trainee_platform_fee_minor: fees.traineePlatformFeeMinor,
      trainer_platform_fee_minor: fees.trainerPlatformFeeMinor,
      processing_fee_minor: fees.processingFeeMinor,
      tax_minor: fees.taxMinor,
      platform_fee_minor: platformFeeMinor,
      trainer_net_minor: trainerNetMinor,
      commission_rate: fees.commissionRate,
      pricing_config_version: fees.pricingConfigVersion || 1,
      fee_breakdown: fees,
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
      amount_minor: debitMinor,
      meta: {
        sessionId: params.sessionId,
        fundingSource: params.fundingSource,
        traineePlatformFeeMinor: fees.traineePlatformFeeMinor,
        trainerPlatformFeeMinor: fees.trainerPlatformFeeMinor,
        processingFeeMinor: fees.processingFeeMinor,
        taxMinor: fees.taxMinor,
      },
    });

    return hold;
  }

  async createCardEscrowRecord(params: EscrowCreateParams) {
    if (params.stripePaymentIntentId) {
      const byPi = await escrow_holds
        .findOne({ stripe_payment_intent_id: params.stripePaymentIntentId })
        .lean();
      if (byPi) return byPi;
    }
    if ((params.kind ?? "booking") !== "extension") {
      const bySession = await escrow_holds.findOne({
        session_id: params.sessionId,
        kind: params.kind ?? "booking",
        status: { $in: ["held", "disputed"] },
      });
      if (bySession) return bySession;
    }

    let fees = params.feeBreakdown;
    if (!fees && params.grossMinor) {
      fees = {
        sessionSubtotalMinor: params.grossMinor,
        traineePlatformFeeMinor: 0,
        trainerPlatformFeeMinor: 0,
        processingFeeMinor: 0,
        taxMinor: 0,
        platformFeePercentMinor: params.platformFeeMinor || 0,
        commissionRate: 0.15,
        trainerNetMinor: params.grossMinor - (params.platformFeeMinor || 0),
        chargeTotalMinor: params.grossMinor,
      };
    }
    if (!fees) {
      fees = await this.resolveFeeBreakdown({
        trainerId: params.trainerId,
        grossMinor: params.grossMinor,
      });
    }

    const chargeTotalMinor = fees.chargeTotalMinor || params.grossMinor;
    const platformFeeMinor = fees.platformFeePercentMinor;
    const trainerNetMinor = fees.trainerNetMinor;

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
            amountMinor: chargeTotalMinor,
          },
          {
            walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
            bucket: "available",
            entryType: "debit",
            amountMinor: chargeTotalMinor,
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
      currency: fees.currency || "USD",
      gross_minor: chargeTotalMinor,
      charge_total_minor: chargeTotalMinor,
      session_subtotal_minor: fees.sessionSubtotalMinor,
      trainee_platform_fee_minor: fees.traineePlatformFeeMinor,
      trainer_platform_fee_minor: fees.trainerPlatformFeeMinor,
      processing_fee_minor: fees.processingFeeMinor,
      tax_minor: fees.taxMinor,
      platform_fee_minor: platformFeeMinor,
      trainer_net_minor: trainerNetMinor,
      commission_rate: fees.commissionRate,
      pricing_config_version: fees.pricingConfigVersion || 1,
      fee_breakdown: fees,
      funding_source: params.fundingSource,
      stripe_payment_intent_id: params.stripePaymentIntentId,
      status: "held",
      release_eligible_at: new Date(Date.now() + clearanceMs),
      kind: params.kind ?? "booking",
    });
  }

  feeBreakdownFromQuote(quote: QuoteResult): EscrowFeeBreakdown {
    return {
      sessionSubtotalMinor: quote.discountedSubtotalCents,
      traineePlatformFeeMinor: quote.traineePlatformFeeCents,
      trainerPlatformFeeMinor: quote.trainerPlatformFeeCents,
      processingFeeMinor: quote.processingFeeCents,
      taxMinor: quote.taxCents,
      platformFeePercentMinor: quote.platformFeePercentCents,
      commissionRate: quote.commissionRate,
      trainerNetMinor: quote.trainerNetCents,
      chargeTotalMinor: quote.chargeTotalCents,
      pricingConfigVersion: quote.pricingConfigVersion,
      region: quote.region,
      currency: quote.currency,
    };
  }

  feeBreakdownFromPiMetadata(meta: Record<string, string | undefined>): EscrowFeeBreakdown | null {
    const parsed = parseQuoteFromMetadata(meta);
    if (!parsed) return null;
    return {
      sessionSubtotalMinor: parsed.sessionSubtotalCents,
      traineePlatformFeeMinor: parsed.traineePlatformFeeCents,
      trainerPlatformFeeMinor: parsed.trainerPlatformFeeCents,
      processingFeeMinor: parsed.processingFeeCents,
      taxMinor: parsed.taxCents,
      platformFeePercentMinor: parsed.platformFeePercentCents,
      commissionRate: parsed.commissionRate,
      trainerNetMinor: parsed.trainerNetCents,
      chargeTotalMinor: parsed.chargeTotalCents,
      region: parsed.region,
      currency: parsed.currency,
    };
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
