/**
 * Lesson join, timer control, and live-state socket handlers.
 */

import mongoose from "mongoose";
import { EVENTS } from "../../../config/constance";
import { INSTANT_PHASE } from "../../../config/instantLesson";
import { MemCache } from "../../../Utils/memCache";
import booked_session from "../../../model/booked_sessions.schema";
import { hydrateLessonSessionFromRedis } from "../lessonTimerStore";
import { takeoverLessonCallSlot } from "../lessonCallSlotStore";
import { clearInstantLessonTimers } from "../../../helpers/instantLessonExpiry";
import {
  clearLessonTimeouts,
  emitLessonStateSync,
  endLessonEarly,
  getIo,
  lessonRoomEmit,
  lessonSessionsGet,
  relayPeerByUserId,
  scheduleLessonEnd,
  socketAttachedUserId,
  startLessonTimerInRoom,
} from "../socket.service";
import {
  addLiveNote,
  getLessonLiveStateSnapshot,
  setFocusedClip,
} from "../../session/lessonLiveStateStore";
import { processOnCallJoin } from "./lessonCallJoinHandler";

export function registerLessonTimerSocketHandlers(socket: any): void {
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
    const sessionId =
      socketReq?.sessionId ||
      socketReq?.userInfo?.sessionId ||
      socketReq?.userInfo?.meetingId ||
      socketReq?.userInfo?.lessonId;
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
        const timerPayload = {
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          duration: session.duration,
          remainingSeconds: session.remainingSeconds,
        };
        socket.emit(EVENTS.LESSON_TIMER.STARTED, timerPayload);
      }
    }

    relayPeerByUserId(socketReq.userInfo?.to_user, EVENTS.VIDEO_CALL.ON_BOTH_JOIN, {
      socketReq,
    });
  });

  socket.on("LESSON_STATE_REQUEST", async ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    await hydrateLessonSessionFromRedis(String(sessionId));
    const session = lessonSessionsGet(sessionId);
    if (!session) return;

    const roomName = `session:${sessionId}`;
    emitLessonStateSync(socket, roomName, session);

    if (session.status === "running" && session.startedAt != null) {
      socket.emit(EVENTS.LESSON_TIMER.STARTED, {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        duration: session.duration,
        remainingSeconds: session.remainingSeconds,
      });
    }
  });

  socket.on(
    "LESSON_SET_FOCUSED_CLIP",
    async (payload: { sessionId?: string; clipId?: string; clipTitle?: string }) => {
      const sessionId = String(payload?.sessionId ?? "");
      if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
      const accountType =
        socket?.user?._doc?.account_type || socket?.user?.account_type;
      if (accountType !== "Trainer") return;

      setFocusedClip(
        sessionId,
        payload?.clipId ? String(payload.clipId) : null,
        payload?.clipTitle ?? null
      );

      if (payload?.clipId && mongoose.isValidObjectId(payload.clipId)) {
        await booked_session.updateOne(
          { _id: sessionId },
          { $set: { focused_clip_id: payload.clipId } }
        );
      }

      const session = lessonSessionsGet(sessionId);
      if (session) {
        emitLessonStateSync(socket, `session:${sessionId}`, session);
      } else {
        lessonRoomEmit(`session:${sessionId}`, "LESSON_STATE_SYNC", {
          sessionId,
          liveState: getLessonLiveStateSnapshot(sessionId, "trainer"),
        });
      }
    }
  );

  socket.on(
    "LESSON_LIVE_NOTE_ADD",
    (payload: {
      sessionId?: string;
      text?: string;
      elapsedSeconds?: number;
      sharedWithTrainee?: boolean;
    }) => {
      const sessionId = String(payload?.sessionId ?? "");
      if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
      const accountType =
        socket?.user?._doc?.account_type || socket?.user?.account_type;
      if (accountType !== "Trainer") return;
      const authorId = socketAttachedUserId(socket);
      if (!authorId) return;

      addLiveNote(sessionId, {
        text: String(payload?.text ?? ""),
        authorId,
        elapsedSeconds: Number(payload?.elapsedSeconds ?? 0),
        sharedWithTrainee: !!payload?.sharedWithTrainee,
      });

      const session = lessonSessionsGet(sessionId);
      if (session) {
        emitLessonStateSync(socket, `session:${sessionId}`, session);
      } else {
        lessonRoomEmit(`session:${sessionId}`, "LESSON_STATE_SYNC", {
          sessionId,
          liveState: getLessonLiveStateSnapshot(sessionId, "trainer"),
        });
      }
    }
  );

  socket.on("LESSON_MEDIA_REPLAY_REQUEST", ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const requesterId = socketAttachedUserId(socket);
    if (!requesterId) return;
    lessonRoomEmit(`session:${sessionId}`, "LESSON_MEDIA_REPLAY_REQUEST", {
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
      socket.emit("LESSON_TIMER_ERROR", {
        message: "Both participants must be connected before starting timer.",
      });
      return;
    }
    if (session.status === "running") return;

    const roomName = `session:${sessionId}`;
    const reason = session.isInstant ? "instant_trainer_start_request" : "trainer_manual_start";
    startLessonTimerInRoom(socket, roomName, session, reason);
  });

  socket.on("LESSON_TIMER_PAUSE_REQUEST", ({ sessionId, reason }) => {
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
    const pauseReason =
      typeof reason === "string" && reason.trim() ? reason.trim() : "trainer_manual";
    session.trainerLeftPaused = pauseReason === "trainer_left";
    clearLessonTimeouts(session);

    lessonRoomEmit(roomName, "LESSON_TIME_PAUSED", {
      sessionId: session.sessionId,
      remainingSeconds: session.remainingSeconds,
      duration: session.duration,
      reason: pauseReason,
    });
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

    lessonRoomEmit(roomName, "LESSON_TIME_RESUMED", {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      duration: session.duration,
      remainingSeconds: session.remainingSeconds,
    });
    emitLessonStateSync(socket, roomName, session);
    scheduleLessonEnd(socket, roomName, session);
  });

  socket.on(EVENTS.LESSON_TIMER.END_EARLY_REQUEST, async ({ sessionId }) => {
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;
    const userId = socketAttachedUserId(socket);
    if (!userId) return;

    const { assertSessionParticipant } = require("../../helpers/chatBlockCheck");
    const allowed = await assertSessionParticipant(String(sessionId), String(userId));
    if (!allowed) return;

    await endLessonEarly(String(sessionId), { reason: "participant_hangup" });
  });
}
