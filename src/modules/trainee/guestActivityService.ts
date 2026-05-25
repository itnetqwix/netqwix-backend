import mongoose from "mongoose";
import { log } from "../../../logger";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { isValidMongoObjectId } from "../../helpers/mongoose";
import trainee_guest_activity from "../../model/trainee_guest_activity.schema";
import user from "../../model/user.schema";

/**
 * Replay payload posted by the mobile client right after a guest signs up.
 * Mirrors `nq-mobile/src/features/auth/lib/guestActivity.ts#buildReplayPayload`.
 */
type IncomingPayload = {
  viewed?: { id?: string; t?: number }[];
  searches?: { q?: string; t?: number }[];
  favorites?: { id?: string; t?: number }[];
  events?: { kind?: string; ref?: string; t?: number }[];
};

const MAX_VIEWED = 50;
const MAX_SEARCHES = 30;
const MAX_FAVORITES = 50;
const MAX_EVENTS = 200;
const MAX_QUERY_LEN = 80;

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && isValidMongoObjectId(id);
}

function toDate(ms: unknown): Date {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n);
}

function cleanSearches(rows: IncomingPayload["searches"]): {
  q: string;
  last_searched_at: Date;
}[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: { q: string; last_searched_at: Date }[] = [];
  for (const row of rows) {
    const q = String(row?.q ?? "").trim().toLowerCase().slice(0, MAX_QUERY_LEN);
    if (q.length < 2 || seen.has(q)) continue;
    seen.add(q);
    out.push({ q, last_searched_at: toDate(row?.t) });
    if (out.length >= MAX_SEARCHES) break;
  }
  return out;
}

function mergeViewed(
  prior: any[],
  incoming: IncomingPayload["viewed"]
): {
  trainer_id: mongoose.Types.ObjectId;
  view_count: number;
  last_viewed_at: Date;
}[] {
  const accum = new Map<
    string,
    { view_count: number; last_viewed_at: Date }
  >();

  for (const row of prior ?? []) {
    const id = String(row?.trainer_id ?? "");
    if (!id) continue;
    accum.set(id, {
      view_count: Number(row?.view_count ?? 1),
      last_viewed_at: row?.last_viewed_at
        ? new Date(row.last_viewed_at)
        : new Date(0),
    });
  }
  if (Array.isArray(incoming)) {
    for (const row of incoming) {
      const id = row?.id;
      if (!isValidId(id)) continue;
      const ts = toDate(row?.t);
      const prev = accum.get(id);
      if (prev) {
        prev.view_count += 1;
        if (ts > prev.last_viewed_at) prev.last_viewed_at = ts;
      } else {
        accum.set(id, { view_count: 1, last_viewed_at: ts });
      }
    }
  }

  return [...accum.entries()]
    .sort((a, b) => b[1].last_viewed_at.getTime() - a[1].last_viewed_at.getTime())
    .slice(0, MAX_VIEWED)
    .map(([id, v]) => ({
      trainer_id: new mongoose.Types.ObjectId(id),
      view_count: v.view_count,
      last_viewed_at: v.last_viewed_at,
    }));
}

function mergeFavorites(
  prior: any[],
  incoming: IncomingPayload["favorites"]
): { trainer_id: mongoose.Types.ObjectId; favorited_at: Date }[] {
  const accum = new Map<string, Date>();
  for (const row of prior ?? []) {
    const id = String(row?.trainer_id ?? "");
    if (!id) continue;
    accum.set(id, row?.favorited_at ? new Date(row.favorited_at) : new Date(0));
  }
  if (Array.isArray(incoming)) {
    for (const row of incoming) {
      const id = row?.id;
      if (!isValidId(id)) continue;
      const ts = toDate(row?.t);
      const prev = accum.get(id);
      if (!prev || ts > prev) accum.set(id, ts);
    }
  }
  return [...accum.entries()]
    .sort((a, b) => b[1].getTime() - a[1].getTime())
    .slice(0, MAX_FAVORITES)
    .map(([id, t]) => ({
      trainer_id: new mongoose.Types.ObjectId(id),
      favorited_at: t,
    }));
}

function mergeSearches(
  prior: any[],
  incoming: IncomingPayload["searches"]
): { q: string; last_searched_at: Date }[] {
  const incomingClean = cleanSearches(incoming);
  const accum = new Map<string, Date>();
  for (const row of prior ?? []) {
    const q = String(row?.q ?? "").trim().toLowerCase();
    if (!q) continue;
    accum.set(q, row?.last_searched_at ? new Date(row.last_searched_at) : new Date(0));
  }
  for (const row of incomingClean) {
    const prev = accum.get(row.q);
    if (!prev || row.last_searched_at > prev) accum.set(row.q, row.last_searched_at);
  }
  return [...accum.entries()]
    .sort((a, b) => b[1].getTime() - a[1].getTime())
    .slice(0, MAX_SEARCHES)
    .map(([q, t]) => ({ q, last_searched_at: t }));
}

