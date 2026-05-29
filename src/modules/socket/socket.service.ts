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
function relayPeerByUserId(
  peerUserId: string | undefined | null,
  event: string,
  payload: unknown
): boolean {
  if (!peerUserId) return false;
  void publishSocketEventToUser(String(peerUserId), event, payload);
  return true;
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
type LessonSessionState = {
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
function lessonSessionsGet(sessionId: string): LessonSessionState | undefined {
  return getLessonSession(sessionId) as LessonSessionState | undefined;
}
function lessonSessionsSet(sessionId: string, session: LessonSessionState): void {
  setLessonSession(sessionId, session as any);
}
function lessonSessionsDelete(sessionId: string): void {
  deleteLessonSession(sessionId);
}

/** Brief disconnects (e.g. ERR_NETWORK_CHANGED → reconnect) must not pause the lesson or emit PARTICIPANT_LEFT. */
const SESSION_LEAVE_GRACE_MS = 12000;
const pendingLessonDisconnectTimers = new Map<string, NodeJS.Timeout>();

function cancelLessonDisconnectGrace(sessionId: string, userId: string) {
  const key = `${String(sessionId)}:${String(userId)}`;
  const t = pendingLessonDisconnectTimers.get(key);
  if (t) {
    clearTimeout(t);
    pendingLessonDisconnectTimers.delete(key);
  }
}

function lessonRoomEmit(roomName: string, event: string, payload: unknown) {
  const sessionMatch = /^session:(.+)$/.exec(roomName);
  if (sessionMatch) {
    void publishSocketEventToSession(sessionMatch[1], event, payload);
  } else {
    void publishSocketEventToRoom(roomName, event, payload);
  }
}

function startLessonTimerInRoom(
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

function maybeAutoStartLessonTimer(socket: any, roomName: string, session: LessonSessionState) {
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

const emitLessonStateSync = (socket: any, roomName: string, session: LessonSessionState) => {
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
  };

  lessonRoomEmit(roomName, "LESSON_STATE_SYNC", statePayload);
};

const clearLessonTimeouts = (session: LessonSessionState) => {
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

const scheduleLessonEnd = (socket: any, roomName: string, session: LessonSessionState) => {
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
    void releaseAllLessonCallSlotsForSession(session.sessionId);
    lessonSessionsDelete(session.sessionId);
  }, remainingMs);
};

/** Socket user may be a Mongoose document or plain object — avoid relying on `_doc`. */
function socketAttachedUserId(socket: any): string {
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
      const checkIfUserIsAlreadyAdded = await onlineUser.findOne({
        trainer_id: trainerId,
      });

      if (checkIfUserIsAlreadyAdded) {
        await onlineUser.updateOne(
          { trainer_id: trainerId },
          { $set: { last_activity_time: new Date() } }
        );
      } else {
        await new onlineUser({
          trainer_id: trainerId,
          last_activity_time: new Date(),
        }).save();
      }
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

  // Connection quality stats from WebRTC calls
  socket.on("CALL_QUALITY_STATS", async (payload) => {
    try {
      const userId = socket?.user?._doc?._id || socket?.user?._id;
      const accountType =
        socket?.user?._doc?.account_type || socket?.user?.account_type;

      const { sessionId, role, stats } = payload || {};

      // Log quality metrics for monitoring
      if (stats?.quality) {
        console.log("[CallQuality] Stats:", {
          userId,
          accountType,
          sessionId,
          role,
          overallScore: stats.quality.overallScore,
          audioScore: stats.quality.audioScore,
          videoScore: stats.quality.videoScore,
          rtt: stats.quality.rtt,
          usingRelay: stats.quality.usingRelay,
          timestamp: stats.timestamp,
        });

        // Save to database for analytics (only sample every 5th report to avoid DB overload)
        if (sessionId && userId && Math.random() < 0.2) {
          try {
            await CallDiagnostics.create({
              sessionId,
              userId,
              accountType,
              role,
              eventType: "CALL_QUALITY_STATS",
              qualityStats: stats,
            });
          } catch (dbErr) {
            console.error("[CallQuality] Failed to save to DB:", dbErr);
          }
        }
        if (sessionId && userId) {
          logCallQualityOps({
            sessionId: String(sessionId),
            userId: String(userId),
            stats,
            role,
          });
        }
      }
    } catch (err) {
      console.error(
        "[CallQuality] Failed to process CALL_QUALITY_STATS:",
        err
      );
    }
  });

  socket.on(EVENTS.VIDEO_CALL.ON_OFFER, ({ offer, userInfo }) => {
    const toUserId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );
    console.log("[VideoCall:ON_OFFER]", {
      from_user: userInfo?.from_user,
      to_user: userInfo?.to_user,
      toUserSocketMapped: !!toUserId,
    });
    if (!userInfo?.to_user) {
      console.warn("[VideoCall:ON_OFFER] Target user missing", {
        from_user: userInfo?.from_user,
      });
      return;
    }
    void publishSocketEventToUser(String(userInfo.to_user), "offer", offer);
    // TODO:for now broadcasting the event, it needs to send to specific user.
    // socket.broadcast.emit('offer', offer);
  });

  const processOnCallJoin = async (
    socket: any,
    { userInfo }: { userInfo?: any }
  ) => {
    const toUserId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );

    // Critical: log the full MemCache lookup result so we can see if the target user's socket is registered
    console.log("[VideoCall:ON_CALL_JOIN] 🔍 MemCache socket lookup:", {
      from_user: userInfo?.from_user,
      to_user: userInfo?.to_user,
      peerId: userInfo?.peerId,
      toUserSocketId: toUserId || "❌ NOT FOUND IN MEMCACHE",
      socketConfigKey: process.env.SOCKET_CONFIG,
      WARNING: !toUserId ? "⚠️ Target user socket not in MemCache — ON_CALL_JOIN will NOT reach them. Is the other user connected?" : undefined,
      WARNING_peerId: !userInfo?.peerId ? "⚠️ peerId is missing in userInfo — trainer cannot dial trainee without peerId!" : undefined,
    });

    if (!toUserId) {
      console.warn("[VideoCall:ON_CALL_JOIN] No socket mapping found for target user", {
        to_user: userInfo?.to_user,
        from_user: userInfo?.from_user,
        peerId: userInfo?.peerId,
      });
    }

    // Track join state for timer logic - sessionId is booked_session._id
    const sessionId = userInfo?.sessionId || userInfo?.meetingId || userInfo?.lessonId;
    const accountType = socket?.user?._doc?.account_type || socket?.user?.account_type;
    const userId = socket?.user?._doc?._id || socket?.user?._id;

    console.log("[VideoCall:ON_CALL_JOIN]", {
      sessionId,
      userId,
      accountType,
      peerId: userInfo?.peerId,
      from_user: userInfo?.from_user,
      to_user: userInfo?.to_user,
      toUserSocketMapped: !!toUserId,
    });
    
    if (sessionId && mongoose.isValidObjectId(sessionId)) {
      const { assertSessionParticipant } = require("../../helpers/chatBlockCheck");
      const allowed = userId
        ? await assertSessionParticipant(String(sessionId), String(userId))
        : false;
      if (!allowed) {
        console.warn(`[SESSION] Denied join for user ${userId} on session ${sessionId}`);
        return;
      }

      let isInstantLesson = false;
      try {
        const slotMeta = await booked_session
          .findById(sessionId)
          .select("is_instant")
          .lean();
        isInstantLesson = !!slotMeta?.is_instant;
      } catch {
        /* non-fatal */
      }

      const slot = await claimLessonCallSlot({
        sessionId: String(sessionId),
        userId: String(userId),
        socketId: socket.id,
        authSessionId: (socket as any).nqAuthSessionId,
        deviceId: (socket as any).nqDeviceId,
        isInstant: isInstantLesson,
      });
      if (slot.ok === false) {
        const denyReason = slot.reason;
        console.warn(
          `[SESSION] Call slot denied for user ${userId} on session ${sessionId}: ${denyReason}`
        );
        socket.emit(EVENTS.VIDEO_CALL.CALL_JOIN_DENIED, {
          sessionId: String(sessionId),
          reason: denyReason,
          canTakeOver: denyReason === "already_active_elsewhere",
          message:
            "This lesson is already active on another device. Leave the other device or use that session to continue.",
        });
        return;
      }

      // Join the room immediately when user joins (don't wait for both parties)
      const roomName = `session:${sessionId}`;
      socket.join(roomName);
      cancelLessonDisconnectGrace(sessionId, String(userId));
      console.log(`[SESSION] User ${userId} (${accountType}) joined room ${roomName} for session ${sessionId}`);
      
      let session = lessonSessionsGet(sessionId);
      if (!session) {
        session = (await hydrateLessonSessionFromRedis(String(sessionId))) as
          | LessonSessionState
          | undefined;
      }
      if (!session) {
        // Fetch booked session to get duration
        try {
          const bookedSession = await booked_session.findById(sessionId);
          if (bookedSession) {
            // Calculate duration from start_time and end_time (Date objects) if available
            // Otherwise calculate from session_start_time and session_end_time (string HH:mm)
            let durationSeconds = 30 * 60; // default 30 minutes
            if (bookedSession.is_instant && bookedSession.duration_minutes) {
              const mins = Number(bookedSession.duration_minutes);
              if (mins > 0) durationSeconds = mins * 60;
            } else if (bookedSession.start_time && bookedSession.end_time) {
              durationSeconds = Math.floor((bookedSession.end_time.getTime() - bookedSession.start_time.getTime()) / 1000);
            } else if (bookedSession.session_start_time && bookedSession.session_end_time) {
              // Parse HH:mm strings and calculate duration
              const [startH, startM] = bookedSession.session_start_time.split(':').map(Number);
              const [endH, endM] = bookedSession.session_end_time.split(':').map(Number);
              const startMinutes = startH * 60 + startM;
              let endMinutes = endH * 60 + endM;

              // If the end time is "earlier" than start time, assume it crosses midnight.
              // This preserves the exact booked window duration rather than falling back.
              if (endMinutes < startMinutes) {
                endMinutes += 24 * 60;
              }

              durationSeconds = (endMinutes - startMinutes) * 60; // convert to seconds
            }
            
            session = {
              sessionId,
              coachJoined: false,
              userJoined: false,
              startedAt: null,
              duration: durationSeconds > 0 ? durationSeconds : 30 * 60,
              remainingSeconds: durationSeconds > 0 ? durationSeconds : 30 * 60,
              status: "waiting",
              warningTimeoutId: null,
              endTimeoutId: null,
              isInstant: !!bookedSession.is_instant,
              coachFirstJoinedAt: null,
              userFirstJoinedAt: null,
            };
            lessonSessionsSet(sessionId, session);
            console.log(`[TIMER] Session ${sessionId} initialized with duration ${session.duration}s`);
          }
        } catch (err) {
          console.error("Error fetching booked session for timer:", err);
        }
      }
      
      if (session) {
        // Determine if this is coach (Trainer) or user (Trainee) based on account_type
        const wasCoachJoined = session.coachJoined;
        const wasUserJoined = session.userJoined;
        
        if (accountType === "Trainer") {
          session.coachJoined = true;
          if (session.coachFirstJoinedAt == null) {
            session.coachFirstJoinedAt = Date.now();
          }
          console.log(`[TIMER] Trainer ${userId} joined session ${sessionId}. Coach joined: ${session.coachJoined}, User joined: ${session.userJoined}`);
          socket.to(roomName).emit("PARTICIPANT_STATUS_CHANGED", {
            sessionId,
            role: "trainer",
            status: "connected",
            userId,
          });
        } else {
          session.userJoined = true;
          if (session.userFirstJoinedAt == null) {
            session.userFirstJoinedAt = Date.now();
          }
          console.log(`[TIMER] Trainee ${userId} joined session ${sessionId}. Coach joined: ${session.coachJoined}, User joined: ${session.userJoined}`);
          socket.to(roomName).emit("PARTICIPANT_STATUS_CHANGED", {
            sessionId,
            role: "trainee",
            status: "connected",
            userId,
          });
        }

        maybeAutoStartLessonTimer(socket, roomName, session);
        
        // Notify the other party that someone joined (if they're connected)
        const otherSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, userInfo?.to_user);
        if (otherSocketId) {
          const otherSocket = socket.nsp.sockets.get(otherSocketId);
          if (otherSocket) {
            // Ensure other party is also in the room
            otherSocket.join(roomName);
            // Notify them that this party joined
            otherSocket.emit(EVENTS.VIDEO_CALL.ON_CALL_JOIN, { 
              userInfo: {
                ...userInfo,
                joinedUserId: userId,
                accountType: accountType
              }
            });
            console.log(`[SESSION] Notified other party ${userInfo?.to_user} that ${userId} (${accountType}) joined session ${sessionId}`);
          }
        }
        
        // If trainer rejoins after an auto-disconnect-pause, auto-resume the timer.
        if (accountType === "Trainer" && session.status === "paused" && session.trainerLeftPaused) {
          session.startedAt = Date.now();
          session.status = "running";
          session.trainerLeftPaused = false;
          console.log(`[TIMER] Auto-resuming timer for session ${sessionId} after trainer rejoin. Remaining: ${session.remainingSeconds}s`);

          const resumedPayload = {
            sessionId: session.sessionId,
            startedAt: session.startedAt,
            duration: session.duration,
            remainingSeconds: session.remainingSeconds,
            reason: "trainer_rejoined",
          };
          lessonRoomEmit(roomName, "LESSON_TIME_RESUMED", resumedPayload);
          scheduleLessonEnd(socket, roomName, session);
        }

        // Coach manually controls start/pause/resume now.
        // On join, only sync current state to both peers.
        emitLessonStateSync(socket, roomName, session);

        // If timer already started (e.g. user reconnected or joined after the other party),
        // send current timer state (including remainingSeconds) to this socket so the UI
        // can show an accurate countdown without depending on the client's clock.
        if (session.status === "running" && session.startedAt != null) {
          // Send un-adjusted remainingSeconds and original startedAt.
          // Frontend computes: currentRemaining = remainingSeconds - (now - startedAt), avoiding double-counting.
          const timerPayload = {
            sessionId: session.sessionId,
            startedAt: session.startedAt,
            duration: session.duration,
            remainingSeconds: session.remainingSeconds,
          };
          socket.emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);
          console.log(`[TIMER] [${new Date().toISOString()}] Sent existing timer state to joining/reconnecting user for session ${sessionId}`);
        }

        lessonSessionsSet(sessionId, session);
      }
    }
    
    // Also emit to the specific user (for backward compatibility)
    if (userInfo?.to_user) {
      console.log("[VideoCall:ON_CALL_JOIN] 📤 Forwarding via user room:", {
        to_user: userInfo.to_user,
        peerId: userInfo?.peerId,
        from_user: userInfo?.from_user,
        memCacheSocketId: toUserId || null,
      });
      relayPeerByUserId(userInfo.to_user, EVENTS.VIDEO_CALL.ON_CALL_JOIN, { userInfo });
    } else {
      console.error("[VideoCall:ON_CALL_JOIN] 🚨 CANNOT FORWARD — missing to_user");
    }
  };

  socket.on(EVENTS.VIDEO_CALL.ON_CALL_JOIN, (payload) => {
    void processOnCallJoin(socket, payload);
  });

  socket.on(EVENTS.VIDEO_CALL.CALL_JOIN_TAKEOVER, async ({ userInfo }) => {
    const sessionId =
      userInfo?.sessionId || userInfo?.meetingId || userInfo?.lessonId;
    const userId = socketAttachedUserId(socket);
    if (!sessionId || !mongoose.isValidObjectId(sessionId) || !userId) {
      return;
    }

    const { assertSessionParticipant } = require("../../helpers/chatBlockCheck");
    const allowed = await assertSessionParticipant(String(sessionId), String(userId));
    if (!allowed) {
      return;
    }

    let isInstantLesson = false;
    try {
      const slotMeta = await booked_session
        .findById(sessionId)
        .select("is_instant")
        .lean();
      isInstantLesson = !!slotMeta?.is_instant;
    } catch {
      /* non-fatal */
    }

    const takeover = await takeoverLessonCallSlot({
      sessionId: String(sessionId),
      userId: String(userId),
      socketId: socket.id,
      authSessionId: (socket as any).nqAuthSessionId,
      deviceId: (socket as any).nqDeviceId,
      isInstant: isInstantLesson,
    });
    if (!takeover.ok) {
      socket.emit(EVENTS.VIDEO_CALL.CALL_JOIN_DENIED, {
        sessionId: String(sessionId),
        reason: "takeover_failed",
        canTakeOver: false,
        message: "Could not take over this lesson on this device.",
      });
      return;
    }

    if (takeover.previousSocketId) {
      const prev = getIo()?.sockets?.sockets?.get(takeover.previousSocketId);
      prev?.emit(EVENTS.VIDEO_CALL.CALL_SLOT_TAKEN_OVER, {
        sessionId: String(sessionId),
        message:
          "This lesson was continued on another device. You have left the call on this device.",
      });
    }

    await processOnCallJoin(socket, { userInfo });
  });

  socket.on(EVENTS.VIDEO_CALL.ON_BOTH_JOIN, async (socketReq) => {
    const toUserId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      socketReq.userInfo?.to_user
    );
    
    // Check if timer has already started - if so, send current timer info (including
    // remainingSeconds) to the newly joined party so their UI is in sync.
    const sessionId = socketReq?.sessionId || socketReq?.userInfo?.sessionId || socketReq?.userInfo?.meetingId || socketReq?.userInfo?.lessonId;
    if (sessionId && mongoose.isValidObjectId(sessionId)) {
      void booked_session
        .findOneAndUpdate(
          { _id: sessionId, is_instant: true, both_joined_at: null },
          {
            $set: {
              both_joined_at: new Date(),
              instant_phase: INSTANT_PHASE.ACTIVE,
            },
          }
        )
        .exec();
      clearInstantLessonTimers(sessionId);

      const session = lessonSessionsGet(sessionId);
      if (session && session.status === "running" && session.startedAt !== null) {
        // Timer already started - send un-adjusted state; frontend derives currentRemaining = remainingSeconds - (now - startedAt)
        const timerPayload = {
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          duration: session.duration,
          remainingSeconds: session.remainingSeconds,
        };
        socket.emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);
        console.log(`[TIMER] [${new Date().toISOString()}] Sending existing timer state to newly joined party for session ${sessionId}, started at ${new Date(session.startedAt).toISOString()}`);
      }
    }
    
    relayPeerByUserId(
      socketReq.userInfo?.to_user,
      EVENTS.VIDEO_CALL.ON_BOTH_JOIN,
      { socketReq }
    );
  });

  socket.on("LESSON_STATE_REQUEST", async ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    await hydrateLessonSessionFromRedis(String(sessionId));
    const session = lessonSessionsGet(sessionId);
    if (!session) return;

    const roomName = `session:${sessionId}`;
    emitLessonStateSync(socket, roomName, session);

    if (session.status === "running" && session.startedAt != null) {
      const timerPayload = {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        duration: session.duration,
        remainingSeconds: session.remainingSeconds,
      };
      socket.emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);
    }
  });

  /** Trainee (or reconnecting party) asks the trainer client to re-emit clip/layout state. */
  socket.on("LESSON_MEDIA_REPLAY_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const requesterId = socketAttachedUserId(socket);
    if (!requesterId) return;
    const roomName = `session:${sessionId}`;
    lessonRoomEmit(roomName, "LESSON_MEDIA_REPLAY_REQUEST", {
      sessionId: String(sessionId),
      requesterId,
    });
  });

  socket.on("LESSON_TIMER_START_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessionsGet(sessionId);
    if (!session) return;

    const accountType = socket?.user?._doc?.account_type || socket?.user?.account_type;
    if (accountType !== "Trainer") {
      socket.emit("LESSON_TIMER_ERROR", { message: "Only trainer can start lesson timer." });
      return;
    }
    if (!session.coachJoined || !session.userJoined) {
      socket.emit("LESSON_TIMER_ERROR", { message: "Both participants must be connected before starting timer." });
      return;
    }
    // Idempotent: instant lessons auto-start via maybeAutoStartLessonTimer; manual request is a no-op when running.
    if (session.status === "running") return;

    const roomName = `session:${sessionId}`;
    const reason = session.isInstant ? "instant_trainer_start_request" : "trainer_manual_start";
    startLessonTimerInRoom(socket, roomName, session, reason);
  });

  socket.on("LESSON_TIMER_PAUSE_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessionsGet(sessionId);
    if (!session || session.status !== "running" || session.startedAt == null) return;

    const accountType = socket?.user?._doc?.account_type || socket?.user?.account_type;
    if (accountType !== "Trainer") {
      socket.emit("LESSON_TIMER_ERROR", { message: "Only trainer can pause lesson timer." });
      return;
    }

    const roomName = `session:${sessionId}`;
    const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
    session.remainingSeconds = Math.max(0, session.remainingSeconds - elapsedSeconds);
    session.startedAt = null;
    session.status = "paused";
    session.trainerLeftPaused = false; // explicit manual pause — not a disconnect-pause
    clearLessonTimeouts(session);

    const pausedPayload = {
      sessionId: session.sessionId,
      remainingSeconds: session.remainingSeconds,
      duration: session.duration,
    };
    lessonRoomEmit(roomName, "LESSON_TIME_PAUSED", pausedPayload);
    emitLessonStateSync(socket, roomName, session);
  });

  socket.on("LESSON_TIMER_RESUME_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessionsGet(sessionId);
    if (!session || session.status !== "paused") return;

    const accountType = socket?.user?._doc?.account_type || socket?.user?.account_type;
    if (accountType !== "Trainer") {
      socket.emit("LESSON_TIMER_ERROR", { message: "Only trainer can resume lesson timer." });
      return;
    }

    const roomName = `session:${sessionId}`;
    session.startedAt = Date.now();
    session.status = "running";

    const resumedPayload = {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      duration: session.duration,
      remainingSeconds: session.remainingSeconds,
    };
    lessonRoomEmit(roomName, "LESSON_TIME_RESUMED", resumedPayload);
    emitLessonStateSync(socket, roomName, session);
    scheduleLessonEnd(socket, roomName, session);
  });

  socket.on(EVENTS.VIDEO_CALL.ON_ANSWER, ({ answer, userInfo }) => {
    const toUserId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );
    console.log("[VideoCall:ON_ANSWER]", {
      from_user: userInfo?.from_user,
      to_user: userInfo?.to_user,
      toUserSocketMapped: !!toUserId,
    });
    if (!userInfo?.to_user) {
      console.warn("[VideoCall:ON_ANSWER] Target user missing", {
        from_user: userInfo?.from_user,
      });
      return;
    }
    relayPeerByUserId(userInfo.to_user, "answer", answer);
  });

  socket.on(EVENTS.VIDEO_CALL.ON_ICE_CANDIDATE, (data) => {
    const { userInfo } = data;
    const toUserSocketId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );
    console.log("[VideoCall:ON_ICE_CANDIDATE]", {
      from_user: userInfo?.from_user,
      to_user: userInfo?.to_user,
      toUserSocketMapped: !!toUserSocketId,
    });
    if (!userInfo?.to_user) {
      console.warn("[VideoCall:ON_ICE_CANDIDATE] Target user missing", {
        from_user: userInfo?.from_user,
      });
      return;
    }
    relayPeerByUserId(userInfo.to_user, "ice-candidate", data);
  });

  socket.on(EVENTS.EMIT_CLEAR_CANVAS, (payload) => {
    const { userInfo } = payload;
    relayPeerByUserId(userInfo?.to_user, EVENTS.ON_CLEAR_CANVAS, payload);
  });

  socket.on(EVENTS.EMIT_UNDO, (payload) => {
    const { userInfo } = payload;
    relayPeerByUserId(userInfo?.to_user, EVENTS.ON_UNDO, payload);
  });

  socket.on(EVENTS.VIDEO_CALL.MUTE_ME, (payload) => {
    const { muteStatus, isMuted, isClicked, userInfo } = payload ?? {};
    const muted =
      typeof isMuted === "boolean"
        ? isMuted
        : typeof muteStatus === "boolean"
          ? muteStatus
          : typeof isClicked === "boolean"
            ? isClicked
            : false;
    relayPeerByUserId(userInfo?.to_user, EVENTS.VIDEO_CALL.MUTE_ME, {
      muteStatus: muted,
      isMuted: muted,
      userInfo,
    });
  });

  socket.on(EVENTS.VIDEO_CALL.STOP_FEED, ({ feedStatus, userInfo }) => {
    relayPeerByUserId(userInfo?.to_user, EVENTS.VIDEO_CALL.STOP_FEED, { feedStatus });
  });

  socket.on(EVENTS.VIDEO_CALL.ON_CLOSE, (payload) => {
    const { userInfo } = payload;
    relayPeerByUserId(userInfo?.to_user, EVENTS.VIDEO_CALL.ON_CLOSE, {});
  });

  // Listen for userActivity event
  // socket.on('userActivity', (data) => {
  updateUserActivity(socket);
  // });

  const handleRoomJoinEvent = (roomName: string) => {
    // const peerConnection = new RTCPeerConnection();
  };

  listenDrawEvent(socket);
  stopDrawEvent(socket);
  listenShowVideoEvent(socket);
  listenCallEndEvent(socket);
  listenVideoPositionEvent(socket);
  listenMeetingTileLayoutEvent(socket);
  listenPlayPauseVideoEvent(socket);
  listenVideoTimeEvent(socket);
  listenVideoShowEvent(socket);
  listenDrawingModeToggle(socket);
  listenFullscreenToggle(socket);
  listenInstantLessonSessionRecording(socket);
  listenLockModeToggle(socket);
  listenVideoChunksEvent(socket);
  listenNotificationEvents(socket);
  listenInstantLessonEvents(socket);
  listenBookingEvents(socket);
  listenChatEvents(socket);
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

