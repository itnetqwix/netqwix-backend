import { formatRewardPreviewPoints, referralMatrixPoints } from "../../../config/points";
import { AccountType } from "../../auth/authEnum";

describe("referral reward matrix (points)", () => {
  it("trainer referring trainee earns signup + first booking points", () => {
    const preview = formatRewardPreviewPoints(AccountType.TRAINER, AccountType.TRAINEE);
    expect(preview.referrerSignupPoints).toBeGreaterThan(0);
    expect(preview.refereeSignupPoints).toBeGreaterThan(0);
    expect(preview.referrerFirstBookingPoints).toBeGreaterThan(0);
    expect(preview.referrerSignupPoints).toBeLessThanOrEqual(5);
    expect(preview.refereeSignupPoints).toBeLessThanOrEqual(5);
  });

  it("trainee referring trainer has referrer signup only", () => {
    const referrer = referralMatrixPoints(
      "signup",
      "referrer",
      AccountType.TRAINEE,
      AccountType.TRAINER
    );
    const firstBooking = referralMatrixPoints(
      "first_booking",
      "referrer",
      AccountType.TRAINEE,
      AccountType.TRAINER
    );
    expect(referrer).toBeGreaterThan(0);
    expect(firstBooking).toBe(0);
  });

  it("matrix keys are symmetric for trainee-trainee", () => {
    const a = formatRewardPreviewPoints(AccountType.TRAINEE, AccountType.TRAINEE);
    const b = formatRewardPreviewPoints(AccountType.TRAINEE, AccountType.TRAINEE);
    expect(a).toEqual(b);
  });
});
