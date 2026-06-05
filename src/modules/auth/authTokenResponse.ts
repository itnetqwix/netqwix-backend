import type { Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { getAccessJwtExpirationSeconds } from "../../config/jwtSecret";

/** Standard auth token bundle for mobile + future web clients. */
export type AuthTokenBundle = {
  access_token: string;
  refresh_token: string;
  session_id: string;
  account_type: string;
  token_type: "Bearer";
  /** Access token lifetime in seconds (for client proactive refresh). */
  expires_in: number;
};

export function buildAuthTokenBundle(input: {
  access_token: string;
  refresh_token: string;
  session_id: string;
  account_type: string;
}): AuthTokenBundle {
  return {
    ...input,
    token_type: "Bearer",
    expires_in: getAccessJwtExpirationSeconds(),
  };
}

export function sendAuthTokenSuccess(res: Response, bundle: AuthTokenBundle, status = 200) {
  return res.status(status).json({
    status: CONSTANCE.SUCCESS,
    data: bundle,
  });
}
