import * as crypto from "crypto";
import mongoose from "mongoose";
const stripe = require("stripe")(process.env.STRIPE_SECRET);
import user from "../../model/user.schema";
import clip from "../../model/clip.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import {
  STORAGE_PLANS,
  StorageBillingInterval,
  StoragePlanId,
  planFromId,
} from "../../config/storage";
import { ensureStripeCustomerForUser } from "../wallet/stripeCustomerHelper";

export class StorageService {
  async getStorage(userId: string) {
    const u: any = await user.findById(userId).lean();
    if (!u) return ResponseBuilder.badRequest("User not found.", 404);
    await this.syncUsedBytes(userId);
    const fresh: any = await user.findById(userId).select(
      "storage_plan storage_quota_bytes storage_used_bytes storage_billing_interval"
    ).lean();
    const planId = (fresh?.storage_plan ?? "free") as StoragePlanId;
    const plan = STORAGE_PLANS[planId] ?? STORAGE_PLANS.free;
    return ResponseBuilder.data(
      {
        planId,
        planLabel: plan.label,
        quotaBytes: fresh?.storage_quota_bytes ?? plan.quotaBytes,
        usedBytes: fresh?.storage_used_bytes ?? 0,
        billingInterval: fresh?.storage_billing_interval ?? null,
        plans: Object.entries(STORAGE_PLANS).map(([id, p]) => ({
          id,
          label: p.label,
          quotaBytes: p.quotaBytes,
          monthlyPrice: p.monthlyCents / 100,
          yearlyPrice: p.yearlyCents / 100,
          yearlySavingsPercent: 10,
        })),
      },
      "STORAGE_INFO"
    );
  }

  async syncUsedBytes(userId: string) {
    const agg = await clip.aggregate([
      {
        $match: {
          user_id: new mongoose.Types.ObjectId(userId),
          $or: [
            { shared_from_user_id: null },
            { shared_from_user_id: { $exists: false } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$file_size_bytes", 0] } } } },
    ]);
    const used = agg[0]?.total ?? 0;
    await user.findByIdAndUpdate(userId, { storage_used_bytes: used });
    return used;
  }

  async assertQuota(userId: string, additionalBytes: number) {
    const u: any = await user.findById(userId).select("storage_quota_bytes storage_used_bytes").lean();
    if (!u) return { ok: false, message: "User not found." };
    const used = u.storage_used_bytes ?? 0;
    const quota = u.storage_quota_bytes ?? STORAGE_PLANS.free.quotaBytes;
    if (used + additionalBytes > quota) {
      return {
        ok: false,
        message: "Storage quota exceeded. Upgrade your plan in Settings.",
        usedBytes: used,
        quotaBytes: quota,
      };
    }
    return { ok: true, usedBytes: used, quotaBytes: quota };
  }

  async createCheckout(
    userId: string,
    planIdRaw: string,
    interval: StorageBillingInterval
  ) {
    const planId = planFromId(planIdRaw);
    if (!planId || planId === "free") {
      return ResponseBuilder.badRequest("Invalid storage plan.", 400);
    }
    const plan = STORAGE_PLANS[planId];
    const customerId = await ensureStripeCustomerForUser(userId);

    if (interval === "one_time") {
      const idempotencyKey = `storage_ot:${userId}:${crypto.randomUUID()}`;
      const pi = await stripe.paymentIntents.create(
        {
          amount: plan.monthlyCents,
          currency: "usd",
          customer: customerId,
          automatic_payment_methods: { enabled: true },
          metadata: {
            kind: "storage_one_time",
            user_id: userId,
            plan_id: planId,
            interval: "one_time",
          },
        },
        { idempotencyKey: idempotencyKey.slice(0, 255) }
      );
      return ResponseBuilder.data(
        { client_secret: pi.client_secret, paymentIntentId: pi.id },
        "STORAGE_CHECKOUT"
      );
    }

    const amountCents = interval === "yearly" ? plan.yearlyCents : plan.monthlyCents;
    const price = await stripe.prices.create({
      unit_amount: amountCents,
      currency: "usd",
      recurring: { interval: interval === "yearly" ? "year" : "month" },
      product_data: { name: `NetQwix Storage ${plan.label} (${interval})` },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        kind: "storage_subscription",
        user_id: userId,
        plan_id: planId,
        interval,
      },
    });

    const pi = subscription.latest_invoice?.payment_intent;
    await user.findByIdAndUpdate(userId, {
      storage_stripe_subscription_id: subscription.id,
    });

    return ResponseBuilder.data(
      {
        client_secret: pi?.client_secret,
        subscriptionId: subscription.id,
        paymentIntentId: pi?.id,
      },
      "STORAGE_CHECKOUT"
    );
  }

  async applyPlan(
    userId: string,
    planId: StoragePlanId,
    interval: StorageBillingInterval | null,
    subscriptionId?: string | null
  ) {
    const plan = STORAGE_PLANS[planId];
    await user.findByIdAndUpdate(userId, {
      storage_plan: planId,
      storage_quota_bytes: plan.quotaBytes,
      storage_billing_interval: interval,
      ...(subscriptionId !== undefined
        ? { storage_stripe_subscription_id: subscriptionId }
        : {}),
    });
  }

  async handlePaymentIntentSucceeded(pi: any) {
    const kind = pi.metadata?.kind;
    if (kind === "storage_one_time") {
      const planId = planFromId(pi.metadata?.plan_id);
      if (!planId || !pi.metadata?.user_id) return;
      await this.applyPlan(pi.metadata.user_id, planId, "one_time", null);
      return;
    }
  }

  async handleSubscriptionUpdated(sub: any) {
    if (sub.metadata?.kind !== "storage_subscription") return;
    const planId = planFromId(sub.metadata?.plan_id);
    if (!planId || !sub.metadata?.user_id) return;
    if (["active", "trialing"].includes(sub.status)) {
      await this.applyPlan(
        sub.metadata.user_id,
        planId,
        (sub.metadata?.interval as StorageBillingInterval) ?? "monthly",
        sub.id
      );
    } else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
      await this.applyPlan(sub.metadata.user_id, "free", null, null);
    }
  }
}

export const storageService = new StorageService();