async function emitInstantLessonExpire(
  lessonId: string,
  coachId: string,
  traineeId: string,
  _originatingSocket?: { to: (room: string) => { emit: (event: string, payload: unknown) => void } }
) {
  const payload = { lessonId, coachId, traineeId };
  void publishSocketEventToUsers([coachId, traineeId], EVENTS.INSTANT_LESSON.EXPIRE, payload);
  if (traineeId && !isUserOnline(traineeId)) {
    void pushService.sendPushNotification(
      traineeId,
      "Lesson Expired",
      "Your instant lesson request expired. The trainer didn't respond in time.",
      { kind: "instant_lesson_expire", lessonId }
    );
  }
}

function emitInstantLessonPhase(
  lessonId: string,
  coachId: string,
  traineeId: string,
  phase: string,
  extra: Record<string, unknown> = {},
  _originatingSocket?: { to: (room: string) => { emit: (event: string, payload: unknown) => void } }
) {
  const payload = { lessonId, coachId, traineeId, phase, ...extra };
  void publishSocketEventToUsers([coachId, traineeId], EVENTS.INSTANT_LESSON.PHASE, payload);
}

export async function runInstantLessonExpire(
  lessonId: string,
  coachId?: string,
  traineeId?: string,
  originatingSocket?: { to: (room: string) => { emit: (event: string, payload: unknown) => void } },
  kind: "accept" | "join" = "accept"
) {
  try {
    const booking = await booked_session.findById(lessonId).lean();
    if (!booking?.is_instant) return;

    const resolvedCoachId = coachId || String(booking.trainer_id);
    const resolvedTraineeId = traineeId || String(booking.trainee_id);

    if (kind === "accept" && booking.status === BOOKED_SESSIONS_STATUS.BOOKED) {
      await booked_session.findOneAndUpdate(
        { _id: lessonId, is_instant: true, status: BOOKED_SESSIONS_STATUS.BOOKED },
        {
          $set: {
            status: BOOKED_SESSIONS_STATUS.cancel,
            instant_phase: INSTANT_PHASE.CANCELLED,
            refund_reason: INSTANT_REFUND_REASON.ACCEPT_EXPIRED,
          },
        }
      );
      void refundSessionEscrow(lessonId, INSTANT_REFUND_REASON.ACCEPT_EXPIRED);
      await emitInstantLessonExpire(lessonId, resolvedCoachId, resolvedTraineeId, originatingSocket);
      emitInstantLessonPhase(
        lessonId,
        resolvedCoachId,
        resolvedTraineeId,
        INSTANT_PHASE.CANCELLED,
        { refundReason: INSTANT_REFUND_REASON.ACCEPT_EXPIRED },
        originatingSocket
      );
      logInstantLessonOps("INSTANT_LESSON_EXPIRED", {
        lessonId,
        coachId: resolvedCoachId,
        traineeId: resolvedTraineeId,
        severity: "warning",
        title: "Instant lesson accept window expired",
        summary: "Trainer did not accept in time; booking cancelled and refund initiated.",
      });
      void notifyInstantAcceptExpired(lessonId, resolvedCoachId, resolvedTraineeId);
    }

    if (
      kind === "join" &&
      booking.status === BOOKED_SESSIONS_STATUS.confirm &&
      !(booking as any).both_joined_at
    ) {
      await booked_session.findOneAndUpdate(
        {
          _id: lessonId,
          is_instant: true,
          status: BOOKED_SESSIONS_STATUS.confirm,
          both_joined_at: null,
        },
        {
          $set: {
            status: BOOKED_SESSIONS_STATUS.cancel,
            instant_phase: INSTANT_PHASE.CANCELLED,
            refund_reason: INSTANT_REFUND_REASON.JOIN_EXPIRED,
          },
        }
      );
      void refundSessionEscrow(lessonId, INSTANT_REFUND_REASON.JOIN_EXPIRED);
      emitInstantLessonPhase(
        lessonId,
        resolvedCoachId,
        resolvedTraineeId,
        INSTANT_PHASE.CANCELLED,
        { refundReason: INSTANT_REFUND_REASON.JOIN_EXPIRED },
        originatingSocket
      );
      logInstantLessonOps("INSTANT_LESSON_JOIN_EXPIRED", {
        lessonId,
        coachId: resolvedCoachId,
        traineeId: resolvedTraineeId,
        severity: "warning",
        title: "Instant lesson join window expired",
        summary: "Parties did not join in time; refund initiated.",
      });
      void notifyInstantJoinExpired(lessonId, resolvedCoachId, resolvedTraineeId);
    }
  } catch (_err) {
    /* non-fatal */
  } finally {
    clearInstantLessonTimers(lessonId);
  }
}

