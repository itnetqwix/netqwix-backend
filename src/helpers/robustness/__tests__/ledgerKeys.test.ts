import {
  ledgerFirstLegIdempotencyKey,
  ledgerLegIdempotencyKey,
} from "../ledgerKeys";

describe("ledgerKeys", () => {
  it("builds first-leg and indexed leg keys", () => {
    expect(ledgerFirstLegIdempotencyKey("escrow:session:1")).toBe(
      "escrow:session:1:0"
    );
    expect(ledgerLegIdempotencyKey("escrow:session:1", 2)).toBe(
      "escrow:session:1:2"
    );
  });
});
