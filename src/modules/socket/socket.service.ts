import { Readable } from "stream";
import { MemCache } from "../../Utils/memCache";
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
import { s3, S3_BUCKET } from "../../Utils/s3Client";
import { touchUserPresence } from "../../helpers/userActivity";
import { NotificationsService } from "../notifications/notificationsService";

const pushService = new NotificationsService();
const logoPath = path.resolve(__dirname, "../../assets/netqwix_logo.png");

//NOTE -  Set VAPID details
webpush.setVapidDetails(
  "mailto:example@yourdomain.org",
  process.env.WEB_PUSH_PUBLIC_KEY,
  process.env.WEB_PUSH_PRIVATE_KEY
);

let activeUsers = {};
let ioInstance: any = null; // Store io instance for emitting events from services
/** Set once `emitBookingStatusUpdated` is defined (handlers above need a late binding). */
let emitBookingStatusUpdatedDelegate: ((bookingData: any) => Promise<void>) | null = null;

// Set the io instance (called from socket init)
export const setIoInstance = (io: any) => {
  ioInstance = io;
  
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
        // Notify peers in the same room that this socket is stale
        staleSocket.rooms.forEach((roomName) => {
          if (roomName.startsWith("session:")) {
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
  warningTimeoutId?: NodeJS.Timeout | null;
  endTimeoutId?: NodeJS.Timeout | null;
};

const lessonSessions: Map<string, LessonSessionState> = new Map();

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
  if (ioInstance) ioInstance.to(roomName).emit(event, payload);
}

function finalizeLessonParticipantDisconnect(
  sessionId: string,
  roomName: string,
  role: "trainer" | "trainee",
  disconnectedUserId: string,
) {
  const session = lessonSessions.get(sessionId);
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
  };

  if (ioInstance) ioInstance.to(roomName).emit("LESSON_STATE_SYNC", statePayload);
  else socket.nsp.to(roomName).emit("LESSON_STATE_SYNC", statePayload);
};

const clearLessonTimeouts = (session: LessonSessionState) => {
  if (session.warningTimeoutId) clearTimeout(session.warningTimeoutId);
  if (session.endTimeoutId) clearTimeout(session.endTimeoutId);
  session.warningTimeoutId = null;
  session.endTimeoutId = null;
};

const scheduleLessonEnd = (socket: any, roomName: string, session: LessonSessionState) => {
  clearLessonTimeouts(session);

  const remainingMs = Math.max(0, session.remainingSeconds) * 1000;
  if (remainingMs <= 0) {
    session.status = "ended";
    const endedPayload = {
      sessionId: session.sessionId,
      endedAt: new Date().toISOString(),
    };
    if (ioInstance) ioInstance.to(roomName).emit(EVENTS.LESSON_TIMER.ENDED, endedPayload);
    else socket.nsp.to(roomName).emit(EVENTS.LESSON_TIMER.ENDED, endedPayload);
    emitLessonStateSync(socket, roomName, session);
    lessonSessions.delete(session.sessionId);
    return;
  }

  session.endTimeoutId = setTimeout(() => {
    session.remainingSeconds = 0;
    session.startedAt = null;
    session.status = "ended";
    const endedPayload = {
      sessionId: session.sessionId,
      endedAt: new Date().toISOString(),
    };
    if (ioInstance) ioInstance.to(roomName).emit(EVENTS.LESSON_TIMER.ENDED, endedPayload);
    else socket.nsp.to(roomName).emit(EVENTS.LESSON_TIMER.ENDED, endedPayload);
    emitLessonStateSync(socket, roomName, session);
    lessonSessions.delete(session.sessionId);
  }, remainingMs);
};

// Update user's activity status
async function updateUserActivity(socket) {
  try {
    const userId = String(socket.user._id);

    // Add the current user to the active users list

    if (socket?.user?._doc?.account_type === "Trainer") {
      activeUsers[userId] = { ...socket.user._doc };
      if (socket.user._doc._id) {
        const trainerId = String(socket.user._doc._id);
        const checkIfUserIsAlreadyAdded = await onlineUser.findOne({
          trainer_id: trainerId,
        });

        if (checkIfUserIsAlreadyAdded) {
          await onlineUser.updateOne(
            { trainer_id: trainerId },
            { $set: { last_activity_time: Date.now() } }
          );
        } else {
          await new onlineUser({
            trainer_id: trainerId,
            last_activity_time: Date.now(),
          }).save();
        }
        void touchUserPresence(trainerId);
      }
    } else if (socket?.user?._doc?.account_type === "Trainee") {
      activeUsers[userId] = { ...socket.user._doc };
      void touchUserPresence(userId);
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

    socket.on("disconnect", async () => {
      if (!activeUsers[userId]) return;

      const wasTrainer = activeUsers[userId]?.account_type === "Trainer";

      delete activeUsers[userId];

      user.findByIdAndUpdate(userId, { lastSeen: new Date() }).catch(() => {});

      socket.broadcast.emit("userStatus", {
        user: activeUsers,
        status: "offline",
        userId,
      });

      if (wasTrainer) {
        try {
          await onlineUser.updateOne(
            { trainer_id: userId },
            { $set: { last_activity_time: Date.now() } },
            { upsert: true }
          );
        } catch (error) {
          console.error("Error updating last_activity_time on disconnect:", error);
        }
      }

      // Lesson leave / timer pause / PARTICIPANT_LEFT are handled in handleSocketEvents
      // with a reconnect grace period (see finalizeLessonParticipantDisconnect).
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
  
  // Initialize heartbeat tracking for this socket
  socketHeartbeats.set(socketId, Date.now());

  // Cleanup heartbeat tracking on disconnect
  socket.on("disconnect", () => {
    socketHeartbeats.delete(socketId);
    
    const accountType = socket?.user?._doc?.account_type || socket?.user?.account_type;
    const userId = socket?.user?._doc?._id || socket?.user?._id;
    if (!userId) return;

    socket.rooms.forEach((roomName) => {
      if (!roomName.startsWith("session:")) return;
      const sessionId = roomName.replace("session:", "");
      const session = lessonSessions.get(sessionId);
      if (!session) return;

      const role = accountType === "Trainer" ? "trainer" : "trainee";
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
    const uid = socket?.user?._doc?._id || socket?.user?._id;
    if (uid) void touchUserPresence(String(uid));
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
    if (!toUserId) {
      console.warn("[VideoCall:ON_OFFER] Target socket missing", {
        from_user: userInfo?.from_user,
        to_user: userInfo?.to_user,
      });
      return;
    }
    socket.to(toUserId).emit("offer", offer);
    // TODO:for now broadcasting the event, it needs to send to specific user.
    // socket.broadcast.emit('offer', offer);
  });

  socket.on(EVENTS.VIDEO_CALL.ON_CALL_JOIN, async ({ userInfo }) => {
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
      // Join the room immediately when user joins (don't wait for both parties)
      const roomName = `session:${sessionId}`;
      socket.join(roomName);
      cancelLessonDisconnectGrace(sessionId, String(userId));
      console.log(`[SESSION] User ${userId} (${accountType}) joined room ${roomName} for session ${sessionId}`);
      
      let session = lessonSessions.get(sessionId);
      if (!session) {
        // Fetch booked session to get duration
        try {
          const bookedSession = await booked_session.findById(sessionId);
          if (bookedSession) {
            // Calculate duration from start_time and end_time (Date objects) if available
            // Otherwise calculate from session_start_time and session_end_time (string HH:mm)
            let durationSeconds = 30 * 60; // default 30 minutes
            if (bookedSession.start_time && bookedSession.end_time) {
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
            };
            lessonSessions.set(sessionId, session);
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
          console.log(`[TIMER] Trainer ${userId} joined session ${sessionId}. Coach joined: ${session.coachJoined}, User joined: ${session.userJoined}`);
          socket.to(roomName).emit("PARTICIPANT_STATUS_CHANGED", {
            sessionId,
            role: "trainer",
            status: "connected",
            userId,
          });
        } else {
          session.userJoined = true;
          console.log(`[TIMER] Trainee ${userId} joined session ${sessionId}. Coach joined: ${session.coachJoined}, User joined: ${session.userJoined}`);
          socket.to(roomName).emit("PARTICIPANT_STATUS_CHANGED", {
            sessionId,
            role: "trainee",
            status: "connected",
            userId,
          });
        }
        
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
          if (ioInstance) ioInstance.to(roomName).emit("LESSON_TIME_RESUMED", resumedPayload);
          else socket.nsp.to(roomName).emit("LESSON_TIME_RESUMED", resumedPayload);
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
      }
    }
    
    // Also emit to the specific user (for backward compatibility)
    if (toUserId) {
      console.log("[VideoCall:ON_CALL_JOIN] 📤 Forwarding to target socket:", {
        toUserSocketId: toUserId,
        peerId: userInfo?.peerId,
        from_user: userInfo?.from_user,
        to_user: userInfo?.to_user,
        WARNING: !userInfo?.peerId ? "⚠️ Forwarding WITHOUT peerId — trainer cannot dial!" : undefined,
      });
      socket.to(toUserId).emit(EVENTS.VIDEO_CALL.ON_CALL_JOIN, { userInfo });
    } else {
      console.error("[VideoCall:ON_CALL_JOIN] 🚨 CANNOT FORWARD — no socket ID found for to_user:", userInfo?.to_user);
    }
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
      const session = lessonSessions.get(sessionId);
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
    
    // Forward the ON_BOTH_JOIN event (for other UI purposes, not timer)
    socket.to(toUserId).emit(EVENTS.VIDEO_CALL.ON_BOTH_JOIN, { socketReq });
  });

  socket.on("LESSON_STATE_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessions.get(sessionId);
    if (!session) return;

    const roomName = `session:${sessionId}`;
    if (session.status === "running" && session.startedAt != null) {
      // Send un-adjusted remainingSeconds; frontend computes currentRemaining = remainingSeconds - (now - startedAt)
      const statePayload = {
        sessionId,
        status: "running",
        startedAt: session.startedAt,
        duration: session.duration,
        remainingSeconds: session.remainingSeconds,
        trainerConnected: session.coachJoined,
        traineeConnected: session.userJoined,
      };
      socket.emit("LESSON_STATE_SYNC", statePayload);
      return;
    }

    emitLessonStateSync(socket, roomName, session);
  });

  socket.on("LESSON_TIMER_START_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessions.get(sessionId);
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
    if (session.status === "running") return;

    const roomName = `session:${sessionId}`;
    const now = Date.now();
    session.startedAt = now;
    session.status = "running";

    const timerPayload = {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      duration: session.duration,
      remainingSeconds: session.remainingSeconds,
    };

    if (ioInstance) ioInstance.to(roomName).emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);
    else socket.nsp.to(roomName).emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);

    emitLessonStateSync(socket, roomName, session);
    scheduleLessonEnd(socket, roomName, session);
  });

  socket.on("LESSON_TIMER_PAUSE_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessions.get(sessionId);
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
    if (ioInstance) ioInstance.to(roomName).emit("LESSON_TIME_PAUSED", pausedPayload);
    else socket.nsp.to(roomName).emit("LESSON_TIME_PAUSED", pausedPayload);
    emitLessonStateSync(socket, roomName, session);
  });

  socket.on("LESSON_TIMER_RESUME_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const session = lessonSessions.get(sessionId);
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
    if (ioInstance) ioInstance.to(roomName).emit("LESSON_TIME_RESUMED", resumedPayload);
    else socket.nsp.to(roomName).emit("LESSON_TIME_RESUMED", resumedPayload);
    emitLessonStateSync(socket, roomName, session);
    scheduleLessonEnd(socket, roomName, session);
  });

  // socket.on(EVENTS.VIDEO_CALL.ON_ANSWER, (data) => {
  //     // Broadcast the answer to the other connected peers
  //     console.log(`on answer --- `, data);
  //     socket.broadcast.emit('answer', data);
  // });

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
    if (!toUserSocketId) {
      console.warn("[VideoCall:ON_ICE_CANDIDATE] Target socket missing", {
        from_user: userInfo?.from_user,
        to_user: userInfo?.to_user,
      });
      return;
    }

    // Broadcast the ICE candidate to the other connected peers
    socket.to(toUserSocketId).emit("ice-candidate", data);
  });

  socket.on(EVENTS.EMIT_CLEAR_CANVAS, (payload) => {
    const { userInfo } = payload;
    const toUserSocketId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );
    // Forward the full payload so canvasIndex reaches the recipient correctly.
    socket.to(toUserSocketId).emit(EVENTS.ON_CLEAR_CANVAS, payload);
  });

  socket.on(EVENTS.EMIT_UNDO, (payload) => {
    const { userInfo } = payload;
    const toUserSocketId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );

    socket.to(toUserSocketId).emit(EVENTS.ON_UNDO, payload);
  });

  socket.on(EVENTS.VIDEO_CALL.MUTE_ME, ({ muteStatus, userInfo }) => {
    const toUserSocketId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );

    socket.to(toUserSocketId).emit(EVENTS.VIDEO_CALL.MUTE_ME, { muteStatus });
  });

  socket.on(EVENTS.VIDEO_CALL.STOP_FEED, ({ feedStatus, userInfo }) => {
    const toUserSocketId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );
    console.log("[VideoCall:STOP_FEED]", {
      from_user: userInfo?.from_user,
      to_user: userInfo?.to_user,
      feedStatus,
      toUserSocketMapped: !!toUserSocketId,
    });
    if (!toUserSocketId) {
      console.warn("[VideoCall:STOP_FEED] Target socket missing", {
        from_user: userInfo?.from_user,
        to_user: userInfo?.to_user,
      });
      return;
    }
    socket.to(toUserSocketId).emit(EVENTS.VIDEO_CALL.STOP_FEED, { feedStatus });
  });

  socket.on(EVENTS.VIDEO_CALL.ON_CLOSE, (payload) => {
    const { userInfo } = payload;
    const toUserSocketId = MemCache.getDetail(
      process.env.SOCKET_CONFIG,
      userInfo?.to_user
    );

    socket.to(toUserSocketId).emit(EVENTS.VIDEO_CALL.ON_CLOSE, {});
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
  listenVideoPositionEvent(socket)
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
      const toUserSocketId = MemCache.getDetail(
        process.env.SOCKET_CONFIG,
        receiverId
      );
      // console.log(toUserSocketId, 'toUserSocketId')
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
      socket.to(toUserSocketId).emit(EVENTS.PUSH_NOTIFICATIONS.ON_RECEIVE, {
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

      if (!toUserSocketId && receiverId) {
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

        const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.REQUEST, {
            lessonId,
            coachId,
            traineeId,
            traineeInfo,
            duration,
            expiresAt,
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
      } catch (_err) {
        /* intentionally quiet — add app-level logging if needed */
      }
    });

    // Handle instant lesson accept
    socket.on(EVENTS.INSTANT_LESSON.ACCEPT, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        
        if (!lessonId || !coachId || !traineeId) {
          return;
        }

        let updatedBooking: any = null;
        try {
          updatedBooking = await booked_session.findOneAndUpdate(
            {
              _id: lessonId,
              is_instant: true,
              trainer_id: coachId,
              trainee_id: traineeId,
              status: BOOKED_SESSIONS_STATUS.BOOKED,
            },
            { $set: { status: BOOKED_SESSIONS_STATUS.confirm } },
            { new: true }
          );
          if (updatedBooking && emitBookingStatusUpdatedDelegate) {
            void emitBookingStatusUpdatedDelegate(updatedBooking);
          }
        } catch (_dbErr) {
          /* intentionally quiet */
        }

        // Emit to both parties
        const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
        const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);

        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.ACCEPT, {
            lessonId,
            coachId,
            traineeId,
          });
        }
        if (traineeSocketId) {
          socket.to(traineeSocketId).emit(EVENTS.INSTANT_LESSON.ACCEPT, {
            lessonId,
            coachId,
            traineeId,
          });
        } else {
          void pushService.sendPushNotification(
            traineeId,
            "Lesson Accepted",
            "Your trainer accepted the instant lesson. Tap to join!",
            { kind: "instant_lesson_accept", lessonId, coachId }
          );
        }

      } catch (_err) {
        /* intentionally quiet */
      }
    });

    // Handle instant lesson decline
    socket.on(EVENTS.INSTANT_LESSON.DECLINE, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        
        if (!lessonId || !coachId || !traineeId) {
          return;
        }

        const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);
        if (traineeSocketId) {
          socket.to(traineeSocketId).emit(EVENTS.INSTANT_LESSON.DECLINE, {
            lessonId,
            coachId,
            traineeId,
          });
        } else {
          void pushService.sendPushNotification(
            traineeId,
            "Lesson Declined",
            "The trainer declined your instant lesson request.",
            { kind: "instant_lesson_decline", lessonId }
          );
        }
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    // Handle instant lesson expire
    socket.on(EVENTS.INSTANT_LESSON.EXPIRE, async (payload: any) => {
      try {
        const { lessonId, coachId, traineeId } = payload;
        
        if (!lessonId) {
          return;
        }

        try {
          await booked_session.findOneAndUpdate(
            { _id: lessonId, is_instant: true, status: BOOKED_SESSIONS_STATUS.BOOKED },
            { $set: { status: BOOKED_SESSIONS_STATUS.cancel } }
          );
        } catch (_dbErr) { /* non-fatal */ }

        const coachSocketId = coachId ? MemCache.getDetail(process.env.SOCKET_CONFIG, coachId) : null;
        const traineeSocketId = traineeId ? MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId) : null;

        if (coachSocketId) {
          socket.to(coachSocketId).emit(EVENTS.INSTANT_LESSON.EXPIRE, {
            lessonId,
            coachId,
            traineeId,
          });
        }
        if (traineeSocketId) {
          socket.to(traineeSocketId).emit(EVENTS.INSTANT_LESSON.EXPIRE, {
            lessonId,
            coachId,
            traineeId,
          });
        } else if (traineeId) {
          void pushService.sendPushNotification(
            traineeId,
            "Lesson Expired",
            "Your instant lesson request expired. The trainer didn't respond in time.",
            { kind: "instant_lesson_expire", lessonId }
          );
        }

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

        socket.to(`chat:${conversationId}`).emit(EVENTS.CHAT.MESSAGE, payload);

        if (receiverId) {
          const receiverSid = MemCache.getDetail(process.env.SOCKET_CONFIG, String(receiverId));
          if (receiverSid) {
            socket.to(String(receiverSid)).emit(EVENTS.CHAT.MESSAGE, payload);
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
        socket.to(`chat:${conversationId}`).emit(EVENTS.CHAT.DELIVERED, {
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
        const now = new Date();
        await ChatMessage.updateMany(
          { conversationId, receiverId: readerId || socket?.user?._doc?._id, isRead: false },
          { isRead: true, status: "read", readAt: now }
        );
        socket.to(`chat:${conversationId}`).emit(EVENTS.CHAT.READ, {
          conversationId,
          readerId: readerId || String(socket?.user?._doc?._id),
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
        socket.to(`chat:${conversationId}`).emit(EVENTS.CHAT.TYPING, { conversationId, userId });
      } catch (_err) {
        /* intentionally quiet */
      }
    });

    socket.on(EVENTS.CHAT.STOP_TYPING, (payload: any) => {
      try {
        const { conversationId, userId } = payload || {};
        if (!conversationId) return;
        socket.to(`chat:${conversationId}`).emit(EVENTS.CHAT.STOP_TYPING, { conversationId, userId });
      } catch (_err) {
        /* intentionally quiet */
      }
    });
  } catch (err) {
    console.error(`[CHAT] Error setting up chat event listeners:`, err);
  }
};

// Helper functions to emit booking events from services
export const emitBookingCreated = async (bookingData: any, bookingType: 'instant' | 'scheduled' = 'scheduled') => {
  try {
    if (!ioInstance) {
      console.warn("[BOOKING] ioInstance not set, cannot emit BOOKING_CREATED event");
      return;
    }

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
      // Time information – always UTC + original logical time zone
      startTimeUtc,
      endTimeUtc,
      bookedDateUtc,
      bookingTimeZone,
    };

    // Emit to trainer
    const trainerSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, trainerId);
    if (trainerSocketId && ioInstance) {
      ioInstance.to(trainerSocketId).emit(EVENTS.BOOKING.CREATED, payload);
      console.log(`[BOOKING] BOOKING_CREATED event emitted to trainer ${trainerId}`);
    }

    // Emit to trainee
    const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);
    if (traineeSocketId && ioInstance) {
      ioInstance.to(traineeSocketId).emit(EVENTS.BOOKING.CREATED, payload);
      console.log(`[BOOKING] BOOKING_CREATED event emitted to trainee ${traineeId}`);
    }

    console.log(`[BOOKING] [${new Date().toISOString()}] Booking created: ${payload.bookingId}, type: ${bookingType}, trainer: ${trainerId}, trainee: ${traineeId}`);
  } catch (err) {
    console.error(`[BOOKING] Error emitting BOOKING_CREATED event:`, err);
  }
};

