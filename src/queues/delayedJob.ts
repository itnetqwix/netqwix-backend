import type { Queue } from "bullmq";
import { isBullmqAvailable } from "./bullmqConnection";

export type DelayedJobOptions = {
  jobId: string;
  delayMs: number;
  removeOnComplete?: boolean;
  removeOnFail?: number;
};

/** Add or replace a delayed job (deduped by jobId). */
export async function upsertDelayedJob<T>(
  queue: Queue<T, unknown, string> | null,
  jobName: string,
  data: T,
  opts: DelayedJobOptions
): Promise<void> {
  if (!queue || !isBullmqAvailable()) return;
  const existing = await queue.getJob(opts.jobId);
  if (existing) await existing.remove();
  await queue.add(jobName as never, data as never, {
    jobId: opts.jobId,
    delay: Math.max(0, opts.delayMs),
    removeOnComplete: opts.removeOnComplete ?? true,
    removeOnFail: opts.removeOnFail ?? 50,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function removeDelayedJob(queue: Queue<any> | null, jobId: string): Promise<void> {
  if (!queue) return;
  const job = await queue.getJob(jobId);
  if (job) await job.remove();
}
