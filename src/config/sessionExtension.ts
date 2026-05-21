/** In-session paid extension rules (instant + scheduled). */
export const SESSION_EXTENSION = {
  /** Allowed extension block sizes (minutes). Mobile UI surfaces 5/10/15/30;
   *  60/120 stay available for parity with older clients / admin tools. */
  BLOCK_MINUTES: [5, 10, 15, 30, 60, 120] as const,
  MAX_EXTENSIONS_PER_SESSION: 3,
  MAX_TOTAL_DURATION_MINUTES: 240,
  /** Show extend UI when remaining <= this (seconds). */
  EXTEND_PROMPT_SECONDS: 120,
  /** After timer hits 0, trainee may still pay to extend within this window. */
  GRACE_SECONDS_AFTER_ZERO: 120,
  /** Trainer auto-decline window once trainee requests an extension. */
  REQUEST_AUTO_REJECT_SECONDS: 45,
  /** Trainee must complete payment within this many seconds after trainer accepts. */
  PAYMENT_WINDOW_SECONDS: 120,
} as const;

export type SessionExtensionBlockMinutes =
  (typeof SESSION_EXTENSION.BLOCK_MINUTES)[number];
