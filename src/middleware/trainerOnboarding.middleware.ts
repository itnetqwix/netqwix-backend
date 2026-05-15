import { CONSTANCE } from "../config/constance";
import {
  buildOnboardingStatus,
  isOnboardingRequired,
  isOnboardingWhitelistedPath,
} from "../modules/verification/onboardingHelpers";

/** Block trainers who have not completed onboarding from non-whitelisted API routes. */
export function trainerOnboardingGate(req: any, res: any, next: () => void) {
  const authUser = req.authUser;
  if (!authUser) return next();

  const path = req.path || req.url || "";
  if (isOnboardingWhitelistedPath(path)) return next();

  if (!isOnboardingRequired(authUser)) return next();

  const onboarding = buildOnboardingStatus(authUser);
  return res.status(403).json({
    status: CONSTANCE.FAIL,
    error: "Trainer onboarding required",
    code: "TRAINER_ONBOARDING_REQUIRED",
    onboarding,
  });
}
