import { isEmailConfigured, isSmsConfigured, isWhatsAppConfigured, getEmailEnv, getSmsEnv } from "../config/messaging";
import { fetchTwilioAccount, isTwilioNumberOnAccount } from "./twilioRest";

const nodemailer = require("nodemailer");

export type MessagingHealthReport = {
  email: {
    configured: boolean;
    ok: boolean;
    message: string;
    from?: string;
    host?: string;
  };
  sms: {
    configured: boolean;
    ok: boolean;
    message: string;
    from?: string;
    accountStatus?: string;
  };
  whatsapp: {
    configured: boolean;
    enabled: boolean;
    message: string;
  };
};

function buildSmtpTransport() {
  const e = getEmailEnv();
  const port = e.port || 587;
  return nodemailer.createTransport({
    host: e.host,
    port,
    secure: port === 465,
    auth: { user: e.user, pass: e.pass },
  });
}

/** Verify SMTP credentials (AWS SES) without sending mail. */
export async function verifyEmailTransport(): Promise<MessagingHealthReport["email"]> {
  if (!isEmailConfigured()) {
    return {
      configured: false,
      ok: false,
      message: "Missing EMAIL_USERNAME, EMAIL_PASSWORD, EMAIL_HOST, EMAIL_PORT, or EMAIL_FROM.",
    };
  }
  const e = getEmailEnv();
  try {
    const transporter = buildSmtpTransport();
    await transporter.verify();
    return {
      configured: true,
      ok: true,
      message: "SMTP connection verified (SES).",
      from: e.from,
      host: e.host,
    };
  } catch (err: any) {
    return {
      configured: true,
      ok: false,
      message: err?.message || "SMTP verify failed.",
      from: e.from,
      host: e.host,
    };
  }
}

/** Check Twilio account + sender number via API (no SMS sent). */
export async function verifySmsTransport(): Promise<MessagingHealthReport["sms"]> {
  if (!isSmsConfigured()) {
    return {
      configured: false,
      ok: false,
      message: "Missing SMS_SID, SMS_TOKEN, or SMS_NUMBER.",
    };
  }
  const { sid, token, number } = getSmsEnv();
  try {
    const account = await fetchTwilioAccount(sid, token);
    const numberOk = await isTwilioNumberOnAccount(sid, token, number);
    return {
      configured: true,
      ok: account.status === "active" && numberOk,
      message: numberOk
        ? `Twilio account ${account.status}; sender ${number} found.`
        : `Twilio account ${account.status}; sender ${number} not on this account — check SMS_NUMBER.`,
      from: number,
      accountStatus: account.status,
    };
  } catch (err: any) {
    return {
      configured: true,
      ok: false,
      message: err?.message || "Twilio API check failed.",
      from: number,
    };
  }
}

export async function getMessagingHealth(): Promise<MessagingHealthReport> {
  const [email, sms] = await Promise.all([verifyEmailTransport(), verifySmsTransport()]);
  const whatsappConfigured = isWhatsAppConfigured();
  return {
    email,
    sms,
    whatsapp: {
      configured: whatsappConfigured,
      enabled: false,
      message: whatsappConfigured
        ? "WhatsApp env present but disabled in app — use SMS/email only."
        : "WhatsApp not configured (optional). Set WHATSAPP_FROM only if enabling later.",
    },
  };
}
