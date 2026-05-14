import { AIService } from "../../services/ai-service";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import user from "../../model/user.schema";
import booked_sessions from "../../model/booked_sessions.schema";
import clip from "../../model/clip.schema";
import mongoose from "mongoose";

const aiService = new AIService();

export class AIBusinessService {
  // ─── 1. Trainer Recommendations ─────────────────────────
  async getRecommendedTrainers(authUser: any): Promise<ResponseBuilder> {
    try {
      const traineeId = authUser._id;
      const trainee = await user.findById(traineeId).lean();
      if (!trainee) return ResponseBuilder.badRequest("User not found.");

      const pastSessions = await booked_sessions
        .find({ trainee_id: traineeId, status: { $in: ["completed", "confirmed"] } })
        .select("trainer_id ratings")
        .lean();

      const pastTrainerIds = [...new Set(pastSessions.map((s: any) => String(s.trainer_id)))];

      const trainers = await user
        .find({
          account_type: "Trainer",
          status: "approved",
          _id: { $nin: (trainee as any).blockedUsers || [] },
        })
        .select("fullname category extraInfo profile_picture")
        .lean();

      const trainersWithStats = await Promise.all(
        trainers.map(async (t: any) => {
          const sessions = await booked_sessions
            .find({ trainer_id: t._id, status: "completed" })
            .select("ratings")
            .lean();
          const ratings = sessions
            .map((s: any) => s.ratings?.trainee?.sessionRating)
            .filter((r: any) => r != null);
          const avgRating = ratings.length
            ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
            : 0;
          return { ...t, avgRating: Math.round(avgRating * 10) / 10, totalSessions: sessions.length };
        })
      );

      const recommendations = await aiService.recommendTrainers(
        {
          category: (trainee as any).category,
          interests: (trainee as any).interests || [],
          pastTrainerIds,
          pastRatings: pastSessions.map((s: any) => s.ratings?.trainee),
        },
        trainersWithStats
      );

      const enriched = recommendations.map((rec: any) => {
        const trainer = trainersWithStats.find((t: any) => String(t._id) === rec.trainerId);
        return {
          ...rec,
          trainer: trainer
            ? {
                _id: trainer._id,
                fullname: trainer.fullname,
                category: trainer.category,
                profile_picture: trainer.profile_picture,
                avgRating: trainer.avgRating,
                hourly_rate: trainer.extraInfo?.hourly_rate,
              }
            : null,
        };
      });

      const data: any = { recommendations: enriched.filter((r: any) => r.trainer) };
      return ResponseBuilder.data(data, "AI trainer recommendations.");
    } catch (err) {
      console.error("[AI] recommendTrainers error:", err);
      return ResponseBuilder.errorMessage("Failed to get recommendations.");
    }
  }

  // ─── 2. Chat Assistant ──────────────────────────────────
  async chatWithAssistant(authUser: any, body: any): Promise<ResponseBuilder> {
    try {
      const { messages } = body;
      if (!messages || !Array.isArray(messages) || !messages.length) {
        return ResponseBuilder.badRequest("Messages array is required.");
      }

      const userData = await user.findById(authUser._id).select("fullname account_type category").lean();

      const reply = await aiService.chatAssistant(messages, {
        userName: (userData as any)?.fullname || "User",
        userType: (userData as any)?.account_type || "Trainee",
        category: (userData as any)?.category || undefined,
      });

      const data: any = { reply };
      return ResponseBuilder.data(data, "AI assistant response.");
    } catch (err) {
      console.error("[AI] chatAssistant error:", err);
      return ResponseBuilder.errorMessage("AI assistant is temporarily unavailable.");
    }
  }

