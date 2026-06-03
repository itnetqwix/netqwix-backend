jest.mock("../../../services/redisClient", () => ({
  isRedisEnabled: jest.fn(),
  redisGetJson: jest.fn(),
  redisSetJson: jest.fn(),
  redisDel: jest.fn(),
}));

import {
  isRedisEnabled,
  redisDel,
  redisGetJson,
  redisSetJson,
} from "../../../services/redisClient";
import {
  _clearLessonClientTelemetryMemoryForTests,
  clearLessonClientTelemetry,
  getPeerLessonClientKind,
  recordLessonParticipantClient,
} from "../lessonClientTelemetryStore";

const mockRedisEnabled = isRedisEnabled as jest.Mock;
const mockGet = redisGetJson as jest.Mock;
const mockSet = redisSetJson as jest.Mock;
const mockDel = redisDel as jest.Mock;

describe("lessonClientTelemetryStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearLessonClientTelemetryMemoryForTests();
    mockRedisEnabled.mockReturnValue(false);
  });

  it("stores participants in memory when Redis is off", async () => {
    await recordLessonParticipantClient({
      sessionId: "s1",
      userId: "u1",
      accountType: "Trainee",
      clientKind: "native_app",
    });
    expect(
      await getPeerLessonClientKind({
        sessionId: "s1",
        viewerUserId: "u2",
        isTrainer: true,
      })
    ).toBe("native_app");
    await recordLessonParticipantClient({
      sessionId: "s1",
      userId: "u2",
      accountType: "Trainer",
      clientKind: "web",
    });
    expect(
      await getPeerLessonClientKind({
        sessionId: "s1",
        viewerUserId: "u1",
        isTrainer: false,
      })
    ).toBe("web");
  });

  it("reads and writes Redis blob when enabled", async () => {
    mockRedisEnabled.mockReturnValue(true);
    const store: Record<string, unknown> = {};
    mockGet.mockImplementation(async (key: string) => store[key] ?? null);
    mockSet.mockImplementation(async (key: string, value: unknown) => {
      store[key] = value;
    });

    await recordLessonParticipantClient({
      sessionId: "redis-sess",
      userId: "t1",
      accountType: "Trainee",
      clientKind: "native_app",
    });
    await recordLessonParticipantClient({
      sessionId: "redis-sess",
      userId: "c1",
      accountType: "Trainer",
      clientKind: "web",
    });

    expect(mockSet).toHaveBeenCalled();
    expect(
      await getPeerLessonClientKind({
        sessionId: "redis-sess",
        viewerUserId: "t1",
        isTrainer: false,
      })
    ).toBe("web");

    await clearLessonClientTelemetry("redis-sess");
    expect(mockDel).toHaveBeenCalled();
  });
});
