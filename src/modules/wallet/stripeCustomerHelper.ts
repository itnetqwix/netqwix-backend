import user from "../../model/user.schema";
import wallet_accounts from "../../model/wallet_accounts.schema";
import { AccountType } from "../auth/authEnum";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

function isStripeCustomerId(id?: string | null): boolean {
  return typeof id === "string" && id.startsWith("cus_");
}

/**
 * Ensures a Stripe Customer (cus_*) exists for wallet card top-ups.
 * Trainees use Customer IDs; Connect account IDs (acct_*) must not be passed as customer.
 */
export async function ensureStripeCustomerForUser(userId: string): Promise<string> {
  const u = await user.findById(userId).select("email fullname stripe_account_id account_type").lean();
  if (!u) throw new Error("User not found.");

  const wallet = await wallet_accounts
    .findOne({ user_id: userId })
    .select("stripe_customer_id")
    .lean();

  if (isStripeCustomerId(wallet?.stripe_customer_id)) {
    return wallet!.stripe_customer_id as string;
  }

  if (isStripeCustomerId(u.stripe_account_id)) {
    await wallet_accounts.updateMany(
      { user_id: userId },
      { $set: { stripe_customer_id: u.stripe_account_id } }
    );
    return u.stripe_account_id as string;
  }

  const customer = await stripe.customers.create({
    email: u.email,
    name: u.fullname,
    metadata: {
      user_id: String(userId),
      account_type: String(u.account_type ?? AccountType.TRAINEE),
    },
  });

  // Never overwrite Stripe Connect account IDs (acct_*) on the user record.
  const userStripe = u.stripe_account_id;
  if (!userStripe || userStripe.startsWith("cus_")) {
    await user.findByIdAndUpdate(userId, { stripe_account_id: customer.id });
  }
  await wallet_accounts.updateMany(
    { user_id: userId },
    { $set: { stripe_customer_id: customer.id } }
  );

  return customer.id;
}
