import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import trainee_favorite_trainers from "../../model/trainee_favorite_trainers.schema";
import user from "../../model/user.schema";

const MAX_FRIENDS_PER_SIGNAL = 4;

const SESSION_TAKEN_STATUSES = ["completed", "confirmed", "booked", "upcoming"];

export type TrainerFriendPeer = {
  _id: string;
  fullname?: string;
  profile_picture?: string;
};

function toPeer(doc: {
  _id: mongoose.Types.ObjectId | string;
  fullname?: string;
  profile_picture?: string;
}): TrainerFriendPeer {
  return {
    _id: String(doc._id),
    fullname: doc.fullname,
    profile_picture: doc.profile_picture,
  };
}

function pushUniquePeer(
  map: Map<string, TrainerFriendPeer[]>,
  trainerId: string,
  peer: TrainerFriendPeer
) {
  const list = map.get(trainerId) ?? [];
  if (list.length >= MAX_FRIENDS_PER_SIGNAL) return;
  if (list.some((p) => p._id === peer._id)) return;
  list.push(peer);
  map.set(trainerId, list);
}

/**
 * Enriches trainer directory rows with friends who favorited or completed a session
 * with each coach (for discover UI — avatar stacks only).
 */
export async function attachTrainerSocialSignals(
  traineeId: string,
  trainers: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!trainers?.length || !traineeId) return trainers;

  const me: any = await user
    .findById(traineeId)
    .select("friends account_type")
    .lean();
  const accountType = String(me?.account_type ?? "").trim().toLowerCase();
  if (accountType !== "trainee") return trainers;

  const friendIds = (me?.friends ?? [])
    .map((id: unknown) => String(id))
    .filter((id: string) => mongoose.Types.ObjectId.isValid(id));
  if (!friendIds.length) return trainers;

  const friendObjectIds = friendIds.map((id) => new mongoose.Types.ObjectId(id));
  const trainerObjectIds = trainers
    .map((t) => String(t._id ?? t.trainer_id ?? ""))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!trainerObjectIds.length) return trainers;

  const [favRows, sessionPairs] = await Promise.all([
    trainee_favorite_trainers
      .find({
        trainee_id: { $in: friendObjectIds },
        trainer_id: { $in: trainerObjectIds },
      })
      .select("trainee_id trainer_id")
      .lean(),
    booked_session
      .aggregate([
        {
          $match: {
            trainee_id: { $in: friendObjectIds },
            trainer_id: { $in: trainerObjectIds },
            status: { $in: SESSION_TAKEN_STATUSES },
          },
        },
        {
          $group: {
            _id: { trainer_id: "$trainer_id", trainee_id: "$trainee_id" },
          },
        },
      ]),
  ]);

  const peerIds = new Set<string>();
  for (const row of favRows) peerIds.add(String(row.trainee_id));
  for (const row of sessionPairs) peerIds.add(String(row._id.trainee_id));

  if (!peerIds.size) return trainers;

  const peerDocs = await user
    .find({ _id: { $in: [...peerIds] } })
    .select("fullname profile_picture")
    .lean();
  const peerById = new Map(
    peerDocs.map((p) => [String(p._id), toPeer(p as { _id: mongoose.Types.ObjectId; fullname?: string; profile_picture?: string })])
  );

  const favByTrainer = new Map<string, TrainerFriendPeer[]>();
  for (const row of favRows) {
    const peer = peerById.get(String(row.trainee_id));
    if (!peer) continue;
    pushUniquePeer(favByTrainer, String(row.trainer_id), peer);
  }

  const bookedByTrainer = new Map<string, TrainerFriendPeer[]>();
  for (const row of sessionPairs) {
    const peer = peerById.get(String(row._id.trainee_id));
    if (!peer) continue;
    pushUniquePeer(bookedByTrainer, String(row._id.trainer_id), peer);
  }

  return trainers.map((t) => {
    const tid = String(t._id ?? t.trainer_id ?? "");
    return {
      ...t,
      friendsWhoFavorited: favByTrainer.get(tid) ?? [],
      friendsWhoBooked: bookedByTrainer.get(tid) ?? [],
    };
  });
}
