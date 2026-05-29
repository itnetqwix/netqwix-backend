import {
  isSignalingFromUser,
  parseRemoteMuteState,
} from "../signalingPayload";

describe("signalingPayload", () => {
  it("prefers isMuted over muteStatus", () => {
    expect(parseRemoteMuteState({ isMuted: true, muteStatus: false })).toBe(true);
    expect(parseRemoteMuteState({ isMuted: false, muteStatus: true })).toBe(false);
  });

  it("falls back to muteStatus when isMuted absent", () => {
    expect(parseRemoteMuteState({ muteStatus: true })).toBe(true);
    expect(parseRemoteMuteState({})).toBe(false);
  });

  it("matches signaling user id", () => {
    expect(isSignalingFromUser({ from_user: "abc" }, "abc")).toBe(true);
    expect(isSignalingFromUser({ from_user: "abc" }, "xyz")).toBe(false);
    expect(isSignalingFromUser(null, "abc")).toBe(false);
  });
});
