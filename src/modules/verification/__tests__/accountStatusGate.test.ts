import {
  isAccountAccessRestricted,
  isAccountStatusWhitelistedPath,
} from "../accountStatusGate";
import { isOnboardingRequired } from "../onboardingHelpers";

describe("accountStatusGate", () => {
  const baseUser = {
    account_type: "Trainee",
    status: "approved",
  };

  it("restricts rejected trainees", () => {
    expect(
      isAccountAccessRestricted({ ...baseUser, status: "rejected" })
    ).toBe(true);
  });

  it("restricts pending trainees", () => {
    expect(
      isAccountAccessRestricted({ ...baseUser, status: "pending" })
    ).toBe(true);
  });

  it("restricts rejected trainers", () => {
    expect(
      isAccountAccessRestricted({
        account_type: "Trainer",
        status: "rejected",
        trainer_verification: { onboarding_step: "profile_face_complete" },
      })
    ).toBe(true);
  });

  it("allows approved trainees", () => {
    expect(isAccountAccessRestricted(baseUser)).toBe(false);
  });

  it("whitelists reapply path", () => {
    expect(isAccountStatusWhitelistedPath("/clips/account/reapply")).toBe(true);
  });

  it("whitelists verification status", () => {
    expect(isAccountStatusWhitelistedPath("/verification/status")).toBe(true);
  });
});

describe("onboardingHelpers rejected trainers", () => {
  it("requires onboarding for rejected trainers", () => {
    expect(
      isOnboardingRequired({
        account_type: "Trainer",
        status: "rejected",
        trainer_verification: { onboarding_step: "profile_face_complete" },
      })
    ).toBe(true);
  });
});