async function notifyInstantAcceptExpired(
  lessonId: string,
  coachId: string,
  traineeId: string
) {
  const [trainer, trainee] = await Promise.all([
    user.findById(coachId).select("fullname").lean(),
    user.findById(traineeId).select("fullname").lean(),
  ]);
  const trainerName = (trainer as any)?.fullname;
  const traineeName = (trainee as any)?.fullname;
  const nTrainee = INSTANT_NOTIFICATION.acceptExpiredTrainee(trainerName);
  void notifySessionUser(
    {
      receiverId: traineeId,
      senderId: coachId,
      title: nTrainee.title,
      description: nTrainee.description,
      bookingId: lessonId,
      kind: nTrainee.kind,
    },
    ioInstance
  );
  const nTrainer = INSTANT_NOTIFICATION.acceptExpiredTrainer(traineeName);
  void notifySessionUser(
    {
      receiverId: coachId,
      senderId: traineeId,
      title: nTrainer.title,
      description: nTrainer.description,
      bookingId: lessonId,
      kind: nTrainer.kind,
    },
    ioInstance
  );
}

async function notifyInstantJoinExpired(
  lessonId: string,
  coachId: string,
  traineeId: string
) {
  const n = INSTANT_NOTIFICATION.joinExpired();
  void notifySessionUser(
    {
      receiverId: traineeId,
      senderId: coachId,
      title: n.title,
      description: n.description,
      bookingId: lessonId,
      kind: n.kind,
    },
    ioInstance
  );
  void notifySessionUser(
    {
      receiverId: coachId,
      senderId: traineeId,
      title: n.title,
      description: n.description,
      bookingId: lessonId,
      kind: n.kind,
    },
    ioInstance
  );
}

