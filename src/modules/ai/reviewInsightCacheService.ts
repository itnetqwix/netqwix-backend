import crypto from "crypto";
import mongoose from "mongoose";
import booked_sessions from "../../model/booked_sessions.schema";
import clip from "../../model/clip.schema";
import trainer_review_insight from "../../model/trainer_review_insight.schema";
import user from "../../model/user.schema";
import schedule_inventory from "../../model/schedule_inventory.schema";
import { aiService } from "../../services/ai-service";

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export type ReviewInsightPayload = {
  overallSentiment: string;
  strengths: string[];
  improvements: string[];
  summary: string;
  reviewCount: number;
  degraded?: boolean;
  cached?: boolean;
  insightVariant?: number;
  generatedAt?: string;
  nextRefreshAt?: string;
};

type ReviewRow = {
  sessionRating: number;
  recommendRating?: number;
  title?: string;
  remarks?: string;
};

function stableHash(parts: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
}

async function collectTrainerReviews(trainerId: mongoose.Types.ObjectId): Promise<ReviewRow[]> {
  const sessions = await booked_sessions
    .find({ trainer_id: trainerId, status: "completed" })
    .select("ratings updatedAt")
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  return sessions
    .map((s: any) => s.ratings?.trainee)
    .filter((r: any) => r && (r.sessionRating || r.title || r.remarksInfo))
    .map((r: any) => ({
      sessionRating: Number(r.sessionRating) || 0,
      recommendRating: Number(r.recommendRating) || 0,
      title: r.title ? String(r.title) : undefined,
      remarks: (r.remarks || r.remarksInfo || "").trim() || undefined,
    }));
}

async function buildActivityFingerprint(
  trainerId: mongoose.Types.ObjectId
): Promise<Record<string, unknown>> {
  const since = new Date(Date.now() - CACHE_TTL_MS);
  const [ratedCount, latestRated, recentCompleted, clipCount, profile, schedule] =
    await Promise.all([
      booked_sessions.countDocuments({
        trainer_id: trainerId,
        status: "completed",
        "ratings.trainee.sessionRating": { $exists: true, $ne: null },
      }),
      booked_sessions
        .findOne({
          trainer_id: trainerId,
          status: "completed",
          "ratings.trainee.sessionRating": { $exists: true, $ne: null },
        })
        .select("updatedAt")
        .sort({ updatedAt: -1 })
        .lean(),
      booked_sessions.countDocuments({
        trainer_id: trainerId,
        status: "completed",
        updatedAt: { $gte: since },
      }),
      clip.countDocuments({ user_id: trainerId }),
      user.findById(trainerId).select("updatedAt category status").lean(),
      schedule_inventory.findOne({ trainer_id: trainerId }).select("updatedAt").lean(),
    ]);

  const latestReviewAt =
    latestRated?.updatedAt != null
      ? new Date(latestRated.updatedAt as Date).toISOString()
      : null;

  return {
    ratedCount,
    latestReviewAt,
    recentCompletedSessions: recentCompleted,
    clipCount,
    profileUpdatedAt: profile?.updatedAt
      ? new Date(profile.updatedAt as Date).toISOString()
      : null,
    category: profile?.category ?? null,
    scheduleUpdatedAt: schedule?.updatedAt
      ? new Date(schedule.updatedAt as Date).toISOString()
      : null,
  };
}

function insufficientPayload(reviewCount: number): ReviewInsightPayload {
  return {
    overallSentiment: "insufficient",
    strengths: [],
    improvements: [],
    summary:
      "Not enough reviews yet. Complete more sessions to get AI-powered insights.",
    reviewCount,
    cached: false,
    insightVariant: 0,
    generatedAt: new Date().toISOString(),
    nextRefreshAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
  };
}

