import {
  bindLessonCallSlotIo,
  isLessonCallSocketLive,
} from "../lessonCallSlotIo";
import {
  claimLessonCallSlot,
  getLessonCallSlotStatus,
} from "../lessonCallSlotStore";

describe("lessonCallSlotStore", () => {
  beforeEach(() => {
    bindLessonCallSlotIo(() => null);
  });

  it("claims when no prior holder exists", async () => {
    const result = await claimLessonCallSlot({
      sessionId: "sess1",
      userId: "user1",
      socketId: "sock-a",
      deviceId: "dev-a",
    });
    expect(result).toEqual({ ok: true });
  });

  it("reclaims slot when previous holder socket is gone", async () => {
    bindLessonCallSlotIo(
      () =>
        ({
          sockets: {
            sockets: new Map([["sock-live", { connected: true }]]),
          },
        }) as any
    );

    expect(isLessonCallSocketLive("sock-live")).toBe(true);
    expect(isLessonCallSocketLive("sock-dead")).toBe(false);

    await claimLessonCallSlot({
      sessionId: "sess2",
      userId: "user2",
      socketId: "sock-dead",
      deviceId: "dev-old",
    });

    const result = await claimLessonCallSlot({
      sessionId: "sess2",
      userId: "user2",
      socketId: "sock-new",
      deviceId: "dev-new",
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports canTakeOver when another live device holds the slot", async () => {
    bindLessonCallSlotIo(
      () =>
        ({
          sockets: {
            sockets: new Map([["sock-live", { connected: true }]]),
          },
        }) as any
    );

    await claimLessonCallSlot({
      sessionId: "sess3",
      userId: "user3",
      socketId: "sock-live",
      deviceId: "dev-other",
    });

    const status = await getLessonCallSlotStatus({
      sessionId: "sess3",
      userId: "user3",
      deviceId: "dev-new",
    });
    expect(status).toMatchObject({
      canJoin: false,
      reason: "already_active_elsewhere",
      canTakeOver: true,
    });
  });
});
