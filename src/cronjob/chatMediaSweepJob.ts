import { sweepOrphanChatMediaObjects } from "../modules/common/chatMediaPendingStore";

/** Delete chat-media S3 objects that were never committed to a message. */
export async function runChatMediaSweepJob(): Promise<void> {
  const result = await sweepOrphanChatMediaObjects(2 * 60 * 60 * 1000);
  if (result.deleted > 0 || result.errors > 0) {
    console.log(
      `[chatMediaSweepJob] deleted=${result.deleted} errors=${result.errors}`
    );
  }
}
