import { DateTime } from "luxon";
import { Readable } from "stream";
import { MemCache } from "../../Utils/memCache";
import {
  deleteLessonSession,
  getLessonSession,
  hydrateLessonSessionFromRedis,
  setLessonSession,
} from "./lessonTimerStore";
import { EVENTS, BOOKED_SESSIONS_STATUS } from "../../config/constance";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
import savedSession from "../../model/saved_sessions.schema";
import onlineUser from "../../model/online_user.schema";
import CallDiagnostics from "../../model/call_diagnostics.schema";
import * as webpush from "web-push";
import notification from "../../model/notifications.schema";
import user from "../../model/user.schema";
import { NotificationType } from "../../enum/notification.enum";
import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import {
  INSTANT_ACCEPT_WINDOW_MS,
  INSTANT_JOIN_AFTER_ACCEPT_MS,
  INSTANT_PHASE,
  INSTANT_REFUND_REASON,
} from "../../config/instantLesson";
import { checkTrainerBookingConflict } from "../../Utils/bookingConflict";
import {
  clearInstantLessonTimers,
  registerInstantLessonExpireHandler,
  scheduleInstantLessonAcceptExpiry,
  scheduleInstantLessonJoinExpiry,
} from "../../helpers/instantLessonExpiry";
import { refundSessionEscrow } from "../wallet/instantLessonRefundService";
import { s3, S3_BUCKET } from "../../Utils/s3Client";
import { touchUserPresence } from "../../helpers/userActivity";
import { logInstantLessonOps } from "../ops/opsInstantLogger";
import { logPrecallCheckOps, logCallQualityOps } from "../ops/opsCallLogger";
import { normalizeCallQualityStatsPayload } from "../../helpers/robustness/callQualityPayload";
import {
  addLiveNote,
  getLessonLiveStateSnapshot,
  setFocusedClip,
  updateQualitySnapshot,
} from "../session/lessonLiveStateStore";
import { persistLessonLiveStateOnEnd } from "../session/sessionSummaryService";
import { NotificationsService } from "../notifications/notificationsService";
import {
  notifySessionUser,
  shouldSkipDuplicateNotify,
  INSTANT_NOTIFICATION,
} from "../session/sessionNotificationService";
import { bindLessonCallSlotIo } from "./lessonCallSlotIo";
import {
  claimLessonCallSlot,
  releaseAllLessonCallSlotsForSession,
  releaseLessonCallSlot,
  takeoverLessonCallSlot,
} from "./lessonCallSlotStore";
import {
  bindSocketIo,
  publishSocketEventToChat,
  publishSocketEventToRoom,
  publishSocketEventToSession,
  publishSocketEventToUser,
  publishSocketEventToUsers,
  publishSocketBroadcast,
} from "./socketEmit";
import { runInstantLessonExpire as runInstantLessonExpireFn } from "../instant-lesson/instantLessonLifecycle";

export { runInstantLessonExpire } from "../instant-lesson/instantLessonLifecycle";

const pushService = new NotificationsService();
const logoPath = path.resolve(__dirname, "../../assets/netqwix_logo.png");

//NOTE -  Set VAPID details
webpush.setVapidDetails(
  "mailto:example@yourdomain.org",
  process.env.WEB_PUSH_PUBLIC_KEY,
  process.env.WEB_PUSH_PRIVATE_KEY
);

let activeUsers: Record<string, any> = {};
let ioInstance: any = null; // Store io instance for emitting events from services

/**
 * True when the user has an active Socket.IO session on this server.
 * Uses in-memory presence first, then MemCache + live socket (covers reconnect races).
 */
export function isUserOnline(userId: string): boolean {
  const uid = String(userId);
  if (activeUsers[uid]) return true;
  if (!ioInstance || !process.env.SOCKET_CONFIG) return false;
  const socketId = MemCache.getDetail(process.env.SOCKET_CONFIG, uid);
  if (!socketId) return false;
  const sock = ioInstance.sockets?.sockets?.get(String(socketId));
  return !!sock?.connected;
}

export function getActiveUserIds(): string[] {
  return Object.keys(activeUsers);
}

/** Cluster-safe peer relay (WebRTC + in-call); `peerUserId` is the Mongo user id. */
export function relayPeerByUserId(
  peerUserId: string | undefined | null,
  event: string,
  payload: unknown
): boolean {
  if (!peerUserId) return false;
  void publishSocketEventToUser(String(peerUserId), event, payload);
  return true;
}

/** Prefer session room broadcast; fall back to peer user relay (reconnect-safe). */
export function relayInCallBySessionOrPeer(
  socket: { to: (room: string) => { emit: (event: string, payload: unknown) => void } },
  payload: { sessionId?: string; userInfo?: { to_user?: string } },
  event: string
): void {
  const sessionId = payload?.sessionId;
  if (sessionId && mongoose.isValidObjectId(sessionId)) {
    socket.to(`session:${sessionId}`).emit(event, payload);
    return;
  }
  relayPeerByUserId(payload?.userInfo?.to_user, event, payload);
}

function broadcastUserStatus(userId: string, status: "online" | "offline") {
  const payload = {
    user: activeUsers,
    status,
    userId: String(userId),
  };
  void publishSocketBroadcast("userStatus", payload);
  void publishSocketBroadcast("onlineUser", payload);
}

export async function removeUserFromActivePresence(userId: string) {
  const uid = String(userId);
  const wasInMemory = !!activeUsers[uid];
  const wasTrainer =
    wasInMemory &&
    String(activeUsers[uid]?.account_type || "").trim().toLowerCase() === "trainer";

  if (wasInMemory) {
    delete activeUsers[uid];
  }

  user.findByIdAndUpdate(uid, { lastSeen: new Date() }).catch(() => {});

  // Always clear DB row for trainers so `/user/all-online-user` does not show stale coaches.
  let trainerRole = wasTrainer;
  if (!wasInMemory) {
    try {
      const doc = await user.findById(uid).select("account_type").lean();
      trainerRole =
        String((doc as any)?.account_type || "").trim().toLowerCase() === "trainer";
    } catch {
      trainerRole = false;
    }
  }
  if (trainerRole) {
    try {
      await onlineUser.deleteOne({ trainer_id: uid });
    } catch (error) {
      console.error("Error removing trainer from online_user:", error);
    }
  }

  if (wasInMemory) {
    broadcastUserStatus(uid, "offline");
  }
}

