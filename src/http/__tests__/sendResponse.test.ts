import { sendSuccess, sendFail } from "../sendResponse";
import { CONSTANCE } from "../../config/constance";

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("sendResponse", () => {
  it("sendSuccess wraps data", () => {
    const res = mockRes();
    sendSuccess(res, { id: "1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: CONSTANCE.SUCCESS, data: { id: "1" } });
  });

  it("sendFail wraps error string", () => {
    const res = mockRes();
    sendFail(res, "bad", 400);
    expect(res.body).toEqual({ status: CONSTANCE.FAIL, error: "bad" });
  });
});
