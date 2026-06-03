import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import clip from "../../model/clip.schema";
import { SESSION_EXTENSION } from "../../config/sessionExtension";
import { SessionExtensionService } from "../trainee/sessionExtensionService";
import {
  computeJoinPolicy,
  mergeJoinPolicyWithCallSlot,
} from "../../helpers/liveLessonRules";
import {
  computeMixedClientWarning,
  getPeerLessonClientKind,
  type LessonClientKind,
} from "../../helpers/lesson/lessonClientTelemetry";
import { getLessonCallSlotStatus } from "../socket/lessonCallSlotStore";
import { getLessonTimerSnapshot } from "../socket/socket.service";

const extensionService = new SessionExtensionService();

function formatClipRow(c: any) {
  const thumb = c?.thumbnail ?? c?.thumbnail_url ?? null;
  const fileName = c?.file_name ?? c?.filename ?? c?.file_id ?? null;
  return {
    _id: String(c._id),
    title: String(c.title ?? c.name ?? "Clip"),
    thumbnail: thumb != null ? String(thumb) : null,
    category: c.category ?? null,
    file_name: fileName != null ? String(fileName) : null,
  };
}

export async function getSessionJoinReadiness(
  bookingId: string,
  userId: string,
  accountType: string,
  opts?: {
    authSessionId?: string;
    deviceId?: string;
    viewerClientKind?: LessonClientKind;
  }
) {
  if (!mongoose.isValidObjectId(bookingId)) return null;

  const rows = await booked_session.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(bookingId) } },
    {
      $lookup: {
        from: clip.collection.name,
        localField: "trainee_clip",
        foreignField: "_id",
        as: "trainee_clips",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "trainer_id",
        foreignField: "_id",
        as: "trainer_info",
        pipeline: [{ $project: { _id: 1, fullname: 1, profile_picture: 1 } }],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "trainee_id",
        foreignField: "_id",
        as: "trainee_info",
        pipeline: [{ $project: { _id: 1, fullname: 1, profile_picture: 1 } }],
      },
    },
    {
      $addFields: {
        trainer_info: { $arrayElemAt: ["$trainer_info", 0] },
        trainee_info: { $arrayElemAt: ["$trainee_info", 0] },
      },
    },
  ]);

  const row = rows[0];
  if (!row) return null;

  const isTrainer = accountType === "Trainer";
  const ownerId = isTrainer ? String(row.trainer_id) : String(row.trainee_id);
  if (ownerId !== String(userId)) return null;

  const peer = isTrainer ? row.trainee_info : row.trainer_info;
  const clips = (Array.isArray(row.trainee_clips) ? row.trainee_clips : []).map(
    formatClipRow
  );

  const slot = await getLessonCallSlotStatus({
    sessionId: bookingId,
    userId: String(userId),
    authSessionId: opts?.authSessionId,
    deviceId: opts?.deviceId,
  });

  const joinPolicy = mergeJoinPolicyWithCallSlot(
    computeJoinPolicy({
      is_instant: !!row.is_instant,
      status: row.status,
      instant_phase: row.instant_phase,
      accepted_at: row.accepted_at,
      accept_deadline_at: row.accept_deadline_at,
      join_deadline_at: row.join_deadline_at,
      start_time: row.start_time,
      end_time: row.end_time,
      both_joined_at: row.both_joined_at,
      first_joined_at: row.first_joined_at,
    }),
    slot
  );

  const timer = getLessonTimerSnapshot(bookingId);
  const durationMinutes =
    row.duration_minutes ??
    (row.start_time && row.end_time
      ? Math.round(
          (new Date(row.end_time).getTime() - new Date(row.start_time).getTime()) /
            60_000
        )
      : null);

  let extensionPreview: {
    minutes: number;
    amount: number;
    allowed: boolean;
    reason?: string;
  } | null = null;

  if (!isTrainer) {
    const quoteRes = await extensionService.getQuote(
      bookingId,
      10,
      String(userId)
    );
    const quote = (quoteRes as any)?.result ?? {};
    extensionPreview = {
      minutes: 10,
      amount: Number(quote?.amount ?? 0),
      allowed: quote?.allowed !== false && Number(quote?.amount ?? 0) >= 0,
      reason: quote?.reason ?? undefined,
    };
  } else {
    extensionPreview = {
      minutes: SESSION_EXTENSION.BLOCK_MINUTES[1],
      amount: 0,
      allowed: false,
    };
  }

  return {
    sessionId: String(row._id),
    status: row.status,
    is_instant: !!row.is_instant,
    instant_phase: row.instant_phase ?? null,
    duration_minutes: durationMinutes,
    booked_date: row.booked_date,
    session_start_time: row.session_start_time,
    session_end_time: row.session_end_time,
    time_zone: row.time_zone ?? null,
    join_deadline_at: row.join_deadline_at ?? null,
    accept_deadline_at: row.accept_deadline_at ?? null,
    peer: peer
      ? {
          _id: String(peer._id),
          fullname: peer.fullname ?? null,
          profile_picture: peer.profile_picture ?? null,
          role: isTrainer ? "trainee" : "trainer",
        }
      : null,
    clips,
    clip_count: clips.length,
    call_slot: slot,
    join_policy: joinPolicy,
    can_join: joinPolicy.can_join,
    join_block_reason: joinPolicy.block_reason,
    join_code: joinPolicy.join_code,
    timer: timer
      ? {
          remainingSeconds: timer.remainingSeconds,
          status: timer.status,
        }
      : null,
    extension_preview: extensionPreview,
    iceServers: Array.isArray(row.iceServers) ? row.iceServers : [],
    lesson_client_requirement: "native_app" as const,
    mixed_client_warning: await (async () => {
      const viewerClient = opts?.viewerClientKind ?? "unknown";
      const peerClient = await getPeerLessonClientKind({
        sessionId: bookingId,
        viewerUserId: String(userId),
        isTrainer,
      });
      return computeMixedClientWarning({
        viewerClient,
        peerClient,
        peerRole: isTrainer ? "trainee" : "trainer",
      });
    })(),
    peer_client_kind:
      (await getPeerLessonClientKind({
        sessionId: bookingId,
        viewerUserId: String(userId),
        isTrainer,
      })) ?? null,
    viewer_client_kind: opts?.viewerClientKind ?? null,
    recommended_clients: ["native_app"],
  };
}
