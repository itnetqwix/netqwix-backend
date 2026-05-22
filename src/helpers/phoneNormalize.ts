/**
 * E.164 normalization for signup OTP SMS.
 * Defaults: 10-digit numbers starting 6–9 → India (+91); other 10-digit → US (+1).
 * Override with SMS_DEFAULT_COUNTRY=IN|US in .env.
 */
export function normalizeSignupPhone(mobile: string): string {
  const trimmed = String(mobile || "").trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  const defaultCountry = String(process.env.SMS_DEFAULT_COUNTRY || "IN")
    .trim()
    .toUpperCase();

  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return defaultCountry === "US" ? `+1${digits}` : `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1") && defaultCountry === "US") {
    return `+${digits}`;
  }
  if (digits.length === 10 && defaultCountry === "US") {
    return `+1${digits}`;
  }

  return `+${digits}`;
}

/** User-facing message for common Twilio geo-permission errors. */
export function mapSmsSendError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");

  if (/permission to send an SMS has not been enabled for the region/i.test(raw)) {
    return (
      "SMS is not enabled for this country on our messaging account. " +
      "Enable India (+91) in Twilio Console → Messaging → Geo permissions, " +
      "or verify with email only."
    );
  }
  if (/invalid.*to.*phone/i.test(raw) || /not a valid phone number/i.test(raw)) {
    return "Enter a valid mobile number with country code (e.g. +91 for India).";
  }
  return raw || "Could not send SMS code.";
}
