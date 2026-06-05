/**
 * In-call drawing, video sync, layout, and recording chunk relay handlers.
 */

import mongoose from "mongoose";
import { EVENTS } from "../../../config/constance";
import { relayInCallBySessionOrPeer, relayPeerByUserId } from "../socket.service";

const chunks: Buffer[] = [];
let videoData: any;

function relayToSessionRoomOrPeer(
  socket: any,
  socketReq: { userInfo?: { to_user?: string }; sessionId?: string },
  event: string
): void {
  const { userInfo, sessionId } = socketReq || {};
  if (sessionId && mongoose.isValidObjectId(sessionId)) {
    const roomName = `session:${sessionId}`;
    socket.to(roomName).emit(event, socketReq);
  } else if (userInfo?.to_user) {
    relayPeerByUserId(userInfo.to_user, event, socketReq);
  }
}

export function registerInCallMediaSyncHandlers(socket: any): void {
  try {
    socket.on(EVENTS.DRAW, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.EMIT_DRAWING_CORDS);
    });
    socket.on(EVENTS.EMIT_DRAWING_CORDS, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.EMIT_DRAWING_CORDS);
    });
  } catch (err) {
    console.error(`Error while listening to draw event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.STOP_DRAWING, async (socketReq) => {
      const { userInfo } = socketReq;
      relayPeerByUserId(userInfo?.to_user, EVENTS.EMIT_STOP_DRAWING, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to stop draw event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.ON_VIDEO_SHOW, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.ON_VIDEO_SHOW);
    });
    socket.on(EVENTS.ON_VIDEO_HIDE, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.ON_VIDEO_HIDE);
    });
  } catch (err) {
    console.error(`Error while listening to video show event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.TOGGLE_DRAWING_MODE, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.TOGGLE_DRAWING_MODE);
    });
  } catch (err) {
    console.error(`Error while listening to drawing mode toggle:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.TOGGLE_FULL_SCREEN, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.TOGGLE_FULL_SCREEN);
    });
  } catch (err) {
    console.error(`Error while listening to fullscreen toggle:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.TOGGLE_LOCK_MODE, async (socketReq) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.TOGGLE_LOCK_MODE);
    });
  } catch (err) {
    console.error(`Error while listening to lock mode toggle:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.INSTANT_LESSON.SESSION_RECORDING, async (socketReq: any) => {
      relayInCallBySessionOrPeer(socket, socketReq, EVENTS.INSTANT_LESSON.SESSION_RECORDING);
    });
  } catch (err) {
    console.error(`Error while listening to instant lesson session recording:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.ON_VIDEO_ZOOM_PAN, async (socketReq) => {
      relayToSessionRoomOrPeer(socket, socketReq, EVENTS.ON_VIDEO_ZOOM_PAN);
    });
  } catch (err) {
    console.error(`Error while listening to video position event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.MEETING_TILE_LAYOUT, async (socketReq) => {
      relayToSessionRoomOrPeer(socket, socketReq, EVENTS.MEETING_TILE_LAYOUT);
    });
  } catch (err) {
    console.error(`Error while listening to meeting tile layout:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.ON_VIDEO_SELECT, async (socketReq) => {
      relayToSessionRoomOrPeer(socket, socketReq, EVENTS.ON_VIDEO_SELECT);
    });
  } catch (err) {
    console.error(`Error while listening to show video event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.CALL_END, async (socketReq) => {
      const { userInfo } = socketReq;
      relayPeerByUserId(userInfo?.to_user, EVENTS.CALL_END, socketReq);
    });
  } catch (err) {
    console.error(`Error while listening to call end event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.ON_VIDEO_PLAY_PAUSE, async (socketReq) => {
      relayToSessionRoomOrPeer(socket, socketReq, EVENTS.ON_VIDEO_PLAY_PAUSE);
    });
  } catch (err) {
    console.error(`Error while listening to play pause video event:`, err);
    throw err;
  }

  try {
    socket.on(EVENTS.ON_VIDEO_TIME, async (socketReq) => {
      relayToSessionRoomOrPeer(socket, socketReq, EVENTS.ON_VIDEO_TIME);
    });
  } catch (err) {
    console.error(`Error while listening to video time event:`, err);
    throw err;
  }

  socket.on("chunk", (chunkData) => {
    chunks.push(...chunkData?.data);
  });

  socket.on("videoUploadData", (data) => {
    videoData = data;
  });
}
