import { chatClientSendDedupeFilter } from "../chatDedupe";

describe("chatDedupe", () => {
  it("builds dedupe filter for clientMessageId + sender", () => {
    expect(chatClientSendDedupeFilter("temp_123", "user_a")).toEqual({
      clientMessageId: "temp_123",
      senderId: "user_a",
    });
  });
});