export async function applyAvailabilityForConnectedUser(userId: string) {
  const uid = String(userId);
  if (!ioInstance) return;

  const sid = MemCache.getDetail(process.env.SOCKET_CONFIG, uid);
  if (!sid) return;

  const socket = ioInstance.sockets?.sockets?.get(String(sid));
  if (!socket) return;

  const userDoc = await user.findById(uid).select("showAsOnline account_type").lean();
  if ((userDoc as any)?.showAsOnline === false) {
    await removeUserFromActivePresence(uid);
    return;
  }

  await updateUserActivity(socket);
}
/** Set once `emitBookingStatusUpdated` is defined (handlers above need a late binding). */
let emitBookingStatusUpdatedDelegate: ((bookingData: any) => Promise<void>) | null = null;

// Set the io instance (called from socket init)
export const getIo = () => ioInstance;

export const setIoInstance = (io: any) => {
  ioInstance = io;
  bindSocketIo(io);
  bindLessonCallSlotIo(() => ioInstance);
  
  // Start periodic heartbeat check to detect stale connections
  setInterval(() => {
    const now = Date.now();
    const staleSockets: string[] = [];
    
    socketHeartbeats.forEach((lastHeartbeat, socketId) => {
      if (now - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        staleSockets.push(socketId);
      }
    });
    
    // Clean up stale sockets and notify peers if needed
    staleSockets.forEach((socketId) => {
      socketHeartbeats.delete(socketId);
      const staleSocket = io.sockets.sockets.get(socketId);
      if (staleSocket) {
        const staleUserId = socketAttachedUserId(staleSocket);
        // Notify peers in the same room that this socket is stale
        staleSocket.rooms.forEach((roomName) => {
          if (roomName.startsWith("session:")) {
            const sessionId = roomName.replace("session:", "");
            if (staleUserId) {
              void releaseLessonCallSlot({
                sessionId,
                userId: String(staleUserId),
                socketId,
              });
            }
            staleSocket.to(roomName).emit("PARTICIPANT_STALE", {
              socketId,
              timestamp: now,
            });
          }
        });
      }
    });
  }, 10000); // Check every 10 seconds
};

/** Snapshot describing a paid extension request currently in flight. Pushed
 *  through `LESSON_STATE_SYNC` so a reconnecting client can rebuild its UI. */
export type PendingExtensionRequestSnapshot = {
  requestId: string;
  status: "pending" | "accepted";
  minutes: number;
  amount: number;
  requestedAt: string;
  expiresAt: string | null;
  requestedBy: string;
};

// Lesson session state tracking - backend is authoritative for timer start
export type LessonSessionState = {
  sessionId: string; // booked_session._id
  coachJoined: boolean;
  userJoined: boolean;
  startedAt: number | null; // unix timestamp (ms) - authoritative backend time
  duration: number; // in seconds, calculated from session_start_time and session_end_time
  remainingSeconds: number; // canonical remaining time in seconds
  status: "waiting" | "running" | "paused" | "ended";
  trainerLeftPaused?: boolean; // true when timer was auto-paused because trainer disconnected
  /** @deprecated use warningTimeoutIds */
  warningTimeoutId?: NodeJS.Timeout | null;
  warningTimeoutIds?: NodeJS.Timeout[];
  endTimeoutId?: NodeJS.Timeout | null;
  isInstant?: boolean;
  coachFirstJoinedAt?: number | null;
  userFirstJoinedAt?: number | null;
  /** Human-readable reason for the current pause (e.g. "extension_pending",
   *  "extension_accepted", "trainer_manual", "trainer_left"). */
  pauseReason?: string | null;
  /** Pre-pause status — used by `resumeLessonTimer` to know if the timer was
   *  running or already in the grace window before the extension pause. */
  preExtensionPauseStatus?: "running" | "paused" | "ended" | null;
  pendingExtensionRequest?: PendingExtensionRequestSnapshot | null;
};

const TRAINEE_LATE_AUTO_START_MS = 120_000;

/** @deprecated Use getLessonSession / setLessonSession — backed by lessonTimerStore + Redis. */
export function lessonSessionsGet(sessionId: string): LessonSessionState | undefined {
  return getLessonSession(sessionId) as LessonSessionState | undefined;
}
export function lessonSessionsSet(sessionId: string, session: LessonSessionState): void {
  setLessonSession(sessionId, session as any);
}
function lessonSessionsDelete(sessionId: string): void {
  deleteLessonSession(sessionId);
}

/** Brief disconnects (e.g. ERR_NETWORK_CHANGED → reconnect) must not pause the lesson or emit PARTICIPANT_LEFT. */
/** Rural LTE / subway handoffs — longer grace before PARTICIPANT_LEFT + timer pause. */
const SESSION_LEAVE_GRACE_MS = 45000;
const pendingLessonDisconnectTimers = new Map<string, NodeJS.Timeout>();

export function cancelLessonDisconnectGrace(sessionId: string, userId: string) {
  const key = `${String(sessionId)}:${String(userId)}`;
  const t = pendingLessonDisconnectTimers.get(key);
  if (t) {
    clearTimeout(t);
    pendingLessonDisconnectTimers.delete(key);
  }
}

export function lessonRoomEmit(roomName: string, event: string, payload: unknown) {
  const sessionMatch = /^session:(.+)$/.exec(roomName);
  if (sessionMatch) {
    void publishSocketEventToSession(sessionMatch[1], event, payload);
  } else {
    void publishSocketEventToRoom(roomName, event, payload);
  }
}

export function startLessonTimerInRoom(
  socket: any,
  roomName: string,
  session: LessonSessionState,
  reason: string
) {
  if (session.status === "running") return;
  if (!session.coachJoined || !session.userJoined) return;

  const now = Date.now();
  session.startedAt = now;
  session.status = "running";

  const timerPayload = {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    duration: session.duration,
    remainingSeconds: session.remainingSeconds,
    reason,
  };

  lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.STARTED, timerPayload);
  emitLessonStateSync(socket, roomName, session);
  scheduleLessonEnd(socket, roomName, session);
  console.log(
    `[TIMER] Auto-started session ${session.sessionId} (${reason}), remaining ${session.remainingSeconds}s`
  );
}

export function maybeAutoStartLessonTimer(socket: any, roomName: string, session: LessonSessionState) {
  if (session.status !== "waiting") return;
  if (!session.coachJoined || !session.userJoined) return;

  if (session.isInstant) {
    startLessonTimerInRoom(socket, roomName, session, "instant_both_joined");
    return;
  }

  const coachAt = session.coachFirstJoinedAt;
  const userAt = session.userFirstJoinedAt;
  if (coachAt != null && userAt != null && userAt - coachAt >= TRAINEE_LATE_AUTO_START_MS) {
    startLessonTimerInRoom(socket, roomName, session, "scheduled_trainee_late");
  }
}

