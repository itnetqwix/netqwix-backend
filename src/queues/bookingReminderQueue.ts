import { Queue, Worker } from "bullmq";
import { getBullmqConnection, isBullmqAvailable } from "./bullmqConnection";
import { QUEUE_BOOKING_REMINDER } from "./queueNames";
import { removeDelayedJob, upsertDelayedJob } from "./delayedJob";

export type BookingReminderKind = "15m" | "5m";

export type BookingReminderJob = {
  sessionId: string;
  kind: BookingReminderKind;
};

let queue: Queue<BookingReminderJob> | null = null;
let worker: Worker<BookingReminderJob> | null = null;

function reminderJobId(sessionId: string, kind: BookingReminderKind): string {
  return `reminder:${sessionId}:${kind}`;
}

export function getBookingReminderQueue(): Queue<BookingReminderJob> | null {
  if (!isBullmqAvailable()) return null;
  if (!queue) {
    queue = new Queue<BookingReminderJob>(QUEUE_BOOKING_REMINDER, {
      connection: getBullmqConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }
  return queue;
}

export async function scheduleBookingReminderJob(
  sessionId: string,
  kind: BookingReminderKind,
  runAt: Date
): Promise<void> {
  const q = getBookingReminderQueue();
  const delayMs = Math.max(0, runAt.getTime() - Date.now());
  if (delayMs <= 0) return;
  await upsertDelayedJob(q, "remind", { sessionId, kind }, {
    jobId: reminderJobId(sessionId, kind),
    delayMs,
  });
}

export async function cancelBookingReminderJobs(sessionId: string): Promise<void> {
  const q = getBookingReminderQueue();
  await removeDelayedJob(q, reminderJobId(sessionId, "15m"));
  await removeDelayedJob(q, reminderJobId(sessionId, "5m"));
}

export function startBookingReminderWorker(
  handler: (job: BookingReminderJob) => Promise<void>
): void {
  if (!isBullmqAvailable() || worker) return;
  worker = new Worker<BookingReminderJob>(
    QUEUE_BOOKING_REMINDER,
    async (job) => {
      await handler(job.data);
    },
    { connection: getBullmqConnection() }
  );
  worker.on("failed", (job, err) => {
    console.warn("[bookingReminderQueue] failed", job?.id, err?.message);
  });
}
