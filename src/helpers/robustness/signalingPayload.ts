/** Normalize MUTE_ME payload from partner (supports legacy muteStatus). */
export function parseRemoteMuteState(
  payload: { isMuted?: boolean; muteStatus?: boolean } | null | undefined
): boolean {
  if (!payload) return false;
  if (typeof payload.isMuted === "boolean") return payload.isMuted;
  if (typeof payload.muteStatus === "boolean") return payload.muteStatus;
  return false;
}

/** Returns true when event is from the expected remote user. */
export function isSignalingFromUser(
  userInfo: { from_user?: string } | null | undefined,
  expectedUserId: string
): boolean {
  if (!userInfo?.from_user || !expectedUserId) return false;
  return String(userInfo.from_user) === String(expectedUserId);
}