function finalizeLessonParticipantDisconnect(
  sessionId: string,
  roomName: string,
  role: "trainer" | "trainee",
  disconnectedUserId: string,
) {
  const session = lessonSessionsGet(sessionId);
  if (!session) return;

  if (role === "trainer") {
    if (!session.coachJoined) return;
    session.coachJoined = false;
    console.log(`[SESSION] Trainer ${disconnectedUserId} confirmed leave after grace for session ${sessionId}`);

    if (session.status === "running" && session.startedAt != null) {
      const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
      session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsedSeconds);
      session.startedAt = null;
      session.status = "paused";
      session.trainerLeftPaused = true;
      clearLessonTimeouts(session);

      const pausedPayload = {
        sessionId: session.sessionId,
        remainingSeconds: session.remainingSeconds,
        duration: session.duration,
        reason: "trainer_left",
      };
      lessonRoomEmit(roomName, "LESSON_TIME_PAUSED", pausedPayload);
      const statePayload = {
        sessionId: session.sessionId,
        status: session.status,
        startedAt: session.startedAt,
        duration: session.duration,
        remainingSeconds: session.remainingSeconds,
        trainerConnected: session.coachJoined,
        traineeConnected: session.userJoined,
      };
      lessonRoomEmit(roomName, "LESSON_STATE_SYNC", statePayload);
    }

    lessonRoomEmit(roomName, "PARTICIPANT_STATUS_CHANGED", {
      sessionId,
      role: "trainer",
      status: "disconnected",
      userId: disconnectedUserId,
    });
    lessonRoomEmit(roomName, EVENTS.VIDEO_CALL.ON_CALL_LEAVE, {
      userId: disconnectedUserId,
      accountType: "Trainer",
      sessionId,
      timestamp: Date.now(),
    });
    lessonRoomEmit(roomName, "PARTICIPANT_LEFT", {
      sessionId,
      role: "trainer",
      userId: disconnectedUserId,
    });
    return;
  }

  if (!session.userJoined) return;
  session.userJoined = false;
  console.log(`[SESSION] Trainee ${disconnectedUserId} confirmed leave after grace for session ${sessionId}`);

  lessonRoomEmit(roomName, "PARTICIPANT_STATUS_CHANGED", {
    sessionId,
    role: "trainee",
    status: "disconnected",
    userId: disconnectedUserId,
  });
  lessonRoomEmit(roomName, EVENTS.VIDEO_CALL.ON_CALL_LEAVE, {
    userId: disconnectedUserId,
    accountType: "Trainee",
    sessionId,
    timestamp: Date.now(),
  });
  lessonRoomEmit(roomName, "PARTICIPANT_LEFT", {
    sessionId,
    role: "trainee",
    userId: disconnectedUserId,
  });
}

export const emitLessonStateSync = (socket: any, roomName: string, session: LessonSessionState) => {
  const liveState = getLessonLiveStateSnapshot(session.sessionId, "trainer");
  const statePayload = {
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    duration: session.duration,
    remainingSeconds: session.remainingSeconds,
    trainerConnected: session.coachJoined,
    traineeConnected: session.userJoined,
    pauseReason: session.pauseReason ?? null,
    pendingExtensionRequest: session.pendingExtensionRequest ?? null,
    liveState,
  };

  lessonRoomEmit(roomName, "LESSON_STATE_SYNC", statePayload);
};

async function finalizeLessonEnd(sessionId: string): Promise<void> {
  try {
    await persistLessonLiveStateOnEnd(sessionId);
    const expectedBy = new Date(Date.now() + 30 * 60 * 1000);
    await booked_session
      .updateOne(
        { _id: sessionId },
        { $set: { game_plan_expected_at: expectedBy } }
      )
      .catch(() => undefined);
  } catch (err) {
    console.warn("[LessonLiveState] persist on end failed", err);
  }
}

export const clearLessonTimeouts = (session: LessonSessionState) => {
  if (session.warningTimeoutId) clearTimeout(session.warningTimeoutId);
  session.warningTimeoutId = null;
  if (session.warningTimeoutIds?.length) {
    for (const t of session.warningTimeoutIds) clearTimeout(t);
  }
  session.warningTimeoutIds = [];
  if (session.endTimeoutId) clearTimeout(session.endTimeoutId);
  session.endTimeoutId = null;
};

type LessonWarningKind = "five" | "two" | "one" | "thirty";

const LESSON_WARNING_SCHEDULE: { kind: LessonWarningKind; atSeconds: number }[] = [
  { kind: "five", atSeconds: 300 },
  { kind: "two", atSeconds: 120 },
  { kind: "one", atSeconds: 60 },
  { kind: "thirty", atSeconds: 30 },
];

const scheduleLessonWarnings = (
  roomName: string,
  session: LessonSessionState
) => {
  session.warningTimeoutIds = [];
  const remainingMs = Math.max(0, session.remainingSeconds) * 1000;
  for (const entry of LESSON_WARNING_SCHEDULE) {
    const fireIn = remainingMs - entry.atSeconds * 1000;
    if (fireIn <= 0) continue;
    const tid = setTimeout(() => {
      if (session.status !== "running" && session.status !== "paused") return;
      lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.WARNING, {
        sessionId: session.sessionId,
        kind: entry.kind,
        remainingSeconds: entry.atSeconds,
      });
    }, fireIn);
    session.warningTimeoutIds.push(tid);
  }
};

export function getLessonTimerSnapshot(sessionId: string): {
  remainingSeconds: number;
  status: string;
  duration: number;
} | null {
  const session = lessonSessionsGet(String(sessionId));
  if (!session) return null;

  if (session.status === "running" && session.startedAt != null) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    return {
      remainingSeconds: Math.max(0, session.remainingSeconds - elapsed),
      status: session.status,
      duration: session.duration,
    };
  }

  return {
    remainingSeconds: session.remainingSeconds,
    status: session.status,
    duration: session.duration,
  };
}

