import {
  computeMixedClientWarning,
  parseLessonClientKindFromHeaders,
} from "../lesson/lessonClientTelemetry";
import {
  _clearLessonClientTelemetryMemoryForTests,
  clearLessonClientTelemetry,
  getPeerLessonClientKind,
  recordLessonParticipantClient,
} from "../lesson/lessonClientTelemetryStore";

describe("lessonClientTelemetry", () => {
  const sessionId = "sess-1";

  beforeEach(async () => {
    _clearLessonClientTelemetryMemoryForTests();
    await clearLessonClientTelemetry(sessionId);
  });

  it("maps mobile header to native_app", () => {
    expect(parseLessonClientKindFromHeaders({ "x-nq-client": "mobile" })).toBe(
      "native_app"
    );
    expect(parseLessonClientKindFromHeaders({ "x-nq-client": "web" })).toBe("web");
  });

  it("warns native viewer when peer is on web", async () => {
    await recordLessonParticipantClient({
      sessionId,
      userId: "t1",
      accountType: "Trainee",
      clientKind: "native_app",
    });
    await recordLessonParticipantClient({
      sessionId,
      userId: "c1",
      accountType: "Trainer",
      clientKind: "web",
    });
    const peer = await getPeerLessonClientKind({
      sessionId,
      viewerUserId: "t1",
      isTrainer: false,
    });
    expect(peer).toBe("web");
    const msg = computeMixedClientWarning({
      viewerClient: "native_app",
      peerClient: peer,
      peerRole: "trainer",
    });
    expect(msg).toMatch(/coach.*web/i);
  });

  it("warns web viewer to use mobile app", () => {
    const msg = computeMixedClientWarning({
      viewerClient: "web",
      peerClient: "native_app",
      peerRole: "trainee",
    });
    expect(msg).toMatch(/mobile app/i);
  });
});
