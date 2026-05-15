import user from "../../model/user.schema";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import mongoose from "mongoose";
import { financialAuditService } from "./financialAuditService";

/**
 * One-time / maintenance migration: map legacy user.wallet_amount to ledger opening balance.
 */
export class WalletMigrationService {
  async migrateLegacyTrainerBalances(dryRun = true) {
    const trainers = await user
      .find({ wallet_amount: { $gt: 0 } })
      .select("_id wallet_amount account_type")
      .lean();

    const results: { userId: string; amount: number; status: string }[] = [];

    for (const t of trainers) {
      const amountMinor = Math.round(Number(t.wallet_amount || 0) * 100);
      if (amountMinor <= 0) continue;

      const userId = String(t._id);
      if (dryRun) {
        results.push({ userId, amount: amountMinor, status: "dry_run" });
        continue;
      }

      try {
        const wallet = await walletAccountService.getOrCreateUserWallet({
          userId,
          accountType: "trainer",
        });
        const platform = await walletAccountService.getOrCreatePlatformAccount();
        await ledgerService.post({
          idempotencyKey: `migration:opening:${userId}`,
          referenceType: "migration_opening",
          referenceId: userId,
          actor: "system",
          legs: [
            {
              walletAccountId: new mongoose.Types.ObjectId(String(wallet._id)),
              bucket: "available",
              entryType: "credit",
              amountMinor,
            },
            {
              walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
              bucket: "available",
              entryType: "debit",
              amountMinor,
            },
          ],
        });
        results.push({ userId, amount: amountMinor, status: "migrated" });
      } catch (e: any) {
        results.push({ userId, amount: amountMinor, status: e?.message || "error" });
      }
    }

    if (!dryRun) {
      await financialAuditService.log({
        action: "wallet_legacy_migration",
        entity_type: "system",
        meta: { count: results.length },
      });
    }

    return { dryRun, results };
  }
}

export const walletMigrationService = new WalletMigrationService();