/** Add paid extension time and notify everyone in the lesson room. */
export function extendLessonTimer(
  sessionId: string,
  addedMinutes: number,
  meta?: { extensionId?: string; endTimeUtc?: string }
) {
  if (!ioInstance) return;

  const addedSeconds = addedMinutes * 60;
  const sid = String(sessionId);
  const roomName = `session:${sid}`;
  let session = lessonSessionsGet(sid);

  if (!session) {
    session = {
      sessionId: sid,
      coachJoined: true,
      userJoined: true,
      startedAt: Date.now(),
      duration: addedSeconds,
      remainingSeconds: addedSeconds,
      status: "running",
    };
    lessonSessionsSet(sid, session);
  } else {
    if (session.status === "running" && session.startedAt != null) {
      const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
      session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsed);
      session.startedAt = Date.now();
    }
    session.duration += addedSeconds;
    session.remainingSeconds += addedSeconds;
    if (session.status === "ended" || session.status === "paused") {
      session.status = "running";
      if (session.startedAt == null) session.startedAt = Date.now();
      session.trainerLeftPaused = false;
    }
  }

  /** Clearing any in-flight extension state so the post-extend `LESSON_STATE_SYNC`
   *  doesn't keep the trainee modal stuck in "awaiting trainer". */
  session.pauseReason = null;
  session.preExtensionPauseStatus = null;
  session.pendingExtensionRequest = null;

  clearLessonTimeouts(session);

  const extendedPayload = {
    sessionId: sid,
    addedSeconds,
    remainingSeconds: session.remainingSeconds,
    duration: session.duration,
    endTimeUtc: meta?.endTimeUtc,
    extensionId: meta?.extensionId,
  };
  lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.EXTENDED, extendedPayload);

  const timerPayload = {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    duration: session.duration,
    remainingSeconds: session.remainingSeconds,
  };
  lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.STARTED, timerPayload);

  const stubSocket = { nsp: ioInstance?.to(roomName) };
  emitLessonStateSync(stubSocket, roomName, session);

  scheduleLessonEnd(stubSocket, roomName, session);
}

/** Pause the lesson timer with a typed reason. Used by the paid-extension flow
 *  while the trainee is awaiting trainer approval or completing payment so the
 *  remaining time doesn't tick down during the modal interactions.
 *
 *  Idempotent: calling on an already-paused session updates the pauseReason but
 *  preserves remainingSeconds. Note: when the timer was already paused because
 *  the trainer disconnected we still flip the reason for UI feedback but
 *  `trainerLeftPaused` stays true so the trainer-rejoin auto-resume path wins
 *  over a later extension resume. */
export function pauseLessonTimer(sessionId: string, reason: string) {
  if (!ioInstance) return false;
  const sid = String(sessionId);
  const session = lessonSessionsGet(sid);
  if (!session) return false;
  if (session.status === "ended") return false;

  const roomName = `session:${sid}`;

  if (session.status === "running" && session.startedAt != null) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsed);
    session.preExtensionPauseStatus = "running";
  } else if (session.status === "paused") {
    session.preExtensionPauseStatus = session.preExtensionPauseStatus ?? "paused";
  }

  session.startedAt = null;
  session.status = "paused";
  session.pauseReason = reason;
  clearLessonTimeouts(session);

  const pausedPayload = {
    sessionId: session.sessionId,
    remainingSeconds: session.remainingSeconds,
    duration: session.duration,
    reason,
  };
  lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.PAUSED, pausedPayload);
  const stubSocket = { nsp: ioInstance?.to(roomName) };
  emitLessonStateSync(stubSocket, roomName, session);
  return true;
}

/** Resume a timer that was previously paused via `pauseLessonTimer`.
 *  Restores the prior running/ended state. If the timer had already hit 0 the
 *  session is ended instead of resumed. */
export function resumeLessonTimer(sessionId: string, reason: string) {
  if (!ioInstance) return false;
  const sid = String(sessionId);
  const session = lessonSessionsGet(sid);
  if (!session) return false;
  if (session.status !== "paused") return false;
  if (session.trainerLeftPaused) {
    // Don't fight the trainer-left auto-pause; the trainer's rejoin handler resumes it.
    return false;
  }

  const roomName = `session:${sid}`;
  const wasEnded = session.preExtensionPauseStatus === "ended" || session.remainingSeconds <= 0;
  session.pauseReason = null;
  session.preExtensionPauseStatus = null;

  if (wasEnded) {
    session.remainingSeconds = 0;
    session.status = "ended";
    const endedPayload = {
      sessionId: session.sessionId,
      endedAt: new Date().toISOString(),
      reason,
    };
    lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.ENDED, endedPayload);
    const stubSocket = { nsp: ioInstance?.to(roomName) };
    emitLessonStateSync(stubSocket, roomName, session);
    void finalizeLessonEnd(sid);
    lessonSessionsDelete(sid);
    return true;
  }

  session.startedAt = Date.now();
  session.status = "running";
  const resumedPayload = {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    duration: session.duration,
    remainingSeconds: session.remainingSeconds,
    reason,
  };
  lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.RESUMED, resumedPayload);
  const stubSocket = { nsp: ioInstance?.to(roomName) };
  emitLessonStateSync(stubSocket, roomName, session);
  scheduleLessonEnd(stubSocket, roomName, session);
  return true;
}

/** Attach (or detach with `null`) the snapshot describing the live extension
 *  request. Pushed in the next `LESSON_STATE_SYNC` so reconnecting clients can
 *  rebuild their UI without a separate REST call. */
export function setPendingExtensionRequest(
  sessionId: string,
  snapshot: PendingExtensionRequestSnapshot | null
) {
  if (!ioInstance) return;
  const sid = String(sessionId);
  const session = lessonSessionsGet(sid);
  if (!session) return;
  session.pendingExtensionRequest = snapshot;
  const roomName = `session:${sid}`;
  const stubSocket = { nsp: ioInstance?.to(roomName) };
  emitLessonStateSync(stubSocket, roomName, session);
}

/** Broadcast helper for the extension lifecycle. */
export function broadcastSessionExtensionEvent(
  sessionId: string,
  event: string,
  payload: Record<string, unknown>
) {
  const sid = String(sessionId);
  void publishSocketEventToSession(sid, event, { sessionId: sid, ...payload });
}

export const scheduleLessonEnd = (socket: any, roomName: string, session: LessonSessionState) => {
  clearLessonTimeouts(session);

  const remainingMs = Math.max(0, session.remainingSeconds) * 1000;
  if (remainingMs <= 0) {
    session.status = "ended";
    const endedPayload = {
      sessionId: session.sessionId,
      endedAt: new Date().toISOString(),
    };
    lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.ENDED, endedPayload);
    emitLessonStateSync(socket, roomName, session);
    void finalizeLessonEnd(session.sessionId);
    void releaseAllLessonCallSlotsForSession(session.sessionId);
    lessonSessionsDelete(session.sessionId);
    return;
  }

  scheduleLessonWarnings(roomName, session);

  session.endTimeoutId = setTimeout(() => {
    session.remainingSeconds = 0;
    session.startedAt = null;
    session.status = "ended";
    const endedPayload = {
      sessionId: session.sessionId,
      endedAt: new Date().toISOString(),
    };
    lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.ENDED, endedPayload);
    emitLessonStateSync(socket, roomName, session);
    void finalizeLessonEnd(session.sessionId);
    void releaseAllLessonCallSlotsForSession(session.sessionId);
    lessonSessionsDelete(session.sessionId);
  }, remainingMs);
};

