import {
  INSTANT_ACCEPT_WINDOW_MS,
  INSTANT_JOIN_AFTER_ACCEPT_MS,
} from "../config/instantLesson";

type ExpireHandler = (
  lessonId: string,
  coachId: string,
  traineeId: string,
  kind: "accept" | "join"
) => Promise<void>;

let expireHandler: ExpireHandler | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(lessonId: string, kind: "accept" | "join") {
  return `${lessonId}:${kind}`;
}

export function registerInstantLessonExpireHandler(handler: ExpireHandler) {
  expireHandler = handler;
}

export function clearInstantLessonTimers(lessonId: string) {
  for (const kind of ["accept", "join"] as const) {
    const key = timerKey(lessonId, kind);
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
      timers.delete(key);
    }
  }
}

/** @deprecated use clearInstantLessonTimers */
export function clearInstantLessonAcceptExpiry(lessonId: string) {
  clearInstantLessonTimers(lessonId);
}

function scheduleTimer(
  lessonId: string,
  coachId: string,
  traineeId: string,
  kind: "accept" | "join",
  deadline: Date
) {
  const key = timerKey(lessonId, kind);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, deadline.getTime() - Date.now());
  const timer = setTimeout(() => {
    timers.delete(key);
    if (expireHandler) {
      void expireHandler(String(lessonId), String(coachId), String(traineeId), kind);
    }
  }, delay);
  timers.set(key, timer);
}

export function scheduleInstantLessonAcceptExpiry(
  lessonId: string,
  coachId: string,
  traineeId: string,
  requestedAt: Date = new Date()
) {
  const deadline = new Date(requestedAt.getTime() + INSTANT_ACCEPT_WINDOW_MS);
  scheduleTimer(lessonId, coachId, traineeId, "accept", deadline);
}

export function scheduleInstantLessonJoinExpiry(
  lessonId: string,
  coachId: string,
  traineeId: string,
  acceptedAt: Date = new Date()
) {
  const deadline = new Date(acceptedAt.getTime() + INSTANT_JOIN_AFTER_ACCEPT_MS);
  scheduleTimer(lessonId, coachId, traineeId, "join", deadline);
}

export { INSTANT_ACCEPT_WINDOW_MS, INSTANT_JOIN_AFTER_ACCEPT_MS };
