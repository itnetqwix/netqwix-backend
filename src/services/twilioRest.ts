/** Twilio REST helpers (no twilio npm — avoids Node 25+ SDK issues). */

function authHeader(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

export async function fetchTwilioAccount(sid: string, token: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: { Authorization: authHeader(sid, token) },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Twilio HTTP ${res.status}`);
  }
  return data as { status: string; sid: string };
}

export async function isTwilioNumberOnAccount(
  sid: string,
  token: string,
  phoneNumber: string
): Promise<boolean> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
    { headers: { Authorization: authHeader(sid, token) } }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Twilio HTTP ${res.status}`);
  }
  return Array.isArray(data.incoming_phone_numbers) && data.incoming_phone_numbers.length > 0;
}

export async function sendTwilioSms(
  sid: string,
  token: string,
  from: string,
  to: string,
  body: string
): Promise<{ sid: string; status: string }> {
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(sid, token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Twilio HTTP ${res.status}`);
  }
  return { sid: data.sid, status: data.status };
}