/**
 * End a live lesson before the booked window ends — shortens the booking slot
 * so trainer and trainee become available for new sessions immediately.
 * Idempotent: safe if both parties emit LESSON_END_EARLY_REQUEST.
 */
export async function endLessonEarly(
  sessionId: string,
  options?: { reason?: string }
): Promise<boolean> {
  if (!ioInstance) return false;
  const sid = String(sessionId);
  if (!sid || !mongoose.isValidObjectId(sid)) return false;

  const existing = await booked_session
    .findById(sid)
    .select(
      "actual_end_at end_time is_instant time_zone session_end_time extended_session_end_time"
    )
    .lean();
  if (!existing) return false;
  if (existing.actual_end_at) return true;

  const now = new Date();
  const roomName = `session:${sid}`;
  const tz = String((existing as any).time_zone ?? "UTC");
  const endHm = DateTime.fromJSDate(now, { zone: tz }).toFormat("HH:mm");

  const updateFields: Record<string, unknown> = {
    actual_end_at: now,
    end_time: now,
  };
  if ((existing as any).session_end_time) {
    updateFields.session_end_time = endHm;
  }
  if ((existing as any).extended_session_end_time) {
    updateFields.extended_session_end_time = endHm;
  }
  if (existing.is_instant) {
    updateFields.instant_phase = INSTANT_PHASE.COMPLETED;
  }

  const updated = await booked_session.updateOne(
    { _id: sid, actual_end_at: null },
    { $set: updateFields }
  );
  if (updated.matchedCount === 0) return true;

  await hydrateLessonSessionFromRedis(sid);
  const session = lessonSessionsGet(sid);
  const stubSocket = { nsp: ioInstance?.to(roomName) };

  if (session) {
    clearLessonTimeouts(session);
    if (session.status === "running" && session.startedAt != null) {
      const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
      session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsed);
    }
    session.startedAt = null;
    session.remainingSeconds = 0;
    session.status = "ended";
  }

  const endedPayload = {
    sessionId: sid,
    endedAt: now.toISOString(),
    endedEarly: true,
    reason: options?.reason ?? "participant_hangup",
  };
  lessonRoomEmit(roomName, EVENTS.LESSON_TIMER.ENDED, endedPayload);
  if (session) {
    emitLessonStateSync(stubSocket, roomName, session);
    lessonSessionsDelete(sid);
  }

  void finalizeLessonEnd(sid);
  void releaseAllLessonCallSlotsForSession(sid);
  return true;
}

/** Socket user may be a Mongoose document or plain object — avoid relying on `_doc`. */
export function socketAttachedUserId(socket: any): string {
  const u = socket?.user;
  if (!u) return "";
  const id = u._id ?? u._doc?._id;
  return id != null ? String(id) : "";
}

/** While connected, refresh `online_user.last_activity_time` so the 2h cron does not drop live trainers. */
const lastTrainerOnlineUserPing = new Map<string, number>();
const TRAINER_ONLINE_USER_PING_MS = 60_000;

// Update user's activity status
async function updateUserActivity(socket) {
  try {
    const userId = socketAttachedUserId(socket);
    if (!userId) return;

    const userDoc = await user
      .findById(userId)
      .select("-password -subscriptionId")
      .lean();
    if (!userDoc) return;

    const role = String((userDoc as any).account_type || "").trim().toLowerCase();
    const showAsOnline = (userDoc as any)?.showAsOnline !== false;

    if (role === "trainer") {
      if (!showAsOnline) {
        delete activeUsers[userId];
        return;
      }
      activeUsers[userId] = { ...(userDoc as any) };
      const trainerId = String((userDoc as any)._id);
      await onlineUser.updateOne(
        { trainer_id: trainerId },
        { $set: { last_activity_time: new Date() } },
        { upsert: true }
      );
      void touchUserPresence(trainerId);
    } else if (role === "trainee") {
      activeUsers[userId] = { ...(userDoc as any) };
      void touchUserPresence(userId);
    } else {
      return;
    }

    // Broadcast the updated active users list to all connected clients
    socket.broadcast.emit("userStatus", {
      user: activeUsers,
      status: "online",
      userId,
    });

    socket.emit("onlineUser", {
      user: activeUsers,
      status: "online",
      userId,
    });

    // Listen for any event to update the user's last activity time
    socket.on("userInteraction", () => {
      if (activeUsers[userId]) {
        activeUsers[userId].lastActivityTime = Date.now();
      }
    });
  } catch (error) {
    console.error("Error for online Users", error)
  }

}

// Track heartbeat timestamps per socket for presence detection
const socketHeartbeats: Map<string, number> = new Map();
const HEARTBEAT_TIMEOUT_MS = 30000;

