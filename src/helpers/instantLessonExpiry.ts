import { INSTANT_ACCEPT_WINDOW_MS } from "../config/instantLesson";

type ExpireHandler = (lessonId: string, coachId: string, traineeId: string) => Promise<void>;

let expireHandler: ExpireHandler | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function registerInstantLessonExpireHandler(handler: ExpireHandler) {
  expireHandler = handler;
}

export function clearInstantLessonAcceptExpiry(lessonId: string) {
  const key = String(lessonId);
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
    timers.delete(key);
  }
}

export function scheduleInstantLessonAcceptExpiry(
  lessonId: string,
  coachId: string,
  traineeId: string,
  requestedAt: Date = new Date()
) {
  clearInstantLessonAcceptExpiry(lessonId);
  const elapsed = Date.now() - requestedAt.getTime();
  const delay = Math.max(0, INSTANT_ACCEPT_WINDOW_MS - elapsed);
  const key = String(lessonId);
  const timer = setTimeout(() => {
    timers.delete(key);
    if (expireHandler) {
      void expireHandler(String(lessonId), String(coachId), String(traineeId));
    }
  }, delay);
  timers.set(key, timer);
}