registerInstantLessonExpireHandler((lessonId, coachId, traineeId, kind) =>
  runInstantLessonExpire(lessonId, coachId, traineeId, undefined, kind)
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

        const booking = await booked_session.findById(lessonId).lean();
        if (
          !booking?.is_instant ||
          String(booking.trainer_id) !== String(coachId) ||
          String(booking.trainee_id) !== String(traineeId) ||
          booking.status !== BOOKED_SESSIONS_STATUS.BOOKED
        ) {
          callback?.({ ok: false, error: "invalid_booking" });
          return;
        }

        const requestedAt = booking.createdAt
          ? new Date(booking.createdAt)
          : new Date(booking.booked_date);
        if (Date.now() - requestedAt.getTime() > INSTANT_ACCEPT_WINDOW_MS) {
          await runInstantLessonExpire(lessonId, coachId, traineeId, socket);
          callback?.({ ok: false, error: "expired" });
          return;
        }

        const start = booking.start_time ? new Date(booking.start_time) : null;
        const end = booking.end_time ? new Date(booking.end_time) : null;
        if (start && end) {
          const conflictMsg = await checkTrainerBookingConflict(
            coachId,
            start,
            end,
            String(lessonId)
          );
          if (conflictMsg) {
            callback?.({ ok: false, error: "conflict", message: conflictMsg });
            return;
          }
        }

        const acceptedAt = new Date();
        const joinDeadlineAt = new Date(
          acceptedAt.getTime() + INSTANT_JOIN_AFTER_ACCEPT_MS
        );
        const updatedBooking = await booked_session.findOneAndUpdate(
          {
            _id: lessonId,
            is_instant: true,
            trainer_id: coachId,
            trainee_id: traineeId,
            status: BOOKED_SESSIONS_STATUS.BOOKED,
          },
          {
            $set: {
              status: BOOKED_SESSIONS_STATUS.confirm,
              accepted_at: acceptedAt,
              instant_phase: INSTANT_PHASE.PENDING_JOIN,
              join_deadline_at: joinDeadlineAt,
            },
          },
          { new: true }
        );

        if (!updatedBooking) {
          callback?.({ ok: false, error: "not_updated" });
          return;
        }

        clearInstantLessonTimers(lessonId);
        scheduleInstantLessonJoinExpiry(lessonId, coachId, traineeId, acceptedAt);

        /** Instant lessons use INSTANT_LESSON_PHASE + notifySessionUser — avoid stacked "Session confirmed" pushes. */
        if (emitBookingStatusUpdatedDelegate && !updatedBooking.is_instant) {
          void emitBookingStatusUpdatedDelegate(updatedBooking);
        }

        const acceptPayload = {
          lessonId,
          coachId,
          traineeId,
          acceptedAt: acceptedAt.toISOString(),
          joinDeadlineAt: joinDeadlineAt.toISOString(),
          phase: INSTANT_PHASE.PENDING_JOIN,
        };

        emitInstantLessonPhase(
          lessonId,
          coachId,
          traineeId,
          INSTANT_PHASE.PENDING_JOIN,
          {
            acceptedAt: acceptedAt.toISOString(),
            joinDeadlineAt: joinDeadlineAt.toISOString(),
          },
          socket
        );

        const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
        const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);

        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.ACCEPT, acceptPayload);
        }
        if (traineeSocketId) {
          socket.to(traineeSocketId).emit(EVENTS.INSTANT_LESSON.ACCEPT, acceptPayload);
        }
        const coachUser = await user.findById(coachId).select("fullname").lean();
        const acceptedN = INSTANT_NOTIFICATION.accepted((coachUser as any)?.fullname);
        void notifySessionUser(
          {
            receiverId: traineeId,
            senderId: coachId,
            title: acceptedN.title,
            description: acceptedN.description,
            bookingId: lessonId,
            kind: acceptedN.kind,
            extra: { joinDeadlineAt: joinDeadlineAt.toISOString() },
          },
          ioInstance
        );

        logInstantLessonOps("INSTANT_LESSON_ACCEPT", {
          lessonId,
          coachId,
          traineeId,
          title: "Instant lesson accepted",
          payload: { acceptedAt: acceptedAt.toISOString() },
        });

        callback?.({
          ok: true,
          acceptedAt: acceptedAt.toISOString(),
          joinDeadlineAt: joinDeadlineAt.toISOString(),
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

        await booked_session.findOneAndUpdate(
          { _id: lessonId, is_instant: true, status: BOOKED_SESSIONS_STATUS.BOOKED },
          {
            $set: {
              status: BOOKED_SESSIONS_STATUS.cancel,
              instant_phase: INSTANT_PHASE.CANCELLED,
              refund_reason: INSTANT_REFUND_REASON.DECLINED,
            },
          }
        );
        clearInstantLessonTimers(lessonId);
        void refundSessionEscrow(lessonId, INSTANT_REFUND_REASON.DECLINED);
        emitInstantLessonPhase(
          lessonId,
          coachId,
          traineeId,
          INSTANT_PHASE.CANCELLED,
          { refundReason: INSTANT_REFUND_REASON.DECLINED },
          socket
        );

        const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);
        if (traineeSocketId) {
          socket.to(traineeSocketId).emit(EVENTS.INSTANT_LESSON.DECLINE, {
            lessonId,
            coachId,
            traineeId,
          });
        }
        const coachUser = await user.findById(coachId).select("fullname").lean();
        const declinedN = INSTANT_NOTIFICATION.declined((coachUser as any)?.fullname);
        void notifySessionUser(
          {
            receiverId: traineeId,
            senderId: coachId,
            title: declinedN.title,
            description: declinedN.description,
            bookingId: lessonId,
            kind: declinedN.kind,
          },
          ioInstance
        );
        logInstantLessonOps("INSTANT_LESSON_DECLINE", {
          lessonId,
          coachId,
          traineeId,
          severity: "warning",
          title: "Instant lesson declined",
        });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    // Handle instant lesson expire
    socket.on(EVENTS.INSTANT_LESSON.EXPIRE, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        if (!lessonId) return;
        await runInstantLessonExpire(lessonId, coachId, traineeId, socket);
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
        if (!lessonId || !coachId) return;
        const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.TRAINEE_CANCELLED, { lessonId, coachId, traineeId });
        }
        logInstantLessonOps("INSTANT_LESSON_TRAINEE_CANCELLED", {
          lessonId,
          coachId,
          traineeId,
          severity: "info",
          title: "Trainee cancelled instant lesson request",
        });
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