export const handleSocketEvents = (socket, connections = {}) => {
  const socketId = socket.id;
  const presenceUserId = socketAttachedUserId(socket);

  // Initialize heartbeat tracking for this socket
  socketHeartbeats.set(socketId, Date.now());

  if (presenceUserId) {
    socket.on("disconnect", async () => {
      await removeUserFromActivePresence(presenceUserId);
    });
  }

  // Cleanup heartbeat tracking on disconnect
  socket.on("disconnect", () => {
    socketHeartbeats.delete(socketId);
    
    const accountTypeRaw =
      socket?.user?._doc?.account_type || socket?.user?.account_type;
    const userId = socketAttachedUserId(socket);
    if (!userId) return;

    socket.rooms.forEach((roomName) => {
      if (!roomName.startsWith("session:")) return;
      const sessionId = roomName.replace("session:", "");
      void releaseLessonCallSlot({
        sessionId,
        userId: String(userId),
        socketId,
      });
      const session = lessonSessionsGet(sessionId);
      if (!session) return;

      const role =
        String(accountTypeRaw || "").trim().toLowerCase() === "trainer"
          ? "trainer"
          : "trainee";
      const key = `${sessionId}:${String(userId)}`;
      const existing = pendingLessonDisconnectTimers.get(key);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        pendingLessonDisconnectTimers.delete(key);
        finalizeLessonParticipantDisconnect(
          sessionId,
          roomName,
          role,
          String(userId),
        );
      }, SESSION_LEAVE_GRACE_MS);
      pendingLessonDisconnectTimers.set(key, timer);

      console.log(
        `[SESSION] Socket disconnect in ${roomName} — deferring leave notification ${SESSION_LEAVE_GRACE_MS}ms (user ${userId}, ${role})`,
      );
    });
  });

  // Heartbeat handler: clients send this periodically to prove they're alive
  socket.on("HEARTBEAT", () => {
    socketHeartbeats.set(socketId, Date.now());
    const uid = socketAttachedUserId(socket);
    if (uid) void touchUserPresence(uid);
    if (uid && !activeUsers[uid]) {
      void updateUserActivity(socket);
    }
    const au = activeUsers[uid];
    if (au && String(au.account_type || "").trim().toLowerCase() === "trainer") {
      const now = Date.now();
      const last = lastTrainerOnlineUserPing.get(uid) || 0;
      if (now - last >= TRAINER_ONLINE_USER_PING_MS) {
        lastTrainerOnlineUserPing.set(uid, now);
        void onlineUser
          .updateOne({ trainer_id: uid }, { $set: { last_activity_time: new Date() } })
          .catch(() => undefined);
      }
    }
  });

  socket.on(EVENTS.JOIN_ROOM, async (socketReq, request) => {
    const { roomName } = socketReq;
    handleRoomJoinEvent(roomName);
  });

  // Step 1 diagnostics: collect client environment info for calls.
  // This helps us understand real-world browser / device / network mix
  // before we change core call behavior.
  socket.on("CLIENT_CALL_DIAGNOSTICS", async (payload) => {
    try {
      const userId = socket?.user?._doc?._id || socket?.user?._id;
      const accountType =
        socket?.user?._doc?.account_type || socket?.user?.account_type;

      const { sessionId, role, env } = payload || {};

      console.log("[CallDiagnostics] Client diagnostics received:", {
        userId,
        accountType,
        sessionId,
        role,
        env,
      });

      // Save to database for analytics
      if (sessionId && userId) {
        try {
          await CallDiagnostics.create({
            sessionId,
            userId,
            accountType,
            role,
            eventType: "CLIENT_CALL_DIAGNOSTICS",
            env,
          });
        } catch (dbErr) {
          console.error("[CallDiagnostics] Failed to save to DB:", dbErr);
        }
      }
    } catch (err) {
      console.error(
        "[CallDiagnostics] Failed to process CLIENT_CALL_DIAGNOSTICS:",
        err
      );
    }
  });

  // Pre-call compatibility & environment result logging.
  // This captures why a user could or could not proceed to a call.
  socket.on("CLIENT_PRECALL_CHECK", async (payload) => {
    try {
      const userId = socket?.user?._doc?._id || socket?.user?._id;
      const accountType =
        socket?.user?._doc?.account_type || socket?.user?.account_type;

      const { sessionId, role, passed, reason } = payload || {};

      console.log("[PreCallCheck] Result:", {
        userId,
        accountType,
        sessionId,
        role,
        passed,
        reason,
      });

      // Save to database for analytics
      if (sessionId && userId) {
        try {
          await CallDiagnostics.create({
            sessionId,
            userId,
            accountType,
            role,
            eventType: "CLIENT_PRECALL_CHECK",
            preflightCheck: {
              passed,
              reason,
            },
          });
          logPrecallCheckOps({
            sessionId: String(sessionId),
            userId: String(userId),
            passed,
            reason,
            role,
            accountType,
          });
        } catch (dbErr) {
          console.error("[PreCallCheck] Failed to save to DB:", dbErr);
        }
      }
    } catch (err) {
      console.error(
        "[PreCallCheck] Failed to process CLIENT_PRECALL_CHECK:",
        err
      );
    }
  });

  socket.on("CALL_QUALITY_STATS", async (payload) => {
    try {
      const userId = socket?.user?._doc?._id || socket?.user?._id;
      const accountType =
        socket?.user?._doc?.account_type || socket?.user?.account_type;
      const { role } = payload || {};
      const { ingestCallQualityStats } = require("../session/callQualityIngestService");
      const normalized = normalizeCallQualityStatsPayload(payload);
      const sessionId = String(
        (payload as { sessionId?: string })?.sessionId ?? normalized?.sessionId ?? ""
      ).trim();
      if (!sessionId) return;
      await ingestCallQualityStats({
        payload,
        userId: userId ? String(userId) : undefined,
        accountType,
        role,
        emitToRoom: (event, data) => lessonRoomEmit(`session:${sessionId}`, event, data),
      });
    } catch (err) {
      console.error("[CallQuality] Failed to process CALL_QUALITY_STATS:", err);
    }
  });

  const { registerWebrtcRelayHandlers } = require("./handlers/webrtcRelayHandlers");
  registerWebrtcRelayHandlers(socket);

  const { registerLessonTimerSocketHandlers } = require("./handlers/lessonTimerSocketHandlers");
  registerLessonTimerSocketHandlers(socket);

  // Listen for userActivity event
  // socket.on('userActivity', (data) => {
  updateUserActivity(socket);
  // });

  const handleRoomJoinEvent = (roomName: string) => {
    // const peerConnection = new RTCPeerConnection();
  };

  const { registerInCallMediaSyncHandlers } = require("./handlers/inCallMediaSyncHandlers");
  registerInCallMediaSyncHandlers(socket);
  listenNotificationEvents(socket);
  listenInstantLessonEvents(socket);
  listenBookingEvents(socket);
  const { registerChatSocketHandlers } = require("./handlers/chatHandlers");
  registerChatSocketHandlers(socket);
};

const listenNotificationEvents = (socket) => {
  try {
    socket.on(EVENTS.PUSH_NOTIFICATIONS.ON_SEND, async (payload: any) => {
      const { title, description, senderId, receiverId, bookingInfo, type } = payload;
      const bookingId =
        bookingInfo?.bookingId ?? bookingInfo?.lessonId ?? bookingInfo?._id ?? "";
      if (
        receiverId &&
        title &&
        (await shouldSkipDuplicateNotify(
          String(receiverId),
          `client_send:${title}`,
          String(bookingId),
          title
        ))
      ) {
        return;
      }
      const sender = await user.findById(senderId);
      const receiver = await user.findById(receiverId);
      const newNotifications = await notification.create({
        title,
        description,
        senderId,
        receiverId,
        type: type ?? NotificationType.DEFAULT
      });
      // console.log(sender, 'sender')
      // console.log(receiver, 'receiver')
      // console.log(newNotifications, 'newNotifications')
      const subscription = JSON.parse(receiver?.subscriptionId);
      // console.log(subscription, 'subscription')
      void publishSocketEventToUser(receiverId, EVENTS.PUSH_NOTIFICATIONS.ON_RECEIVE, {
        _id: newNotifications?._id,
        title: newNotifications?.title,
        description: newNotifications?.description,
        createdAt: newNotifications?.createdAt,
        isRead: newNotifications?.isRead,
        sender: {
          _id: sender?._id,
          name: sender?.fullname,
          profile_picture: sender?.profile_picture || null,
        },
        bookingInfo,
      });
      if (subscription) {
        try {
          await webpush.sendNotification(
            subscription,
            JSON.stringify({ title, description })
          );
        } catch (error) {
          console.error("Error sending push notification:", error);
        }
      }

      if (receiverId && !isUserOnline(String(receiverId))) {
        void pushService.sendPushNotification(
          receiverId,
          title || "NetQwix",
          description || "You have a new notification",
          { kind: "notification", bookingInfo }
        );
      }
    });
  } catch (err) {
    console.error(`Error while listening to notification event:`, err);
    throw err;
  }
};

