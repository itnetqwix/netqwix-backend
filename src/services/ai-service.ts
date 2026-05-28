import OpenAI from "openai";
import * as dotenv from "dotenv";
dotenv.config();

const MODEL = "gpt-4o-mini";

/**
 * Whitelist of action types the assistant is allowed to suggest. The
 * mobile client maps each to a deep-link / navigation target — anything
 * outside this list is silently dropped so the model can't navigate
 * users to arbitrary surfaces.
 */
export type AiActionType =
  | "open-book-lesson"
  | "open-trainer-profile"
  | "open-schedule"
  | "open-upcoming-sessions"
  | "open-wallet-topup"
  | "open-support-chat"
  | "open-report-issue"
  | "open-faq";

const ALLOWED_ACTION_TYPES = new Set<AiActionType>([
  "open-book-lesson",
  "open-trainer-profile",
  "open-schedule",
  "open-upcoming-sessions",
  "open-wallet-topup",
  "open-support-chat",
  "open-report-issue",
  "open-faq",
]);

export type AiActionSuggestion = {
  type: AiActionType;
  payload?: Record<string, unknown>;
  label?: string;
};

/**
 * The assistant is asked to wrap structured actions in
 * `<ACTIONS>{...}</ACTIONS>`. We extract that block, parse it, and
 * filter to the whitelist. Anything we can't parse falls through to an
 * empty list — the text reply still renders.
 */
function parseAssistantResponse(raw: string): { reply: string; actions: AiActionSuggestion[] } {
  const match = raw.match(/<ACTIONS>([\s\S]*?)<\/ACTIONS>/i);
  const reply = match ? raw.replace(match[0], "").trim() : raw.trim();
  if (!match) return { reply, actions: [] };
  try {
    const parsed = JSON.parse(match[1]);
    const list = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const actions: AiActionSuggestion[] = [];
    for (const candidate of list) {
      const t = String(candidate?.type ?? "");
      if (!ALLOWED_ACTION_TYPES.has(t as AiActionType)) continue;
      actions.push({
        type: t as AiActionType,
        payload: candidate?.payload && typeof candidate.payload === "object" ? candidate.payload : undefined,
        label: typeof candidate?.label === "string" ? candidate.label : undefined,
      });
    }
    return { reply, actions };
  } catch {
    return { reply, actions: [] };
  }
}

let _client: OpenAI | null = null;