// Chat Event Handlers
const listenChatEvents = (socket) => {
  const ChatMessage = require("../../model/chat_message.schema").default;

  try {
    socket.on(EVENTS.CHAT.JOIN, (payload: any) => {
      try {
        const { conversationId } = payload || {};
        if (!conversationId) return;
        socket.join(`chat:${conversationId}`);
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.LEAVE, (payload: any) => {
      try {
        const { conversationId } = payload || {};
        if (!conversationId) return;
        socket.leave(`chat:${conversationId}`);
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.MESSAGE, async (payload: any) => {
      try {
        const { conversationId, receiverId, senderId, _id } = payload || {};
        if (!conversationId) return;

        void publishSocketEventToChat(conversationId, EVENTS.CHAT.MESSAGE, payload);

        if (receiverId) {
          const receiverSid = MemCache.getDetail(process.env.SOCKET_CONFIG, String(receiverId));
          if (receiverSid) {
            void publishSocketEventToUser(String(receiverId), EVENTS.CHAT.MESSAGE, payload);
            if (_id && mongoose.isValidObjectId(_id)) {
              await ChatMessage.findByIdAndUpdate(_id, { status: "delivered", deliveredAt: new Date() });
              socket.emit(EVENTS.CHAT.DELIVERED, { messageId: _id, conversationId });
            }
          } else {
            const senderDoc = await user.findById(senderId).select("fullname").lean();
            const senderName = (senderDoc as any)?.fullname ?? "Someone";
            const content = payload.content ?? "Sent you a message";
            const preview = content.length > 60 ? content.slice(0, 57) + "..." : content;
            void pushService.sendPushNotification(
              String(receiverId),
              senderName,
              preview,
              { kind: "chat_message", conversationId, senderId: String(senderId) }
            );
          }
        }
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.DELIVERED, async (payload: any) => {
      try {
        const { messageIds, conversationId } = payload || {};
        if (!messageIds?.length || !conversationId) return;
        const validIds = messageIds.filter((id: string) => mongoose.isValidObjectId(id));
        if (validIds.length) {
          await ChatMessage.updateMany(
            { _id: { $in: validIds }, status: "sent" },
            { status: "delivered", deliveredAt: new Date() }
          );
        }
        void publishSocketEventToChat(conversationId, EVENTS.CHAT.DELIVERED, {
          messageIds: validIds,
          conversationId,
        });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.READ, async (payload: any) => {
      try {
        const { conversationId, readerId } = payload || {};
        if (!conversationId) return;
        const reader = String(readerId || socket?.user?._doc?._id || "");
        if (!reader) return;

        const User = require("../../model/user.schema").default;
        const readerDoc = await User.findById(reader).select("privacy.read_receipts_enabled").lean();
        if (readerDoc?.privacy?.read_receipts_enabled === false) return;

        const now = new Date();
        await ChatMessage.updateMany(
          { conversationId, receiverId: reader, isRead: false },
          { isRead: true, status: "read", readAt: now }
        );
        void publishSocketEventToChat(conversationId, EVENTS.CHAT.READ, {
          conversationId,
          readerId: reader,
          readAt: now.toISOString(),
        });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.TYPING, (payload: any) => {
      try {
        const { conversationId, userId } = payload || {};
        if (!conversationId) return;
        void publishSocketEventToChat(conversationId, EVENTS.CHAT.TYPING, { conversationId, userId });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.STOP_TYPING, (payload: any) => {
      try {
        const { conversationId, userId } = payload || {};
        if (!conversationId) return;
        void publishSocketEventToChat(conversationId, EVENTS.CHAT.STOP_TYPING, { conversationId, userId });
      } catch (_err) {
        /* intentionally quiet */
      }
    });
  } catch (err) {
    console.error(`[CHAT] Error setting up chat event listeners:`, err);
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

const listenDrawEvent = (socket) => {
  try {
    socket.on(EVENTS.DRAW, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      // Broadcast the offer to the other connected peers
      // console.log(`toUserSocketId --- `, toUserSocketId);
      // console.log(`socket req ==== `, socketReq, socket.id)
      relayPeerByUserId(userInfo?.to_user,EVENTS.EMIT_DRAWING_CORDS, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to draw event:`, err);
    throw err;
  }
};

const stopDrawEvent = (socket) => {
  try {
    socket.on(EVENTS.STOP_DRAWING, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );

      relayPeerByUserId(userInfo?.to_user,EVENTS.EMIT_STOP_DRAWING, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to stop draw event:`, err);
    throw err;
  }
};

const listenVideoShowEvent = (socket) => {
  try {
    socket.on(EVENTS.ON_VIDEO_SHOW, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      relayPeerByUserId(userInfo?.to_user,EVENTS.ON_VIDEO_SHOW, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to video show event:`, err);
    throw err;
  }
};

const listenDrawingModeToggle = (socket) => {
  try {
    socket.on(EVENTS.TOGGLE_DRAWING_MODE, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      relayPeerByUserId(userInfo?.to_user,EVENTS.TOGGLE_DRAWING_MODE, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to drawing mode toggle:`, err);
    throw err;
  }
};

const listenFullscreenToggle = (socket) => {
  try {
    socket.on(EVENTS.TOGGLE_FULL_SCREEN, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      relayPeerByUserId(userInfo?.to_user,EVENTS.TOGGLE_FULL_SCREEN, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to fullscreen toggle:`, err);
    throw err;
  }
};

const listenLockModeToggle = (socket) => {
  try {
    socket.on(EVENTS.TOGGLE_LOCK_MODE, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      relayPeerByUserId(userInfo?.to_user,EVENTS.TOGGLE_LOCK_MODE, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to lock mode toggle:`, err);
    throw err;
  }
};

/** Instant lesson: trainer toggles "record session" so peer can show the same state in-call */
const listenInstantLessonSessionRecording = (socket) => {
  try {
    socket.on(EVENTS.INSTANT_LESSON.SESSION_RECORDING, async (socketReq: any) => {
      const { userInfo } = socketReq || {};
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      if (userInfo?.to_user) {
        relayPeerByUserId(userInfo?.to_user,EVENTS.INSTANT_LESSON.SESSION_RECORDING, socketReq);
      }
    });
  } catch (err) {
    console.error(`Error while listening to instant lesson session recording:`, err);
    throw err;
  }
};



const listenVideoPositionEvent = (socket) => {
  try {
    socket.on(EVENTS.ON_VIDEO_ZOOM_PAN, async (socketReq, request) => {
      const { userInfo, sessionId } = socketReq;
      // Prefer session room so trainee receives zoom/pan even after reconnect
      if (sessionId && mongoose.isValidObjectId(sessionId)) {
        const roomName = `session:${sessionId}`;
        socket.to(roomName).emit(EVENTS.ON_VIDEO_ZOOM_PAN, socketReq);
      } else {
        const toUserSocketId = MemCache.getDetail(
          process.env.SOCKET_CONFIG,
          userInfo?.to_user
        );
        if (userInfo?.to_user) {
          relayPeerByUserId(userInfo?.to_user,EVENTS.ON_VIDEO_ZOOM_PAN, socketReq);
        }
      }
    });
  } catch (err) {
    console.error(`Error while listening to video position event:`, err);
    throw err;
  }
};

const listenMeetingTileLayoutEvent = (socket) => {
  try {
    socket.on(EVENTS.MEETING_TILE_LAYOUT, async (socketReq) => {
      const { userInfo, sessionId } = socketReq || {};
      if (sessionId && mongoose.isValidObjectId(sessionId)) {
        const roomName = `session:${sessionId}`;
        socket.to(roomName).emit(EVENTS.MEETING_TILE_LAYOUT, socketReq);
      } else {
        const toUserSocketId = MemCache.getDetail(
          process.env.SOCKET_CONFIG,
          userInfo?.to_user
        );
        if (userInfo?.to_user) {
          relayPeerByUserId(userInfo?.to_user,EVENTS.MEETING_TILE_LAYOUT, socketReq);
        }
      }
    });
  } catch (err) {
    console.error(`Error while listening to meeting tile layout:`, err);
    throw err;
  }
};

const listenShowVideoEvent = (socket) => {
  try {
    socket.on(EVENTS.ON_VIDEO_SELECT, async (socketReq, request) => {
      const { userInfo, sessionId } = socketReq || {};

      // Prefer session room broadcast so updates reach the peer even if the
      // userId->socketId mapping is stale (reconnects, multi-device, etc).
      if (sessionId && mongoose.isValidObjectId(sessionId)) {
        const roomName = `session:${sessionId}`;
        socket.to(roomName).emit(EVENTS.ON_VIDEO_SELECT, socketReq);
      } else {
        const toUserSocketId = MemCache.getDetail(
          process.env.SOCKET_CONFIG,
          userInfo?.to_user
        );
        if (userInfo?.to_user) {
          relayPeerByUserId(userInfo?.to_user,EVENTS.ON_VIDEO_SELECT, socketReq);
        }
      }
    });
  } catch (err) {
    console.error(`Error while listening to show video event:`, err);
    throw err;
  }
};

const listenCallEndEvent = (socket) => {
  try {
    socket.on(EVENTS.CALL_END, async (socketReq, request) => {
      const { userInfo } = socketReq;
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        userInfo?.to_user
      );
      relayPeerByUserId(userInfo?.to_user,EVENTS.CALL_END, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to call end event:`, err);
    throw err;
  }
};

const listenPlayPauseVideoEvent = (socket) => {
  try {
    socket.on(EVENTS.ON_VIDEO_PLAY_PAUSE, async (socketReq, request) => {
      const { userInfo, sessionId } = socketReq;
      if (sessionId && mongoose.isValidObjectId(sessionId)) {
        const roomName = `session:${sessionId}`;
        socket.to(roomName).emit(EVENTS.ON_VIDEO_PLAY_PAUSE, socketReq);
      } else {
        const toUserSocketId = MemCache.getDetail(
          process.env.SOCKET_CONFIG,
          userInfo?.to_user
        );
        if (userInfo?.to_user) {
          relayPeerByUserId(userInfo?.to_user,EVENTS.ON_VIDEO_PLAY_PAUSE, socketReq);
        }
      }
    });
  } catch (err) {
    console.error(`Error while listening to play pause video event:`, err);
    throw err;
  }
};
const listenVideoTimeEvent = (socket) => {
  try {
    socket.on(EVENTS.ON_VIDEO_TIME, async (socketReq, request) => {
      const { userInfo, sessionId } = socketReq;
      if (sessionId && mongoose.isValidObjectId(sessionId)) {
        const roomName = `session:${sessionId}`;
        socket.to(roomName).emit(EVENTS.ON_VIDEO_TIME, socketReq);
      } else {
        const toUserSocketId = MemCache.getDetail(
          process.env.SOCKET_CONFIG,
          userInfo?.to_user
        );
        if (userInfo?.to_user) {
          relayPeerByUserId(userInfo?.to_user,EVENTS.ON_VIDEO_TIME, socketReq);
        }
      }
    });
  } catch (err) {
    console.error(`Error while listening to video time event:`, err);
    throw err;
  }
};

const generatePreSignedPutUrl = async (fileName, fileType) => {
  const params = {
    Bucket: S3_BUCKET,
    Key: fileName,
    Expires: 60,
    // ACL: "public-read",
    ContentType: fileType,
  };

  let url;
  try {
    url = await s3.getSignedUrlPromise("putObject", params);
  } catch (err) {
    console.error("Error generating pre-signed URL:", err);
    // do something with the error here
    // and abort the operation.
    return;
  }
  return url;
};

const chunks = []; // Array to store received chunks
let videoData: any;
let ffmpegProcess: any;

const listenVideoChunksEvent = (socket) => {
  socket.on("chunk", (chunkData) => {
    const actualChunk = Buffer.from(chunkData?.data); // Assuming chunkData.data is the correct field

    // chunks.push(actualChunk);
    chunks.push(...chunkData?.data); // Push the buffers directly
  });

  socket.on("videoUploadData", (data) => {
    videoData = data;
  });


  // socket.on(EVENTS.ON_DISCONNECT, () => {
  //   console.log(`socket disconnected`);
  //   try {
  //     console.log("All chunks received", chunks);

  //     // Ensure that chunks array is defined
  //     if (!Array.isArray(chunks)) {
  //       console.log("Invalid chunks array");
  //       return;
  //     }

  //     // Concatenate all chunks into a single buffer
  //     const combinedBuffer = Buffer.concat(chunks);

  //     // Write the buffer to a file
  //     const fileName = `webcam-${Date.now()}.mp4`;

  //     //const writable = fs.createWriteStream(fileName);
  //     //const readable = Readable.from([combinedBuffer]);
  //     //readable.pipe(writable);

  //     // writable.on("finish", () => {
  //     //   console.log("Video file saved:", fileName);
  //     // });

  //     const ffmpegArgs = [
  //       "-i",
  //       "pipe:0",
  //       "-c:v",
  //       "libx264",
  //       "-crf",
  //       "18",
  //       "-c:a",
  //       "aac",
  //       "-b:a",
  //       "128k",
  //       "-movflags",
  //       "frag_keyframe+empty_moov",
  //       "-f",
  //       "mp4",
  //       "pipe:1"
  //     ];
  //     // ffmpegArgs.push("-v", "debug");
  //     ffmpegProcess = spawn("ffmpeg", ffmpegArgs);
  //     ffmpegProcess.stdin.write(combinedBuffer);
  //     ffmpegProcess.stdin.end();
  //     // ffmpegProcess.stdout.on("data", (data) => {
  //     //   console.log(`child stdout:\n${data.toString()}`);
  //     // });
  //     ffmpegProcess.stderr.on("data", (data) => {
  //       console.log("ffmpeg stdout:", data.toString());
  //     });

  //     ffmpegProcess.on("exit", function (code, signal) {
  //       console.log(
  //         "child process exited with " + `code ${code} and signal ${signal}`
  //       );
  //     });

  //     const outputFilePath = fileName;
  //     const fileStream = fs.createWriteStream(outputFilePath);
  //     ffmpegProcess.stdout.pipe(fileStream);

  //     const payload = {
  //       file_name: fileName,
  //       fileType: "video/mp4",
  //       title: "Meeting recording",
  //       category: "Recording",
  //       sessions: videoData?.sessions,
  //       trainer: videoData?.trainer,
  //       trainee: videoData?.trainee,
  //       user_id: videoData?.user_id,
  //       trainee_name: videoData?.trainee_name,
  //       trainer_name: videoData?.trainer_name
  //     };

  //     ffmpegProcess.on("close", (code) => {
  //       if (code !== 0) {
  //         console.error("FFmpeg exited with non-zero code:", code);
  //         // Handle conversion failure - e.g., notify user, log error, retry
  //       } else {
  //         console.log("Conversion successful!");
  //         console.log("Stream readable:", ffmpegProcess.stdout.readable);
  //         const fileData = fs.readFileSync(fileName);
  //         generatePreSignedPutUrl(fileName, "video/mp4").then(async (url) => {
  //           await axios
  //             .put(url, fileData, {
  //               headers: { "Content-Type": "video/*" }
  //             })
  //             .then(async (response) => {
  //               const savedSessionObj = new savedSession(payload);
  //               var savedSessionData = await savedSessionObj.save();
  //               console.log("SaveSession ", savedSessionData);
  //               console.log(`response while uploading video `, response);
  //               fs.unlink(fileName, (err) => {
  //                 if (err)
  //                   console.error("Error deleting file after upload:", err);
  //               });
  //             })
  //             .catch((error) => {
  //               console.log(`error while uploading video `, error);
  //             });
  //         });
  //         // ... (S3 upload logic as before) ...
  //       }
  //     });
  //     if (chunks.length > 0) {
  //       console.log("Called");
  //     }

  //     // Write the buffer to a file
  //     //   const fileName = `output-${Date.now()}.webm`;
  //     //   const writable = fs.createWriteStream(fileName);
  //     //   const readable = Readable.from([combinedBuffer]);
  //     //   readable.pipe(writable);

  //     //   writable.on('finish', () => {
  //     //       console.log('Video file saved:', fileName);
  //     //   });

  //     // const myHeaders = new Headers({ "Content-Type": "video/*" });
  //     // const fileName = `webcam-${Date.now()}.webm`;

  //     // const payload = {
  //     //   file_name: fileName,
  //     //   fileType: "video/webm",
  //     //   title: "Meeting recording",
  //     //   category: "Recording",
  //     //   sessions: videoData?.sessions,
  //     //   trainer: videoData?.trainer,
  //     //   trainee: videoData?.trainee,
  //     //   user_id: videoData?.user_id,
  //     //   trainee_name: videoData?.trainee_name,
  //     //   trainer_name: videoData?.trainer_name
  //     // };
  //     // if (chunks.length > 0) {
  //     //   generatePreSignedPutUrl(fileName, "video/webm").then(async (url) => {
  //     //     await axios
  //     //       .put(url, combinedBuffer, {
  //     //         headers: myHeaders
  //     //       })
  //     //       .then(async (response) => {
  //     //         const savedSessionObj = new savedSession(payload);
  //     //         var savedSessionData = await savedSessionObj.save();
  //     //         console.log("SaveSession ", savedSessionData);
  //     //         console.log(`response while uploading video `, response);
  //     //       })
  //     //       .catch((error) => {
  //     //         console.log(`error while uploading video `, error);
  //     //       });
  //     //   });
  //     // }

  //     chunks.length = 0;
  //   } catch (error) {
  //     console.log("Error processing chunks:", error);
  //   }
  // });
};

/**
  * Position:
  * The basic syntax is overlay=x:y, where x and y are the coordinates for the top-left corner of the watermark.

  * Top-left corner: overlay=0:0
  * Top-right corner: overlay=main_w-overlay_w:0
  * Bottom-left corner: overlay=0:main_h-overlay_h
  * Bottom-right corner: overlay=main_w-overlay_w:main_h-overlay_h
  * Center: overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2

  * You can also add or subtract pixels for fine-tuning, e.g., overlay=main_w-overlay_w-10:main_h-overlay_h-10
  Transparency:
  * Add transparency to the watermark: overlay=x:y:alpha=0.5
  * This sets the watermark to 50% opacity. Adjust the value (0.0 to 1.0) as needed.
  * Scaling:
  * Scale the watermark: overlay=x:y:scale=0.5
  * This scales the watermark to 50% of its original size.
  * Timing:
  * Apply watermark after 5 seconds: overlay=x:y:enable='gte(t,5)'
  * Remove watermark after 15 seconds: overlay=x:y:enable='between(t,5,15)'
  * Combining options:
  * You can combine these options. For example:
  * overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:alpha=0.7:scale=0.5
  * 
  * const watermarkX = "(main_w-overlay_w)/2";  // Center horizontally
  * const watermarkY = "(main_h-overlay_h)/2";  // Center vertically
  * const watermarkOpacity = 0.7;  // 70% opacity

  * const ffmpegArgs = [
    "-filter_complex", `overlay=${watermarkX}:${watermarkY}:alpha=${watermarkOpacity}`,
  ];
 */