import { log } from "../../../logger";
import { CONSTANCE, UPDATE_FIELDS } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { ReportService } from "./reportService";
import { Request, Response } from "express";
import * as _ from "lodash";

export class reportController {
  public logger = log.getLogger();
  public reportService = new ReportService();

  public createReport = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    req.body.trainer = _id;
    try {
      const result: ResponseBuilder = await this.reportService.createReport(req.body);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };


  public addImage = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    req.body.trainer = _id;
    try {
      const result: ResponseBuilder = await this.reportService.addImage(req.body);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };



  public cropImage = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    req.body.trainer = _id;
    try {
      const result: ResponseBuilder = await this.reportService.cropImage(req.body);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };


  public removeImage = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    req.body.trainer = _id;
    try {
      const result: ResponseBuilder = await this.reportService.removeImage(req.body);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getReport = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    req.body.trainer = _id;
    try {
      const result: ResponseBuilder = await this.reportService.getReport(req.body);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };


  public getAllReport = async (req: any, res: Response) => {
    const { _id, account_type } = req.authUser;
    req.body._id = _id;
    try {
      const result: ResponseBuilder = await this.reportService.getAllReport(req.body);
      return res.status(result.code).send(result);
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };
  
  public deleteReport = async (req: any, res: Response) => {
    const { id } = req.params ;
    try {
      const result: ResponseBuilder = await this.reportService.deleteReport(id);
      return res.status(result.code).json({result});
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };
}
