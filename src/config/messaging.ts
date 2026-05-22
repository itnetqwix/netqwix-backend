/** Email (AWS SES SMTP) and SMS (Twilio) — env configuration. WhatsApp is optional (WHATSAPP_FROM). */

export type MessagingChannelStatus = {
  configured: boolean;
  ok: boolean;
  message: string;
  detail?: Record<string, unknown>;
};

function hasValue(key: string): boolean {
  return Boolean(String(process.env[key] || "").trim());
}

export function getEmailEnv() {
  return {
    host: process.env.EMAIL_HOST || "",
    port: Number(process.env.EMAIL_PORT || 587),
    user: process.env.EMAIL_USERNAME || "",
    pass: process.env.EMAIL_PASSWORD || "",
    from: process.env.EMAIL_FROM || "",
  };
}

export function isEmailConfigured(): boolean {
  const e = getEmailEnv();
  return Boolean(e.host && e.user && e.pass && e.from);
}

export function getSmsEnv() {
  return {
    sid: process.env.SMS_SID || "",
    token: process.env.SMS_TOKEN || "",
    number: process.env.SMS_NUMBER || "",
  };
}

export function isSmsConfigured(): boolean {
  const s = getSmsEnv();
  return Boolean(s.sid && s.token && s.number);
}

export function isWhatsAppConfigured(): boolean {
  return isSmsConfigured() && hasValue("WHATSAPP_FROM");
}

/** Link base for session SMS (falls back to FRONTEND_URL). */
export function getSessionSmsLinkBase(): string {
  return (
    process.env.FRONTEND_URL_SMS ||
    process.env.FRONTEND_URL ||
    "https://app.netqwix.com"
  );
}
