import mongoose from "mongoose";
import { ClipShareService } from "../clipShareService";

describe("ClipShareService validation", () => {
  const service = new ClipShareService();
  const sharerId = new mongoose.Types.ObjectId().toString();

  it("rejects empty clip list", async () => {
    const result = await (service as any).assertOwnClips(sharerId, []);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at least one clip/i);
  });

  it("rejects more than max clips per request", async () => {
    const ids = Array.from({ length: 21 }, () => new mongoose.Types.ObjectId().toString());
    const result = await (service as any).assertOwnClips(sharerId, ids);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/up to 20/i);
  });
});
