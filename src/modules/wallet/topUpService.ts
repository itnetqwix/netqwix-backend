import * as crypto from "crypto";
import mongoose from "mongoose";
const stripe = require("stripe")(process.env.STRIPE_SECRET);
import wallet_topups from "../../model/wallet_topups.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { WALLET_CONFIG, isRegionWalletEnabled } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { financialAuditService } from "./financialAuditService";
import { ensureStripeCustomerForUser } from "./stripeCustomerHelper";
import { AccountType } from "../auth/authEnum";
import user from "../../model/user.schema";

export class TopUpService {
  async createTopUpIntent(params: {
    userId: string;
    amountMinor: number;
    currency?: string;
    region?: string;
    accountType?: "trainee" | "trainer";
    stripeCustomerId?: string;
  }) {
    if (!WALLET_CONFIG.enabled) {
      return ResponseBuilder.badRequest("Wallet is not enabled.", 503);
    }
    if (!isRegionWalletEnabled(params.region, "topUp")) {
      return ResponseBuilder.badRequest("Top-up is not available in your region yet.", 403);
    }
    if (
      params.amountMinor < WALLET_CONFIG.minTopUpMinor ||
      params.amountMinor > WALLET_CONFIG.maxTopUpMinor
    ) {
      return ResponseBuilder.badRequest("Invalid top-up amount.", 400);
    }

    const currency = params.currency ?? WALLET_CONFIG.defaultCurrency;
    const accountType = params.accountType ?? "trainee";

    const u = await user.findById(params.userId).select("account_type").lean();
    if (u?.account_type === AccountType.TRAINER) {
      return ResponseBuilder.badRequest(
        "Add funds is for trainee wallets used to pay for sessions. Trainer earnings are paid out via Stripe Connect.",
        403
      );
    }

    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.userId,
      accountType,
      currency,
      region: params.region,
    });

    if (wallet.status === "frozen") {
      return ResponseBuilder.badRequest("Wallet is frozen.", 403);
    }

    const idempotencyKey = `topup:${params.userId}:${crypto.randomUUID()}`;
    const topup = await wallet_topups.create({
      wallet_account_id: wallet._id,
      user_id: params.userId,
      amount_minor: params.amountMinor,
      currency,
      status: "pending",
      idempotency_key: idempotencyKey,
    });

    let customerId = params.stripeCustomerId;
    if (!customerId || !String(customerId).startsWith("cus_")) {
      customerId = await ensureStripeCustomerForUser(params.userId);
    }

    const stripeConfig: Record<string, unknown> = {
      amount: params.amountMinor,
      currency: currency.toLowerCase(),
      description: "NetQwix wallet top-up",
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: "wallet_topup",
        topup_id: String(topup._id),
        user_id: params.userId,
      },
    };

    const pi = await stripe.paymentIntents.create(stripeConfig, {
      idempotencyKey: idempotencyKey.slice(0, 255),
    });
    await wallet_topups.findByIdAndUpdate(topup._id, {
      stripe_payment_intent_id: pi.id,
    });

    return ResponseBuilder.data(
      {
        topupId: topup._id,
        client_secret: pi.client_secret,
        id: pi.id,
        amount_minor: params.amountMinor,
      },
      "TOPUP_INTENT_CREATED"
    );
  }

  async completeTopUpFromWebhook(paymentIntentId: string, webhookEventId?: string) {
    const topup = await wallet_topups.findOne({ stripe_payment_intent_id: paymentIntentId });
    if (!topup || topup.status === "succeeded") {
      return { processed: false, reason: "already_done_or_missing" };
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded") {
      return { processed: false, reason: "not_succeeded" };
    }

    const walletDoc = await walletAccountService.getWalletForUser(String(topup.user_id), topup.currency);
    const wallet = walletDoc
      ? walletDoc
      : await walletAccountService.getOrCreateUserWallet({
          userId: String(topup.user_id),
          accountType: "trainee",
          currency: topup.currency,
        });
    const platform = await walletAccountService.getOrCreatePlatformAccount(topup.currency);
    const amount = topup.amount_minor;

    await ledgerService.post({
      idempotencyKey: `topup:complete:${topup._id}`,
      referenceType: "topup",
      referenceId: String(topup._id),
      actor: "webhook",
      legs: [
        {
          walletAccountId: new mongoose.Types.ObjectId(String(wallet._id)),
          bucket: "available",
          entryType: "credit",
          amountMinor: amount,
        },
        {
          walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
          bucket: "available",
          entryType: "debit",
          amountMinor: amount,
        },
      ],
    });

    await wallet_topups.findByIdAndUpdate(topup._id, {
      status: "succeeded",
      webhook_event_id: webhookEventId,
    });

    await financialAuditService.log({
      action: "wallet_topup_succeeded",
      entity_type: "wallet_topup",
      entity_id: String(topup._id),
      user_id: topup.user_id as any,
      amount_minor: amount,
      currency: topup.currency,
    });

    return { processed: true };
  }

  async markTopUpFailed(paymentIntentId: string) {
    const topup = await wallet_topups.findOne({ stripe_payment_intent_id: paymentIntentId });
    if (!topup || topup.status !== "pending") {
      return { updated: false };
    }
    await wallet_topups.findByIdAndUpdate(topup._id, { status: "failed" });
    return { updated: true };
  }

  async getTopUpStatus(userId: string, topupId: string) {
    const topup = await wallet_topups
      .findOne({ _id: topupId, user_id: userId })
      .select("status amount_minor currency stripe_payment_intent_id")
      .lean();
    if (!topup) {
      return ResponseBuilder.badRequest("Top-up not found.", 404);
    }
    let paymentIntentStatus: string | null = null;
    if (topup.stripe_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(topup.stripe_payment_intent_id);
        paymentIntentStatus = pi.status;
      } catch {
        paymentIntentStatus = null;
      }
    }
    return ResponseBuilder.data(
      {
        topupId: topup._id,
        status: topup.status,
        amount_minor: topup.amount_minor,
        currency: topup.currency,
        payment_intent_status: paymentIntentStatus,
      },
      "TOPUP_STATUS"
    );
  }

  /** Client-side confirm after PaymentSheet success when webhook may be delayed. */
  async confirmTopUpFromClient(userId: string, topupId: string) {
    const topup = await wallet_topups.findOne({ _id: topupId, user_id: userId }).lean();
    if (!topup) {
      return ResponseBuilder.badRequest("Top-up not found.", 404);
    }
    if (topup.status === "succeeded") {
      return ResponseBuilder.data({ status: "succeeded", already: true }, "TOPUP_CONFIRMED");
    }
    if (!topup.stripe_payment_intent_id) {
      return ResponseBuilder.badRequest("Payment not initialized.", 400);
    }
    const result = await this.completeTopUpFromWebhook(topup.stripe_payment_intent_id, `client:${topupId}`);
    if (!result.processed && result.reason !== "already_done_or_missing") {
      const pi = await stripe.paymentIntents.retrieve(topup.stripe_payment_intent_id);
      return ResponseBuilder.data(
        {
          status: topup.status,
          payment_intent_status: pi.status,
          processed: false,
        },
        "TOPUP_PENDING"
      );
    }
    const fresh = await wallet_topups.findById(topupId).select("status").lean();
    return ResponseBuilder.data(
      { status: fresh?.status ?? "pending", processed: result.processed },
      "TOPUP_CONFIRMED"
    );
  }
}

export const topUpService = new TopUpService();
