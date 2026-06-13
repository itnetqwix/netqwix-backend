/**
 * WebRTC signaling relay — offer/answer/ICE, mute, feed, close.
 */

import mongoose from "mongoose";
import { EVENTS } from "../../../config/constance";
import { MemCache } from "../../../Utils/memCache";
import { publishSocketEventToUser } from "../socketEmit";
import {
  endLessonEarly,
  relayInCallBySessionOrPeer,
  relayPeerByUserId,
  socketAttachedUserId,
} from "../socket.service";

export function registerWebrtcRelayHandlers(socket: any): void {
  socket.on(EVENTS.VIDEO_CALL.ON_OFFER, ({ offer, userInfo }) => {
    const toUserId = MemCache.getDetail(process.env.SOCKET_CONFIG, userInfo?.to_user);
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
  });

  socket.on(EVENTS.VIDEO_CALL.ON_ANSWER, ({ answer, userInfo }) => {
    const toUserId = MemCache.getDetail(process.env.SOCKET_CONFIG, userInfo?.to_user);
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
    const toUserSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, userInfo?.to_user);
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
    relayInCallBySessionOrPeer(socket, payload, EVENTS.ON_CLEAR_CANVAS);
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

  socket.on(EVENTS.VIDEO_CALL.ON_CLOSE, async (payload) => {
    const { userInfo } = payload ?? {};
    relayPeerByUserId(userInfo?.to_user, EVENTS.VIDEO_CALL.ON_CLOSE, {});

    const sessionId =
      userInfo?.sessionId ?? userInfo?.meetingId ?? userInfo?.lessonId;
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) return;

    const userId = socketAttachedUserId(socket);
    if (!userId) return;

    const { assertSessionParticipant } = require("../../helpers/chatBlockCheck");
    const allowed = await assertSessionParticipant(String(sessionId), String(userId));
    if (!allowed) return;

    await endLessonEarly(String(sessionId), { reason: "participant_hangup" });
  });
}
