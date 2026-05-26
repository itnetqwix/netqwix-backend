/**
 * Nightly job — hard-deletes accounts whose 15-day soft-delete window
 * (Phase 2 item 15) has lapsed.
 */

export async function processOverdueAccountDeletions() {
  try {
    const {
      accountDeletionService,
    } = require("../modules/user/accountDeletionService");
    const result = await accountDeletionService.processOverdueHardDeletes();
    if (result?.processed) {
      // eslint-disable-next-line no-console
      console.log(`[accountDeletionPurge] hard-deleted ${result.processed} accounts`);
    }
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[accountDeletionPurge] error", err);
    return { processed: 0 };
  }
}
