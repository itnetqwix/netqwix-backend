import { estimateFirstLessonCheckoutDiscount } from "../../../config/referral";

describe("referral checkout discount", () => {
  it("returns zero when first-lesson checkout discount is disabled", () => {
    const d = estimateFirstLessonCheckoutDiscount(10);
    expect(d).toBe(0);
  });

  it("returns zero for zero price", () => {
    expect(estimateFirstLessonCheckoutDiscount(0)).toBe(0);
  });
});
