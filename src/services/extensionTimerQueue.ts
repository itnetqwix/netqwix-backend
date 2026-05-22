import { Queue, Worker } from "bullmq";
import { getBullmqConnection, isBullmqAvailable } from "../queues/bullmqConnection";
import { QUEUE_EXTENSION_EXPIRY } from "../queues/queueNames";

export type ExtensionExpiryJob = {
  sessionId: string;
  requestId: string;
  reason: string;
};

let queue: Queue<ExtensionExpiryJob> | null = null;
let worker: Worker<ExtensionExpiryJob> | null = null;

export function getExtensionExpiryQueue(): Queue<ExtensionExpiryJob> | null {
  if (!isBullmqAvailable()) return null;
  if (!queue) {
    queue = new Queue<ExtensionExpiryJob>(QUEUE_EXTENSION_EXPIRY, {
      connection: getBullmqConnection(),
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
  if (!isBullmqAvailable() || worker) return;
  worker = new Worker<ExtensionExpiryJob>(
    QUEUE_EXTENSION_EXPIRY,
    async (job) => {
      await handler(job.data);
    },
    { connection: getBullmqConnection() }
  );
  worker.on("failed", (job, err) => {
    console.warn("[extensionTimerQueue] job failed", job?.id, err?.message);
  });
}