  // ─── 3. Lesson Summary ──────────────────────────────────
  async getLessonSummary(authUser: any, sessionId: string): Promise<ResponseBuilder> {
    try {
      const session = await booked_sessions
        .findById(sessionId)
        .populate("trainer_id", "fullname category")
        .populate("trainee_id", "fullname")
        .lean();

      if (!session) return ResponseBuilder.badRequest("Session not found.");

      const s = session as any;
      if (
        String(s.trainer_id?._id) !== String(authUser._id) &&
        String(s.trainee_id?._id) !== String(authUser._id)
      ) {
        return ResponseBuilder.badRequest("Unauthorized.", 403);
      }

      const startTime = s.start_time ? new Date(s.start_time) : null;
      const endTime = s.end_time ? new Date(s.end_time) : null;
      const duration =
        startTime && endTime
          ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
          : null;

      const summary = await aiService.summarizeLesson({
        trainerName: s.trainer_id?.fullname,
        traineeName: s.trainee_id?.fullname,
        category: s.trainer_id?.category,
        duration,
        notes: s.ratings?.trainee?.remarksInfo || s.ratings?.trainee?.title || "",
        ratings: s.ratings?.trainee,
      });

      const data: any = { sessionId, ...summary };
      return ResponseBuilder.data(data, "Lesson summary generated.");
    } catch (err) {
      console.error("[AI] lessonSummary error:", err);
      return ResponseBuilder.errorMessage("Failed to generate lesson summary.");
    }
  }

  // ─── 4. Clip Tagging ────────────────────────────────────
  async tagClip(authUser: any, clipId: string): Promise<ResponseBuilder> {
    try {
      const c = await clip.findById(clipId).lean();
      if (!c) return ResponseBuilder.badRequest("Clip not found.");
      if (String((c as any).user_id) !== String(authUser._id)) {
        return ResponseBuilder.badRequest("Unauthorized.", 403);
      }

      const result = await aiService.generateClipTags({
        title: (c as any).title,
        category: (c as any).category,
        uploaderType: (c as any).user_type,
      });

      await clip.findByIdAndUpdate(clipId, {
        $set: {
          tags: result.tags,
          ai_description: result.description,
          skill_level: result.skillLevel,
        },
      });

      const data: any = { clipId, ...result };
      return ResponseBuilder.data(data, "Clip tagged by AI.");
    } catch (err) {
      console.error("[AI] tagClip error:", err);
      return ResponseBuilder.errorMessage("Failed to tag clip.");
    }
  }

  // ─── 5. Profile Enhancement ─────────────────────────────
  async enhanceProfile(authUser: any): Promise<ResponseBuilder> {
    try {
      const userData = await user.findById(authUser._id).lean();
      if (!userData) return ResponseBuilder.badRequest("User not found.");

      const u = userData as any;
      const result = await aiService.enhanceProfile({
        name: u.fullname,
        category: u.category,
        bio: u.extraInfo?.bio || "",
        hourlyRate: u.extraInfo?.hourly_rate,
      });

      const data: any = result;
      return ResponseBuilder.data(data, "Profile enhancement suggestions.");
    } catch (err) {
      console.error("[AI] enhanceProfile error:", err);
      return ResponseBuilder.errorMessage("Failed to enhance profile.");
    }
  }

  // ─── 6. Apply Enhanced Profile ──────────────────────────
  async applyEnhancedProfile(authUser: any, body: any): Promise<ResponseBuilder> {
    try {
      const { enhancedBio, suggestedTags } = body;
      const updates: any = {};
      if (enhancedBio) {
        updates["extraInfo.bio"] = enhancedBio;
        updates.ai_profile_summary = enhancedBio;
      }
      if (suggestedTags?.length) {
        updates.interests = suggestedTags;
      }
      await user.findByIdAndUpdate(authUser._id, { $set: updates });

      const data: any = { applied: true };
      return ResponseBuilder.data(data, "Enhanced profile applied.");
    } catch (err) {
      console.error("[AI] applyEnhancedProfile error:", err);
      return ResponseBuilder.errorMessage("Failed to apply profile.");
    }
  }