/** Normalise key from `.env` / PM2 (trim, strip accidental quotes). */
export function getOpenAiApiKey(): string | undefined {
  const raw = process.env.OPENAI_API_KEY;
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

function client(): OpenAI {
  if (!_client) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set in environment variables.");
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export class AIService {
  // ─── Trainer Matching / Recommendations ──────────────────
  async recommendTrainers(
    traineeProfile: { category?: string; interests?: string[]; pastTrainerIds?: string[]; pastRatings?: any[] },
    availableTrainers: any[]
  ): Promise<any[]> {
    if (!availableTrainers.length) return [];

    const trainerSummaries = availableTrainers.map((t) => ({
      id: String(t._id),
      name: t.fullname,
      category: t.category,
      rating: t.avgRating || 0,
      hourly_rate: t.extraInfo?.hourly_rate || 0,
      bio: t.extraInfo?.bio || "",
      totalSessions: t.totalSessions || 0,
    }));

    const prompt = `You are a trainer recommendation engine for a sports coaching platform.

Given a trainee's profile and available trainers, rank the trainers from best to worst match and explain why in 1 sentence each.

Trainee profile:
- Preferred category: ${traineeProfile.category || "any"}
- Interests: ${(traineeProfile.interests || []).join(", ") || "not specified"}
- Past trainer IDs to deprioritize (already worked with): ${(traineeProfile.pastTrainerIds || []).join(", ") || "none"}

Available trainers:
${JSON.stringify(trainerSummaries, null, 2)}

Return a JSON array of objects: [{ "trainerId": "...", "score": 0-100, "reason": "..." }]
Only return the JSON array, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "[]";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return [];
    }
  }

  // ─── Chat Assistant ──────────────────────────────────────

  /**
   * Rule-based fallback when OpenAI is unavailable (missing key, quota,
   * network). Returns 200-shaped content so mobile never shows a hard
   * failure for common intents.
   */
  /** Public so the business layer can return 200 when OpenAI or DB fails. */
  chatAssistantFallback(
    messages: { role: "user" | "assistant"; content: string }[],
    context: { userName?: string; userType?: string; category?: string }
  ): { reply: string; actions: AiActionSuggestion[] } {
    const lastUser = [...messages]
      .reverse()
      .find((m) => m.role === "user" && m.content?.trim())?.content
      .toLowerCase() ?? "";
    const sport = context.category || "your sport";
    const name = context.userName || "there";

    let reply =
      `Hi ${name}! I'm the NetQwix assistant. I can help you book coaches, check your schedule, or find support. What would you like to do?`;
    const actions: AiActionSuggestion[] = [];

    if (/book|trainer|coach|lesson|yoga|golf|tennis|find|near/.test(lastUser)) {
      reply =
        `You can browse coaches in Book Expert — filter by sport like ${sport}, read ratings, and book an instant or scheduled lesson. Want me to open that for you?`;
      actions.push({ type: "open-book-lesson", label: "Book a lesson" });
    } else if (/schedule|calendar|upcoming|session/.test(lastUser)) {
      reply =
        "Your upcoming sessions live under Sessions. Trainers can also open their schedule from the calendar tab.";
      actions.push({
        type: context.userType === "Trainer" ? "open-schedule" : "open-upcoming-sessions",
        label: "View sessions",
      });
    } else if (/wallet|pay|top.?up|balance/.test(lastUser)) {
      reply =
        "You can top up your wallet before booking. Each trainer sets their own rate — you'll see the total before you confirm.";
      actions.push({ type: "open-wallet-topup", label: "Open wallet" });
    } else if (/support|help|issue|problem/.test(lastUser)) {
      reply =
        "Sorry you're stuck — you can chat with support in-app or report a technical issue from Settings.";
      actions.push({ type: "open-support-chat", label: "Chat with support" });
    } else if (/hi|hello|hey/.test(lastUser)) {
      reply = `Hey ${name}! How can I help you on NetQwix today?`;
    }

    return { reply, actions };
  }

  async chatAssistant(
    messages: { role: "user" | "assistant"; content: string }[],
    context: { userName?: string; userType?: string; category?: string; platformInfo?: string }
  ): Promise<{ reply: string; actions: AiActionSuggestion[] }> {
    if (!getOpenAiApiKey()) {
      console.warn("[AI] OPENAI_API_KEY missing — using fallback chat assistant");
      return this.chatAssistantFallback(messages, context);
    }

    const systemPrompt = `You are NetQwix AI Assistant, a helpful, friendly, and concise assistant for a sports coaching platform called NetQwix.

NetQwix connects trainees (learners) with expert trainers (coaches) for live video lessons in sports like Golf, Tennis, and more.

Platform features:
- Instant lessons (book and start immediately with an online trainer)
- Scheduled lessons (book for a specific date/time)
- Video clips (trainers and trainees can upload and share training clips)
- Game plans (trainers create customized training plans)
- Chat with friends and trainers
- Trainer profiles with ratings and reviews

User context:
- Name: ${context.userName || "User"}
- Account type: ${context.userType || "Trainee"}
- Category/Sport: ${context.category || "not specified"}

Guidelines:
- Be concise (2-3 sentences max per response)
- If asked about booking, guide them to use the "Book Expert" feature
- If asked about pricing, mention that each trainer sets their own hourly rate
- Never make up specific prices or trainer names
- If you don't know something specific about the platform, say so and suggest contacting support
- Be encouraging and positive about their sports journey
- After the reply, ALWAYS include a JSON block on its OWN line in the form:
  <ACTIONS>{"actions":[{"type":"open-book-lesson"}]}</ACTIONS>
  using ONLY these whitelisted action types:
    open-book-lesson, open-trainer-profile, open-schedule,
    open-upcoming-sessions, open-wallet-topup, open-support-chat,
    open-report-issue, open-faq
  Return [] when no action fits.`;

    try {
      const resp = await client().chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 380,
      });

      const raw = resp.choices[0]?.message?.content?.trim() ||
        "I'm sorry, I couldn't process that. Please try again.";

      return parseAssistantResponse(raw);
    } catch (err) {
      console.error("[AI] OpenAI chatAssistant failed, using fallback:", err);
      return this.chatAssistantFallback(messages, context);
    }
  }

  // ─── Lesson Summarization ────────────────────────────────
  async summarizeLesson(
    sessionInfo: {
      trainerName?: string;
      traineeName?: string;
      category?: string;
      duration?: number;
      notes?: string;
      ratings?: any;
    }
  ): Promise<{ summary: string; keyTakeaways: string[]; followUpPlan: string }> {
    const prompt = `You are a sports coaching assistant. Generate a helpful lesson summary.

Session details:
- Trainer: ${sessionInfo.trainerName || "Unknown"}
- Trainee: ${sessionInfo.traineeName || "Unknown"}
- Sport: ${sessionInfo.category || "Unknown"}
- Duration: ${sessionInfo.duration || "Unknown"} minutes
- Notes/Remarks: ${sessionInfo.notes || "None provided"}
- Session Rating: ${sessionInfo.ratings?.sessionRating || "Not rated"}

Generate a JSON object with:
{
  "summary": "A 2-3 sentence summary of the lesson",
  "keyTakeaways": ["3-5 actionable takeaways or tips based on the sport and session"],
  "followUpPlan": "A brief follow-up practice plan for the trainee"
}

If limited info is available, provide general useful tips for the sport.
Only return the JSON object, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 500,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return {
        summary: "Lesson completed successfully.",
        keyTakeaways: ["Keep practicing regularly", "Review the techniques covered"],
        followUpPlan: "Practice the drills discussed and prepare questions for your next session.",
      };
    }
  }

  // ─── Clip Tagging ────────────────────────────────────────
  async generateClipTags(
    clipInfo: { title: string; category?: string; uploaderType?: string }
  ): Promise<{ tags: string[]; description: string; skillLevel: string }> {
    const prompt = `You are a sports content tagger. Given a training clip's info, generate relevant tags, a short description, and determine the skill level.

Clip info:
- Title: ${clipInfo.title}
- Sport/Category: ${clipInfo.category || "General"}
- Uploaded by: ${clipInfo.uploaderType || "Unknown"}

Return a JSON object:
{
  "tags": ["5-8 relevant tags for this clip"],
  "description": "A 1-2 sentence description of what this clip likely covers",
  "skillLevel": "beginner" | "intermediate" | "advanced"
}
Only return the JSON object, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { tags: [clipInfo.category || "training"], description: clipInfo.title, skillLevel: "intermediate" };
    }
  }

  // ─── Profile Enhancement ─────────────────────────────────
  async enhanceProfile(
    profile: { name: string; category?: string; bio?: string; hourlyRate?: number }
  ): Promise<{ enhancedBio: string; suggestedTags: string[] }> {
    const prompt = `You are a profile copywriter for a sports coaching platform. Improve this trainer's bio to sound professional, engaging, and credible. Keep it under 150 words.

Current profile:
- Name: ${profile.name}
- Sport: ${profile.category || "General"}
- Current bio: ${profile.bio || "No bio yet"}
- Hourly rate: $${profile.hourlyRate || "not set"}

Return a JSON object:
{
  "enhancedBio": "The improved bio text",
  "suggestedTags": ["3-5 tags describing their expertise"]
}
Only return the JSON object, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { enhancedBio: profile.bio || "", suggestedTags: [profile.category || "coaching"] };
    }
  }

  // ─── Smart Scheduling ────────────────────────────────────
  async suggestBestTimes(
    pastBookings: { dayOfWeek: number; hour: number; completed: boolean }[],
    trainerAvailability: { day: string; slots: string[] }[]
  ): Promise<{ suggestions: { day: string; time: string; reason: string }[] }> {
    const prompt = `You are a scheduling optimizer. Based on a trainee's past booking patterns and trainer availability, suggest the 3 best times to book.

Past booking patterns (day 0=Sun, 6=Sat):
${JSON.stringify(pastBookings.slice(0, 20))}

Trainer availability:
${JSON.stringify(trainerAvailability)}

Return a JSON object:
{
  "suggestions": [
    { "day": "Monday", "time": "10:00 AM", "reason": "You usually book around this time" }
  ]
}
Only return the JSON object, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { suggestions: [] };
    }
  }

  // ─── Review & Feedback Analysis ──────────────────────────
  reviewAnalysisFallback(
    reviews: { sessionRating: number; recommendRating?: number; title?: string; remarks?: string }[]
  ): { overallSentiment: string; strengths: string[]; improvements: string[]; summary: string } {
    const ratings = reviews
      .map((r) => Number(r.sessionRating))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avg = ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0;
    const overallSentiment =
      avg >= 4.2 ? "positive" : avg >= 3.2 ? "mixed" : ratings.length ? "negative" : "mixed";

    const high = reviews.filter((r) => Number(r.sessionRating) >= 4);
    const low = reviews.filter(
      (r) => Number(r.sessionRating) > 0 && Number(r.sessionRating) < 3.5
    );

    const snippet = (r: (typeof reviews)[0]) =>
      (r.remarks || r.title || "").trim() ||
      `Trainees rated sessions around ${r.sessionRating}/5.`;

    const strengths = high
      .slice(0, 3)
      .map(snippet)
      .filter((s) => s.length > 0);
    const improvements = low
      .slice(0, 3)
      .map((r) => `Address feedback: ${snippet(r)}`)
      .filter((s) => s.length > 0);

    if (!strengths.length && avg >= 3.5) {
      strengths.push("Trainees are rating your sessions positively overall.");
    }
    if (!improvements.length && avg < 4 && ratings.length) {
      improvements.push("Ask trainees for written feedback after each session.");
    }

    const summary =
      ratings.length >= 2
        ? `Based on ${ratings.length} rated sessions, your average is ${avg.toFixed(1)}/5. ${
            overallSentiment === "positive"
              ? "Keep doing what works and highlight your strengths in your profile."
              : overallSentiment === "negative"
                ? "Focus on the improvement themes below in your next lessons."
                : "There is a mix of feedback — lean into your strengths while addressing weaker areas."
          }`
        : "Complete more rated sessions to unlock deeper AI insights.";

    return {
      overallSentiment,
      strengths: strengths.length ? strengths : ["Solid session completion rate"],
      improvements: improvements.length
        ? improvements
        : ["Encourage trainees to leave detailed written reviews"],
      summary,
    };
  }

  async analyzeReviews(
    reviews: { sessionRating: number; recommendRating?: number; title?: string; remarks?: string }[]
  ): Promise<{ overallSentiment: string; strengths: string[]; improvements: string[]; summary: string }> {
    try {
      const prompt = `You are a review analyst for a sports coaching platform. Analyze these session reviews and provide actionable insights for the trainer.

Reviews:
${JSON.stringify(reviews.slice(0, 30), null, 2)}

Return a JSON object:
{
  "overallSentiment": "positive" | "mixed" | "negative",
  "strengths": ["2-3 things trainees appreciate"],
  "improvements": ["2-3 areas for improvement"],
  "summary": "A 2-3 sentence overall analysis"
}
Only return the JSON object, no other text.`;

      const resp = await client().chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 400,
      });

      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        overallSentiment: String(parsed.overallSentiment || "mixed"),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
        improvements: Array.isArray(parsed.improvements)
          ? parsed.improvements.map(String)
          : [],
        summary: String(parsed.summary || ""),
      };
    } catch (err) {
      console.warn("[AI] analyzeReviews fallback:", (err as Error)?.message || err);
      return this.reviewAnalysisFallback(reviews);
    }
  }

  // ─── Content Moderation ──────────────────────────────────
  async moderateContent(content: string): Promise<{ flagged: boolean; categories: string[]; reason?: string }> {
    try {
      const resp = await client().moderations.create({ input: content });
      const result = resp.results[0];
      if (result.flagged) {
        const flaggedCats = Object.entries(result.categories)
          .filter(([, v]) => v)
          .map(([k]) => k);
        return { flagged: true, categories: flaggedCats, reason: `Content flagged for: ${flaggedCats.join(", ")}` };
      }
      return { flagged: false, categories: [] };
    } catch {
      return { flagged: false, categories: [] };
    }
  }

  // ─── Smart Notification Content ──────────────────────────
  async generateNotificationContent(
    context: { userType: string; userName: string; daysSinceLastBooking: number; category?: string; lastTrainer?: string }
  ): Promise<{ title: string; body: string }> {
    const prompt = `Generate a short, friendly push notification to re-engage a ${context.userType} on a sports coaching platform.

Context:
- Name: ${context.userName}
- Days since last session: ${context.daysSinceLastBooking}
- Sport: ${context.category || "their sport"}
- Last trainer: ${context.lastTrainer || "their trainer"}

Return a JSON object:
{ "title": "Short catchy title (max 50 chars)", "body": "Brief friendly message (max 120 chars)" }
Only return the JSON object, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 100,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return {
        title: "Miss your training? 🏌️",
        body: `Hey ${context.userName}, it's been a while! Book a session and get back on track.`,
      };
    }
  }

  // ─── Natural Language Search ─────────────────────────────
  async interpretSearch(query: string): Promise<{ category?: string; skillLevel?: string; priceRange?: string; keywords: string[] }> {
    const prompt = `Parse this natural language search query for a sports coaching platform into structured filters.

Query: "${query}"

Return a JSON object:
{
  "category": "Golf" | "Tennis" | null,
  "skillLevel": "beginner" | "intermediate" | "advanced" | null,
  "priceRange": "budget" | "mid" | "premium" | null,
  "keywords": ["relevant search terms"]
}
Only return the JSON object, no other text.`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 150,
    });

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { keywords: query.split(" ") };
    }
  }
}
