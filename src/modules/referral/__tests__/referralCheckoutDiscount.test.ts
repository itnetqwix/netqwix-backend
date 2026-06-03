import { estimateFirstLessonCheckoutDiscount } from "../../../config/referral";

describe("referral checkout discount", () => {
  it("caps fixed discount at lesson price", () => {
    const d = estimateFirstLessonCheckoutDiscount(10);
    expect(d).toBeLessThanOrEqual(10);
    expect(d).toBeGreaterThan(0);
  });

  it("returns zero for zero price", () => {
    expect(estimateFirstLessonCheckoutDiscount(0)).toBe(0);
  });
});
