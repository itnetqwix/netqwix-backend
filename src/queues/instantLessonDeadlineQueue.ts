import { Queue, Worker } from "bullmq";
import { getBullmqConnection, isBullmqAvailable } from "./bullmqConnection";
import { QUEUE_INSTANT_DEADLINE } from "./queueNames";
import { removeDelayedJob, upsertDelayedJob } from "./delayedJob";

export type InstantDeadlineKind = "accept" | "join";

export type InstantDeadlineJob = {
  lessonId: string;
  coachId: string;
  traineeId: string;
  kind: InstantDeadlineKind;
};

let queue: Queue<InstantDeadlineJob> | null = null;
let worker: Worker<InstantDeadlineJob> | null = null;

function jobId(lessonId: string, kind: InstantDeadlineKind): string {
  return `instant:${lessonId}:${kind}`;
}

export function getInstantDeadlineQueue(): Queue<InstantDeadlineJob> | null {
  if (!isBullmqAvailable()) return null;
  if (!queue) {
    queue = new Queue<InstantDeadlineJob>(QUEUE_INSTANT_DEADLINE, {
      connection: getBullmqConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }
  return queue;
}

export async function scheduleInstantDeadlineJob(
  lessonId: string,
  coachId: string,
  traineeId: string,
  kind: InstantDeadlineKind,
  runAt: Date
): Promise<void> {
  const q = getInstantDeadlineQueue();
  const delayMs = Math.max(0, runAt.getTime() - Date.now());
  await upsertDelayedJob(q, kind, { lessonId, coachId, traineeId, kind }, {
    jobId: jobId(lessonId, kind),
    delayMs,
  });
}

export async function cancelInstantDeadlineJobs(lessonId: string): Promise<void> {
  const q = getInstantDeadlineQueue();
  await removeDelayedJob(q, jobId(lessonId, "accept"));
  await removeDelayedJob(q, jobId(lessonId, "join"));
}

export function startInstantDeadlineWorker(
  handler: (job: InstantDeadlineJob) => Promise<void>
): void {
  if (!isBullmqAvailable() || worker) return;
  worker = new Worker<InstantDeadlineJob>(
    QUEUE_INSTANT_DEADLINE,
    async (job) => {
      await handler(job.data);
    },
    { connection: getBullmqConnection() }
  );
  worker.on("failed", (job, err) => {
    console.warn("[instantDeadlineQueue] failed", job?.id, err?.message);
  });
}
