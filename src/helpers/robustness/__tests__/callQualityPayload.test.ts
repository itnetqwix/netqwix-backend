/** Matrix: P8 — call quality payload shape */
import { normalizeCallQualityStatsPayload } from "../callQualityPayload";

describe("callQualityPayload", () => {
  it("normalizes packet loss and rtt", () => {
    const out = normalizeCallQualityStatsPayload({
      sessionId: "abc",
      packetLossPercent: "12.5",
      roundTripTimeMs: 140,
      jitterMs: null,
    });
    expect(out).toEqual({
      sessionId: "abc",
      packetLossPercent: 12.5,
      roundTripTimeMs: 140,
      jitterMs: null,
    });
  });

  it("returns null for empty payload", () => {
    expect(normalizeCallQualityStatsPayload(null)).toBeNull();
    expect(normalizeCallQualityStatsPayload({})).toBeNull();
  });
});
