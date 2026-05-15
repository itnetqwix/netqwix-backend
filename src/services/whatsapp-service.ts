const Twilio = require("twilio");
const dotenv = require("dotenv");
dotenv.config();

class WhatsAppService {
  private client: typeof Twilio;
  private whatsappFrom: string;
  private configured: boolean;

  constructor() {
    const { SMS_SID, SMS_TOKEN, WHATSAPP_FROM } = process.env;
    this.configured = !!(SMS_SID && SMS_TOKEN && WHATSAPP_FROM);
    if (this.configured) {
      this.client = new Twilio(SMS_SID, SMS_TOKEN);
      this.whatsappFrom = WHATSAPP_FROM!;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async sendWhatsApp(toNumber: string, message: string): Promise<object | null> {
    if (!this.configured) {
      console.warn("[WhatsApp] Service not configured – skipping.");
      return null;
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        from: `whatsapp:${this.whatsappFrom}`,
        to: `whatsapp:${toNumber}`,
      });
      return result;
    } catch (error) {
      console.error(`[WhatsApp] Error sending to ${toNumber}:`, error?.message);
      throw error;
    }
  }
}

export default WhatsAppService;
