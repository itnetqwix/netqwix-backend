/** In-session instant lesson extension rules. */
export const SESSION_EXTENSION = {
  BLOCK_MINUTES: [15, 30, 60, 120] as const,
  MAX_EXTENSIONS_PER_SESSION: 3,
  MAX_TOTAL_DURATION_MINUTES: 240,
  /** Show extend UI when remaining <= this (seconds). */
  EXTEND_PROMPT_SECONDS: 120,
  /** After timer hits 0, trainee may still pay to extend within this window. */
  GRACE_SECONDS_AFTER_ZERO: 120,
} as const;

export type SessionExtensionBlockMinutes =
  (typeof SESSION_EXTENSION.BLOCK_MINUTES)[number];
