/** Keys must match `src/templates/*.html` placeholders (`{NAME}`, `{TRAINER_NAME}`, …). */
export function verificationEmailPlaceholders(input: {
  name: string;
  frontendUrl?: string;
  reason?: string;
  email?: string;
  phone?: string;
  adminUrl?: string;
}): Record<string, string> {
  const frontend = input.frontendUrl || "https://www.netqwix.com";
  const out: Record<string, string> = {
    "{NAME}": input.name,
    "{TRAINER_NAME}": input.name,
    "{TRAINEE_NAME}": input.name,
    "{FIRSTNAME}": input.name.split(" ")[0] || input.name,
    "{FRONTEND_URL}": frontend,
  };
  if (input.reason != null) {
    out["{REASON}"] = input.reason;
    out["{REASON_BLOCK}"] = input.reason.trim()
      ? `<p style="color:#555;font-size:15px;line-height:1.75;margin:0 0 14px;"><strong>Reason:</strong> ${input.reason}</p>`
      : "";
  } else {
    out["{REASON_BLOCK}"] = "";
  }
  if (input.email != null) out["{EMAIL}"] = input.email;
  if (input.phone != null) out["{PHONE}"] = input.phone;
  if (input.adminUrl != null) out["{ADMIN_URL}"] = input.adminUrl;
  return out;
}
