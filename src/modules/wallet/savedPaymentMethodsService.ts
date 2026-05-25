/**
 * Saved payment methods (Stripe Customer payment methods).
 *
 * Why a thin wrapper around Stripe?
 *   The mobile UI just needs `last4 + brand + isDefault` and a way to
 *   remove a card / mark a card default. We delegate persistence to
 *   Stripe (the source of truth for PCI) and read on demand instead of
 *   shadowing the list in our DB — keeps us out of PCI scope and
 *   guarantees we never serve a stale card.
 */

import { ensureStripeCustomerForUser } from "./stripeCustomerHelper";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export type SavedPaymentMethodDto = {
  id: string;
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  addedAt: string;
  walletType: "apple_pay" | "google_pay" | null;
};

function toDto(pm: any, defaultPmId: string | null): SavedPaymentMethodDto {
  const card = pm.card ?? {};
  const walletType =
    card?.wallet?.type === "apple_pay"
      ? "apple_pay"
      : card?.wallet?.type === "google_pay"
      ? "google_pay"
      : null;
  return {
    id: pm.id,
    brand: String(card.brand ?? "unknown").toLowerCase(),
    last4: String(card.last4 ?? ""),
    expMonth: card.exp_month ?? undefined,
    expYear: card.exp_year ?? undefined,
    isDefault: pm.id === defaultPmId,
    addedAt: pm.created ? new Date(pm.created * 1000).toISOString() : new Date().toISOString(),
    walletType,
  };
}

async function getDefaultPaymentMethodId(customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId);
  const inv = customer?.invoice_settings?.default_payment_method;
  if (typeof inv === "string") return inv;
  if (inv?.id) return inv.id;
  return null;
}

export const savedPaymentMethodsService = {
  async list(userId: string): Promise<SavedPaymentMethodDto[]> {
    const customerId = await ensureStripeCustomerForUser(userId);
    const [methods, defaultPmId] = await Promise.all([
      stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 50 }),
      getDefaultPaymentMethodId(customerId),
    ]);
    const items: any[] = methods?.data ?? [];
    return items.map((pm) => toDto(pm, defaultPmId));
  },

  async detach(userId: string, paymentMethodId: string): Promise<void> {
    const customerId = await ensureStripeCustomerForUser(userId);
    /**
     * Stripe lets you detach any pm by id, but we guard so a user can't
     * delete someone else's saved card by guessing the id.
     */
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm?.customer && pm.customer !== customerId) {
      throw new Error("Payment method does not belong to this user.");
    }
    await stripe.paymentMethods.detach(paymentMethodId);
  },

  async makeDefault(userId: string, paymentMethodId: string): Promise<void> {
    const customerId = await ensureStripeCustomerForUser(userId);
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm?.customer && pm.customer !== customerId) {
      throw new Error("Payment method does not belong to this user.");
    }
    if (!pm?.customer) {
      // Attach so it's owned by this customer before promoting it.
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    }
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  },

  /** Used by autoTopUpService — returns the Stripe id only. */
  async getDefaultPaymentMethodIdForUser(userId: string): Promise<string | null> {
    const customerId = await ensureStripeCustomerForUser(userId);
    return getDefaultPaymentMethodId(customerId);
  },
};
