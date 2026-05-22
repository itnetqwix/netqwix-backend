import { log } from "../../logger";
import { isClusterLeader } from "../config/processRole";
import { isBullmqAvailable } from "../queues/bullmqConnection";
import {
  startExtensionExpiryWorker,
  type ExtensionExpiryJob,
} from "../services/extensionTimerQueue";
import {
  startInstantDeadlineWorker,
  type InstantDeadlineJob,
} from "../queues/instantLessonDeadlineQueue";
import {
  startBookingReminderWorker,
  type BookingReminderJob,
} from "../queues/bookingReminderQueue";
import { handleBookingReminderJob } from "../jobs/bookingReminderHandler";

const logger = log.getLogger();
let workersStarted = false;

export function bootstrapJobWorkers(): void {
  if (!isBullmqAvailable()) {
    logger.info("[Jobs] BullMQ disabled (REDIS_ENABLED=false)");
    return;
  }
  if (!isClusterLeader()) {
    logger.info("[Jobs] Workers skipped on non-leader cluster instance");
    return;
  }
  if (workersStarted) return;
  workersStarted = true;

  startExtensionExpiryWorker(async (job: ExtensionExpiryJob) => {
    const { SessionExtensionService } = await import(
      "../modules/trainee/sessionExtensionService"
    );
    const svc = new SessionExtensionService();
    await svc.expireRequest(job.sessionId, job.requestId, job.reason);
  });

  startInstantDeadlineWorker(async (job: InstantDeadlineJob) => {
    const { runInstantLessonExpire } = await import(
      "../modules/socket/socket.service"
    );
    await runInstantLessonExpire(
      job.lessonId,
      job.coachId,
      job.traineeId,
      undefined,
      job.kind
    );
  });

  startBookingReminderWorker(async (job: BookingReminderJob) => {
    await handleBookingReminderJob(job);
  });

  logger.info("[Jobs] BullMQ workers started (extension, instant-deadline, booking-reminder)");
}
