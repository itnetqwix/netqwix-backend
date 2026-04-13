import { Router } from "express";
import { masterController } from "./masterController";

const route: Router = Router();
const masterC = new masterController();

route.get("/master-data", masterC.getMasterData);

export const masterRoute: Router = route;
