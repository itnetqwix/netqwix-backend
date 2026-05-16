import * as jwt from "jsonwebtoken";
import axios from "axios";
import * as crypto from "crypto";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

type AppleKey = { kid: string; n: string; e: string; kty: string };

let cachedKeys: AppleKey[] | null = null;
let cacheAt = 0;

async function getAppleKeys(): Promise<AppleKey[]> {
  const now = Date.now();
  if (cachedKeys && now - cacheAt < 60 * 60 * 1000) return cachedKeys;
  const { data } = await axios.get<{ keys: AppleKey[] }>(APPLE_KEYS_URL);
  cachedKeys = data.keys ?? [];
  cacheAt = now;
  return cachedKeys;
}

/** Verify Apple identity token; returns { sub, email? }. */
export async function verifyAppleIdentityToken(
  identityToken: string
): Promise<{ sub: string; email?: string }> {
  const decoded = jwt.decode(identityToken, { complete: true }) as {
    header?: { kid?: string };
  } | null;
  const kid = decoded?.header?.kid;
  if (!kid) throw new Error("Invalid Apple token header");

  const keys = await getAppleKeys();
  const match = keys.find((k) => k.kid === kid);
  if (!match) throw new Error("Apple signing key not found");

  const pubKey = crypto.createPublicKey({
    key: { kty: "RSA", n: match.n, e: match.e },
    format: "jwk",
  });

  const payload = jwt.verify(identityToken, pubKey, {
    algorithms: ["RS256"],
    issuer: APPLE_ISSUER,
  }) as { sub: string; email?: string };

  if (!payload?.sub) throw new Error("Apple token missing subject");
  return { sub: payload.sub, email: payload.email };
}
