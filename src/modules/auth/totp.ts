/**
 * Self-contained TOTP (RFC 6238 over HMAC-SHA1, RFC 4226).
 *
 * Why not use `otplib`/`speakeasy`?
 *   Adding a dep takes ops review. TOTP is ~50 lines of crypto — keeping
 *   it in-tree means a single place to audit, and lets us choose
 *   forward-compatible options (drift window, SHA-256) later without a
 *   library change.
 *
 * Secrets are 20 random bytes encoded as base32, which is what Google
 * Authenticator and 1Password expect. The otpauth URI we emit follows
 * the Key URI Format spec exactly so QR codes scan everywhere.
 */

import * as crypto from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): { base32: string } {
  return { base32: base32Encode(crypto.randomBytes(20)) };
}

function generateHotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  // Big-endian 64-bit counter.
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function generateTotp(base32Secret: string, when: Date = new Date(), step = 30): string {
  const counter = Math.floor(when.getTime() / 1000 / step);
  return generateHotp(base32Decode(base32Secret), counter);
}

/**
 * `window` = number of 30-second slots before/after we accept. Default
 * 1 covers clock drift on the authenticator app (±30 s).
 */
export function verifyTotp(
  base32Secret: string,
  token: string,
  options?: { window?: number; step?: number; at?: Date }
): boolean {
  const window = options?.window ?? 1;
  const step = options?.step ?? 30;
  const at = options?.at ?? new Date();
  const counter = Math.floor(at.getTime() / 1000 / step);
  const secret = base32Decode(base32Secret);
  const normalized = String(token).replace(/\s+/g, "");
  if (!/^[0-9]{6}$/.test(normalized)) return false;
  for (let delta = -window; delta <= window; delta++) {
    if (generateHotp(secret, counter + delta) === normalized) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUrl(opts: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = encodeURIComponent(opts.issuer ?? "NetQwix");
  const account = encodeURIComponent(`${opts.issuer ?? "NetQwix"}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer ?? "NetQwix",
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${account}?${params.toString()}`;
}

/** AES-256-GCM symmetric encrypt for at-rest secret storage. */
export function encryptSecret(plain: string, key: Buffer): { cipher: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: enc.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

export function decryptSecret(
  cipher: string,
  iv: string,
  tag: string,
  key: Buffer
): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(cipher, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function getTwoFactorKey(): Buffer {
  const env = process.env.TWO_FACTOR_SECRET_KEY || process.env.JWT_SECRET || "";
  // SHA-256 of the env secret gives us a deterministic 32-byte key.
  return crypto.createHash("sha256").update(env).digest();
}
