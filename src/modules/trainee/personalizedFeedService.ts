import mongoose from "mongoose";
import { log } from "../../../logger";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import booked_session from "../../model/booked_sessions.schema";
import onlineUserModel from "../../model/online_user.schema";
import trainee_guest_activity from "../../model/trainee_guest_activity.schema";
import user from "../../model/user.schema";

/**
 * "For you" personalized trainer feed.
 *
 * Signals (per trainer):
 *   - Past completed sessions with that trainer  (strongest signal)
 *   - Recently booked upcoming sessions          (warm relationship)
 *   - Same category as past sessions             (broaden discovery)
 *   - Pre-signup browsing (guest activity)       (cold-start fallback)
 *   - Client-supplied recently-viewed snapshot   (live behaviour)
 *   - Online-now bias                            (gentle tiebreaker)
 *
 * We return both an ordered trainer list AND a per-trainer reason string so
 * the dashboard can render "Because you booked Sara twice" style chips.
 */

type RankReason =
  | "past_session_repeat"
  | "past_session_same_category"
  | "guest_view"
  | "guest_favorite"
  | "recently_viewed"
  | "online_now";

type ScoredTrainer = {
  trainerId: string;
  score: number;
  reasons: Set<RankReason>;
  context: Record<string, unknown>;
};

const REASON_WEIGHTS: Record<RankReason, number> = {
  past_session_repeat: 25,
  past_session_same_category: 8,
  guest_view: 1.5,
  guest_favorite: 6,
  recently_viewed: 4,
  online_now: 3,
};

const MAX_OUTPUT = 24;

export class PersonalizedFeedService {
  public log = log.getLogger();

