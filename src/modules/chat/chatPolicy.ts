import booked_session from "../../model/booked_sessions.schema";
import ChatMessage from "../../model/chat_message.schema";
import ChatFlag from "../../model/chat_flag.schema";

const DAILY_MESSAGE_LIMIT_UNPAID = 10;

const SUSPICIOUS_PATTERNS = [
  /\b(?:venmo|zelle|cashapp|cash\s*app|paypal|pay\s*pal|gpay|apple\s*pay)\b/i,
  /\b(?:pay\s*me\s*directly|off[\s-]*platform|outside\s*(?:the\s*)?app)\b/i,
  /\b(?:whatsapp|telegram|signal|imessage)\b/i,
  /\b(?:zoom\.us|meet\.google|teams\.microsoft|skype)\b/i,
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];

const FLAG_TYPE_MAP: Record<number, "payment_info" | "external_link" | "phone_number" | "keyword_match"> = {
  0: "payment_info",
  1: "keyword_match",
  2: "external_link",
  3: "external_link",
  4: "phone_number",
  5: "keyword_match",
};

export type ChatPolicyResult = {
  allowed: boolean;
  reason?: string;
  hasPaidSession: boolean;
  dailyCount: number;
  dailyLimit: number;
  remainingToday: number;
  flagged: boolean;
};

export async function checkChatPolicy(
  senderId: string,
  receiverId: string,
  content: string,
  conversationId?: string | null,
  messageId?: string | null
): Promise<ChatPolicyResult> {
  const hasPaidSession = await hasPaidSessionBetween(senderId, receiverId);

  if (hasPaidSession) {
    const flagged = await scanAndFlag(content, senderId, conversationId, messageId);
    return {
      allowed: true,
      hasPaidSession: true,
      dailyCount: 0,
      dailyLimit: Infinity,
      remainingToday: Infinity,
      flagged,
    };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dailyCount = await ChatMessage.countDocuments({
    senderId,
    receiverId,
    createdAt: { $gte: todayStart },
  });

  if (dailyCount >= DAILY_MESSAGE_LIMIT_UNPAID) {
    return {
      allowed: false,
      reason: `Daily message limit reached (${DAILY_MESSAGE_LIMIT_UNPAID}). Book a lesson to unlock unlimited messaging.`,
      hasPaidSession: false,
      dailyCount,
      dailyLimit: DAILY_MESSAGE_LIMIT_UNPAID,
      remainingToday: 0,
      flagged: false,
    };
  }

  const flagged = await scanAndFlag(content, senderId, conversationId, messageId);

  return {
    allowed: true,
    hasPaidSession: false,
    dailyCount: dailyCount + 1,
    dailyLimit: DAILY_MESSAGE_LIMIT_UNPAID,
    remainingToday: DAILY_MESSAGE_LIMIT_UNPAID - dailyCount - 1,
    flagged,
  };
}

async function hasPaidSessionBetween(userA: string, userB: string): Promise<boolean> {
  const session = await booked_session.findOne({
    $or: [
      { trainer_id: userA, trainee_id: userB },
      { trainer_id: userB, trainee_id: userA },
    ],
    status: { $in: ["confirmed", "completed"] },
  }).lean();
  return !!session;
}

async function scanAndFlag(
  content: string,
  senderId: string,
  conversationId?: string | null,
  messageId?: string | null
): Promise<boolean> {
  if (!content || !conversationId || !messageId) return false;

  let flagged = false;
  for (let i = 0; i < SUSPICIOUS_PATTERNS.length; i++) {
    const match = content.match(SUSPICIOUS_PATTERNS[i]);
    if (match) {
      flagged = true;
      try {
        await ChatFlag.create({
          conversationId,
          messageId,
          senderId,
          flagType: FLAG_TYPE_MAP[i] ?? "keyword_match",
          matchedContent: match[0].slice(0, 200),
        });
      } catch {
        /* non-fatal */
      }
    }
  }
  return flagged;
}

export async function getChatPolicyInfo(
  userId: string,
  otherUserId: string
): Promise<{
  hasPaidSession: boolean;
  dailyCount: number;
  dailyLimit: number;
  remainingToday: number;
}> {
  const hasPaidSession = await hasPaidSessionBetween(userId, otherUserId);

  if (hasPaidSession) {
    return { hasPaidSession: true, dailyCount: 0, dailyLimit: Infinity, remainingToday: Infinity };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dailyCount = await ChatMessage.countDocuments({
    senderId: userId,
    receiverId: otherUserId,
    createdAt: { $gte: todayStart },
  });

  return {
    hasPaidSession: false,
    dailyCount,
    dailyLimit: DAILY_MESSAGE_LIMIT_UNPAID,
    remainingToday: Math.max(0, DAILY_MESSAGE_LIMIT_UNPAID - dailyCount),
  };
}
