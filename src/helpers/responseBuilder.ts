import * as l10n from "jm-ez-l10n";
import { Failure } from "./error";
import { CONSTANCE } from "../config/constance";

export class ResponseBuilder {
  public static successMessage(msg: string): ResponseBuilder {
    const rb: ResponseBuilder = new ResponseBuilder();
    rb.code = 200;
    rb.msg = msg;
    rb.status = CONSTANCE.SUCCESS;
    return rb;
  }

  public static errorMessage(msg?: any): ResponseBuilder {
    const rb: ResponseBuilder = new ResponseBuilder();
    rb.code = 500;
    rb.status = CONSTANCE.FAIL;
    rb.error = msg != null ? msg : l10n.t("ERR_INTERNAL_SERVER");
    return rb;
  }

  public static badRequest(msg: any, code?: number): ResponseBuilder {
    const rb: ResponseBuilder = new ResponseBuilder();
    rb.code = code || 400;
    rb.error = msg;
    rb.status = CONSTANCE.FAIL;
    return rb;
  }

  public static data(result: any, msg?: string): ResponseBuilder {
    const rb: ResponseBuilder = new ResponseBuilder();
    rb.code = 200;
    result.message = msg;
    result.status = CONSTANCE.SUCCESS;
    rb.result = result;
    rb.msg = msg || null;
    return rb;
  }

  public static error(err: Failure, msg?: string): ResponseBuilder {
    const rb: ResponseBuilder = new ResponseBuilder();
    if (err instanceof ResponseBuilder) {
      return err;
    }
    rb.code = 500;
    rb.error = err || l10n.t("ERR_INTERNAL_SERVER");
    rb.status = CONSTANCE.FAIL;
    rb.msg = msg || null;
    rb.description = err.description;
    rb.result = err
      ? l10n.t("ERR_THROW_BY_CODE")
      : l10n.t("ERR_INTERNAL_SERVER");
    return rb;
  }
  public code: number;
  public msg: string;
  public error: string;
  public status: string;
  public result: any;
  public description: string;
}