  /**
   * Pull a ranked list of trainers for a signed-in trainee.
   *
   * @param traineeId      authUser._id
   * @param recentTrainerIds  optional snapshot of client-side recently-viewed
   *                          trainer IDs (most recent first)
   * @param limit          response size cap (1-MAX_OUTPUT)
   */
  public async listForYou(
    traineeId: string,
    recentTrainerIds: string[] = [],
    limit = 12
  ): Promise<ResponseBuilder> {
    try {
      if (!mongoose.isValidObjectId(traineeId)) {
        return ResponseBuilder.badRequest("Invalid trainee id");
      }

      const traineeObj = new mongoose.Types.ObjectId(traineeId);
      const cap = Math.max(1, Math.min(Number(limit) || 12, MAX_OUTPUT));

      const scored = new Map<string, ScoredTrainer>();
      const addScore = (
        trainerId: string,
        reason: RankReason,
        contextPatch: Record<string, unknown> = {}
      ) => {
        if (!trainerId) return;
        const id = String(trainerId);
        if (id === traineeId) return;
        const existing = scored.get(id);
        if (existing) {
          existing.score += REASON_WEIGHTS[reason];
          existing.reasons.add(reason);
          Object.assign(existing.context, contextPatch);
          return;
        }
        scored.set(id, {
          trainerId: id,
          score: REASON_WEIGHTS[reason],
          reasons: new Set([reason]),
          context: { ...contextPatch },
        });
      };

      const sessions = await booked_session
        .find({
          trainee_id: traineeObj,
          status: {
            $in: [
              BOOKED_SESSIONS_STATUS.completed,
              BOOKED_SESSIONS_STATUS.confirm,
              BOOKED_SESSIONS_STATUS.upcoming,
              "booked",
            ],
          },
        })
        .select("trainer_id status updatedAt createdAt")
        .lean();

      const repeatTrainerIds = new Set<string>();
      const repeatCount = new Map<string, number>();
      for (const sess of sessions) {
        const tid = String(sess.trainer_id);
        repeatTrainerIds.add(tid);
        repeatCount.set(tid, (repeatCount.get(tid) ?? 0) + 1);
        addScore(tid, "past_session_repeat", {
          repeatCount: (repeatCount.get(tid) ?? 1),
        });
      }

      const pastCategories = new Set<string>();
      if (repeatTrainerIds.size > 0) {
        const repeats = await user
          .find({
            _id: {
              $in: [...repeatTrainerIds].map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
            },
          })
          .select("category")
          .lean();
        for (const t of repeats) {
          const cats = Array.isArray(t.category)
            ? t.category
            : typeof t.category === "string"
            ? [t.category]
            : [];
          for (const c of cats) if (typeof c === "string") pastCategories.add(c);
        }
      }

      const guestDoc = await trainee_guest_activity
        .findOne({ trainee_id: traineeObj })
        .lean();
      if (guestDoc) {
        for (const view of guestDoc.viewed_trainers ?? []) {
          for (let i = 0; i < Number(view.view_count ?? 1); i++) {
            addScore(String(view.trainer_id), "guest_view");
          }
        }
        for (const fav of guestDoc.favorites_snapshot ?? []) {
          addScore(String(fav.trainer_id), "guest_favorite");
        }
      }

      for (let i = 0; i < recentTrainerIds.length; i++) {
        const tid = recentTrainerIds[i];
        if (!mongoose.isValidObjectId(tid)) continue;
        /**
         * Lightly decay older entries in the recent-viewed list so the
         * top one wins ties.
         */
        const decay = Math.max(0.4, 1 - i * 0.1);
        const existing = scored.get(String(tid));
        if (existing) {
          existing.score += REASON_WEIGHTS.recently_viewed * decay;
          existing.reasons.add("recently_viewed");
        } else {
          scored.set(String(tid), {
            trainerId: String(tid),
            score: REASON_WEIGHTS.recently_viewed * decay,
            reasons: new Set(["recently_viewed"]),
            context: {},
          });
        }
      }

      if (pastCategories.size > 0) {
        const categoryCandidates = await user
          .find({
            account_type: "Trainer",
            status: "approved",
            deleted_at: { $in: [null, undefined] },
            category: { $in: [...pastCategories] },
            _id: { $ne: traineeObj },
          })
          .select("_id avgRating")
          .sort({ avgRating: -1 })
          .limit(40)
          .lean();
        for (const cand of categoryCandidates) {
          addScore(String(cand._id), "past_session_same_category");
        }
      }

      /**
       * Cold-start fallback: nothing scored yet → pour in highly-rated
       * trainers so the user still has something to look at.
       */
      let coldStart: any[] = [];
      if (scored.size < cap) {
        coldStart = await user
          .find({
            account_type: "Trainer",
            status: "approved",
            deleted_at: { $in: [null, undefined] },
            _id: { $ne: traineeObj },
          })
          .select("_id avgRating")
          .sort({ avgRating: -1 })
          .limit(cap * 3)
          .lean();
      }

      const candidateIds = new Set<string>(scored.keys());
      for (const c of coldStart) candidateIds.add(String(c._id));

      if (candidateIds.size === 0) {
        return ResponseBuilder.data({ for_you: [], reasoning: [] }, "No trainers");
      }

      const objectIds = [...candidateIds].map(
        (id) => new mongoose.Types.ObjectId(id)
      );
      const trainers = await user
        .find({
          _id: { $in: objectIds },
          account_type: "Trainer",
          status: "approved",
          deleted_at: { $in: [null, undefined] },
        })
        .select(
          "fullname profile_picture category avgRating reviewCount status trainer_verification extraInfo hourly_rate availability"
        )
        .lean();

      const onlineRows = await onlineUserModel
        .find({ user_id: { $in: objectIds } })
        .select("user_id")
        .lean();
      const onlineSet = new Set(onlineRows.map((r: any) => String(r.user_id)));

      for (const tid of onlineSet) {
        const existing = scored.get(tid);
        if (existing) {
          existing.score += REASON_WEIGHTS.online_now;
          existing.reasons.add("online_now");
        }
      }

      const ranked: Array<{ trainer: any; score: number; reasons: RankReason[]; context: Record<string, unknown> }> = [];
      for (const trainer of trainers) {
        const tid = String(trainer._id);
        const meta = scored.get(tid);
        const isOnline = onlineSet.has(tid);
        const baseScore = meta?.score ?? 0;
        const ratingBoost = (Number(trainer.avgRating) || 0) * 0.6;
        ranked.push({
          trainer: { ...trainer, is_online: isOnline },
          score: baseScore + ratingBoost,
          reasons: meta ? [...meta.reasons] : [],
          context: meta?.context ?? {},
        });
      }

      ranked.sort((a, b) => b.score - a.score);
      const top = ranked.slice(0, cap);

      return ResponseBuilder.data(
        {
          for_you: top.map((row) => row.trainer),
          reasoning: top.map((row) => ({
            trainer_id: String(row.trainer._id),
            reasons: row.reasons,
            primary_reason: row.reasons[0] ?? "online_now",
            repeat_count: row.context.repeatCount ?? 0,
          })),
        },
        "Personalized feed"
      );
    } catch (err) {
      this.log.error("[personalizedFeed] error", err);
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }
}

export const personalizedFeedService = new PersonalizedFeedService();
