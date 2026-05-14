import OpenAI from "openai";
import * as dotenv from "dotenv";
dotenv.config();

const MODEL = "gpt-4o-mini";

let _client: OpenAI | null = null;

function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in environment variables.");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
  async chatAssistant(
    messages: { role: "user" | "assistant"; content: string }[],
    context: { userName?: string; userType?: string; category?: string; platformInfo?: string }
  ): Promise<string> {
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
- Be encouraging and positive about their sports journey`;

    const resp = await client().chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    return resp.choices[0]?.message?.content?.trim() || "I'm sorry, I couldn't process that. Please try again.";
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
  async analyzeReviews(
    reviews: { sessionRating: number; recommendRating: number; title?: string; remarks?: string }[]
  ): Promise<{ overallSentiment: string; strengths: string[]; improvements: string[]; summary: string }> {
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

    try {
      const text = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return {
        overallSentiment: "mixed",
        strengths: ["Consistent availability"],
        improvements: ["Gather more detailed feedback"],
        summary: "Not enough review data to provide a detailed analysis.",
      };
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
