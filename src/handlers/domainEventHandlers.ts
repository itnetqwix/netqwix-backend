import { EVENTS } from "../config/constance";
import { log } from "../../logger";
import { invalidateBookingCaches } from "../services/cacheService";
import { registerPubSubHandler, type PubSubEnvelope } from "../services/eventPubSub";

const logger = log.getLogger();

const BOOKING_EVENTS = new Set<string>([
  EVENTS.BOOKING.CREATED,
  EVENTS.BOOKING.STATUS_UPDATED,
]);

const SESSION_INVALIDATION_PREFIXES = [
  "SESSION_EXTENSION_",
  "LESSON_TIME_",
  "LESSON_TIMER_",
  "TIMER_STARTED",
  "LESSON_STATE_SYNC",
];

function extractParticipantIds(payload: unknown): {
  trainerId?: string;
  traineeId?: string;
  bookingId?: string;
} {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  const trainerId =
    p.trainerId != null
      ? String(p.trainerId)
      : p.trainer_id != null
        ? String(p.trainer_id)
        : undefined;
  const traineeId =
    p.traineeId != null
      ? String(p.traineeId)
      : p.trainee_id != null
        ? String(p.trainee_id)
        : undefined;
  const bookingId =
    p.bookingId != null
      ? String(p.bookingId)
      : p.booking_id != null
        ? String(p.booking_id)
        : p.sessionId != null
          ? String(p.sessionId)
          : undefined;
  return { trainerId, traineeId, bookingId };
}

async function handleBookingEvent(envelope: PubSubEnvelope): Promise<void> {
  const { trainerId, traineeId, bookingId } = extractParticipantIds(envelope.payload);
  const n = await invalidateBookingCaches({ trainerId, traineeId, bookingId });
  logger.debug(
    `[PubSub] cache invalidate booking ${envelope.event} keys=${n} trainer=${trainerId ?? "-"} trainee=${traineeId ?? "-"}`
  );
}

async function handleSessionListInvalidation(envelope: PubSubEnvelope): Promise<void> {
  const { trainerId, traineeId } = extractParticipantIds(envelope.payload);
  if (!trainerId && !traineeId) return;
  const n = await invalidateBookingCaches({
    trainerId,
    traineeId,
    skipTrainerSlots: true,
  });
  logger.debug(
    `[PubSub] cache invalidate session ${envelope.event} keys=${n}`
  );
}

/**
 * Redis cache invalidation on pub/sub messages (runs on every API instance; DEL is idempotent).
 */
export function registerDomainEventHandlers(): void {
  registerPubSubHandler((envelope) => {
    void (async () => {
      try {
        if (BOOKING_EVENTS.has(envelope.event)) {
          await handleBookingEvent(envelope);
          return;
        }
        if (
          SESSION_INVALIDATION_PREFIXES.some((prefix) =>
            envelope.event.startsWith(prefix)
          )
        ) {
          await handleSessionListInvalidation(envelope);
        }
      } catch (err: any) {
        logger.warn(
          `[PubSub] domain handler ${envelope.event}: ${err?.message || err}`
        );
      }
    })();
  });
  logger.info("[PubSub] Domain event handlers registered");
}
