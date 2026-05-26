import mongoose from "mongoose";
import { log } from "../../../logger";
import { CONSTANCE, Message, UPDATE_FIELDS } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { TrainerService } from "./trainerService";
import { SessionExtensionService } from "../trainee/sessionExtensionService";
import { Request, Response } from "express";
import * as _ from "lodash";
import { trainerNotesService } from "./trainerNotesService";
import { traineeNudgeService } from "./traineeNudgeService";

export class trainerController {
  public logger = log.getLogger();
  public trainerService = new TrainerService();
  public sessionExtensionService = new SessionExtensionService();

  public getTraineeNote = async (req: Request, res: Response) => {
    try {
      const trainerId = String(req["authUser"]?._id ?? "");
      const traineeId = String(req.params?.traineeId ?? "");
      const result = await trainerNotesService.getNote(trainerId, traineeId);
      return res.status(result.code).send(
        result.status === CONSTANCE.FAIL
          ? { status: CONSTANCE.FAIL, error: result.error }
          : { status: CONSTANCE.SUCCESS, data: result.result }
      );
    } catch (err: any) {
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err?.message ?? "Internal error" });
    }
  };

  public upsertTraineeNote = async (req: Request, res: Response) => {
    try {
      const trainerId = String(req["authUser"]?._id ?? "");
      const traineeId = String(req.params?.traineeId ?? "");
      const result = await trainerNotesService.upsertNote(trainerId, traineeId, {
        text: req.body?.text,
        tags: req.body?.tags,
      });
      return res.status(result.code).send(
        result.status === CONSTANCE.FAIL
          ? { status: CONSTANCE.FAIL, error: result.error }
          : { status: CONSTANCE.SUCCESS, data: result.result }
      );
    } catch (err: any) {
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err?.message ?? "Internal error" });
    }
  };

  public deleteTraineeNote = async (req: Request, res: Response) => {
    try {
      const trainerId = String(req["authUser"]?._id ?? "");
      const traineeId = String(req.params?.traineeId ?? "");
      const result = await trainerNotesService.deleteNote(trainerId, traineeId);
      return res.status(result.code).send(
        result.status === CONSTANCE.FAIL
          ? { status: CONSTANCE.FAIL, error: result.error }
          : { status: CONSTANCE.SUCCESS, data: result.result }
      );
    } catch (err: any) {
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err?.message ?? "Internal error" });
    }
  };

  public sendTraineeNudge = async (req: Request, res: Response) => {
    try {
      const trainerId = String(req["authUser"]?._id ?? "");
      const traineeId = String(req.body?.traineeId ?? req.params?.traineeId ?? "");
      const template = String(req.body?.template ?? "comeback");
      const customMessage = typeof req.body?.message === "string" ? req.body.message : undefined;
      const result = await traineeNudgeService.sendNudge({
        trainerId,
        traineeId,
        template: template as any,
        customMessage,
      });
      return res.status(result.code).send(
        result.status === CONSTANCE.FAIL
          ? { status: CONSTANCE.FAIL, error: result.error }
          : { status: CONSTANCE.SUCCESS, data: result.result }
      );
    } catch (err: any) {
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err?.message ?? "Internal error" });
    }
  };

  public postSessionRecap = async (req: Request, res: Response) => {
    try {
      const trainerId = String(req["authUser"]?._id ?? "");
      const { sessionId, summary, drills, homework, traineeId } = req.body ?? {};
      const { sessionRecapService } = require("./sessionRecapService");
      const result = await sessionRecapService.sendRecap({
        trainerId,
        traineeId: traineeId ? String(traineeId) : undefined,
        sessionId: sessionId ? String(sessionId) : undefined,
        summary,
        drills,
        homework,
      });
      return res.status(result.code).send(
        result.status === CONSTANCE.FAIL
          ? { status: CONSTANCE.FAIL, error: result.error }
          : { status: CONSTANCE.SUCCESS, data: result.result }
      );
    } catch (err: any) {
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err?.message ?? "Internal error" });
    }
  };

  public getNudgeCandidates = async (req: Request, res: Response) => {
    try {
      const trainerId = String(req["authUser"]?._id ?? "");
      const result = await traineeNudgeService.listInactiveCandidates(trainerId);
      return res.status(result.code).send({
        status: CONSTANCE.SUCCESS,
        data: result.result,
      });
    } catch (err: any) {
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err?.message ?? "Internal error" });
    }
  };

  public respondToSessionExtensionRequest = async (req: Request, res: Response) => {
    try {
      const result = await this.sessionExtensionService.respondToRequest({
        sessionId: req.body.sessionId,
        requestId: req.body.requestId,
        decision: req.body.decision,
        _userId: String(req["authUser"]?._id),
      });
      if (result.code >= 400) {
        return res.status(result.code).send({
          status: CONSTANCE.FAIL,
          error: result.error || result.result,
        });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public updateSchedulingSlots = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    try {
      const result: ResponseBuilder =
        await this.trainerService.updateSchedulingSlots(req.body, _id);
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public addStot = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    req.body.trainer_id = _id;
    try {
      const result: ResponseBuilder = await this.trainerService.addStot(req.body);
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateStot = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.updateStot(req.body);
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public deleteStot = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.deleteStot(req.body);
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getAvailability = async (req: any, res: Response) => {

    if (!req.body.trainer_id) {
      if (req?.authUser?._id) {
        req.body.trainer_id = req?.authUser?._id;
      } else return res
        .status(200)
        .send({ status: CONSTANCE.FAIL, error: "Trainer id is required" });
    }

    else req.body.trainer_id = new mongoose.Types.ObjectId(req.body.trainer_id);

    try {
      const result: ResponseBuilder = await this.trainerService.getAvailability(req.body);
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getSchedulingSlots = async (req: any, res: Response) => {
    const { _id } = req.authUser;
    try {
      const result: ResponseBuilder =
        await this.trainerService.getSchedulingSlots(_id);
      if (result.status !== CONSTANCE.FAIL) {
        return res
          .status(result.code)
          .send({ status: CONSTANCE.SUCCESS, data: result.result });
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getTrainers = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.getTrainers(
        req.query
      );
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getMyStats = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.getMyStats(req?.authUser);
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code ?? 500)
        .send({ status: CONSTANCE.FAIL, error: err.error ?? err.message });
    }
  };

  public recentTrainees = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.recentTrainees(req?.authUser);
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public traineeClips = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.traineeClips(req?.body);
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateProfile = async (req: any, res: Response) => {
    try {
      const payload = _.pick(req.body, UPDATE_FIELDS.user);
      const result: ResponseBuilder = await this.trainerService.updateProfile(
        payload,
        req.authUser
      );
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(500)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public createMoneyRequest = async (req: any, res: Response) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.trainerService.createMoneyRequest(req.authUser, req.body);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getAllMoneyRequest = async (req: any, res: Response) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.trainerService.getAllMoneyRequest();
        return res.status(CONSTANCE.RES_CODE.success).json({ data: result });
      }
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }
}
