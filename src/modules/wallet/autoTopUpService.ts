/**
 * Auto top-up rule lifecycle (CRUD only — the worker that *fires* the
 * rule lives separately in `autoTopUpTrigger`, invoked after every
 * balance debit in `walletPaymentService`).
 *
 * Why store the rule even when disabled?
 *   Trainees frequently flip the toggle off "for the weekend" and back
 *   on later. Persisting `threshold/reload/payment_method_id` even
 *   while `enabled=false` keeps the UI sticky and avoids re-prompting
 *   for amounts they already chose.
 */

import wallet_auto_topup from "../../model/wallet_auto_topup.schema";
import { walletAccountService } from "./walletAccountService";
import { WALLET_CONFIG } from "../../config/wallet";
import { savedPaymentMethodsService } from "./savedPaymentMethodsService";
import { ResponseBuilder } from "../../helpers/responseBuilder";

export type AutoTopUpDto = {
  enabled: boolean;
  thresholdMinor: number;
  reloadMinor: number;
  paymentMethodId: string | null;
  lastTriggeredAt: string | null;
  lastStatus: "succeeded" | "failed" | "pending" | null;
  currency: string;
};

function toDto(doc: any): AutoTopUpDto {
  return {
    enabled: !!doc.enabled,
    thresholdMinor: Number(doc.threshold_minor ?? 0),
    reloadMinor: Number(doc.reload_minor ?? 0),
    paymentMethodId: doc.payment_method_id ?? null,
    lastTriggeredAt: doc.last_triggered_at ? new Date(doc.last_triggered_at).toISOString() : null,
    lastStatus: (doc.last_status ?? null) as AutoTopUpDto["lastStatus"],
    currency: doc.currency,
  };
}

export const autoTopUpService = {
  async getForUser(userId: string): Promise<AutoTopUpDto | null> {
    const doc = await wallet_auto_topup.findOne({ user_id: userId }).lean();
    return doc ? toDto(doc) : null;
  },

  async upsertForUser(
    userId: string,
    input: {
      enabled?: boolean;
      thresholdMinor?: number;
      reloadMinor?: number;
      paymentMethodId?: string | null;
    }
  ) {
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId,
      accountType: "trainee",
    });

    const enabled = input.enabled !== false;
    const thresholdMinor = Math.max(0, Math.floor(Number(input.thresholdMinor ?? 0)));
    const reloadMinor = Math.max(0, Math.floor(Number(input.reloadMinor ?? 0)));

    if (enabled) {
      if (reloadMinor < WALLET_CONFIG.minTopUpMinor) {
        return ResponseBuilder.badRequest(
          `Reload amount must be at least ${WALLET_CONFIG.minTopUpMinor} (minor units).`,
          400
        );
      }
      if (reloadMinor > WALLET_CONFIG.maxTopUpMinor) {
        return ResponseBuilder.badRequest("Reload amount above top-up cap.", 400);
      }
      if (thresholdMinor >= reloadMinor) {
        return ResponseBuilder.badRequest(
          "Threshold must be lower than the reload amount, otherwise the rule will loop.",
          400
        );
      }
    }

    let paymentMethodId = input.paymentMethodId ?? null;
    if (enabled && !paymentMethodId) {
      paymentMethodId = await savedPaymentMethodsService.getDefaultPaymentMethodIdForUser(userId);
    }
    if (enabled && !paymentMethodId) {
      return ResponseBuilder.badRequest(
        "Add a default payment method before enabling auto top-up.",
        400
      );
    }

    const updated = await wallet_auto_topup.findOneAndUpdate(
      { user_id: userId },
      {
        $set: {
          wallet_account_id: wallet._id,
          user_id: userId,
          enabled,
          threshold_minor: thresholdMinor,
          reload_minor: reloadMinor,
          payment_method_id: paymentMethodId,
          currency: wallet.currency,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return ResponseBuilder.data(toDto(updated as any), "AUTO_TOPUP_SAVED");
  },

  async disable(userId: string): Promise<void> {
    await wallet_auto_topup.updateOne(
      { user_id: userId },
      { $set: { enabled: false } }
    );
  },
};
