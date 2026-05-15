import * as crypto from "crypto";
import mongoose from "mongoose";
const stripe = require("stripe")(process.env.STRIPE_SECRET);
import wallet_topups from "../../model/wallet_topups.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { WALLET_CONFIG, isRegionWalletEnabled } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { financialAuditService } from "./financialAuditService";

export class TopUpService {
  async createTopUpIntent(params: {
    userId: string;
    amountMinor: number;
    currency?: string;
    region?: string;
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
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.userId,
      accountType: "trainee",
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

    const stripeConfig: Record<string, unknown> = {
      amount: params.amountMinor,
      currency: currency.toLowerCase(),
      description: "NetQwix wallet top-up",
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: "wallet_topup",
        topup_id: String(topup._id),
        user_id: params.userId,
      },
    };
    if (params.stripeCustomerId) {
      stripeConfig.customer = params.stripeCustomerId;
    }

    const pi = await stripe.paymentIntents.create(stripeConfig);
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

    const wallet = await walletAccountService.getOrCreateUserWallet({
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
}

export const topUpService = new TopUpService();
