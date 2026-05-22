/**
 * Verify SES SMTP + Twilio (no messages sent).
 * Usage: node scripts/test-messaging.mjs
 */
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

async function verifyEmail() {
  const required = ["EMAIL_HOST", "EMAIL_USERNAME", "EMAIL_PASSWORD", "EMAIL_FROM"];
  if (!required.every((k) => String(process.env[k] || "").trim())) {
    return { configured: false, ok: false, message: "Missing EMAIL_* env vars." };
  }
  const port = Number(process.env.EMAIL_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  try {
    await transporter.verify();
    return {
      configured: true,
      ok: true,
      message: "SMTP verified (AWS SES).",
      from: process.env.EMAIL_FROM,
    };
  } catch (e) {
    return { configured: true, ok: false, message: e.message, from: process.env.EMAIL_FROM };
  }
}

async function verifySms() {
  const sid = process.env.SMS_SID;
  const token = process.env.SMS_TOKEN;
  const number = process.env.SMS_NUMBER;
  if (![sid, token, number].every((v) => String(v || "").trim())) {
    return { configured: false, ok: false, message: "Missing SMS_* env vars." };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  try {
    const accountRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const account = await accountRes.json();
    if (!accountRes.ok) {
      return {
        configured: true,
        ok: false,
        message: account.message || `Twilio HTTP ${accountRes.status}`,
      };
    }

    const phoneRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const phoneList = await phoneRes.json();
    const numberOk = Array.isArray(phoneList.incoming_phone_numbers) &&
      phoneList.incoming_phone_numbers.length > 0;

    return {
      configured: true,
      ok: account.status === "active" && numberOk,
      message: numberOk
        ? `Twilio account ${account.status}; sender ${number} registered.`
        : `Twilio ${account.status} but ${number} not on this account.`,
      from: number,
      accountStatus: account.status,
    };
  } catch (e) {
    return { configured: true, ok: false, message: e.message, from: number };
  }
}

const email = await verifyEmail();
const sms = await verifySms();
console.log(
  JSON.stringify(
    {
      email,
      sms,
      whatsapp: {
        configured: Boolean(process.env.WHATSAPP_FROM),
        enabled: false,
        message: "WhatsApp disabled — use SMS and email only.",
      },
    },
    null,
    2
  )
);
if (!email.ok || !sms.ok) process.exit(1);
