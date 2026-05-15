import mongoose from "mongoose";
import wallet_accounts from "../../model/wallet_accounts.schema";
import user from "../../model/user.schema";
import { WALLET_CONFIG, resolveCurrencyForRegion } from "../../config/wallet";
import { AccountType } from "../auth/authEnum";

export class WalletAccountService {
  async getOrCreatePlatformAccount(currency: string = WALLET_CONFIG.defaultCurrency) {
    let acc = await wallet_accounts
      .findOne({ account_key: WALLET_CONFIG.platformAccountKey, currency })
      .lean();
    if (!acc) {
      acc = (
        await wallet_accounts.create({
          account_key: WALLET_CONFIG.platformAccountKey,
          account_type: "platform",
          currency,
          status: "active",
        })
      ).toObject();
    }
    return acc;
  }

  async getOrCreateUserWallet(params: {
    userId: string;
    accountType: "trainee" | "trainer";
    currency?: string;
    region?: string;
  }) {
    const currency =
      params.currency ?? resolveCurrencyForRegion(params.region ?? "US");
    let acc = await wallet_accounts
      .findOne({
        user_id: new mongoose.Types.ObjectId(params.userId),
        currency,
      })
      .lean();
    if (acc) return acc;

    const u = await user
      .findById(params.userId)
      .select("stripe_account_id account_type")
      .lean();
    if (!u) throw new Error("User not found.");

    const doc = await wallet_accounts.create({
      user_id: params.userId,
      account_type: params.accountType,
      currency,
      status: "active",
      region: params.region ?? "US",
      stripe_customer_id:
        u.account_type === AccountType.TRAINEE ? u.stripe_account_id : undefined,
      stripe_connect_account_id:
        u.account_type === AccountType.TRAINER ? u.stripe_account_id : undefined,
      payout_preference: "wallet_fast",
    });
    return doc.toObject();
  }

  async getWalletForUser(userId: string, currency?: string) {
    const filter: Record<string, unknown> = {
      user_id: new mongoose.Types.ObjectId(userId),
    };
    if (currency) filter.currency = currency;
    return wallet_accounts.findOne(filter).lean();
  }

  async updatePayoutPreference(
    userId: string,
    preference: "wallet_fast" | "bank_standard",
    currency?: string
  ) {
    const acc = await this.getOrCreateUserWallet({
      userId,
      accountType: "trainer",
      currency,
    });
    return wallet_accounts
      .findByIdAndUpdate(acc._id, { $set: { payout_preference: preference } }, { new: true })
      .lean();
  }

  async setAccountStatus(
    walletAccountId: string,
    status: "active" | "frozen" | "closed"
  ) {
    return wallet_accounts
      .findByIdAndUpdate(walletAccountId, { $set: { status } }, { new: true })
      .lean();
  }
}

export const walletAccountService = new WalletAccountService();