  // ─── 7. Smart Scheduling ────────────────────────────────
  async getSmartSchedule(authUser: any, trainerId: string): Promise<ResponseBuilder> {
    try {
      const pastBookings = await booked_sessions
        .find({
          trainee_id: authUser._id,
          trainer_id: trainerId,
          status: { $in: ["completed", "confirmed"] },
        })
        .select("booked_date session_start_time status")
        .lean();

      const patterns = pastBookings.map((b: any) => {
        const d = new Date(b.booked_date);
        const hour = b.session_start_time ? parseInt(b.session_start_time.split(":")[0]) : 10;
        return { dayOfWeek: d.getDay(), hour, completed: b.status === "completed" };
      });

      const trainer = await user.findById(trainerId).select("extraInfo").lean();
      const availability = (trainer as any)?.extraInfo?.availabilityInfo?.availability || [];

      const result = await aiService.suggestBestTimes(patterns, availability);

      const data: any = result;
      return ResponseBuilder.data(data, "Smart scheduling suggestions.");
    } catch (err) {
      console.error("[AI] smartSchedule error:", err);
      return ResponseBuilder.errorMessage("Failed to get schedule suggestions.");
    }
  }

  // ─── 8. Review Analysis ─────────────────────────────────
  async getReviewAnalysis(authUser: any): Promise<ResponseBuilder> {
    try {
      if (authUser.account_type !== "Trainer") {
        return ResponseBuilder.badRequest("Only trainers can view review analysis.");
      }

      const sessions = await booked_sessions
        .find({ trainer_id: authUser._id, status: "completed" })
        .select("ratings")
        .lean();

      const reviews = sessions
        .map((s: any) => s.ratings?.trainee)
        .filter((r: any) => r && (r.sessionRating || r.title || r.remarksInfo));

      if (reviews.length < 2) {
        const data: any = {
          overallSentiment: "insufficient",
          strengths: [],
          improvements: [],
          summary: "Not enough reviews yet. Complete more sessions to get AI-powered insights.",
          reviewCount: reviews.length,
        };
        return ResponseBuilder.data(data, "Need more reviews for analysis.");
      }

      const analysis = await aiService.analyzeReviews(reviews);
      const data: any = { ...analysis, reviewCount: reviews.length };
      return ResponseBuilder.data(data, "Review analysis complete.");
    } catch (err) {
      console.error("[AI] reviewAnalysis error:", err);
      return ResponseBuilder.errorMessage("Failed to analyze reviews.");
    }
  }

  // ─── 9. Natural Language Search ─────────────────────────
  async smartSearch(authUser: any, query: string): Promise<ResponseBuilder> {
    try {
      if (!query?.trim()) return ResponseBuilder.badRequest("Search query is required.");

      const parsed = await aiService.interpretSearch(query);

      const mongoQuery: any = {
        account_type: "Trainer",
        status: "approved",
      };
      if (parsed.category) {
        mongoQuery.category = { $regex: parsed.category, $options: "i" };
      }
      if (parsed.keywords?.length) {
        mongoQuery.$or = parsed.keywords.map((kw) => ({
          $or: [
            { fullname: { $regex: kw, $options: "i" } },
            { category: { $regex: kw, $options: "i" } },
            { interests: { $regex: kw, $options: "i" } },
            { "extraInfo.bio": { $regex: kw, $options: "i" } },
          ],
        }));
      }

      const trainers = await user
        .find(mongoQuery)
        .select("fullname category profile_picture extraInfo interests")
        .limit(20)
        .lean();

      const data: any = {
        parsed,
        trainers: trainers.map((t: any) => ({
          _id: t._id,
          fullname: t.fullname,
          category: t.category,
          profile_picture: t.profile_picture,
          hourly_rate: t.extraInfo?.hourly_rate,
          bio: t.extraInfo?.bio,
          interests: t.interests,
        })),
      };
      return ResponseBuilder.data(data, "Smart search results.");
    } catch (err) {
      console.error("[AI] smartSearch error:", err);
      return ResponseBuilder.errorMessage("Failed to process search.");
    }
  }
}
