import {
  formatRewardPreview,
  referralMatrixAmount,
} from "../../../config/referral";
import { AccountType } from "../../auth/authEnum";

describe("referral reward matrix", () => {
  it("trainer referring trainee earns signup + first booking", () => {
    const preview = formatRewardPreview(AccountType.TRAINER, AccountType.TRAINEE);
    expect(preview.referrerSignupMinor).toBeGreaterThan(0);
    expect(preview.refereeSignupMinor).toBeGreaterThan(0);
    expect(preview.referrerFirstBookingMinor).toBeGreaterThan(0);
  });

  it("trainee referring trainer has referrer signup only", () => {
    const referrer = referralMatrixAmount(
      "signup",
      "referrer",
      AccountType.TRAINEE,
      AccountType.TRAINER
    );
    const firstBooking = referralMatrixAmount(
      "first_booking",
      "referrer",
      AccountType.TRAINEE,
      AccountType.TRAINER
    );
    expect(referrer).toBeGreaterThan(0);
    expect(firstBooking).toBe(0);
  });

  it("matrix keys are symmetric for trainee-trainee", () => {
    const a = formatRewardPreview(AccountType.TRAINEE, AccountType.TRAINEE);
    const b = formatRewardPreview(AccountType.TRAINEE, AccountType.TRAINEE);
    expect(a).toEqual(b);
  });
});
