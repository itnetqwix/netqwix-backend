const MAX_TEXT_LENGTH = 8000;
const ALLOWED_TYPES = new Set(["text", "image", "video", "audio", "file", "location"]);

export function validateChatSendBody(body: Record<string, unknown>): string | null {
  const type = String(body?.type ?? "text").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    return "Invalid message type.";
  }
  const content = body?.content;
  if (type === "text") {
    if (typeof content !== "string" || !content.trim()) {
      return "content is required for text messages";
    }
    if (content.length > MAX_TEXT_LENGTH) {
      return `Message exceeds ${MAX_TEXT_LENGTH} characters.`;
    }
  } else if (content != null && typeof content === "string" && content.length > MAX_TEXT_LENGTH) {
    return `Caption exceeds ${MAX_TEXT_LENGTH} characters.`;
  }
  const mediaUrl = body?.mediaUrl;
  if (mediaUrl != null && typeof mediaUrl !== "string") {
    return "mediaUrl must be a string.";
  }
  if (mediaUrl && mediaUrl.length > 2048) {
    return "mediaUrl is too long.";
  }
  return null;
}