async function generateInsight(
  reviews: ReviewRow[],
  activityContext?: string
): Promise<Omit<ReviewInsightPayload, "cached" | "insightVariant" | "generatedAt" | "nextRefreshAt">> {
  if (reviews.length < 2) {
    return insufficientPayload(reviews.length);
  }

  try {
    const extra = activityContext
      ? `\nRecent trainer activity on the platform (use this to tailor insights):\n${activityContext}\n`
      : "";
    const analysis = await aiService.analyzeReviews(reviews, extra);
    return {
      overallSentiment: analysis.overallSentiment,
      strengths: analysis.strengths,
      improvements: analysis.improvements,
      summary: analysis.summary,
      reviewCount: reviews.length,
      degraded: false,
    };
  } catch {
    const fallback = aiService.reviewAnalysisFallback(reviews);
    return {
      ...fallback,
      reviewCount: reviews.length,
      degraded: true,
    };
  }
}

function slotToResponse(
  slot: { payload: any; generated_at: Date },
  meta: {
    cached: boolean;
    insightVariant: number;
    expiresAt: Date;
  }
): ReviewInsightPayload {
  const p = slot.payload || {};
  return {
    overallSentiment: String(p.overallSentiment ?? "mixed"),
    strengths: Array.isArray(p.strengths) ? p.strengths.map(String) : [],
    improvements: Array.isArray(p.improvements) ? p.improvements.map(String) : [],
    summary: String(p.summary ?? ""),
    reviewCount: Number(p.reviewCount) || 0,
    degraded: Boolean(p.degraded),
    cached: meta.cached,
    insightVariant: meta.insightVariant,
    generatedAt: new Date(slot.generated_at).toISOString(),
    nextRefreshAt: meta.expiresAt.toISOString(),
  };
}

function describeActivityDelta(
  prevFp: string | undefined,
  nextParts: Record<string, unknown>
): string {
  if (!prevFp) {
    return JSON.stringify(nextParts, null, 0);
  }
  return `Activity snapshot changed since last insight. Current signals: ${JSON.stringify(nextParts)}`;
}

/**
 * Returns cached insight when still valid; regenerates when TTL elapsed or
 * trainer activity fingerprint changes (up to two variants per refresh window).
 */
export async function getTrainerReviewInsight(
  trainerId: string
): Promise<ReviewInsightPayload> {
  if (!mongoose.isValidObjectId(trainerId)) {
    return insufficientPayload(0);
  }

  const tid = new mongoose.Types.ObjectId(trainerId);
  const activityParts = await buildActivityFingerprint(tid);
  const fingerprint = stableHash(activityParts);
  const reviews = await collectTrainerReviews(tid);
  const now = Date.now();
  const expiresAt = new Date(now + CACHE_TTL_MS);

  const existing = await trainer_review_insight.findOne({ trainer_id: tid }).lean();

  if (existing && new Date(existing.expires_at).getTime() > now) {
    if (existing.current?.fingerprint === fingerprint && existing.current.payload) {
      return slotToResponse(existing.current as any, {
        cached: true,
        insightVariant: 0,
        expiresAt: new Date(existing.expires_at),
      });
    }
    if (
      existing.previous?.fingerprint === fingerprint &&
      existing.previous.payload
    ) {
      return slotToResponse(existing.previous as any, {
        cached: true,
        insightVariant: 1,
        expiresAt: new Date(existing.expires_at),
      });
    }
  }

  const activityNote = describeActivityDelta(
    existing?.current?.fingerprint,
    activityParts
  );
  const generated = await generateInsight(reviews, activityNote);
  const generatedAt = new Date();
  const slot = {
    fingerprint,
    generated_at: generatedAt,
    payload: generated,
  };

  if (existing && new Date(existing.expires_at).getTime() > now) {
    await trainer_review_insight.updateOne(
      { trainer_id: tid },
      {
        $set: {
          expires_at: expiresAt,
          previous: existing.current,
          current: slot,
        },
      }
    );
    return slotToResponse(slot, {
      cached: false,
      insightVariant: 0,
      expiresAt,
    });
  }

  await trainer_review_insight.findOneAndUpdate(
    { trainer_id: tid },
    {
      $set: {
        trainer_id: tid,
        expires_at: expiresAt,
        current: slot,
        previous: null,
      },
    },
    { upsert: true, new: true }
  );

  return slotToResponse(slot, {
    cached: false,
    insightVariant: 0,
    expiresAt,
  });
}
