import {
  INSTANT_ACCEPT_WINDOW_MS,
  INSTANT_JOIN_AFTER_ACCEPT_MS,
} from "../config/instantLesson";
import { isBullmqAvailable } from "../queues/bullmqConnection";
import {
  cancelInstantDeadlineJobs,
  scheduleInstantDeadlineJob,
} from "../queues/instantLessonDeadlineQueue";

type ExpireHandler = (
  lessonId: string,
  coachId: string,
  traineeId: string,
  kind: "accept" | "join"
) => Promise<void>;

let expireHandler: ExpireHandler | null = null;

/** In-memory fallback when Redis/BullMQ is off (single-process dev). */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(lessonId: string, kind: "accept" | "join") {
  return `${lessonId}:${kind}`;
}

export function registerInstantLessonExpireHandler(handler: ExpireHandler) {
  expireHandler = handler;
}

function clearMemoryTimer(lessonId: string, kind: "accept" | "join") {
  const key = timerKey(lessonId, kind);
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
    timers.delete(key);
  }
}

function scheduleMemoryTimer(
  lessonId: string,
  coachId: string,
  traineeId: string,
  kind: "accept" | "join",
  deadline: Date
) {
  clearMemoryTimer(lessonId, kind);
  const delay = Math.max(0, deadline.getTime() - Date.now());
  const timer = setTimeout(() => {
    timers.delete(timerKey(lessonId, kind));
    if (expireHandler) {
      void expireHandler(String(lessonId), String(coachId), String(traineeId), kind);
    }
  }, delay);
  timers.set(timerKey(lessonId, kind), timer);
}

export function clearInstantLessonTimers(lessonId: string) {
  if (isBullmqAvailable()) {
    void cancelInstantDeadlineJobs(lessonId);
  }
  for (const kind of ["accept", "join"] as const) {
    clearMemoryTimer(lessonId, kind);
  }
}

/** @deprecated use clearInstantLessonTimers */
export function clearInstantLessonAcceptExpiry(lessonId: string) {
  clearInstantLessonTimers(lessonId);
}

export function scheduleInstantLessonAcceptExpiry(
  lessonId: string,
  coachId: string,
  traineeId: string,
  requestedAt: Date = new Date()
) {
  const deadline = new Date(requestedAt.getTime() + INSTANT_ACCEPT_WINDOW_MS);
  if (isBullmqAvailable()) {
    void scheduleInstantDeadlineJob(
      lessonId,
      coachId,
      traineeId,
      "accept",
      deadline
    );
    return;
  }
  scheduleMemoryTimer(lessonId, coachId, traineeId, "accept", deadline);
}

export function scheduleInstantLessonJoinExpiry(
  lessonId: string,
  coachId: string,
  traineeId: string,
  acceptedAt: Date = new Date()
) {
  const deadline = new Date(acceptedAt.getTime() + INSTANT_JOIN_AFTER_ACCEPT_MS);
  if (isBullmqAvailable()) {
    void scheduleInstantDeadlineJob(
      lessonId,
      coachId,
      traineeId,
      "join",
      deadline
    );
    return;
  }
  scheduleMemoryTimer(lessonId, coachId, traineeId, "join", deadline);
}

export { INSTANT_ACCEPT_WINDOW_MS, INSTANT_JOIN_AFTER_ACCEPT_MS };