export const emitBookingStatusUpdated = async (bookingData: any) => {
  try {
    if (!ioInstance) {
      console.warn("[BOOKING] ioInstance not set, cannot emit BOOKING_STATUS_UPDATED event");
      return;
    }

    const { _id: bookingId, trainer_id, trainee_id, status, updatedAt } = bookingData;
    const trainerId = trainer_id?.toString ? trainer_id.toString() : trainer_id;
    const traineeId = trainee_id?.toString ? trainee_id.toString() : trainee_id;

    const payload = {
      bookingId: bookingId?.toString ? bookingId.toString() : bookingId,
      status,
      updatedAt: updatedAt || new Date().toISOString(),
    };

    // Emit to trainer
    const trainerSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, trainerId);
    if (trainerSocketId && ioInstance) {
      ioInstance.to(trainerSocketId).emit(EVENTS.BOOKING.STATUS_UPDATED, payload);
      console.log(`[BOOKING] BOOKING_STATUS_UPDATED event emitted to trainer ${trainerId}`);
    }

    // Emit to trainee
    const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);
    if (traineeSocketId && ioInstance) {
      ioInstance.to(traineeSocketId).emit(EVENTS.BOOKING.STATUS_UPDATED, payload);
      console.log(`[BOOKING] BOOKING_STATUS_UPDATED event emitted to trainee ${traineeId}`);
    }

    console.log(`[BOOKING] [${new Date().toISOString()}] Booking status updated: ${payload.bookingId}, status: ${status}, trainer: ${trainerId}, trainee: ${traineeId}`);
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
      socket.to(toUserSocketId).emit(EVENTS.EMIT_DRAWING_CORDS, socketReq);
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

      socket.to(toUserSocketId).emit(EVENTS.EMIT_STOP_DRAWING, socketReq);
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
      socket.to(toUserSocketId).emit(EVENTS.ON_VIDEO_SHOW, socketReq);
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
      socket.to(toUserSocketId).emit(EVENTS.TOGGLE_DRAWING_MODE, socketReq);
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
      socket.to(toUserSocketId).emit(EVENTS.TOGGLE_FULL_SCREEN, socketReq);
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
      socket.to(toUserSocketId).emit(EVENTS.TOGGLE_LOCK_MODE, socketReq);
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
      if (toUserSocketId) {
        socket.to(toUserSocketId).emit(EVENTS.INSTANT_LESSON.SESSION_RECORDING, socketReq);
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
        if (toUserSocketId) {
          socket.to(toUserSocketId).emit(EVENTS.ON_VIDEO_ZOOM_PAN, socketReq);
        }
      }
    });
  } catch (err) {
    console.error(`Error while listening to video position event:`, err);
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
        if (toUserSocketId) {
          socket.to(toUserSocketId).emit(EVENTS.ON_VIDEO_SELECT, socketReq);
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
      socket.to(toUserSocketId).emit(EVENTS.CALL_END, socketReq);
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
        if (toUserSocketId) {
          socket.to(toUserSocketId).emit(EVENTS.ON_VIDEO_PLAY_PAUSE, socketReq);
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
        if (toUserSocketId) {
          socket.to(toUserSocketId).emit(EVENTS.ON_VIDEO_TIME, socketReq);
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