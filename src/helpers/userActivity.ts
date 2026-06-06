import { log } from "../../logger";
import user_activity from "../model/user_activity.schema";
import user_presence from "../model/user_presence.schema";

// In-memory debounce: only flush presence to DB every 30s per user.
// Without this, every socket HEARTBEAT (typically every 5-10s) would
// generate an individual findOneAndUpdate round-trip to MongoDB.
const presenceDebounceMs = 30_000;
const lastPresenceFlush = new Map<string, number>();

const logger = log.getLogger();

export const UserActivityEvent = {
  LOGIN: "login",
  PROFILE_UPDATE: "profile_update",
  CLIP_CREATED: "clip_created",
  BOOKING_CREATED: "booking_created",
  BOOKING_STATUS: "booking_status",
  SESSION_COMPLETED: "session_completed",
} as const;

export async function recordUserActivity(
  userId: string | undefined | null,
  eventType: string,
  meta: Record<string, unknown> = {},
  ip?: string | null
): Promise<void> {
  if (!userId) return;
  try {
    await user_activity.create({
      user_id: userId,
      event_type: eventType,
      meta,
      ip: ip || undefined,
    });
  } catch (e) {
    logger.error("recordUserActivity failed", e);
  }
}

export async function recordUserActivityMany(
  userIds: Array<string | undefined | null>,
  eventType: string,
  meta: Record<string, unknown> = {},
  ip?: string | null
): Promise<void> {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    await recordUserActivity(key, eventType, meta, ip);
  }
}

export async function touchUserPresence(userId: string | undefined | null): Promise<void> {
  if (!userId) return;
  const key = String(userId);
  const now = Date.now();
  const last = lastPresenceFlush.get(key) ?? 0;
  if (now - last < presenceDebounceMs) return; // skip — still within debounce window
  lastPresenceFlush.set(key, now);
  try {
    await user_presence.updateOne(
      { user_id: userId },
      { $set: { last_seen_at: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    logger.error("touchUserPresence failed", e);
  }
}
