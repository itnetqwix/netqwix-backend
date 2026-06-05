/**
 * ON_CALL_JOIN — slot claim, room join, timer hydration, peer relay.
 */

import mongoose from "mongoose";
import { MemCache } from "../../../Utils/memCache";
import { EVENTS } from "../../../config/constance";
import booked_session from "../../../model/booked_sessions.schema";
import { hydrateLessonSessionFromRedis } from "../lessonTimerStore";
import { claimLessonCallSlot } from "../lessonCallSlotStore";
import {
  cancelLessonDisconnectGrace,
  emitLessonStateSync,
  lessonRoomEmit,
  lessonSessionsGet,
  lessonSessionsSet,
  maybeAutoStartLessonTimer,
  relayPeerByUserId,
  scheduleLessonEnd,
  type LessonSessionState,
} from "../socket.service";

export async function processOnCallJoin(
  socket: any,
  { userInfo }: { userInfo?: any }
): Promise<void> {
  const toUserId = MemCache.getDetail(process.env.SOCKET_CONFIG, userInfo?.to_user);

  console.log("[VideoCall:ON_CALL_JOIN] 🔍 MemCache socket lookup:", {
    from_user: userInfo?.from_user,
    to_user: userInfo?.to_user,
    peerId: userInfo?.peerId,
    toUserSocketId: toUserId || "❌ NOT FOUND IN MEMCACHE",
    socketConfigKey: process.env.SOCKET_CONFIG,
    WARNING: !toUserId
      ? "⚠️ Target user socket not in MemCache — ON_CALL_JOIN will NOT reach them. Is the other user connected?"
      : undefined,
    WARNING_peerId: !userInfo?.peerId
      ? "⚠️ peerId is missing in userInfo — trainer cannot dial trainee without peerId!"
      : undefined,
  });

  if (!toUserId) {
    console.warn("[VideoCall:ON_CALL_JOIN] No socket mapping found for target user", {
      to_user: userInfo?.to_user,
      from_user: userInfo?.from_user,
      peerId: userInfo?.peerId,
    });
  }

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
      const slotMeta = await booked_session.findById(sessionId).select("is_instant").lean();
      isInstantLesson = !!slotMeta?.is_instant;
    } catch {
      /* non-fatal */
    }

    try {
      const { recordLessonParticipantClient } = require("../../helpers/lesson/lessonClientTelemetry");
      await recordLessonParticipantClient({
        sessionId: String(sessionId),
        userId: String(userId),
        accountType: String(accountType ?? ""),
        clientKind: (socket as any).nqLessonClientKind ?? "unknown",
      });
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

    const roomName = `session:${sessionId}`;
    socket.join(roomName);
    cancelLessonDisconnectGrace(sessionId, String(userId));
    console.log(
      `[SESSION] User ${userId} (${accountType}) joined room ${roomName} for session ${sessionId}`
    );

    let session = lessonSessionsGet(sessionId);
    if (!session) {
      session = (await hydrateLessonSessionFromRedis(String(sessionId))) as
        | LessonSessionState
        | undefined;
    }
    if (!session) {
      try {
        const bookedSession = await booked_session.findById(sessionId);
        if (bookedSession) {
          let durationSeconds = 30 * 60;
          if (bookedSession.is_instant && bookedSession.duration_minutes) {
            const mins = Number(bookedSession.duration_minutes);
            if (mins > 0) durationSeconds = mins * 60;
          } else if (bookedSession.start_time && bookedSession.end_time) {
            durationSeconds = Math.floor(
              (bookedSession.end_time.getTime() - bookedSession.start_time.getTime()) / 1000
            );
          } else if (bookedSession.session_start_time && bookedSession.session_end_time) {
            const [startH, startM] = bookedSession.session_start_time.split(":").map(Number);
            const [endH, endM] = bookedSession.session_end_time.split(":").map(Number);
            const startMinutes = startH * 60 + startM;
            let endMinutes = endH * 60 + endM;
            if (endMinutes < startMinutes) {
              endMinutes += 24 * 60;
            }
            durationSeconds = (endMinutes - startMinutes) * 60;
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
      if (accountType === "Trainer") {
        session.coachJoined = true;
        if (session.coachFirstJoinedAt == null) {
          session.coachFirstJoinedAt = Date.now();
        }
        console.log(
          `[TIMER] Trainer ${userId} joined session ${sessionId}. Coach joined: ${session.coachJoined}, User joined: ${session.userJoined}`
        );
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
        console.log(
          `[TIMER] Trainee ${userId} joined session ${sessionId}. Coach joined: ${session.coachJoined}, User joined: ${session.userJoined}`
        );
        socket.to(roomName).emit("PARTICIPANT_STATUS_CHANGED", {
          sessionId,
          role: "trainee",
          status: "connected",
          userId,
        });
      }

      maybeAutoStartLessonTimer(socket, roomName, session);

      const otherSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, userInfo?.to_user);
      if (otherSocketId) {
        const otherSocket = socket.nsp.sockets.get(otherSocketId);
        if (otherSocket) {
          otherSocket.join(roomName);
          otherSocket.emit(EVENTS.VIDEO_CALL.ON_CALL_JOIN, {
            userInfo: {
              ...userInfo,
              joinedUserId: userId,
              accountType: accountType,
            },
          });
          console.log(
            `[SESSION] Notified other party ${userInfo?.to_user} that ${userId} (${accountType}) joined session ${sessionId}`
          );
        }
      }

      if (accountType === "Trainer" && session.status === "paused" && session.trainerLeftPaused) {
        session.startedAt = Date.now();
        session.status = "running";
        session.trainerLeftPaused = false;
        console.log(
          `[TIMER] Auto-resuming timer for session ${sessionId} after trainer rejoin. Remaining: ${session.remainingSeconds}s`
        );

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

      emitLessonStateSync(socket, roomName, session);

      if (session.status === "running" && session.startedAt != null) {
        const timerPayload = {
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          duration: session.duration,
          remainingSeconds: session.remainingSeconds,
        };
        socket.emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);
        console.log(
          `[TIMER] [${new Date().toISOString()}] Sent existing timer state to joining/reconnecting user for session ${sessionId}`
        );
      }

      lessonSessionsSet(sessionId, session);
    }
  }

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
}
