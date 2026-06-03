import { isAllowedExtensionMinutes } from "../sessionExtensionValidator";
import { SESSION_EXTENSION } from "../../../config/sessionExtension";

describe("sessionExtensionValidator", () => {
  it("allows configured block minutes only", () => {
    for (const m of SESSION_EXTENSION.BLOCK_MINUTES) {
      expect(isAllowedExtensionMinutes(m)).toBe(true);
    }
    expect(isAllowedExtensionMinutes(7)).toBe(false);
    expect(isAllowedExtensionMinutes(999)).toBe(false);
  });
});