function appendEvents(
  prior: any[],
  incoming: IncomingPayload["events"]
): { kind: string; ref: string; t: Date }[] {
  const accum: { kind: string; ref: string; t: Date }[] = (prior ?? []).map((row) => ({
    kind: String(row?.kind ?? ""),
    ref: String(row?.ref ?? ""),
    t: row?.t ? new Date(row.t) : new Date(0),
  }));
  if (Array.isArray(incoming)) {
    for (const row of incoming) {
      const kind = String(row?.kind ?? "");
      const ref = String(row?.ref ?? "").slice(0, MAX_QUERY_LEN);
      if (!["view", "search", "favorite"].includes(kind) || !ref) continue;
      accum.push({ kind, ref, t: toDate(row?.t) });
    }
  }
  return accum
    .sort((a, b) => b.t.getTime() - a.t.getTime())
    .slice(0, MAX_EVENTS);
}

export class GuestActivityService {
  public log = log.getLogger();

  public async ingest(
    traineeId: string,
    payload: IncomingPayload | null | undefined
  ): Promise<ResponseBuilder> {
    try {
      if (!isValidMongoObjectId(traineeId)) {
        return ResponseBuilder.errorMessage("Invalid trainee id");
      }
      if (!payload || typeof payload !== "object") {
        return ResponseBuilder.data({ ingested: false }, "Empty guest payload");
      }
      const existing = await trainee_guest_activity
        .findOne({ trainee_id: new mongoose.Types.ObjectId(traineeId) })
        .lean();

      const viewed_trainers = mergeViewed(existing?.viewed_trainers ?? [], payload.viewed);
      const favorites_snapshot = mergeFavorites(
        existing?.favorites_snapshot ?? [],
        payload.favorites
      );
      const recent_searches = mergeSearches(
        existing?.recent_searches ?? [],
        payload.searches
      );
      const event_log = appendEvents(existing?.event_log ?? [], payload.events);

      const now = new Date();
      await trainee_guest_activity.findOneAndUpdate(
        { trainee_id: new mongoose.Types.ObjectId(traineeId) },
        {
          $set: {
            viewed_trainers,
            favorites_snapshot,
            recent_searches,
            event_log,
            last_ingested_at: now,
            consumed_at: null,
          },
        },
        { upsert: true, new: true }
      );

      /**
       * Bump a marker on the user doc so the home/discovery service can
       * cheaply detect "this trainee has guest seed data" without an extra
       * lookup on every request.
       */
      await user.updateOne(
        { _id: new mongoose.Types.ObjectId(traineeId) },
        { $set: { guest_seed_ingested_at: now } }
      );

      return ResponseBuilder.data(
        {
          ingested: true,
          viewed: viewed_trainers.length,
          favorites: favorites_snapshot.length,
          searches: recent_searches.length,
          events: event_log.length,
        },
        "Guest activity stored"
      );
    } catch (err) {
      this.log.error(err);
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  /**
   * Returns the trainers a freshly-signed-up user viewed/favorited as a
   * guest, ordered by recency × view count. Recommendation jobs / the
   * discover feed can call this to seed cold-start results.
   */
  public async getSeededTrainers(traineeId: string, limit = 12): Promise<ResponseBuilder> {
    try {
      if (!isValidMongoObjectId(traineeId)) {
        return ResponseBuilder.errorMessage("Invalid trainee id");
      }
      const doc = await trainee_guest_activity
        .findOne({ trainee_id: new mongoose.Types.ObjectId(traineeId) })
        .lean();
      if (!doc) return ResponseBuilder.data([], "No guest activity");

      const idScores = new Map<string, { score: number; last: number }>();
      for (const row of doc.viewed_trainers ?? []) {
        const id = String(row.trainer_id);
        const last = row.last_viewed_at ? new Date(row.last_viewed_at).getTime() : 0;
        idScores.set(id, {
          score: (idScores.get(id)?.score ?? 0) + Number(row.view_count ?? 1),
          last,
        });
      }
      for (const row of doc.favorites_snapshot ?? []) {
        const id = String(row.trainer_id);
        const last = row.favorited_at ? new Date(row.favorited_at).getTime() : 0;
        const prev = idScores.get(id);
        idScores.set(id, {
          score: (prev?.score ?? 0) + 5,
          last: Math.max(prev?.last ?? 0, last),
        });
      }

      const ranked = [...idScores.entries()]
        .sort((a, b) => {
          const s = b[1].score - a[1].score;
          if (s !== 0) return s;
          return b[1].last - a[1].last;
        })
        .slice(0, Math.max(1, Math.min(Number(limit) || 12, 50)))
        .map(([id]) => new mongoose.Types.ObjectId(id));

      if (!ranked.length) return ResponseBuilder.data([], "No guest activity");

      const trainers = await user
        .find({ _id: { $in: ranked }, account_type: "Trainer" })
        .select(
          "fullname profile_picture category avgRating status trainer_verification extraInfo"
        )
        .lean();

      const order = new Map(ranked.map((id, i) => [String(id), i]));
      trainers.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
      );
      return ResponseBuilder.data(trainers, "Seeded trainers");
    } catch (err) {
      this.log.error(err);
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }
}

export const guestActivityService = new GuestActivityService();