registerInstantLessonExpireHandler((lessonId, coachId, traineeId, kind) =>
  runInstantLessonExpireFn(lessonId, coachId, traineeId, undefined, kind)
);

// Instant Lesson Event Handlers
const listenInstantLessonEvents = (socket) => {
  try {
    // Handle instant lesson request
    socket.on(EVENTS.INSTANT_LESSON.REQUEST, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId, traineeInfo, duration, expiresAt, lessonType } = payload;
        
        // Validate required fields
        if (!lessonId || !coachId || !traineeId) {
          return;
        }

        let resolvedExpiresAt = expiresAt;
        const booking = await booked_session.findById(lessonId).lean();
        const requestedAt = booking?.createdAt
          ? new Date(booking.createdAt)
          : booking?.booked_date
            ? new Date(booking.booked_date)
            : new Date();
        if (!resolvedExpiresAt) {
          resolvedExpiresAt = new Date(
            requestedAt.getTime() + INSTANT_ACCEPT_WINDOW_MS
          ).toISOString();
        }
        scheduleInstantLessonAcceptExpiry(lessonId, coachId, traineeId, requestedAt);

        const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.REQUEST, {
            lessonId,
            coachId,
            traineeId,
            traineeInfo,
            duration,
            expiresAt: resolvedExpiresAt,
            lessonType,
          });
        } else {
          void pushService.sendPushNotification(
            coachId,
            "Instant Lesson Request",
            `${traineeInfo?.fullname || "A trainee"} wants to start a ${duration || 30}-min lesson now!`,
            { kind: "instant_lesson_request", lessonId, traineeId }
          );
        }
        logInstantLessonOps("INSTANT_LESSON_REQUEST", {
          lessonId,
          coachId,
          traineeId,
          title: "Instant lesson requested",
          payload: { duration, lessonType, expiresAt: resolvedExpiresAt },
        });
      } catch (_err) {
        /* intentionally quiet — add app-level logging if needed */
      }
    });

    // Handle instant lesson accept
    socket.on(EVENTS.INSTANT_LESSON.ACCEPT, async (payload: any, callback?: (res: unknown) => void) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        if (!lessonId || !coachId || !traineeId) {
          callback?.({ ok: false, error: "missing_fields" });
          return;
        }
        const { acceptInstantLessonAction } = require("../instant-lesson/instantLessonActions");
        const result = await acceptInstantLessonAction({
          lessonId,
          coachId,
          traineeId,
        });
        if (!result.ok) {
          if (result.error === "expired") {
            await runInstantLessonExpireFn(lessonId, coachId, traineeId, socket);
          }
          callback?.({
            ok: false,
            error: result.error,
            message: result.message,
          });
          return;
        }
        callback?.({
          ok: true,
          acceptedAt: result.acceptedAt,
          joinDeadlineAt: result.joinDeadlineAt,
        });
      } catch (_err) {
        callback?.({ ok: false, error: "server_error" });
      }
    });

    // Handle instant lesson decline
    socket.on(EVENTS.INSTANT_LESSON.DECLINE, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        if (!lessonId || !coachId || !traineeId) {
          return;
        }
        const { declineInstantLessonAction } = require("../instant-lesson/instantLessonActions");
        await declineInstantLessonAction({ lessonId, coachId, traineeId });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    // Handle instant lesson expire
    socket.on(EVENTS.INSTANT_LESSON.EXPIRE, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        if (!lessonId) return;
        await runInstantLessonExpireFn(lessonId, coachId, traineeId, socket);
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    // Handle instant lesson clips selected (trainee saved clips and is joining)
    socket.on(EVENTS.INSTANT_LESSON.CLIPS_SELECTED, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        if (!lessonId || !coachId) {
          return;
        }
        const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.CLIPS_SELECTED, {
            lessonId,
            coachId,
            traineeId,
          });
        }
        logInstantLessonOps("INSTANT_LESSON_CLIPS_SELECTED", {
          lessonId,
          coachId,
          traineeId,
          title: "Trainee selected clips and joining",
        });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    // Handle trainee cancelled (trainee closed/cancelled before coach responded)
    socket.on(EVENTS.INSTANT_LESSON.TRAINEE_CANCELLED, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        const socketTraineeId = String(
          socket?.user?._doc?._id ?? socket?.user?._id ?? traineeId ?? ""
        );
        if (!lessonId || !socketTraineeId) return;

        const {
          cancelInstantLessonByTraineeAction,
        } = require("../instant-lesson/instantLessonActions");
        await cancelInstantLessonByTraineeAction({
          lessonId: String(lessonId),
          traineeId: socketTraineeId,
        });

        const coachSocketId = MemCache.getDetail(
          process.env.SOCKET_CONFIG,
          String(coachId ?? "")
        );
        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.TRAINEE_CANCELLED, {
            lessonId,
            coachId,
            traineeId: socketTraineeId,
          });
        }
      } catch (_err) {
        /* intentionally quiet */
      }
    });
  } catch (_err) {
    /* intentionally quiet */
  }
};

// Booking Event Handlers
const listenBookingEvents = (socket) => {
  try {
    // This handler is for receiving booking events from other services
    // The actual emission happens in booking creation/update services
    socket.on(EVENTS.BOOKING.CREATED, async (payload: any) => {
      console.log(`[BOOKING] Booking created event received:`, payload);
    });

    socket.on(EVENTS.BOOKING.STATUS_UPDATED, async (payload: any) => {
      console.log(`[BOOKING] Booking status updated event received:`, payload);
    });
  } catch (err) {
    console.error(`[BOOKING] Error setting up booking event listeners:`, err);
  }
};

