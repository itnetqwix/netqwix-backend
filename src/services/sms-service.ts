import { mapSmsSendError } from "../helpers/phoneNormalize";
import { getSmsEnv, isSmsConfigured } from "../config/messaging";
import { sendTwilioSms } from "./twilioRest";

export default class SMSService {
  private senderNumber: string;
  private sid: string;
  private token: string;

  constructor() {
    if (!isSmsConfigured()) {
      throw new Error(
        "SMS is not configured. Set SMS_SID, SMS_TOKEN, and SMS_NUMBER in .env."
      );
    }
    const env = getSmsEnv();
    this.senderNumber = env.number;
    this.sid = env.sid;
    this.token = env.token;
  }

  /** Sends an SMS message via Twilio REST API. */
  async sendSMS(toNumber: string, smsContent: string): Promise<object | undefined> {
    const to = String(toNumber || "").trim();
    if (!to) {
      console.warn("[SMS] Missing recipient number.");
      return undefined;
    }

    try {
      const message = await sendTwilioSms(
        this.sid,
        this.token,
        this.senderNumber,
        to,
        smsContent
      );
      console.log(`[SMS] Sent sid=${message.sid} status=${message.status}`);
      return message;
    } catch (error: any) {
      const friendly = mapSmsSendError(error);
      console.error(`[SMS] Send failed: ${friendly}`);
      throw new Error(friendly);
    }
  }
}
