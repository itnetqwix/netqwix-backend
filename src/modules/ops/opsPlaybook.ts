/** Static resolution steps keyed by event_type for admin UI. */
export const OPS_RESOLUTION_PLAYBOOK: Record<
  string,
  { title: string; steps: string[]; doc_url?: string }
> = {
  CLIENT_PRECALL_FAILED: {
    title: "Pre-call check failed",
    steps: [
      "Ask the user to allow camera and microphone in the browser.",
      "Have them retry in Chrome or Safari (latest version).",
      "On iOS, check Settings → Safari → Camera/Microphone for the site.",
      "If permissions are granted, ask them to refresh and rejoin the lesson.",
    ],
    doc_url: "https://support.netqwix.com/call-troubleshooting",
  },
  CLIENT_CALL_ERROR: {
    title: "Call connection error",
    steps: [
      "Confirm both parties have stable internet (Wi‑Fi preferred).",
      "Check call diagnostics for ICE / PeerJS errors.",
      "Ask user to leave and rejoin the session.",
      "If repeated, offer reschedule or refund per policy.",
    ],
  },
  INSTANT_LESSON_EXPIRED: {
    title: "Instant lesson request expired",
    steps: [
      "Confirm trainer was offline or did not respond in time.",
      "Check if payment was captured; refund if policy applies.",
      "Offer to rebook instant or scheduled lesson.",
    ],
  },
  WALLET_PIN_LOCKED: {
    title: "Wallet PIN locked",
    steps: [
      "User must use forgot-PIN flow or wait for lockout to clear.",
      "Verify identity if they contact support.",
      "Do not reset PIN manually without verification policy.",
    ],
  },
  CLIENT_LESSON_TIMER_ERROR: {
    title: "Lesson timer sync error",
    steps: [
      "Ask both parties to refresh the meeting page.",
      "Check server session end time vs client clock.",
      "If timer stuck, end session from admin booking if needed.",
    ],
  },
};
