import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { NotificationsService } from "./notificationsService";
import { Request, Response } from "express";

export class NotificationsController {
    public logger = log.getLogger();
    public notificationsService = new NotificationsService();

    public getPublicKey = async (req: Request, res: Response) => {
        try {
            const data: ResponseBuilder = await this.notificationsService.getPublicKey();
            return res.status(data.code).send({ status: CONSTANCE.SUCCESS, data: data.result });
        } catch (err) {
            this.logger.error(err);
            return res.status(err.code).send({ status: CONSTANCE.FAIL, error: err.error });
        }
    };

    public getSubscription = async (req: Request, res: Response) => {
        try {
            const data: ResponseBuilder = await this.notificationsService.getSubscription(req);
            return res.status(data.code).send({ status: CONSTANCE.SUCCESS, });
        } catch (err) {
            this.logger.error(err);
            return res.status(err.code).send({ status: CONSTANCE.FAIL, error: err.error });
        }
    };

    public getNotifications = async (req: any, res: Response) => {
        try {
            const data: ResponseBuilder = await this.notificationsService.getNotifications(req);
            return res.status(data.code).send({ status: CONSTANCE.SUCCESS, data: data.result });
        } catch (err) {
            this.logger.error(err);
            return res.status(err.code).send({ status: CONSTANCE.FAIL, error: err.error });
        }
    };
    public updateNotificationsStatus = async (req: any, res: Response) => {
        try {
            const data: ResponseBuilder = await this.notificationsService.updateNotificationsStatus(req);
            return res.status(data.code).send({ status: CONSTANCE.SUCCESS, });
        } catch (err) {
            this.logger.error(err);
            return res.status(err.code).send({ status: CONSTANCE.FAIL, error: err.error });
        }
    };
}