async function persistBookingCreatedNotification(
  bookingData: any,
  bookingType: "instant" | "scheduled",
  socketPayload: Record<string, unknown>
) {
  const trainerId = socketPayload.trainerId as string;
  const traineeId = socketPayload.traineeId as string;
  if (!trainerId || !traineeId) return;

  const [trainee, trainer] = await Promise.all([
    user.findById(traineeId).lean(),
    user.findById(trainerId).lean(),
  ]);
  const traineeName = trainee?.fullname || "A trainee";
  const title =
    bookingType === "instant" ? "Instant lesson request" : "New Booking Request";
  const description =
    bookingType === "instant"
      ? `${traineeName} requested an instant lesson. Open the app to respond.`
      : `${traineeName} booked a session with you. Open Session requests to confirm.`;

  const bookingId = socketPayload.bookingId as string;
  const kind = bookingType === "instant" ? "booking_created_instant" : "booking_created_scheduled";
  if (
    await shouldSkipDuplicateNotify(trainerId, kind, bookingId, title)
  ) {
    return;
  }
  const doc = await notification.create({
    title,
    description,
    senderId: traineeId,
    receiverId: trainerId,
    type: NotificationType.TRANSCATIONAL,
  });

  const receivePayload = {
    _id: doc?._id,
    title: doc?.title,
    description: doc?.description,
    createdAt: doc?.createdAt,
    isRead: doc?.isRead,
    sender: {
      _id: trainee?._id,
      name: trainee?.fullname,
      profile_picture: trainee?.profile_picture || null,
    },
    bookingInfo: { bookingId, ...socketPayload },
  };

  void publishSocketEventToUser(trainerId, EVENTS.PUSH_NOTIFICATIONS.ON_RECEIVE, receivePayload);

  if (trainer?.subscriptionId) {
    try {
      const subscription = JSON.parse(trainer.subscriptionId);
      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title, description })
      );
    } catch (error) {
      console.error("[BOOKING] Web push error (trainer):", error);
    }
  }

  void pushService.sendPushNotification(trainerId, title, description, {
    bookingId,
    type: "booking_created",
    bookingType,
  });
}

// Helper functions to emit booking events from services
export const emitBookingCreated = async (bookingData: any, bookingType: 'instant' | 'scheduled' = 'scheduled') => {
  try {
    const { _id: bookingId, trainer_id, trainee_id, createdAt } = bookingData;
    const trainerId = trainer_id?.toString ? trainer_id.toString() : trainer_id;
    const traineeId = trainee_id?.toString ? trainee_id.toString() : trainee_id;

    const startTimeUtc =
      bookingData?.start_time ? new Date(bookingData.start_time).toISOString() : null;
    const endTimeUtc =
      bookingData?.end_time ? new Date(bookingData.end_time).toISOString() : null;
    const bookedDateUtc =
      bookingData?.booked_date ? new Date(bookingData.booked_date).toISOString() : null;
    const bookingTimeZone = bookingData?.time_zone || null;

    const payload = {
      bookingId: bookingId?.toString ? bookingId.toString() : bookingId,
      trainerId,
      traineeId,
      type: bookingType,
      createdAt: createdAt || new Date().toISOString(),
      startTimeUtc,
      endTimeUtc,
      bookedDateUtc,
      bookingTimeZone,
    };

    try {
      await persistBookingCreatedNotification(bookingData, bookingType, payload);
    } catch (notifyErr) {
      console.error("[BOOKING] Error persisting booking notification:", notifyErr);
    }

    void publishSocketEventToUsers(
      [trainerId, traineeId],
      EVENTS.BOOKING.CREATED,
      payload
    );
    console.log(
      `[BOOKING] BOOKING_CREATED published trainer=${trainerId} trainee=${traineeId}`
    );

    console.log(`[BOOKING] [${new Date().toISOString()}] Booking created: ${payload.bookingId}, type: ${bookingType}, trainer: ${trainerId}, trainee: ${traineeId}`);
  } catch (err) {
    console.error(`[BOOKING] Error emitting BOOKING_CREATED event:`, err);
  }
};

export const emitBookingStatusUpdated = async (bookingData: any) => {
  try {
    const { _id: bookingId, trainer_id, trainee_id, status, updatedAt } = bookingData;
    const trainerId = trainer_id?.toString ? trainer_id.toString() : trainer_id;
    const traineeId = trainee_id?.toString ? trainee_id.toString() : trainee_id;

    const payload = {
      bookingId: bookingId?.toString ? bookingId.toString() : bookingId,
      trainerId,
      traineeId,
      status,
      updatedAt: updatedAt || new Date().toISOString(),
    };

    void publishSocketEventToUsers(
      [trainerId, traineeId],
      EVENTS.BOOKING.STATUS_UPDATED,
      payload
    );
    console.log(
      `[BOOKING] BOOKING_STATUS_UPDATED published trainer=${trainerId} trainee=${traineeId}`
    );

    console.log(`[BOOKING] [${new Date().toISOString()}] Booking status updated: ${payload.bookingId}, status: ${status}, trainer: ${trainerId}, trainee: ${traineeId}`);

    const isInstant = bookingData?.is_instant === true;

    if (status === "confirmed" && traineeId && !isInstant) {
      const trainer = await user.findById(trainerId).select("fullname").lean();
      const n = INSTANT_NOTIFICATION.scheduledConfirmed((trainer as any)?.fullname);
      void notifySessionUser(
        {
          receiverId: traineeId,
          senderId: trainerId,
          title: n.title,
          description: n.description,
          bookingId: payload.bookingId,
          kind: n.kind,
        },
        ioInstance
      );
    } else if ((status === "canceled" || status === "cancel") && !isInstant) {
      const n = INSTANT_NOTIFICATION.scheduledCancelled("Your session");
      if (traineeId) {
        void notifySessionUser(
          {
            receiverId: traineeId,
            senderId: trainerId,
            title: n.title,
            description: n.description,
            bookingId: payload.bookingId,
            kind: n.kind,
          },
          ioInstance
        );
      }
      if (trainerId) {
        void notifySessionUser(
          {
            receiverId: trainerId,
            senderId: traineeId,
            title: n.title,
            description: n.description,
            bookingId: payload.bookingId,
            kind: n.kind,
          },
          ioInstance
        );
      }
    }
  } catch (err) {
    console.error(`[BOOKING] Error emitting BOOKING_STATUS_UPDATED event:`, err);
  }
};

emitBookingStatusUpdatedDelegate = emitBookingStatusUpdated;

/* In-call drawing/video sync: handlers/inCallMediaSyncHandlers.ts */
