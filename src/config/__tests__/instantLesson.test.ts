import {
  computeInstantReservationWindowMs,
  INSTANT_ALLOWED_DURATIONS,
  isInstantAllowedDuration,
} from "../instantLesson";

describe("instantLesson config", () => {
  it("allows only 15 and 30 minute instant lessons", () => {
    expect(INSTANT_ALLOWED_DURATIONS).toEqual([15, 30]);
    expect(isInstantAllowedDuration(15)).toBe(true);
    expect(isInstantAllowedDuration(30)).toBe(true);
    expect(isInstantAllowedDuration(60)).toBe(false);
  });

  it("computes total reservation window (2+2+lesson+15 buffer)", () => {
    expect(computeInstantReservationWindowMs(15)).toBe(34 * 60 * 1000);
    expect(computeInstantReservationWindowMs(30)).toBe(49 * 60 * 1000);
  });
});
