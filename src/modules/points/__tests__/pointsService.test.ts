import {
  POINTS_CONFIG,
  pointsToWalletMinor,
  referralMatrixPoints,
  redeemBlocksAvailable,
} from "../../../config/points";
import { AccountType } from "../../auth/authEnum";

describe("points config", () => {
  it("100 points = $5 wallet minor", () => {
    expect(pointsToWalletMinor(100)).toBe(500);
  });

  it("redeem blocks", () => {
    expect(redeemBlocksAvailable(250)).toBe(2);
    expect(redeemBlocksAvailable(99)).toBe(0);
  });

  it("referral matrix caps at 5", () => {
    const pts = referralMatrixPoints(
      "signup",
      "referrer",
      AccountType.TRAINER,
      AccountType.TRAINEE
    );
    expect(pts).toBeLessThanOrEqual(POINTS_CONFIG.maxPointsPerAction);
    expect(pts).toBe(5);
  });
});
