import { Queue, Worker } from "bullmq";
import { REDIS_ENABLED, REDIS_URL } from "../config/redis";

export type ExtensionExpiryJob = {
  sessionId: string;
  requestId: string;
  reason: string;
};

let queue: Queue<ExtensionExpiryJob> | null = null;
let worker: Worker<ExtensionExpiryJob> | null = null;

function connectionOpts() {
  return { url: REDIS_URL };
}

export function getExtensionExpiryQueue(): Queue<ExtensionExpiryJob> | null {
  if (!REDIS_ENABLED) return null;
  if (!queue) {
    queue = new Queue<ExtensionExpiryJob>("nq-extension-expiry", {
      connection: connectionOpts(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
      },
    });
  }
  return queue;
}

export async function scheduleExtensionExpiryJob(
  sessionId: string,
  requestId: string,
  reason: string,
  delayMs: number
): Promise<void> {
  const q = getExtensionExpiryQueue();
  if (!q) return;
  const jobId = `${sessionId}:${requestId}`;
  await q.add(
    "expire",
    { sessionId, requestId, reason },
    { jobId, delay: Math.max(0, delayMs) }
  );
}

export async function cancelExtensionExpiryJob(
  sessionId: string,
  requestId: string
): Promise<void> {
  const q = getExtensionExpiryQueue();
  if (!q) return;
  const jobId = `${sessionId}:${requestId}`;
  const job = await q.getJob(jobId);
  if (job) await job.remove();
}

export function startExtensionExpiryWorker(
  handler: (job: ExtensionExpiryJob) => Promise<void>
): void {
  if (!REDIS_ENABLED || worker) return;
  worker = new Worker<ExtensionExpiryJob>(
    "nq-extension-expiry",
    async (job) => {
      await handler(job.data);
    },
    { connection: connectionOpts() }
  );
  worker.on("failed", (job, err) => {
    console.warn("[extensionTimerQueue] job failed", job?.id, err?.message);
  });
}
